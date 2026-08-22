"""Shared feature helpers — used offline and online to avoid skew."""

from __future__ import annotations

import polars as pl


def add_rolling_features(
    df: pl.DataFrame,
    group_cols: list[str],
    value_col: str,
    windows: list[int] | None = None,
) -> pl.DataFrame:
    """Add rolling median/std per driver/session (backward-only, no leakage).

    Uses Polars rolling with closed='left' semantics via shift.
    """
    windows = [3, 5] if windows is None else windows
    # Sort by session/driver/lap
    sort_cols = [c for c in ["session_id", "driver_number", "lap_number"] if c in df.columns]
    if sort_cols:
        df = df.sort(sort_cols)

    for w in windows:
        # median: need to shift 1 so current lap not included
        # Polars rolling_median doesn't support group_by directly in this version,
        # so do per-group via over
        if value_col in df.columns:
            df = df.with_columns(
                pl.col(value_col)
                .shift(1)
                .rolling_median(window_size=w, min_samples=w)
                .over(group_cols)
                .alias(f"rolling_median_{w}")
            )
            df = df.with_columns(
                pl.col(value_col)
                .shift(1)
                .rolling_std(window_size=w, min_samples=w)
                .over(group_cols)
                .alias(f"rolling_std_{w}")
            )
    return df


def add_delta_features(df: pl.DataFrame) -> pl.DataFrame:
    if "lap_time_s" in df.columns and "rolling_median_5" in df.columns:
        df = df.with_columns(
            (pl.col("lap_time_s") - pl.col("rolling_median_5")).alias("delta_to_rolling_5")
        )
    return df


def encode_compound(df: pl.DataFrame) -> pl.DataFrame:
    if "compound" in df.columns:
        df = df.with_columns(pl.col("compound").str.to_uppercase().fill_null("UNKNOWN"))
    return df
