"""The Arena (M4) — two agents talk.

A single run drives a short back-and-forth between two personas over a topic, emitting a
MESSAGE event per turn (from -> to). The Arena view animates those messages flowing between
the two agents. Pure conversation on Haiku (no tools, cheap) — and it proves the
message-passing plumbing that M5 (real collaboration) builds on.
"""

from __future__ import annotations

from pydantic_ai import Agent

from app.agents import registry
from app.agents.models import claude_model
from app.runtime.bus import Emitter
from app.runtime.events import EventType


def _persona(spec: registry.AgentSpec, other_name: str, topic: str) -> str:
    return (
        f"You are {spec.name} — {spec.blurb}. You're in a live, friendly back-and-forth with "
        f"{other_name} about: {topic}. Stay fully in character. Reply in 2-3 punchy sentences, "
        f"reacting directly to what {other_name} just said and pushing the conversation forward. "
        f"Now and then ask a pointed question. No lists, no preamble — just your reply."
    )


async def run_arena(
    emitter: Emitter, topic: str, a_type: str, b_type: str, rounds: int = 3
) -> None:
    if a_type not in registry.SPECS or b_type not in registry.SPECS:
        raise ValueError(f"unknown agent(s): {a_type}, {b_type}")

    specs = {"a": registry.SPECS[a_type], "b": registry.SPECS[b_type]}
    agents = {
        "a": Agent(claude_model(), instructions=_persona(specs["a"], specs["b"].name, topic)),
        "b": Agent(claude_model(), instructions=_persona(specs["b"], specs["a"].name, topic)),
    }

    transcript = f"Topic: {topic}"
    prev = f"Let's get into it: {topic}"
    cur = "a"
    total = max(1, rounds) * 2

    for _ in range(total):
        spec = specs[cur]
        other = specs["b" if cur == "a" else "a"]
        prompt = f'{transcript}\n\n{other.name} just said: "{prev}"\n\nYour reply as {spec.name}:'
        result = await agents[cur].run(prompt)
        text = (result.output or "").strip()
        await emitter.emit(
            EventType.MESSAGE,
            {
                "from": spec.name,
                "to": other.name,
                "from_type": spec.type,
                "to_type": other.type,
                "text": text,
            },
            model="claude",
        )
        transcript += f"\n{spec.name}: {text}"
        prev = text
        cur = "b" if cur == "a" else "a"

    await emitter.emit(
        EventType.FINAL,
        {"text": f"Arena complete — {total} messages between {specs['a'].name} and {specs['b'].name}."},
        model="claude",
    )
