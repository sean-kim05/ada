"""Tasks tool — Postgres-backed (M1 step 2). These are the SAME async signatures the
agent registered in registry.py, so Ada's secretary tools now persist for real: a task
she adds in chat lands in Postgres and shows up in the deck's To-do panel. Store lives in
app/db.py. The extra set_done/delete_task helpers back the REST API (routers/tasks.py)."""

from __future__ import annotations

import uuid
from datetime import datetime

from app.db import get_pool


def _row(r) -> dict:
    """Map a DB row to the task dict shape the agent + frontend consume."""
    return {
        "id": r["id"],
        "title": r["title"],
        "due": r["due"],
        "done": r["done"],
        "created": r["created_at"].isoformat(timespec="seconds"),
    }


async def add_task(title: str, due: str | None = None) -> dict:
    """Add a to-do. `due` is optional; when the user gives a deadline, prefer an ISO
    date `YYYY-MM-DD` (or `YYYY-MM-DDTHH:MM`) so the deck's Reminders panel can sort
    and highlight it — call current_time first to resolve relative dates like
    "tomorrow" or "Friday". Free text is still accepted. Returns the created task."""
    task_id = uuid.uuid4().hex[:8]
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(
            "INSERT INTO tasks (id, title, due) VALUES ($1, $2, $3) RETURNING *",
            task_id, title, due,
        )
    return _row(r)


async def list_tasks(include_done: bool = False) -> list[dict]:
    """List tasks, newest first. By default only open (not-done) ones."""
    q = "SELECT * FROM tasks"
    if not include_done:
        q += " WHERE NOT done"
    q += " ORDER BY created_at DESC"
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(q)
    return [_row(r) for r in rows]


async def complete_task(task_id: str) -> dict:
    """Mark a task done by id. Returns the updated task, or an error dict."""
    return await set_done(task_id, True)


async def set_done(task_id: str, done: bool) -> dict:
    """Set a task's done state (True/False). Returns the updated task or an error dict."""
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow(
            "UPDATE tasks SET done = $2 WHERE id = $1 RETURNING *", task_id, done
        )
    return _row(r) if r else {"error": f"no task with id {task_id}"}


async def delete_task(task_id: str) -> dict:
    """Delete a task by id. Returns {deleted: id} or an error dict."""
    async with get_pool().acquire() as conn:
        r = await conn.fetchrow("DELETE FROM tasks WHERE id = $1 RETURNING id", task_id)
    return {"deleted": task_id} if r else {"error": f"no task with id {task_id}"}


async def current_time() -> str:
    """The current local date and time. Handy for the agent when reasoning about due dates."""
    return datetime.now().strftime("%A %Y-%m-%d %H:%M:%S")
