"""FastF1 adapter — historical training data.

FastF1 returns Pandas DataFrames; we convert to Polars at the boundary and
emit Bronze RaceEvents or directly build Silver tables.

Requires: pip install fastf1
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from pitwall.schemas.events import RaceEvent


def fetch_session_laps_polars(season: int, event: str, session: str = "R"):
    """Fetch laps via FastF1 and return Polars DataFrame.

    Callers should handle FastF1 not installed / cache miss gracefully.
    """
    try:
        import fastf1  # type: ignore[import-not-found]
        import polars as pl
    except ImportError as e:
        raise ImportError("fastf1 not installed. Run pip install -e '.[ml]'") from e

    # Enable cache if not already
    cache_dir = Path("data/.fastf1_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(Exception):
        fastf1.Cache.enable_cache(str(cache_dir))

    sess = fastf1.get_session(season, event, session)
    sess.load(telemetry=False, weather=False)

    laps = sess.laps  # pandas
    if laps is None or len(laps) == 0:
        raise ValueError(f"No laps found for {season} {event} {session}")

    # Convert to polars at boundary
    import polars as pl

    df = pl.from_pandas(laps)

    # Normalize minimal columns if present
    return df, sess


class FastF1ReplaySource:
    """Yields RaceEvents from FastF1 historical session."""

    def __init__(self, season: int, event: str, session: str = "R") -> None:
        self.season = season
        self.event = event
        self.session = session

    async def events(self) -> AsyncIterator[RaceEvent]:
        try:
            df, sess = await asyncio.to_thread(
                fetch_session_laps_polars, self.season, self.event, self.session
            )
        except Exception as e:
            raise RuntimeError(f"FastF1 fetch failed: {e}") from e

        # Try to extract session keys
        meeting_key = (
            getattr(sess, "event", {}).get("EventName", f"{self.season}_{self.event}")
            if hasattr(sess, "event")
            else f"{self.season}_{self.event}"
        )
        session_key = self.session

        for row in df.to_dicts():
            lap_time = row.get("LapTime")
            # LapTime may be timedelta
            lap_s = None
            if lap_time is not None:
                try:
                    lap_s = (
                        float(lap_time.total_seconds())
                        if hasattr(lap_time, "total_seconds")
                        else float(lap_time)
                    )
                except Exception:
                    lap_s = None

            # Event timestamp: use LapStartTime if available, else now
            ts = row.get("LapStartTime") or row.get("Time")
            if ts is not None and hasattr(ts, "to_pydatetime"):
                try:
                    event_ts = ts.to_pydatetime()
                    if event_ts.tzinfo is None:
                        event_ts = event_ts.replace(tzinfo=UTC)
                except Exception:
                    event_ts = datetime.now(UTC)
            else:
                event_ts = datetime.now(UTC)

            driver_no = row.get("DriverNumber")
            try:
                driver_no = int(driver_no) if driver_no is not None else None
            except Exception:
                driver_no = None

            yield RaceEvent(
                source="fastf1",
                event_type="lap",
                meeting_key=str(meeting_key),
                session_key=session_key,
                driver_number=driver_no,
                event_ts=event_ts,
                payload={
                    "lap_number": row.get("LapNumber"),
                    "lap_time_s": lap_s,
                    "compound": row.get("Compound"),
                    "tyre_life": row.get("TyreLife"),
                    "stint": row.get("Stint"),
                    "position": row.get("Position"),
                    "track_status": row.get("TrackStatus"),
                    "is_pit_in": bool(row.get("PitInTime") is not None)
                    if "PitInTime" in row
                    else False,
                    "is_pit_out": bool(row.get("PitOutTime") is not None)
                    if "PitOutTime" in row
                    else False,
                    "driver": row.get("Driver"),
                    "team": row.get("Team"),
                },
            )
            await asyncio.sleep(0)
