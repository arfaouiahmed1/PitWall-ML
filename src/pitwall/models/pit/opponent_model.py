"""Opponent pit window and strategic undercut/overcut hazard model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class UndercutThreat:
    """Assessment of rival undercut/overcut threat."""

    driver_number: int
    rival_number: int
    gap_s: float
    is_undercut_threat: bool
    is_overcut_threat: bool
    rival_pit_probability_3l: float
    tyre_age_delta: int  # rival_age - driver_age
    estimated_delta_at_pit_exit_s: float
    recommended_action: str  # "COVER_UNDERCUT" | "EXTEND_OVERCUT" | "HOLD"


class OpponentPitModel:
    """Models opponent pit windows, undercut threat windows, and overcut delta dynamics."""

    def __init__(
        self,
        undercut_gap_threshold_s: float = 1.8,
        pit_loss_s: float = 22.0,
        fresh_tyre_advantage_s: float = 1.2,
    ) -> None:
        self.undercut_gap_threshold_s = undercut_gap_threshold_s
        self.pit_loss_s = pit_loss_s
        self.fresh_tyre_advantage_s = fresh_tyre_advantage_s

    def compute_rival_pit_window(
        self,
        rival_tyre_age: int,
        rival_compound: str = "MEDIUM",
        current_lap: int = 20,
        total_laps: int = 66,
    ) -> dict[int, float]:
        """Return a discrete probability distribution over likely pit laps for a rival."""
        compound = rival_compound.upper()
        if "SOFT" in compound or compound == "S":
            expected_stint = 18
        elif "HARD" in compound or compound == "H":
            expected_stint = 28
        else:
            expected_stint = 23

        remaining_in_stint = max(0, expected_stint - rival_tyre_age)
        target_lap = current_lap + remaining_in_stint

        laps = list(range(current_lap + 1, min(current_lap + 12, total_laps + 1)))
        if not laps:
            return {}

        probs = []
        for lap_idx in laps:
            z = (lap_idx - target_lap) / 2.5
            p = float(np.exp(-0.5 * z * z))
            probs.append(p)
        total_p = sum(probs) or 1.0
        return {lap_idx: round(p / total_p, 4) for lap_idx, p in zip(laps, probs, strict=False)}

    def evaluate_undercut_threat(
        self,
        driver_number: int,
        driver_tyre_age: int,
        driver_compound: str,
        rival_number: int,
        rival_tyre_age: int,
        rival_compound: str,
        gap_s: float,  # positive if driver is ahead of rival
    ) -> UndercutThreat:
        """Evaluate if trailing rival poses an undercut threat, or leading rival is vulnerable."""
        is_trailing = 0.0 < gap_s <= self.undercut_gap_threshold_s

        compound_ranks = {"SOFT": 3, "S": 3, "MEDIUM": 2, "M": 2, "HARD": 1, "H": 1}
        d_rank = compound_ranks.get(driver_compound.upper(), 2)
        r_rank = compound_ranks.get(rival_compound.upper(), 2)

        pit_prob_factor = min(1.0, max(0.05, (rival_tyre_age - 8) / 20.0))
        if r_rank > d_rank:
            pit_prob_factor = min(1.0, pit_prob_factor + 0.25)

        is_undercut = (
            is_trailing
            and (gap_s <= self.undercut_gap_threshold_s)
            and (rival_tyre_age >= 12 or r_rank >= d_rank)
        )
        is_overcut = is_trailing and (driver_tyre_age < rival_tyre_age - 5) and (d_rank <= r_rank)

        exit_delta = gap_s - self.fresh_tyre_advantage_s

        if is_undercut and exit_delta <= 0:
            rec = "COVER_UNDERCUT"
        elif is_overcut:
            rec = "EXTEND_OVERCUT"
        else:
            rec = "HOLD"

        return UndercutThreat(
            driver_number=driver_number,
            rival_number=rival_number,
            gap_s=round(gap_s, 2),
            is_undercut_threat=bool(is_undercut),
            is_overcut_threat=bool(is_overcut),
            rival_pit_probability_3l=round(pit_prob_factor, 3),
            tyre_age_delta=rival_tyre_age - driver_tyre_age,
            estimated_delta_at_pit_exit_s=round(exit_delta, 2),
            recommended_action=rec,
        )

    def evaluate_grid_threats(
        self,
        grid_state: list[dict[str, Any]],
    ) -> list[UndercutThreat]:
        """Batch evaluate undercut/overcut threats across consecutive cars on the grid."""
        threats: list[UndercutThreat] = []
        if len(grid_state) < 2:
            return threats

        sorted_grid = sorted(grid_state, key=lambda d: d.get("position", 99))
        for i in range(len(sorted_grid) - 1):
            ahead = sorted_grid[i]
            behind = sorted_grid[i + 1]

            gap_s = float(behind.get("gap_to_car_ahead_s", 1.5) or 1.5)
            threat = self.evaluate_undercut_threat(
                driver_number=ahead.get("driver_number", 0),
                driver_tyre_age=ahead.get("tyre_age", 10),
                driver_compound=ahead.get("compound", "MEDIUM"),
                rival_number=behind.get("driver_number", 0),
                rival_tyre_age=behind.get("tyre_age", 10),
                rival_compound=behind.get("compound", "MEDIUM"),
                gap_s=gap_s,
            )
            threats.append(threat)
        return threats
