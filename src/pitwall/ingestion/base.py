"""RaceEventSource protocol — abstraction for live vs replay."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from pitwall.schemas.events import RaceEvent


class RaceEventSource(Protocol):
    """Any source that yields canonical RaceEvents in event-time order."""

    async def events(self) -> AsyncIterator[RaceEvent]: ...

    async def close(self) -> None:  # optional
        ...
