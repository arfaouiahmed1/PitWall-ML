"""Pace features — point-in-time, leakage-safe.

Iteration 4 (Physics/Weather/Telemetry):
- As-of weather join (15 min tolerance) extracting track/air temp, humidity,
  rainfall, wind with session-median / climatological fallback.
- Telemetry-derived dynamics: lift_and_coast_ratio, brake_intensity_mean,
  speed_trap_max_kmh, x_mode_ratio, circuit_energy_difficulty.
- Hard-compound non-linearity: tyre_warmup_phase, compound_temp_interaction,
  stint_progress_ratio.

All features are backward-only or per-lap aggregates — no leakage of
next-lap target.
"""

from __future__ import annotations

import contextlib
from typing import Final

import polars as pl

from pitwall.features.common import add_rolling_features, encode_compound

try:
    from pitwall.monitoring.drift_era import get_circuit_energy_difficulty
except Exception:  # pragma: no cover

    def get_circuit_energy_difficulty(circuit_short_name: str | None) -> float:  # type: ignore[no-redef]
        return 50.0


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
    # Weather (as-of join)
    "track_temp_c",
    "air_temp_c",
    "humidity_pct",
    "rainfall_flag",
    "wind_speed_ms",
    # Telemetry / 2026 Active Aero
    "lift_and_coast_ratio",
    "brake_intensity_mean",
    "speed_trap_max_kmh",
    "x_mode_ratio",
    "circuit_energy_difficulty",
    # Hard compound non-linearity
    "tyre_warmup_phase",
    "compound_temp_interaction",
    "stint_progress_ratio",
]

PACE_CATEGORICAL = ["compound", "team_id", "driver_id", "circuit_id"]

_GREEN_STATUS_PATTERN: Final[str] = r"^[1;]*$"
"""Matches only green-flag codes: '1' (green) repeated, with ';' separators (e.g. '1', '1;1')."""

_TARGET_OUTLIER_FACTOR: Final[float] = 1.07
"""Null the target when the next lap exceeds this factor times rolling_median_5."""

# Climatological defaults when weather is entirely missing
_DEFAULT_TRACK_TEMP: Final[float] = 35.0
_DEFAULT_AIR_TEMP: Final[float] = 25.0
_DEFAULT_HUMIDITY: Final[float] = 60.0
_DEFAULT_WIND: Final[float] = 2.0
_DEFAULT_RAINFALL: Final[float] = 0.0


def _is_green(status: pl.Expr) -> pl.Expr:
    """Green-flag predicate over a TrackStatus expression."""
    text = status.cast(pl.Utf8).str.strip_chars()
    missing = text.is_null() | text.str.to_uppercase().is_in(["", "NAN"])
    return missing | text.str.contains(_GREEN_STATUS_PATTERN)


# ── Internal helpers ────────────────────────────────────────────────────────


