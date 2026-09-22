"""Cached OpenF1 REST snapshots for the public live PitWall surface."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

OPENF1_BASE_URL = "https://api.openf1.org/v1"


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
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _latest_by_driver(rows: list[dict[str, Any]], timestamp_key: str) -> dict[int, dict[str, Any]]:
    latest: dict[int, dict[str, Any]] = {}
    for row in rows:
        driver_number = _as_int(row.get("driver_number"))
        if driver_number is None:
            continue
        current = latest.get(driver_number)
        if current is None or str(row.get(timestamp_key, "")) >= str(
            current.get(timestamp_key, "")
        ):
            latest[driver_number] = row
    return latest


def _session_is_active(session: dict[str, Any], now: datetime) -> bool:
    started = _timestamp(session.get("date_start"))
    ended = _timestamp(session.get("date_end"))
    if started is None:
        return False
    if started > now:
        return False
    return ended is None or ended >= now


@dataclass(frozen=True)
class OpenF1Snapshot:
    provenance: str
    reason: str | None
    observed_at: str | None
    source_id: str | None
    race_state: dict[str, Any] | None
    rows: list[dict[str, Any]]
    drivers: list[dict[str, Any]]

    def as_response(self) -> dict[str, Any]:
        return {
            "provenance": self.provenance,
            "reason": self.reason,
            "observed_at": self.observed_at,
            "source_id": self.source_id,
            "race_state": self.race_state,
            "rows": self.rows,
            "dots": [],
            "events": [],
            "pace_predictions": [],
            "tyre_predictions": [],
            "pit_predictions": [],
            "drivers": self.drivers,
        }


class OpenF1SnapshotProvider:
    """Fetch public timing data once per TTL without exposing OpenF1 to the client."""

    def __init__(self, cache_ttl_seconds: int, base_url: str = OPENF1_BASE_URL) -> None:
        self.cache_ttl_seconds = cache_ttl_seconds
        self.base_url = base_url.rstrip("/")
        self._cache: OpenF1Snapshot | None = None
        self._cache_until = 0.0
        self._lock = asyncio.Lock()

    async def _get(self, client: httpx.AsyncClient, endpoint: str) -> list[dict[str, Any]]:
        response = await client.get(f"{self.base_url}/{endpoint}", params={"session_key": "latest"})
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    async def snapshot(self) -> OpenF1Snapshot:
        now_monotonic = time.monotonic()
        if self._cache is not None and now_monotonic < self._cache_until:
            return self._cache

        async with self._lock:
            if self._cache is not None and time.monotonic() < self._cache_until:
                return self._cache
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    sessions, positions, intervals, laps, stints, drivers = await asyncio.gather(
                        self._get(client, "sessions"),
                        self._get(client, "position"),
                        self._get(client, "intervals"),
                        self._get(client, "laps"),
                        self._get(client, "stints"),
                        self._get(client, "drivers"),
                    )
            except httpx.HTTPError:
                return OpenF1Snapshot(
                    provenance="UNAVAILABLE",
                    reason="openf1_request_failed",
                    observed_at=None,
                    source_id=None,
                    race_state=None,
                    rows=[],
                    drivers=[],
                )

            now = datetime.now(UTC)
            session = sessions[-1] if sessions else None
            if not session or not _session_is_active(session, now):
                return OpenF1Snapshot(
                    provenance="UNAVAILABLE",
                    reason="no_active_session",
                    observed_at=None,
                    source_id=str(session.get("session_key")) if session else None,
                    race_state=None,
                    rows=[],
                    drivers=[],
                )

            positions_by_driver = _latest_by_driver(positions, "date")
            intervals_by_driver = _latest_by_driver(intervals, "date")
            laps_by_driver = _latest_by_driver(laps, "date_start")
            stints_by_driver = _latest_by_driver(stints, "date_start")
            drivers_by_number = {
                driver_number: driver
                for driver in drivers
                if (driver_number := _as_int(driver.get("driver_number"))) is not None
            }
            rows: list[dict[str, Any]] = []
            for driver_number, position in sorted(
                positions_by_driver.items(),
                key=lambda item: _as_int(item[1].get("position")) or 999,
            ):
                interval = intervals_by_driver.get(driver_number, {})
                lap = laps_by_driver.get(driver_number, {})
                stint = stints_by_driver.get(driver_number, {})
                driver = drivers_by_number.get(driver_number, {})
                rows.append(
                    {
                        "driver_number": driver_number,
                        "position": _as_int(position.get("position")),
                        "gap_to_leader_s": _as_float(interval.get("gap_to_leader")),
                        "gap_ahead_s": _as_float(interval.get("interval")),
                        "last_lap_s": _as_float(lap.get("lap_duration")),
                        "lap_number": _as_int(lap.get("lap_number")),
                        "compound": stint.get("compound"),
                        "tyre_age": _as_int(stint.get("tyre_age_at_start")),
                        "team_name": driver.get("team_name"),
                        "name": driver.get("full_name"),
                        "code": driver.get("name_acronym"),
                    }
                )
            max_lap = max((row["lap_number"] or 0 for row in rows), default=0)
            observed_at = (
                max((str(row.get("date", "")) for row in positions), default=None)
                or now.isoformat()
            )
            snapshot = OpenF1Snapshot(
                provenance="LIVE",
                reason=None,
                observed_at=observed_at,
                source_id=str(session.get("session_key")),
                race_state={
                    "session_id": str(session.get("session_key")),
                    "lap": max_lap,
                    "track_status": "UNKNOWN",
                    "event_count": len(rows),
                },
                rows=rows,
                drivers=[
                    {
                        "driver_number": driver_number,
                        "name": driver.get("full_name"),
                        "code": driver.get("name_acronym"),
                        "team_name": driver.get("team_name"),
                        "headshot_url": driver.get("headshot_url"),
                    }
                    for driver_number, driver in sorted(drivers_by_number.items())
                ],
            )
            self._cache = snapshot
            self._cache_until = time.monotonic() + self.cache_ttl_seconds
            return snapshot

    async def driver_telemetry(self, driver_number: int) -> dict[str, Any]:
        snapshot = await self.snapshot()
        if snapshot.provenance != "LIVE":
            return {
                "provenance": snapshot.provenance,
                "reason": snapshot.reason,
                "driver_number": driver_number,
                "points": [],
            }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    f"{self.base_url}/car_data",
                    params={"session_key": "latest", "driver_number": driver_number},
                )
                response.raise_for_status()
                samples = response.json()
        except httpx.HTTPError:
            return {
                "provenance": "STALE",
                "reason": "openf1_telemetry_request_failed",
                "driver_number": driver_number,
                "points": [],
            }
        if not isinstance(samples, list) or not samples:
            return {
                "provenance": "UNAVAILABLE",
                "reason": "telemetry_unavailable",
                "driver_number": driver_number,
                "points": [],
            }
        points = [
            {
                "timestamp": sample.get("date"),
                "speed": _as_float(sample.get("speed")),
                "throttle": _as_float(sample.get("throttle")),
                "brake": _as_float(sample.get("brake")),
                "gear": _as_int(sample.get("n_gear")),
                "drs": _as_int(sample.get("drs")),
            }
            for sample in samples[-250:]
        ]
        return {
            "provenance": "LIVE",
            "reason": None,
            "driver_number": driver_number,
            "points": points,
            "observed_at": snapshot.observed_at,
        }
