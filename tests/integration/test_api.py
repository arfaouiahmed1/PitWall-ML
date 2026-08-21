from fastapi.testclient import TestClient
from pitwall_api.main import app

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
