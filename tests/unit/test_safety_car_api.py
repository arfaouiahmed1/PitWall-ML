"""Unit tests for Safety Car Hazard Model endpoint (GET /predictions/safety-car)."""

from __future__ import annotations

import pitwall_api.main as main
from fastapi.testclient import TestClient


def _client() -> TestClient:
    return TestClient(main.app)


def test_safety_car_monaco_very_high_tier() -> None:
    """Happy path: Monaco query returns VERY_HIGH tier with valid probability floats."""
    response = _client().get("/predictions/safety-car?circuit_id=monaco")

    assert response.status_code == 200
    data = response.json()
    assert data["circuit_risk_tier"] == "VERY_HIGH"
    assert 0.0 <= data["p_sc_next_1"] <= 1.0
    assert 0.0 <= data["p_vsc_next_1"] <= 1.0
    assert 0.0 <= data["p_neutralization_next_3"] <= 1.0
    assert data["p_sc_next_1"] > 0.0
    assert "LAP_1_START_CHAOS" in data["risk_factors"]


def test_safety_car_singapore_and_jeddah_high_tiers() -> None:
    """Singapore and Jeddah reflect high or very high risk tiers."""
    for circuit_id in ("singapore", "jeddah"):
        response = _client().get(f"/predictions/safety-car?circuit_id={circuit_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["circuit_risk_tier"] in {"HIGH", "VERY_HIGH"}
        assert 0.0 <= data["p_sc_next_1"] <= 1.0
        assert 0.0 <= data["p_vsc_next_1"] <= 1.0
        assert 0.0 <= data["p_neutralization_next_3"] <= 1.0


def test_safety_car_unknown_circuit_falls_back_to_medium() -> None:
    """Failure path: unknown circuit falls back to medium risk prior without crashing."""
    response = _client().get("/predictions/safety-car?circuit_id=mystery_track_xyz")

    assert response.status_code == 200
    data = response.json()
    assert data["circuit_risk_tier"] == "MEDIUM"
    assert 0.0 <= data["p_sc_next_1"] <= 1.0
    assert 0.0 <= data["p_vsc_next_1"] <= 1.0
    assert 0.0 <= data["p_neutralization_next_3"] <= 1.0


def test_safety_car_defaults_without_circuit() -> None:
    """Omitting circuit_id uses the medium baseline prior with default lap context."""
    response = _client().get("/predictions/safety-car")

    assert response.status_code == 200
    data = response.json()
    assert data["circuit_risk_tier"] == "MEDIUM"
    assert isinstance(data["risk_factors"], list)
    assert "LAP_1_START_CHAOS" in data["risk_factors"]


def test_safety_car_wet_and_incidents_raise_hazard() -> None:
    """Wet track and recent incidents increase the next-lap SC probability."""
    client = _client()
    dry = client.get("/predictions/safety-car?circuit_id=monaco").json()
    wet = client.get("/predictions/safety-car?circuit_id=monaco&is_wet=true").json()
    chain = client.get(
        "/predictions/safety-car?circuit_id=monaco&recent_incident_count=2"
    ).json()

    assert wet["p_sc_next_1"] > dry["p_sc_next_1"]
    assert "WET_TRACK_CONDITIONS" in wet["risk_factors"]
    assert chain["p_sc_next_1"] > dry["p_sc_next_1"]
    assert "INCIDENT_CHAIN_RISK" in chain["risk_factors"]


def test_safety_car_current_lap_beyond_total_rejected() -> None:
    """current_lap exceeding total_laps is rejected with HTTP 400."""
    response = _client().get(
        "/predictions/safety-car?circuit_id=monaco&current_lap=70&total_laps=66"
    )

    assert response.status_code == 400
    assert "cannot exceed total_laps" in response.json()["detail"]


def test_safety_car_invalid_lap_values_rejected() -> None:
    """Non-positive lap values fail FastAPI query validation with HTTP 422."""
    response = _client().get("/predictions/safety-car?current_lap=0")

    assert response.status_code == 422


def test_safety_car_openapi_documentation() -> None:
    """Endpoint is registered under tags=['Predictions'] with full documentation."""
    response = _client().get("/openapi.json")

    assert response.status_code == 200
    endpoint = response.json()["paths"]["/predictions/safety-car"]["get"]

    assert "Predictions" in endpoint["tags"]
    assert "summary" in endpoint
    assert "description" in endpoint
    assert "200" in endpoint["responses"]
