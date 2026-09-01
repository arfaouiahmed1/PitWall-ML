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


# --- V4: What-If Simulation with push delta & compound switch ---


def _cliff_risk(
    target_compound: str,
    start_tyre_age: int,
    remaining_laps: int,
    pit_lap_offset: int | None,
    push_pace_delta_s: float,
    pit_loss_s: float = PIT_LOSS_S,
) -> float:
    """Heuristic tire cliff risk 0..1.

    - HARD: resilient but cold warmup risk if pushing early
    - SOFT/MEDIUM: degrades faster, especially with push delta negative (faster)
    - Final tyre age > 20 = high risk, >14 moderate, else low
    - Push delta negative (push) increases risk; positive (conserve) reduces
    """
    comp = target_compound.upper()
    if pit_lap_offset is not None and pit_lap_offset >= 0:
        # after what-if pit, age counts from pit lap to finish
        # pit lap itself resets to 0 after that lap's pit
        final_age = remaining_laps - pit_lap_offset - 1
        if final_age < 0:
            final_age = remaining_laps
    else:
        final_age = start_tyre_age + remaining_laps

    # Base risk by final age
    if final_age >= 22:
        base = 0.85
    elif final_age >= 18:
        base = 0.65
    elif final_age >= 14:
        base = 0.40
    elif final_age >= 10:
        base = 0.20
    else:
        base = 0.08

    # Compound multiplier
    if comp in ("SOFT",):
        base *= 1.6
    elif comp in ("MEDIUM",):
        base *= 1.2
    elif comp in ("HARD",):
        base *= 0.75
        # HARD warmup: if pushing hard in first 3 laps after pit, slight extra risk (graining)
        if push_pace_delta_s < -0.15 and final_age < 6:
            base += 0.10
    elif comp in ("INTERMEDIATE", "WET"):
        base *= 0.9

    # Push delta adjustment: -0.5 push -> +0.25 risk, +0.5 conserve -> -0.15 risk
    base += (-push_pace_delta_s) * 0.5  # push negative increases risk
    # Clamp
    return float(max(0.0, min(1.0, base)))


