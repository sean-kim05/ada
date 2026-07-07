"""REST surface for Ada's long-term memory — the real 'Docs' tab.

GET    /api/memory          -> all memories, newest first
POST   /api/memory          -> save { text }
GET    /api/memory/search?q -> semantic search
DELETE /api/memory/{id}     -> forget one
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.memory import longterm

router = APIRouter(prefix="/api/memory")


class NewMemory(BaseModel):
    text: str


@router.get("")
async def list_all() -> list[dict]:
    return await longterm.list_memories()


@router.post("")
async def create(m: NewMemory) -> dict:
    return await longterm.save_memory(m.text, kind="note", source="user")


@router.get("/search")
async def search(q: str) -> list[dict]:
    return await longterm.recall(q, limit=8)


@router.delete("/{mem_id}")
async def remove(mem_id: str) -> dict:
    return await longterm.delete_memory(mem_id)
