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
from app.agents.arena import run_arena
from app.agents.claude_code import chat_claude_code, drive_claude_code
from app.agents.loop import drive
from app.agents.mission import run_mission
from app.config import settings
from app.memory import conversation
from app.runtime.bus import Emitter
from app.runtime.events import EventType

RunStatus = Literal["running", "done", "error", "stopped"]


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
    interactive: bool = False   # claude_code: keep the session open for a continuous chat
    result_text: str = ""       # final output, captured for mission synthesis
    session_id: str | None = None  # set for chat runs → conversation memory (Redis)
    cost_usd: float = 0.0       # accumulated would-be cost across the run's turns
    tokens: int = 0             # accumulated tokens across the run's turns
    task: asyncio.Task | None = field(default=None, repr=False)
    # Live steering: the supervisor drops mid-task user messages here; the drive loop
    # drains it at each step boundary and injects them into the running agent.
    steer_inbox: "asyncio.Queue[str]" = field(default_factory=asyncio.Queue, repr=False)

    def add_usage(self, cost: float | None, tokens: int | None) -> None:
        """Fold one turn's usage into the run total (see claude_code on_usage callback)."""
        if cost:
            self.cost_usd += cost
        if tokens:
            self.tokens += tokens

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
            "interactive": self.interactive,
            "cost_usd": round(self.cost_usd, 4) if self.cost_usd else 0,
            "tokens": self.tokens,
        }


