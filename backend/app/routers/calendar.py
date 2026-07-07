"""REST surface for the deck's Calendar panel — real Google events, or a 'connect your
account' state when OAuth hasn't been set up yet.

GET /api/calendar/status        -> { authorized: bool }
GET /api/calendar/events?day=   -> { authorized, events[] }  or  { needs_auth: true }
"""

from __future__ import annotations

from fastapi import APIRouter

from app.tools import calendar as cal
from app.tools.google_auth import is_authorized

router = APIRouter(prefix="/api/calendar")


@router.get("/status")
async def status() -> dict:
    return {"authorized": is_authorized()}


@router.get("/events")
async def events(day: str | None = None) -> dict:
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "events": []}
    result = await cal.list_events(day)
    if isinstance(result, dict) and result.get("error"):
        return {"authorized": True, "error": result["error"], "events": []}
    return {"authorized": True, "events": result}