def _simulate_internal(
    drivers: list[DriverStateSim],
    n_simulations: int,
    laps_remaining: int,
    pace_model,
    quantile_model,
    tyre_model,
    pit_model,
    seed: int,
    pit_loss_s: float,
    whatif_driver_id: str | None = None,
    target_pit_lap: int | None = None,
    target_compound: str | None = None,
    push_pace_delta_s: float = 0.0,
    current_lap: int | None = None,
) -> dict:
    """Internal simulation loop with optional forced what-if pit + push delta.

    Returns per-simulation finishing data for target driver analysis.
    """
    if not drivers:
        return {"win_prob": {}, "podium_prob": {}, "expected_position": {}, "per_sim": []}

    rng = np.random.default_rng(seed)
    driver_ids = [d.driver_id for d in drivers]
    win_counts = {did: 0 for did in driver_ids}
    podium_counts = {did: 0 for did in driver_ids}
    pos_sums = {did: 0.0 for did in driver_ids}
    # per-sim tracking for what-if analysis
    per_sim_target_times: list[float] = []
    per_sim_target_positions: list[int] = []
    position_counts: dict[int, int] = {}

    for _sim in range(n_simulations):
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
                total_time_s=d.current_time_s,
            )
            for d in drivers
        ]
        # Map id -> driver for quick what-if lookup
        id_to_driver = {d.driver_id: d for d in sim_drivers}
        whatif_driver = id_to_driver.get(whatif_driver_id) if whatif_driver_id else None

        # Determine forced pit lap offset within remaining horizon
        # target_pit_lap is absolute lap number (e.g. 24), current_lap is e.g. 20 -> offset = 4
        pit_offset: int | None = None
        if whatif_driver is not None and target_pit_lap is not None and current_lap is not None:
            pit_offset = target_pit_lap - current_lap
            # if target pit is beyond horizon, ignore
            if pit_offset < 0 or pit_offset >= laps_remaining:
                pit_offset = None
        elif whatif_driver is not None and target_pit_lap is not None and current_lap is None:
            # fallback: treat target_pit_lap as 1-indexed offset within horizon
            pit_offset = max(0, target_pit_lap - 1)
            if pit_offset >= laps_remaining:
                pit_offset = None

        for lap_idx in range(laps_remaining):
            progress = (lap_idx + 1) / laps_remaining
            batch_df = _build_batch_features(sim_drivers, race_progress=progress)

            q10_arr = q50_arr = q90_arr = None
            if quantile_model is not None:
                try:
                    qd = quantile_model.predict(batch_df)
                    q10_arr = qd[0.1]
                    q50_arr = qd[0.5]
                    q90_arr = qd[0.9]
                except Exception:
                    pass

            tyre_extra_arr = None
            if tyre_model is not None:
                try:
                    tyre_extra_arr = tyre_model.predict(batch_df) * 0.3
                except Exception:
                    tyre_extra_arr = np.zeros(len(sim_drivers))
            else:
                tyre_extra_arr = np.zeros(len(sim_drivers))

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
                is_whatif = d.driver_id == whatif_driver_id
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

                # Determine if this lap is forced what-if pit
                forced_pit = is_whatif and pit_offset is not None and lap_idx == pit_offset
                will_pit = forced_pit or (rng.random() < pit_prob and not forced_pit)
                # For what-if driver, suppress stochastic pits except forced? Allow but forced overrides
                # If forced pit, ensure pit happens even if stochastic would not

                lap_time = _sample_lap_time(q10, q50, q90, rng)
                lap_time += tyre_extra
                # Apply push delta only to what-if driver, all laps (tire wear trade-off already in cliff)
                if is_whatif and push_pace_delta_s != 0.0:
                    # push_pace_delta_s negative means faster: subtract from lap time
                    lap_time += push_pace_delta_s
                    # Also add small degradation penalty for aggressive push on high tyre age
                    if push_pace_delta_s < 0 and d.tyre_age > 10:
                        lap_time += (-push_pace_delta_s) * 0.2 * (d.tyre_age / 15.0)

                if will_pit:
                    lap_time += pit_loss_s
                    d.tyre_age = 0
                    d.stint_no += 1
                    d.pit_count += 1
                    if forced_pit and target_compound:
                        d.compound = target_compound.upper()
                    else:
                        d.compound = "HARD" if d.compound == "MEDIUM" else "MEDIUM"
                else:
                    d.tyre_age += 1
                d.lap_number += 1
                d.total_time_s += lap_time

        sim_drivers.sort(key=lambda x: x.total_time_s)
        for pos, d in enumerate(sim_drivers, start=1):
            pos_sums[d.driver_id] += pos
            if pos == 1:
                win_counts[d.driver_id] += 1
            if pos <= 3:
                podium_counts[d.driver_id] += 1
            if whatif_driver_id and d.driver_id == whatif_driver_id:
                per_sim_target_positions.append(pos)
                per_sim_target_times.append(d.total_time_s)
                position_counts[pos] = position_counts.get(pos, 0) + 1

    win_prob = {did: win_counts[did] / n_simulations for did in driver_ids}
    podium_prob = {did: podium_counts[did] / n_simulations for did in driver_ids}
    expected_position = {did: pos_sums[did] / n_simulations for did in driver_ids}

    # Build re-entry/distribution (finish position distribution) for what-if driver
    position_dist: dict[int, float] = {}
    if position_counts:
        for pos, cnt in position_counts.items():
            position_dist[pos] = cnt / n_simulations
    # also compute target mean time
    mean_target_time = float(np.mean(per_sim_target_times)) if per_sim_target_times else 0.0

    return {
        "win_prob": win_prob,
        "podium_prob": podium_prob,
        "expected_position": expected_position,
        "n_simulations": n_simulations,
        "laps_remaining": laps_remaining,
        "position_distribution": position_dist,
        "per_sim_target_times": per_sim_target_times,
        "per_sim_target_positions": per_sim_target_positions,
        "mean_target_time": mean_target_time,
        "position_counts": position_counts,
    }


