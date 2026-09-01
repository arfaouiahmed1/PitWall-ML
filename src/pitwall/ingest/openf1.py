"""OpenF1 API ingestion client.

Pulls real F1 data from the OpenF1 API (https://openf1.org/docs/) and writes
it to the Bronze raw layer as Parquet files.  All historical data from 2023
onward is free without authentication.

Data sources (per OpenF1 docs):
    - sessions:      race weekend sessions (gives session_key)
    - drivers:       driver roster per session
    - car_data:      ~3.7 Hz telemetry (speed, RPM, gear, throttle, brake, drs)
    - location:      ~3.7 Hz car coordinates (X, Y, Z)
    - intervals:     ~4-second gap updates (gap_to_leader, interval)
    - overtakes:     actual overtaking events
    - laps:          lap-by-lap timing data
    - stints:        tyre stint data
    - pit:           pit stop events (lap_number, stop_duration, etc.)
    - position:      per-lap position data
    - weather:       air/track temperature, humidity, pressure, wind, rain
    - race_control:  safety car, VSC, flags, session events

Bronze layout:
    data/bronze/{year}/{event}_{session_type}/
        sessions.parquet
        drivers.parquet
        car_data.parquet
        location.parquet
        intervals.parquet
        overtakes.parquet
        laps.parquet
        stints.parquet
        pit.parquet
        position.parquet
        weather.parquet
        race_control.parquet
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import polars as pl

BASE_URL = "https://api.openf1.org/v1"
BATCH_SIZE = 5000  # OpenF1 returns data in batches of 5000 max

_REQUEST_SENTINEL = object()


class OpenF1Client:
    """Minimal OpenF1 API client with pagination and retry."""

    def __init__(self, base_url: str = BASE_URL, timeout: int = 30, max_retries: int = 3) -> None:
        if max_retries < 1:
            raise ValueError("max_retries must be >= 1")
        self.base_url = base_url
        self.timeout = timeout
        self.max_retries = max_retries

    def _request(self, endpoint: str, **params: Any) -> list[dict[str, Any]]:
        """Make a paginated request to the OpenF1 API."""
        url = f"{self.base_url}/{endpoint}"
        all_results: list[dict[str, Any]] = []
        params.setdefault("limit", BATCH_SIZE)
        params.setdefault("offset", 0)

        while True:
            qs = urlencode(params)
            full_url = f"{url}?{qs}"
            data: Any = _REQUEST_SENTINEL
            for attempt in range(self.max_retries):
                try:
                    resp = httpx.get(
                        full_url, timeout=self.timeout, headers={"User-Agent": "PitWall-ML/1.0"}
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    break
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429:
                        if attempt == self.max_retries - 1:
                            raise RuntimeError(
                                f"OpenF1 rate limit exhausted after {self.max_retries} retries "
                                f"for {endpoint}"
                            ) from e
                        wait = (2**attempt) * 5
                        print(f"  Rate limited, waiting {wait}s...")
                        time.sleep(wait)
                        continue
                    if e.response.status_code == 404:
                        return all_results
                    raise
                except Exception:
                    if attempt < self.max_retries - 1:
                        time.sleep(2**attempt)
                        continue
                    raise
            if data is _REQUEST_SENTINEL:
                raise RuntimeError(
                    f"OpenF1 request failed after {self.max_retries} retries for {endpoint}"
                )
            if isinstance(data, list):
                all_results.extend(data)
                if len(data) < BATCH_SIZE:
                    break  # No more pages
                params["offset"] += BATCH_SIZE
            else:
                # Non-list response (error or metadata)
                return all_results if all_results else (data if isinstance(data, dict) else [])

            if len(all_results) > 100_000:
                print(f"  Warning: fetched {len(all_results)} records, capping to prevent runaway")
                break

        return all_results

    def get_sessions(
        self, year: int | None = None, session_key: int | None = None, limit: int = 100
    ) -> pl.DataFrame:
        """Fetch session metadata."""
        params: dict[str, Any] = {"limit": limit}
        if year is not None:
            params["year"] = year
        if session_key is not None:
            params["session_key"] = session_key
        data = self._request("sessions", **params)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_drivers(self, session_key: int) -> pl.DataFrame:
        """Fetch driver roster for a session."""
        data = self._request("drivers", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_car_data(self, session_key: int, driver_number: int | None = None) -> pl.DataFrame:
        """Fetch 3.7 Hz telemetry: speed, RPM, gear, throttle, brake, drs."""
        params: dict[str, Any] = {"session_key": session_key}
        if driver_number is not None:
            params["driver_number"] = driver_number
        data = self._request("car_data", **params)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_location(self, session_key: int) -> pl.DataFrame:
        """Fetch 3.7 Hz car coordinates: X, Y, Z."""
        data = self._request("location", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_intervals(self, session_key: int) -> pl.DataFrame:
        """Fetch ~4-second interval updates: gap_to_leader, interval."""
        data = self._request("intervals", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_overtakes(self, session_key: int) -> pl.DataFrame:
        """Fetch actual overtaking events."""
        data = self._request("overtakes", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_laps(self, session_key: int, driver_number: int | None = None) -> pl.DataFrame:
        """Fetch lap-by-lap timing data."""
        params: dict[str, Any] = {"session_key": session_key}
        if driver_number is not None:
            params["driver_number"] = driver_number
        data = self._request("laps", **params)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_stints(self, session_key: int) -> pl.DataFrame:
        """Fetch tyre stint data."""
        data = self._request("stints", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_pit(self, session_key: int) -> pl.DataFrame:
        """Fetch pit stop events."""
        data = self._request("pit", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_position(self, session_key: int) -> pl.DataFrame:
        """Fetch per-timestamp position data."""
        data = self._request("position", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_weather(self, session_key: int) -> pl.DataFrame:
        """Fetch weather data: air/temp, track temp, humidity, pressure, wind, rain."""
        data = self._request("weather", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()

    def get_race_control(self, session_key: int) -> pl.DataFrame:
        """Fetch race control messages: SC, VSC, flags."""
        data = self._request("race_control", session_key=session_key)
        return pl.DataFrame(data) if data else pl.DataFrame()


# ── Session discovery ─────────────────────────────────────────────────────────


def find_session_by_name(
    session_name: str, year: int | None = None, meeting_key: int | None = None
) -> dict[str, Any] | None:
    """Find a session by name (e.g. '2026 Monaco Grand Prix')."""
    client = OpenF1Client()
    params: dict[str, Any] = {"limit": 200}
    if year:
        params["year"] = year
    if meeting_key:
        params["meeting_key"] = meeting_key
    sessions = client._request("sessions", **params)
    for s in sessions:
        if session_name.lower() in s.get("session_name", "").lower():
            return s
    # Try substring match on full name
    for s in sessions:
        full = f"{s.get('session_name', '')} {s.get('session_type', '')}"
        if session_name.lower() in full.lower():
            return s
    return None


def get_latest_race_sessions(year: int) -> pl.DataFrame:
    """Get all race (R) sessions for a given year."""
    client = OpenF1Client()
    return client.get_sessions(year=year, limit=100).filter(pl.col("session_type") == "R")


# ── Bronze ingestion ─────────────────────────────────────────────────────────


def ingest_session_bronze(
    session_key: int, year: int, event_name: str, session_type: str, output_dir: str = "data/bronze"
) -> dict[str, Path]:
    """Ingest all data for a session into the Bronze layer.

    Returns dict of endpoint → written file path.
    """
    client = OpenF1Client()
    bronze_path = (
        Path(output_dir) / f"year={year}" / f"event={event_name}" / f"session_type={session_type}"
    )
    bronze_path.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}

    # Sessions metadata
    sessions = client.get_sessions(session_key=session_key)
    fpath = bronze_path / "sessions.parquet"
    sessions.write_parquet(str(fpath))
    written["sessions"] = fpath

    # Drivers
    drivers = client.get_drivers(session_key=session_key)
    if not drivers.is_empty():
        fpath = bronze_path / "drivers.parquet"
        drivers.write_parquet(str(fpath))
        written["drivers"] = fpath

    # Car telemetry (per driver)
    all_car_data = []
    for dn in drivers["driver_number"].to_list() if not drivers.is_empty() else [1, 4, 16, 22, 33]:
        cd = client.get_car_data(session_key=session_key, driver_number=dn)
        if not cd.is_empty():
            all_car_data.append(cd)
    if all_car_data:
        combined = pl.concat(all_car_data, how="vertical")
        fpath = bronze_path / "car_data.parquet"
        combined.write_parquet(str(fpath))
        written["car_data"] = fpath

    # Location (coordinates)
    loc = client.get_location(session_key=session_key)
    if not loc.is_empty():
        fpath = bronze_path / "location.parquet"
        loc.write_parquet(str(fpath))
        written["location"] = fpath

    # Intervals
    intervals = client.get_intervals(session_key=session_key)
    if not intervals.is_empty():
        fpath = bronze_path / "intervals.parquet"
        intervals.write_parquet(str(fpath))
        written["intervals"] = fpath

    # Overtakes
    overtakes = client.get_overtakes(session_key=session_key)
    if not overtakes.is_empty():
        fpath = bronze_path / "overtakes.parquet"
        overtakes.write_parquet(str(fpath))
        written["overtakes"] = fpath

    # Laps
    laps = client.get_laps(session_key=session_key)
    if not laps.is_empty():
        fpath = bronze_path / "laps.parquet"
        laps.write_parquet(str(fpath))
        written["laps"] = fpath

    # Stints
    stints = client.get_stints(session_key=session_key)
    if not stints.is_empty():
        fpath = bronze_path / "stints.parquet"
        stints.write_parquet(str(fpath))
        written["stints"] = fpath

    # Pit stops
    pit = client.get_pit(session_key=session_key)
    if not pit.is_empty():
        fpath = bronze_path / "pit.parquet"
        pit.write_parquet(str(fpath))
        written["pit"] = fpath

    # Position
    pos = client.get_position(session_key=session_key)
    if not pos.is_empty():
        fpath = bronze_path / "position.parquet"
        pos.write_parquet(str(fpath))
        written["position"] = fpath

    # Weather
    weather = client.get_weather(session_key=session_key)
    if not weather.is_empty():
        fpath = bronze_path / "weather.parquet"
        weather.write_parquet(str(fpath))
        written["weather"] = fpath

    # Race control
    rc = client.get_race_control(session_key=session_key)
    if not rc.is_empty():
        fpath = bronze_path / "race_control.parquet"
        rc.write_parquet(str(fpath))
        written["race_control"] = fpath

    print(f"  Bronze session {session_key} → {bronze_path} ({len(written)} files)")
    return written


def ingest_season_bronze(year: int, output_dir: str = "data/bronze") -> list[dict[str, Path]]:
    """Ingest all race sessions for a given season."""
    OpenF1Client()
    sessions = get_latest_race_sessions(year)
    print(f"Found {sessions.height} race sessions for {year}")

    results = []
    for row in sessions.iter_rows(named=True):
        sk = row["session_key"]
        mk = row.get("meeting_key", sk)
        # circuit/location disambiguates races that all share session_name="Race"
        circuit = (
            row.get("circuit_short_name")
            or row.get("location")
            or row.get("country")
            or row.get("meeting_name")
            or row.get("session_name", "unknown")
        )
        event_raw = f"{mk}_{circuit}"
        event = event_raw.replace(" ", "_").replace("/", "-")
        st = row.get("session_type", "R")
        print(f"  Ingesting {row.get('session_name', 'Race')} at {circuit} (key={sk})...")
        written = ingest_session_bronze(sk, year, event, st, output_dir)
        results.append(written)

    return results
