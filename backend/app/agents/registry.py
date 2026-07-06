"""Agent registry — the personas the runtime knows how to run. Every agent is the same
plan/act/observe loop (loop.drive) plus a persona and a tool set; adding a new agent type
is just adding an AgentSpec here. The Fleet launcher reads this list."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai import Agent

from app.agents.models import claude_model
from app.tools import research, tasks
from app.tools.spawn import spawn_agent

ADA_INSTR = """You are Ada, a personal secretary agent. You manage the user's tasks,
calendar, and email, answer questions, and keep things moving. Be concise and direct.
When a request is open-ended or benefits from parallel work — research or planning — you
can launch a background agent with spawn_agent and tell the user you kicked it off. Use
tools when they help; confirm actions in one line."""

RESEARCH_INSTR = """You are Scout, a research agent. Given a topic, search for
information with web_search, pull out the key points, save a note with save_note, then
finish with a tight 2-3 sentence summary. Be fast and specific."""

PLANNER_INSTR = """You are Atlas, a planning agent. Given a goal, break it into a short
sequence of concrete tasks, create each with add_task, then summarize the plan in a few
lines. Keep it lean — no more than 4-5 tasks."""

_TASK_TOOLS: list[Callable] = [
    tasks.add_task,
    tasks.list_tasks,
    tasks.complete_task,
    tasks.current_time,
]


@dataclass
class AgentSpec:
    type: str
    name: str
    blurb: str
    accent: str  # UI colour hint for the Fleet card
    instructions: str
    tools: list[Callable]
    driver: str = "llm"  # "llm" = Pydantic-AI loop; "claude_code" = headless CLI subprocess


SPECS: dict[str, AgentSpec] = {
    "ada": AgentSpec(
        "ada", "Ada", "Secretary — tasks, calendar, email", "amber",
        ADA_INSTR, [*_TASK_TOOLS, spawn_agent],
    ),
    "researcher": AgentSpec(
        "researcher", "Scout", "Researcher — finds & summarizes", "cyan",
        RESEARCH_INSTR, [research.web_search, research.save_note, tasks.current_time],
    ),
    "planner": AgentSpec(
        "planner", "Atlas", "Planner — breaks goals into tasks", "violet",
        PLANNER_INSTR, list(_TASK_TOOLS),
    ),
    # M3: real coding, delegated to Claude Code (runs on the Max plan, sandboxed).
    "claude_code": AgentSpec(
        "claude_code", "Forge", "Engineer — writes code via Claude Code", "green",
        "", [], driver="claude_code",
    ),
}


def build(agent_type: str) -> Agent:
    """Construct a fresh Pydantic-AI agent for one run. Fresh per run keeps runs isolated.
    Not used for subprocess drivers (e.g. claude_code) — the supervisor branches on
    spec.driver before calling this."""
    spec = SPECS[agent_type]
    if spec.driver != "llm":
        raise ValueError(f"{agent_type} uses the '{spec.driver}' driver, not the LLM loop")
    agent = Agent(claude_model(), instructions=spec.instructions)
    for tool in spec.tools:
        agent.tool_plain(tool)
    return agent
