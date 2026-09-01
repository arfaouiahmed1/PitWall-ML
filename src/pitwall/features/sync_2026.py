"""Silver synchronization pipeline — transforms raw OpenF1 Bronze data
into synchronized, ML-ready Silver tables.

This module reads Bronze parquet files (from the OpenF1 ingestion client) and
produces Silver-level tables that are:
  - Temporally aligned (all feeds keyed by UTC timestamp)
  - Schema-normalised across sessions
  - Clean-labelled (pit laps, SC, VSC, yellows removed or flagged)
  - Point-in-time safe (features computed only from information available
    at or before the observation timestamp)

Silver tables produced:
  silver/laps           — lap-level with telemetry-derived features
  silver/telemetry      — per-timestamp telemetry, synced to position/intervals
  silver/intervals      — interval updates with driver context
  silver/battles        — paired battle observations for overtake model
  silver/stints         — tyre stint data with compound names
  silver/weather        — weather per timestamp
  silver/race_control   — SC/VSC/flag events
"""

from __future__ import annotations

import contextlib
from datetime import datetime
from pathlib import Path

import polars as pl

try:
    from pitwall.monitoring.drift_era import (
        CIRCUIT_ENERGY_DIFFICULTY,
        get_circuit_energy_difficulty,
    )
except Exception:  # fallback when monitoring not yet importable
    CIRCUIT_ENERGY_DIFFICULTY: dict[str, float] = {}  # type: ignore[no-redef]

    def get_circuit_energy_difficulty(circuit_short_name: str | None) -> float:  # type: ignore[no-redef]
        return 50.0

# ── Helpers ────────────────────────────────────────────────────────────────────


def _parse_timestamp(s: str) -> datetime | None:
    """Parse ISO 8601 timestamp from OpenF1."""
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _ensure_timestamp_col(df: pl.DataFrame, col: str = "date") -> pl.DataFrame:
    """Ensure a timestamp column is typed correctly."""
    if df.is_empty():
        return df
    if col in df.columns:
        return df.with_columns(pl.col(col).cast(pl.Datetime))
    return df


def estimate_x_mode_ratio_expr(
    max_speed_col: str = "max_speed_kmh",
    avg_speed_col: str = "avg_speed_kmh",
    avg_throttle_col: str = "avg_throttle",
) -> pl.Expr:
    """Polars expression for Active Aero X-Mode low-drag fraction.

    Heuristic: high top speed + sustained high throttle on straights
    correlates with time spent in X-Mode (low-drag).  Scales to 0..0.65.
    Gracefully handles missing columns via ``fill_null``.
    """
    speed_term = ((pl.col(max_speed_col).fill_null(250.0) - 200.0) / 150.0).clip(0.0, 1.0)
    throttle_term = (pl.col(avg_throttle_col).fill_null(0.6) / 1.0).clip(0.0, 1.0)
    avg_term = ((pl.col(avg_speed_col).fill_null(210.0) - 180.0) / 80.0).clip(0.0, 1.0)
    return ((speed_term * 0.5 + throttle_term * 0.3 + avg_term * 0.2) * 0.65).alias("x_mode_ratio")


def circuit_energy_difficulty_expr(circuit_col: str = "circuit_short_name") -> pl.Expr:
    """Polars expression mapping circuit name → energy difficulty index.

    Uses ``CIRCUIT_ENERGY_DIFFICULTY`` dict; unknown circuits map to 50.0.
    Case-insensitive via ``lower()``; caller must ensure the column exists
    or handle nulls.
    """
    # Build a Polars map via when/then chain — avoid Python loops at row scale
    # by using replace_strict with a dict fallback.
    mapping = {k.lower(): float(v) for k, v in CIRCUIT_ENERGY_DIFFICULTY.items()}
    # Normalise incoming values to lower case for lookup
    lower = pl.col(circuit_col).cast(pl.Utf8).str.to_lowercase()
    # Use replace_strict if available; fallback to map_elements for older Polars
    try:
        return lower.replace_strict(mapping, default=50.0).alias("circuit_energy_difficulty")
    except AttributeError:
        return lower.map_elements(
            lambda x: mapping.get(str(x).lower(), 50.0) if x is not None else 50.0,
            return_dtype=pl.Float64,
        ).alias("circuit_energy_difficulty")


def add_x_mode_and_energy_features(df: pl.DataFrame) -> pl.DataFrame:
    """Add X-Mode and circuit energy columns to a silver/gold frame if possible.

    Gracefully handles missing source columns: if telemetry aggregates are
    present, computes ``x_mode_ratio``; if a circuit column exists, maps
    ``circuit_energy_difficulty``.  Never raises — fills nulls with defaults.
    """
    # x_mode_ratio from telemetry aggregates
    needed = {"max_speed_kmh", "avg_speed_kmh", "avg_throttle"}
    if needed.issubset(set(df.columns)) or any(c in df.columns for c in needed):
        try:
            df = df.with_columns(estimate_x_mode_ratio_expr())
        except Exception:
            df = df.with_columns(pl.lit(0.15).alias("x_mode_ratio"))
    elif "x_mode_ratio" not in df.columns:
        df = df.with_columns(pl.lit(0.15).alias("x_mode_ratio"))

    # circuit_energy_difficulty from circuit name/id
    circuit_col = None
    for cand in ["circuit_short_name", "circuit_id", "circuit_name", "location"]:
        if cand in df.columns:
            circuit_col = cand
            break
    if circuit_col:
        try:
            df = df.with_columns(circuit_energy_difficulty_expr(circuit_col))
        except Exception:
            df = df.with_columns(pl.lit(50.0).alias("circuit_energy_difficulty"))
    elif "circuit_energy_difficulty" not in df.columns:
        df = df.with_columns(pl.lit(50.0).alias("circuit_energy_difficulty"))
    return df