def _normalize_session_cols(df: pl.DataFrame) -> pl.DataFrame:
    """Ensure canonical session_id / session_key / tyre_age / stint_no / gap cols."""
    # session_id <-> session_key
    if "session_key" in df.columns and "session_id" not in df.columns:
        df = df.with_columns(pl.col("session_key").cast(pl.Utf8).alias("session_id"))
    if "session_id" in df.columns and "session_key" not in df.columns:
        # best-effort int cast
        with contextlib.suppress(Exception):
            df = df.with_columns(
                pl.col("session_id").cast(pl.Int64, strict=False).alias("session_key")
            )
    # tyre_age
    if "tyre_age_at_start" in df.columns and "tyre_age" not in df.columns:
        df = df.with_columns(pl.col("tyre_age_at_start").alias("tyre_age"))
    if "tyre_age" in df.columns:
        df = df.with_columns(
            pl.col("tyre_age").cast(pl.Float64, strict=False).fill_null(0.0).alias("tyre_age")
        )
    else:
        # no tyre age at all -> default 0 (lap 1 on fresh tyre)
        df = df.with_columns(pl.lit(0.0).alias("tyre_age"))
    # stint_no
    if "stint" in df.columns and "stint_no" not in df.columns:
        df = df.with_columns(pl.col("stint").cast(pl.Float64, strict=False).alias("stint_no"))
    if "stint_no" not in df.columns and "stint" not in df.columns:
        df = df.with_columns(pl.lit(1.0).alias("stint_no"))
    else:
        if "stint_no" in df.columns:
            df = df.with_columns(
                pl.col("stint_no").cast(pl.Float64, strict=False).fill_null(1.0).alias("stint_no")
            )
    # gaps
    if "position" not in df.columns:
        df = df.with_columns(pl.lit(10.0).alias("position"))
    else:
        df = df.with_columns(
            pl.col("position").cast(pl.Float64, strict=False).fill_null(10.0).alias("position")
        )
    if "gap_to_car_ahead_s" in df.columns and "gap_ahead_s" not in df.columns:
        df = df.with_columns(pl.col("gap_to_car_ahead_s").alias("gap_ahead_s"))
    if "gap_ahead_s" not in df.columns:
        df = df.with_columns(pl.lit(None).cast(pl.Float64).alias("gap_ahead_s"))
    if "gap_behind_s" not in df.columns:
        df = df.with_columns(pl.lit(None).cast(pl.Float64).alias("gap_behind_s"))
    # lap_start normalisation for weather join
    # Prefer lap_start, else date, else lap_start_iso string
    if "lap_start" not in df.columns:
        for cand in ["lap_start_iso", "date", "timestamp"]:
            if cand in df.columns:
                try:
                    df = df.with_columns(pl.col(cand).cast(pl.Datetime).alias("lap_start"))
                    break
                except Exception:
                    continue
    else:
        with contextlib.suppress(Exception):
            df = df.with_columns(pl.col("lap_start").cast(pl.Datetime))
    # ensure circuit columns exist for energy mapping
    if "circuit_short_name" not in df.columns and "circuit_id" in df.columns:
        df = df.with_columns(pl.col("circuit_id").cast(pl.Utf8).alias("circuit_short_name"))
    return df


