from __future__ import annotations

import pytest
from pitwall_api.broadcaster import RaceBroadcaster


@pytest.mark.asyncio
async def test_subscriber_receives_snapshot_before_published_frames() -> None:
    broadcaster = RaceBroadcaster(lambda: {"type": "snapshot", "lap": 3})

    subscriber = broadcaster.subscribe()
    broadcaster.publish({"type": "race_update", "sequence": 1})

    assert await subscriber.get() == {"type": "snapshot", "lap": 3}
    assert await subscriber.get() == {"type": "race_update", "sequence": 1}


@pytest.mark.asyncio
async def test_slow_subscriber_is_closed_at_queue_capacity() -> None:
    broadcaster = RaceBroadcaster(lambda: {"type": "snapshot"}, queue_size=2)
    subscriber = broadcaster.subscribe()

    broadcaster.publish({"sequence": 1})
    broadcaster.publish({"sequence": 2})

    assert await subscriber.get() is None
    assert broadcaster.subscriber_count == 0


@pytest.mark.asyncio
async def test_unsubscribe_and_close_release_subscribers() -> None:
    broadcaster = RaceBroadcaster(lambda: {"type": "snapshot"})
    subscriber = broadcaster.subscribe()

    broadcaster.unsubscribe(subscriber)

    assert await subscriber.get() is None
    second = broadcaster.subscribe()
    broadcaster.close()
    assert await second.get() == {"type": "snapshot"}
    assert await second.get() is None
    with pytest.raises(RuntimeError):
        broadcaster.publish({"sequence": 1})
