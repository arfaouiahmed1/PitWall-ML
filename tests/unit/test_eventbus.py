"""Unit tests for the Redis Streams event bus with graceful fallback (eventbus.stream)."""

from __future__ import annotations

import logging

import pitwall.eventbus.stream as stream_mod
from pitwall.eventbus import InMemoryBus, RedisStreamBus, get_bus


def test_inmemory_bus_roundtrip_preserves_order():
    """Given 3 payloads published in order, When consumed, Then order is preserved."""
    bus = InMemoryBus()
    stream = "pitwall:race:test"
    payloads = [{"lap": 1}, {"lap": 2}, {"lap": 3}]

    for p in payloads:
        bus.publish(stream, p)

    got = bus.consume(stream, group="g", consumer="c", count=10)
    assert [e["data"] for e in got] == payloads
    # entries carry incrementing ids
    assert [e["id"] for e in got] == ["1", "2", "3"]
    # a group that already consumed does not receive the same entries again
    assert bus.consume(stream, group="g", consumer="c", count=10) == []
    # a fresh group still sees them
    assert [e["data"] for e in bus.consume(stream, group="g2", consumer="c")] == payloads


def test_redis_bus_degrades_gracefully_when_unreachable(caplog):
    """Given connect/ping always fails, When publish/consume, Then no raise and no-op."""
    caplog.set_level(logging.WARNING, logger="pitwall.eventbus.stream")

    def _boom(self: RedisStreamBus) -> None:
        raise ConnectionError("no redis in CI")

    bus = RedisStreamBus(url="redis://localhost:6399/0")
    original = RedisStreamBus._connect
    RedisStreamBus._connect = _boom  # type: ignore[method-assign]
    try:
        # publish must never raise
        bus.publish("pitwall:race:x", {"lap": 1})
        bus.publish("pitwall:race:x", {"lap": 2})
        # consume must return empty list
        assert bus.consume("pitwall:race:x", group="g", consumer="c") == []
    finally:
        RedisStreamBus._connect = original  # type: ignore[method-assign]

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1, "redis failure must be logged exactly ONCE"


def test_get_bus_returns_inmemory_without_redis_url(monkeypatch):
    """Given REDIS_URL unset, When get_bus(), Then InMemoryBus singleton is returned."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    stream_mod.reset_bus()

    bus = get_bus()
    assert isinstance(bus, InMemoryBus)
    assert get_bus() is bus, "factory must cache the instance module-level"
