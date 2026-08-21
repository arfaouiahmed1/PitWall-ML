"""Silver / Gold lap-level schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Compound = Literal["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN"]


class LapRecord(BaseModel):
    session_id: str
    driver_number: int
    driver_id: str | None = None
    team_id: str | None = None
    lap_number: int = Field(ge=1)
    lap_time_s: float | None = Field(default=None, ge=0)
    lap_time: str | None = None  # original string
    is_valid: bool = True
    is_pit_in: bool = False
    is_pit_out: bool = False
    is_safety_car: bool = False
    is_vsc: bool = False
    is_deleted: bool = False
    compound: Compound = "UNKNOWN"
    tyre_age: int | None = Field(default=None, ge=0)
    stint_no: int | None = None
    position: int | None = Field(default=None, ge=1)
    track_status: str | None = None
    event_ts: datetime | None = None
    sector_1_s: float | None = None
    sector_2_s: float | None = None
    sector_3_s: float | None = None


class StintRecord(BaseModel):
    session_id: str
    driver_number: int
    stint_no: int
    compound: Compound
    tyre_age_start: int
    tyre_age_end: int | None = None
    lap_start: int
    lap_end: int | None = None
    is_valid_training_stint: bool = True