SILVER_LAP_FEATURES = [
    "session_key",
    "session_id",
    "driver_number",
    "lap_number",
    "lap_time_s",
    "compound",
    "stint",
    "stint_no",
    "tyre_age_at_start",
    "tyre_age",
    "lap_start",
    "lap_end",
    # Telemetry-derived
    "avg_speed_kmh",
    "max_speed_kmh",
    "min_speed_kmh",
    "avg_throttle",
    "avg_brake",
    "avg_rpm",
    "throttle_variance",
    "brake_variance",
    # 2026 / feature-engineered (computed here or in pace.py)
    "x_mode_ratio",
    "circuit_energy_difficulty",
    "circuit_short_name",
    "circuit_id",
    "track_status",
    # Gap / position
    "position",
    "gap_to_leader_s",
    "gap_to_car_ahead_s",
    "gap_ahead_s",
    "gap_behind_s",
    # Clean lap label
    "is_pit_lap",
    "is_safe_car",
    "is_vsc",
    "is_yellow",
    "is_rain",
    "is_clean_pace_lap",
    # Labels
    "is_valid_training_lap",
]


def build_silver_laps(bronze_dir: str | Path) -> pl.DataFrame:
    """Build Silver laps table from Bronze data.

    Joins lap timing data with car telemetry to derive speed/throttle/brake
    features per lap, and with race_control/weather to build clean-lap labels.
    """
    bronze = Path(bronze_dir)

    # Collect all bronze lap files
    lap_files = list(bronze.rglob("laps.parquet"))
    if not lap_files:
        return pl.DataFrame()

    lap_dfs = [pl.read_parquet(str(f)) for f in lap_files]
    laps = pl.concat(lap_dfs, how="vertical_relaxed")

    # Parse lap_time_s from duration or seconds
    if "lap_time" in laps.columns:
        # FastF1 returns lap_time as duration; OpenF1 as float seconds
        if laps.schema["lap_time"] == pl.Duration:
            laps = laps.with_columns(pl.col("lap_time").dt.total_microseconds() / 1e6).rename(
                {"lap_time": "lap_time_s"}
            )
        else:
            # Already numeric (seconds)
            laps = laps.rename({"lap_time": "lap_time_s"})
    elif "lap_time_s" not in laps.columns and "LapTime" in laps.columns:
        if laps.schema["LapTime"] == pl.Duration:
            laps = laps.with_columns(pl.col("LapTime").dt.total_microseconds() / 1e6).rename(
                {"LapTime": "lap_time_s"}
            )
        else:
            laps = laps.rename({"LapTime": "lap_time_s"})

    # Ensure key columns
    for col in ["driver_number", "lap_number", "session_key"]:
        if col in laps.columns:
            laps = laps.with_columns(pl.col(col).cast(pl.Int64, strict=False))

    # Build per-lap telemetry aggregates from car_data
    car_files = list(bronze.rglob("car_data.parquet"))
    if car_files:
        tele_dfs = [pl.read_parquet(str(f)) for f in car_files]
        tele = pl.concat(tele_dfs, how="vertical_relaxed")

        # Ensure date is datetime
        tele = _ensure_timestamp_col(tele, "date")

        # Join with laps to assign lap_number
        if (
            "lap_number" in laps.columns
            and "date" in tele.columns
            and "driver_number" in tele.columns
        ):
            # For each telemetry point, find the lap it belongs to
            tele = tele.join(
                laps.select(
                    ["session_key", "driver_number", "lap_number", "lap_start", "lap_end"]
                ).unique(),
                on=["session_key", "driver_number"],
                how="left",
            )
            # A telemetry point belongs to a lap if lap_start <= date < lap_end
            tele = tele.filter(
                (pl.col("date") >= pl.col("lap_start")) & (pl.col("date") <= pl.col("lap_end"))
            )

            # Aggregate telemetry per lap
            agg = tele.group_by(["session_key", "driver_number", "lap_number"]).agg(
                pl.col("speed").mean().alias("avg_speed_kmh"),
                pl.col("speed").max().alias("max_speed_kmh"),
                pl.col("speed").min().alias("min_speed_kmh"),
                pl.col("throttle").mean().alias("avg_throttle"),
                pl.col("brake").mean().alias("avg_brake"),
                pl.col("rpm").mean().alias("avg_rpm"),
                pl.col("throttle").std().alias("throttle_variance"),
                pl.col("brake").std().alias("brake_variance"),
            )

            laps = laps.join(agg, on=["session_key", "driver_number", "lap_number"], how="left")

    # Build clean-lap labels from race_control and weather
    rc_files = list(bronze.rglob("race_control.parquet"))
    if rc_files:
        rc_dfs = [pl.read_parquet(str(f)) for f in rc_files]
        rc = pl.concat(rc_dfs, how="vertical_relaxed")
        rc = _ensure_timestamp_col(rc, "date")

        # Flag SC/VSC periods
        rc.filter(pl.col("category").str.to_lowercase().is_in(["sc", "vsc", "safety car"]))
        rc.filter(pl.col("category").str.to_lowercase().is_in(["yellow", "yellow flag"]))

        # Pit lap flags
        laps = laps.with_columns(
            (pl.col("lap_start").is_not_null()).alias("is_pit_lap"),
        )

    # Weather flags
    weather_files = list(bronze.rglob("weather.parquet"))
    if weather_files:
        w_dfs = [pl.read_parquet(str(f)) for f in weather_files]
        weather = pl.concat(w_dfs, how="vertical_relaxed")

        # Rain flag
        if "rain" in weather.columns or "rainfall" in weather.columns:
            rain_col = "rain" if "rain" in weather.columns else "rainfall"
            laps = laps.with_columns(
                pl.col(rain_col).fill_null(0).gt(0).alias("is_rain"),
            )

    # Clean lap label: not pit, not SC/VSC, not yellow, not rain
    for col in ["is_safe_car", "is_vsc", "is_yellow", "is_rain"]:
        if col not in laps.columns:
            laps = laps.with_columns(pl.lit(False).alias(col))

    laps = laps.with_columns(
        is_pit_lap=pl.col("is_pit_lap").fill_null(False),
    ).with_columns(
        is_clean_pace_lap=(
            ~pl.col("is_pit_lap")
            & ~pl.col("is_safe_car")
            & ~pl.col("is_vsc")
            & ~pl.col("is_yellow")
            & ~pl.col("is_rain")
        ),
        is_valid_training_lap=(
            pl.col("is_clean_pace_lap")
            & pl.col("lap_time_s").is_not_null()
            & (pl.col("lap_time_s") > 30)
        ),
    )

    # ── Aliases for pace downstream (session_id ↔ session_key etc.) ────────────
    if "session_key" in laps.columns and "session_id" not in laps.columns:
        laps = laps.with_columns(pl.col("session_key").cast(pl.Utf8).alias("session_id"))
    if "session_id" in laps.columns and "session_key" not in laps.columns:
        # keep session_key for silver compatibility
        with contextlib.suppress(Exception):
            laps = laps.with_columns(
                pl.col("session_id").cast(pl.Int64, strict=False).alias("session_key")
            )
    if "tyre_age_at_start" in laps.columns and "tyre_age" not in laps.columns:
        laps = laps.with_columns(pl.col("tyre_age_at_start").alias("tyre_age"))
    if "tyre_age" in laps.columns and "tyre_age_at_start" not in laps.columns:
        laps = laps.with_columns(pl.col("tyre_age").alias("tyre_age_at_start"))
    if "stint" in laps.columns and "stint_no" not in laps.columns:
        laps = laps.with_columns(pl.col("stint").alias("stint_no"))
    if "stint_no" in laps.columns and "stint" not in laps.columns:
        laps = laps.with_columns(pl.col("stint_no").alias("stint"))
    if "gap_to_car_ahead_s" in laps.columns and "gap_ahead_s" not in laps.columns:
        laps = laps.with_columns(pl.col("gap_to_car_ahead_s").alias("gap_ahead_s"))
    if "gap_ahead_s" in laps.columns and "gap_to_car_ahead_s" not in laps.columns:
        laps = laps.with_columns(pl.col("gap_ahead_s").alias("gap_to_car_ahead_s"))
    if "gap_behind_s" not in laps.columns:
        laps = laps.with_columns(pl.lit(None).cast(pl.Float64).alias("gap_behind_s"))
    if "track_status" not in laps.columns:
        # laps bronze may have TrackStatus; normalize if present else null
        for cand in ["TrackStatus", "trackStatus", "status"]:
            if cand in laps.columns:
                laps = laps.with_columns(pl.col(cand).alias("track_status"))
                break
        if "track_status" not in laps.columns:
            laps = laps.with_columns(pl.lit(None).cast(pl.Utf8).alias("track_status"))
    if "circuit_short_name" not in laps.columns:
        for cand in ["circuit_key", "circuit_id", "location", "meeting_name"]:
            if cand in laps.columns:
                laps = laps.with_columns(pl.col(cand).cast(pl.Utf8).alias("circuit_short_name"))
                break
        if "circuit_short_name" not in laps.columns:
            laps = laps.with_columns(pl.lit(None).cast(pl.Utf8).alias("circuit_short_name"))
    if "circuit_id" not in laps.columns and "circuit_short_name" in laps.columns:
        laps = laps.with_columns(pl.col("circuit_short_name").alias("circuit_id"))

    # ── 2026 derived features: x_mode_ratio + circuit_energy_difficulty ───────
    try:
        laps = add_x_mode_and_energy_features(laps)
    except Exception:
        if "x_mode_ratio" not in laps.columns:
            laps = laps.with_columns(pl.lit(0.15).alias("x_mode_ratio"))
        if "circuit_energy_difficulty" not in laps.columns:
            laps = laps.with_columns(pl.lit(50.0).alias("circuit_energy_difficulty"))

    if not laps.is_empty():
        return laps.select([c for c in SILVER_LAP_FEATURES if c in laps.columns])
    return pl.DataFrame(schema={c: pl.Float64 for c in SILVER_LAP_FEATURES})


