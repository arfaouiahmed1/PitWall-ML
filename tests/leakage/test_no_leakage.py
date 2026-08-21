"""Leakage contracts — the most important tests in the repo."""

import polars as pl

from pitwall.features.pace import build_pace_features


def test_rolling_feature_excludes_current_target():
    # Build a simple silver df and check that rolling_median_3 at lap 5 does not use lap 5's time
    rows = [
        {
            "session_id": "2024_R0",
            "driver_number": 44,
            "lap_number": i,
            "lap_time_s": 90.0 + i,
            "compound": "MEDIUM",
            "tyre_age": i,
            "stint_no": 1,
            "position": 1,
            "is_valid_training_lap": True,
        }
        for i in range(1, 10)
    ]
    df = pl.DataFrame(rows)
    gold = build_pace_features(df)
    # At lap 4, rolling_median_3 should be median of laps 1,2,3 (91,92,93) = 92, not include 94
    row_lap4 = gold.filter(pl.col("lap_number") == 4).to_dicts()[0]
    assert row_lap4["rolling_median_3"] == 92.0, (
        f"Expected 92.0, got {row_lap4['rolling_median_3']}"
    )


def test_target_is_next_lap():
    rows = [
        {
            "session_id": "2024_R0",
            "driver_number": 1,
            "lap_number": i,
            "lap_time_s": 80.0 + i,
            "compound": "SOFT",
            "tyre_age": i,
            "is_valid_training_lap": True,
        }
        for i in range(1, 6)
    ]
    df = pl.DataFrame(rows)
    gold = build_pace_features(df)
    # Lap 1's target should be lap 2's time
    lap1 = gold.filter(pl.col("lap_number") == 1).to_dicts()[0]
    assert lap1["next_clean_lap_s"] == 82.0
    # Last lap has no target
    last = gold.filter(pl.col("lap_number") == 5).to_dicts()[0]
    assert last["next_clean_lap_s"] is None


def test_feature_timestamp_before_target():
    """Max feature_event_ts <= prediction_event_ts invariant."""
    # In our pipeline this is enforced by shift(-1) for target and shift(1) for features.
    # This test documents the contract.
    rows = [
        {
            "session_id": "2024_R0",
            "driver_number": 44,
            "lap_number": i,
            "lap_time_s": 90.0,
            "compound": "MEDIUM",
            "tyre_age": i,
            "is_valid_training_lap": True,
        }
        for i in range(1, 5)
    ]
    df = pl.DataFrame(rows)
    gold = build_pace_features(df)
    # If rolling_median_3 is not null, it was computed from prior laps only
    valid = gold.filter(pl.col("rolling_median_3").is_not_null())
    assert valid.height > 0
    # No row where rolling feature would have required future lap
    assert gold.filter(pl.col("lap_number") == 1)["rolling_median_3"].to_list()[0] is None