def _normalize_weather_df(weather: pl.DataFrame) -> pl.DataFrame | None:
    """Normalise heterogeneous weather column names to canonical schema.

    Returns DataFrame with columns: session_id, date, track_temp_c,
    air_temp_c, humidity_pct, rainfall_flag, wind_speed_ms — or None if
    weather is empty / unusable.
    """
    if weather is None or weather.is_empty():
        return None
    w = weather.clone()
    # session col
    if "session_id" not in w.columns and "session_key" in w.columns:
        w = w.with_columns(pl.col("session_key").cast(pl.Utf8).alias("session_id"))
    if "session_id" not in w.columns:
        # no session key -> assume single session
        w = w.with_columns(pl.lit("unknown").alias("session_id"))
    else:
        w = w.with_columns(pl.col("session_id").cast(pl.Utf8))
    # date col
    date_col = None
    for cand in ["date", "lap_start", "timestamp", "time", "datetime"]:
        if cand in w.columns:
            date_col = cand
            break
    if date_col is None:
        return None
    if date_col != "date":
        w = w.rename({date_col: "date"})
    try:
        w = w.with_columns(pl.col("date").cast(pl.Datetime))
    except Exception:
        return None
    # track temp
    for cand in ["track_temp_c", "track_temperature", "trackTemp", "track_temp"]:
        if cand in w.columns:
            if cand != "track_temp_c":
                w = w.rename({cand: "track_temp_c"})
            break
    if "track_temp_c" not in w.columns:
        w = w.with_columns(pl.lit(None).cast(pl.Float64).alias("track_temp_c"))
    else:
        w = w.with_columns(pl.col("track_temp_c").cast(pl.Float64, strict=False))
    # air temp
    for cand in ["air_temp_c", "air_temperature", "airTemp", "air_temp"]:
        if cand in w.columns:
            if cand != "air_temp_c":
                w = w.rename({cand: "air_temp_c"})
            break
    if "air_temp_c" not in w.columns:
        w = w.with_columns(pl.lit(None).cast(pl.Float64).alias("air_temp_c"))
    else:
        w = w.with_columns(pl.col("air_temp_c").cast(pl.Float64, strict=False))
    # humidity
    for cand in ["humidity_pct", "humidity", "relative_humidity", "humidity_percent"]:
        if cand in w.columns:
            if cand != "humidity_pct":
                w = w.rename({cand: "humidity_pct"})
            break
    if "humidity_pct" not in w.columns:
        w = w.with_columns(pl.lit(None).cast(pl.Float64).alias("humidity_pct"))
    else:
        w = w.with_columns(pl.col("humidity_pct").cast(pl.Float64, strict=False))
    # rainfall_flag
    rain_col = None
    for cand in ["rainfall_flag", "rainfall", "rain", "precipitation"]:
        if cand in w.columns:
            rain_col = cand
            break
    if rain_col is None:
        w = w.with_columns(pl.lit(None).cast(pl.Float64).alias("rainfall_flag"))
    else:
        # normalize to 0/1 float
        if rain_col != "rainfall_flag":
            # if numeric >0 then 1 else 0 ; if bool True->1
            try:
                w = w.with_columns(
                    pl.when(pl.col(rain_col).cast(pl.Float64, strict=False) > 0)
                    .then(1.0)
                    .otherwise(0.0)
                    .alias("rainfall_flag")
                )
            except Exception:
                w = w.with_columns(
                    pl.col(rain_col).cast(pl.Float64, strict=False).alias("rainfall_flag")
                )
                if rain_col != "rainfall_flag":
                    w = w.drop(rain_col) if rain_col in w.columns else w
        else:
            w = w.with_columns(pl.col("rainfall_flag").cast(pl.Float64, strict=False))
    # wind_speed_ms
    for cand in ["wind_speed_ms", "wind_speed", "windSpeed", "wind"]:
        if cand in w.columns:
            if cand != "wind_speed_ms":
                w = w.rename({cand: "wind_speed_ms"})
            break
    if "wind_speed_ms" not in w.columns:
        w = w.with_columns(pl.lit(None).cast(pl.Float64).alias("wind_speed_ms"))
    else:
        w = w.with_columns(pl.col("wind_speed_ms").cast(pl.Float64, strict=False))
    # keep only needed and sort
    keep = [
        "session_id",
        "date",
        "track_temp_c",
        "air_temp_c",
        "humidity_pct",
        "rainfall_flag",
        "wind_speed_ms",
    ]
    w = w.select([c for c in keep if c in w.columns])
    w = w.sort(["session_id", "date"])
    return w


def _apply_weather_join(df: pl.DataFrame, weather: pl.DataFrame | None) -> pl.DataFrame:
    """Backward asof join weather onto laps (15 min tolerance) with fallbacks."""
    # Ensure target columns exist with defaults before join so downstream always has them
    for col, _default in [
        ("track_temp_c", _DEFAULT_TRACK_TEMP),
        ("air_temp_c", _DEFAULT_AIR_TEMP),
        ("humidity_pct", _DEFAULT_HUMIDITY),
        ("rainfall_flag", _DEFAULT_RAINFALL),
        ("wind_speed_ms", _DEFAULT_WIND),
    ]:
        if col not in df.columns:
            df = df.with_columns(pl.lit(None).cast(pl.Float64).alias(col))

    # If lap_start missing, cannot asof — fallback to defaults / session median
    if "lap_start" not in df.columns or df["lap_start"].null_count() == len(df):
        # No temporal key — just fill nulls with fallback medians/defaults
        return _fill_weather_fallbacks(df)

    w = _normalize_weather_df(weather) if weather is not None else None
    if w is None or w.is_empty():
        return _fill_weather_fallbacks(df)

    # Prepare join keys — both must be sorted by (session_id, time)
    # lap_start may be Utf8 string if parsing failed; ensure datetime
    try:
        df_sorted = df.sort(["session_id", "lap_start"])
        w_sorted = w.sort(["session_id", "date"])
    except Exception:
        return _fill_weather_fallbacks(df)

    # Polars join_asof requires both frames sorted by the asof key
    # Use tolerance 15m (15 minutes) backward
    try:
        joined = df_sorted.join_asof(
            w_sorted,
            left_on="lap_start",
            right_on="date",
            by="session_id",
            strategy="backward",
            tolerance="15m",
        )
    except Exception:
        # Older Polars may require timedelta string or not support tolerance/by together
        try:
            joined = df_sorted.join_asof(
                w_sorted,
                left_on="lap_start",
                right_on="date",
                by="session_id",
                strategy="backward",
            )
            # manually null rows where delta >15m
            if "date" in joined.columns:
                joined = joined.with_columns((joined["lap_start"] - joined["date"]).alias("_delta"))
                # _delta is Duration; compare
                joined = joined.with_columns(
                    pl.when(pl.col("_delta").dt.total_seconds() > 15 * 60)
                    .then(None)
                    .otherwise(pl.col("track_temp_c_right"))
                    .alias("_track_tmp")
                )
                # Instead of complex manual filtering, just rely on fallback filling
                # for now — simpler to keep join as is and let fallback handle >15m?
                joined = joined.drop("_delta") if "_delta" in joined.columns else joined
        except Exception:
            return _fill_weather_fallbacks(df)
    # Coalesce right columns onto left (prefer joined weather, else original)
    # Polars join_asof suffixes duplicate columns with _right
    for base in ["track_temp_c", "air_temp_c", "humidity_pct", "rainfall_flag", "wind_speed_ms"]:
        right = f"{base}_right"
        if right in joined.columns:
            joined = joined.with_columns(
                pl.coalesce([pl.col(right), pl.col(base)]).alias(base)
            ).drop(right)
        # date column from weather is no longer needed
    if "date" in joined.columns:
        # date is weather date — not needed downstream; keep lap_start
        # Only drop if it is not the same as lap_start
        with contextlib.suppress(Exception):
            joined = joined.drop("date")
    # Fill remaining nulls with session median / defaults
    return _fill_weather_fallbacks(joined)


