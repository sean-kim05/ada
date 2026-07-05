"""Event bus: agents publish AgentEvents to Redis pub/sub; the WebSocket layer and the
Postgres writer subscribe. Also provides an Emitter that agents use to emit events with
automatic per-run sequence numbering."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import redis.asyncio as redis

from app.config import settings
from app.runtime.events import AgentEvent, EventType

_pool: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _pool
    if _pool is None:
        _pool = redis.from_url(settings.redis_url, decode_responses=True)
    return _pool


async def publish(event: AgentEvent) -> None:
    r = get_redis()
    await r.publish(event.channel(), event.model_dump_json())


async def subscribe(run_id: str) -> AsyncIterator[AgentEvent]:
    """Yield events for a run as they arrive. Used by the WebSocket handler."""
    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(f"ada:run:{run_id}")
    try:
        async for msg in pubsub.listen():
            if msg["type"] != "message":
                continue
            yield AgentEvent.model_validate_json(msg["data"])
    finally:
        await pubsub.unsubscribe(f"ada:run:{run_id}")
        await pubsub.aclose()


async def subscribe_all() -> AsyncIterator[AgentEvent]:
    """Yield events from EVERY run at once. This is the Fleet feed — one stream that
    carries every agent's activity, so the cockpit can render a live card per agent."""
    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.psubscribe("ada:run:*")
    try:
        async for msg in pubsub.listen():
            if msg["type"] != "pmessage":
                continue
            yield AgentEvent.model_validate_json(msg["data"])
    finally:
        await pubsub.punsubscribe("ada:run:*")
        await pubsub.aclose()


class Emitter:
    """Handed to an agent for a single run. Tracks seq, stamps agent_id, publishes."""

    def __init__(self, run_id: str, agent_id: str):
        self.run_id = run_id
        self.agent_id = agent_id
        self._seq = 0

    async def emit(
        self,
        type: EventType,
        payload: dict | None = None,
        *,
        model: str | None = None,
        latency_ms: int | None = None,
        tokens: int | None = None,
        cost_usd: float | None = None,
    ) -> AgentEvent:
        event = AgentEvent(
            run_id=self.run_id,
            agent_id=self.agent_id,
            seq=self._seq,
            type=type,
            payload=payload or {},
            model=model,
            latency_ms=latency_ms,
            tokens=tokens,
            cost_usd=cost_usd,
        )
        self._seq += 1
        await publish(event)
        return event
