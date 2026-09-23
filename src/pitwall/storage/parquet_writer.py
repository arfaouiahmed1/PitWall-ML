"""Micro-batched Bronze Parquet Writer with Replay Finalizer.

Buffers incoming canonical RaceEvent objects in memory and flushes them to disk
as partitioned Parquet files (`data/bronze/live/{session_id}/part-{seq}.parquet`).
On session stop or checkpoint, consolidates partitions into
`data/bronze/live/{session_id}/events.parquet` for seamless replay discovery.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections.abc import Sequence
from datetime import UTC
from pathlib import Path
from typing import Any

import polars as pl

from pitwall.schemas.events import RaceEvent

logger = logging.getLogger(__name__)

EVENT_SCHEMA = {
    "source": pl.Utf8,
    "event_type": pl.Utf8,
    "meeting_key": pl.Utf8,
    "session_key": pl.Utf8,
    "driver_number": pl.Int64,
    "event_ts": pl.Datetime("us", "UTC"),
    "ingest_ts": pl.Datetime("us", "UTC"),
    "source_id": pl.Utf8,
    "source_key": pl.Utf8,
    "schema_version": pl.Int32,
    "payload": pl.Utf8,
    "payload_json": pl.Utf8,
}


def _normalize_event_dict(event: RaceEvent) -> dict[str, Any]:
    """Normalize a RaceEvent instance into a primitive dict matching EVENT_SCHEMA."""
    event_ts = (
        event.event_ts.replace(tzinfo=UTC)
        if event.event_ts.tzinfo is None
        else event.event_ts.astimezone(UTC)
    )

    ingest_ts = (
        event.ingest_ts.replace(tzinfo=UTC)
        if event.ingest_ts.tzinfo is None
        else event.ingest_ts.astimezone(UTC)
    )

    event_type_str = str(event.event_type)

    payload_str = json.dumps(event.payload, default=str)

    return {
        "source": str(event.source),
        "event_type": event_type_str,
        "meeting_key": str(event.meeting_key) if event.meeting_key is not None else None,
        "session_key": str(event.session_key) if event.session_key is not None else None,
        "driver_number": int(event.driver_number) if event.driver_number is not None else None,
        "event_ts": event_ts,
        "ingest_ts": ingest_ts,
        "source_id": str(event.source_id) if event.source_id is not None else None,
        "source_key": str(event.source_key) if event.source_key is not None else None,
        "schema_version": int(event.schema_version) if event.schema_version is not None else 1,
        "payload": payload_str,
        "payload_json": payload_str,
    }


class ParquetPartitionWriter:
    """Micro-batched partitioned Parquet writer for bronze live ingestion.

    Buffers incoming `RaceEvent` objects in memory and flushes them to disk as
    `part-{seq}.parquet` files when either `max_buffer_size` events are reached
    or `max_buffer_seconds` has elapsed since the previous flush.
    """

    def __init__(
        self,
        session_id: str,
        base_dir: Path | str = "data/bronze/live",
        max_buffer_size: int = 500,
        max_buffer_seconds: float = 30.0,
        start_seq: int | None = None,
    ) -> None:
        if not session_id:
            raise ValueError("session_id cannot be empty")
        if max_buffer_size <= 0:
            raise ValueError("max_buffer_size must be positive")
        if max_buffer_seconds <= 0:
            raise ValueError("max_buffer_seconds must be positive")

        self.session_id = str(session_id)
        self.base_dir = Path(base_dir)
        self.session_dir = self.base_dir / self.session_id
        self.max_buffer_size = max_buffer_size
        self.max_buffer_seconds = float(max_buffer_seconds)

        self.session_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        self._buffer: list[RaceEvent] = []
        self._last_flush_time = time.monotonic()
        self._closed = False
        self._total_events_written = 0
        self._flushed_files: list[Path] = []

        if start_seq is not None:
            self._seq = start_seq
        else:
            self._seq = self._detect_next_seq()

    def _detect_next_seq(self) -> int:
        part_files = list(self.session_dir.glob("part-*.parquet"))
        if not part_files:
            return 0
        max_seq = -1
        for pf in part_files:
            match = re.search(r"part-(\d+)\.parquet", pf.name)
            if match:
                seq_val = int(match.group(1))
                if seq_val > max_seq:
                    max_seq = seq_val
        return max_seq + 1

    @property
    def buffer_size(self) -> int:
        """Current count of in-memory buffered events."""
        with self._lock:
            return len(self._buffer)

    @property
    def sequence(self) -> int:
        """Current partition sequence number."""
        with self._lock:
            return self._seq

    @property
    def total_events_written(self) -> int:
        """Total number of events flushed to disk in this writer session."""
        with self._lock:
            return self._total_events_written

    @property
    def is_closed(self) -> bool:
        """Whether the writer has been closed."""
        with self._lock:
            return self._closed

    @property
    def flushed_files(self) -> list[Path]:
        """List of partition files flushed during this instance lifecycle."""
        with self._lock:
            return list(self._flushed_files)

    def write_event(self, event: RaceEvent) -> bool:
        """Buffer an incoming RaceEvent and flush if batch triggers are met.

        Returns:
            True if a flush occurred, False otherwise.
        """
        with self._lock:
            if self._closed:
                raise RuntimeError(
                    f"Cannot write to closed ParquetPartitionWriter for session {self.session_id}"
                )
            self._buffer.append(event)
            now = time.monotonic()
            size_trigger = len(self._buffer) >= self.max_buffer_size
            time_trigger = (now - self._last_flush_time) >= self.max_buffer_seconds
            if size_trigger or time_trigger:
                self.flush()
                return True
            return False

    def write_events(self, events: Sequence[RaceEvent]) -> int:
        """Buffer multiple RaceEvents, flushing whenever thresholds are reached.

        Returns:
            Number of flushes that occurred during ingestion.
        """
        flushes = 0
        with self._lock:
            for event in events:
                if self.write_event(event):
                    flushes += 1
        return flushes

    def flush(self) -> Path | None:
        """Flush buffered events to a new partitioned Parquet file.

        Returns:
            Path of written partition file, or None if buffer was empty.
        """
        with self._lock:
            if not self._buffer:
                self._last_flush_time = time.monotonic()
                return None

            records = [_normalize_event_dict(e) for e in self._buffer]
            df = pl.DataFrame(records, schema=EVENT_SCHEMA)

            part_path = self.session_dir / f"part-{self._seq}.parquet"
            df.write_parquet(part_path)

            self._seq += 1
            self._last_flush_time = time.monotonic()
            self._total_events_written += len(self._buffer)
            self._flushed_files.append(part_path)
            self._buffer.clear()

            logger.debug("Flushed %d events to %s", len(records), part_path)
            return part_path

    def close(self) -> Path | None:
        """Close the writer, flushing any remaining buffered events."""
        with self._lock:
            if self._closed:
                return None
            path = self.flush()
            self._closed = True
            return path

    def finalize_session(self, cleanup_partitions: bool = False) -> Path | None:
        """Consolidate all partition files into a canonical events.parquet file.

        Flushes any pending in-memory events first. If no partitions exist and
        events.parquet does not exist, returns None.

        Args:
            cleanup_partitions: If True, removes individual part-*.parquet files
                               after successful consolidation.

        Returns:
            Path to the consolidated events.parquet file, or None if no events exist.
        """
        with self._lock:
            self.flush()

            part_files = sorted(
                self.session_dir.glob("part-*.parquet"),
                key=lambda p: int(m.group(1)) if (m := re.search(r"part-(\d+)\.parquet", p.name)) else 0,
            )

            final_path = self.session_dir / "events.parquet"

            if not part_files:
                return final_path if final_path.is_file() else None

            dfs = [pl.read_parquet(pf) for pf in part_files]
            if not dfs:
                return None

            consolidated_df = pl.concat(dfs)
            if "event_ts" in consolidated_df.columns:
                consolidated_df = consolidated_df.sort("event_ts")

            tmp_path = self.session_dir / "events.parquet.tmp"
            consolidated_df.write_parquet(tmp_path)
            tmp_path.replace(final_path)

            if cleanup_partitions:
                for pf in part_files:
                    try:
                        pf.unlink()
                    except OSError:
                        logger.warning("Could not delete partition file: %s", pf)

            logger.info(
                "Finalized session %s: consolidated %d partitions (%d events) into %s",
                self.session_id,
                len(part_files),
                len(consolidated_df),
                final_path,
            )
            return final_path

    def __enter__(self) -> ParquetPartitionWriter:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()
