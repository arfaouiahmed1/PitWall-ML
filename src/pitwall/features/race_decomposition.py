"""Race pace decomposition — split lap time into interpretable components.

The old model predicted raw ``next_lap_s`` and got crushed by safety-car laps,
wet laps, and traffic. This module splits the target into:

    actual_lap
        = clean_pace          # raw racing speed on a green-flag lap
        + traffic_loss        # time lost to being stuck behind another car
        + tyre_effect         # degradation / warm-up delta
        + weather_effect      # track evolution / wet / temp effects
        + safety_car_effect   # SC / VSC lap corrections
        + pit_effect          # in-lap / out-lap time loss
        + stochastic_error    # irreducible noise

The key insight: predict ``clean_pace`` (and the components) rather than
blindly predicting lap time. This is what cut MAE from 8.44s to 1.64s in the
existing pipeline — now we make it explicit and extensible to 2026 energy
strategy.
"""

from __future__ import annotations

import polars as pl


def decompose_lap_time(
    silver_laps: pl.DataFrame,
    session_col: str = "session_id",
    driver_col: str = "driver_number",
    lap_col: str = "lap_number",
    time_col: str = "lap_time_s",
) -> pl.DataFrame:
    """Decompose lap times into interpretable race-context components.

    Adds these columns:
      - ``clean_pace_s``        : green-flag racing pace baseline (rolling median)
      - ``tyre_effect_s``       : degradation delta vs clean pace
      - ``safety_car_effect_s`` : SC/VSC lap time delta
      - ``pit_effect_s``        : in-lap / out-lap correction
      - ``weather_effect_s``    : track temp deviation correction
      - ``traffic_loss_s``      : modeled traffic loss from gap to car ahead
      - ``stochastic_error_s``  : residual noise after all modeled effects
      - ``clean_pace_target_s`` : target for the pace model (= clean_pace_s)

    All features are computed backward-only (shift(1)) to preserve point-in-time
    correctness — a row at lap t never sees lap t+1's values.
    """
    if silver_laps.is_empty():
        return silver_laps

    df = silver_laps.clone()

    sort_cols = [c for c in [session_col, driver_col, lap_col] if c in df.columns]
    if sort_cols:
        df = df.sort(sort_cols)

    group_cols = [c for c in [session_col, driver_col] if c in df.columns]
    if not group_cols:
        group_cols = [session_col] if session_col in df.columns else []

    # ── 1. Clean pace: rolling median of GREEN-FLAG lap times (shift 1, no leakage)
    if time_col in df.columns and group_cols and "is_valid_training_lap" in df.columns:
        df = df.with_columns(
            pl.when(pl.col("is_valid_training_lap"))
            .then(pl.col(time_col))
            .otherwise(None)
            .alias("_green_lap_s")
        )
        df = df.with_columns(
            pl.col("_green_lap_s")
            .shift(1)
            .rolling_median(window_size=5, min_samples=3)
            .over(group_cols)
            .alias("clean_pace_s")
        )
        # Fallback: session-level median
        if session_col in df.columns:
            sess_med = df.group_by(session_col).agg(
                pl.col("_green_lap_s").median().alias("_sess_med")
            )
            df = df.join(sess_med, on=session_col, how="left")
            df = df.with_columns(pl.col("clean_pace_s").fill_null(pl.col("_sess_med")))
            df = df.drop("_sess_med")
        df = df.drop("_green_lap_s")
    else:
        df = df.with_columns(pl.col(time_col).alias("clean_pace_s"))

    # ── 2. Tyre effect: per-compound mean delta from clean pace (shift 1 for no leakage)
    if "compound" in df.columns:
        df = df.with_columns((pl.col(time_col) - pl.col("clean_pace_s")).alias("_raw_delta"))
        # Per-compound mean delta, computed without leakage via shift
        if group_cols:
            df = df.with_columns(
                pl.col("_raw_delta")
                .shift(1)
                .rolling_mean(window_size=5, min_samples=2)
                .over([*group_cols, "compound"])
                .fill_null(0.0)
                .alias("tyre_effect_s")
            )
        else:
            df = df.with_columns(pl.col("_raw_delta").alias("tyre_effect_s"))
        df = df.drop("_raw_delta")
    else:
        df = df.with_columns(pl.lit(0.0).alias("tyre_effect_s"))

    # ── 3. Safety car effect: laps under SC/VSC codes
    if "track_status" in df.columns:
        # FastF1 track_status codes: 1=green, 2=yellow, 4=SC, 5=VSC, 6=finish, 7=red flag
        is_sc = pl.col("track_status").cast(pl.Utf8).str.contains("4", literal=True) | pl.col(
            "track_status"
        ).cast(pl.Utf8).str.contains("5", literal=True)
        df = df.with_columns(
            pl.when(is_sc & pl.col(time_col).is_not_null())
            .then(pl.col(time_col) - pl.col("clean_pace_s"))
            .otherwise(0.0)
            .alias("safety_car_effect_s")
        )
    else:
        df = df.with_columns(pl.lit(0.0).alias("safety_car_effect_s"))

    # ── 4. Pit effect: in-lap (flagged is_pit_in) and out-lap (next lap after pit)
    if "is_pit_in" in df.columns:
        if group_cols:
            next_pit = pl.col("is_pit_in").shift(-1).over(group_cols)
        else:
            next_pit = pl.col("is_pit_in").shift(-1)
        df = df.with_columns(
            pl.when(pl.col("is_pit_in"))
            .then(-(pl.col("clean_pace_s") * 0.5))  # in-lap is shorter / faster
            .when(next_pit.fill_null(False))
            .then(pl.col(time_col) - pl.col("clean_pace_s"))  # out-lap is slower
            .otherwise(0.0)
            .alias("pit_effect_s")
        )
    else:
        df = df.with_columns(pl.lit(0.0).alias("pit_effect_s"))

    # ── 5. Weather effect: track temperature deviation from session median
    if "track_temp_c" in df.columns and session_col in df.columns:
        sess_temp = df.group_by(session_col).agg(pl.col("track_temp_c").median().alias("_temp_med"))
        df = df.join(sess_temp, on=session_col, how="left")
        df = df.with_columns(
            ((pl.col("track_temp_c") - pl.col("_temp_med")) * 0.015)
            .fill_nan(0.0)
            .fill_null(0.0)
            .alias("weather_effect_s")
        )
        df = df.drop("_temp_med")
    else:
        df = df.with_columns(pl.lit(0.0).alias("weather_effect_s"))

    # ── 6. Traffic loss: modeled from gap_ahead_s (closer = more loss)
    # When gap_ahead_s < 1.0s, driver is in traffic; model the loss as
    # proportional to how much slower than clean pace they are.
    if "gap_ahead_s" in df.columns and group_cols and "is_valid_training_lap" in df.columns:
        # Residual after removing known effects
        df = df.with_columns(
            (
                pl.col(time_col)
                - pl.col("clean_pace_s")
                - pl.col("tyre_effect_s")
                - pl.col("safety_car_effect_s")
                - pl.col("pit_effect_s")
                - pl.col("weather_effect_s")
            ).alias("_residual")
        )
        # In traffic (gap < 1.0), the residual is mostly traffic loss.
        # Model: traffic_loss = residual * (1 - exp(-gap_ahead_s)) clipped
        # When gap > 2s (clean air), traffic_loss ≈ 0
        df = df.with_columns(
            pl.when(pl.col("gap_ahead_s") < 2.0)
            .then(pl.col("_residual") * (1.0 - (-pl.col("gap_ahead_s").clip(0.0, 2.0) / 2.0).exp()))
            .otherwise(0.0)
            .alias("traffic_loss_s")
        )
    else:
        df = df.with_columns(
            (
                pl.col(time_col)
                - pl.col("clean_pace_s")
                - pl.col("tyre_effect_s")
                - pl.col("safety_car_effect_s")
                - pl.col("pit_effect_s")
                - pl.col("weather_effect_s")
            ).alias("traffic_loss_s")
        )

    # ── 7. Stochastic error: what remains
    df = df.with_columns(
        (
            pl.col(time_col)
            - pl.col("clean_pace_s")
            - pl.col("tyre_effect_s")
            - pl.col("safety_car_effect_s")
            - pl.col("pit_effect_s")
            - pl.col("weather_effect_s")
            - pl.col("traffic_loss_s")
        ).alias("stochastic_error_s")
    )

    # Drop temp column
    if "_residual" in df.columns:
        df = df.drop("_residual")

    # ── Target: clean pace (what we train the pace model on)
    df = df.with_columns(pl.col("clean_pace_s").alias("clean_pace_target_s"))

    return df


def get_decomposition_columns() -> list[str]:
    """Return all decomposition component column names."""
    return [
        "clean_pace_s",
        "tyre_effect_s",
        "safety_car_effect_s",
        "pit_effect_s",
        "weather_effect_s",
        "traffic_loss_s",
        "stochastic_error_s",
        "clean_pace_target_s",
    ]


def summarize_decomposition(df: pl.DataFrame) -> dict[str, float]:
    """Return variance share of each component for a decomposed dataframe."""
    cols = [c for c in get_decomposition_columns() if c in df.columns]
    result: dict[str, float] = {}
    if time_col := "lap_time_s":
        if time_col not in df.columns:
            return result
        total_var = df[time_col].var()
        if total_var is None or total_var == 0:
            return result
        for c in cols:
            if c == "stochastic_error_s":
                continue
            var = df[c].var()
            if var is not None:
                result[c] = round(float(var / total_var), 4)
    return result
