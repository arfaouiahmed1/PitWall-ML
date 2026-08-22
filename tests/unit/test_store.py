"""Unit tests for the local parquet-backed feature store (point-in-time, Feast-style)."""

from __future__ import annotations

import json
from datetime import datetime

import polars as pl
import pytest

from pitwall.features.pace import build_pace_features
from pitwall.features.store import FeatureStore, FeatureView, materialize_gold_store


def _two_session_df() -> pl.DataFrame:
    """Two sessions, laps 1..10; lap 10 carries the distinctive value 999.0."""
    rows = [
        {
            "session_id": session,
            "driver_number": 1,
            "lap_number": lap,
            "event_ts": datetime(2024, 1, 1, 0, lap),
            "lap_time_s": 999.0 if lap == 10 else 90.0 + lap,
        }
        for session in ("R0", "R1")
        for lap in range(1, 11)
    ]
    return pl.DataFrame(rows)


def _pace_view() -> FeatureView:
    return FeatureView(
        name="pace", entities=["session_id", "driver_number"], features=["lap_time_s"]
    )


def test_register_then_list_views_returns_metadata(tmp_path):
    fs = FeatureStore(tmp_path / "store")
    df = _two_session_df()

    data_path = fs.register(_pace_view(), df)

    assert data_path.exists()
    stored = pl.read_parquet(data_path)
    assert stored.columns == ["session_id", "driver_number", "event_ts", "lap_time_s"]
    views = fs.list_views()
    assert len(views) == 1
    meta = views[0]
    assert meta["name"] == "pace"
    assert meta["entities"] == ["session_id", "driver_number"]
    assert meta["event_ts_col"] == "event_ts"
    assert meta["features"] == ["lap_time_s"]
    assert meta["rows"] == 20
    assert meta["ttl_days"] == 365.0
    assert json.loads((tmp_path / "store" / "pace" / "meta.json").read_text())["rows"] == 20


def test_historical_features_no_future_leakage(tmp_path):
    """Query between lap 4 and lap 5 must return lap 4's value — never lap 10's 999.0."""
    fs = FeatureStore(tmp_path / "store")
    fs.register(_pace_view(), _two_session_df())

    query = pl.DataFrame(
        {
            "session_id": ["R0", "R1"],
            "driver_number": [1, 1],
            "event_ts": [datetime(2024, 1, 1, 0, 4, 30), datetime(2024, 1, 1, 0, 4, 30)],
        }
    )
    out = fs.get_historical_features(query, "pace")

    assert out.height == 2
    assert out["lap_time_s"].to_list() == [94.0, 94.0]
    assert 999.0 not in out["lap_time_s"].to_list()


def test_online_features_returns_latest_row(tmp_path):
    fs = FeatureStore(tmp_path / "store")
    fs.register(_pace_view(), _two_session_df())

    got = fs.get_online_features("pace", {"session_id": "R0", "driver_number": 1})

    assert got["session_id"] == "R0"
    assert got["lap_time_s"] == 999.0  # latest (lap 10) row, not an earlier one

    assert fs.get_online_features("pace", {"session_id": "ZZ", "driver_number": 9}) == {}


def test_historical_fallback_without_ts_column(tmp_path):
    """entity_df without event_ts falls back to latest-row-per-entity left join."""
    fs = FeatureStore(tmp_path / "store")
    fs.register(_pace_view(), _two_session_df())

    query = pl.DataFrame({"session_id": ["R0", "R1"], "driver_number": [1, 1]})
    out = fs.get_historical_features(query, "pace")

    assert out.height == 2
    assert out["lap_time_s"].to_list() == [999.0, 999.0]


def test_materialize_gold_store_creates_three_views(tmp_path):
    rows = [
        {
            "session_id": f"R{s}",
            "driver_number": d,
            "lap_number": lap,
            "lap_time_s": 90.0 + lap * 0.1,
            "compound": "MEDIUM",
            "tyre_age": lap - 1,
            "stint_no": 1,
            "position": 1,
            "is_valid_training_lap": True,
        }
        for s in range(2)
        for d in (1, 44)
        for lap in range(1, 13)
    ]
    gold = build_pace_features(pl.DataFrame(rows))

    fs = materialize_gold_store(gold, root=tmp_path / "store")

    views = {v["name"]: v for v in fs.list_views()}
    assert set(views) == {"pace", "tyre", "pit"}
    assert "rolling_median_3" in views["pace"]["features"]
    assert "next_clean_lap_s" in views["pace"]["features"]
    assert views["tyre"]["features"] == ["tyre_age", "stint_no", "compound"]
    assert "position" in views["pit"]["features"]
    # Gold has no event_ts column → synthesized constant ts keeps meta consistent.
    assert views["pace"]["event_ts_col"] == "event_ts"
    assert views["pace"]["rows"] == gold.height


def test_unknown_view_raises_file_not_found(tmp_path):
    fs = FeatureStore(tmp_path / "store")
    query = pl.DataFrame({"session_id": ["R0"], "driver_number": [1]})

    with pytest.raises(FileNotFoundError):
        fs.get_historical_features(query, "missing")
    with pytest.raises(FileNotFoundError):
        fs.get_online_features("missing", {"session_id": "R0"})
