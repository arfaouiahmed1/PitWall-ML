"""Unit tests for Opponent Pit Model undercut prediction endpoint (GET /predictions/undercut)."""

from __future__ import annotations

from collections.abc import Generator

import pitwall_api.main as main
import pytest
from fastapi.testclient import TestClient

from pitwall.state.race_state import DriverState, RaceState


@pytest.fixture(autouse=True)
def reset_race_state() -> Generator[None, None, None]:
    """Ensure clean race_state before and after each test."""
    main.race_state = RaceState(session_id="test_session")
    yield
    main.race_state = RaceState(session_id="test_session")


def test_undercut_empty_race_state_no_params() -> None:
    """When race_state has no drivers and no query params are passed, return empty threat gracefully."""
    client = TestClient(main.app)
    response = client.get("/predictions/undercut")

    assert response.status_code == 200
    data = response.json()
    assert data["reason"] == "no_active_drivers"
    assert data["is_undercut_threat"] is False
    assert data["is_overcut_threat"] is False
    assert data["recommended_action"] == "HOLD"
    assert data["driver_number"] is None
    assert data["rival_number"] is None
    assert data["gap_s"] is None
    assert data["tyre_age_delta"] == 0
    assert "model_version" in data


def test_undercut_empty_race_state_with_only_driver_number() -> None:
    """When race_state is empty and only driver_number is passed without gap_s, return no_active_drivers."""
    client = TestClient(main.app)
    response = client.get("/predictions/undercut?driver_number=4")

    assert response.status_code == 200
    data = response.json()
    assert data["reason"] == "no_active_drivers"
    assert data["driver_number"] == 4
    assert data["is_undercut_threat"] is False


def test_undercut_parameter_driven_cover_undercut() -> None:
    """Happy path: gap_s=1.2s and tyre_age_delta=6 laps triggers COVER_UNDERCUT."""
    client = TestClient(main.app)
    response = client.get("/predictions/undercut?gap_s=1.2&tyre_age_delta=6")

    assert response.status_code == 200
    data = response.json()
    assert data["is_undercut_threat"] is True
    assert data["recommended_action"] == "COVER_UNDERCUT"
    assert data["gap_s"] == 1.2
    assert data["tyre_age_delta"] == 6
    assert data["estimated_delta_at_pit_exit_s"] == 0.0
    assert data["rival_pit_probability_3l"] > 0.0
    assert data["reason"] is None


def test_undercut_parameter_driven_hold_large_gap() -> None:
    """When gap exceeds undercut threshold (> 1.8s), action is HOLD."""
    client = TestClient(main.app)
    response = client.get("/predictions/undercut?gap_s=3.5&tyre_age_delta=2")

    assert response.status_code == 200
    data = response.json()
    assert data["is_undercut_threat"] is False
    assert data["is_overcut_threat"] is False
    assert data["recommended_action"] == "HOLD"
    assert data["gap_s"] == 3.5
    assert data["estimated_delta_at_pit_exit_s"] > 0.0


