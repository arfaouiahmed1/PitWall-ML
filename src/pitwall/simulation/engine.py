"""Monte Carlo race outcome simulator (V2) — samples pace quantiles + pit hazard.

Pace model provides q10/q50/q90 per driver/lap; we approximate lap time
distribution as Gaussian with mu=q50, sigma=(q90-q10)/2.563 (80% interval =
2*1.2816 sigma). Tyre/pit models adjust features lap-by-lap.

For V2 smoke tests, works with synthetic LightGBM models; falls back to
uniform/no-pit if models not provided.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import polars as pl

# constants
PIT_LOSS_S = 22.0  # avg stationary + entry/exit; track-specific in V3 via config


@dataclass
class DriverStateSim:
    driver_id: str
    position: int
    current_time_s: float = 0.0
    gap_to_leader_s: float = 0.0
    compound: str = "MEDIUM"
    tyre_age: int = 0
    stint_no: int = 1
    lap_number: int = 1  # next lap to simulate
    # for tracking simulation
    pit_count: int = 0
    # additional context for feature building
    total_time_s: float = 0.0
    # internal
    _extra: dict = field(default_factory=dict)


def _sigma_from_quantiles(q10: float, q90: float) -> float:
    # 80% interval width = 2*1.28155*sigma => sigma = width / 2.563
    w = max(q90 - q10, 0.2)
    return w / 2.563103


def _sample_lap_time(q10: float, q50: float, q90: float, rng: np.random.Generator) -> float:
    sigma = _sigma_from_quantiles(q10, q90)
    # truncated? clip to reasonable bounds 5s around median
    s = rng.normal(loc=q50, scale=sigma)
    # clip to [q10-1, q90+2] to avoid crazy outliers
    lo = q10 - 1.0
    hi = q90 + 2.0
    return float(np.clip(s, lo, hi))


def _build_features_for_prediction(
    driver: DriverStateSim,
    rolling_median_5: float | None = None,
    race_progress: float = 0.5,
) -> pl.DataFrame:
    """Build single-row feature frame for pace/pit/tyre models."""
    data = {
        "tyre_age": [driver.tyre_age],
        "tyre_age_sq": [driver.tyre_age**2],
        "stint_lap": [driver.tyre_age + 1],
        "stint_no": [driver.stint_no],
        "lap_number": [driver.lap_number],
        "position": [driver.position],
        "race_progress": [race_progress],
        "compound": [driver.compound],
        "rolling_median_5": [rolling_median_5 if rolling_median_5 is not None else 90.0],
        "rolling_std_5": [0.4],
        "rolling_median_3": [rolling_median_5 if rolling_median_5 else 90.0],
        "track_temp_c": [37.0],
        "gap_ahead_s": [driver.gap_to_leader_s],
        "gap_behind_s": [0.0],
    }
    return pl.DataFrame(data)


def _build_batch_features(
    drivers: list[DriverStateSim],
    race_progress: float = 0.5,
) -> pl.DataFrame:
    """Batch version — one row per driver."""
    data = {
        "tyre_age": [d.tyre_age for d in drivers],
        "tyre_age_sq": [d.tyre_age**2 for d in drivers],
        "stint_lap": [d.tyre_age + 1 for d in drivers],
        "stint_no": [d.stint_no for d in drivers],
        "lap_number": [d.lap_number for d in drivers],
        "position": [d.position for d in drivers],
        "race_progress": [race_progress] * len(drivers),
        "compound": [d.compound for d in drivers],
        "rolling_median_5": [90.0] * len(drivers),
        "rolling_std_5": [0.4] * len(drivers),
        "rolling_median_3": [90.0] * len(drivers),
        "track_temp_c": [37.0] * len(drivers),
        "gap_ahead_s": [d.gap_to_leader_s for d in drivers],
        "gap_behind_s": [0.0] * len(drivers),
    }
    return pl.DataFrame(data)


def simulate_race(
    drivers: list[DriverStateSim],
    n_simulations: int = 5000,
    laps_remaining: int = 20,
    pace_model=None,
    quantile_model=None,
    tyre_model=None,
    pit_model=None,
    seed: int = 42,
    pit_loss_s: float = PIT_LOSS_S,
) -> dict:
    """Run Monte Carlo simulations.

    Returns dict with:
      - win_prob: {driver_id: p}
      - podium_prob: {driver_id: p}
      - expected_position: {driver_id: mean_pos}
      - all_finishes: np.ndarray (n_simulations, n_drivers) of finishing positions? For analysis.
    If no models provided, samples from heuristic pace 90±0.6s and no pits.
    """
    if not drivers:
        return {"win_prob": {}, "podium_prob": {}, "expected_position": {}}

    rng = np.random.default_rng(seed)
    # Preserve order as input (assumed sorted by position)
    driver_ids = [d.driver_id for d in drivers]

    # Accumulate win counts
    win_counts = {did: 0 for did in driver_ids}
    podium_counts = {did: 0 for did in driver_ids}
    pos_sums = {did: 0.0 for did in driver_ids}

    # For efficiency, pre-allocate arrays
    # We simulate simulation by simulation to keep feature dependencies (tyre age progression)
    for _sim in range(n_simulations):
        # clone drivers for this simulation
        sim_drivers = [
            DriverStateSim(
                driver_id=d.driver_id,
                position=d.position,
                current_time_s=d.current_time_s,
                gap_to_leader_s=d.gap_to_leader_s,
                compound=d.compound,
                tyre_age=d.tyre_age,
                stint_no=d.stint_no,
                lap_number=d.lap_number,
                pit_count=0,
                total_time_s=d.current_time_s,  # start from current cumulative
            )
            for d in drivers
        ]
        # Batch per-lap predictions for speed (reduces 4x calls for 4 drivers)
        for lap_idx in range(laps_remaining):
            progress = (lap_idx + 1) / laps_remaining
            # Build batch frame once per lap
            batch_df = _build_batch_features(sim_drivers, race_progress=progress)
            # Batch quantile predictions
            q10_arr = q50_arr = q90_arr = None
            if quantile_model is not None:
                try:
                    qd = quantile_model.predict(batch_df)
                    q10_arr = qd[0.1]
                    q50_arr = qd[0.5]
                    q90_arr = qd[0.9]
                except Exception:
                    pass
            elif pace_model is not None:
                # heuristic from point model not ideal for batch;
                # fall back to heuristic per driver below
                pass
            # Batch tyre
            tyre_extra_arr = None
            if tyre_model is not None:
                try:
                    tyre_extra_arr = tyre_model.predict(batch_df) * 0.3  # weighted
                except Exception:
                    tyre_extra_arr = np.zeros(len(sim_drivers))
            else:
                tyre_extra_arr = np.zeros(len(sim_drivers))
            # Batch pit
            pit_prob_arr = None
            if pit_model is not None:
                try:
                    pit_prob_arr = np.clip(pit_model.predict_proba(batch_df), 0.0, 0.95)
                except Exception:
                    pit_prob_arr = np.array([0.02 if d.tyre_age > 12 else 0.0 for d in sim_drivers])
            else:
                pit_prob_arr = np.array(
                    [
                        0.35 if d.tyre_age >= 14 else 0.12 if d.tyre_age >= 12 else 0.015
                        for d in sim_drivers
                    ]
                )

            for idx, d in enumerate(sim_drivers):
                # Pace quantiles
                if q10_arr is not None:
                    q10, q50, q90 = float(q10_arr[idx]), float(q50_arr[idx]), float(q90_arr[idx])  # type: ignore
                elif pace_model is not None:
                    try:
                        f = _build_features_for_prediction(
                            d, rolling_median_5=90.0, race_progress=progress
                        )
                        qd = pace_model.predict_quantiles(f)
                        q10, q50, q90 = float(qd[0.1][0]), float(qd[0.5][0]), float(qd[0.9][0])
                    except Exception:
                        base = 90.0 + 0.07 * d.tyre_age
                        q10, q50, q90 = base - 0.6, base, base + 0.6
                else:
                    base = 90.0 + 0.07 * d.tyre_age
                    q10, q50, q90 = base - 0.6, base, base + 0.6

                tyre_extra = float(tyre_extra_arr[idx]) if tyre_extra_arr is not None else 0.0
                pit_prob = float(pit_prob_arr[idx]) if pit_prob_arr is not None else 0.0

                will_pit = rng.random() < pit_prob
                lap_time = _sample_lap_time(q10, q50, q90, rng)
                lap_time += tyre_extra
                if will_pit:
                    lap_time += pit_loss_s
                    d.tyre_age = 0
                    d.stint_no += 1
                    d.pit_count += 1
                    d.compound = "HARD" if d.compound == "MEDIUM" else "MEDIUM"
                else:
                    d.tyre_age += 1
                d.lap_number += 1
                d.total_time_s += lap_time

        # after laps, sort by total_time
        sim_drivers.sort(key=lambda x: x.total_time_s)
        for pos, d in enumerate(sim_drivers, start=1):
            pos_sums[d.driver_id] += pos
            if pos == 1:
                win_counts[d.driver_id] += 1
            if pos <= 3:
                podium_counts[d.driver_id] += 1

    win_prob = {did: win_counts[did] / n_simulations for did in driver_ids}
    podium_prob = {did: podium_counts[did] / n_simulations for did in driver_ids}
    expected_position = {did: pos_sums[did] / n_simulations for did in driver_ids}

    return {
        "win_prob": win_prob,
        "podium_prob": podium_prob,
        "expected_position": expected_position,
        "n_simulations": n_simulations,
        "laps_remaining": laps_remaining,
    }


def simulate_with_models(
    drivers: list[DriverStateSim],
    pace_model_path: str | None = None,
    quantile_path: str | None = None,
    tyre_path: str | None = None,
    pit_path: str | None = None,
    n_simulations: int = 5000,
    laps_remaining: int = 20,
) -> dict:
    """Helper to load models from disk and simulate."""
    pace_model = None
    quantile_model = None
    tyre_model = None
    pit_model = None
    if pace_model_path:
        try:
            from pitwall.models.pace.lightgbm_model import PaceLightGBM

            pace_model = PaceLightGBM.load(pace_model_path)
        except Exception:
            pass
    if quantile_path:
        try:
            from pitwall.models.pace.lightgbm_model import QuantileLightGBM

            quantile_model = QuantileLightGBM.load(quantile_path)
        except Exception:
            pass
    if tyre_path:
        try:
            from pitwall.models.tyre.lightgbm_tyre import TyreLightGBM

            tyre_model = TyreLightGBM.load(tyre_path)
        except Exception:
            pass
    if pit_path:
        try:
            from pitwall.models.pit.lightgbm_pit import PitHazardLightGBM

            pit_model = PitHazardLightGBM.load(pit_path)
        except Exception:
            pass
    return simulate_race(
        drivers,
        n_simulations=n_simulations,
        laps_remaining=laps_remaining,
        pace_model=pace_model,
        quantile_model=quantile_model,
        tyre_model=tyre_model,
        pit_model=pit_model,
    )
