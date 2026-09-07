"""Build silver.laps from OpenF1 bronze session directories (2026 era).

Handles all session types (Practice 1/2/3, Qualifying, Sprint Qualifying,
Sprint, Race) uniformly. Stints carry compound + tyre age; laps carry timing +
sector + speed. The output schema mirrors the FastF1 silver so the feature
builder and the trained models consume it unchanged.
"""
from __future__ import annotations

import contextlib
from datetime import datetime
from pathlib import Path

import polars as pl

from pitwall.regulations import get_era_for_season


def _coerce_time(v) -> int | None:
    """Return int nanoseconds if v is float seconds, else None."""
    if v is None:
        return None
    try:
        return int(float(v) * 1e9)
    except (TypeError, ValueError):
        return None


def _coerce_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def build_silver_from_openf1(
    bronze_dir: Path | str,
    season: int,
    event: str,
    session: str,
) -> pl.DataFrame:
    """Normalize a bronze OpenF1 session into the silver.laps schema.

    Parameters
    ----------
    bronze_dir : root of one session's bronze tables (contains laps.parquet,
                 stints.parquet, drivers.parquet, ...
    season     : 2026
    event      : e.g. "Melbourne"
    session    : e.g. "R", "Qualifying", "Sprint", "Practice_1"
    """
    root = Path(bronze_dir)

    laps = pl.read_parquet(root / "laps.parquet")
    if laps.is_empty():
        return laps

    drivers = pl.read_parquet(root / "drivers.parquet")
    stints = pl.read_parquet(root / "stints.parquet")

    # Pit-stop lap markers
    pit_laps: set[tuple[int, int]] = set()
    pit_path = root / "pit.parquet"
    if pit_path.exists():
        pit_pf = pl.read_parquet(pit_path)
        if not pit_pf.is_empty() and {"driver_number", "lap_number"} <= set(pit_pf.columns):
            for r in pit_pf.iter_rows(named=True):
                if r.get("driver_number") is not None and r.get("lap_number") is not None:
                    pit_laps.add((int(r["driver_number"]), int(r["lap_number"])))

    # Driver map
    driver_map = {
        int(r["driver_number"]): r for r in drivers.iter_rows(named=True)
        if r.get("driver_number") is not None
    } if not drivers.is_empty() else {}

    # Stint map: (driver_number) -> list[(start, end, compound, age_at_start, stint_no)]
    stint_map: dict[int, list[tuple[int, int, str, int, int]]] = {}
    if not stints.is_empty():
        for r in stints.iter_rows(named=True):
            if r.get("driver_number") is None or r.get("lap_start") is None or r.get("lap_end") is None:
                continue
            dn = int(r["driver_number"])
            stint_map.setdefault(dn, []).append(
                (
                    int(r["lap_start"]) if r.get("lap_start") is not None else 0,
                    int(r["lap_end"]) if r.get("lap_end") is not None else 0,
                    str(r.get("compound") or "UNKNOWN"),
                    int(r["tyre_age_at_start"]) if r.get("tyre_age_at_start") is not None else 0,
                    int(r["stint_number"]) if r.get("stint_number") is not None else 1,
                )
            )

    def _stint_for(dn: int, lap: int) -> tuple[str, int, int] | None:
        """Return (compound, stint_no, tyre_age) for (dn, lap) or None."""
        for start, end, comp, age0, sno in stint_map.get(dn, []):
            if start <= lap <= end:
                return comp, sno, age0 + (lap - start)
        return None

    rows = []
    for row in laps.iter_rows(named=True):
        dn = int(row["driver_number"]) if row.get("driver_number") is not None else 0
        ln = int(row["lap_number"]) if row.get("lap_number") is not None else 0
        lap_dur = row.get("lap_duration")
        lt = _coerce_float(lap_dur)
        s1 = _coerce_float(row.get("duration_sector_1"))
        s2 = _coerce_float(row.get("duration_sector_2"))
        s3 = _coerce_float(row.get("duration_sector_3"))

        st = _stint_for(dn, ln)
        if st is not None:
            compound, stint_no, tyre_age = st
        else:
            compound = "UNKNOWN"
            stint_no, tyre_age = 1, int(ln)

        is_pit_out = bool(row.get("is_pit_out_lap", False))
        is_pit_in = bool((dn, ln) in pit_laps)

        # Clean / training-lap heuristics shared with the FastF1 path:
        # exclude pit in/out; lap_time in a plausible clean racing band is
        # decided by the pace feature builder — here we only flag structural
        # exclusions (never a racing lap: pit/no time).
        valid_structural = lt is not None and not is_pit_in and not is_pit_out

        d = driver_map.get(dn, {})
        acronym = d.get("name_acronym") or d.get("broadcast_name") or str(dn)
        team = d.get("team_name") or "Unknown"

        # LapStartDate from date_start
        ds = row.get("date_start")
        lap_start_dt = None
        if ds:
            try:
                lap_start_dt = datetime.fromisoformat(str(ds).replace("Z", "+00:00")).replace(tzinfo=None)
            except (ValueError, TypeError):
                lap_start_dt = None

        rows.append(
            {
                "Time": _coerce_time(lt),
                "driver_id": acronym,
                "driver_number": str(dn),
                "LapTime": _coerce_time(lt),
                "lap_number": float(ln),
                "stint_no": float(stint_no),
                "PitOutTime": None,
                "PitInTime": None,
                "Sector1Time": _coerce_time(s1),
                "Sector2Time": _coerce_time(s2),
                "Sector3Time": _coerce_time(s3),
                "Sector1SessionTime": None,
                "Sector2SessionTime": None,
                "Sector3SessionTime": None,
                "SpeedI1": _coerce_float(row.get("i1_speed")),
                "SpeedI2": _coerce_float(row.get("i2_speed")),
                "SpeedFL": _coerce_float(row.get("st_speed")),
                "SpeedST": _coerce_float(row.get("st_speed")),
                "IsPersonalBest": False,
                "compound": compound,
                "tyre_age": float(tyre_age),
                "FreshTyre": bool(stint_no > 0 and ln == 1) or tyre_age == 0,
                "team_id": team,
                "LapStartTime": None,
                "LapStartDate": lap_start_dt,
                "track_status": "1",
                "position": float(dn),
                "Deleted": False,
                "DeletedReason": None,
                "FastF1Generated": False,
                "IsAccurate": lt is not None,
                "lap_time_s": lt,
                "is_pit_in": is_pit_in,
                "is_pit_out": is_pit_out,
                "session_id": f"{season}_{event} {session}",
                "is_valid_training_lap": valid_structural,
                "regulation_era": get_era_for_season(season),
            }
        )

    df = pl.DataFrame(rows)
    return df


def write_silver_session(
    silver_root: Path | str,
    df: pl.DataFrame,
    season: int,
    event: str,
    session: str,
) -> Path:
    """Write one session's silver laps file with FastF1-compatible naming."""
    out = (
        Path(silver_root)
        / "laps"
        / f"{season}_{event} {session}.parquet"
    )
    out.parent.mkdir(parents=True, exist_ok=True)

    # Match the FastF1 2024_Bahrain schema exactly for interop
    reference = None
    ref_hit = next(
        Path(silver_root).glob("laps/2024_*.parquet"), None
    ) or next(
        Path(silver_root).glob("laps/2025_*.parquet"), None
    )
    if ref_hit is not None:
        try:
            reference = pl.read_parquet(ref_hit, columns=None)
        except Exception:
            reference = None

    if reference is not None:
        for col in reference.columns:
            if col in df.columns:
                with contextlib.suppress(Exception):
                    df = df.with_columns(pl.col(col).cast(reference[col].dtype))

    df.write_parquet(out)
    return out