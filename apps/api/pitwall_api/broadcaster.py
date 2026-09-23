"""Bounded, single-process fanout for race frames."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from copy import deepcopy
from typing import Any


class RaceBroadcaster:
    """Fan out identical frames; disconnect subscribers that exceed bounded capacity."""

    def __init__(self, snapshot_supplier: Callable[[], dict[str, Any]], queue_size: int = 128) -> None:
        if queue_size < 1:
            raise ValueError("queue_size must be positive")
        self._snapshot_supplier = snapshot_supplier
        self._queue_size = queue_size
        self._subscribers: set[asyncio.Queue[dict[str, Any] | None]] = set()
        self._closed = False

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def is_closed(self) -> bool:
        return self._closed

    def subscribe(self) -> asyncio.Queue[dict[str, Any] | None]:
        """Register a bounded queue seeded with the latest state snapshot."""
        if self._closed:
            raise RuntimeError("broadcaster is closed")
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(self._queue_size)
        queue.put_nowait(deepcopy(self._snapshot_supplier()))
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, subscriber: asyncio.Queue[dict[str, Any] | None]) -> None:
        """Remove a subscriber and wake its consumer."""
        if subscriber in self._subscribers:
            self._subscribers.remove(subscriber)
            self._signal_closed(subscriber)

    def publish(self, frame: dict[str, Any]) -> None:
        """Publish one frame; overflow disconnects only the slow subscriber."""
        if self._closed:
            raise RuntimeError("broadcaster is closed")
        for subscriber in tuple(self._subscribers):
            try:
                subscriber.put_nowait(deepcopy(frame))
            except asyncio.QueueFull:
                self._subscribers.remove(subscriber)
                self._signal_closed(subscriber)

    def close(self) -> None:
        """Close fanout and wake all waiting subscribers."""
        if self._closed:
            return
        self._closed = True
        for subscriber in self._subscribers:
            if not subscriber.full():
                subscriber.put_nowait(None)

    @staticmethod
    def _signal_closed(subscriber: asyncio.Queue[dict[str, Any] | None]) -> None:
        while not subscriber.empty():
            subscriber.get_nowait()
        subscriber.put_nowait(None)
