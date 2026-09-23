"""Asynchronous database engine factory, session management, and table initializers.

Supports PostgreSQL via asyncpg and SQLite via aiosqlite with automatic URL
normalization, directory preparation, and zero-config local fallback.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from pitwall.schemas.events import EventType, RaceEvent
from pitwall.storage.models import (
    Base,
    LiveDriverLap,
    LiveEventRecord,
    LiveSession,
    LiveWeatherRecord,
)

DEFAULT_SQLITE_URL = "sqlite+aiosqlite:///data/pitwall.db"

_GLOBAL_ENGINE: AsyncEngine | None = None
_GLOBAL_SESSION_MAKER: async_sessionmaker[AsyncSession] | None = None


def normalize_database_url(raw_url: str | None = None) -> str:
    """Normalize database connection string for async drivers.

    Handles legacy 'postgres://', un-drivered 'postgresql://', and synchronous
    'sqlite://' URLs. Defaults to local SQLite file when url is empty or None.
    """
    if raw_url is None:
        raw_url = os.getenv("DATABASE_URL", "")

    url = raw_url.strip()
    if not url:
        return DEFAULT_SQLITE_URL

    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://") and not url.startswith("postgresql+"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("sqlite://") and not url.startswith("sqlite+"):
        return url.replace("sqlite://", "sqlite+aiosqlite://", 1)

    return url


def _prepare_sqlite_directory(url: str) -> None:
    """Ensure parent directory exists for SQLite database files."""
    if not url.startswith("sqlite+aiosqlite:///"):
        return

    # Extract path portion after scheme
    db_path_str = url.split("sqlite+aiosqlite:///", 1)[-1]
    # Ignore in-memory databases
    if not db_path_str or db_path_str == ":memory:" or "mode=memory" in db_path_str:
        return

    parsed = urlparse(url)
    target_path = Path(parsed.path.lstrip("/") if os.name == "nt" and ":" in parsed.path else db_path_str)
    if not target_path.is_absolute():
        target_path = Path.cwd() / target_path

    target_path.parent.mkdir(parents=True, exist_ok=True)


def create_async_db_engine(
    database_url: str | None = None,
    echo: bool = False,
    **kwargs: Any,
) -> AsyncEngine:
    """Create a configured AsyncEngine instance with driver-specific optimizations.

    Args:
        database_url: Connection URL. Normalized if raw PostgreSQL or synchronous SQLite.
        echo: Enable SQLAlchemy engine SQL statement logging.
        **kwargs: Extra parameters passed to create_async_engine.

    Returns:
        Configured AsyncEngine.
    """
    url = normalize_database_url(database_url)
    connect_args = kwargs.pop("connect_args", {})

    if "sqlite" in url:
        _prepare_sqlite_directory(url)
        connect_args.setdefault("check_same_thread", False)
        if ":memory:" in url or "mode=memory" in url:
            kwargs.setdefault("poolclass", StaticPool)

    return create_async_engine(
        url,
        echo=echo,
        connect_args=connect_args,
        **kwargs,
    )


def get_engine(database_url: str | None = None) -> AsyncEngine:
    """Get or create singleton AsyncEngine instance."""
    global _GLOBAL_ENGINE
    if _GLOBAL_ENGINE is None:
        _GLOBAL_ENGINE = create_async_db_engine(database_url)
    return _GLOBAL_ENGINE


def get_session_maker(
    engine: AsyncEngine | None = None,
) -> async_sessionmaker[AsyncSession]:
    """Get or create async_sessionmaker bound to specified or default engine."""
    global _GLOBAL_SESSION_MAKER
    eng = engine or get_engine()
    if engine is not None or _GLOBAL_SESSION_MAKER is None:
        maker = async_sessionmaker(
            bind=eng,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
        if engine is None:
            _GLOBAL_SESSION_MAKER = maker
        return maker
    return _GLOBAL_SESSION_MAKER


async def init_db(engine: AsyncEngine | None = None) -> None:
    """Initialize database schema, creating all tables if not already present."""
    eng = engine or get_engine()
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def reset_db(engine: AsyncEngine | None = None) -> None:
    """Drop and recreate all tables for test or fresh state reset."""
    eng = engine or get_engine()
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def close_engine() -> None:
    """Dispose active engine connection pool and reset global references."""
    global _GLOBAL_ENGINE, _GLOBAL_SESSION_MAKER
    if _GLOBAL_ENGINE is not None:
        await _GLOBAL_ENGINE.dispose()
        _GLOBAL_ENGINE = None
        _GLOBAL_SESSION_MAKER = None


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a managed async database session."""
    session_factory = get_session_maker()
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def session_scope(
    engine: AsyncEngine | None = None,
) -> AsyncGenerator[AsyncSession, None]:
    """Context manager for standalone async database sessions."""
    session_factory = get_session_maker(engine)
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def save_live_event_to_db(
    event: RaceEvent,
    session_id: str | None = None,
    engine: AsyncEngine | None = None,
) -> None:
    """Persist canonical RaceEvent into relational tables (event stream + domain tables)."""
    sid = str(session_id or event.session_key or event.source_id or "default")
    event_type_str = (
        event.event_type.value
        if isinstance(event.event_type, EventType)
        else str(event.event_type)
    )

    async with session_scope(engine=engine) as session:
        # Ensure LiveSession exists
        live_session = await session.get(LiveSession, sid)
        if live_session is None:
            live_session = LiveSession(
                session_id=sid,
                session_key=str(event.session_key) if event.session_key else None,
                meeting_key=str(event.meeting_key) if event.meeting_key else None,
                is_active=True,
            )
            session.add(live_session)
            await session.flush()

        # 1. Log generic event record
        event_record = LiveEventRecord(
            session_id=sid,
            event_type=event_type_str,
            driver_number=event.driver_number,
            event_ts=event.event_ts,
            source=str(event.source),
            source_id=str(event.source_id) if event.source_id else None,
            source_key=str(event.source_key) if event.source_key else None,
            payload_json=event.payload,
        )
        session.add(event_record)

        # 2. Domain-specific tables
        p = event.payload
        if event_type_str == "weather":
            weather_record = LiveWeatherRecord(
                session_id=sid,
                air_temp_c=p.get("air_temperature"),
                track_temp_c=p.get("track_temperature"),
                humidity_pct=p.get("humidity"),
                pressure_mbar=p.get("pressure"),
                wind_speed_kmh=p.get("wind_speed"),
                wind_dir_deg=p.get("wind_direction"),
                rainfall_mm=float(p.get("rainfall", 0) or 0),
                rainfall_prob=p.get("rainfall_prob"),
                source_timestamp=event.event_ts,
            )
            session.add(weather_record)
        elif event_type_str == "lap" and event.driver_number is not None:
            lap_no = p.get("lap_number")
            if lap_no is not None:
                existing_lap = await session.execute(
                    select(LiveDriverLap).where(
                        LiveDriverLap.session_id == sid,
                        LiveDriverLap.driver_number == event.driver_number,
                        LiveDriverLap.lap_number == int(lap_no),
                    )
                )
                if not existing_lap.scalar_one_or_none():
                    lap_record = LiveDriverLap(
                        session_id=sid,
                        driver_number=event.driver_number,
                        lap_number=int(lap_no),
                        lap_time_s=p.get("lap_time_s") or p.get("lap_duration"),
                        sector_1_s=p.get("duration_sector_1"),
                        sector_2_s=p.get("duration_sector_2"),
                        sector_3_s=p.get("duration_sector_3"),
                        event_ts=event.event_ts,
                    )
                    session.add(lap_record)


