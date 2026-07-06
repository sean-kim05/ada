"""Mission (M5) — real multi-agent collaboration.

A planner (Atlas) decomposes a goal into concrete subtasks, hands each to a worker agent —
a REAL sub-run that shows up in the Fleet with its own trace — collects the results, and
synthesizes a final deliverable. Each handoff is emitted as a MESSAGE event (planner <-> worker)
so the collaboration is visible as it happens. This is the finale the earlier milestones
build toward: the message plumbing from M4, the sub-runs from M2, the workers from M3.
"""

from __future__ import annotations

import re

from pydantic_ai import Agent

from app.agents import registry
from app.agents.models import claude_model
from app.runtime.bus import Emitter
from app.runtime.events import EventType

PLANNER_NAME = "Atlas"


def _parse_tasks(text: str, limit: int) -> list[str]:
    tasks = []
    for ln in text.splitlines():
        cleaned = re.sub(r"^\s*[-*•\d.\)]+\s*", "", ln).strip()
        if cleaned:
            tasks.append(cleaned)
    return tasks[:limit]


def _short(s: str, n: int = 420) -> str:
    s = str(s)
    return s if len(s) <= n else s[:n] + "…"


async def run_mission(
    emitter: Emitter, goal: str, worker_type: str = "researcher", max_tasks: int = 3
) -> None:
    # late import — supervisor imports run_mission at load, so break the cycle here
    from app.runtime.supervisor import supervisor

    if worker_type not in registry.SPECS or worker_type == "ada":
        raise ValueError(f"bad worker_type: {worker_type}")
    wspec = registry.SPECS[worker_type]
    max_tasks = max(1, min(5, max_tasks))

    # 1. planner decomposes the goal
    planner = Agent(
        claude_model(),
        instructions=(
            f"You are {PLANNER_NAME}, a planning lead directing a {wspec.name} "
            f"({wspec.blurb}). Break the user's goal into 2-{max_tasks} concrete, independent "
            f"subtasks that {wspec.name} can each carry out on its own. Output ONLY the "
            f"subtasks, one per line, no numbering and no preamble."
        ),
    )
    plan = await planner.run(f"Goal: {goal}")
    tasks = _parse_tasks(plan.output, max_tasks) or [goal]

    await emitter.emit(EventType.PLAN, {"goal": goal, "tasks": tasks, "worker": wspec.name}, model="claude")
    await emitter.emit(
        EventType.MESSAGE,
        {"from": PLANNER_NAME, "to": PLANNER_NAME, "from_type": "planner", "to_type": "planner",
         "text": f"Broke this into {len(tasks)} subtasks — delegating to {wspec.name}."},
        model="claude",
    )

    # 2. delegate each subtask to a real worker sub-run (visible in the Fleet)
    results: list[tuple[str, str]] = []
    for i, task in enumerate(tasks, 1):
        await emitter.emit(
            EventType.MESSAGE,
            {"from": PLANNER_NAME, "to": wspec.name, "from_type": "planner", "to_type": worker_type,
             "text": f"[{i}/{len(tasks)}] {task}"},
            model="claude",
        )
        sub = supervisor.start(worker_type, task)
        if sub.task is not None:
            await sub.task  # wait for the worker to finish
        out = sub.result_text or "(no result)"
        results.append((task, out))
        await emitter.emit(
            EventType.MESSAGE,
            {"from": wspec.name, "to": PLANNER_NAME, "from_type": worker_type, "to_type": "planner",
             "text": _short(out)},
            model="claude",
        )

    # 3. planner synthesizes a final deliverable from the workers' results
    joined = "\n\n".join(f"Subtask: {t}\nResult: {r}" for t, r in results)
    synth = await planner.run(
        f"Goal: {goal}\n\nYour team returned these results:\n{joined}\n\n"
        f"Synthesize one clear, final answer/deliverable for the goal. Be concise and concrete."
    )
    await emitter.emit(EventType.FINAL, {"text": synth.output}, model="claude")
