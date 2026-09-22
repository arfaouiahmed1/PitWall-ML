from datetime import UTC, datetime, timedelta
from pathlib import Path

import polars as pl
import pytest

from pitwall.ingestion.replay import ParquetReplaySource, ReplayConfig, discover_replay_sessions


def _write_laps(root: Path, count: int = 10) -> Path:
    session_dir = root / "season=2024" / "event=Spanish_Grand_Prix" / "session=R"
    session_dir.mkdir(parents=True)
    started = datetime(2024, 6, 23, tzinfo=UTC)
    pl.DataFrame(
        {
            "driver_number": [4] * count,
            "lap_number": list(range(1, count + 1)),
            "lap_time_s": [80.0 + lap / 100 for lap in range(count)],
            "compound": ["MEDIUM"] * count,
            "tyre_age": list(range(1, count + 1)),
            "position": [1] * count,
            "stint_no": [1] * count,
            "team_id": ["McLaren"] * count,
            "LapStartDate": [started + timedelta(seconds=lap * 80) for lap in range(count)],
        }
    ).write_parquet(session_dir / "laps.parquet")
    return session_dir


@pytest.mark.asyncio
async def test_parquet_replay_empty_yields_no_generated_events(tmp_path: Path):
    source = ParquetReplaySource(ReplayConfig(bronze_path=tmp_path, speed="MAX"))
    assert [event async for event in source.events()] == []


@pytest.mark.asyncio
async def test_parquet_replay_uses_real_lap_rows_in_time_order(tmp_path: Path):
    session_dir = _write_laps(tmp_path)
    source = ParquetReplaySource(ReplayConfig(bronze_path=session_dir, speed="MAX"))

    events = [event async for event in source.events()]

    assert [event.payload["lap_number"] for event in events] == list(range(1, 11))
    assert all(event.source == "bronze_laps" for event in events)
    assert all(event.payload["lap_time_s"] >= 80 for event in events)


def test_discover_replay_sessions_uses_opaque_catalog_ids(tmp_path: Path):
    session_dir = _write_laps(tmp_path, count=1)

    catalog = discover_replay_sessions(tmp_path)

    assert len(catalog) == 1
    replay = next(iter(catalog.values()))
    assert replay.path == session_dir
    assert replay.id != str(session_dir)
    assert replay.label == "2024 Spanish Grand Prix · R"
