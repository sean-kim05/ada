"""REST surface for the deck's Inbox panel — real Gmail, or a 'connect your account' state
when OAuth hasn't been set up yet. Read-only (scope gmail.readonly).

GET /api/gmail/status              -> { authorized: bool }
GET /api/gmail/messages?q=&max=    -> { authorized, messages[] }  or  { needs_auth: true }
GET /api/gmail/overview            -> { authorized, unread, important[], brief, messages[] }
GET /api/gmail/message/{id}        -> { authorized, message }
GET /api/gmail/brief               -> cached daily brief { generated_at, brief, ... }
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.runtime import brief as brief_store
from app.tools import gmail, priority
from app.tools.google_auth import is_authorized

router = APIRouter(prefix="/api/gmail")


class Rules(BaseModel):
    senders: list[str] = []
    keywords: list[str] = []


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


@router.get("/rules")
async def get_rules() -> dict:
    return await priority.get_rules()


@router.put("/rules")
async def put_rules(rules: Rules) -> dict:
    return await priority.set_rules(rules.senders, rules.keywords)


@router.get("/brief")
async def brief() -> dict:
    """The cached daily brief — instant. If none has been generated yet (and Gmail is
    connected), generate one on the spot so the panel is never empty."""
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "cached": None}
    doc = await brief_store.latest()
    if doc is None:
        doc = await brief_store.generate_and_store()
    return {"authorized": True, "cached": doc}


@router.get("/message/{message_id}")
async def message(message_id: str) -> dict:
    if not is_authorized():
        return {"authorized": False, "needs_auth": True, "message": None}
    result = await gmail.get_message(message_id)
    if isinstance(result, dict) and result.get("error"):
        return {"authorized": True, "error": result["error"], "message": None}
    return {"authorized": True, "message": result}