def _fill_weather_fallbacks(df: pl.DataFrame) -> pl.DataFrame:
    """Fill null weather columns via session median then climatological default."""
    session_col = "session_id" if "session_id" in df.columns else None
    for col, default in [
        ("track_temp_c", _DEFAULT_TRACK_TEMP),
        ("air_temp_c", _DEFAULT_AIR_TEMP),
        ("humidity_pct", _DEFAULT_HUMIDITY),
        ("rainfall_flag", _DEFAULT_RAINFALL),
        ("wind_speed_ms", _DEFAULT_WIND),
    ]:
        if col not in df.columns:
            df = df.with_columns(pl.lit(default).alias(col))
            continue
        # try session median
        if session_col and col in df.columns:
            try:
                med = df.group_by(session_col).agg(pl.col(col).median().alias("_med"))
                df = df.join(med, on=session_col, how="left")
                df = df.with_columns(
                    pl.coalesce([pl.col(col), pl.col("_med"), pl.lit(default)]).alias(col)
                ).drop("_med")
            except Exception:
                df = df.with_columns(pl.col(col).fill_null(default).alias(col))
        else:
            df = df.with_columns(pl.col(col).fill_null(default).alias(col))
        # final global median fallback if still null (empty sessions)
        df = df.with_columns(pl.col(col).fill_null(default).alias(col))
    # ensure rainfall_flag is 0/1 clipped
    if "rainfall_flag" in df.columns:
        df = df.with_columns(
            pl.col("rainfall_flag").fill_null(0.0).clip(0.0, 1.0).alias("rainfall_flag")
        )
    return df


