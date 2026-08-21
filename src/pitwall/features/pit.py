"""Pit hazard features — discrete-time hazard (V2).

Target: pit_in_next_3 (binary) — will driver pit within next 3 laps.
Features point-in-time, no leakage (rolling shift(1)).

For synthetic data, stint_no increments at pit; for real FastF1, derive from compound change or pit telemetry.
"""

from __future__ import annotations

import polars as pl

from pitwall.features.common import add_rolling_features, encode_compound

PIT_NUMERICAL = [
    "tyre_age",
    "tyre_age_sq",
    "stint_no",
    "lap_number",
    "race_progress",
    "position",
    "gap_ahead_s",
    "gap_behind_s",
    "rolling_median_5",
    "rolling_std_5",
    "track_temp_c",
]

PIT_CATEGORICAL = ["compound", "circuit_id", "regulation_era"]


def build_pit_features(silver_laps: pl.DataFrame, horizon: int = 3) -> pl.DataFrame:
    """Build pit hazard training table."""
    if silver_laps.is_empty():
        return silver_laps
    df = silver_laps.clone()
    df = encode_compound(df)

    sort_cols = [c for c in ["session_id", "driver_number", "lap_number"] if c in df.columns]
    if sort_cols:
        df = df.sort(sort_cols)
    group_cols = [c for c in ["session_id", "driver_number"] if c in df.columns]

    # derived tyre age sq
    if "tyre_age" in df.columns:
        df = df.with_columns((pl.col("tyre_age") ** 2).alias("tyre_age_sq"))

    # race progress
    if "lap_number" in df.columns and "session_id" in df.columns:
        total = df.group_by("session_id").agg(pl.col("lap_number").max().alias("_tot"))
        df = df.join(total, on="session_id", how="left")
        df = df.with_columns((pl.col("lap_number") / pl.col("_tot")).alias("race_progress"))
        df = df.drop("_tot")

    # rolling for context (no leakage)
    if "lap_time_s" in df.columns and group_cols:
        df = add_rolling_features(df, group_cols, "lap_time_s", windows=[5])

    # label: pit in next `horizon` laps = stint_no increases or compound changes within horizon
    if "stint_no" in df.columns and group_cols:
        # pit next lap flag
        df = df.with_columns(
            (
                pl.col("stint_no").shift(-1).over(group_cols).fill_null(pl.col("stint_no"))
                > pl.col("stint_no")
            ).alias("_pit_next1")
        )
        # also consider compound change as pit (for real data)
        if "compound" in df.columns:
            df = df.with_columns(
                (
                    (pl.col("stint_no").shift(-1).over(group_cols) > pl.col("stint_no"))
                    | (pl.col("compound").shift(-1).over(group_cols) != pl.col("compound"))
                )
                .fill_null(False)
                .alias("_pit_next1")
            )
        # build horizon via shifts
        pit_cols = ["_pit_next1"]
        for k in range(2, horizon + 1):
            col = f"_pit_next{k}"
            df = df.with_columns(
                (
                    pl.col("stint_no").shift(-k).over(group_cols).fill_null(pl.col("stint_no"))
                    > pl.col("stint_no")
                ).alias(col)
            )
            # compound check for k>1 as well
            if "compound" in df.columns:
                df = df.with_columns(
                    (
                        (pl.col("stint_no").shift(-k).over(group_cols) > pl.col("stint_no"))
                        | (pl.col("compound").shift(-k).over(group_cols) != pl.col("compound"))
                    )
                    .fill_null(False)
                    .alias(col)
                )
            pit_cols.append(col)
        # any pit within horizon
        df = df.with_columns(
            pl.max_horizontal(pit_cols).cast(pl.Int8).alias(f"pit_in_next_{horizon}")
        )
        # also next lap single
        df = df.with_columns(pl.col("_pit_next1").cast(pl.Int8).alias("pit_next_lap"))
        # drop temp
        df = df.drop(pit_cols)
    else:
        df = df.with_columns(pl.lit(0).alias(f"pit_in_next_{horizon}"))
        df = df.with_columns(pl.lit(0).alias("pit_next_lap"))

    # validity: not last horizon laps where label would be truncated? Keep all but flag where next laps not exist -> not valid for training?
    # For synthetic 30 laps, last 3 laps have incomplete horizon, but we can keep with label 0 (no future pit)
    # Mark valid if not in last `horizon` laps? For training, keep all to maximize data, but evaluator can handle.
    if "is_valid_training_lap" in df.columns:
        df = df.with_columns((pl.col("is_valid_training_lap")).alias("is_valid_pit_row"))
    else:
        df = df.with_columns(pl.lit(True).alias("is_valid_pit_row"))

    return df


def get_pit_feature_columns(df: pl.DataFrame) -> list[str]:
    cols = [c for c in PIT_NUMERICAL + PIT_CATEGORICAL if c in df.columns]
    return cols
