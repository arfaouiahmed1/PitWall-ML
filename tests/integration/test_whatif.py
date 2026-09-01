from fastapi.testclient import TestClient
from pitwall_api.main import app

client = TestClient(app)


def test_whatif_basic():
    r = client.post("/whatif", json={
        "driver_number": 4,
        "target_pit_lap": 24,
        "target_compound": "HARD",
        "push_pace_delta_s": -0.2,
        "remaining_laps": 30,
        "current_lap": 20,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["driver_number"] == 4
    assert "time_delta_s" in data
    assert "re_entry_position_dist" in data


def test_whatif_soft_compound():
    r = client.post("/whatif", json={
        "driver_number": 1,
        "target_pit_lap": 18,
        "target_compound": "SOFT",
        "push_pace_delta_s": 0.0,
        "remaining_laps": 40,
        "current_lap": 15,
    })
    assert r.status_code == 200
    data = r.json()
    assert "time_delta_s" in data


def test_whatif_invalid_compound():
    r = client.post("/whatif", json={
        "driver_number": 4,
        "target_pit_lap": 20,
        "target_compound": "BANANA",
        "push_pace_delta_s": 0.0,
        "remaining_laps": 30,
        "current_lap": 18,
    })
    # should either normalise or 422 — either is fine, just not 500
    assert r.status_code in (200, 422)


def test_whatif_pit_in_past():
    # target_pit_lap before current_lap — should handle gracefully
    r = client.post("/whatif", json={
        "driver_number": 4,
        "target_pit_lap": 10,
        "target_compound": "MEDIUM",
        "push_pace_delta_s": 0.0,
        "remaining_laps": 30,
        "current_lap": 20,
    })
    assert r.status_code in (200, 422)
