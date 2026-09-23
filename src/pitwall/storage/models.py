"""Declarative SQLAlchemy 2.0 relational models for live race storage.

Cross-dialect compatible (PostgreSQL + SQLite) with timezone-aware UTC timestamps
and compound performance indexes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    """Return timezone-aware current UTC datetime."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Declarative base class for PitWall relational models."""

    pass


class LiveSession(Base):
    """Tracked live session metadata and high-level status."""

    __tablename__ = "live_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    session_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    circuit_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    circuit_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_status: Mapped[str] = mapped_column(String(32), default="GREEN")
    total_laps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_lap: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    # Relationships
    laps: Mapped[list[LiveDriverLap]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    stints: Mapped[list[LiveStint]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    hazard_logs: Mapped[list[LiveHazardLog]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    weather_records: Mapped[list[LiveWeatherRecord]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    event_records: Mapped[list[LiveEventRecord]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<LiveSession(session_id={self.session_id!r}, circuit={self.circuit_name!r}, active={self.is_active})>"


class LiveDriverLap(Base):
    """Driver lap record with timing, sector splits, intervals, and tyre telemetry."""

    __tablename__ = "live_driver_laps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("live_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    driver_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    lap_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    lap_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    sector_1_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    sector_2_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    sector_3_s: Mapped[float | None] = mapped_column(Float, nullable=True)

    compound: Mapped[str | None] = mapped_column(String(32), nullable=True, default="UNKNOWN")
    tyre_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stint_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)

    gap_to_leader_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    interval_s: Mapped[float | None] = mapped_column(Float, nullable=True)

    is_valid: Mapped[bool] = mapped_column(Boolean, default=True)
    is_pit_in: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pit_out: Mapped[bool] = mapped_column(Boolean, default=False)

    track_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[LiveSession] = relationship(back_populates="laps")

    __table_args__ = (
        Index("ix_live_driver_laps_session_driver", "session_id", "driver_number"),
        Index("ix_live_driver_laps_session_lap", "session_id", "lap_number"),
        UniqueConstraint(
            "session_id",
            "driver_number",
            "lap_number",
            name="uq_live_driver_laps_session_driver_lap",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<LiveDriverLap(session={self.session_id!r}, d={self.driver_number}, "
            f"lap={self.lap_number}, time={self.lap_time_s})>"
        )


class LiveStint(Base):
    """Driver tyre stint tracking start/end laps and tyre age progression."""

    __tablename__ = "live_stints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("live_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    driver_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    stint_no: Mapped[int] = mapped_column(Integer, nullable=False)

    compound: Mapped[str] = mapped_column(String(32), nullable=False, default="UNKNOWN")
    lap_start: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    lap_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tyre_age_start: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tyre_age_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    session: Mapped[LiveSession] = relationship(back_populates="stints")

    __table_args__ = (
        Index("ix_live_stints_session_driver", "session_id", "driver_number"),
        Index("ix_live_stints_session_driver_stint", "session_id", "driver_number", "stint_no"),
        UniqueConstraint(
            "session_id",
            "driver_number",
            "stint_no",
            name="uq_live_stints_session_driver_stint",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<LiveStint(session={self.session_id!r}, d={self.driver_number}, "
            f"stint={self.stint_no}, {self.compound} L{self.lap_start}-{self.lap_end})>"
        )


class LiveHazardLog(Base):
    """Neutralization, safety car, and race control hazard history with ML risk probabilities."""

    __tablename__ = "live_hazard_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("live_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lap_number: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    driver_number: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    hazard_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    flag: Mapped[str | None] = mapped_column(String(32), nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ML hazard predictions
    p_sc: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_vsc: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_tier: Mapped[str | None] = mapped_column(String(32), nullable=True)

    event_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[LiveSession] = relationship(back_populates="hazard_logs")

    __table_args__ = (
        Index("ix_live_hazard_logs_session_lap", "session_id", "lap_number"),
        Index("ix_live_hazard_logs_session_driver", "session_id", "driver_number"),
    )

    def __repr__(self) -> str:
        return (
            f"<LiveHazardLog(session={self.session_id!r}, type={self.hazard_type!r}, "
            f"status={self.status!r}, lap={self.lap_number})>"
        )


class LiveWeatherRecord(Base):
    """Persisted track weather observation with ambient/track conditions and source timestamp."""

    __tablename__ = "live_weather_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("live_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    air_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    track_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_mbar: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_dir_deg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rainfall_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    rainfall_prob: Mapped[float | None] = mapped_column(Float, nullable=True)

    source_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[LiveSession] = relationship(back_populates="weather_records")

    __table_args__ = (
        Index("ix_live_weather_session_time", "session_id", "source_timestamp"),
    )

    def __repr__(self) -> str:
        return (
            f"<LiveWeatherRecord(session={self.session_id!r}, air={self.air_temp_c}, "
            f"track={self.track_temp_c}, rain={self.rainfall_mm})>"
        )


class LiveEventRecord(Base):
    """Raw event stream persistence logging all canonical RaceEvents with full JSON payload."""

    __tablename__ = "live_event_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("live_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    driver_number: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    event_ts: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    source: Mapped[str] = mapped_column(String(32), default="openf1")
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    session: Mapped[LiveSession] = relationship(back_populates="event_records")

    __table_args__ = (
        Index("ix_live_events_session_type", "session_id", "event_type"),
        Index("ix_live_events_session_ts", "session_id", "event_ts"),
    )

    def __repr__(self) -> str:
        return (
            f"<LiveEventRecord(session={self.session_id!r}, type={self.event_type!r}, "
            f"driver={self.driver_number}, ts={self.event_ts})>"
        )
