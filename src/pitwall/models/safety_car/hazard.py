"""Safety car / Virtual Safety Car neutralization hazard model."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Historical neutralization probability priors per circuit (2018-2025 data)
CIRCUIT_SC_PRIORS: dict[str, float] = {
    "monaco": 0.80,
    "singapore": 0.85,
    "baku": 0.75,
    "jeddah": 0.70,
    "saudi_arabia": 0.70,
    "melbourne": 0.65,
    "albert_park": 0.65,
    "australia": 0.65,
    "montreal": 0.65,
    "canada": 0.65,
    "zandvoort": 0.55,
    "interlagos": 0.60,
    "brazil": 0.60,
    "spa": 0.50,
    "silverstone": 0.45,
    "austin": 0.45,
    "cota": 0.45,
    "red_bull_ring": 0.40,
    "austria": 0.40,
    "bahrain": 0.35,
    "barcelona": 0.30,
    "catalunya": 0.30,
    "monza": 0.25,
    "hungaroring": 0.30,
    "las_vegas": 0.65,
    "yas_marina": 0.35,
    "abu_dhabi": 0.35,
    "default": 0.45,
}


@dataclass
class NeutralizationPrediction:
    """Predicted hazard of neutralization over upcoming laps."""

    p_sc_next_1: float
    p_vsc_next_1: float
    p_neutralization_next_3: float
    circuit_risk_tier: str  # "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH"
    risk_factors: list[str]


class SafetyCarHazardModel:
    """Logistic hazard model predicting P(SC / VSC next lap) given track context."""

    def __init__(self, baseline_lap_sc_rate: float = 0.015) -> None:
        self.baseline_lap_sc_rate = baseline_lap_sc_rate

    def get_circuit_prior(self, circuit_id: str | None) -> float:
        if not circuit_id:
            return CIRCUIT_SC_PRIORS["default"]
        key = circuit_id.lower().replace("-", "_").replace(" ", "_")
        for k, v in CIRCUIT_SC_PRIORS.items():
            if k in key:
                return v
        return CIRCUIT_SC_PRIORS["default"]

    def predict_hazard(
        self,
        circuit_id: str | None = None,
        lap_number: int = 1,
        total_laps: int = 66,
        track_status: str | None = "1",
        is_rain: bool = False,
        recent_yellows: int = 0,
    ) -> NeutralizationPrediction:
        """Predict instantaneous hazard for the upcoming lap and next 3 laps."""
        prior = self.get_circuit_prior(circuit_id)

        # Baseline per-lap logit
        base_p = (prior / max(1, total_laps)) * 1.5
        logit = np.log(max(1e-4, base_p / (1.0 - min(0.99, base_p))))

        risk_factors: list[str] = []

        # 1. Lap 1 / race start surge (3.5x hazard)
        if lap_number == 1:
            logit += 1.25
            risk_factors.append("LAP_1_START_CHAOS")
        elif lap_number <= 3:
            logit += 0.5
            risk_factors.append("OPENING_STINT_CONGESTION")

        # 2. Late race restart / tire cliff fatigue
        progress = lap_number / max(1, total_laps)
        if progress >= 0.85:
            logit += 0.35
            risk_factors.append("LATE_RACE_ATTRITION")

        # 3. Yellow flag active or recent yellow incidents
        status_str = str(track_status or "")
        if "2" in status_str:  # Yellow flag code
            logit += 1.6
            risk_factors.append("ACTIVE_YELLOW_FLAG")
        elif recent_yellows > 0:
            logit += 0.4 * min(3, recent_yellows)
            risk_factors.append("INCIDENT_CHAIN_RISK")

        # 4. Wet track transitions
        if is_rain:
            logit += 1.1
            risk_factors.append("WET_TRACK_CONDITIONS")

        # Convert back from logit
        p_sc_1 = float(1.0 / (1.0 + np.exp(-logit)))
        p_sc_1 = min(0.85, max(0.005, p_sc_1))

        # VSC probability is ~1.2x SC in modern era for single-car retirements
        p_vsc_1 = min(0.90, p_sc_1 * 1.15)

        # Combined 3-lap neutralization window
        p_any_1 = 1.0 - (1.0 - p_sc_1) * (1.0 - p_vsc_1 * 0.7)
        p_3 = float(1.0 - (1.0 - p_any_1) ** 3)

        if prior >= 0.70:
            tier = "VERY_HIGH"
        elif prior >= 0.50:
            tier = "HIGH"
        elif prior >= 0.35:
            tier = "MEDIUM"
        else:
            tier = "LOW"

        return NeutralizationPrediction(
            p_sc_next_1=round(p_sc_1, 3),
            p_vsc_next_1=round(p_vsc_1, 3),
            p_neutralization_next_3=round(p_3, 3),
            circuit_risk_tier=tier,
            risk_factors=risk_factors,
        )