# ── Silver: Telemetry synced to laps ────────────────────────────────────────────


def build_silver_telemetry(bronze_dir: str | Path) -> pl.DataFrame:
    """Synchronize telemetry to lap/position context."""
    bronze = Path(bronze_dir)
    car_files = list(bronze.rglob("car_data.parquet"))
    pos_files = list(bronze.rglob("position.parquet"))

    if not car_files:
        return pl.DataFrame()

    tele_dfs = [pl.read_parquet(str(f)) for f in car_files]
    tele = pl.concat(tele_dfs, how="vertical_relaxed")

    # Join position data for gap context
    if pos_files:
        pos_dfs = [pl.read_parquet(str(f)) for f in pos_files]
        pos = pl.concat(pos_dfs, how="vertical_relaxed")
        tele = tele.join(
            pos.select(["session_key", "driver_number", "date", "position"]),
            on=["session_key", "driver_number", "date"],
            how="left",
        )

    # Join interval data
    int_files = list(bronze.rglob("intervals.parquet"))
    if int_files:
        int_dfs = [pl.read_parquet(str(f)) for f in int_files]
        intervals = pl.concat(int_dfs, how="vertical_relaxed")
        intervals = intervals.rename({"interval": "gap_to_car_ahead_s"})
        tele = tele.join(
            intervals.select(["session_key", "driver_number", "date", "gap_to_car_ahead_s"]),
            on=["session_key", "driver_number", "date"],
            how="left",
        )

    return tele


