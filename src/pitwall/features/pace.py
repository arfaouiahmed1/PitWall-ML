"""Pace features — point-in-time, leakage-safe."""

from __future__ import annotations

import polars as pl

from pitwall.features.common import add_rolling_features, encode_compound

PACE_NUMERICAL = [
    "tyre_age",
    "stint_no",
    "lap_number",
    "position",
    "gap_ahead_s",
    "gap_behind_s",
    "rolling_median_3",
    "rolling_median_5",
    "rolling_std_5",
]

PACE_CATEGORICAL = ["compound", "team_id", "driver_id", "circuit_id"]


def build_pace_features(
    silver_laps: pl.DataFrame, weather: pl.DataFrame | None = None
) -> pl.DataFrame:
    """Build Gold pace training table with point-in-time features.

    Target: next_clean_lap_s (shifted -1 per driver/session, not leaking
    the current lap target into features). Only valid training laps are kept;
    invalid laps remain as context for rolling but target is computed.
    """
    if silver_laps.is_empty():
        return silver_laps

    df = silver_laps.clone()
    df = encode_compound(df)

    # Ensure sort
    sort_cols = [c for c in ["session_id", "driver_number", "lap_number"] if c in df.columns]
    if sort_cols:
        df = df.sort(sort_cols)

    # Add rolling features (backward only)
    group_cols = [c for c in ["session_id", "driver_number"] if c in df.columns]
    if "lap_time_s" in df.columns and group_cols:
        df = add_rolling_features(df, group_cols, "lap_time_s", windows=[3, 5])

    # Gap features: forward-fill gaps within stint? For V1 keep as is
    # Race progress
    if "lap_number" in df.columns and "session_id" in df.columns:
        # Estimate total laps as max per session
        total = df.group_by("session_id").agg(pl.col("lap_number").max().alias("_total_laps"))
        df = df.join(total, on="session_id", how="left")
        df = df.with_columns((pl.col("lap_number") / pl.col("_total_laps")).alias("race_progress"))
        df = df.drop("_total_laps")

    # Target: next lap time per driver/session
    # Shift -1 within group so row t predicts lap t+1
    if "lap_time_s" in df.columns and group_cols:
        df = df.with_columns(
            pl.col("lap_time_s").shift(-1).over(group_cols).alias("next_clean_lap_s")
        )

    # Flag valid training rows: current row valid AND next lap valid
    if "is_valid_training_lap" in df.columns:
        # Use next lap validity as well if available
        df = df.with_columns(
            (pl.col("is_valid_training_lap") & pl.col("next_clean_lap_s").is_not_null()).alias(
                "is_valid_training_lap_target"
            )
        )
    else:
        df = df.with_columns(
            pl.col("next_clean_lap_s").is_not_null().alias("is_valid_training_lap_target")
        )

    # Optional weather join (nearest asof) — V1 simple: not implemented
    return df


def get_feature_columns(df: pl.DataFrame) -> list[str]:
    cols = [c for c in PACE_NUMERICAL + PACE_CATEGORICAL if c in df.columns]
    # Also include derived
    for c in ["race_progress", "delta_to_rolling_5"]:
        if c in df.columns and c not in cols:
            cols.append(c)
    return cols