def test_undercut_parameter_driven_extend_overcut() -> None:
    """When driver tyres are significantly fresher (rival age - driver age >= 5) and exit delta > 0."""
    client = TestClient(main.app)
    response = client.get(
        "/predictions/undercut?gap_s=1.5&driver_tyre_age=5&rival_tyre_age=15&driver_compound=MEDIUM&rival_compound=MEDIUM"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["is_overcut_threat"] is True
    assert data["recommended_action"] == "EXTEND_OVERCUT"
    assert data["tyre_age_delta"] == 10


def test_undercut_parameter_driven_full_explicit_parameters() -> None:
    """All optional query parameters specified explicitly."""
    client = TestClient(main.app)
    response = client.get(
        "/predictions/undercut?"
        "driver_number=4&rival_number=1&gap_s=1.0&"
        "driver_compound=MEDIUM&rival_compound=SOFT&"
        "driver_tyre_age=12&rival_tyre_age=18"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["driver_number"] == 4
    assert data["rival_number"] == 1
    assert data["gap_s"] == 1.0
    assert data["tyre_age_delta"] == 6
    assert data["is_undercut_threat"] is True
    assert data["recommended_action"] == "COVER_UNDERCUT"


def test_undercut_compound_validation_invalid() -> None:
    """Invalid tyre compounds are rejected with HTTP 400."""
    client = TestClient(main.app)

    r1 = client.get("/predictions/undercut?driver_compound=BANANA&gap_s=1.2")
    assert r1.status_code == 400
    assert "Invalid driver_compound" in r1.json()["detail"]

    r2 = client.get("/predictions/undercut?rival_compound=WET&gap_s=1.2")
    assert r2.status_code == 400
    assert "Invalid rival_compound" in r2.json()["detail"]


def test_undercut_compound_case_insensitivity() -> None:
    """Lowercase valid compounds are normalized to uppercase."""
    client = TestClient(main.app)
    response = client.get(
        "/predictions/undercut?gap_s=1.2&driver_compound=medium&rival_compound=soft&driver_tyre_age=10&rival_tyre_age=16"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["is_undercut_threat"] is True


def test_undercut_driver_number_validation() -> None:
    """Invalid driver numbers (negative, zero, or identical) are rejected with HTTP 400."""
    client = TestClient(main.app)

    r_neg = client.get("/predictions/undercut?driver_number=-1&gap_s=1.2")
    assert r_neg.status_code == 400
    assert "driver_number must be a positive integer" in r_neg.json()["detail"]

    r_zero = client.get("/predictions/undercut?rival_number=0&gap_s=1.2")
    assert r_zero.status_code == 400
    assert "rival_number must be a positive integer" in r_zero.json()["detail"]

    r_same = client.get("/predictions/undercut?driver_number=4&rival_number=4&gap_s=1.2")
    assert r_same.status_code == 400
    assert "cannot be identical" in r_same.json()["detail"]


def test_undercut_race_state_fallback_auto_p1_p2() -> None:
    """When race_state has drivers and no query params are passed, evaluate P1 and trailing P2."""
    main.race_state.drivers = {
        4: DriverState(
            driver_number=4,
            position=1,
            compound="MEDIUM",
            tyre_age=14,
            gap_to_leader_s=0.0,
            gap_ahead_s=0.0,
            gap_behind_s=1.1,
        ),
        1: DriverState(
            driver_number=1,
            position=2,
            compound="SOFT",
            tyre_age=18,
            gap_to_leader_s=1.1,
            gap_ahead_s=1.1,
            gap_behind_s=3.0,
        ),
    }

    client = TestClient(main.app)
    response = client.get("/predictions/undercut")

    assert response.status_code == 200
    data = response.json()
    assert data["driver_number"] == 4
    assert data["rival_number"] == 1
    assert data["gap_s"] == 1.1
    assert data["tyre_age_delta"] == 4  # 18 - 14
    assert data["is_undercut_threat"] is True
    assert data["recommended_action"] == "COVER_UNDERCUT"


def test_undercut_race_state_fallback_specific_driver() -> None:
    """When driver_number is passed, lookup driver in race_state and find trailing rival."""
    main.race_state.drivers = {
        4: DriverState(
            driver_number=4,
            position=1,
            compound="HARD",
            tyre_age=25,
            gap_to_leader_s=0.0,
            gap_ahead_s=0.0,
        ),
        81: DriverState(
            driver_number=81,
            position=2,
            compound="HARD",
            tyre_age=22,
            gap_to_leader_s=3.2,
            gap_ahead_s=3.2,
        ),
        16: DriverState(
            driver_number=16,
            position=3,
            compound="MEDIUM",
            tyre_age=15,
            gap_to_leader_s=4.5,
            gap_ahead_s=1.3,
        ),
    }

    client = TestClient(main.app)
    # Query for driver 81: trailing rival is driver 16 with gap 1.3s
    response = client.get("/predictions/undercut?driver_number=81")

    assert response.status_code == 200
    data = response.json()
    assert data["driver_number"] == 81
    assert data["rival_number"] == 16
    assert data["gap_s"] == 1.3


def test_undercut_race_state_last_driver_no_trailing_rival() -> None:
    """Driver in last place has no rival behind him on track."""
    main.race_state.drivers = {
        4: DriverState(driver_number=4, position=1),
        1: DriverState(driver_number=1, position=2),
    }

    client = TestClient(main.app)
    response = client.get("/predictions/undercut?driver_number=1")

    assert response.status_code == 200
    data = response.json()
    assert data["driver_number"] == 1
    assert data["rival_number"] is None
    assert data["reason"] == "no_trailing_rival"
    assert data["recommended_action"] == "HOLD"
    assert data["is_undercut_threat"] is False


def test_undercut_race_state_missing_driver_without_gap_fails() -> None:
    """When driver is not in race_state and gap_s is not given, return HTTP 400."""
    main.race_state.drivers = {
        4: DriverState(driver_number=4, position=1),
    }

    client = TestClient(main.app)
    response = client.get("/predictions/undercut?driver_number=99")

    assert response.status_code == 400
    assert "Driver 99 not found in active race state" in response.json()["detail"]


def test_undercut_openapi_documentation() -> None:
    """Endpoint is registered under tags=['Predictions'] with full documentation."""
    client = TestClient(main.app)
    response = client.get("/openapi.json")

    assert response.status_code == 200
    openapi = response.json()
    undercut_endpoint = openapi["paths"]["/predictions/undercut"]["get"]

    assert "Predictions" in undercut_endpoint["tags"]
    assert "summary" in undercut_endpoint
    assert "description" in undercut_endpoint
    assert "200" in undercut_endpoint["responses"]