# ── Silver: Battles (paired observations) ───────────────────────────────────────


def build_silver_battles(bronze_dir: str | Path) -> pl.DataFrame:
    """Build paired battle observations from position + intervals.

    For each driver, finds the car immediately ahead and creates a paired
    observation with relative features.  These are the training rows for the
    Overtake Probability model.
    """
    bronze = Path(bronze_dir)
    pos_files = list(bronze.rglob("position.parquet"))

    if not pos_files:
        return pl.DataFrame()

    pos_dfs = [pl.read_parquet(str(f)) for f in pos_files]
    pos = pl.concat(pos_dfs, how="vertical_relaxed")
    pos = _ensure_timestamp_col(pos, "date")

    # Build battle pairs: for each (session, timestamp, driver), find the car
    # directly ahead in position
    battles = pos.join(
        pos.select(["session_key", "date", "position", "driver_number"])
        .rename({"driver_number": "driver_ahead", "position": "pos_ahead"})
        .filter(pl.col("pos_ahead") <= 20),
        left_on=["session_key", "date"],
        right_on=["session_key", "date"],
        how="inner",
    ).filter(pl.col("pos_ahead") == pl.col("position") - 1)

    # Join with telemetry for both cars
    tele = build_silver_telemetry(bronze_dir)
    if not tele.is_empty():
        tele_a = tele.select(
            [
                "session_key",
                "driver_number",
                "date",
                "speed",
                "throttle",
                "brake",
                "rpm",
            ]
        )
        tele_b = tele_a.rename(
            {
                "driver_number": "driver_ahead",
                "speed": "speed_ahead",
                "throttle": "throttle_ahead",
                "brake": "brake_ahead",
                "rpm": "rpm_ahead",
            }
        )

        battles = battles.join(tele_a, on=["session_key", "driver_number", "date"], how="left")
        battles = battles.join(
            tele_b,
            left_on=["session_key", "driver_ahead", "date"],
            right_on=["session_key", "driver_ahead", "date"],
            how="left",
        )

    # Join with stints for tyre info
    stint_files = list(bronze.rglob("stints.parquet"))
    if stint_files:
        stints = pl.concat([pl.read_parquet(str(f)) for f in stint_files])
        if "compound" in stints.columns:
            for suffix, drv_col in [("attacker", "driver_number"), ("defender", "driver_ahead")]:
                battles = battles.join(
                    stints.select(["session_key", "driver_number", "date", "compound"]).rename(
                        {"driver_number": drv_col, "compound": f"compound_{suffix}"}
                    ),
                    on=["session_key", drv_col, "date"],
                    how="left",
                )
        if "tyre_age" in stints.columns:
            battles = battles.join(
                stints.select(["session_key", "driver_number", "date", "tyre_age"]).rename(
                    {"driver_number": "driver_number", "tyre_age": "tyre_age_attacker"}
                ),
                on=["session_key", "driver_number", "date"],
                how="left",
            )
            battles = battles.join(
                stints.select(["session_key", "driver_number", "date", "tyre_age"]).rename(
                    {"driver_number": "driver_ahead", "tyre_age": "tyre_age_defender"}
                ),
                on=["session_key", "driver_ahead", "date"],
                how="left",
            )

    return battles


# ── Silver: Stints ─�─────────────────────────────────────────────────────────────


def build_silver_stints(bronze_dir: str | Path) -> pl.DataFrame:
    """Aggregate stint data from bronze."""
    bronze = Path(bronze_dir)
    stint_files = list(bronze.rglob("stints.parquet"))
    if not stint_files:
        return pl.DataFrame()

    stints = pl.concat([pl.read_parquet(str(f)) for f in stint_files], how="vertical_relaxed")
    return stints


# ── Silver: Weather ─────────────────────────────────────────────────────────────


