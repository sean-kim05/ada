"""Tasks tool — the first real tool. In-memory for M1 so the loop works with zero
external auth; swap the store for Postgres in M1 step 2. Tools are plain async functions
registered on the agent in agents/ada.py."""

from __future__ import annotations

import uuid
from datetime import datetime

# In-memory store. Replace with a Postgres-backed repo later (same function signatures).
_TASKS: dict[str, dict] = {}


async def add_task(title: str, due: str | None = None) -> dict:
    """Add a to-do. `due` is an optional ISO date string. Returns the created task."""
    task_id = uuid.uuid4().hex[:8]
    task = {"id": task_id, "title": title, "due": due, "done": False,
            "created": datetime.now().isoformat(timespec="seconds")}
    _TASKS[task_id] = task
    return task


async def list_tasks(include_done: bool = False) -> list[dict]:
    """List tasks. By default only open ones."""
    return [t for t in _TASKS.values() if include_done or not t["done"]]


async def complete_task(task_id: str) -> dict:
    """Mark a task done by id. Returns the updated task, or an error dict."""
    t = _TASKS.get(task_id)
    if not t:
        return {"error": f"no task with id {task_id}"}
    t["done"] = True
    return t


async def current_time() -> str:
    """The current local date and time. Handy first tool for testing the loop."""
    return datetime.now().strftime("%A %Y-%m-%d %H:%M:%S")
