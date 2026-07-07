"""Memory tools Ada calls — thin, well-described wrappers over app.memory.longterm so the
agent has a clean 'remember this' / 'what do I know about X' interface."""

from __future__ import annotations

from app.memory import longterm


async def remember(text: str) -> dict:
    """Save a durable fact or note to long-term memory — it persists across sessions and can
    be recalled later. Use for things worth keeping: the user's preferences, people in their
    life, decisions, commitments, anything they say to remember."""
    return await longterm.save_memory(text, kind="note", source="ada")


async def recall(query: str) -> list[dict]:
    """Search long-term memory by meaning and return the most relevant saved memories. Use
    when the user refers to something from the past, or asks what you know about a topic/person."""
    return await longterm.recall(query, limit=5)