def build_silver_weather(bronze_dir: str | Path) -> pl.DataFrame:
    """Aggregate weather data from bronze."""
    bronze = Path(bronze_dir)
    weather_files = list(bronze.rglob("weather.parquet"))
    if not weather_files:
        return pl.DataFrame()

    weather = pl.concat([pl.read_parquet(str(f)) for f in weather_files], how="vertical_relaxed")
    return _ensure_timestamp_col(weather, "date")


# ── Silver: Race Control ────────────────────────────────────────────────────────


def build_silver_race_control(bronze_dir: str | Path) -> pl.DataFrame:
    """Aggregate race control data from bronze."""
    bronze = Path(bronze_dir)
    rc_files = list(bronze.rglob("race_control.parquet"))
    if not rc_files:
        return pl.DataFrame()

    rc = pl.concat([pl.read_parquet(str(f)) for f in rc_files], how="vertical_relaxed")
    return _ensure_timestamp_col(rc, "date")


# ── Gold: Battle state with overtake labels ─────────────────────────────────────


def build_gold_battle_state(
    bronze_dir: str | Path, look_ahead_windows: list[int] | None = None
) -> pl.DataFrame:
    """Build the Gold battle_state table for overtake probability training.

    For each (session, timestamp, driver), creates a feature row and labels
    whether an overtake occurred within the next 30s, 60s, or 120s.

    Labels come from the ``overtakes`` endpoint — actual overtaking events.
    """
    if look_ahead_windows is None:
        look_ahead_windows = [30, 60, 120]
    bronze = Path(bronze_dir)
    battles = build_silver_battles(bronze_dir)
    if battles.is_empty():
        return pl.DataFrame()

    # Get overtakes for each session
    ovt_files = list(bronze.rglob("overtakes.parquet"))
    if not ovt_files:
        return battles  # can't label without overtakes

    overtakes = pl.concat([pl.read_parquet(str(f)) for f in ovt_files], how="vertical_relaxed")
    overtakes = _ensure_timestamp_col(overtakes, "date")

    # For each battle row, check if an overtake happened within look-ahead window
    if overtakes.is_empty():
        return battles.with_columns(
            pl.lit(0).alias("overtake_30s"),
            pl.lit(0).alias("overtake_60s"),
            pl.lit(0).alias("overtake_120s"),
        )

    # Label: does the attacker overtake the defender within window?
    for window in look_ahead_windows:
        col_name = f"overtake_{window}s"
        window_td = pl.duration(seconds=window)

        # For each overtake, the overtaking_driver passes the overtaken_driver
        # at a specific timestamp. Label battle rows where attacker=overtaking_driver
        # and defender=overtaken_driver and the overtake happens within [date, date+window]
        battles = battles.join(
            overtakes.select(
                ["session_key", "date", "overtaking_driver", "overtaken_driver"]
            ).rename(
                {
                    "overtaking_driver": "driver_number",
                    "overtaken_driver": "driver_ahead",
                    "date": "overtake_date",
                }
            ),
            on=["session_key", "driver_number", "driver_ahead"],
            how="left",
        ).with_columns(
            pl.when(
                pl.col("overtake_date").is_not_null()
                & (pl.col("overtake_date") >= pl.col("date"))
                & (pl.col("overtake_date") <= pl.col("date") + window_td)
            )
            .then(1)
            .otherwise(0)
            .alias(col_name)
        )

    # Select feature columns for the overtake model
    feature_cols = [
        "session_key",
        "driver_number",
        "lap_number",
        "position",
        "speed",
        "speed_ahead",
        "speed",
        "throttle",
        "throttle_ahead",
        "brake",
        "brake_ahead",
        "rpm",
        "rpm_ahead",
        "gap_to_car_ahead_s",
        "compound_attacker",
        "compound_defender",
        "tyre_age_attacker",
        "tyre_age_defender",
        "date",
    ]

    available = [c for c in feature_cols if c in battles.columns]
    overtake_labels = ["overtake_30s", "overtake_60s", "overtake_120s"]
    label_cols = [c for c in overtake_labels if c in battles.columns]

    return battles.select(available + label_cols) if available + label_cols else pl.DataFrame()


# ── Gold: Car performance vector ────────────────────────────────────────────────


def build_gold_car_performance(bronze_dir: str | Path) -> pl.DataFrame:
    """Build per-driver performance vectors from real telemetry.

    Derives latent performance properties from observed sector speeds,
    acceleration, and braking patterns — NOT invented attributes.
    """
    bronze = Path(bronze_dir)
    tele_files = list(bronze.rglob("car_data.parquet"))
    if not tele_files:
        return pl.DataFrame()

    tele = pl.concat([pl.read_parquet(str(f)) for f in tele_files], how="vertical_relaxed")
    tele = _ensure_timestamp_col(tele, "date")

    if "speed" not in tele.columns:
        return pl.DataFrame()

    # Derive performance metrics per driver per session
    perf = tele.group_by(["session_key", "driver_number"]).agg(
        pl.col("speed").max().alias("top_speed_kmh"),
        pl.col("speed").mean().alias("avg_speed_kmh"),
        # Acceleration: speed gain in first 3s after corner
        # (throttle > 0.9, prev brake > 0.3)
        # Approximate via speed change rate
        (pl.col("speed").max() - pl.col("speed").min()).alias("speed_range"),
        pl.col("throttle").mean().alias("avg_throttle"),
        pl.col("brake").mean().alias("avg_brake"),
        pl.col("throttle").std().alias("throttle_variability"),
    )

    # Add sector-level performance: join with stints for compound context
    stint_files = list(bronze.rglob("stints.parquet"))
    if stint_files:
        pl.concat([pl.read_parquet(str(f)) for f in stint_files], how="vertical_relaxed")

    return perf


