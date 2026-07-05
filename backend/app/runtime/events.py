"""The single event type every agent emits. One schema, three consumers:
CLI trace, dashboard (WebSocket), Postgres (replay). This is the spine of Ada."""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EventType(str, Enum):
    PLAN = "plan"                # agent decided what to do
    TOOL_CALL = "tool_call"      # agent invoked a tool
    TOOL_RESULT = "tool_result"  # tool returned
    MESSAGE = "message"          # agent -> agent (drives the Arena)
    LOG = "log"                  # raw stdout, e.g. Claude Code (drives the Terminal)
    FINAL = "final"              # agent's final answer
    ERROR = "error"


class AgentEvent(BaseModel):
    run_id: str
    agent_id: str
    seq: int
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)

    model: str | None = None          # "claude" | "qwen-14b-local" | None
    latency_ms: int | None = None
    tokens: int | None = None
    cost_usd: float | None = None
    ts: float = Field(default_factory=time.time)

    def channel(self) -> str:
        """Redis pub/sub channel for this event's run."""
        return f"ada:run:{self.run_id}"
