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


def compute_lift_and_coast_ratio(
    avg_throttle: pl.Expr | str = "avg_throttle",
    max_speed: pl.Expr | str = "max_speed_kmh",
    min_speed: pl.Expr | str = "min_speed_kmh",
    avg_speed: pl.Expr | str = "avg_speed_kmh",
) -> pl.Expr:
    """Polars expression estimating lift-and-coast ratio for a lap.

    True lift-and-coast = fraction of samples where ``throttle < 0.15`` while
    ``speed > 180 km/h``.  Silver only retains per-lap aggregates, so we proxy:

    ``(1 - avg_throttle) * clip((avg_speed - 150) / 100, 0, 1) * (1 - throttle_variance)``

    scaled to ``0..0.35``.  When aggregates are missing the caller should
    ``fill_null(0)`` downstream.
    """

    def _col(c: pl.Expr | str) -> pl.Expr:
        return pl.col(c) if isinstance(c, str) else c

    throttle_term = (1.0 - _col(avg_throttle).fill_null(0.7)).clip(0.0, 1.0)
    speed_term = ((_col(avg_speed).fill_null(180.0) - 150.0) / 100.0).clip(0.0, 1.0)
    # If throttle_variance available, highly variable throttle reduces coasting estimate
    # caller can multiply separately; keep simple here.
    return (throttle_term * speed_term * 0.35).alias("lift_and_coast_ratio")


def compute_brake_intensity(
    avg_brake: pl.Expr | str = "avg_brake",
    max_speed: pl.Expr | str = "max_speed_kmh",
    min_speed: pl.Expr | str = "min_speed_kmh",
) -> pl.Expr:
    """Polars expression estimating mean brake intensity in heavy braking zones.

    Approximates ``avg_brake`` scaled by speed delta (heavy braking = large
    speed drop).  Normalises ``(max_speed - min_speed)`` >150 km/h window.
    Returns ``0..100`` scale matching telemetry ``brake`` range.
    """

    def _col(c: pl.Expr | str) -> pl.Expr:
        return pl.col(c) if isinstance(c, str) else c

    delta = (_col(max_speed).fill_null(0.0) - _col(min_speed).fill_null(0.0)).clip(0.0, 350.0)
    intensity = _col(avg_brake).fill_null(0.0) * (0.5 + 0.5 * (delta / 150.0).clip(0.0, 1.0))
    return intensity.clip(0.0, 100.0).alias("brake_intensity_mean")


def estimate_x_mode_ratio(
    avg_speed: pl.Expr | str = "avg_speed_kmh",
    max_speed: pl.Expr | str = "max_speed_kmh",
    avg_throttle: pl.Expr | str = "avg_throttle",
) -> pl.Expr:
    """Polars expression for Active Aero X-Mode (low-drag) straight-line fraction.

    Straight-line low-drag proxy: high ``max_speed`` with sustained high throttle
    indicates time spent in X-Mode on straights.  Scales to ``0..0.65``.
    """

    def _col(c: pl.Expr | str) -> pl.Expr:
        return pl.col(c) if isinstance(c, str) else c

    speed_term = ((_col(max_speed).fill_null(250.0) - 200.0) / 150.0).clip(0.0, 1.0)
    throttle_term = (_col(avg_throttle).fill_null(0.6) / 1.0).clip(0.0, 1.0)
    avg_term = ((_col(avg_speed).fill_null(210.0) - 180.0) / 80.0).clip(0.0, 1.0)
    return ((speed_term * 0.5 + throttle_term * 0.3 + avg_term * 0.2) * 0.65).alias("x_mode_ratio")
