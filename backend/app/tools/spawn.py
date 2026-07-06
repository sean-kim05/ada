"""spawn_agent — lets Ada launch a background worker agent. The spawned agent runs
concurrently on its own task and shows up in the Fleet with its own live trace. This is
the seam between the secretary and the multi-agent runtime."""

from __future__ import annotations


async def spawn_agent(agent_type: str, task: str) -> dict:
    """Launch a background agent to work on `task` in parallel while you keep going.
    `agent_type` is 'researcher' (finds & summarizes information), 'planner' (breaks a
    goal into concrete tasks), or 'claude_code' (an engineer that writes real code in the
    sandbox via Claude Code — use this for any coding/build task). Returns the new run id;
    the agent runs on its own and appears in the Fleet."""
    # Late imports keep the registry <-> supervisor <-> tools cycle from forming at load.
    from app.agents import registry
    from app.runtime.supervisor import supervisor

    if agent_type == "ada" or agent_type not in registry.SPECS:
        return {"error": f"unknown agent_type '{agent_type}'. Options: researcher, planner, claude_code"}

    run = supervisor.start(agent_type, task)
    return {"spawned": agent_type, "run_id": run.run_id, "task": task}
