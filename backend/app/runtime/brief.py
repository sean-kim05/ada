"""Morning-brief scheduler.

Generates the Gmail morning brief automatically once a day (default 07:00 local) and caches
it in Redis, so the Inbox panel shows a ready brief the instant you open Ada instead of
waiting on a live summary. Runs as a background task started in the app lifespan.

The cache is a single latest-brief document (`ada:brief:latest`); the Inbox reads it via
GET /api/gmail/brief. A manual Refresh in the UI still runs a live overview and overwrites
the cache, so the two paths stay consistent."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta

from app.config import settings
from app.runtime.bus import get_redis
from app.tools import gmail
from app.tools.google_auth import is_authorized

_KEY = "ada:brief:latest"


async def generate_and_store() -> dict | None:
    """Run the overview now and cache it with a timestamp. Returns the stored doc, or None
    if Gmail isn't connected."""
    if not is_authorized():
        return None
    overview = await gmail.email_overview()
    if overview.get("error"):
        return None
    doc = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "unread": overview.get("unread", 0),
        "important": overview.get("important", []),
        "brief": overview.get("brief", ""),
    }
    await get_redis().set(_KEY, json.dumps(doc))
    return doc


async def latest() -> dict | None:
    """The cached brief, or None if one has never been generated."""
    raw = await get_redis().get(_KEY)
    return json.loads(raw) if raw else None


def _seconds_until_next_run(now: datetime) -> float:
    target = now.replace(hour=settings.brief_hour, minute=settings.brief_minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def scheduler_loop() -> None:
    """Background task: generate a brief on startup if today's is missing/stale, then fire
    once a day at the configured time. Cancelled on app shutdown."""
    # On boot, make sure there's *something* to show if today's brief hasn't run yet.
    try:
        current = await latest()
        today = datetime.now().astimezone().date().isoformat()
        if is_authorized() and (not current or not str(current.get("generated_at", "")).startswith(today)):
            await generate_and_store()
    except Exception:  # noqa: BLE001 — a boot-time hiccup shouldn't crash startup
        pass

    while True:
        try:
            await asyncio.sleep(_seconds_until_next_run(datetime.now().astimezone()))
            await generate_and_store()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — keep the daily loop alive across transient errors
            await asyncio.sleep(60)
