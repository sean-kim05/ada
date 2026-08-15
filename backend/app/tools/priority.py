"""User-defined email priority rules.

Ada's default flagging trusts Gmail's own IMPORTANT label plus the summary model's guess.
These rules let the user override that with their OWN signals: VIP senders (an address or a
whole domain) and keywords (matched in subject or snippet). A message that matches any rule
is force-flagged as priority — it leads the morning brief and lands in Needs Attention.

Rules live in Redis (single-tenant) as one small JSON doc; edited from the Inbox panel."""

from __future__ import annotations

import json

from app.runtime.bus import get_redis

_KEY = "ada:priority_rules"
_DEFAULT = {"senders": [], "keywords": []}


async def get_rules() -> dict:
    raw = await get_redis().get(_KEY)
    if not raw:
        return dict(_DEFAULT)
    doc = json.loads(raw)
    return {"senders": doc.get("senders", []), "keywords": doc.get("keywords", [])}


async def set_rules(senders: list[str], keywords: list[str]) -> dict:
    # Normalise: lowercase, trim, drop blanks/dupes.
    def clean(xs: list[str]) -> list[str]:
        seen: list[str] = []
        for x in xs:
            v = (x or "").strip().lower()
            if v and v not in seen:
                seen.append(v)
        return seen

    doc = {"senders": clean(senders), "keywords": clean(keywords)}
    await get_redis().set(_KEY, json.dumps(doc))
    return doc


def matches(msg: dict, rules: dict) -> bool:
    """True if a message hits any VIP sender (address or domain) or keyword rule."""
    email = (msg.get("from_email") or "").lower()
    domain = email.split("@")[-1] if "@" in email else ""
    for s in rules.get("senders", []):
        if not s:
            continue
        want = s[1:] if s.startswith("@") else s
        # Exact address, exact/parent domain (greenhouse-mail.io ⊇ us.greenhouse-mail.io), or —
        # for a non-@ entry — a partial address match (so "recruiting" hits …-recruiting@x.com).
        if s == email or domain == want or domain.endswith("." + want):
            return True
        if not s.startswith("@") and want in email:
            return True
    hay = f"{msg.get('subject', '')} {msg.get('snippet', '')}".lower()
    for k in rules.get("keywords", []):
        if k and k in hay:
            return True
    return False
