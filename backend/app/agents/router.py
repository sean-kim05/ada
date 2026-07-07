"""The model router — the piece that decides whether a unit of work runs on the local Qwen
model (free, on the 5080) or on cloud Claude (paid, smarter), runs it, and records the
cost/latency so the split is visible in the cockpit.

The vision (see agents/models.py): Claude drives the agent loop; cheap, high-volume
subtasks — classify, summarize, extract, triage — get pushed to the local model so they
never touch the Anthropic bill. This module is the routing + accounting layer that makes
that real. Ada's cheap-subtask tools (tools/assistant.py) call `complete(..., kind=...)`;
the router picks the model by kind, times it, estimates what Claude would have cost, and
appends a record. `stats()` feeds the cockpit's Router panel."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import asdict, dataclass

import httpx

from app.agents.models import cloud_complete, local_complete
from app.config import settings

# Work cheap/structured enough to trust the local model with. Everything else escalates to
# cloud Claude. This is the routing policy — deliberately explicit (caller declares the
# kind) rather than a fragile length heuristic.
LOCAL_KINDS = {"classify", "summarize", "extract", "triage", "draft", "rewrite"}

# Rough Haiku pricing ($/token) for the "would-have-cost / money-saved" estimate. Not
# billing-grade — a ~4 chars/token approximation — just enough to make the number in the
# cockpit meaningful.
_HAIKU_IN_PER_TOK = 1.00 / 1_000_000
_HAIKU_OUT_PER_TOK = 5.00 / 1_000_000
_CHARS_PER_TOK = 4


@dataclass
class RouterCall:
    kind: str
    where: str  # "local" | "cloud"
    model: str  # the model that actually ran it
    prompt_chars: int
    output_chars: int
    latency_ms: int
    cost_usd: float  # actual spend (0.0 for local)
    saved_usd: float  # what cloud would have cost, when we went local
    ts: float


# Single uvicorn worker (no --reload, no workers flag) → in-process state is fine.
_HISTORY: deque[RouterCall] = deque(maxlen=200)


def _estimate_cost(prompt_chars: int, output_chars: int) -> float:
    tin = prompt_chars / _CHARS_PER_TOK
    tout = output_chars / _CHARS_PER_TOK
    return tin * _HAIKU_IN_PER_TOK + tout * _HAIKU_OUT_PER_TOK


def _decide(kind: str) -> str:
    return "local" if kind in LOCAL_KINDS else "cloud"


async def complete(prompt: str, *, system: str | None = None, kind: str = "reason") -> str:
    """Route one completion by `kind`, run it, record it. Cheap kinds (see LOCAL_KINDS) go
    to the local Qwen model for free; everything else goes to cloud Claude. Returns the text."""
    where = _decide(kind)
    t0 = time.perf_counter()
    if where == "local":
        text = await local_complete(prompt, system=system)
        model = settings.local_model
    else:
        text = await cloud_complete(prompt, system=system)
        model = settings.claude_model
    latency_ms = int((time.perf_counter() - t0) * 1000)

    would_cost = _estimate_cost(len(prompt), len(text))
    _HISTORY.append(
        RouterCall(
            kind=kind,
            where=where,
            model=model,
            prompt_chars=len(prompt),
            output_chars=len(text),
            latency_ms=latency_ms,
            cost_usd=0.0 if where == "local" else would_cost,
            saved_usd=would_cost if where == "local" else 0.0,
            ts=time.time(),
        )
    )
    return text


def stats() -> dict:
    """Cost/latency accounting for the cockpit: how much work went local vs cloud, the
    dollars saved by keeping it off Claude, and average latency of each path."""
    calls = list(_HISTORY)
    local = [c for c in calls if c.where == "local"]
    cloud = [c for c in calls if c.where == "cloud"]

    def avg_ms(cs: list[RouterCall]) -> int:
        return round(sum(c.latency_ms for c in cs) / len(cs)) if cs else 0

    return {
        "local_model": settings.local_model,
        "cloud_model": settings.claude_model,
        "total_calls": len(calls),
        "local_calls": len(local),
        "cloud_calls": len(cloud),
        "cost_usd": round(sum(c.cost_usd for c in calls), 6),
        "saved_usd": round(sum(c.saved_usd for c in calls), 6),
        "local_avg_ms": avg_ms(local),
        "cloud_avg_ms": avg_ms(cloud),
        "recent": [asdict(c) for c in calls[-20:][::-1]],
    }


async def health() -> dict:
    """Is the local model reachable and loaded? Drives the Router panel's status dot and lets
    the tools degrade gracefully instead of hanging when Ollama is down."""
    target = settings.local_model
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{settings.ollama_base_url}/api/tags")
            r.raise_for_status()
            names = [m.get("name", "") for m in r.json().get("models", [])]
        ready = any(n == target or n.startswith(target) for n in names)
        return {"reachable": True, "ready": ready, "target": target, "models": names}
    except Exception as exc:  # noqa: BLE001 — surface any connect/timeout as "not reachable"
        return {"reachable": False, "ready": False, "target": target, "error": str(exc)}
