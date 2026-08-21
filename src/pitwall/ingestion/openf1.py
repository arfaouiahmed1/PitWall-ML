"""OpenF1 adapter — historical REST + live MQTT placeholder.

Historical (free since 2023): https://api.openf1.org
Live: MQTT (requires sponsor €9.90/mo) — credentials stay on backend.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx

from pitwall.schemas.events import RaceEvent

OPENF1_BASE = "https://api.openf1.org/v1"


class OpenF1HistoricalSource:
    """Fetches historical OpenF1 data and yields RaceEvents.

    Free tier: all sessions since 2023. No auth required for historical.
    """

    def __init__(self, session_key: int | str, base_url: str = OPENF1_BASE) -> None:
        self.session_key = session_key
        self.base_url = base_url

    async def _fetch(self, endpoint: str, params: dict | None = None) -> list[dict]:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base_url}/{endpoint}", params=params or {})
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else [data]

    async def events(self) -> AsyncIterator[RaceEvent]:
        # Fetch laps as primary event stream
        try:
            laps = await self._fetch("laps", {"session_key": self.session_key})
        except Exception as e:
            # Fail gracefully — caller can fall back to FastF1/Parquet
            raise RuntimeError(f"OpenF1 fetch failed: {e}") from e

        for row in laps:
            ts_raw = row.get("date_start") or row.get("date")
            try:
                event_ts = (
                    datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                    if ts_raw
                    else datetime.now(UTC)
                )
            except Exception:
                event_ts = datetime.now(UTC)

            yield RaceEvent(
                source="openf1",
                event_type="lap",
                meeting_key=row.get("meeting_key"),
                session_key=row.get("session_key", self.session_key),
                driver_number=row.get("driver_number"),
                event_ts=event_ts,
                payload=row,
            )

            # Small yield point to avoid blocking
            await asyncio.sleep(0)


class OpenF1LiveSource:
    """Live MQTT source — requires sponsor subscription.

    This is a stub that documents the intended implementation without requiring
    credentials at scaffold time. See https://openf1.org/auth.html
    MQTT is recommended for backend use; keep credentials server-side.
    """

    def __init__(self, session_key: int | str, mqtt_host: str = "mqtt.openf1.org") -> None:
        self.session_key = session_key
        self.mqtt_host = mqtt_host

    async def events(self) -> AsyncIterator[RaceEvent]:
        # TODO V3: implement with paho-mqtt or aiomqtt
        #   - subscribe to topics: car_data, intervals, positions, pit, race_control
        #   - normalize to RaceEvent
        #   - handle reconnects + idempotent upserts
        raise NotImplementedError(
            "OpenF1LiveSource requires sponsor subscription and MQTT implementation (V3). "
            "Use ParquetReplaySource for demo."
        )
        yield  # make it an async generator type-wise  # noqa: unreachable
