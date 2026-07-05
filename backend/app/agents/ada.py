"""Ada — the secretary agent. Built on Pydantic AI (it handles the plan/act/observe loop
and tool calling); Ada owns the observability by iterating the run graph node-by-node and
emitting an AgentEvent for each meaningful step. This is what feeds the dashboard trace,
the CLI, and Postgres.

The `run()` function is the integration point the runtime calls. It takes a prompt and an
Emitter, drives the agent, and returns the final text."""

from __future__ import annotations

import time

from pydantic_ai import Agent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
)

from app.agents.models import claude_model
from app.runtime.bus import Emitter
from app.runtime.events import EventType
from app.tools import tasks

INSTRUCTIONS = """You are Ada, a personal secretary agent. You manage the user's tasks,
calendar, and email, answer questions, and keep things moving. Be concise and direct.
Use tools when they help; don't narrate that you're using them. When you take an action,
confirm what you did in one line."""


def build_agent() -> Agent:
    agent = Agent(claude_model(), instructions=INSTRUCTIONS)

    # Register tools. Each becomes callable by the model; docstrings are the tool schema.
    agent.tool_plain(tasks.add_task)
    agent.tool_plain(tasks.list_tasks)
    agent.tool_plain(tasks.complete_task)
    agent.tool_plain(tasks.current_time)
    return agent


_agent = build_agent()


async def run(prompt: str, emitter: Emitter) -> str:
    """Drive one Ada run, emitting events for each step. Returns Ada's final answer.

    We use agent.iter() to walk the run graph. For each node we inspect what happened and
    translate it into AgentEvents:
      - a model request that produced tool calls -> PLAN + TOOL_CALL events
      - tool executions -> TOOL_RESULT events
      - the end node -> FINAL event
    """
    step_start = time.perf_counter()

    async with _agent.iter(prompt) as run:
        async for node in run:
            # Model produced a response (may include tool calls or final text).
            if Agent.is_model_request_node(node):
                # Stream the model's step; capture tool calls as they're requested.
                async with node.stream(run.ctx) as stream:
                    async for event in stream:
                        if isinstance(event, FunctionToolCallEvent):
                            latency = int((time.perf_counter() - step_start) * 1000)
                            await emitter.emit(
                                EventType.TOOL_CALL,
                                {
                                    "tool": event.part.tool_name,
                                    "input": event.part.args,
                                },
                                model="claude",
                                latency_ms=latency,
                            )
                            step_start = time.perf_counter()

            # Tools executed; emit their results.
            elif Agent.is_call_tools_node(node):
                async with node.stream(run.ctx) as stream:
                    async for event in stream:
                        if isinstance(event, FunctionToolResultEvent):
                            latency = int((time.perf_counter() - step_start) * 1000)
                            await emitter.emit(
                                EventType.TOOL_RESULT,
                                {
                                    "tool": event.part.tool_name,
                                    "output": _short(event.part.content),
                                },
                                latency_ms=latency,
                            )
                            step_start = time.perf_counter()

    final = run.result.output if run.result else ""
    usage = run.usage
    await emitter.emit(
        EventType.FINAL,
        {"text": final},
        model="claude",
        tokens=(usage.total_tokens if usage else None),
    )
    return final


def _short(value, limit: int = 300) -> str:
    s = str(value)
    return s if len(s) <= limit else s[:limit] + "…"
