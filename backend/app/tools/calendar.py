"""Google Calendar tool — real events for Ada's secretary loop and the deck's Calendar
panel. Same async-function shape the agent registers; the blocking Google API calls run in
a thread so they don't stall the event loop. Requires a connected Google account (see
google_auth / authorize_google.py) — until then these return a friendly {"error": ...}
instead of raising, so a run never crashes just because Google isn't wired yet."""

from __future__ import annotations

import asyncio
from datetime import datetime, time

from googleapiclient.discovery import build

from app.tools.google_auth import NotAuthorized, load_credentials


def _service():
    return build("calendar", "v3", credentials=load_credentials(), cache_discovery=False)


def _day_bounds(day: str | None) -> tuple[str, str]:
    d = datetime.fromisoformat(day).date() if day else datetime.now().astimezone().date()
    start = datetime.combine(d, time.min).astimezone()
    end = datetime.combine(d, time.max).astimezone()
    return start.isoformat(), end.isoformat()


def _event_out(e: dict) -> dict:
    return {
        "id": e["id"],
        "title": e.get("summary", "(no title)"),
        "start": e["start"].get("dateTime") or e["start"].get("date"),
        "end": e["end"].get("dateTime") or e["end"].get("date"),
        "all_day": "date" in e.get("start", {}),
        "location": e.get("location"),
        "attendees": [a.get("email") for a in e.get("attendees", [])],
        "link": e.get("htmlLink"),
    }


async def _guarded(fn, *args):
    """Run a blocking Calendar call in a thread, turning auth/API errors into a dict the
    agent (and the REST layer) can handle cleanly."""
    try:
        return await asyncio.to_thread(fn, *args)
    except NotAuthorized as e:
        return {"error": str(e), "needs_auth": True}
    except Exception as e:  # noqa: BLE001 — surface API errors to the caller, don't crash the run
        return {"error": f"calendar error: {e}"}


def _list_sync(day: str | None) -> list[dict]:
    tmin, tmax = _day_bounds(day)
    res = _service().events().list(
        calendarId="primary", timeMin=tmin, timeMax=tmax,
        singleEvents=True, orderBy="startTime",
    ).execute()
    return [_event_out(e) for e in res.get("items", [])]


async def list_events(day: str | None = None) -> list[dict] | dict:
    """List the user's calendar events for a day (default today). `day` is an ISO date like
    "2026-07-08". Returns events with id/title/start/end/attendees."""
    return await _guarded(_list_sync, day)


def _create_sync(title, start, end, attendees):
    body = {"summary": title, "start": {"dateTime": start}, "end": {"dateTime": end}}
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees]
    return _event_out(_service().events().insert(calendarId="primary", body=body).execute())


async def create_event(title: str, start: str, end: str, attendees: list[str] | None = None) -> dict:
    """Create a calendar event. `start`/`end` are RFC3339 datetimes with offset, e.g.
    "2026-07-08T16:00:00-07:00". `attendees` is an optional list of emails."""
    return await _guarded(_create_sync, title, start, end, attendees)


def _move_sync(event_id, start, end):
    patch = {"start": {"dateTime": start}, "end": {"dateTime": end}}
    return _event_out(
        _service().events().patch(calendarId="primary", eventId=event_id, body=patch).execute()
    )


async def move_event(event_id: str, start: str, end: str) -> dict:
    """Reschedule an existing event to a new start/end (RFC3339 datetimes). Returns the
    updated event. Get the event_id from list_events first."""
    return await _guarded(_move_sync, event_id, start, end)
