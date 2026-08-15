"""REST surface for the deck's Inbox panel — real Gmail, or a 'connect your account' state
when OAuth hasn't been set up yet. Read-only (scope gmail.readonly).

GET /api/gmail/status              -> { authorized: bool }
GET /api/gmail/messages?q=&max=    -> { authorized, messages[] }  or  { needs_auth: true }
GET /api/gmail/overview            -> { authorized, unread, important[], brief, messages[] }
GET /api/gmail/message/{id}        -> { authorized, message }
"""

from __future__ import annotations

from fastapi import APIRouter

from app.tools import gmail
from app.tools.google_auth import is_authorized

router = APIRouter(prefix="/api/gmail")


@router.get("/status")
async def status() -> dict:
    return {"authorized": is_authorized()}


@router.get("/messages")
async def messages(q: str = "in:inbox", max: int = 12) -> dict:
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "messages": []}
    result = await gmail.list_messages(q, max)
    if isinstance(result, dict) and result.get("error"):
        return {"authorized": True, "error": result["error"], "messages": []}
    return {"authorized": True, "messages": result}


@router.get("/overview")
async def overview() -> dict:
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "unread": 0, "important": [], "brief": "", "messages": []}
    result = await gmail.email_overview()
    if result.get("error"):
        return {"authorized": True, "error": result["error"], "unread": 0, "important": [], "brief": "", "messages": []}
    return {"authorized": True, **result}


@router.get("/message/{message_id}")
async def message(message_id: str) -> dict:
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "message": None}
    result = await gmail.get_message(message_id)
    if isinstance(result, dict) and result.get("error"):
        return {"authorized": True, "error": result["error"], "message": None}
    return {"authorized": True, "message": result}
