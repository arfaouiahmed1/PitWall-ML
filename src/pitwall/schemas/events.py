"""Canonical RaceEvent — event-time normalized representation for all sources.

Every upstream source (OpenF1 live/historical, FastF1, Parquet replay) is
adapted to this schema. Replay and live share the same interface.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class EventType(str, Enum):
    LAP = "lap"
    CAR_DATA = "car_data"
    POSITION = "position"
    INTERVAL = "interval"
    PIT = "pit"
    STINT = "stint"
    WEATHER = "weather"
    RACE_CONTROL = "race_control"
    SESSION_STATUS = "session_status"
    DRIVER = "driver"
    MEETING = "meeting"
    TELEMETRY = "telemetry"


class RaceEvent(BaseModel):
    """Normalized race event — single source of truth for downstream consumers.

    Maps to Bronze storage columns. `event_ts` is event time (when it happened
    on track), `ingest_ts` is processing time. Separation enables lag/freshness
    monitoring and point-in-time correctness.
    """

    source: str = Field(description="Origin: openf1, fastf1, jolpica, parquet_replay")
    event_type: EventType | str

    meeting_key: str | int | None = None
    session_key: str | int | None = None

    driver_number: int | None = None

    event_ts: datetime = Field(description="Event time — when it occurred on track")
    ingest_ts: datetime = Field(default_factory=lambda: datetime.now(UTC))

    source_id: str | None = None
    source_key: str | None = None
    schema_version: int = 1

    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_ts", "ingest_ts", mode="before")
    @classmethod
    def ensure_tz(cls, v: Any) -> datetime:
        if isinstance(v, str):
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=UTC)
        return v

    @property
    def session_id(self) -> str:
        return f"{self.meeting_key}_{self.session_key}"

    model_config = {"extra": "forbid"}


class SessionInfo(BaseModel):
    meeting_key: str | int
    session_key: str | int
    session_name: str
    session_type: str
    circuit_key: str | int | None = None
    circuit_name: str | None = None
    country: str | None = None
    date_start: datetime | None = None
    date_end: datetime | None = None
    year: int | None = None
    regulation_era: str = "unknown"
