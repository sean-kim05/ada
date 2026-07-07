"""The generic plan/act/observe loop. Every agent — Ada, a researcher, a planner —
is driven through this same function, which walks the Pydantic-AI run graph and emits an
AgentEvent for each meaningful step. This is the spine the multi-agent runtime builds on:
one loop, many agents, all emitting the same event stream."""

from __future__ import annotations

import asyncio
import time

from pydantic_ai import Agent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
)

from app.runtime.bus import Emitter
from app.runtime.events import EventType


async def drive(
    agent: Agent,
    prompt: str,
    emitter: Emitter,
    message_history: list[ModelMessage] | None = None,
    steer_inbox: "asyncio.Queue[str] | None" = None,
) -> tuple[str, list[ModelMessage]]:
    """Drive one agent run, emitting events per step. `message_history` (optional) replays a
    prior conversation so the agent has memory. `steer_inbox` (optional) makes the run LIVE
    and steerable: at each step boundary we drain any user messages the supervisor queued
    and inject them into the in-flight conversation (pydantic-ai `run.enqueue`, priority
    'asap'), so the user can redirect the agent while it's still working. Returns (final
    answer, full message history including this turn) — the caller persists it to continue."""
    step_start = time.perf_counter()

    async with agent.iter(prompt, message_history=message_history) as run:
        async for node in run:
            # Steering: fold in any mid-task instructions the user sent since the last step.
            # Same coroutine that drives agent.iter() → enqueue is safe to call here.
            if steer_inbox is not None:
                while not steer_inbox.empty():
                    steer = steer_inbox.get_nowait()
                    await emitter.emit(
                        EventType.MESSAGE,
                        {"role": "user", "text": steer, "steer": True},
                        model="user",
                    )
                    run.enqueue(steer, priority="asap")
                    step_start = time.perf_counter()

            # In pydantic-ai 2.5 both the tool CALL and its RESULT surface on the
            # call-tools node: FunctionToolCallEvent when Claude picks a tool, then
            # FunctionToolResultEvent when it returns.
            if Agent.is_call_tools_node(node):
                async with node.stream(run.ctx) as stream:
                    async for event in stream:
                        if isinstance(event, FunctionToolCallEvent):
                            latency = int((time.perf_counter() - step_start) * 1000)
                            await emitter.emit(
                                EventType.TOOL_CALL,
                                {"tool": event.part.tool_name, "input": event.part.args},
                                model="claude",
                                latency_ms=latency,
                            )
                            step_start = time.perf_counter()
                        elif isinstance(event, FunctionToolResultEvent):
                            latency = int((time.perf_counter() - step_start) * 1000)
                            await emitter.emit(
                                EventType.TOOL_RESULT,
                                {"tool": event.part.tool_name, "output": _short(event.part.content)},
                                latency_ms=latency,
                            )
                            step_start = time.perf_counter()

    final = run.result.output if run.result else ""
    history = run.result.all_messages() if run.result else (message_history or [])
    usage = run.usage
    await emitter.emit(
        EventType.FINAL,
        {"text": final},
        model="claude",
        tokens=(usage.total_tokens if usage else None),
    )
    return final, history


def _short(value, limit: int = 300) -> str:
    s = str(value)
    return s if len(s) <= limit else s[:limit] + "…"
