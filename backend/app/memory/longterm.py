"""Long-term semantic memory (M2 substance — the real 'Docs/RAG' behind the badge).

Ada durably saves facts/notes and recalls them by meaning, not keywords, across sessions.
Backed by the Qdrant that's already running, with in-process embeddings via fastembed
(BAAI/bge-small-en-v1.5) — no external embedding service, no API key. Blocking Qdrant/
fastembed calls run in a thread so they don't stall the event loop."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from qdrant_client import QdrantClient

from app.config import settings

COLLECTION = "ada_memory"
_MODEL = "BAAI/bge-small-en-v1.5"  # small, fast, local; downloaded once by fastembed
_client: QdrantClient | None = None


def _c() -> QdrantClient:
    global _client
    if _client is None:
        c = QdrantClient(url=settings.qdrant_url)
        c.set_model(_MODEL)
        _client = c
    return _client


def _save_sync(text: str, kind: str, source: str) -> dict:
    mid = uuid.uuid4().hex
    _c().add(
        COLLECTION,
        documents=[text],
        metadata=[{"kind": kind, "source": source, "created": datetime.now().isoformat(timespec="seconds")}],
        ids=[mid],
    )
    return {"id": mid, "text": text, "kind": kind, "source": source}


async def save_memory(text: str, kind: str = "note", source: str = "ada") -> dict:
    """Store a durable memory (a fact about the user, a note, a decision). Returns it."""
    return await asyncio.to_thread(_save_sync, text, kind, source)


def _recall_sync(query: str, limit: int) -> list[dict]:
    try:
        hits = _c().query(COLLECTION, query_text=query, limit=limit)
    except Exception:  # noqa: BLE001 — collection not created until first save
        return []
    return [
        {"id": h.id, "text": h.document, "score": round(float(h.score), 3), **(h.metadata or {})}
        for h in hits
    ]


async def recall(query: str, limit: int = 5) -> list[dict]:
    """Search long-term memory by meaning. Returns the most relevant memories with scores."""
    return await asyncio.to_thread(_recall_sync, query, limit)


def _list_sync(limit: int) -> list[dict]:
    try:
        points, _ = _c().scroll(COLLECTION, limit=limit, with_payload=True)
    except Exception:  # noqa: BLE001
        return []
    out = []
    for p in points:
        pl = p.payload or {}
        out.append({
            "id": p.id,
            "text": pl.get("document", ""),
            "kind": pl.get("kind"),
            "source": pl.get("source"),
            "created": pl.get("created"),
        })
    out.sort(key=lambda m: m.get("created") or "", reverse=True)
    return out


async def list_memories(limit: int = 100) -> list[dict]:
    """All stored memories, newest first (for the Docs tab)."""
    return await asyncio.to_thread(_list_sync, limit)


def _delete_sync(mem_id: str) -> dict:
    _c().delete(COLLECTION, points_selector=[mem_id])
    return {"deleted": mem_id}


async def delete_memory(mem_id: str) -> dict:
    return await asyncio.to_thread(_delete_sync, mem_id)
