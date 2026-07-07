"""Model selection. Claude runs the agent loop (planning, tool orchestration). The local
Qwen model on the 5080 is exposed for cheap high-volume subtasks (classification,
summarization, embeddings) — call `local_complete()` from inside a tool when you want to
route work off Claude. The router logs which model handled what so cost/latency is visible."""

from __future__ import annotations

import httpx
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider

from app.config import settings


def claude_model() -> AnthropicModel:
    """The orchestrator model — drives the plan/act/observe loop."""
    return AnthropicModel(
        settings.claude_model,
        provider=AnthropicProvider(api_key=settings.anthropic_api_key),
    )


async def cloud_complete(prompt: str, *, system: str | None = None) -> str:
    """One-shot completion on cloud Claude — the paid brain. The router falls back to this
    for work the local model isn't trusted to handle. Returns the raw text."""
    agent = Agent(claude_model(), instructions=system or "")
    result = await agent.run(prompt)
    return result.output


async def local_complete(prompt: str, *, system: str | None = None) -> str:
    """One-shot completion on the local Qwen model via Ollama. Use inside tools for the
    cheap stuff so it never hits the Claude bill. Returns the raw text."""
    body: dict = {
        "model": settings.local_model,
        "prompt": prompt,
        "stream": False,
    }
    if system:
        body["system"] = system
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{settings.ollama_base_url}/api/generate", json=body)
        resp.raise_for_status()
        return resp.json().get("response", "")
