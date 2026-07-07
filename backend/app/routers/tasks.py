"""REST surface for the deck's To-do panel. Reads/writes the same Postgres-backed store
the secretary's task tools use — so tasks Ada creates in chat appear here, and vice-versa.

GET    /api/tasks        -> all tasks (open + done), newest first
POST   /api/tasks        -> create { title, due? }
PATCH  /api/tasks/{id}   -> set done state { done }
DELETE /api/tasks/{id}   -> delete
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.tools import tasks as store

router = APIRouter(prefix="/api/tasks")


class NewTask(BaseModel):
    title: str
    due: str | None = None


class TaskPatch(BaseModel):
    done: bool


@router.get("")
async def list_all() -> list[dict]:
    return await store.list_tasks(include_done=True)


@router.post("")
async def create(t: NewTask) -> dict:
    return await store.add_task(t.title, t.due)


@router.patch("/{task_id}")
async def patch(task_id: str, p: TaskPatch) -> dict:
    return await store.set_done(task_id, p.done)


@router.delete("/{task_id}")
async def remove(task_id: str) -> dict:
    return await store.delete_task(task_id)