async def get_latest_weather_from_db(
    session_id: str,
    engine: AsyncEngine | None = None,
) -> dict[str, Any] | None:
    """Retrieve the most recent weather observation from relational storage."""
    async with session_scope(engine=engine) as session:
        stmt = (
            select(LiveWeatherRecord)
            .where(LiveWeatherRecord.session_id == session_id)
            .order_by(desc(LiveWeatherRecord.source_timestamp), desc(LiveWeatherRecord.id))
            .limit(1)
        )
        res = await session.execute(stmt)
        record = res.scalar_one_or_none()
        if record is None:
            return None
        return {
            "session_id": record.session_id,
            "air_temp_c": record.air_temp_c,
            "track_temp_c": record.track_temp_c,
            "humidity_pct": record.humidity_pct,
            "pressure_mbar": record.pressure_mbar,
            "wind_speed_kmh": record.wind_speed_kmh,
            "wind_dir_deg": record.wind_dir_deg,
            "rainfall_mm": record.rainfall_mm,
            "rainfall_prob": record.rainfall_prob,
            "source_timestamp": record.source_timestamp.isoformat()
            if record.source_timestamp
            else None,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }


async def get_weather_history_from_db(
    session_id: str,
    limit: int = 50,
    engine: AsyncEngine | None = None,
) -> list[dict[str, Any]]:
    """Retrieve recent historical weather observations from relational storage."""
    async with session_scope(engine=engine) as session:
        stmt = (
            select(LiveWeatherRecord)
            .where(LiveWeatherRecord.session_id == session_id)
            .order_by(desc(LiveWeatherRecord.source_timestamp), desc(LiveWeatherRecord.id))
            .limit(limit)
        )
        res = await session.execute(stmt)
        records = res.scalars().all()
        return [
            {
                "session_id": r.session_id,
                "air_temp_c": r.air_temp_c,
                "track_temp_c": r.track_temp_c,
                "humidity_pct": r.humidity_pct,
                "pressure_mbar": r.pressure_mbar,
                "wind_speed_kmh": r.wind_speed_kmh,
                "wind_dir_deg": r.wind_dir_deg,
                "rainfall_mm": r.rainfall_mm,
                "rainfall_prob": r.rainfall_prob,
                "source_timestamp": r.source_timestamp.isoformat()
                if r.source_timestamp
                else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ]
