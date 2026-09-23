"""Tests for persistent DB state, Alembic migrations, weather storage, and MLOps readiness."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pitwall_api.main as main
import pytest
from sqlalchemy import text

from pitwall.schemas.events import EventType, RaceEvent
from pitwall.storage.db import (
    create_async_db_engine,
    get_engine,
    init_db,
    save_live_event_to_db,
)


@pytest.mark.asyncio
async def test_relational_data_persists_across_engine_restart(tmp_path: Path) -> None:
    db_file = tmp_path / "test_persistence.db"
    db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"

    # 1. Initial engine initialization and writes
    engine1 = create_async_db_engine(db_url)
    await init_db(engine1)

    event_time = datetime(2026, 3, 1, 14, 30, 0, tzinfo=UTC)
    weather_event = RaceEvent(
        source="openf1",
        event_type=EventType.WEATHER,
        session_key="persisted-session-1",
        event_ts=event_time,
        payload={
            "air_temperature": 27.5,
            "track_temperature": 42.0,
            "humidity": 55.0,
            "pressure": 1012.8,
            "wind_speed": 3.8,
            "wind_direction": 190,
            "rainfall": 0,
        },
    )

    # Use engine1
    await save_live_event_to_db(weather_event, session_id="persisted-session-1", engine=engine1)

    # Dispose engine1 (simulating process restart)
    await engine1.dispose()

    # 2. Re-create new engine pointing to same file and assert data persisted
    engine2 = create_async_db_engine(db_url)
    async with engine2.connect() as conn:
        res = await conn.execute(
            text("SELECT air_temp_c, track_temp_c, rainfall_mm FROM live_weather_records WHERE session_id = 'persisted-session-1'")
        )
        row = res.fetchone()
        assert row is not None
        assert row[0] == 27.5
        assert row[1] == 42.0
        assert row[2] == 0.0

        # Assert generic event log row also persisted
        event_res = await conn.execute(
            text("SELECT event_type, source FROM live_event_records WHERE session_id = 'persisted-session-1'")
        )
        event_row = event_res.fetchone()
        assert event_row is not None
        assert event_row[0] == "weather"
        assert event_row[1] == "openf1"

    await engine2.dispose()


@pytest.mark.asyncio
async def test_weather_endpoints_return_persisted_data_and_unavailable_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Initialize DB with known weather record
    engine = get_engine()
    await init_db(engine)

    weather_event = RaceEvent(
        source="openf1",
        event_type=EventType.WEATHER,
        session_key="weather-test-session",
        event_ts=datetime.now(UTC),
        payload={
            "air_temperature": 23.4,
            "track_temperature": 36.1,
            "humidity": 48.0,
            "pressure": 1015.0,
            "wind_speed": 4.5,
            "wind_direction": 120,
            "rainfall": 0,
        },
    )
    await save_live_event_to_db(weather_event, session_id="weather-test-session")

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Successful retrieval for existing session
        res = await client.get("/weather/latest?session_id=weather-test-session")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "available"
        assert data["weather"]["air_temp_c"] == 23.4
        assert data["weather"]["track_temp_c"] == 36.1
        assert data["provenance"] == "OPENF1"

        # 2. History retrieval
        hist_res = await client.get("/weather/history?session_id=weather-test-session")
        assert hist_res.status_code == 200
        assert hist_res.json()["count"] >= 1

        # 3. Missing session returns explicit unavailable reason (no fabricated weather)
        missing_res = await client.get("/weather/latest?session_id=nonexistent-session-xyz")
        assert missing_res.status_code == 200
        missing_data = missing_res.json()
        assert missing_data["status"] == "unavailable"
        assert missing_data["reason"] == "no_weather_records_for_session"
        assert missing_data["weather"] is None


@pytest.mark.asyncio
async def test_health_reports_degraded_on_fault_injection(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Healthy baseline
        base_res = await client.get("/health")
        assert base_res.status_code == 200
        assert base_res.json()["database"]["status"] == "connected"

        # Fault injection 1: simulate DB connection failure
        class FaultyEngine:
            def connect(self):
                raise RuntimeError("database host unreachable")

        monkeypatch.setattr("pitwall.storage.db.get_engine", lambda: FaultyEngine())

        db_fault_res = await client.get("/health")
        assert db_fault_res.status_code == 200
        fault_json = db_fault_res.json()
        assert fault_json["status"] == "degraded"
        assert fault_json["database"]["status"] == "error"
        assert "unreachable" in fault_json["database"]["error"]

        # Fault injection 2: simulate uninitialized/missing ML model
        monkeypatch.undo()
        monkeypatch.setattr(main, "ml_model", None)
        monkeypatch.setattr(main, "model_version", "unloaded")

        model_fault_res = await client.get("/health")
        assert model_fault_res.status_code == 200
        assert model_fault_res.json()["status"] == "degraded"
        assert model_fault_res.json()["model"]["loaded"] is False
        assert model_fault_res.json()["model"]["status"] == "unloaded"


@pytest.mark.asyncio
async def test_monitoring_overview_no_fake_zeros(monkeypatch: pytest.MonkeyPatch) -> None:
    # When drift analysis is unavailable, drift_ratio must be None, not 0.0
    async def mock_unavailable_drift():
        return {"status": "unavailable", "drift": {}}

    monkeypatch.setattr(main, "monitoring_drift", mock_unavailable_drift)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/monitoring/overview")
        assert res.status_code == 200
        data = res.json()
        assert data["drift_status"] == "unavailable"
        assert data["drift_ratio"] is None
        assert data["drifted_features"] == []


def test_alembic_migrations_lifecycle(tmp_path: Path) -> None:
    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "alembic_test.db"
    db_url = f"sqlite+aiosqlite:///{db_path.as_posix()}"

    # Set DATABASE_URL for env.py to pick up
    old_url = os.environ.get("DATABASE_URL")
    try:
        os.environ["DATABASE_URL"] = db_url
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", db_url)

        # 1. Upgrade to head
        command.upgrade(alembic_cfg, "head")

        # 2. Downgrade to base
        command.downgrade(alembic_cfg, "base")

        # 3. Upgrade back to head
        command.upgrade(alembic_cfg, "head")
    finally:
        if old_url is not None:
            os.environ["DATABASE_URL"] = old_url
        else:
            os.environ.pop("DATABASE_URL", None)

