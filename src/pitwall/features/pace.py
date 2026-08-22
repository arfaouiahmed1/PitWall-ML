"""Pace features — point-in-time, leakage-safe."""

from __future__ import annotations

from typing import Final

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

_GREEN_STATUS_PATTERN: Final[str] = r"^[1;]*$"
"""Matches only green-flag codes: '1' (green) repeated, with ';' separators (e.g. '1', '1;1')."""

_TARGET_OUTLIER_FACTOR: Final[float] = 1.07
"""Null the target when the next lap exceeds this factor times rolling_median_5."""


def _is_green(status: pl.Expr) -> pl.Expr:
    """Green-flag predicate over a TrackStatus expression.

    True when the status is missing (null / NaN-like / empty) or every character
    is a green-flag code ('1') or a multi-code separator (';'). FastF1 statuses
    can be multi-char ('2;4' = yellow + safety car); any non-'1' code makes the
    lap non-green.
    """
    text = status.cast(pl.Utf8).str.strip_chars()
    missing = text.is_null() | text.str.to_uppercase().is_in(["", "NAN"])
    return missing | text.str.contains(_GREEN_STATUS_PATTERN)


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

        # Target hygiene: trainable only when rows t AND t+1 ran green
        # (yellow/SC/VSC laps teach racing-pace-foreign variance), and the next
        # lap is not an outlier vs rolling_median_5 (fuel-less anomalies).
        if "track_status" in df.columns:
            green_now = _is_green(pl.col("track_status"))
            green_next = green_now.shift(-1).over(group_cols)
        else:
            green_now = pl.lit(True)  # no track_status column (synthetic): treat as green
            green_next = pl.lit(True)

        outlier_next = pl.col("rolling_median_5").is_not_null() & (
            pl.col("next_clean_lap_s") > _TARGET_OUTLIER_FACTOR * pl.col("rolling_median_5")
        )
        keep_target = green_now & green_next & ~outlier_next
        df = df.with_columns(
            pl.when(keep_target)
            .then(pl.col("next_clean_lap_s"))
            .otherwise(None)
            .alias("next_clean_lap_s")
        )

    # Non-null target <=> green->green held AND 1.07x trim did not fire, so this
    # flag AND-combines every hygiene condition for downstream filters.
    if "is_valid_training_lap" in df.columns:
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
