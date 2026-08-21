"""Prediction schemas — shared contract between models and API."""

from __future__ import annotations

from datetime import UTC, datetime

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
        if q10 is not None and q50 is not None:
            assert q10 <= q50 <= v, (
                f"Quantiles must be ordered q10({q10}) <= q50({q50}) <= q90({v})"
            )
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