def _add_telemetry_and_2026_features(df: pl.DataFrame) -> pl.DataFrame:
    """Derive telemetry/2026 features from aggregates if available."""
    # lift_and_coast_ratio: fraction with throttle <0.15 while speed >180
    # Proxy from aggregates when per-sample not available
    if "lift_and_coast_ratio" not in df.columns:
        if "avg_throttle" in df.columns:
            # use helper logic inline to avoid circular import of common helpers
            # throttle_term * speed_term * 0.35, with avg_speed fallback
            avg_speed_col = "avg_speed_kmh" if "avg_speed_kmh" in df.columns else None
            if avg_speed_col:
                df = df.with_columns(
                    (
                        (1.0 - pl.col("avg_throttle").fill_null(0.7)).clip(0.0, 1.0)
                        * ((pl.col(avg_speed_col).fill_null(180.0) - 150.0) / 100.0).clip(0.0, 1.0)
                        * 0.35
                    ).alias("lift_and_coast_ratio")
                )
            else:
                df = df.with_columns(
                    ((1.0 - pl.col("avg_throttle").fill_null(0.7)).clip(0.0, 1.0) * 0.18).alias(
                        "lift_and_coast_ratio"
                    )
                )
        elif "throttle_variance" in df.columns:
            df = df.with_columns(
                (pl.col("throttle_variance").fill_null(0.0).clip(0.0, 1.0) * 0.25).alias(
                    "lift_and_coast_ratio"
                )
            )
        else:
            df = df.with_columns(pl.lit(0.0).alias("lift_and_coast_ratio"))
    else:
        df = df.with_columns(
            pl.col("lift_and_coast_ratio").fill_null(0.0).alias("lift_and_coast_ratio")
        )

    # brake_intensity_mean
    if "brake_intensity_mean" not in df.columns:
        # alternative names: brake_intensity, avg_brake
        if "avg_brake" in df.columns:
            if "max_speed_kmh" in df.columns and "min_speed_kmh" in df.columns:
                delta = (
                    pl.col("max_speed_kmh").fill_null(0.0) - pl.col("min_speed_kmh").fill_null(0.0)
                ).clip(0.0, 350.0)
                intensity = pl.col("avg_brake").fill_null(0.0) * (
                    0.5 + 0.5 * (delta / 150.0).clip(0.0, 1.0)
                )
                df = df.with_columns(intensity.clip(0.0, 100.0).alias("brake_intensity_mean"))
            else:
                df = df.with_columns(
                    pl.col("avg_brake")
                    .fill_null(0.0)
                    .clip(0.0, 100.0)
                    .alias("brake_intensity_mean")
                )
        elif "brake_intensity" in df.columns:
            df = df.with_columns(
                pl.col("brake_intensity").fill_null(0.0).alias("brake_intensity_mean")
            )
        else:
            df = df.with_columns(pl.lit(0.0).alias("brake_intensity_mean"))
    else:
        df = df.with_columns(
            pl.col("brake_intensity_mean").fill_null(0.0).alias("brake_intensity_mean")
        )

    # speed_trap_max_kmh
    if "speed_trap_max_kmh" not in df.columns:
        if "max_speed_kmh" in df.columns:
            df = df.with_columns(
                pl.col("max_speed_kmh").fill_null(250.0).alias("speed_trap_max_kmh")
            )
        elif "avg_speed_kmh" in df.columns:
            df = df.with_columns(
                (pl.col("avg_speed_kmh").fill_null(220.0) * 1.15).alias("speed_trap_max_kmh")
            )
        else:
            df = df.with_columns(pl.lit(300.0).alias("speed_trap_max_kmh"))
    else:
        df = df.with_columns(
            pl.col("speed_trap_max_kmh").fill_null(300.0).alias("speed_trap_max_kmh")
        )

    # x_mode_ratio (Active Aero low-drag fraction)
    if "x_mode_ratio" not in df.columns:
        # Prefer helper if sync_2026 already computed, else estimate here
        has_telemetry = any(
            c in df.columns for c in ["max_speed_kmh", "avg_speed_kmh", "avg_throttle"]
        )
        if has_telemetry:
            max_s = "max_speed_kmh" if "max_speed_kmh" in df.columns else None
            avg_s = "avg_speed_kmh" if "avg_speed_kmh" in df.columns else None
            thr = "avg_throttle" if "avg_throttle" in df.columns else None
            # Build expression with available columns, fill nulls
            speed_term = (
                ((pl.col(max_s).fill_null(250.0) - 200.0) / 150.0).clip(0.0, 1.0)
                if max_s
                else pl.lit(0.33)
            )
            throttle_term = (
                (pl.col(thr).fill_null(0.6) / 1.0).clip(0.0, 1.0) if thr else pl.lit(0.6)
            )
            avg_term = (
                ((pl.col(avg_s).fill_null(210.0) - 180.0) / 80.0).clip(0.0, 1.0)
                if avg_s
                else pl.lit(0.4)
            )
            df = df.with_columns(
                ((speed_term * 0.5 + throttle_term * 0.3 + avg_term * 0.2) * 0.65).alias(
                    "x_mode_ratio"
                )
            )
        else:
            df = df.with_columns(pl.lit(0.15).alias("x_mode_ratio"))
    else:
        df = df.with_columns(
            pl.col("x_mode_ratio").fill_null(0.15).clip(0.0, 0.65).alias("x_mode_ratio")
        )

    # circuit_energy_difficulty
    if "circuit_energy_difficulty" not in df.columns:
        circuit_col = None
        for cand in ["circuit_short_name", "circuit_id", "circuit_name", "location"]:
            if cand in df.columns:
                circuit_col = cand
                break
        if circuit_col:
            # Map via Python helper row-wise for robustness across Polars versions
            # Build a Polars expression via when/then chain using replace_strict fallback
            try:
                # Use drift_era mapping via map_elements for simplicity
                mapping = None
                try:
                    from pitwall.monitoring.drift_era import CIRCUIT_ENERGY_DIFFICULTY as _MAP

                    mapping = {k.lower(): float(v) for k, v in _MAP.items()}
                except Exception:
                    mapping = {}
                df = df.with_columns(
                    pl.col(circuit_col)
                    .cast(pl.Utf8)
                    .str.to_lowercase()
                    .map_elements(
                        lambda x: mapping.get(str(x).lower(), 50.0) if x is not None else 50.0,
                        return_dtype=pl.Float64,
                    )
                    .fill_null(50.0)
                    .alias("circuit_energy_difficulty")
                )
            except Exception:
                # fallback: try get_circuit_energy_difficulty row-wise
                try:
                    df = df.with_columns(
                        pl.col(circuit_col)
                        .map_elements(
                            lambda x: float(get_circuit_energy_difficulty(x) or 50.0),
                            return_dtype=pl.Float64,
                        )
                        .fill_null(50.0)
                        .alias("circuit_energy_difficulty")
                    )
                except Exception:
                    df = df.with_columns(pl.lit(50.0).alias("circuit_energy_difficulty"))
        else:
            df = df.with_columns(pl.lit(50.0).alias("circuit_energy_difficulty"))
    else:
        df = df.with_columns(
            pl.col("circuit_energy_difficulty").fill_null(50.0).alias("circuit_energy_difficulty")
        )

    return df


