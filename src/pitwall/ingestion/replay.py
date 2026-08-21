"""Replay engine — streams historical events through the live pipeline.

Supports modes:
  1×, 5×, 20×, MAX (no sleep), STEP (manual advance)
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import polars as pl

from pitwall.schemas.events import RaceEvent

ReplaySpeed = Literal["1x", "5x", "20x", "MAX", "STEP"] | float


SPEED_FACTORS: dict[str, float | None] = {
    "1x": 1.0,
    "5x": 5.0,
    "20x": 20.0,
    "MAX": None,  # no sleep
    "STEP": None,
}


@dataclass
class ReplayConfig:
    bronze_path: Path | str
    speed: ReplaySpeed = "20x"
    session_filter: str | None = None  # e.g. "2025_Monaco_R"
    loop: bool = False
    max_events: int | None = None


class ParquetReplaySource:
    """Replays Bronze Parquet events in event-time order.

    Bronze layout expected:
      data/bronze/openf1/season=2025/event=.../session=.../topic=.../*.parquet
    or flat:
      data/bronze/events.parquet

    Each row must contain at least: source, event_type, event_ts, payload (json/str)
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
        s = self.config.speed
        if isinstance(s, (int, float)):
            return float(s)
        key = str(s).upper()
        # normalize "20X" -> "20x"
        key = key.lower() if key.lower() in SPEED_FACTORS else key
        # handle "20x" vs "20X"
        for k, v in SPEED_FACTORS.items():
            if k.lower() == str(s).lower():
                return v
        return 1.0

    def _load_events(self) -> list[RaceEvent]:
        path = Path(self.config.bronze_path)
        if not path.exists():
            return []

        # Collect parquet files
        if path.is_file() and path.suffix == ".parquet":
            files = [path]
        else:
            files = list(path.rglob("*.parquet"))

        if not files:
            return []

        lf = pl.scan_parquet([str(f) for f in files])
        # Optional session filter
        if self.config.session_filter:
            # naive: filter if column exists
            try:
                lf = lf.filter(pl.col("session_id") == self.config.session_filter)
            except Exception:
                pass

        df = lf.sort("event_ts").collect()
        if self.config.max_events:
            df = df.head(self.config.max_events)

        events: list[RaceEvent] = []
        for row in df.to_dicts():
            try:
                # payload may be json string
                payload = row.get("payload", {})
                if isinstance(payload, str):
                    import json

                    payload = json.loads(payload)
                events.append(
                    RaceEvent(
                        source=row.get("source", "parquet_replay"),
                        event_type=row.get("event_type", "unknown"),
                        meeting_key=row.get("meeting_key"),
                        session_key=row.get("session_key"),
                        driver_number=row.get("driver_number"),
                        event_ts=row.get("event_ts", datetime.now(UTC)),
                        ingest_ts=row.get("ingest_ts", datetime.now(UTC)),
                        source_id=row.get("source_id"),
                        schema_version=row.get("schema_version", 1),
                        payload=payload if isinstance(payload, dict) else {},
                    )
                )
            except Exception:
                continue
        return events

    async def events(self) -> AsyncIterator[RaceEvent]:
        stored = self._load_events()
        if not stored:
            # Emit synthetic demo events if no data yet (so V1 UI works without ingestion)
            async for e in self._demo_events():
                if self._stop:
                    break
                yield e
            return

        factor = self._resolve_speed_factor()
        is_max = factor is None and str(self.config.speed).upper() == "MAX"
        is_step = str(self.config.speed).upper() == "STEP"

        prev_ts = stored[0].event_ts if stored else None
        for ev in stored:
            if self._stop:
                break

            # handle pause/step
            while self._paused and not is_step:
                await asyncio.sleep(0.1)
                if self._stop:
                    return

            if is_step:
                await self._step_event.wait()
                self._step_event.clear()
                if self._stop:
                    return

            # sleep based on event-time delta
            if not is_max and prev_ts is not None and not is_step:
                assert factor is not None
                delta = (ev.event_ts - prev_ts).total_seconds() / factor
                if delta > 0:
                    # cap sleep to avoid huge gaps in demo (e.g. between sessions)
                    delta = min(delta, 0.5)
                    await asyncio.sleep(delta)

            prev_ts = ev.event_ts
            yield ev

            if self.config.loop and ev == stored[-1]:
                prev_ts = None

    async def _demo_events(self) -> AsyncIterator[RaceEvent]:
        """Synthetic events so the dashboard is demonstrable before real ingestion."""
        import random

        drivers = [1, 4, 16, 55, 63, 44, 81, 11, 14, 18]
        base = datetime.now(UTC)
        # Simulate 66 laps
        for lap in range(1, 67):
            for dn in drivers:
                ev = RaceEvent(
                    source="demo",
                    event_type="lap",
                    meeting_key="demo_2025_monaco",
                    session_key="R",
                    driver_number=dn,
                    event_ts=base,
                    payload={
                        "lap_number": lap,
                        "lap_time_s": round(
                            random.uniform(78.5, 82.0) + random.uniform(-0.3, 0.5), 3
                        ),
                        "compound": random.choice(["SOFT", "MEDIUM", "HARD"]),
                        "tyre_age": lap % 25,
                        "position": drivers.index(dn) + 1,
                    },
                )
                yield ev
            await asyncio.sleep(0.05 if str(self.config.speed).upper() != "MAX" else 0)
