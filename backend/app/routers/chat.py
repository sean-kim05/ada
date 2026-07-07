"""HTTP + WebSocket surface for the dashboard.

POST /api/chat          -> start an Ada (secretary) run, returns { run_id }
POST /api/agents/spawn  -> launch any agent type, returns { run_id }
GET  /api/agents        -> the agent types the runtime can launch (Fleet launcher)
GET  /api/runs          -> the current fleet roster (all runs + status)
WS   /api/runs/{id}/ws  -> stream one run's AgentEvents (the detailed trace)
WS   /api/fleet/ws      -> stream EVERY run's events at once (the Fleet feed)
"""

from __future__ import annotations

import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.agents import registry
from app.runtime.bus import subscribe, subscribe_all
from app.runtime.events import EventType
from app.runtime.supervisor import supervisor

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: str = "main"  # short-term memory key; a new value = a fresh conversation


class SpawnRequest(BaseModel):
    agent_type: str
    prompt: str
    workdir: str | None = None  # claude_code: dir to work in (defaults to sandbox)


class SteerRequest(BaseModel):
    text: str  # a mid-task instruction for a running agent


class ArenaRequest(BaseModel):
    topic: str
    agent_a: str = "researcher"
    agent_b: str = "planner"
    rounds: int = 3


class MissionRequest(BaseModel):
    goal: str
    worker_type: str = "researcher"
    max_tasks: int = 3


@router.post("/api/chat")
async def chat(req: ChatRequest) -> dict:
    run = supervisor.start_ada(req.message, req.session_id)
    return {"run_id": run.run_id}


@router.get("/api/agents")
async def agent_types() -> list[dict]:
    return [
        {"type": s.type, "name": s.name, "blurb": s.blurb, "accent": s.accent}
        for s in registry.SPECS.values()
    ]


@router.post("/api/agents/spawn")
async def spawn(req: SpawnRequest) -> dict:
    if req.agent_type not in registry.SPECS:
        return {"error": f"unknown agent_type: {req.agent_type}"}
    workdir = os.path.abspath(os.path.expanduser(req.workdir)) if req.workdir else None
    # Fleet-launched runs are interactive — a launched Forge stays open for a continuous
    # chat. (Ada's own spawn_agent tool and Mission workers call supervisor.start directly
    # and stay one-shot.)
    run = supervisor.start(req.agent_type, req.prompt, workdir, interactive=True)
    return {"run_id": run.run_id}


@router.post("/api/arena")
async def arena(req: ArenaRequest) -> dict:
    if req.agent_a not in registry.SPECS or req.agent_b not in registry.SPECS:
        return {"error": "unknown agent(s)"}
    run = supervisor.start_arena(req.topic, req.agent_a, req.agent_b, max(1, min(6, req.rounds)))
    return {"run_id": run.run_id}


@router.post("/api/mission")
async def mission(req: MissionRequest) -> dict:
    if req.worker_type not in registry.SPECS or req.worker_type == "ada":
        return {"error": f"bad worker_type: {req.worker_type}"}
    run = supervisor.start_mission(req.goal, req.worker_type, max(1, min(5, req.max_tasks)))
    return {"run_id": run.run_id}


@router.post("/api/runs/{run_id}/steer")
async def steer(run_id: str, req: SteerRequest) -> dict:
    """Talk to a running agent mid-task — the message is injected into its live run so it
    can adjust course. Returns { delivered: bool, reason? }."""
    return supervisor.steer(run_id, req.text)


@router.get("/api/runs")
async def runs() -> list[dict]:
    return [r.snapshot() for r in supervisor.list_runs()]


@router.websocket("/api/runs/{run_id}/ws")
async def run_ws(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    try:
        async for event in subscribe(run_id):
            await websocket.send_json(event.model_dump(mode="json"))
            if event.type in (EventType.FINAL, EventType.ERROR):
                break
    except WebSocketDisconnect:
        pass


@router.websocket("/api/fleet/ws")
async def fleet_ws(websocket: WebSocket) -> None:
    """One socket, every agent. Sends the current roster, then streams all runs' events
    (each tagged with its run snapshot) so the cockpit can keep live cards for each."""
    await websocket.accept()
    try:
        for r in supervisor.list_runs():
            await websocket.send_json({"kind": "run", **r.snapshot()})
        async for event in subscribe_all():
            msg = {"kind": "event", **event.model_dump(mode="json")}
            run = supervisor.get(event.run_id)
            if run:
                msg["run"] = run.snapshot()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        pass
