"""Agent registry — the personas the runtime knows how to run. Every agent is the same
plan/act/observe loop (loop.drive) plus a persona and a tool set; adding a new agent type
is just adding an AgentSpec here. The Fleet launcher reads this list."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai import Agent

from app.agents.models import claude_model
from app.tools import assistant, calendar, memory, research, tasks
from app.tools.spawn import spawn_agent

ADA_INSTR = """You are Ada, a personal secretary agent. You manage the user's tasks,
calendar, and email, answer questions, and keep things moving. Be concise and direct.
You have REAL tools: tasks persist to a database, and the calendar tools read/create/move
real Google Calendar events. To reschedule an event, call list_events first to get its id,
then move_event. Use current_time to ground relative dates ("tomorrow", "next week"), and
pass RFC3339 datetimes with the local UTC offset to calendar tools. You have PERSISTENT
long-term memory across sessions via remember/recall. Rules for memory, follow them exactly:
(1) When the user tells you something worth keeping — a preference, a person, a password, a
location, a decision, a commitment — call remember to store it. (2) BEFORE you ever tell the
user you don't know, don't have, or can't access something personal, you MUST call recall
first to check your memory — only say you don't know if recall comes back empty. Never claim
you're unable to store or retrieve personal info; you can. For cheap, high-volume text work
— summarizing a note/email/document, or classifying/triaging text into a label — call
summarize or classify. These run on a free local model, so ALWAYS prefer them for that kind
of work instead of doing it yourself. When a request is open-ended or benefits from parallel
work, you can launch a background agent with spawn_agent. Confirm actions in one line; ask
before creating/moving calendar events."""

# Appended to every LLM agent's instructions — they all run as live, steerable tasks.
STEER_NOTE = """

You run as a LIVE, steerable task: the user can send you new instructions while you are
still working. When a new user message arrives mid-task, treat it as top priority — adjust
course immediately, drop or revise your old plan as needed, and acknowledge the change.
Don't just plow ahead with what you were doing as if nothing was said."""

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

_CALENDAR_TOOLS: list[Callable] = [
    calendar.list_events,
    calendar.create_event,
    calendar.move_event,
]

_MEMORY_TOOLS: list[Callable] = [
    memory.remember,
    memory.recall,
]

# Cheap subtasks that run on the local Qwen model (free) via the router, instead of
# spending Claude tokens. See tools/assistant.py and agents/router.py.
_LOCAL_TOOLS: list[Callable] = [
    assistant.summarize,
    assistant.classify,
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
        ADA_INSTR,
        [*_TASK_TOOLS, *_CALENDAR_TOOLS, *_MEMORY_TOOLS, *_LOCAL_TOOLS, spawn_agent],
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
    agent = Agent(claude_model(), instructions=spec.instructions + STEER_NOTE)
    for tool in spec.tools:
        agent.tool_plain(tool)
    return agent
