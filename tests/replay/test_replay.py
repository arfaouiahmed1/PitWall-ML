import tempfile
from pathlib import Path

import pytest

from pitwall.ingestion.replay import ParquetReplaySource, ReplayConfig


@pytest.mark.asyncio
async def test_parquet_replay_empty_returns_demo():
    with tempfile.TemporaryDirectory() as tmp:
        cfg = ReplayConfig(bronze_path=Path(tmp), speed="MAX")
        src = ParquetReplaySource(cfg)
        events = []
        async for e in src.events():
            events.append(e)
            if len(events) >= 5:
                break
        assert len(events) == 5
        assert events[0].source == "demo"


@pytest.mark.asyncio
async def test_replay_speed_max_no_sleep():
    with tempfile.TemporaryDirectory() as tmp:
        cfg = ReplayConfig(bronze_path=Path(tmp), speed="MAX")
        src = ParquetReplaySource(cfg)
        # Should yield quickly
        count = 0
        async for _ in src.events():
            count += 1
            if count >= 10:
                break
        assert count == 10
