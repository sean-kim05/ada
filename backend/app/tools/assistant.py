"""Ada's cheap-subtask tools. These run on the local Qwen model via the router, so Ada can
summarize, triage, and classify without spending Claude tokens. Every call is recorded by
the router and shows up in the cockpit's Router panel — the offload is visible, not silent."""

from __future__ import annotations

from app.agents import router


async def summarize(text: str) -> str:
    """Condense a piece of text — a note, an email, a document, a wall of chat — into 2-3
    tight sentences. Runs on the free local model, so use it freely whenever the user wants
    something summed up or TL;DR'd. Returns the summary."""
    return await router.complete(
        f"Summarize the following in 2-3 sentences. Output only the summary.\n\n{text}",
        system="You are a concise summarizer. No preamble, just the summary.",
        kind="summarize",
    )


async def classify(text: str, labels: str) -> str:
    """Sort `text` into exactly one of the comma-separated `labels`. Runs on the free local
    model — use it for triage: priority (high, normal, low), category, sentiment, is-this-urgent,
    etc. Returns the single chosen label."""
    return await router.complete(
        f"Text:\n{text}\n\nChoose exactly one label from: {labels}\n"
        "Respond with only the chosen label, nothing else.",
        system="You are a precise classifier. Output only the single chosen label.",
        kind="classify",
    )
