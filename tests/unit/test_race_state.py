from datetime import UTC, datetime

from pitwall.schemas.events import RaceEvent
from pitwall.state.race_state import RaceState


def test_race_state_applies_lap():
    state = RaceState(session_id="test")
    evt = RaceEvent(
        source="test",
        event_type="lap",
        meeting_key="m1",
        session_key="R",
        driver_number=44,
        event_ts=datetime.now(UTC),
        payload={
            "lap_number": 5,
            "lap_time_s": 90.5,
            "compound": "MEDIUM",
            "tyre_age": 5,
            "position": 3,
        },
    )
    state.apply(evt)
    assert state.lap == 5
    assert 44 in state.drivers
    assert state.drivers[44].last_lap_s == 90.5
    assert state.drivers[44].compound == "MEDIUM"


def test_race_state_ordering():
    state = RaceState(session_id="test")
    for lap in [1, 2, 3]:
        evt = RaceEvent(
            source="test",
            event_type="lap",
            meeting_key="m1",
            session_key="R",
            driver_number=1,
            event_ts=datetime.now(UTC),
            payload={"lap_number": lap, "lap_time_s": 90.0 + lap * 0.1},
        )
        state.apply(evt)
    assert state.drivers[1].lap_times == [90.1, 90.2, 90.3]
