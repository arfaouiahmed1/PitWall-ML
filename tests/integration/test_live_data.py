from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pitwall_api.live_data import OpenF1SnapshotProvider


@pytest.mark.asyncio
async def test_live_snapshot_normalizes_active_openf1_rows(monkeypatch: pytest.MonkeyPatch):
    now = datetime.now(UTC)
    payloads = {
        "sessions": [
            {
                "session_key": 99,
                "date_start": (now - timedelta(minutes=10)).isoformat(),
                "date_end": (now + timedelta(minutes=90)).isoformat(),
            }
        ],
        "position": [{"driver_number": 4, "position": 1, "date": now.isoformat()}],
        "intervals": [
            {"driver_number": 4, "gap_to_leader": 0.0, "interval": 0.0, "date": now.isoformat()}
        ],
        "laps": [
            {
                "driver_number": 4,
                "lap_number": 12,
                "lap_duration": 81.234,
                "date_start": now.isoformat(),
            }
        ],
        "stints": [
            {
                "driver_number": 4,
                "compound": "MEDIUM",
                "tyre_age_at_start": 6,
                "date_start": now.isoformat(),
            }
        ],
        "drivers": [
            {
                "driver_number": 4,
                "full_name": "Lando Norris",
                "name_acronym": "NOR",
                "team_name": "McLaren",
            }
        ],
    }

    async def fake_get(_client: httpx.AsyncClient, endpoint: str):
        return payloads[endpoint]

    provider = OpenF1SnapshotProvider(cache_ttl_seconds=4)
    monkeypatch.setattr(provider, "_get", fake_get)

    snapshot = await provider.snapshot()

    assert snapshot.provenance == "LIVE"
    assert snapshot.source_id == "99"
    assert snapshot.race_state == {
        "session_id": "99",
        "lap": 12,
        "track_status": "UNKNOWN",
        "event_count": 1,
    }
    assert snapshot.rows[0]["last_lap_s"] == 81.234
    assert snapshot.rows[0]["code"] == "NOR"


@pytest.mark.asyncio
async def test_live_snapshot_reports_no_active_session(monkeypatch: pytest.MonkeyPatch):
    async def fake_get(_client: httpx.AsyncClient, endpoint: str):
        return []

    provider = OpenF1SnapshotProvider(cache_ttl_seconds=4)
    monkeypatch.setattr(provider, "_get", fake_get)

    snapshot = await provider.snapshot()

    assert snapshot.provenance == "UNAVAILABLE"
    assert snapshot.reason == "no_active_session"
    assert snapshot.rows == []


@pytest.mark.asyncio
async def test_live_snapshot_reports_provider_failure(monkeypatch: pytest.MonkeyPatch):
    async def failing_get(_client: httpx.AsyncClient, _endpoint: str):
        raise httpx.ConnectError("offline")

    provider = OpenF1SnapshotProvider(cache_ttl_seconds=4)
    monkeypatch.setattr(provider, "_get", failing_get)

    snapshot = await provider.snapshot()

    assert snapshot.provenance == "UNAVAILABLE"
    assert snapshot.reason == "openf1_request_failed"
