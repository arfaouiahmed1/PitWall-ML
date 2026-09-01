"""Silver normalization — domain tables from Bronze."""

from __future__ import annotations

from pathlib import Path

import polars as pl

from pitwall.regulations import get_era_for_season


def build_silver_laps(bronze_lf: pl.LazyFrame) -> pl.DataFrame:
    """Build silver.laps from bronze lap events.

    Expects bronze payload json with lap_number, lap_time_s, compound, etc.
    """
    # For V1: if bronze is from FastF1 pipeline we already have structured silver
    # This function handles the generic json payload case.
    df = bronze_lf.filter(pl.col("event_type") == "lap").collect()
    if df.is_empty():
        return df

    # Parse raw_payload if present
    if "raw_payload" in df.columns:
        import json

        payloads = []
        for raw in df["raw_payload"].to_list():
            try:
                payloads.append(json.loads(raw) if raw else {})
            except Exception:
                payloads.append({})
        pdf = pl.DataFrame(payloads)
        # Merge driver_number / timestamps from bronze
        df = df.hstack(pdf) if not pdf.is_empty() else df

    # Normalize compound enum
    if "compound" in df.columns:
        df = df.with_columns(
            pl.col("compound").str.to_uppercase().fill_null("UNKNOWN").alias("compound")
        )

    # Coerce lap_time_s
    if "lap_time_s" in df.columns:
        df = df.with_columns(pl.col("lap_time_s").cast(pl.Float64))

    # Derive is_valid_training_lap
    # Exclude pit in/out, safety car, deleted, null time
    cond = pl.lit(True)
    if "is_pit_in" in df.columns:
        cond = cond & (~pl.col("is_pit_in").fill_null(False))
    if "is_pit_out" in df.columns:
        cond = cond & (~pl.col("is_pit_out").fill_null(False))
    if "is_safety_car" in df.columns:
        cond = cond & (~pl.col("is_safety_car").fill_null(False))
    if "is_deleted" in df.columns:
        cond = cond & (~pl.col("is_deleted").fill_null(False))
    if "lap_time_s" in df.columns:
        cond = (
            cond
            & pl.col("lap_time_s").is_not_null()
            & (pl.col("lap_time_s") > 30)
            & (pl.col("lap_time_s") < 300)
        )

    df = df.with_columns(cond.alias("is_valid_training_lap"))

    return df


def write_silver(df: pl.DataFrame, silver_root: Path | str, table: str) -> Path:
    root = Path(silver_root) / table
    root.mkdir(parents=True, exist_ok=True)
    out = root / f"{table}.parquet"
    df.write_parquet(str(out))
    return out


def build_silver_from_fastf1(
    df: pl.DataFrame, season: int, event: str, session: str
) -> pl.DataFrame:
    """Normalize FastF1 Polars lap DataFrame to silver.laps schema."""
    # Map FastF1 columns to silver schema
    rename = {
        "DriverNumber": "driver_number",
        "LapNumber": "lap_number",
        "Compound": "compound",
        "TyreLife": "tyre_age",
        "Stint": "stint_no",
        "Position": "position",
        "TrackStatus": "track_status",
        "Driver": "driver_id",
        "Team": "team_id",
    }
    # Only rename existing cols
    df = df.rename({k: v for k, v in rename.items() if k in df.columns})

    # Lap time seconds
    if "LapTime" in df.columns:
        # LapTime is timedelta-like; convert via pandas then polars
        try:
            import pandas as pd

            s = (
                df["LapTime"].to_pandas()
                if hasattr(df["LapTime"], "to_pandas")
                else pd.Series(df["LapTime"].to_list())
            )
            lap_s = pd.to_timedelta(s).dt.total_seconds()
            df = df.with_columns(pl.Series("lap_time_s", lap_s.to_list()))
        except Exception:
            pass

    # Flags
    for col in ["PitInTime", "PitOutTime"]:
        if col in df.columns:
            flag = "is_pit_in" if "PitIn" in col else "is_pit_out"
            df = df.with_columns(pl.col(col).is_not_null().alias(flag))

    # Session id + era
    session_id = f"{season}_{event}_{session}"
    df = df.with_columns(
        pl.lit(session_id).alias("session_id"),
        pl.lit(season).alias("season"),
        pl.lit(get_era_for_season(season)).alias("regulation_era"),
    )

    # Validity
    df = df.with_columns(
        (
            pl.col("lap_time_s").is_not_null()
            & (pl.col("lap_time_s") > 30)
            & (pl.col("lap_time_s") < 300)
            & (~pl.col("is_pit_in").fill_null(False) if "is_pit_in" in df.columns else pl.lit(True))
            & (
                ~pl.col("is_pit_out").fill_null(False)
                if "is_pit_out" in df.columns
                else pl.lit(True)
            )
        ).alias("is_valid_training_lap")
    )

    # Compound upper
    if "compound" in df.columns:
        df = df.with_columns(pl.col("compound").str.to_uppercase().fill_null("UNKNOWN"))

    return df
