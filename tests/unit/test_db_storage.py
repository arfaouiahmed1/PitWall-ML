"""Unit tests for the dual-engine relational storage layer.

Verifies async SQLite in-memory and file engine initialization, URL normalization,
and CRUD operations on LiveSession, LiveDriverLap, LiveStint, and LiveHazardLog.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from pitwall.storage.db import (
    DEFAULT_SQLITE_URL,
    close_engine,
    create_async_db_engine,
    get_db,
    get_session_maker,
    init_db,
    normalize_database_url,
    reset_db,
    session_scope,
)
from pitwall.storage.models import (
    Base,
    LiveDriverLap,
    LiveHazardLog,
    LiveSession,
    LiveStint,
)


def test_normalize_database_url() -> None:
    """Test connection string normalization across dialiects and schemes."""
    assert normalize_database_url(None) == DEFAULT_SQLITE_URL
    assert normalize_database_url("") == DEFAULT_SQLITE_URL
    assert normalize_database_url("   ") == DEFAULT_SQLITE_URL

    # Legacy postgres scheme
    assert (
        normalize_database_url("postgres://pitwall:secret@localhost:5432/pitwall")
        == "postgresql+asyncpg://pitwall:secret@localhost:5432/pitwall"
    )
    # Sync postgresql scheme without explicit async driver
    assert (
        normalize_database_url("postgresql://pitwall:secret@postgres:5432/pitwall")
        == "postgresql+asyncpg://pitwall:secret@postgres:5432/pitwall"
    )
    # Already specified asyncpg
    assert (
        normalize_database_url("postgresql+asyncpg://pitwall:secret@postgres:5432/pitwall")
        == "postgresql+asyncpg://pitwall:secret@postgres:5432/pitwall"
    )

    # Sync sqlite scheme without explicit async driver
    assert (
        normalize_database_url("sqlite:///data/custom.db")
        == "sqlite+aiosqlite:///data/custom.db"
    )
    # Async sqlite scheme
    assert (
        normalize_database_url("sqlite+aiosqlite:///data/pitwall.db")
        == "sqlite+aiosqlite:///data/pitwall.db"
    )


@pytest.mark.asyncio
async def test_init_db_and_in_memory_crud() -> None:
    """Test table creation and CRUD operations in an isolated in-memory SQLite database."""
    engine = create_async_db_engine("sqlite+aiosqlite:///:memory:")
    await init_db(engine)

    session_maker = get_session_maker(engine)
    now = datetime.now(UTC)

    async with session_maker() as session:
        # 1. Insert LiveSession
        live_session = LiveSession(
            session_id="2024_01_bahrain_race",
            meeting_key="1229",
            session_key="9158",
            session_name="Race",
            session_type="Race",
            circuit_key="bahrain",
            circuit_name="Bahrain International Circuit",
            country="Bahrain",
            year=2024,
            track_status="GREEN",
            total_laps=57,
            current_lap=1,
            is_active=True,
            extra_metadata={"air_temp": 24.5, "track_temp": 31.0},
            created_at=now,
            updated_at=now,
        )
        session.add(live_session)
        await session.commit()

    async with session_maker() as session:
        # Query session back
        stmt = select(LiveSession).where(LiveSession.session_id == "2024_01_bahrain_race")
        result = await session.execute(stmt)
        fetched_session = result.scalar_one_or_none()

        assert fetched_session is not None
        assert fetched_session.session_id == "2024_01_bahrain_race"
        assert fetched_session.circuit_name == "Bahrain International Circuit"
        assert fetched_session.total_laps == 57
        assert fetched_session.extra_metadata == {"air_temp": 24.5, "track_temp": 31.0}

        # 2. Insert LiveDriverLap and LiveStint
        lap_1 = LiveDriverLap(
            session_id="2024_01_bahrain_race",
            driver_number=4,
            lap_number=1,
            lap_time_s=94.321,
            sector_1_s=31.111,
            sector_2_s=40.222,
            sector_3_s=22.988,
            compound="SOFT",
            tyre_age=1,
            stint_no=1,
            position=3,
            gap_to_leader_s=1.85,
            interval_s=0.65,
            is_valid=True,
            is_pit_in=False,
            is_pit_out=False,
            track_status="GREEN",
            event_ts=now,
        )

        stint_1 = LiveStint(
            session_id="2024_01_bahrain_race",
            driver_number=4,
            stint_no=1,
            compound="SOFT",
            lap_start=1,
            lap_end=15,
            tyre_age_start=0,
            tyre_age_end=15,
        )

        # 3. Insert LiveHazardLog
        hazard = LiveHazardLog(
            session_id="2024_01_bahrain_race",
            lap_number=1,
            driver_number=None,
            hazard_type="YELLOW_FLAG",
            status="ACTIVE",
            flag="YELLOW",
            message="Debris turn 4",
            p_sc=0.08,
            p_vsc=0.15,
            risk_tier="LOW",
            event_ts=now,
        )

        session.add_all([lap_1, stint_1, hazard])
        await session.commit()

    async with session_maker() as session:
        # Query lap using indexed compound key (session_id, driver_number)
        lap_stmt = select(LiveDriverLap).where(
            LiveDriverLap.session_id == "2024_01_bahrain_race",
            LiveDriverLap.driver_number == 4,
            LiveDriverLap.lap_number == 1,
        )
        lap_res = await session.execute(lap_stmt)
        driver_lap = lap_res.scalar_one_or_none()
        assert driver_lap is not None
        assert driver_lap.driver_number == 4
        assert driver_lap.lap_time_s == 94.321
        assert driver_lap.compound == "SOFT"

        # Query stint using indexed compound key
        stint_stmt = select(LiveStint).where(
            LiveStint.session_id == "2024_01_bahrain_race",
            LiveStint.driver_number == 4,
        )
        stint_res = await session.execute(stint_stmt)
        driver_stint = stint_res.scalar_one_or_none()
        assert driver_stint is not None
        assert driver_stint.stint_no == 1
        assert driver_stint.lap_start == 1
        assert driver_stint.lap_end == 15

        # Query hazard using indexed key (session_id, lap_number)
        haz_stmt = select(LiveHazardLog).where(
            LiveHazardLog.session_id == "2024_01_bahrain_race",
            LiveHazardLog.lap_number == 1,
        )
        haz_res = await session.execute(haz_stmt)
        hazard_entry = haz_res.scalar_one_or_none()
        assert hazard_entry is not None
        assert hazard_entry.hazard_type == "YELLOW_FLAG"
        assert hazard_entry.p_sc == 0.08

    await engine.dispose()


@pytest.mark.asyncio
async def test_sqlite_file_creation_and_directory_prep(tmp_path: Path) -> None:
    """Verify that SQLite file path automatically creates non-existent parent directory."""
    db_file = tmp_path / "nested" / "subfolder" / "test_pitwall.db"
    db_url = f"sqlite+aiosqlite:///{db_file}"

    assert not db_file.parent.exists()

    engine = create_async_db_engine(db_url)
    assert db_file.parent.exists()

    await init_db(engine)
    assert db_file.exists()

    async with session_scope(engine) as session:
        session.add(
            LiveSession(
                session_id="2024_02_monaco_race",
                circuit_name="Monaco",
                is_active=True,
            )
        )

    async with session_scope(engine) as session:
        res = await session.execute(
            select(LiveSession).where(LiveSession.session_id == "2024_02_monaco_race")
        )
        row = res.scalar_one_or_none()
        assert row is not None
        assert row.circuit_name == "Monaco"

    await engine.dispose()


@pytest.mark.asyncio
async def test_session_scope_rollback_on_exception() -> None:
    """Verify that session_scope rolls back on unhandled error and re-raises."""
    engine = create_async_db_engine("sqlite+aiosqlite:///:memory:")
    await init_db(engine)

    with pytest.raises(ValueError, match="Simulated failure"):
        async with session_scope(engine) as session:
            session.add(
                LiveSession(
                    session_id="failed_session",
                    circuit_name="Silverstone",
                )
            )
            raise ValueError("Simulated failure")

    async with session_scope(engine) as session:
        res = await session.execute(
            select(LiveSession).where(LiveSession.session_id == "failed_session")
        )
        assert res.scalar_one_or_none() is None

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_db_dependency() -> None:
    """Verify get_db async generator yields session and commits."""
    # Set DATABASE_URL to in-memory for default engine
    old_db_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    await close_engine()

    try:
        await init_db()
        gen = get_db()
        session = await anext(gen)
        assert session is not None

        session.add(
            LiveSession(
                session_id="dep_session",
                circuit_name="Spa",
            )
        )
        # Finalize generator
        try:
            await anext(gen)
        except StopAsyncIteration:
            pass

        # Verify committed in next session
        gen2 = get_db()
        session2 = await anext(gen2)
        res = await session2.execute(
            select(LiveSession).where(LiveSession.session_id == "dep_session")
        )
        assert res.scalar_one_or_none() is not None
        try:
            await anext(gen2)
        except StopAsyncIteration:
            pass

    finally:
        await close_engine()
        if old_db_url is not None:
            os.environ["DATABASE_URL"] = old_db_url
        else:
            os.environ.pop("DATABASE_URL", None)


@pytest.mark.asyncio
async def test_reset_db() -> None:
    """Verify reset_db drops and recreates schema."""
    engine = create_async_db_engine("sqlite+aiosqlite:///:memory:")
    await init_db(engine)

    async with session_scope(engine) as session:
        session.add(LiveSession(session_id="test_reset", circuit_name="Monza"))

    # Reset
    await reset_db(engine)

    # After reset, table is empty
    async with session_scope(engine) as session:
        res = await session.execute(select(LiveSession))
        assert res.scalars().all() == []

    await engine.dispose()
