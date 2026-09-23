"""Live ingestion worker service for OpenF1 real-time telemetry.

Polls OpenF1 endpoints (/position, /intervals, /laps, /stints, /car_data, /weather)
with async rate-limiting (shared httpx.AsyncClient, min 1.5s per endpoint,
staggered weather & stints at 30s), normalizes payloads to canonical RaceEvent
instances, applies them to RaceState, generates live predictions, and publishes
to the EventBus.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from pitwall.eventbus import EventBus, get_bus
from pitwall.schemas.events import EventType, RaceEvent
from pitwall.state.race_state import DriverState, RaceState

logger = logging.getLogger(__name__)

OPENF1_BASE_URL = "https://api.openf1.org/v1"

DEFAULT_ENDPOINT_INTERVALS: dict[str, float] = {
    "position": 1.5,
    "intervals": 1.5,
    "laps": 1.5,
    "car_data": 1.5,
    "stints": 30.0,
    "weather": 30.0,
}

DEFAULT_ENDPOINT_STAGGER: dict[str, float] = {
    "position": 0.0,
    "intervals": 0.25,
    "laps": 0.5,
    "car_data": 0.75,
    "stints": 1.0,
    "weather": 1.25,
}


def _as_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except ValueError:
        return None


class AsyncRateLimiter:
    """Async token bucket / interval limiter to prevent OpenF1 HTTP 429 errors.

    Enforces minimum time spacing between outgoing HTTP requests across a shared client.
    """

    def __init__(self, max_rate: float = 3.0, min_interval: float = 0.25) -> None:
        self.max_rate = max_rate
        self.min_interval = min_interval
        self._lock = asyncio.Lock()
        self._last_request_time = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            elapsed = now - self._last_request_time
            if elapsed < self.min_interval:
                await asyncio.sleep(self.min_interval - elapsed)
            self._last_request_time = loop.time()


class LiveRaceRecorder:
    """Live telemetry ingestion worker service polling OpenF1 endpoints."""

    def __init__(
        self,
        session_key: int | str = "latest",
        base_url: str = OPENF1_BASE_URL,
        client: httpx.AsyncClient | None = None,
        state: RaceState | None = None,
        event_bus: EventBus | None = None,
        quantile_model: Any = None,
        ml_model: Any = None,
        tyre_model: Any = None,
        pit_model: Any = None,
        inference_fn: Callable[[RaceState, RaceEvent], dict[str, Any] | None] | None = None,
        on_event: (
            Callable[[RaceEvent, dict[str, Any] | None], Awaitable[None] | None]
            | Callable[[RaceEvent], Awaitable[None] | None]
            | None
        ) = None,
        rate_limiter: AsyncRateLimiter | None = None,
        endpoint_intervals: dict[str, float] | None = None,
        endpoint_stagger: dict[str, float] | None = None,
        timeout: float = 10.0,
        initial_backoff: float = 1.0,
        backoff_factor: float = 1.5,
        max_backoff: float = 60.0,
        max_seen_history: int = 20000,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        stale_after_seconds: float = 10.0,
    ) -> None:
        self.session_key = session_key
        self.base_url = base_url.rstrip("/")
        self._external_client = client
        self._client = client
        self._owns_client = False
        self.timeout = timeout
        self.initial_backoff = initial_backoff
        self.backoff_factor = backoff_factor
        self.max_backoff = max_backoff
        self.clock = clock
        self.stale_after_seconds = stale_after_seconds

        self.state = state if state is not None else RaceState(session_id=str(session_key))
        self.event_bus = event_bus if event_bus is not None else get_bus()

        self.quantile_model = quantile_model
        self.ml_model = ml_model
        self.tyre_model = tyre_model
        self.pit_model = pit_model
        self.inference_fn = inference_fn
        self.on_event = on_event

        self.rate_limiter = (
            rate_limiter
            if rate_limiter is not None
            else AsyncRateLimiter(max_rate=3.0, min_interval=0.25)
        )
        self.endpoint_intervals = dict(DEFAULT_ENDPOINT_INTERVALS)
        if endpoint_intervals:
            self.endpoint_intervals.update(endpoint_intervals)

        self.endpoint_stagger = dict(DEFAULT_ENDPOINT_STAGGER)
        if endpoint_stagger:
            self.endpoint_stagger.update(endpoint_stagger)

        self._running = False
        self._tasks: list[asyncio.Task[None]] = []
        self._event_queue: asyncio.Queue[RaceEvent] = asyncio.Queue()

        self._seen_keys: set[str] = set()
        self._seen_keys_order: deque[str] = deque(maxlen=max_seen_history)
        self._last_dates: dict[str, str] = {}

    @property
    def is_running(self) -> bool:
        return self._running

    async def start(self) -> None:
        """Start background polling loops for all configured endpoints."""
        if self._running:
            return

        self._running = True
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
            self._owns_client = True

        self._tasks = []
        for endpoint, interval in self.endpoint_intervals.items():
            delay = self.endpoint_stagger.get(endpoint, 0.0)
            task = asyncio.create_task(
                self._poll_endpoint_loop(endpoint, interval, delay),
                name=f"live_recorder_{endpoint}",
            )
            self._tasks.append(task)

    async def stop(self) -> None:
        """Stop all background polling loops and clean up client resources."""
        if not self._running:
            return

        self._running = False
        for task in self._tasks:
            task.cancel()

        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
            self._tasks.clear()

        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None
            self._owns_client = False

    async def __aenter__(self) -> LiveRaceRecorder:
        await self.start()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.stop()

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
            self._owns_client = True
        return self._client

    async def _fetch(
        self, endpoint: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        client = self._ensure_client()
        await self.rate_limiter.acquire()
        url = f"{self.base_url}/{endpoint}"
        query_params = {"session_key": self.session_key}
        if params:
            query_params.update(params)

        response = await client.get(url, params=query_params)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else [data] if isinstance(data, dict) else []

    def _record_seen_key(self, key: str) -> bool:
        if key in self._seen_keys:
            return False
        if len(self._seen_keys) >= (self._seen_keys_order.maxlen or 20000):
            evicted = self._seen_keys_order.popleft()
            self._seen_keys.discard(evicted)
        self._seen_keys.add(key)
        self._seen_keys_order.append(key)
        return True

    def normalize_payload(self, endpoint: str, row: dict[str, Any]) -> RaceEvent | None:
        """Convert a raw OpenF1 dictionary into a canonical RaceEvent instance."""
        if not isinstance(row, dict):
            return None

        if endpoint == "position":
            return self._normalize_position(row)
        if endpoint == "intervals":
            return self._normalize_interval(row)
        if endpoint == "laps":
            return self._normalize_lap(row)
        if endpoint == "stints":
            return self._normalize_stint(row)
        if endpoint == "car_data":
            return self._normalize_car_data(row)
        if endpoint == "weather":
            return self._normalize_weather(row)
        return None

    def _normalize_position(self, row: dict[str, Any]) -> RaceEvent | None:
        dn = _as_int(row.get("driver_number"))
        pos = _as_int(row.get("position"))
        date_raw = row.get("date")
        event_ts = _timestamp(date_raw)
        if dn is None or event_ts is None:
            return None
        received_at = self.clock().astimezone(UTC)
        age_seconds = (received_at - event_ts).total_seconds()

        source_key = f"pos_{self.session_key}_{dn}_{date_raw or event_ts.isoformat()}"
        payload = {
            "position": pos,
            "driver_number": dn,
            "date": date_raw,
        }
        return RaceEvent(
            source="openf1",
            event_type=EventType.POSITION,
            meeting_key=row.get("meeting_key"),
            session_key=row.get("session_key", self.session_key),
            driver_number=dn,
            event_ts=event_ts,
            ingest_ts=received_at,
            source_id=str(row.get("session_key", self.session_key)),
            source_key=source_key,
            payload={
                **payload,
                "observed_at": event_ts.isoformat(),
                "received_at": received_at.isoformat(),
                "provenance": "OPENF1",
                "data_age_seconds": age_seconds,
                "stale": age_seconds > self.stale_after_seconds,
            },
        )

    def _normalize_interval(self, row: dict[str, Any]) -> RaceEvent | None:
        dn = _as_int(row.get("driver_number"))
        gap_to_leader = _as_float(row.get("gap_to_leader"))
        interval = _as_float(row.get("interval"))
        date_raw = row.get("date")
        event_ts = _timestamp(date_raw)
        if dn is None or event_ts is None:
            return None
        received_at = self.clock().astimezone(UTC)
        age_seconds = (received_at - event_ts).total_seconds()

        source_key = f"int_{self.session_key}_{dn}_{date_raw or event_ts.isoformat()}"
        payload = {
            "gap_to_leader": gap_to_leader,
            "interval": interval,
            "gap_to_leader_s": gap_to_leader,
            "gap_ahead_s": interval,
            "driver_number": dn,
            "date": date_raw,
        }
        return RaceEvent(
            source="openf1",
            event_type=EventType.INTERVAL,
            meeting_key=row.get("meeting_key"),
            session_key=row.get("session_key", self.session_key),
            driver_number=dn,
            event_ts=event_ts,
            ingest_ts=received_at,
            source_id=str(row.get("session_key", self.session_key)),
            source_key=source_key,
            payload={
                **payload,
                "observed_at": event_ts.isoformat(),
                "received_at": received_at.isoformat(),
                "provenance": "OPENF1",
                "data_age_seconds": age_seconds,
                "stale": age_seconds > self.stale_after_seconds,
            },
        )

    def _normalize_lap(self, row: dict[str, Any]) -> RaceEvent | None:
        dn = _as_int(row.get("driver_number"))
        lap_number = _as_int(row.get("lap_number"))
        lap_duration = _as_float(row.get("lap_duration"))
        s1 = _as_float(row.get("duration_sector_1"))
        s2 = _as_float(row.get("duration_sector_2"))
        s3 = _as_float(row.get("duration_sector_3"))
        date_raw = row.get("date_start") or row.get("date")
        event_ts = _timestamp(date_raw)
        if dn is None or event_ts is None:
            return None
        received_at = self.clock().astimezone(UTC)
        age_seconds = (received_at - event_ts).total_seconds()

        source_key = f"lap_{self.session_key}_{dn}_{lap_number}_{date_raw or event_ts.isoformat()}"
        payload = {
            "lap_number": lap_number,
            "lap_duration": lap_duration,
            "lap_time_s": lap_duration,
            "duration_sector_1": s1,
            "duration_sector_2": s2,
            "duration_sector_3": s3,
            "is_pit_out_lap": row.get("is_pit_out_lap"),
            "driver_number": dn,
            "date_start": date_raw,
        }
        return RaceEvent(
            source="openf1",
            event_type=EventType.LAP,
            meeting_key=row.get("meeting_key"),
            session_key=row.get("session_key", self.session_key),
            driver_number=dn,
            event_ts=event_ts,
            ingest_ts=received_at,
            source_id=str(row.get("session_key", self.session_key)),
            source_key=source_key,
            payload={
                **payload,
                "observed_at": event_ts.isoformat(),
                "received_at": received_at.isoformat(),
                "provenance": "OPENF1",
                "data_age_seconds": age_seconds,
                "stale": age_seconds > self.stale_after_seconds,
            },
        )

    def _normalize_stint(self, row: dict[str, Any]) -> RaceEvent | None:
        dn = _as_int(row.get("driver_number"))
        stint_no = _as_int(row.get("stint_number"))
        compound = str(row.get("compound", "")).upper() if row.get("compound") else "UNKNOWN"
        tyre_age = _as_int(row.get("tyre_age_at_start"))
        lap_start = _as_int(row.get("lap_start"))
        lap_end = _as_int(row.get("lap_end"))
        date_raw = row.get("date_start") or row.get("date")
        event_ts = _timestamp(date_raw)
        if dn is None or event_ts is None:
            return None
        received_at = self.clock().astimezone(UTC)
        age_seconds = (received_at - event_ts).total_seconds()

        source_key = f"stint_{self.session_key}_{dn}_{stint_no}_{date_raw or event_ts.isoformat()}"
        payload = {
            "stint": stint_no,
            "stint_number": stint_no,
            "compound": compound,
            "tyre_age": tyre_age,
            "tyre_age_at_start": tyre_age,
            "lap_start": lap_start,
            "lap_end": lap_end,
            "driver_number": dn,
            "date_start": date_raw,
        }
        return RaceEvent(
            source="openf1",
            event_type=EventType.STINT,
            meeting_key=row.get("meeting_key"),
            session_key=row.get("session_key", self.session_key),
            driver_number=dn,
            event_ts=event_ts,
            ingest_ts=received_at,
            source_id=str(row.get("session_key", self.session_key)),
            source_key=source_key,
            payload={
                **payload,
                "observed_at": event_ts.isoformat(),
                "received_at": received_at.isoformat(),
                "provenance": "OPENF1",
                "data_age_seconds": age_seconds,
                "stale": age_seconds > self.stale_after_seconds,
            },
        )

    def _normalize_car_data(self, row: dict[str, Any]) -> RaceEvent | None:
        dn = _as_int(row.get("driver_number"))
        speed = _as_float(row.get("speed"))
        throttle = _as_float(row.get("throttle"))
        brake = _as_float(row.get("brake"))
        gear = _as_int(row.get("n_gear"))
        drs = _as_int(row.get("drs"))
        rpm = _as_int(row.get("rpm"))
        date_raw = row.get("date")
        event_ts = _timestamp(date_raw)
        if dn is None or event_ts is None:
            return None
        received_at = self.clock().astimezone(UTC)
        age_seconds = (received_at - event_ts).total_seconds()

        source_key = f"cardata_{self.session_key}_{dn}_{date_raw or event_ts.isoformat()}"
        payload = {
            "speed": speed,
            "throttle": throttle,
            "brake": brake,
            "gear": gear,
            "n_gear": gear,
            "drs": drs,
            "rpm": rpm,
            "driver_number": dn,
            "date": date_raw,
        }
        return RaceEvent(
            source="openf1",
            event_type=EventType.CAR_DATA,
            meeting_key=row.get("meeting_key"),
            session_key=row.get("session_key", self.session_key),
            driver_number=dn,
            event_ts=event_ts,
            ingest_ts=received_at,
            source_id=str(row.get("session_key", self.session_key)),
            source_key=source_key,
            payload={
                **payload,
                "observed_at": event_ts.isoformat(),
                "received_at": received_at.isoformat(),
                "provenance": "OPENF1",
                "data_age_seconds": age_seconds,
                "stale": age_seconds > self.stale_after_seconds,
            },
        )

    def _normalize_weather(self, row: dict[str, Any]) -> RaceEvent | None:
        air_temp = _as_float(row.get("air_temperature"))
        track_temp = _as_float(row.get("track_temperature"))
        humidity = _as_float(row.get("humidity"))
        pressure = _as_float(row.get("pressure"))
        wind_speed = _as_float(row.get("wind_speed"))
        wind_dir = _as_int(row.get("wind_direction"))
        rainfall = _as_int(row.get("rainfall")) or 0
        date_raw = row.get("date")
        event_ts = _timestamp(date_raw)
        if event_ts is None:
            return None
        received_at = self.clock().astimezone(UTC)
        age_seconds = (received_at - event_ts).total_seconds()

        source_key = f"weather_{self.session_key}_{date_raw or event_ts.isoformat()}"
        payload = {
            "air_temperature": air_temp,
            "track_temperature": track_temp,
            "humidity": humidity,
            "pressure": pressure,
            "wind_speed": wind_speed,
            "wind_direction": wind_dir,
            "rainfall": rainfall,
            "date": date_raw,
        }
        return RaceEvent(
            source="openf1",
            event_type=EventType.WEATHER,
            meeting_key=row.get("meeting_key"),
            session_key=row.get("session_key", self.session_key),
            driver_number=None,
            event_ts=event_ts,
            ingest_ts=received_at,
            source_id=str(row.get("session_key", self.session_key)),
            source_key=source_key,
            payload={
                **payload,
                "observed_at": event_ts.isoformat(),
                "received_at": received_at.isoformat(),
                "provenance": "OPENF1",
                "data_age_seconds": age_seconds,
                "stale": age_seconds > self.stale_after_seconds,
            },
        )

    def generate_inference(self, event: RaceEvent) -> dict[str, Any] | None:
        """Run ML inference for the driver associated with this event."""
        if self.inference_fn is not None:
            try:
                return self.inference_fn(self.state, event)
            except Exception as exc:
                logger.debug("Custom inference function error: %s", exc)
                return None

        dn = event.driver_number
        if dn is None or dn not in self.state.drivers:
            return None

        ds = self.state.drivers[dn]
        if self.quantile_model is None and self.ml_model is None:
            return None

        try:
            from pitwall.simulation.engine import _build_features_for_prediction

            @dataclass
            class _SimDriver:
                tyre_age: int = 0
                compound: str = "MEDIUM"
                stint_no: int = 1
                lap_number: int = 1
                position: int = 0
                gap_to_leader_s: float = 0.0

            d = _SimDriver()
            d.tyre_age = getattr(ds, "tyre_age", 0) or 0
            d.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
            d.stint_no = getattr(ds, "stint_no", 1) or 1
            d.lap_number = getattr(ds, "last_lap_no", 1) or 1
            d.position = getattr(ds, "position", 0) or 0
            d.gap_to_leader_s = getattr(ds, "gap_to_leader_s", 0.0) or 0.0

            features = _build_features_for_prediction(d, race_progress=0.5)  # type: ignore

            if self.quantile_model is not None:
                qd = self.quantile_model.predict(features)
                q10, q50, q90 = float(qd[0.1][0]), float(qd[0.5][0]), float(qd[0.9][0])
            elif self.ml_model is not None:
                qd = self.ml_model.predict_quantiles(features)
                q10, q50, q90 = float(qd[0.1][0]), float(qd[0.5][0]), float(qd[0.9][0])
            else:
                return None

            prediction: dict[str, Any] = {
                "q10": round(q10, 3),
                "q50": round(q50, 3),
                "q90": round(q90, 3),
            }

            if self.tyre_model is not None:
                with contextlib.suppress(Exception):
                    deg = float(self.tyre_model.predict(features)[0])
                    prediction["tyre_deg"] = round(deg, 3)

            if self.pit_model is not None:
                with contextlib.suppress(Exception):
                    pit_p = float(self.pit_model.predict_proba(features)[0])
                    prediction["pit_next_3"] = round(pit_p, 3)

            return prediction
        except Exception as exc:
            logger.debug("Inference generation failed for driver %s: %s", dn, exc)
            return None

    async def _emit_event(self, event: RaceEvent, prediction: dict[str, Any] | None) -> None:
        """Push event and prediction to EventBus and registered callbacks."""
        dn = event.driver_number
        event_type_str = (
            event.event_type.value
            if isinstance(event.event_type, EventType)
            else str(event.event_type)
        )
        msg = {
            "type": "race_update",
            "event": {
                "source": event.source,
                "event_type": event_type_str,
                "driver_number": event.driver_number,
                "event_ts": event.event_ts.isoformat(),
                "source_timestamp": event.event_ts.isoformat(),
                "observed_at": event.payload.get("observed_at"),
                "received_at": event.payload.get("received_at"),
                "source_id": event.source_id,
                "provenance": event.payload.get("provenance"),
                "data_age_seconds": event.payload.get("data_age_seconds"),
                "stale": event.payload.get("stale", False),
                "payload": event.payload,
            },
            "race_state": {
                "session_id": self.state.session_id,
                "lap": self.state.lap,
                "track_status": self.state.track_status,
                "driver": (
                    self.state.drivers[dn].__dict__
                    if dn is not None and dn in self.state.drivers
                    else None
                ),
            },
            "prediction": prediction,
            "ts": datetime.now(UTC).isoformat(),
        }

        if self.event_bus is not None:
            with contextlib.suppress(Exception):
                self.event_bus.publish(f"pitwall:race:{self.state.session_id}", msg)

        if self.on_event is not None:
            try:
                res = self.on_event(event, prediction)  # type: ignore
            except TypeError:
                res = self.on_event(event)  # type: ignore
            if asyncio.iscoroutine(res):
                await res

        await self._event_queue.put(event)

    def _apply_event_to_state(self, event: RaceEvent) -> None:
        """Ensure DriverState exists for driver events and apply RaceEvent to RaceState."""
        dn = event.driver_number
        if dn is not None and dn not in self.state.drivers:
            self.state.drivers[dn] = DriverState(driver_number=dn)

        p = event.payload
        event_type_str = (
            event.event_type.value
            if isinstance(event.event_type, EventType)
            else str(event.event_type)
        )
        if event_type_str == "position" and dn is not None and "position" in p:
            with contextlib.suppress(Exception):
                self.state.drivers[dn].position = int(p["position"])

        elif event_type_str == "stint" and dn is not None:
            ds = self.state.drivers[dn]
            if p.get("compound"):
                ds.compound = str(p["compound"]).upper()
            if p.get("tyre_age") is not None:
                with contextlib.suppress(Exception):
                    ds.tyre_age = int(p["tyre_age"])
            if p.get("stint") is not None:
                with contextlib.suppress(Exception):
                    ds.stint_no = int(p["stint"])

        self.state.apply(event)

    async def poll_endpoint_once(self, endpoint: str) -> list[RaceEvent]:
        """Poll a single OpenF1 endpoint once, normalize events, update state, and emit."""
        params: dict[str, Any] = {}
        if endpoint in self._last_dates:
            params["date>"] = self._last_dates[endpoint]

        rows = await self._fetch(endpoint, params=params)
        events: list[RaceEvent] = []

        for row in rows:
            event = self.normalize_payload(endpoint, row)
            if event is None:
                continue

            unique_key = event.source_key or f"{endpoint}_{event.event_ts.isoformat()}"
            if not self._record_seen_key(unique_key):
                continue

            date_val = str(row.get("date") or row.get("date_start") or "")
            if date_val and date_val > self._last_dates.get(endpoint, ""):
                self._last_dates[endpoint] = date_val

            self._apply_event_to_state(event)
            pred = self.generate_inference(event)
            await self._emit_event(event, pred)
            events.append(event)

        return events

    async def poll_all_once(self) -> dict[str, list[RaceEvent]]:
        """Poll all configured endpoints sequentially with rate-limiting."""
        results: dict[str, list[RaceEvent]] = {}
        for endpoint in self.endpoint_intervals:
            results[endpoint] = await self.poll_endpoint_once(endpoint)
        return results

    async def _poll_endpoint_loop(
        self, endpoint: str, interval: float, initial_delay: float
    ) -> None:
        """Background loop continuously polling one endpoint with error backoff."""
        if initial_delay > 0:
            await asyncio.sleep(initial_delay)

        backoff = self.initial_backoff
        while self._running:
            try:
                await self.poll_endpoint_once(endpoint)
                backoff = self.initial_backoff
                await asyncio.sleep(interval)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    backoff = min(backoff * 2.0, self.max_backoff)
                    logger.warning(
                        "OpenF1 429 rate limit hit on %s. Backing off for %.1fs", endpoint, backoff
                    )
                else:
                    backoff = min(backoff * self.backoff_factor, self.max_backoff)
                    logger.warning(
                        "OpenF1 HTTP %s on %s. Backing off for %.1fs",
                        exc.response.status_code,
                        endpoint,
                        backoff,
                    )
                await asyncio.sleep(backoff)
            except (httpx.HTTPError, TimeoutError) as exc:
                backoff = min(backoff * self.backoff_factor, self.max_backoff)
                logger.warning(
                    "OpenF1 network error on %s (%s). Backing off for %.1fs", endpoint, exc, backoff
                )
                await asyncio.sleep(backoff)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.exception("Unexpected error while polling %s: %s", endpoint, exc)
                await asyncio.sleep(interval)

    async def events(self) -> AsyncIterator[RaceEvent]:
        """Yield canonical RaceEvents as they are ingested."""
        while self._running or not self._event_queue.empty():
            try:
                event = await asyncio.wait_for(self._event_queue.get(), timeout=0.1)
                yield event
                self._event_queue.task_done()
            except TimeoutError:
                if not self._running:
                    break
