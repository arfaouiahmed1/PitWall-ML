"""Redis Streams event bus with graceful in-memory fallback (V4.3).

The bus is optional-at-runtime: when REDIS_URL is unset or Redis is unreachable,
publish becomes a silent no-op and consume returns [] — callers (e.g. the WS
replay loop) must never break because of the bus.
"""

from __future__ import annotations

import json
import logging
import os
from collections import deque
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# Module-level warn-once flag: a broken Redis is logged exactly once, ever.
_redis_warned = False


def _warn_redis_unreachable(exc: Exception) -> None:
    """Log the first Redis failure as a warning; stay silent afterwards."""
    global _redis_warned
    if not _redis_warned:
        _redis_warned = True
        logger.warning(
            "Redis event bus unavailable (%s) — degrading to no-op; further failures are silent",
            exc,
        )


class EventBus(Protocol):
    """Minimal pub/sub contract shared by all bus implementations."""

    def publish(self, stream: str, payload: dict) -> None:
        """Append payload to stream. Must never raise on infrastructure failure."""
        ...

    def consume(
        self, stream: str, group: str, consumer: str, count: int = 10, block_ms: int = 1000
    ) -> list[dict]:
        """Read up to count undelivered entries for group/consumer as payload dicts."""
        ...


class InMemoryBus:
    """deque-per-stream bus for tests and redis-less development.

    Semantics: publish appends a shallow copy of the payload under an incrementing
    string id; consume returns up to ``count`` oldest entries not yet delivered to
    that (stream, group) — entries are kept so other groups can read them too.
    Delivery position is tracked per group (consumer is accepted but unused).
    """

    def __init__(self) -> None:
        self._streams: dict[str, deque[tuple[str, dict]]] = {}
        self._cursors: dict[tuple[str, str], int] = {}
        self._next_id = 0

    def publish(self, stream: str, payload: dict) -> None:
        """Append a copy of payload to the stream deque."""
        self._next_id += 1
        entry = (str(self._next_id), dict(payload))
        self._streams.setdefault(stream, deque()).append(entry)

    def consume(
        self, stream: str, group: str, consumer: str, count: int = 10, block_ms: int = 1000
    ) -> list[dict]:
        """Return up to count oldest undelivered payloads for this group, in order."""
        entries = self._streams.get(stream)
        if not entries:
            return []
        key = (stream, group)
        pos = self._cursors.get(key, 0)
        out: list[dict] = []
        while pos < len(entries) and len(out) < count:
            entry_id, payload = entries[pos]
            out.append({"id": entry_id, "data": dict(payload)})
            pos += 1
        self._cursors[key] = pos
        return out


class RedisStreamBus:
    """Redis Streams bus — lazy connect from REDIS_URL, no-op when unreachable.

    Payloads travel json-encoded under a single field ({"data": ...}) and are
    parsed back to dicts on consume. The ``redis`` package is imported lazily
    inside methods so this module imports fine without Redis installed/running.
    """

    def __init__(self, url: str | None = None) -> None:
        self._url = url or os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        self._client: Any = None  # redis.Redis — typed Any to avoid a hard import

    def _connect(self) -> None:
        """Connect + ping; assigns the client only after a successful ping."""
        import redis

        client = redis.Redis.from_url(self._url, decode_responses=True)
        client.ping()
        self._client = client

    def _ensure_client(self) -> Any:
        if self._client is None:
            self._connect()
        return self._client

    def publish(self, stream: str, payload: dict) -> None:
        """XADD the payload; any failure logs once and drops the message."""
        try:
            self._ensure_client().xadd(stream, {"data": json.dumps(payload)})
        except Exception as exc:
            _warn_redis_unreachable(exc)

    def consume(
        self, stream: str, group: str, consumer: str, count: int = 10, block_ms: int = 1000
    ) -> list[dict]:
        """XREADGROUP for group/consumer; creates the group (MKSTREAM) on NOGROUP."""
        try:
            client = self._ensure_client()
            try:
                entries = client.xreadgroup(
                    group, consumer, {stream: ">"}, count=count, block=block_ms
                )
            except Exception as exc:
                if "NOGROUP" not in str(exc):
                    raise
                client.xgroup_create(stream, group, id="0", mkstream=True)
                entries = client.xreadgroup(
                    group, consumer, {stream: ">"}, count=count, block=block_ms
                )
            return [
                {"id": entry_id, "data": json.loads(fields["data"])}
                for _, stream_entries in entries
                for entry_id, fields in stream_entries
            ]
        except Exception as exc:
            _warn_redis_unreachable(exc)
            return []


_bus: EventBus | None = None


def reset_bus() -> None:
    """Drop the cached singleton (test seam)."""
    global _bus
    _bus = None


def get_bus() -> EventBus:
    """Return the cached bus: RedisStreamBus if REDIS_URL set AND reachable, else InMemoryBus."""
    global _bus
    if _bus is None:
        url = os.environ.get("REDIS_URL")
        candidate: EventBus | None = None
        if url:
            try:
                redis_bus = RedisStreamBus(url=url)
                redis_bus._connect()  # quick reachability probe before caching
                candidate = redis_bus
            except Exception:
                logger.info("REDIS_URL=%s unreachable — using InMemoryBus", url)
        _bus = candidate if candidate is not None else InMemoryBus()
    return _bus