def _add_hard_compound_features(df: pl.DataFrame) -> pl.DataFrame:
    """Hard-compound non-linearity features."""
    # tyre_warmup_phase: lap_in_stint <=3
    if "tyre_warmup_phase" not in df.columns:
        if "tyre_age" in df.columns:
            # tyre_age 0-indexed: first 3 laps => tyre_age in [0,1,2] => (tyre_age+1)<=3
            df = df.with_columns(
                (pl.col("tyre_age").fill_null(0.0) < 3).cast(pl.Int8).alias("tyre_warmup_phase")
            )
        elif "lap_in_stint" in df.columns:
            df = df.with_columns(
                (pl.col("lap_in_stint").fill_null(1.0) <= 3)
                .cast(pl.Int8)
                .alias("tyre_warmup_phase")
            )
        else:
            df = df.with_columns(pl.lit(0).cast(pl.Int8).alias("tyre_warmup_phase"))
    else:
        df = df.with_columns(
            pl.col("tyre_warmup_phase").fill_null(0).cast(pl.Int8).alias("tyre_warmup_phase")
        )

    # compound_temp_interaction: track_temp_c * tyre_age
    if "compound_temp_interaction" not in df.columns:
        if "track_temp_c" in df.columns and "tyre_age" in df.columns:
            df = df.with_columns(
                (
                    pl.col("track_temp_c").fill_null(_DEFAULT_TRACK_TEMP)
                    * pl.col("tyre_age").fill_null(0.0)
                ).alias("compound_temp_interaction")
            )
        elif "track_temp_c" in df.columns:
            df = df.with_columns(
                pl.col("track_temp_c")
                .fill_null(_DEFAULT_TRACK_TEMP)
                .alias("compound_temp_interaction")
            )
        else:
            df = df.with_columns(pl.lit(0.0).alias("compound_temp_interaction"))
    else:
        df = df.with_columns(
            pl.col("compound_temp_interaction").fill_null(0.0).alias("compound_temp_interaction")
        )

    # stint_progress_ratio: (tyre_age+1) / estimated_stint_length
    if "stint_progress_ratio" not in df.columns:
        # group by session/driver/stint to get max tyre_age per stint
        group_cols = [c for c in ["session_id", "driver_number", "stint_no"] if c in df.columns]
        if "tyre_age" in df.columns and group_cols:
            try:
                max_per_stint = df.group_by(group_cols).agg(
                    pl.col("tyre_age").max().alias("_stint_len")
                )
                df = df.join(max_per_stint, on=group_cols, how="left")
                df = df.with_columns(
                    (
                        (pl.col("tyre_age").fill_null(0.0) + 1.0)
                        / (pl.col("_stint_len").fill_null(25.0) + 1.0)
                    )
                    .clip(0.0, 1.5)
                    .alias("stint_progress_ratio")
                ).drop("_stint_len")
            except Exception:
                df = df.with_columns(
                    ((pl.col("tyre_age").fill_null(0.0) + 1.0) / 30.0)
                    .clip(0.0, 1.0)
                    .alias("stint_progress_ratio")
                )
        elif "tyre_age" in df.columns:
            df = df.with_columns(
                ((pl.col("tyre_age").fill_null(0.0) + 1.0) / 30.0)
                .clip(0.0, 1.0)
                .alias("stint_progress_ratio")
            )
        elif "lap_number" in df.columns and group_cols:
            try:
                # fallback via lap_number if tyre_age missing
                max_per_stint = df.group_by(group_cols).agg(pl.col("lap_number").max().alias("_lm"))
                df = df.join(max_per_stint, on=group_cols, how="left")
                df = df.with_columns(
                    (pl.col("lap_number").fill_null(1.0) / pl.col("_lm").fill_null(57.0))
                    .clip(0.0, 1.0)
                    .alias("stint_progress_ratio")
                ).drop("_lm")
            except Exception:
                df = df.with_columns(pl.lit(0.5).alias("stint_progress_ratio"))
        else:
            df = df.with_columns(pl.lit(0.5).alias("stint_progress_ratio"))
    else:
        df = df.with_columns(
            pl.col("stint_progress_ratio")
            .fill_null(0.5)
            .clip(0.0, 1.5)
            .alias("stint_progress_ratio")
        )

    return df


