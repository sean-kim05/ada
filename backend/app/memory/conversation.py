"""Short-term conversation memory (M1). Ada's chat is a rolling conversation: each turn's
messages are appended to a per-session history in Redis and replayed into the next run, so
she remembers what you just said instead of treating every message as a cold start. Bounded
to the recent tail so the replayed context stays small."""

from __future__ import annotations

from pydantic_ai.messages import ModelMessage, ModelMessagesTypeAdapter, ModelRequest

from app.runtime.bus import get_redis

_KEY = "ada:chat:{session}"
_MAX_MESSAGES = 30  # keep the recent tail; older turns are trimmed to bound context
_TTL = 60 * 60 * 24 * 3  # remember for 3 days of inactivity, then forget


def _key(session: str) -> str:
    return _KEY.format(session=session)


async def load_history(session: str) -> list[ModelMessage]:
    """The prior conversation for a session (empty if none / unreadable)."""
    raw = await get_redis().get(_key(session))
    if not raw:
        return []
    try:
        return list(ModelMessagesTypeAdapter.validate_json(raw))
    except Exception:  # noqa: BLE001 — corrupt/old format: start fresh rather than crash
        return []


async def save_history(session: str, messages: list[ModelMessage]) -> None:
    """Persist the (trimmed) conversation so the next turn can continue it."""
    data = ModelMessagesTypeAdapter.dump_json(_trim(messages)).decode()
    await get_redis().set(_key(session), data, ex=_TTL)


async def clear(session: str) -> None:
    await get_redis().delete(_key(session))


def _trim(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Keep the recent tail, but start on a ModelRequest so the replayed history stays
    well-formed (never begins mid-turn on an orphaned tool result or model response)."""
    tail = messages[-_MAX_MESSAGES:]
    for i, m in enumerate(tail):
        if isinstance(m, ModelRequest):
            return tail[i:]
    return []  # no clean boundary in the tail — drop rather than replay malformed history
