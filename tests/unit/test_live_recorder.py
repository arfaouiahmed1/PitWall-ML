"""Unit tests for LiveRaceRecorder and AsyncRateLimiter."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from pitwall.eventbus import InMemoryBus
from pitwall.ingestion.live_recorder import (
    AsyncRateLimiter,
    LiveRaceRecorder,
    _as_float,
    _as_int,
    _timestamp,
)
from pitwall.schemas.events import EventType, RaceEvent
from pitwall.state.race_state import RaceState


@pytest.mark.asyncio
async def test_rate_limiter_enforces_interval() -> None:
    limiter = AsyncRateLimiter(max_rate=100.0, min_interval=0.03)
    loop = asyncio.get_running_loop()

    t0 = loop.time()
    await limiter.acquire()
    await limiter.acquire()
    t1 = loop.time()

    assert (t1 - t0) >= 0.025


def test_helper_parsers() -> None:
    assert _as_int("44") == 44
    assert _as_int("invalid") is None
    assert _as_int(None) is None

    assert _as_float("1.234") == 1.234
    assert _as_float("bad") is None
    assert _as_float(None) is None

    dt = _timestamp("2026-03-01T14:00:00Z")
    assert dt is not None
    assert dt.tzinfo == UTC
    assert _timestamp(None) is None
    assert _timestamp("not-a-date") is None


def test_normalize_payload_all_endpoints() -> None:
    recorder = LiveRaceRecorder(session_key=9999)

    # Position
    pos_row = {"driver_number": 44, "position": 2, "date": "2026-03-01T14:00:01Z"}
    pos_event = recorder.normalize_payload("position", pos_row)
    assert pos_event is not None
    assert pos_event.event_type == EventType.POSITION
    assert pos_event.driver_number == 44
    assert pos_event.payload["position"] == 2

    # Intervals
    int_row = {
        "driver_number": 44,
        "gap_to_leader": 1.5,
        "interval": 0.3,
        "date": "2026-03-01T14:00:02Z",
    }
    int_event = recorder.normalize_payload("intervals", int_row)
    assert int_event is not None
    assert int_event.event_type == EventType.INTERVAL
    assert int_event.payload["gap_to_leader_s"] == 1.5
    assert int_event.payload["gap_ahead_s"] == 0.3

    # Laps
    lap_row = {
        "driver_number": 44,
        "lap_number": 5,
        "lap_duration": 89.123,
        "duration_sector_1": 28.1,
        "duration_sector_2": 31.0,
        "duration_sector_3": 30.023,
        "date_start": "2026-03-01T14:00:03Z",
    }
    lap_event = recorder.normalize_payload("laps", lap_row)
    assert lap_event is not None
    assert lap_event.event_type == EventType.LAP
    assert lap_event.payload["lap_number"] == 5
    assert lap_event.payload["lap_time_s"] == 89.123

    # Stints
    stint_row = {
        "driver_number": 44,
        "stint_number": 2,
        "compound": "soft",
        "tyre_age_at_start": 4,
        "lap_start": 10,
        "lap_end": 25,
        "date_start": "2026-03-01T14:00:04Z",
    }
    stint_event = recorder.normalize_payload("stints", stint_row)
    assert stint_event is not None
    assert stint_event.event_type == EventType.STINT
    assert stint_event.payload["compound"] == "SOFT"
    assert stint_event.payload["stint"] == 2
    assert stint_event.payload["tyre_age"] == 4

    # Car data
    car_row = {
        "driver_number": 44,
        "speed": 315.5,
        "throttle": 98.0,
        "brake": 0.0,
        "n_gear": 8,
        "drs": 12,
        "rpm": 11800,
        "date": "2026-03-01T14:00:05Z",
    }
    car_event = recorder.normalize_payload("car_data", car_row)
    assert car_event is not None
    assert car_event.event_type == EventType.CAR_DATA
    assert car_event.payload["speed"] == 315.5
    assert car_event.payload["gear"] == 8

    # Weather
    weather_row = {
        "air_temperature": 24.5,
        "track_temperature": 39.0,
        "humidity": 45.0,
        "pressure": 1013.2,
        "wind_speed": 4.1,
        "wind_direction": 180,
        "rainfall": 0,
        "date": "2026-03-01T14:00:06Z",
    }
    weather_event = recorder.normalize_payload("weather", weather_row)
    assert weather_event is not None
    assert weather_event.event_type == EventType.WEATHER
    assert weather_event.payload["air_temperature"] == 24.5
    assert weather_event.payload["track_temperature"] == 39.0

    # Malformed row
    assert recorder.normalize_payload("laps", {"no_driver": True}) is None
    assert recorder.normalize_payload("unknown_endpoint", {}) is None


def test_normalize_payload_preserves_source_time_and_separates_receive_time() -> None:
    received_at = datetime(2026, 3, 1, 14, 1, tzinfo=UTC)
    recorder = LiveRaceRecorder(session_key=9999, clock=lambda: received_at)

    event = recorder.normalize_payload(
        "position",
        {"driver_number": 44, "position": 2, "date": "2026-03-01T14:00:01-05:00"},
    )

    assert event is not None
    assert event.event_ts == datetime(2026, 3, 1, 19, 0, 1, tzinfo=UTC)
    assert event.ingest_ts == received_at
    assert event.source_id == "9999"
    assert event.payload["observed_at"] == event.event_ts.isoformat()
    assert event.payload["received_at"] == received_at.isoformat()
    assert event.payload["provenance"] == "OPENF1"


def test_normalize_payload_marks_stale_source_data_from_injected_clock() -> None:
    received_at = datetime(2026, 3, 1, 14, 0, 20, tzinfo=UTC)
    recorder = LiveRaceRecorder(session_key=9999, clock=lambda: received_at, stale_after_seconds=10)

    event = recorder.normalize_payload(
        "position",
        {"driver_number": 44, "position": 2, "date": "2026-03-01T14:00:00Z"},
    )

    assert event is not None
    assert event.payload["data_age_seconds"] == 20
    assert event.payload["stale"] is True


@pytest.mark.parametrize("source_time", [None, "not-a-date"])
def test_normalize_payload_rejects_missing_or_invalid_source_time(source_time: str | None) -> None:
    recorder = LiveRaceRecorder(session_key=9999)

    event = recorder.normalize_payload(
        "position", {"driver_number": 44, "position": 2, "date": source_time}
    )

    assert event is None


@pytest.mark.asyncio
async def test_poll_endpoint_once_and_eventbus_publication() -> None:
    now_str = datetime.now(UTC).isoformat()
    laps_response = [
        {
            "driver_number": 1,
            "lap_number": 1,
            "lap_duration": 91.2,
            "duration_sector_1": 28.5,
            "duration_sector_2": 31.5,
            "duration_sector_3": 31.2,
            "date_start": now_str,
        }
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "laps" in str(request.url)
        return httpx.Response(200, json=laps_response)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    bus = InMemoryBus()
    state = RaceState(session_id="test_session")

    emitted_events: list[RaceEvent] = []

    def on_event(event: RaceEvent, pred: dict[str, Any] | None) -> None:
        emitted_events.append(event)

    recorder = LiveRaceRecorder(
        session_key="test_session",
        client=client,
        state=state,
        event_bus=bus,
        on_event=on_event,
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    events = await recorder.poll_endpoint_once("laps")

    assert len(events) == 1
    assert events[0].event_type == EventType.LAP
    assert events[0].driver_number == 1
    assert len(emitted_events) == 1

    # State verification
    assert state.lap == 1
    assert 1 in state.drivers
    assert state.drivers[1].last_lap_s == 91.2

    # Bus verification
    messages = bus.consume("pitwall:race:test_session", group="test_group", consumer="test_c")
    assert len(messages) == 1
    payload = messages[0]["data"]
    assert payload["type"] == "race_update"
    assert payload["event"]["driver_number"] == 1
    assert payload["race_state"]["lap"] == 1

    await client.aclose()


@pytest.mark.asyncio
async def test_deduplication_seen_events() -> None:
    now_str = "2026-03-01T14:00:00Z"
    pos_response = [{"driver_number": 63, "position": 3, "date": now_str}]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pos_response)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    recorder = LiveRaceRecorder(
        session_key="test_dedup",
        client=client,
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    first_events = await recorder.poll_endpoint_once("position")
    assert len(first_events) == 1

    second_events = await recorder.poll_endpoint_once("position")
    assert len(second_events) == 0

    await client.aclose()


@pytest.mark.asyncio
async def test_inference_generation_with_custom_fn_and_mock_model() -> None:
    now_str = "2026-03-01T14:00:00Z"
    lap_response = [
        {"driver_number": 81, "lap_number": 3, "lap_duration": 88.5, "date_start": now_str}
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=lap_response)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    bus = InMemoryBus()

    # Custom inference function
    custom_pred = {"q10": 87.9, "q50": 88.4, "q90": 89.1}
    recorder = LiveRaceRecorder(
        session_key="test_inf",
        client=client,
        event_bus=bus,
        inference_fn=lambda state, evt: custom_pred,
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    events = await recorder.poll_endpoint_once("laps")
    assert len(events) == 1

    msgs = bus.consume("pitwall:race:test_inf", group="grp", consumer="c")
    assert len(msgs) == 1
    assert msgs[0]["data"]["prediction"] == custom_pred

    # Built-in quantile inference with mock model
    mock_quantile_model = MagicMock()
    mock_quantile_model.predict.return_value = {0.1: [87.5], 0.5: [88.0], 0.9: [88.7]}

    mock_tyre_model = MagicMock()
    mock_tyre_model.predict.return_value = [0.08]

    mock_pit_model = MagicMock()
    mock_pit_model.predict_proba.return_value = [0.15]

    recorder2 = LiveRaceRecorder(
        session_key="test_inf2",
        client=client,
        quantile_model=mock_quantile_model,
        tyre_model=mock_tyre_model,
        pit_model=mock_pit_model,
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )
    recorder2.state.drivers[81] = RaceState("test_inf2").drivers.setdefault(
        81, MagicMock(driver_number=81)
    )

    pred = recorder2.generate_inference(events[0])
    assert pred is not None
    assert pred["q10"] == 87.5
    assert pred["q50"] == 88.0
    assert pred["q90"] == 88.7
    assert pred["tyre_deg"] == 0.08
    assert pred["pit_next_3"] == 0.15

    await client.aclose()


@pytest.mark.asyncio
async def test_lifecycle_start_and_stop() -> None:
    now_str = "2026-03-01T14:00:00Z"

    def handler(request: httpx.Request) -> httpx.Response:
        if "position" in str(request.url):
            return httpx.Response(200, json=[{"driver_number": 4, "position": 1, "date": now_str}])
        return httpx.Response(200, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    recorder = LiveRaceRecorder(
        session_key="test_lifecycle",
        client=client,
        endpoint_intervals={"position": 0.05},
        endpoint_stagger={"position": 0.0},
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    assert not recorder.is_running
    await recorder.start()
    assert recorder.is_running

    # Second start is idempotent
    await recorder.start()
    assert recorder.is_running

    # Allow poll loop to execute
    await asyncio.sleep(0.12)

    await recorder.stop()
    assert not recorder.is_running
    assert 4 in recorder.state.drivers
    assert recorder.state.drivers[4].position == 1

    await client.aclose()


@pytest.mark.asyncio
async def test_exponential_backoff_on_http_500_and_recovery() -> None:
    call_count = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            return httpx.Response(500, json={"error": "internal error"})
        return httpx.Response(
            200, json=[{"driver_number": 55, "position": 4, "date": "2026-03-01T14:00:00Z"}]
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    recorder = LiveRaceRecorder(
        session_key="test_backoff",
        client=client,
        endpoint_intervals={"position": 0.02},
        endpoint_stagger={"position": 0.0},
        initial_backoff=0.02,
        backoff_factor=1.2,
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    # First attempt raises HTTPStatusError in poll_endpoint_once
    with pytest.raises(httpx.HTTPStatusError):
        await recorder.poll_endpoint_once("position")

    # Start loop which catches errors and backs off gracefully without crashing
    await recorder.start()
    await asyncio.sleep(0.15)
    await recorder.stop()

    assert call_count >= 3
    assert 55 in recorder.state.drivers
    await client.aclose()


@pytest.mark.asyncio
async def test_network_error_and_timeout_handled_gracefully() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("connection timed out")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    recorder = LiveRaceRecorder(
        session_key="test_timeout",
        client=client,
        endpoint_intervals={"position": 0.02},
        endpoint_stagger={"position": 0.0},
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    await recorder.start()
    await asyncio.sleep(0.08)
    # Service must stay alive and not crash
    assert recorder.is_running
    await recorder.stop()
    assert not recorder.is_running
    await client.aclose()


@pytest.mark.asyncio
async def test_async_iterator_events() -> None:
    now_str = "2026-03-01T14:00:00Z"
    pos_response = [{"driver_number": 16, "position": 2, "date": now_str}]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pos_response)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    recorder = LiveRaceRecorder(
        session_key="test_iter",
        client=client,
        rate_limiter=AsyncRateLimiter(max_rate=100.0, min_interval=0.001),
    )

    await recorder.poll_endpoint_once("position")

    collected: list[RaceEvent] = []
    async for event in recorder.events():
        collected.append(event)
        break

    assert len(collected) == 1
    assert collected[0].driver_number == 16
    await client.aclose()
