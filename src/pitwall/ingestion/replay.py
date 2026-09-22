"""Replay historical lap data through the live race-state pipeline."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

import polars as pl

from pitwall.schemas.events import RaceEvent

ReplaySpeed = Literal["1x", "5x", "20x", "MAX", "STEP"] | float

SPEED_FACTORS: dict[str, float | None] = {
    "1x": 1.0,
    "5x": 5.0,
    "20x": 20.0,
    "MAX": None,
    "STEP": None,
}
_REPLAY_EPOCH = datetime(2000, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class ReplaySession:
    """One curated replayable session discovered from a bronze data bundle."""

    id: str
    path: Path
    season: int | None
    event: str
    session_type: str

    @property
    def label(self) -> str:
        season = str(self.season) if self.season is not None else "Historical"
        return f"{season} {self.event.replace('_', ' ')} · {self.session_type.replace('_', ' ')}"


def _catalog_id(relative_path: Path, occupied: set[str]) -> str:
    raw = "-".join(relative_path.parts).lower()
    base = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    candidate = base
    suffix = 2
    while candidate in occupied:
        candidate = f"{base}-{suffix}"
        suffix += 1
    occupied.add(candidate)
    return candidate


def discover_replay_sessions(root: Path | str) -> dict[str, ReplaySession]:
    """Discover real lap datasets without exposing their paths to API callers."""

    replay_root = Path(root)
    if not replay_root.is_dir():
        return {}

    sessions: dict[str, ReplaySession] = {}
    occupied: set[str] = set()
    for lap_file in sorted(replay_root.rglob("laps.parquet")):
        session_path = lap_file.parent
        relative = session_path.relative_to(replay_root)
        parts = {
            key: value
            for part in relative.parts
            if "=" in part
            for key, value in [part.split("=", 1)]
        }
        event = parts.get("event", "unknown")
        session_type = parts.get("session") or parts.get("session_type") or "unknown"
        season_raw = parts.get("season") or parts.get("year")
        try:
            season = int(season_raw) if season_raw is not None else None
        except ValueError:
            season = None
        replay_id = _catalog_id(relative, occupied)
        sessions[replay_id] = ReplaySession(
            id=replay_id,
            path=session_path,
            season=season,
            event=event,
            session_type=session_type,
        )
    return sessions


@dataclass
class ReplayConfig:
    bronze_path: Path | str
    speed: ReplaySpeed = "20x"
    loop: bool = False
    max_events: int | None = None


class ParquetReplaySource:
    """Replay one curated Bronze session in event-time order.

    The deployed data bundle contains canonical ``laps.parquet`` files. Legacy
    serialized ``events.parquet`` inputs remain readable for test fixtures and
    historical exports, but an empty source deliberately yields no events.
    """

    def __init__(self, config: ReplayConfig) -> None:
        self.config = config
        self._paused = False
        self._step_event = asyncio.Event()
        self._stop = False

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False
        self._step_event.set()

    def step(self) -> None:
        self._step_event.set()

    def stop(self) -> None:
        self._stop = True
        self._step_event.set()

    def set_speed(self, speed: ReplaySpeed) -> None:
        self.config.speed = speed

    def _resolve_speed_factor(self) -> float | None:
        speed = self.config.speed
        if isinstance(speed, (int, float)):
            return float(speed)
        return SPEED_FACTORS.get(str(speed).upper(), 1.0)

    def _files_named(self, filename: str) -> list[Path]:
        path = Path(self.config.bronze_path)
        if path.is_file() and path.name == filename:
            return [path]
        if not path.is_dir():
            return []
        return sorted(path.rglob(filename))

    @staticmethod
    def _int(value: Any) -> int | None:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _float(value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _event_time(row: dict[str, Any], ordinal: int) -> datetime:
        timestamp = row.get("LapStartDate") or row.get("date_start") or row.get("event_ts")
        if isinstance(timestamp, datetime):
            return timestamp.replace(tzinfo=timestamp.tzinfo or UTC)
        elapsed = row.get("Time")
        if isinstance(elapsed, timedelta):
            return _REPLAY_EPOCH + elapsed
        return _REPLAY_EPOCH + timedelta(milliseconds=ordinal)

    def _load_serialized_events(self, files: list[Path]) -> list[RaceEvent]:
        events: list[RaceEvent] = []
        for file in files:
            for ordinal, row in enumerate(pl.read_parquet(file).to_dicts()):
                try:
                    payload = row.get("payload", {})
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    if not isinstance(payload, dict):
                        continue
                    events.append(
                        RaceEvent(
                            source=str(row.get("source", "parquet_replay")),
                            event_type=row.get("event_type", "unknown"),
                            meeting_key=row.get("meeting_key"),
                            session_key=row.get("session_key"),
                            driver_number=self._int(row.get("driver_number")),
                            event_ts=self._event_time(row, ordinal),
                            ingest_ts=self._event_time(row, ordinal),
                            source_id=row.get("source_id"),
                            schema_version=self._int(row.get("schema_version")) or 1,
                            payload=payload,
                        )
                    )
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
        return events

    def _load_lap_events(self, files: list[Path]) -> list[RaceEvent]:
        rows: list[tuple[Path, dict[str, Any]]] = []
        for file in files:
            for row in pl.read_parquet(file).to_dicts():
                if (
                    self._int(row.get("driver_number")) is not None
                    and self._int(row.get("lap_number")) is not None
                ):
                    rows.append((file, row))

        def event_key(item: tuple[Path, dict[str, Any]]) -> tuple[datetime, int, int]:
            _, row = item
            return (
                self._event_time(row, 0),
                self._int(row.get("lap_number")) or 0,
                self._int(row.get("driver_number")) or 0,
            )

        events: list[RaceEvent] = []
        for ordinal, (file, row) in enumerate(sorted(rows, key=event_key)):
            driver_number = self._int(row.get("driver_number"))
            lap_number = self._int(row.get("lap_number"))
            if driver_number is None or lap_number is None:
                continue
            payload = {
                "lap_number": lap_number,
                "lap_time_s": self._float(row.get("lap_time_s")),
                "compound": row.get("compound"),
                "tyre_age": self._int(row.get("tyre_age")),
                "position": self._int(row.get("position")),
                "stint": self._int(row.get("stint_no")),
                "team": row.get("team_id"),
                "track_status": row.get("track_status"),
            }
            events.append(
                RaceEvent(
                    source="bronze_laps",
                    event_type="lap",
                    meeting_key=file.parent.parent.name,
                    session_key=row.get("session_id") or file.parent.name,
                    driver_number=driver_number,
                    event_ts=self._event_time(row, ordinal),
                    ingest_ts=self._event_time(row, ordinal),
                    source_id=f"{file.name}:{ordinal}",
                    schema_version=1,
                    payload={key: value for key, value in payload.items() if value is not None},
                )
            )
        return events

    def _load_events(self) -> list[RaceEvent]:
        serialized_files = self._files_named("events.parquet")
        if serialized_files:
            events = self._load_serialized_events(serialized_files)
        else:
            events = self._load_lap_events(self._files_named("laps.parquet"))
        if self.config.max_events is not None:
            return events[: self.config.max_events]
        return events

    async def events(self) -> AsyncIterator[RaceEvent]:
        stored = self._load_events()
        if not stored:
            return

        factor = self._resolve_speed_factor()
        is_max = factor is None and str(self.config.speed).upper() == "MAX"
        is_step = str(self.config.speed).upper() == "STEP"
        previous_timestamp = stored[0].event_ts

        for event in stored:
            if self._stop:
                return
            while self._paused and not is_step:
                await asyncio.sleep(0.1)
                if self._stop:
                    return
            if is_step:
                await self._step_event.wait()
                self._step_event.clear()
                if self._stop:
                    return
            if not is_max and not is_step:
                assert factor is not None
                delay = (event.event_ts - previous_timestamp).total_seconds() / factor
                if delay > 0:
                    await asyncio.sleep(min(delay, 0.5))
            previous_timestamp = event.event_ts
            yield event
