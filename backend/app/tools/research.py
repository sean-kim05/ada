"""Lightweight tools so worker agents produce real, multi-step traces you can watch in
the Fleet. `web_search` is a STUB for now (no external calls) — it returns plausible
canned snippets so a researcher agent has something to reason over. Swap it for a real
search tool (or route it to the local Qwen model) later."""

from __future__ import annotations

_NOTES: list[str] = []


async def web_search(query: str) -> str:
    """Search the web for information about `query`. Returns a few result snippets."""
    return (
        f"Top results for '{query}':\n"
        f"1. Overview — a concise summary of {query}.\n"
        f"2. Recent developments and notable facts about {query}.\n"
        f"3. Common questions and trade-offs people consider around {query}."
    )


async def save_note(text: str) -> dict:
    """Save a short research note for later reference. Returns the saved note."""
    _NOTES.append(text)
    return {"saved": text, "total_notes": len(_NOTES)}
