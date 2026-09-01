"""Prediction schemas — shared contract between models and API."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class PacePrediction(BaseModel):
    driver_number: int
    lap_number: int | None = None
    q10: float = Field(description="10th percentile predicted lap time (s)")
    q50: float = Field(description="Median predicted lap time (s)")
    q90: float = Field(description="90th percentile predicted lap time (s)")
    model_version: str = "unknown"
    model_alias: str = "champion"
    latency_ms: float | None = None
    event_ts: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("q90")
    @classmethod
    def check_ordered(cls, v: float, info) -> float:  # type: ignore[no-untyped-def]
        q10 = info.data.get("q10")
        q50 = info.data.get("q50")
        if q10 is not None and q50 is not None and not (q10 <= q50 <= v):
            raise ValueError(f"Quantiles must be ordered q10({q10}) <= q50({q50}) <= q90({v})")
        return v

    @property
    def interval_width(self) -> float:
        return self.q90 - self.q10


class PitHazardPrediction(BaseModel):
    driver_number: int
    lap_number: int
    p_next_1: float = Field(ge=0, le=1, description="P(pit within next 1 lap)")
    p_next_3: float = Field(ge=0, le=1)
    p_next_5: float = Field(ge=0, le=1)
    model_version: str = "unknown"


class TyrePrediction(BaseModel):
    driver_number: int
    compound: str
    tyre_age: int
    predicted_degradation_s_per_lap: float
    degradation_q10: float | None = None
    degradation_q90: float | None = None
    model_version: str = "unknown"


class SimulationResult(BaseModel):
    driver_number: int
    p_win: float = Field(ge=0, le=1)
    p_podium: float = Field(ge=0, le=1)
    p_top5: float = Field(ge=0, le=1)
    expected_position: float
    position_distribution: dict[int, float] = Field(default_factory=dict)
    n_simulations: int = 5000


# --- Iteration 6: What-If Strategy Schemas ---


class WhatIfRequest(BaseModel):
    """Interactive strategy what-if request.

    Mirrors spec: driver_number, target_pit_lap, target_compound,
    push_pace_delta_s, remaining_laps, current_lap, simulations.

    push_pace_delta_s: negative = push faster (tire wear trade-off), positive = management/conserve.
    """

    driver_number: int = Field(description="Driver number to apply strategy to")
    target_pit_lap: int = Field(ge=1, description="Lap on which driver pits in what-if scenario")
    target_compound: str = Field(
        default="HARD", description="Compound to switch to at pit (SOFT/MEDIUM/HARD/I/W)"
    )
    push_pace_delta_s: float = Field(
        default=0.0,
        ge=-0.5,
        le=0.5,
        description="Pace delta vs baseline (-0.5s push to +0.5s management)",
    )
    remaining_laps: int = Field(
        default=30, ge=1, le=100, description="Laps remaining in race from current lap"
    )
    current_lap: int = Field(
        default=1, ge=1, description="Current lap number (for horizon validation)"
    )
    simulations: int = Field(
        default=1000, ge=10, le=10000, description="Monte Carlo simulations to run"
    )

    @field_validator("target_compound")
    @classmethod
    def validate_compound(cls, v: str) -> str:
        allowed = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "I", "W", "UNKNOWN"}
        up = v.upper()
        if up not in allowed:
            # allow any but normalize; keep strict for known values
            # fallback to uppercased
            return up
        # normalize I/W shorthands
        if up == "I":
            return "INTERMEDIATE"
        if up == "W":
            return "WET"
        return up


class WhatIfResponse(BaseModel):
    """Response for POST /whatif - strategy scenario delta vs baseline."""

    driver_number: int
    target_pit_lap: int
    target_compound: str
    push_pace_delta_s: float
    # Core spec fields
    re_entry_position_dist: dict[int, float] = Field(
        default_factory=dict, description="Projected re-entry position distribution (pos -> prob)"
    )
    # Alias for spec compatibility
    position_distribution: dict[int, float] | None = Field(
        default=None, description="Alias of re_entry_position_dist for backwards compat"
    )
    time_delta_s: float = Field(
        description="Net race time delta vs baseline plan (seconds, negative = faster)"
    )
    win_prob_delta: float = Field(
        description="Win probability delta (what-if P(win) - baseline P(win))"
    )
    cliff_risk: float = Field(ge=0, le=1, description="Tire degradation cliff risk index 0..1")

    # Extended diagnostics
    baseline_win_prob: float = Field(ge=0, le=1, default=0.0)
    whatif_win_prob: float = Field(ge=0, le=1, default=0.0)
    baseline_expected_position: float | None = None
    whatif_expected_position: float | None = None
    baseline_p_podium: float | None = None
    whatif_p_podium: float | None = None
    n_simulations: int = 1000
    model_version: str = "unknown"

    def model_post_init(self, __context: Any) -> None:  # type: ignore[override]
        # keep alias in sync
        if self.position_distribution is None:
            object.__setattr__(self, "position_distribution", dict(self.re_entry_position_dist))
        elif not self.re_entry_position_dist:
            object.__setattr__(self, "re_entry_position_dist", dict(self.position_distribution))