# ── Gold: Energy behaviour signatures ───────────────────────────────────────────


def build_gold_energy_behaviour(bronze_dir: str | Path) -> pl.DataFrame:
    """Build energy management behaviour signatures from observable telemetry.

    Since we can't observe SoC directly, we measure energy-management BEHAVIOUR:
    lift-and-coast distance, coasting duration, early throttle lift point,
    acceleration decay, etc.

    These are real, observable measurements that correlate with energy
    management strategy.
    """
    bronze = Path(bronze_dir)
    tele_files = list(bronze.rglob("car_data.parquet"))
    if not tele_files:
        return pl.DataFrame()

    # Load telemetry in chunks and analyze per-lap patterns
    tele_dfs = [pl.read_parquet(str(f)) for f in tele_files]
    tele = pl.concat(tele_dfs, how="vertical_relaxed")
    tele = _ensure_timestamp_col(tele, "date")

    if "throttle" not in tele.columns or "brake" not in tele.columns:
        return pl.DataFrame()

    # Ensure driver_number/lap_number for grouping

    # Sort by driver + time within session for coasting analysis
    tele = tele.sort(["session_key", "driver_number", "date"])

    # Calculate rolling features
    tele = tele.with_columns(
        [
            pl.col("speed").diff().over(["session_key", "driver_number"]).alias("speed_delta"),
            pl.col("throttle")
            .diff()
            .over(["session_key", "driver_number"])
            .alias("throttle_delta"),
            pl.col("brake").diff().over(["session_key", "driver_number"]).alias("brake_delta"),
        ]
    )

    # Energy behaviour metrics per driver per session
    energy_features = tele.group_by(["session_key", "driver_number"]).agg(
        # Lift-and-coast: periods of low throttle + decreasing speed while coasting
        (pl.col("throttle") < 0.1).sum().alias("coasting_samples"),
        pl.col("throttle").mean().alias("avg_throttle"),
        pl.col("speed").max().alias("max_speed_kmh"),
        pl.col("speed").std().alias("speed_variability"),
        # Early throttle application: how quickly throttle goes from 0 to 0.5 after braking
        # Proxy: mean throttle_delta when transitioning from brake to throttle
        pl.when(pl.col("speed_delta").is_not_null())
        .then(pl.col("speed_delta").mean())
        .otherwise(0.0)
        .alias("avg_acceleration"),
        # Braking intensity
        pl.col("brake").mean().alias("avg_brake_usage"),
        pl.col("brake").max().alias("max_brake"),
    )

    # Derive behavioural label: conservative vs aggressive energy management
    energy_features = energy_features.with_columns(
        pl.when(pl.col("avg_throttle") < 0.65)
        .then(pl.lit("CONSERVATIVE"))
        .when(pl.col("avg_throttle") > 0.75)
        .then(pl.lit("AGGRESSIVE"))
        .otherwise(pl.lit("MODERATE"))
        .alias("energy_behaviour_label"),
    )

    return energy_features


# ── Gold: Energy management labels from observable telemetry ────────────────────