class Supervisor:
    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}

    def list_runs(self) -> list[Run]:
        return list(self._runs.values())

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def steer(self, run_id: str, text: str) -> dict:
        """Send a mid-task message to a running agent. It's picked up at the agent's next
        step and folded into its work (see loop.drive). Only LLM-loop agents (Ada + Fleet
        workers) are live-steerable; a finished run or a subprocess run (claude_code) can't
        take one."""
        text = text.strip()
        if not text:
            return {"delivered": False, "reason": "empty message"}
        run = self._runs.get(run_id)
        if not run:
            return {"delivered": False, "reason": "no such run"}
        if run.status != "running":
            return {"delivered": False, "reason": "run already finished"}
        spec = registry.SPECS.get(run.agent_type)
        if not spec:
            return {"delivered": False, "reason": "this run type can't take messages"}
        # LLM agents take a live mid-run steer; an interactive Forge takes it as the next
        # conversation turn. A one-shot Forge (Ada's delegate / Mission worker) can't.
        if spec.driver == "llm" or (spec.driver == "claude_code" and run.interactive):
            run.steer_inbox.put_nowait(text)
            return {"delivered": True}
        return {"delivered": False, "reason": "this run type can't take messages"}

    async def stop(self, run_id: str) -> dict:
        """Kill a running agent. Cancels its task (which tears down any child process via the
        driver's cleanup) and emits a terminal FINAL so the WS closes and the card flips to
        'stopped'. Idempotent-ish: a finished run reports it can't be stopped."""
        run = self._runs.get(run_id)
        if not run:
            return {"stopped": False, "reason": "no such run"}
        if run.status != "running":
            return {"stopped": False, "reason": "run already finished"}
        run.status = "stopped"
        if run.task:
            run.task.cancel()
        # Emit AFTER flipping status so the snapshot rides along as 'stopped'.
        emitter = Emitter(run.run_id, run.agent_id)
        await emitter.emit(EventType.FINAL, {"text": "■ stopped by user", "stopped": True}, model="user")
        return {"stopped": True}

    def restart(self, run_id: str) -> Run | None:
        """Relaunch an agent with the same type/prompt/workdir as a brand-new run. Returns the
        new Run, or None if the original is gone or isn't a relaunchable type (arena/mission
        aren't started through the generic path)."""
        run = self._runs.get(run_id)
        if not run or run.agent_type not in registry.SPECS:
            return None
        return self.start(
            run.agent_type,
            run.prompt,
            workdir=run.workdir,
            session_id=run.session_id,
            interactive=run.interactive,
        )

    def start(
        self,
        agent_type: str,
        prompt: str,
        workdir: str | None = None,
        session_id: str | None = None,
        interactive: bool = False,
    ) -> Run:
        """Launch `agent_type` on `prompt` as a background run. Returns immediately.
        `workdir` (claude_code only) is the directory the agent works in. `session_id`, if
        set, gives the run conversation memory keyed by that session (chat). `interactive`
        (claude_code only) keeps the Forge session open for a continuous back-and-forth
        instead of a one-shot."""
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
            session_id=session_id,
            interactive=interactive,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._drive(run))
        return run

    def start_ada(self, prompt: str, session_id: str = "main") -> Run:
        """Convenience for the chat surface — the secretary is agent type 'ada', with a
        rolling conversation memory so she remembers the thread."""
        return self.start("ada", prompt, session_id=session_id)

    def start_arena(self, topic: str, a_type: str, b_type: str, rounds: int = 3) -> Run:
        """Launch an Arena run — two agents talking. One run, MESSAGE events per turn."""
        for at in (a_type, b_type):
            if at not in registry.SPECS:
                raise ValueError(f"unknown agent_type: {at}")
        run_id = uuid.uuid4().hex[:8]
        name = f"{registry.SPECS[a_type].name} vs {registry.SPECS[b_type].name}"
        run = Run(
            run_id=run_id,
            agent_type="arena",
            agent_id=f"arena-{run_id}",
            name=name,
            prompt=topic,
            started_at=time.time(),
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._drive_arena(run, topic, a_type, b_type, rounds))
        return run

    async def _drive_arena(self, run: Run, topic: str, a_type: str, b_type: str, rounds: int) -> None:
        emitter = Emitter(run.run_id, run.agent_id)
        try:
            await run_arena(emitter, topic, a_type, b_type, rounds)
            run.status = "done"
        except Exception as exc:  # noqa: BLE001
            run.status = "error"
            await emitter.emit(EventType.ERROR, {"message": str(exc)})

    def start_mission(self, goal: str, worker_type: str = "researcher", max_tasks: int = 3) -> Run:
        """Launch a Mission — a planner decomposes `goal` and delegates to worker sub-runs."""
        if worker_type not in registry.SPECS or worker_type == "ada":
            raise ValueError(f"bad worker_type: {worker_type}")
        run_id = uuid.uuid4().hex[:8]
        run = Run(
            run_id=run_id,
            agent_type="mission",
            agent_id=f"mission-{run_id}",
            name=f"Mission → {registry.SPECS[worker_type].name}",
            prompt=goal,
            started_at=time.time(),
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._drive_mission(run, goal, worker_type, max_tasks))
        return run

    async def _drive_mission(self, run: Run, goal: str, worker_type: str, max_tasks: int) -> None:
        emitter = Emitter(run.run_id, run.agent_id)
        try:
            await run_mission(emitter, goal, worker_type, max_tasks)
            run.status = "done"
        except Exception as exc:  # noqa: BLE001
            run.status = "error"
            await emitter.emit(EventType.ERROR, {"message": str(exc)})

    async def _drive(self, run: Run) -> None:
        emitter = Emitter(run.run_id, run.agent_id)
        try:
            spec = registry.SPECS[run.agent_type]
            if spec.driver == "claude_code":
                cwd = run.workdir or settings.sandbox_dir
                if not os.path.isdir(cwd):
                    raise RuntimeError(f"working dir does not exist: {cwd}")
                if run.interactive:
                    # a continuous Forge conversation — stays open for follow-up replies
                    run.result_text = await chat_claude_code(
                        run.prompt, emitter, cwd, run.steer_inbox, on_usage=run.add_usage
                    )
                else:
                    run.result_text = await drive_claude_code(
                        run.prompt, emitter, cwd, on_usage=run.add_usage
                    )
            else:
                agent = registry.build(run.agent_type)
                # Chat runs carry a rolling conversation; other runs are one-shot.
                history = await conversation.load_history(run.session_id) if run.session_id else None
                run.result_text, updated = await drive(
                    agent, run.prompt, emitter, history, steer_inbox=run.steer_inbox
                )
                if run.session_id:
                    await conversation.save_history(run.session_id, updated)
            run.status = "done"
        except Exception as exc:  # noqa: BLE001 - surface any failure as an event
            run.status = "error"
            await emitter.emit(EventType.ERROR, {"message": str(exc)})


supervisor = Supervisor()
