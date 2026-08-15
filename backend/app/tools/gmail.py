"""Gmail tool — read-only inbox access for Ada's secretary loop and the deck's Inbox panel.

Same async-function shape as the calendar tool: blocking Google API calls run in a thread so
they don't stall the event loop, and auth/API errors come back as a friendly {"error": ...}
dict instead of raising — so a run never crashes just because Google isn't wired yet.

Scope is gmail.readonly (see google_auth.SCOPES): Ada can list, read, and summarize mail;
she can NEVER send, delete, or modify anything. The "morning brief" is a router.summarize
over recent unread, so it runs free on the local model."""

from __future__ import annotations

import asyncio
import base64
from email.utils import parseaddr

from googleapiclient.discovery import build

from app.agents import router
from app.tools.google_auth import NotAuthorized, load_credentials


def _service():
    return build("gmail", "v1", credentials=load_credentials(), cache_discovery=False)


def _header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _msg_out(m: dict) -> dict:
    """Shape one message from a metadata-format get into the frontend contract."""
    headers = m.get("payload", {}).get("headers", [])
    from_raw = _header(headers, "From")
    name, addr = parseaddr(from_raw)
    labels = m.get("labelIds", [])
    return {
        "id": m["id"],
        "thread_id": m.get("threadId"),
        "from_name": name or addr or from_raw,
        "from_email": addr,
        "subject": _header(headers, "Subject") or "(no subject)",
        "date": _header(headers, "Date"),
        "snippet": m.get("snippet", ""),
        "unread": "UNREAD" in labels,
        "important": "IMPORTANT" in labels,
        "starred": "STARRED" in labels,
    }


def _list_sync(query: str, max_results: int) -> list[dict]:
    svc = _service()
    res = svc.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    ids = [m["id"] for m in res.get("messages", [])]
    out: list[dict] = []
    for mid in ids:
        m = svc.users().messages().get(
            userId="me", id=mid, format="metadata",
            metadataHeaders=["From", "Subject", "Date"],
        ).execute()
        out.append(_msg_out(m))
    return out


async def _guarded(fn, *args):
    """Run a blocking Gmail call in a thread, turning auth/API errors into a dict the agent
    (and the REST layer) can handle cleanly."""
    try:
        return await asyncio.to_thread(fn, *args)
    except NotAuthorized as e:
        return {"error": str(e), "needs_auth": True}
    except Exception as e:  # noqa: BLE001 — surface API errors to the caller, don't crash the run
        return {"error": f"gmail error: {e}"}


async def list_messages(query: str = "in:inbox", max_results: int = 12) -> list[dict] | dict:
    """List inbox messages matching a Gmail search `query` (default the inbox). Useful queries:
    "is:unread", "is:important is:unread", "from:someone@x.com", "newer_than:1d". Returns each
    message's sender, subject, date, snippet, and unread/important flags."""
    return await _guarded(_list_sync, query, max_results)


def _decode_body(payload: dict) -> str:
    """Pull the plain-text body out of a full-format message payload (walks multipart)."""
    def walk(part: dict) -> str:
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        data = body.get("data")
        if mime == "text/plain" and data:
            return base64.urlsafe_b64decode(data).decode("utf-8", "replace")
        for sub in part.get("parts", []):
            found = walk(sub)
            if found:
                return found
        # Fall back to any HTML body if no plain text exists.
        if mime == "text/html" and data:
            return base64.urlsafe_b64decode(data).decode("utf-8", "replace")
        return ""
    return walk(payload).strip()


def _get_sync(message_id: str) -> dict:
    m = _service().users().messages().get(userId="me", id=message_id, format="full").execute()
    out = _msg_out(m)
    out["body"] = _decode_body(m.get("payload", {}))[:8000]
    return out


async def get_message(message_id: str) -> dict:
    """Read one full email by id (get the id from list_messages first). Returns the message
    with its full plain-text body — use this to actually read or summarize a specific email."""
    return await _guarded(_get_sync, message_id)


async def read_inbox(max_results: int = 10) -> list[dict] | dict:
    """Read the user's most recent unread inbox messages (sender/subject/snippet). Use this
    when the user asks what's in their inbox or what's new."""
    return await _guarded(_list_sync, "is:unread in:inbox", max_results)


async def email_overview() -> dict:
    """Produce a 'morning brief' of the inbox: counts, the important unread threads, and a
    short natural-language summary of what needs attention. Runs the summary on the free local
    model. Use this when the user asks for a daily/inbox overview or what's important."""
    msgs = await _guarded(_list_sync, "is:unread in:inbox", 20)
    if isinstance(msgs, dict):  # error / needs_auth
        return msgs
    important = [m for m in msgs if m["important"]]
    if not msgs:
        return {"unread": 0, "important": [], "brief": "Inbox zero — no unread mail.", "messages": []}

    lines = [
        f"- From {m['from_name']} — {m['subject']}: {m['snippet'][:160]}"
        for m in msgs[:15]
    ]
    prompt = (
        "Here are the user's unread emails. Write a tight morning brief (3-5 sentences): lead "
        "with anything that looks urgent or needs a reply, group the rest, and skip pure "
        "newsletters/promotions unless notable. Be specific with names and subjects. Write in "
        "plain prose only — NO markdown, no asterisks, no bold, no headings, no bullet symbols.\n\n"
        + "\n".join(lines)
    )
    try:
        brief = await router.complete(prompt, kind="summarize")
    except Exception as e:  # noqa: BLE001 — a summariser hiccup shouldn't sink the panel
        brief = f"({len(msgs)} unread — summary unavailable: {e})"
    return {
        "unread": len(msgs),
        "important": important,
        "brief": brief.strip(),
        "messages": msgs,
    }