def simulate_what_if(
    drivers: list[DriverStateSim],
    driver_number: int | str,
    target_pit_lap: int,
    target_compound: str = "HARD",
    push_pace_delta_s: float = 0.0,
    remaining_laps: int = 30,
    current_lap: int = 20,
    n_simulations: int = 1000,
    pace_model=None,
    quantile_model=None,
    tyre_model=None,
    pit_model=None,
    seed: int = 42,
    pit_loss_s: float = PIT_LOSS_S,
) -> dict:
    """Run baseline vs what-if Monte Carlo and compute deltas.

    Args:
        drivers: current race drivers (ordered by position)
        driver_number: driver to apply what-if (int or str)
        target_pit_lap: absolute lap number to pit (e.g. 24)
        target_compound: compound after pit
        push_pace_delta_s: pace delta (-0.5 push to +0.5 conserve) applied per lap to what-if driver
        remaining_laps: laps remaining from current_lap
        current_lap: current lap number
        n_simulations: monte carlo runs
        models: optional pace/quantile/tyre/pit models
        seed: base seed (what-if uses seed+1 for variance but comparable)
    Returns:
        dict with:
          - re_entry_position_dist: {pos: prob} finishing position distribution under what-if
          - position_distribution: alias
          - time_delta_s: mean_time(whatif) - mean_time(baseline) (negative = faster)
          - win_prob_delta: whatif P(win) - baseline P(win)
          - cliff_risk: 0..1 heuristic
          - baseline_win_prob, whatif_win_prob, etc.
    """
    driver_id = str(driver_number)
    # Find driver to get start tyre age for cliff calc
    start_age = 0
    for d in drivers:
        if d.driver_id == driver_id:
            start_age = d.tyre_age
            break

    # Baseline: normal simulation (no forced pit, no push)
    baseline = _simulate_internal(
        drivers=drivers,
        n_simulations=n_simulations,
        laps_remaining=remaining_laps,
        pace_model=pace_model,
        quantile_model=quantile_model,
        tyre_model=tyre_model,
        pit_model=pit_model,
        seed=seed,
        pit_loss_s=pit_loss_s,
        whatif_driver_id=driver_id,  # track same driver for distribution? still no forced pit
        target_pit_lap=None,
        target_compound=None,
        push_pace_delta_s=0.0,
        current_lap=current_lap,
    )
    # But baseline should not have forced pit; we still passed whatif_driver_id for tracking - need to avoid forced pit
    # _simulate_internal only forces if target_pit_lap is not None, so baseline is correct stochastic.

    whatif = _simulate_internal(
        drivers=drivers,
        n_simulations=n_simulations,
        laps_remaining=remaining_laps,
        pace_model=pace_model,
        quantile_model=quantile_model,
        tyre_model=tyre_model,
        pit_model=pit_model,
        seed=seed + 1,
        pit_loss_s=pit_loss_s,
        whatif_driver_id=driver_id,
        target_pit_lap=target_pit_lap,
        target_compound=target_compound,
        push_pace_delta_s=push_pace_delta_s,
        current_lap=current_lap,
    )

    # Position distributions
    re_entry_dist = whatif.get("position_distribution", {})
    # Ensure keys are int
    re_entry_dist_int = {int(k): float(v) for k, v in re_entry_dist.items()}

    # Time delta: whatif mean target time - baseline mean target time
    baseline_times = baseline.get("per_sim_target_times", [])
    whatif_times = whatif.get("per_sim_target_times", [])
    if baseline_times and whatif_times:
        # align lengths (should be equal)
        n = min(len(baseline_times), len(whatif_times))
        # Use means directly; more stable
        time_delta = float(np.mean(whatif_times[:n]) - np.mean(baseline_times[:n]))
    else:
        # Fallback heuristic: pit loss + push delta * remaining laps
        pit_cost = pit_loss_s if target_pit_lap is not None else 0.0
        # Baseline stochastic pit probability ~ maybe 0.2*remaining
        # simpler: time delta = pit_cost + push*remaining - baseline avg
        time_delta = float(pit_cost + push_pace_delta_s * remaining_laps)

    baseline_win = float(baseline.get("win_prob", {}).get(driver_id, 0.0))
    whatif_win = float(whatif.get("win_prob", {}).get(driver_id, 0.0))
    win_delta = whatif_win - baseline_win

    # Cliff risk heuristic
    pit_offset: int | None = None
    if target_pit_lap is not None:
        pit_offset = target_pit_lap - current_lap
        if pit_offset < 0 or pit_offset >= remaining_laps:
            pit_offset = None
    cliff = _cliff_risk(
        target_compound=target_compound,
        start_tyre_age=start_age,
        remaining_laps=remaining_laps,
        pit_lap_offset=pit_offset,
        push_pace_delta_s=push_pace_delta_s,
        pit_loss_s=pit_loss_s,
    )

    # Expected positions
    baseline_exp = float(baseline.get("expected_position", {}).get(driver_id, 0.0))
    whatif_exp = float(whatif.get("expected_position", {}).get(driver_id, 0.0))

    baseline_podium = float(baseline.get("podium_prob", {}).get(driver_id, 0.0))
    whatif_podium = float(whatif.get("podium_prob", {}).get(driver_id, 0.0))

    return {
        "driver_number": int(driver_number) if str(driver_number).isdigit() else driver_number,
        "target_pit_lap": target_pit_lap,
        "target_compound": target_compound.upper(),
        "push_pace_delta_s": push_pace_delta_s,
        "re_entry_position_dist": re_entry_dist_int,
        "position_distribution": re_entry_dist_int,
        "time_delta_s": time_delta,
        "win_prob_delta": win_delta,
        "cliff_risk": cliff,
        "baseline_win_prob": baseline_win,
        "whatif_win_prob": whatif_win,
        "baseline_expected_position": baseline_exp,
        "whatif_expected_position": whatif_exp,
        "baseline_p_podium": baseline_podium,
        "whatif_p_podium": whatif_podium,
        "n_simulations": n_simulations,
        "laps_remaining": remaining_laps,
        "current_lap": current_lap,
    }
