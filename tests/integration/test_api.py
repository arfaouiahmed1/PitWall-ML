import pytest
from fastapi.testclient import TestClient
from pitwall_api.main import app
from starlette.websockets import WebSocketDisconnect

client = TestClient(app)


def test_health():
    r = client.get("/health")
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
        with running_client.websocket_connect(f"/ws/race?replay_id={replay['id']}&speed=MAX") as socket:
            assert socket.receive_json()["type"] == "connected"
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
