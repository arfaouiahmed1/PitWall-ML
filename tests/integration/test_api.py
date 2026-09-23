import asyncio
import threading
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path

import pitwall_api.main as main
import pytest
from fastapi.testclient import TestClient
from pitwall_api.main import app
from starlette.websockets import WebSocketDisconnect

from pitwall.ingestion.replay import ReplayConfig, ReplaySession
from pitwall.schemas.events import RaceEvent

client = TestClient(app)


def test_health():
    with TestClient(app) as running_client:
        r = running_client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


def test_race_state():
    r = client.get("/race/state")
    assert r.status_code == 200
    assert "session_id" in r.json()


def test_pace_predictions():
    r = client.get("/predictions/pace")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_replay_catalog_and_socket_use_bundled_events():
    with TestClient(app) as running_client:
        catalog_response = running_client.get("/race/sessions")
        assert catalog_response.status_code == 200
        replay = catalog_response.json()[0]
        with running_client.websocket_connect(
            f"/ws/race?replay_id={replay['id']}&speed=MAX"
        ) as socket:
            assert socket.receive_json()["type"] == "connected"
            assert socket.receive_json()["type"] == "race_snapshot"
            update = socket.receive_json()

    assert update["type"] == "race_update"
    assert update["event"]["source"] == "bronze_laps"
    assert update["event"]["source"] != "demo"


def test_replay_socket_rejects_unknown_replay_id():
    with (
        TestClient(app) as running_client,
        pytest.raises(WebSocketDisconnect) as closed,
        running_client.websocket_connect("/ws/race?replay_id=../../anything&speed=MAX"),
    ):
        pass

    assert closed.value.code == 1008


def test_live_socket_requires_explicit_running_live_source() -> None:
    with (
        TestClient(app) as running_client,
        pytest.raises(WebSocketDisconnect) as closed,
        running_client.websocket_connect("/ws/race?source=live"),
    ):
        pass

    assert closed.value.code == 1008


def test_concurrent_replay_clients_share_one_producer(monkeypatch: pytest.MonkeyPatch) -> None:
    release = threading.Event()
    producer_count = 0

    class ControlledSource:
        def __init__(self, config: ReplayConfig) -> None:
            nonlocal producer_count
            producer_count += 1

        async def events(self):
            while not release.is_set():
                await asyncio.sleep(0.005)
            for lap in range(1, 4):
                yield RaceEvent(
                    source="test",
                    event_type="lap",
                    event_ts=datetime(2026, 1, lap, tzinfo=UTC),
                    driver_number=1,
                    payload={"lap_number": lap},
                )

    replay = ReplaySession("shared-test", Path("."), 2026, "test", "race")
    global_state_before = main.race_state
    monkeypatch.setattr(main, "ParquetReplaySource", ControlledSource)
    monkeypatch.setattr(main, "replay_sessions", {replay.id: replay})
    monkeypatch.setattr(main, "discover_replay_sessions", lambda _: {replay.id: replay})
    monkeypatch.setattr(main, "replay_broadcasters", {})

    with TestClient(app) as running_client:
        sockets = ExitStack()
        active = [
            sockets.enter_context(
                running_client.websocket_connect(f"/ws/race?replay_id={replay.id}&speed=MAX")
            )
            for _ in range(5)
        ]
        for socket in active:
            assert socket.receive_json()["type"] == "connected"
            assert socket.receive_json()["type"] == "race_snapshot"
        release.set()
        frames = [[socket.receive_json() for _ in range(3)] for socket in active]
        sockets.close()

    assert producer_count == 1
    assert all(frame_set == frames[0] for frame_set in frames[1:])
    assert main.race_state is global_state_before


def test_one_event_max_replay_finishes_after_socket_subscribes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    replay = ReplaySession("one-event-test", Path("."), 2026, "test", "race")

    class OneEventSource:
        def __init__(self, config: ReplayConfig) -> None:
            pass

        async def events(self):
            yield RaceEvent(
                source="test",
                event_type="lap",
                event_ts=datetime(2026, 1, 1, tzinfo=UTC),
                driver_number=1,
                payload={"lap_number": 1},
            )

    monkeypatch.setattr(main, "ParquetReplaySource", OneEventSource)
    monkeypatch.setattr(main, "replay_sessions", {replay.id: replay})
    monkeypatch.setattr(main, "discover_replay_sessions", lambda _: {replay.id: replay})
    monkeypatch.setattr(main, "replay_broadcasters", {})

    with TestClient(app) as running_client, running_client.websocket_connect(
        f"/ws/race?replay_id={replay.id}&speed=MAX"
    ) as socket:
        assert socket.receive_json()["type"] == "connected"
        assert socket.receive_json()["type"] == "race_snapshot"
        assert socket.receive_json()["type"] == "race_update"
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 1000


def test_empty_max_replay_closes_socket_without_runtime_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    replay = ReplaySession("empty-test", Path("."), 2026, "test", "race")

    class EmptySource:
        def __init__(self, config: ReplayConfig) -> None:
            pass

        async def events(self):
            if False:
                yield RaceEvent(
                    source="test",
                    event_type="lap",
                    event_ts=datetime(2026, 1, 1, tzinfo=UTC),
                    driver_number=1,
                    payload={},
                )

    monkeypatch.setattr(main, "ParquetReplaySource", EmptySource)
    monkeypatch.setattr(main, "replay_sessions", {replay.id: replay})
    monkeypatch.setattr(main, "discover_replay_sessions", lambda _: {replay.id: replay})
    monkeypatch.setattr(main, "replay_broadcasters", {})

    with TestClient(app) as running_client, running_client.websocket_connect(
        f"/ws/race?replay_id={replay.id}&speed=MAX"
    ) as socket:
        assert socket.receive_json()["type"] == "connected"
        assert socket.receive_json()["type"] == "race_snapshot"
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 1000
