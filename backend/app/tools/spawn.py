"""spawn_agent — lets Ada launch a background worker agent. The spawned agent runs
concurrently on its own task and shows up in the Fleet with its own live trace. This is
the seam between the secretary and the multi-agent runtime."""

from __future__ import annotations


async def spawn_agent(agent_type: str, task: str, workdir: str | None = None) -> dict:
    """Launch a background agent to work on `task` in parallel while you keep going.
    `agent_type` is 'researcher' (finds & summarizes information), 'planner' (breaks a
    goal into concrete tasks), or 'claude_code' (an engineer that writes real code via
    Claude Code — use this for any coding/build task). `workdir` (claude_code only) is an
    existing directory to work in, e.g. '~/dev/mysite'; omit it to use the safe sandbox.
    Returns the new run id; the agent runs on its own and appears in the Fleet."""
    # Late imports keep the registry <-> supervisor <-> tools cycle from forming at load.
    import os

    from app.agents import registry
    from app.runtime.supervisor import supervisor

    if agent_type == "ada" or agent_type not in registry.SPECS:
        return {"error": f"unknown agent_type '{agent_type}'. Options: researcher, planner, claude_code"}

    wd = os.path.abspath(os.path.expanduser(workdir)) if workdir else None
    run = supervisor.start(agent_type, task, wd)
    return {"spawned": agent_type, "run_id": run.run_id, "task": task, "workdir": wd or "sandbox"}
