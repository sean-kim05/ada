"""REST surface for the deck's Calendar panel — real Google events, or a 'connect your
account' state when OAuth hasn't been set up yet.

GET  /api/calendar/status        -> { authorized: bool }
GET  /api/calendar/events?day=   -> { authorized, events[] }  or  { needs_auth: true }
POST /api/calendar/events        -> create an event { title, start, end, attendees? }
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.tools import calendar as cal
from app.tools.google_auth import is_authorized

router = APIRouter(prefix="/api/calendar")


class NewEvent(BaseModel):
    title: str
    start: str  # RFC3339 with offset, e.g. "2026-08-14T16:00:00-07:00"
    end: str
    attendees: list[str] | None = None


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


@router.post("/events")
async def create(ev: NewEvent) -> dict:
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "event": None}
    result = await cal.create_event(ev.title, ev.start, ev.end, ev.attendees)
    if isinstance(result, dict) and result.get("error"):
        return {"authorized": True, "error": result["error"], "event": None}
    return {"authorized": True, "event": result}
