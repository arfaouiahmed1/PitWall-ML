"""Unit tests for live ingestion control endpoints."""

from __future__ import annotations

from typing import ClassVar
from unittest.mock import AsyncMock, MagicMock

import httpx
import pitwall_api.main as main
import pytest
from pitwall_api.live_data import OpenF1Snapshot

from pitwall.schemas.events import EventType, RaceEvent


class MockRecorder:
    """Recorder stand-in that avoids starting OpenF1 polling tasks."""

    instances: ClassVar[list[MockRecorder]] = []

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.is_running = False
        self.start = AsyncMock(side_effect=self._start)
        self.stop = AsyncMock(side_effect=self._stop)
        self.instances.append(self)

    async def _start(self) -> None:
        self.is_running = True

    async def _stop(self) -> None:
        self.is_running = False


class MockWriter:
    """Partition writer stand-in that records finalization without disk I/O."""

    instances: ClassVar[list[MockWriter]] = []

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.buffer_size = 3
        self.write_event = MagicMock()
        self.finalize_session = MagicMock()
        self.instances.append(self)


@pytest.mark.asyncio
async def test_live_snapshot_asgi_exposes_source_and_receive_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshot = OpenF1Snapshot(
        provenance="STALE",
        reason="source_data_stale",
        observed_at="2026-03-01T14:00:00+00:00",
        source_id="99",
        race_state=None,
        rows=[],
        drivers=[],
        received_at="2026-03-01T14:00:20+00:00",
        data_age_seconds=20.0,
        stale=True,
    )

    class SnapshotProvider:
        async def snapshot(self) -> OpenF1Snapshot:
            return snapshot

    monkeypatch.setattr(main, "live_provider", SnapshotProvider())
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/race/snapshot?source=live")

    assert response.status_code == 200
    assert response.json()["observed_at"] == snapshot.observed_at
    assert response.json()["received_at"] == snapshot.received_at
    assert response.json()["source_id"] == "99"
    assert response.json()["provenance"] == "STALE"
    assert response.json()["data_age_seconds"] == 20
    assert response.json()["stale"] is True


@pytest.fixture(autouse=True)
def mock_live_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    MockRecorder.instances.clear()
    MockWriter.instances.clear()
    monkeypatch.setattr(main, "LiveRaceRecorder", MockRecorder)
    monkeypatch.setattr(main, "ParquetPartitionWriter", MockWriter)
    main.live_recorder = None
    main.live_writer = None
    main.live_session_key = None
    main.live_event_count = 0
    main.live_latency_ms = None


@pytest.mark.asyncio
async def test_live_control_endpoints_start_status_and_stop() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        start_response = await client.post("/live/start", json={"session_key": "latest"})
        status_response = await client.get("/live/status")
        stop_response = await client.post("/live/stop")

    assert start_response.status_code == 200
    assert start_response.json() == {"status": "running", "session_key": "latest"}
    assert status_response.status_code == 200
    assert status_response.json() == {
        "status": "running",
        "session_key": "latest",
        "event_count": 0,
        "buffered_events": 3,
        "latency_ms": None,
    }
    assert stop_response.status_code == 200
    assert stop_response.json() == {"status": "stopped", "events_captured": 0}
    assert MockRecorder.instances[0].stop.await_count == 1
    assert MockWriter.instances[0].finalize_session.call_count == 1


@pytest.mark.asyncio
async def test_live_start_is_idempotent_and_stop_when_idle_is_safe() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first_start = await client.post("/live/start")
        second_start = await client.post("/live/start", json={"session_key": 42})
        stopped = await client.post("/live/stop")
        idle_status = await client.get("/live/status")
        second_stop = await client.post("/live/stop")

    assert first_start.json() == {"status": "running", "session_key": "latest"}
    assert second_start.json() == {"status": "already_running", "session_key": "latest"}
    assert len(MockRecorder.instances) == 1
    assert stopped.json() == {"status": "stopped", "events_captured": 0}
    assert idle_status.json() == {
        "status": "idle",
        "session_key": None,
        "event_count": 0,
        "buffered_events": 0,
        "latency_ms": None,
    }
    assert second_stop.json() == {"status": "stopped", "events_captured": 0}


@pytest.mark.asyncio
async def test_live_event_callback_updates_capture_metrics() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/live/start", json={"session_key": 99})
        broadcaster = main.live_broadcaster
        assert broadcaster is not None
        subscriber = broadcaster.subscribe()
        callback = MockRecorder.instances[0].kwargs["on_event"]
        await callback(  # type: ignore[misc]
            RaceEvent(
                source="openf1",
                event_type=EventType.POSITION,
                session_key=99,
                event_ts=main.datetime.now(main.UTC),
            )
        )
        status_response = await client.get("/live/status")
        await client.post("/live/stop")

    assert (await subscriber.get()) == {
        "type": "race_snapshot",
        "race_state": {
            "session_id": "99",
            "lap": 0,
            "track_status": "GREEN",
            "event_count": 0,
            "drivers": {},
        },
    }
    live_frame = await subscriber.get()
    assert live_frame is not None
    assert live_frame["type"] == "race_update"
    assert live_frame["event"]["source"] == "openf1"
    assert MockWriter.instances[0].write_event.call_count == 1
    assert status_response.json()["event_count"] == 1
    assert status_response.json()["latency_ms"] is not None