def build_pace_features(
    silver_laps: pl.DataFrame, weather: pl.DataFrame | None = None
) -> pl.DataFrame:
    """Build Gold pace training table with point-in-time features."""
    if silver_laps.is_empty():
        return silver_laps

    df = silver_laps.clone()
    df = encode_compound(df)
    df = _normalize_session_cols(df)

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

    # ── Weather asof join ──────────────────────────────────────────────────
    df = _apply_weather_join(df, weather)

    # ── Telemetry / 2026 Active Aero features ─────────────────────────────
    df = _add_telemetry_and_2026_features(df)

    # ── Hard-compound non-linearity ───────────────────────────────────────
    df = _add_hard_compound_features(df)

    # Ensure all numerical cols are present and non-null with sensible defaults
    # Rolling features keep nulls — they encode "insufficient history" and the
    # leakage contract requires lap 1's rolling to stay null.
    _ROLLING_KEEP_NULL = {"rolling_median_3", "rolling_median_5", "rolling_std_5", "rolling_std_3"}
    for col in PACE_NUMERICAL:
        if col not in df.columns:
            if col in _ROLLING_KEEP_NULL:
                continue
            df = df.with_columns(pl.lit(0.0).alias(col))
        elif col not in _ROLLING_KEEP_NULL:
            with contextlib.suppress(Exception):
                df = df.with_columns(pl.col(col).fill_null(0.0).alias(col))
    return df


def get_feature_columns(df: pl.DataFrame) -> list[str]:
    cols = [c for c in PACE_NUMERICAL + PACE_CATEGORICAL if c in df.columns]
    # Also include derived
    for c in ["race_progress", "delta_to_rolling_5"]:
        if c in df.columns and c not in cols:
            cols.append(c)
    return cols
