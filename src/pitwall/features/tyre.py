"""Tyre degradation — pace degradation proxy (V2).

Target: degradation delta = lap_time_s - rolling_median_5
(or session median if rolling unavailable).
Captures tyre-age effect per compound, isolated from track evolution.

Features are point-in-time (shift(1) rolling), no leakage: row t predicts degradation at lap t.
"""

from __future__ import annotations

import polars as pl

from pitwall.features.common import add_rolling_features, encode_compound

TYRE_NUMERICAL = [
    "tyre_age",
    "tyre_age_sq",
    "stint_lap",
    "stint_no",
    "lap_number",
    "race_progress",
    "rolling_median_5",
    "rolling_std_5",
    "track_temp_c",
    "air_temp_c",
]

TYRE_CATEGORICAL = ["compound", "circuit_id", "regulation_era"]


def build_tyre_features(silver_laps: pl.DataFrame) -> pl.DataFrame:
    """Build Gold tyre table with degradation target."""
    if silver_laps.is_empty():
        return silver_laps
    df = silver_laps.clone()
    df = encode_compound(df)

    # sort
    sort_cols = [c for c in ["session_id", "driver_number", "lap_number"] if c in df.columns]
    if sort_cols:
        df = df.sort(sort_cols)

    group_cols = [c for c in ["session_id", "driver_number"] if c in df.columns]

    # rolling baseline for delta
    if "lap_time_s" in df.columns and group_cols:
        df = add_rolling_features(df, group_cols, "lap_time_s", windows=[5])
        # delta = current lap - rolling median (positive = slower than recent)
        if "rolling_median_5" in df.columns:
            df = df.with_columns(
                (pl.col("lap_time_s") - pl.col("rolling_median_5")).alias("tyre_deg_s")
            )
        else:
            df = df.with_columns(pl.col("lap_time_s").alias("tyre_deg_s"))
    else:
        if "lap_time_s" in df.columns:
            df = df.with_columns(pl.col("lap_time_s").alias("tyre_deg_s"))

    # derived tyre features
    if "tyre_age" in df.columns:
        df = df.with_columns((pl.col("tyre_age") ** 2).alias("tyre_age_sq"))
        # stint_lap = tyre_age + 1 alias if not present
        if "stint_lap" not in df.columns:
            df = df.with_columns((pl.col("tyre_age") + 1).alias("stint_lap"))

    # race progress for context (tyre deg increases late)
    if "lap_number" in df.columns and "session_id" in df.columns:
        total = df.group_by("session_id").agg(pl.col("lap_number").max().alias("_total"))
        df = df.join(total, on="session_id", how="left")
        df = df.with_columns((pl.col("lap_number") / pl.col("_total")).alias("race_progress"))
        df = df.drop("_total")

    # Fill null degradation (first 5 laps rolling null -> use 0)
    if "tyre_deg_s" in df.columns:
        df = df.with_columns(pl.col("tyre_deg_s").fill_null(0))

    # validity: tyre age >0 and valid lap and rolling available
    if "is_valid_training_lap" in df.columns:
        df = df.with_columns(
            (pl.col("is_valid_training_lap") & (pl.col("tyre_age") > 0)).alias("is_valid_tyre_row")
        )
    else:
        df = df.with_columns((pl.col("tyre_age") > 0).alias("is_valid_tyre_row"))

    return df


def get_tyre_feature_columns(df: pl.DataFrame) -> list[str]:
    cols = [c for c in TYRE_NUMERICAL + TYRE_CATEGORICAL if c in df.columns]
    return cols
