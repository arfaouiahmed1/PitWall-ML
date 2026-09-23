"""Unit tests for micro-batched Bronze Parquet writer and replay discovery."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import polars as pl
import pytest

from pitwall.ingestion.replay import ParquetReplaySource, ReplayConfig, discover_replay_sessions
from pitwall.schemas.events import EventType, RaceEvent
from pitwall.storage.parquet_writer import ParquetPartitionWriter


def _create_event(
    seq: int = 1,
    event_type: EventType | str = EventType.LAP,
    driver_number: int | None = 44,
    dt: datetime | None = None,
    payload: dict | None = None,
) -> RaceEvent:
    event_time = dt or (datetime(2026, 3, 1, 14, 0, 0, tzinfo=UTC) + timedelta(seconds=seq))
    return RaceEvent(
        source="openf1",
        event_type=event_type,
        meeting_key="9999",
        session_key="2026",
        driver_number=driver_number,
        event_ts=event_time,
        ingest_ts=event_time,
        source_id=f"evt_{seq}",
        payload=payload if payload is not None else {"lap_number": seq, "lap_time_s": 80.0 + seq},
    )


def test_parquet_writer_initialization(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(
        session_id="test_session",
        base_dir=tmp_path / "live",
        max_buffer_size=10,
        max_buffer_seconds=5.0,
    )
    assert writer.session_id == "test_session"
    assert writer.session_dir == tmp_path / "live" / "test_session"
    assert writer.session_dir.is_dir()
    assert writer.buffer_size == 0
    assert writer.sequence == 0
    assert writer.total_events_written == 0
    assert not writer.is_closed

    with pytest.raises(ValueError, match="session_id cannot be empty"):
        ParquetPartitionWriter(session_id="", base_dir=tmp_path)

    with pytest.raises(ValueError, match="max_buffer_size must be positive"):
        ParquetPartitionWriter(session_id="s", max_buffer_size=0, base_dir=tmp_path)

    with pytest.raises(ValueError, match="max_buffer_seconds must be positive"):
        ParquetPartitionWriter(session_id="s", max_buffer_seconds=-1.0, base_dir=tmp_path)


def test_buffer_size_trigger_flush(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(
        session_id="batch_test",
        base_dir=tmp_path,
        max_buffer_size=5,
        max_buffer_seconds=100.0,
    )

    for i in range(1, 5):
        flushed = writer.write_event(_create_event(seq=i))
        assert not flushed
        assert writer.buffer_size == i

    flushed = writer.write_event(_create_event(seq=5))
    assert flushed
    assert writer.buffer_size == 0
    assert writer.sequence == 1
    assert writer.total_events_written == 5

    part_0 = writer.session_dir / "part-0.parquet"
    assert part_0.is_file()

    df = pl.read_parquet(part_0)
    assert len(df) == 5
    assert "source" in df.columns
    assert "event_type" in df.columns
    assert "meeting_key" in df.columns
    assert "session_key" in df.columns
    assert "driver_number" in df.columns
    assert "event_ts" in df.columns
    assert "ingest_ts" in df.columns
    assert "payload" in df.columns
    assert "payload_json" in df.columns

    assert df["driver_number"].to_list() == [44] * 5
    assert df["event_type"].to_list() == ["lap"] * 5


def test_parquet_round_trip_preserves_source_and_receive_timestamps(tmp_path: Path) -> None:
    source_time = datetime(2026, 3, 1, 14, 0, tzinfo=UTC)
    received_time = datetime(2026, 3, 1, 14, 0, 20, tzinfo=UTC)
    event = RaceEvent(
        source="openf1",
        event_type=EventType.POSITION,
        event_ts=source_time,
        ingest_ts=received_time,
        source_id="99",
        payload={
            "observed_at": source_time.isoformat(),
            "received_at": received_time.isoformat(),
            "data_age_seconds": 20.0,
            "stale": True,
            "provenance": "OPENF1",
        },
    )
    writer = ParquetPartitionWriter(session_id="timestamps", base_dir=tmp_path, max_buffer_size=1)

    writer.write_event(event)
    stored = pl.read_parquet(tmp_path / "timestamps" / "part-0.parquet").row(0, named=True)

    assert stored["event_ts"] == source_time
    assert stored["ingest_ts"] == received_time
    assert stored["source_id"] == "99"
    assert '"observed_at": "2026-03-01T14:00:00+00:00"' in stored["payload"]
    assert '"stale": true' in stored["payload"]


def test_buffer_time_trigger_flush(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(
        session_id="time_test",
        base_dir=tmp_path,
        max_buffer_size=100,
        max_buffer_seconds=0.05,
    )

    flushed = writer.write_event(_create_event(seq=1))
    assert not flushed

    import time

    time.sleep(0.07)

    flushed = writer.write_event(_create_event(seq=2))
    assert flushed
    assert writer.buffer_size == 0
    assert writer.sequence == 1
    assert writer.total_events_written == 2

    part_0 = writer.session_dir / "part-0.parquet"
    assert part_0.is_file()
    df = pl.read_parquet(part_0)
    assert len(df) == 2


def test_flush_empty_buffer_returns_none(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(session_id="empty_test", base_dir=tmp_path)
    result = writer.flush()
    assert result is None
    assert list(writer.session_dir.glob("*.parquet")) == []


def test_write_events_batch(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(
        session_id="batch_multi",
        base_dir=tmp_path,
        max_buffer_size=5,
        max_buffer_seconds=100.0,
    )

    events = [_create_event(seq=i) for i in range(1, 13)]
    flushes = writer.write_events(events)

    assert flushes == 2
    assert writer.sequence == 2
    assert writer.buffer_size == 2
    assert writer.total_events_written == 10

    close_path = writer.close()
    assert close_path is not None
    assert close_path.name == "part-2.parquet"
    assert writer.sequence == 3
    assert writer.total_events_written == 12
    assert writer.buffer_size == 0
    assert writer.is_closed

    assert (writer.session_dir / "part-0.parquet").is_file()
    assert (writer.session_dir / "part-1.parquet").is_file()
    assert (writer.session_dir / "part-2.parquet").is_file()


def test_closed_writer_raises_on_write(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(session_id="closed_test", base_dir=tmp_path)
    writer.close()
    assert writer.is_closed

    with pytest.raises(RuntimeError, match="Cannot write to closed"):
        writer.write_event(_create_event(seq=1))


def test_context_manager(tmp_path: Path) -> None:
    with ParquetPartitionWriter(
        session_id="cm_test", base_dir=tmp_path, max_buffer_size=10
    ) as writer:
        writer.write_event(_create_event(seq=1))
        assert writer.buffer_size == 1

    assert writer.is_closed
    part_0 = writer.session_dir / "part-0.parquet"
    assert part_0.is_file()
    assert len(pl.read_parquet(part_0)) == 1


def test_finalize_session_consolidation(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(
        session_id="final_test",
        base_dir=tmp_path,
        max_buffer_size=3,
        max_buffer_seconds=100.0,
    )

    for i in range(1, 10):
        writer.write_event(_create_event(seq=i))

    assert writer.sequence == 3
    final_path = writer.finalize_session(cleanup_partitions=False)
    assert final_path is not None
    assert final_path == writer.session_dir / "events.parquet"
    assert final_path.is_file()

    assert (writer.session_dir / "part-0.parquet").is_file()
    assert (writer.session_dir / "part-1.parquet").is_file()
    assert (writer.session_dir / "part-2.parquet").is_file()

    df = pl.read_parquet(final_path)
    assert len(df) == 9
    assert df["source_id"].to_list() == [f"evt_{i}" for i in range(1, 10)]


def test_finalize_session_with_cleanup(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(
        session_id="cleanup_test",
        base_dir=tmp_path,
        max_buffer_size=2,
        max_buffer_seconds=100.0,
    )

    for i in range(1, 5):
        writer.write_event(_create_event(seq=i))

    final_path = writer.finalize_session(cleanup_partitions=True)
    assert final_path is not None
    assert final_path.is_file()
    assert len(pl.read_parquet(final_path)) == 4

    assert list(writer.session_dir.glob("part-*.parquet")) == []


def test_finalize_empty_session_returns_none(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(session_id="empty_final", base_dir=tmp_path)
    assert writer.finalize_session() is None


def test_schema_normalization_and_timezones(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(session_id="tz_test", base_dir=tmp_path)

    # 1. Naive datetime
    naive_dt = datetime(2026, 3, 1, 10, 0, 0)
    ev_naive = _create_event(seq=1, dt=naive_dt)

    # 2. Non-UTC timezone (e.g. UTC+4)
    tz_plus_4 = timezone(timedelta(hours=4))
    tz_dt = datetime(2026, 3, 1, 14, 0, 0, tzinfo=tz_plus_4)
    ev_tz = _create_event(seq=2, dt=tz_dt)

    # 3. None driver number and null meeting/session keys
    ev_nulls = RaceEvent(
        source="openf1",
        event_type="weather",
        meeting_key=None,
        session_key=None,
        driver_number=None,
        event_ts=datetime(2026, 3, 1, 10, 5, 0, tzinfo=UTC),
        payload={"rainfall": 0, "air_temperature": 24.5},
    )

    writer.write_events([ev_naive, ev_tz, ev_nulls])
    part = writer.flush()
    assert part is not None

    df = pl.read_parquet(part)
    assert len(df) == 3

    # All timestamps must be UTC in Polars
    assert df["event_ts"].dtype == pl.Datetime("us", "UTC")
    assert df["ingest_ts"].dtype == pl.Datetime("us", "UTC")

    dicts = df.to_dicts()
    assert dicts[0]["event_ts"].tzinfo is not None
    # 14:00 in UTC+4 corresponds to 10:00 UTC
    assert dicts[1]["event_ts"].hour == 10
    assert dicts[2]["driver_number"] is None
    assert dicts[2]["meeting_key"] is None


def test_resume_sequence_numbering(tmp_path: Path) -> None:
    base = tmp_path / "live"
    writer1 = ParquetPartitionWriter(session_id="resume_session", base_dir=base, max_buffer_size=2)
    writer1.write_events([_create_event(seq=1), _create_event(seq=2)])
    writer1.close()

    assert (base / "resume_session" / "part-0.parquet").is_file()

    # Re-instantiate writer for the same session
    writer2 = ParquetPartitionWriter(session_id="resume_session", base_dir=base, max_buffer_size=2)
    assert writer2.sequence == 1
    writer2.write_events([_create_event(seq=3), _create_event(seq=4)])
    writer2.close()

    assert (base / "resume_session" / "part-1.parquet").is_file()
    assert writer2.total_events_written == 2


def test_discover_replay_sessions_live_session(tmp_path: Path) -> None:
    live_root = tmp_path / "data" / "bronze"
    writer = ParquetPartitionWriter(session_id="melbourne_2026", base_dir=live_root / "live")
    events = [_create_event(seq=i) for i in range(1, 6)]
    writer.write_events(events)
    writer.finalize_session()

    catalog = discover_replay_sessions(live_root)
    assert len(catalog) == 1
    session = next(iter(catalog.values()))

    assert session.path == live_root / "live" / "melbourne_2026"
    assert session.is_live is True
    assert session.label == "[LIVE-RECORDED]"


def test_discover_replay_sessions_unfinalized_partitions(tmp_path: Path) -> None:
    live_root = tmp_path / "data" / "bronze"
    writer = ParquetPartitionWriter(
        session_id="in_progress_session",
        base_dir=live_root / "live",
        max_buffer_size=2,
    )
    writer.write_events([_create_event(seq=1), _create_event(seq=2)])
    # Do not call finalize_session, only part-0.parquet exists

    catalog = discover_replay_sessions(live_root)
    assert len(catalog) == 1
    session = next(iter(catalog.values()))
    assert session.is_live is True
    assert session.label == "[LIVE-RECORDED]"


@pytest.mark.asyncio
async def test_parquet_replay_source_with_events_parquet(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(session_id="replay_compat", base_dir=tmp_path)
    writer.write_events([_create_event(seq=i) for i in range(1, 4)])
    writer.finalize_session()

    source = ParquetReplaySource(ReplayConfig(bronze_path=writer.session_dir, speed="MAX"))
    replayed = [event async for event in source.events()]

    assert len(replayed) == 3
    assert [e.payload["lap_number"] for e in replayed] == [1, 2, 3]
    assert all(e.driver_number == 44 for e in replayed)


@pytest.mark.asyncio
async def test_parquet_replay_source_with_partitions(tmp_path: Path) -> None:
    writer = ParquetPartitionWriter(session_id="parts_compat", base_dir=tmp_path, max_buffer_size=2)
    writer.write_events([_create_event(seq=i) for i in range(1, 5)])
    # 2 partition files created, no events.parquet

    source = ParquetReplaySource(ReplayConfig(bronze_path=writer.session_dir, speed="MAX"))
    replayed = [event async for event in source.events()]

    assert len(replayed) == 4
    assert [e.payload["lap_number"] for e in replayed] == [1, 2, 3, 4]
