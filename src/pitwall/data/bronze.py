"""Bronze storage — source-faithful, append-only Parquet."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import polars as pl

from pitwall.regulations import get_era_for_season
from pitwall.schemas.events import RaceEvent


def _extract_season(session_id: str | None) -> int | None:
    """Extract the season year from a session_id like '2026_Monaco_R'."""
    if not session_id:
        return None
    for part in session_id.split("_"):
        try:
            return int(part)
        except ValueError:
            continue
    return None


def _era_from_session(session_id: str | None, season: int | None = None) -> str:
    """Derive regulation era from session_id or season."""
    if season is None:
        season = _extract_season(session_id)
    if season is None:
        return "unknown"
    return get_era_for_season(season)


BRONZE_SCHEMA = {
    "source": pl.Utf8,
    "event_type": pl.Utf8,
    "event_ts": pl.Datetime("us", "UTC"),
    "ingest_ts": pl.Datetime("us", "UTC"),
    "meeting_key": pl.Utf8,
    "session_key": pl.Utf8,
    "driver_number": pl.Int64,
    "source_id": pl.Utf8,
    "schema_version": pl.Int64,
    "raw_payload": pl.Utf8,  # json
    # Derived columns for era-aware pipelines
    "season": pl.Int64,
    "regulation_era": pl.Utf8,
}


def events_to_bronze_df(events: list[RaceEvent]) -> pl.DataFrame:
    rows = []
    for e in events:
        _season = _extract_season(e.source_id) or _extract_season(str(e.meeting_key))
        rows.append(
            {
                "source": e.source,
                "event_type": str(
                    e.event_type.value if hasattr(e.event_type, "value") else e.event_type
                ),
                "event_ts": e.event_ts,
                "ingest_ts": e.ingest_ts,
                "meeting_key": str(e.meeting_key) if e.meeting_key is not None else None,
                "session_key": str(e.session_key) if e.session_key is not None else None,
                "driver_number": e.driver_number,
                "source_id": e.source_id,
                "schema_version": e.schema_version,
                "raw_payload": json.dumps(e.payload, default=str),
                "season": _season,
                "regulation_era": _era_from_session(e.source_id, _season),
            }
        )
    if not rows:
        return pl.DataFrame(schema=BRONZE_SCHEMA)
    return pl.DataFrame(rows).with_columns(
        pl.col("event_ts").dt.replace_time_zone("UTC"),
        pl.col("ingest_ts").dt.replace_time_zone("UTC"),
    )


def write_bronze(
    events: list[RaceEvent], bronze_root: Path | str, partition_cols: list[str] | None = None
) -> Path:
    """Write events to partitioned Bronze Parquet.

    Partitioning: season=.../event=.../session=.../topic=...
    For V1 we use a simple flat write if partition info not in payload.
    """
    df = events_to_bronze_df(events)
    root = Path(bronze_root)
    root.mkdir(parents=True, exist_ok=True)

    # Try to infer season partition from first event meeting_key
    out = root / f"ingest_date={datetime.now(UTC).date()}" / "events.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(str(out))
    return out


def read_bronze(bronze_root: Path | str) -> pl.LazyFrame:
    root = Path(bronze_root)
    files = list(root.rglob("*.parquet"))
    if not files:
        return pl.LazyFrame(schema=BRONZE_SCHEMA)
    return pl.scan_parquet([str(f) for f in files])