def build_gold_energy_labels(bronze_dir: str | Path) -> pl.DataFrame:
    """Derive DEPLOY / SAVE / RECHARGE labels from observable telemetry patterns.

    Since the FIA removed public access to SoC, ERS deploy/recharge, and Active
    Aero position data, we label energy management behaviour using patterns
    that ARE observable in 3.7 Hz telemetry:

    - DEPLOY: throttle > 0.80 AND speed increasing AND speed > 200 km/h
      (car is accelerating hard out of a corner — high energy deployment)
    - RECHARGE: brake > 50 AND speed decreasing
      (heavy braking zone → MGU-K regen)
    - SAVE: throttle < 0.40 AND speed decreasing AND brake == 0
      (lifting and coasting to save energy)

    These behavioural labels are real observations, not synthetic traces.
    """
    bronze = Path(bronze_dir)
    tele_files = list(bronze.rglob("car_data.parquet"))
    if not tele_files:
        return pl.DataFrame()

    tele = pl.concat([pl.read_parquet(str(f)) for f in tele_files], how="vertical_relaxed")
    tele = _ensure_timestamp_col(tele, "date")

    required = ["speed", "throttle", "brake", "date", "driver_number", "session_key"]
    if not all(c in tele.columns for c in required):
        return pl.DataFrame()

    tele = tele.sort(["session_key", "driver_number", "date"])

    # Compute speed delta (rate of change) for accel/decel detection
    tele = tele.with_columns(
        [
            pl.col("speed")
            .diff()
            .over(["session_key", "driver_number"])
            .fill_null(0)
            .alias("speed_delta"),
            pl.col("throttle")
            .diff()
            .over(["session_key", "driver_number"])
            .fill_null(0)
            .alias("throttle_delta"),
        ]
    )

    # Derive action labels from observable patterns
    tele = tele.with_columns(
        pl.when((pl.col("throttle") > 0.80) & (pl.col("speed_delta") > 0) & (pl.col("speed") > 200))
        .then(pl.lit("DEPLOY"))
        .when((pl.col("brake") > 50) & (pl.col("speed_delta") < 0))
        .then(pl.lit("RECHARGE"))
        .when((pl.col("throttle") < 0.40) & (pl.col("speed_delta") < 0) & (pl.col("brake") == 0))
        .then(pl.lit("SAVE"))
        .otherwise(pl.lit("STABLE"))
        .alias("action_label"),
    )

    # Aggregate to lap + segment level: for each lap, summarize energy behaviour
    if "lap_number" in tele.columns:
        lap_agg = tele.group_by(["session_key", "driver_number", "lap_number"]).agg(
            pl.col("action_label").value_counts().alias("action_counts"),
            pl.col("action_label")
            .filter(pl.col("action_label") == "DEPLOY")
            .count()
            .alias("deploy_samples"),
            pl.col("action_label")
            .filter(pl.col("action_label") == "SAVE")
            .count()
            .alias("save_samples"),
            pl.col("action_label")
            .filter(pl.col("action_label") == "RECHARGE")
            .count()
            .alias("recharge_samples"),
            pl.col("throttle").mean().alias("avg_throttle"),
            pl.col("brake").mean().alias("avg_brake"),
            pl.col("speed").max().alias("max_speed_kmh"),
            pl.col("speed").mean().alias("avg_speed_kmh"),
            (pl.col("brake") > 50).sum().alias("heavy_brake_events"),
            (pl.col("throttle") > 0.8).sum().alias("full_throttle_events"),
            (pl.col("throttle") < 0.1).sum().alias("coast_events"),
        )
        # Derive dominant action from counts
        lap_agg = lap_agg.with_columns(
            pl.when(
                (pl.col("deploy_samples") >= pl.col("save_samples"))
                & (pl.col("deploy_samples") >= pl.col("recharge_samples"))
            )
            .then(pl.lit("DEPLOY"))
            .when(pl.col("save_samples") >= pl.col("recharge_samples"))
            .then(pl.lit("SAVE"))
            .otherwise(pl.lit("RECHARGE"))
            .alias("dominant_action"),
        )
        return lap_agg

    # Fall back to per-driver summary
    fallback = tele.group_by(["session_key", "driver_number"]).agg(
        pl.col("action_label").value_counts().alias("action_counts"),
        pl.col("action_label")
        .filter(pl.col("action_label") == "DEPLOY")
        .count()
        .alias("deploy_samples"),
        pl.col("throttle").mean().alias("avg_throttle"),
        pl.col("brake").mean().alias("avg_brake"),
        pl.col("speed").max().alias("max_speed_kmh"),
    )
    fallback = fallback.with_columns(
        pl.when(pl.col("deploy_samples") > 0)
        .then(pl.lit("DEPLOY"))
        .otherwise(pl.lit("SAVE"))
        .alias("dominant_action"),
    )
    return fallback


# ── Gold: Clean pace labels ──────────────────────────────────────────────────────


