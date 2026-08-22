"""Jolpica-F1 adapter — low-frequency reference layer (results, standings, circuits)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx

from pitwall.schemas.events import RaceEvent

JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"


async def fetch_results(season: int, round_no: int) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{JOLPICA_BASE}/{season}/{round_no}/results.json")
        r.raise_for_status()
        data = r.json()
        races = data.get("MRData", {}).get("RaceTable", {}).get("Races", [])
        if not races:
            return []
        return races[0].get("Results", [])


class JolpicaSource:
    def __init__(self, season: int, round_no: int) -> None:
        self.season = season
        self.round_no = round_no

    async def events(self) -> AsyncIterator[RaceEvent]:
        results = await fetch_results(self.season, self.round_no)
        base_ts = datetime.now(UTC)
        for row in results:
            yield RaceEvent(
                source="jolpica",
                event_type="driver",
                meeting_key=f"{self.season}_{self.round_no}",
                session_key="R",
                driver_number=int(row.get("number", 0))
                if str(row.get("number", "")).isdigit()
                else None,
                event_ts=base_ts,
                payload=row,
            )
