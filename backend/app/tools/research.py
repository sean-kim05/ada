"""Lightweight tools so worker agents produce real, multi-step traces you can watch in
the Fleet. `web_search` now hits **live DuckDuckGo** (keyless, via the `ddgs` library) —
no more canned snippets. `save_note` keeps an in-process scratch list for the run."""

from __future__ import annotations

import asyncio

_NOTES: list[str] = []


def _search_sync(query: str, max_results: int = 5) -> list[dict]:
    # ddgs is synchronous/blocking — callers run this in a thread (see web_search).
    from ddgs import DDGS

    with DDGS() as d:
        return list(d.text(query, max_results=max_results))


async def web_search(query: str) -> str:
    """Search the web for information about `query`. Returns a few real result
    snippets (title — blurb (url)) from a live DuckDuckGo query."""
    try:
        hits = await asyncio.to_thread(_search_sync, query, 5)
    except Exception as e:  # network/rate-limit/parse — be honest, don't fabricate
        return f"Web search for '{query}' failed ({type(e).__name__}: {e}). Try rephrasing or searching again."
    if not hits:
        return f"No web results found for '{query}'."
    lines = [f"Top results for '{query}':"]
    for i, h in enumerate(hits, 1):
        title = (h.get("title") or "").strip()
        body = (h.get("body") or "").strip()
        href = (h.get("href") or "").strip()
        lines.append(f"{i}. {title} — {body} ({href})")
    return "\n".join(lines)


async def save_note(text: str) -> dict:
    """Save a short research note for later reference. Returns the saved note."""
    _NOTES.append(text)
    return {"saved": text, "total_notes": len(_NOTES)}