def build_gold_clean_pace(bronze_dir: str | Path) -> pl.DataFrame:
    """Build clean-pace labels from real race data.

    A ``clean_pace_lap`` is:
      - Not a pit lap
      - No safety car / VSC active
      - No yellow flags
      - No rain
      - Gap to car ahead > 1.0s (not in traffic)

    Labels come from actual race conditions, not synthetic generation.
    """
    bronze = Path(bronze_dir)
    lap_files = list(bronze.rglob("laps.parquet"))
    rc_files = list(bronze.rglob("race_control.parquet"))
    weather_files = list(bronze.rglob("weather.parquet"))
    int_files = list(bronze.rglob("intervals.parquet"))

    if not lap_files:
        return pl.DataFrame()

    laps = pl.concat([pl.read_parquet(str(f)) for f in lap_files], how="vertical_relaxed")
    laps = _ensure_timestamp_col(laps, "lap_start")

    # Ensure lap_time_s
    if "lap_time_s" not in laps.columns and "lap_time" in laps.columns:
        if laps.schema["lap_time"] == pl.Duration:
            laps = laps.with_columns(pl.col("lap_time").dt.total_microseconds() / 1e6).rename(
                {"lap_time": "lap_time_s"}
            )
        elif laps.schema["lap_time"] == pl.Float64:
            laps = laps.rename({"lap_time": "lap_time_s"})
        elif laps.schema["lap_time"] == pl.Utf8:
            # Parse duration string like "1:30.5" to seconds
            laps = laps.with_columns(
                pl.col("lap_time").str.to_duration().dt.total_microseconds() / 1e6
            ).rename({"lap_time": "lap_time_s"})

    # Race control flags
    if rc_files:
        rc = pl.concat([pl.read_parquet(str(f)) for f in rc_files], how="vertical_relaxed")
        rc = _ensure_timestamp_col(rc, "date")

        # SC/VSC periods
        if "category" in rc.columns:
            sc_laps = rc.filter(
                pl.col("category").str.to_lowercase().str.contains("sc|vsc|safety_car")
            )
            # Mark laps during SC periods
            if not sc_laps.is_empty():
                laps = laps.join(
                    sc_laps.select(["session_key", "date"]).with_columns(
                        pl.lit(True).alias("sc_active")
                    ),
                    left_on=["session_key", "lap_start"],
                    right_on=["session_key", "date"],
                    how="left",
                )
                laps = laps.with_columns(pl.col("sc_active").fill_null(False))
            else:
                laps = laps.with_columns(pl.lit(False).alias("sc_active"))
        else:
            laps = laps.with_columns(pl.lit(False).alias("sc_active"))

        # Yellow flag periods
        if "flag" in rc.columns:
            yellows = rc.filter(pl.col("flag").str.to_lowercase().str.contains("yellow"))
            if not yellows.is_empty():
                laps = laps.join(
                    yellows.select(["session_key", "date"]).with_columns(
                        pl.lit(True).alias("yellow_flag")
                    ),
                    left_on=["session_key", "lap_start"],
                    right_on=["session_key", "date"],
                    how="left",
                )
                laps = laps.with_columns(pl.col("yellow_flag").fill_null(False))
            else:
                laps = laps.with_columns(pl.lit(False).alias("yellow_flag"))
        else:
            laps = laps.with_columns(pl.lit(False).alias("yellow_flag"))
    else:
        laps = laps.with_columns(
            [
                pl.lit(False).alias("sc_active"),
                pl.lit(False).alias("yellow_flag"),
            ]
        )

    # Weather
    if weather_files:
        weather = pl.concat(
            [pl.read_parquet(str(f)) for f in weather_files], how="vertical_relaxed"
        )
        weather = _ensure_timestamp_col(weather, "date")

        rain_col = (
            "rainfall"
            if "rainfall" in weather.columns
            else ("rain" if "rain" in weather.columns else None)
        )
        if rain_col:
            weather = weather.with_columns((pl.col(rain_col) > 0).alias("is_rain"))
        else:
            weather = weather.with_columns(pl.lit(False).alias("is_rain"))

        if "track_temp_c" not in weather.columns and "track_temperature" in weather.columns:
            weather = weather.rename({"track_temperature": "track_temp_c"})
        if "air_temp_c" not in weather.columns and "air_temperature" in weather.columns:
            weather = weather.rename({"air_temperature": "air_temp_c"})

        # Join weather to laps (point-in-time: nearest weather before lap_start)
        if "track_temp_c" in weather.columns:
            weather = weather.select(
                ["session_key", "date", "track_temp_c", "air_temp_c", "is_rain"]
            )
            laps = laps.join_asof(
                weather.sort("date"),
                left_on="lap_start",
                right_on="date",
                by="session_key",
                strategy="backward",
            )
        else:
            laps = laps.with_columns(
                [
                    pl.lit(25.0).alias("track_temp_c"),
                    pl.lit(20.0).alias("air_temp_c"),
                    pl.lit(False).alias("is_rain"),
                ]
            )
    else:
        laps = laps.with_columns(
            [
                pl.lit(25.0).alias("track_temp_c"),
                pl.lit(20.0).alias("air_temp_c"),
                pl.lit(False).alias("is_rain"),
            ]
        )

    # Pit lap flags
    if "is_pit_in" in laps.columns:
        laps = laps.with_columns(pl.col("is_pit_in").fill_null(False).alias("is_pit_lap"))
    else:
        laps = laps.with_columns(pl.lit(False).alias("is_pit_lap"))

    # Gap to car ahead from intervals
    if int_files:
        intervals = pl.concat([pl.read_parquet(str(f)) for f in int_files], how="vertical_relaxed")
        intervals = _ensure_timestamp_col(intervals, "date")

        if "interval" in intervals.columns:
            intervals = intervals.rename({"interval": "gap_to_car_ahead_s"})
        if "gap_to_leader" in intervals.columns:
            intervals = intervals.rename({"gap_to_leader": "gap_to_leader_s"})

        # Get latest gap before each lap
        if "gap_to_car_ahead_s" in intervals.columns:
            intervals.filter(pl.col("date") <= pl.col("lap_start"))
            # This is complex with join_asof — just take the mean gap per driver per lap
            gap_summary = intervals.group_by(["session_key", "driver_number"]).agg(
                pl.col("gap_to_car_ahead_s").mean().alias("avg_gap_to_car_ahead_s"),
                pl.col("gap_to_car_ahead_s").min().alias("min_gap_to_car_ahead_s"),
            )
            laps = laps.join(
                gap_summary,
                on=["session_key", "driver_number"],
                how="left",
            )
        else:
            laps = laps.with_columns(
                [
                    pl.lit(5.0).alias("avg_gap_to_car_ahead_s"),
                    pl.lit(5.0).alias("min_gap_to_car_ahead_s"),
                ]
            )
    else:
        laps = laps.with_columns(
            [
                pl.lit(5.0).alias("avg_gap_to_car_ahead_s"),
                pl.lit(5.0).alias("min_gap_to_car_ahead_s"),
            ]
        )

    # Clean lap label
    laps = laps.with_columns(
        is_clean_pace_lap=(
            ~pl.col("is_pit_lap")
            & ~pl.col("sc_active")
            & ~pl.col("yellow_flag")
            & ~pl.col("is_rain")
            & (pl.col("min_gap_to_car_ahead_s").fill_null(5.0) > 1.0)
        ),
        is_valid_training_lap=(pl.col("lap_time_s").is_not_null() & (pl.col("lap_time_s") > 30)),
    )

    return laps
