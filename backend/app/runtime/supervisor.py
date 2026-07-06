"""Supervisor — owns running agents. It launches any agent type as a concurrent asyncio
task, tracks its status, and exposes the roster the Fleet view reads. This is the
multi-agent control plane: N runs in flight at once, every one emitting the same event
stream."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from app.agents import registry
from app.agents.claude_code import drive_claude_code
from app.agents.loop import drive
from app.config import settings
from app.runtime.bus import Emitter
from app.runtime.events import EventType

RunStatus = Literal["running", "done", "error"]


@dataclass
class Run:
    run_id: str
    agent_type: str
    agent_id: str
    name: str
    prompt: str
    started_at: float
    status: RunStatus = "running"
    workdir: str | None = None  # claude_code: where it works (None → sandbox)
    task: asyncio.Task | None = field(default=None, repr=False)

    def snapshot(self) -> dict:
        return {
            "run_id": self.run_id,
            "agent_type": self.agent_type,
            "agent_id": self.agent_id,
            "name": self.name,
            "prompt": self.prompt,
            "status": self.status,
            "started_at": self.started_at,
            "workdir": self.workdir,
        }


class Supervisor:
    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}

    def list_runs(self) -> list[Run]:
        return list(self._runs.values())

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def start(self, agent_type: str, prompt: str, workdir: str | None = None) -> Run:
        """Launch `agent_type` on `prompt` as a background run. Returns immediately.
        `workdir` (claude_code only) is the directory the agent works in."""
        if agent_type not in registry.SPECS:
            raise ValueError(f"unknown agent_type: {agent_type}")
        run_id = uuid.uuid4().hex[:8]
        spec = registry.SPECS[agent_type]
        run = Run(
            run_id=run_id,
            agent_type=agent_type,
            agent_id=f"{agent_type}-{run_id}",
            name=spec.name,
            prompt=prompt,
            started_at=time.time(),
            workdir=workdir,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._drive(run))
        return run

    def start_ada(self, prompt: str) -> Run:
        """Convenience for the chat surface — the secretary is just agent type 'ada'."""
        return self.start("ada", prompt)

    async def _drive(self, run: Run) -> None:
        emitter = Emitter(run.run_id, run.agent_id)
        try:
            spec = registry.SPECS[run.agent_type]
            if spec.driver == "claude_code":
                cwd = run.workdir or settings.sandbox_dir
                if not os.path.isdir(cwd):
                    raise RuntimeError(f"working dir does not exist: {cwd}")
                await drive_claude_code(run.prompt, emitter, cwd)
            else:
                agent = registry.build(run.agent_type)
                await drive(agent, run.prompt, emitter)
            run.status = "done"
        except Exception as exc:  # noqa: BLE001 - surface any failure as an event
            run.status = "error"
            await emitter.emit(EventType.ERROR, {"message": str(exc)})


supervisor = Supervisor()
