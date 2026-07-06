"""claude_code agent (M3) — Ada delegates real engineering work to Claude Code.

Instead of the Pydantic-AI loop, this driver runs the `claude` CLI headless as a
subprocess (`-p --output-format stream-json`) and re-emits its output as our AgentEvents:

  * LOG          -> the raw, human-readable stream (drives the Terminal panel)
  * TOOL_CALL    -> Claude Code invoked a tool (Write/Edit/Bash/…) — drives the trace
  * TOOL_RESULT  -> that tool returned
  * FINAL        -> the run's final message (+ tokens & would-be cost)

It runs on the user's **Max plan** (the CLI's own auth), so there's no API key and no
per-token billing — the `total_cost_usd` we surface is the *equivalent* cost, not a charge.
Every run is scoped to `settings.sandbox_dir` to bound the blast radius.
"""

from __future__ import annotations

import asyncio
import json

from app.config import settings
from app.runtime.bus import Emitter
from app.runtime.events import EventType

MODEL_TAG = "claude-code"


async def drive_claude_code(prompt: str, emitter: Emitter, cwd: str) -> str:
    """Run one headless Claude Code session and stream it as AgentEvents.

    Emits FINAL on success and returns the final text; raises on failure so the
    supervisor's error path emits ERROR (mirrors the LLM loop's contract).
    """
    cmd = [
        settings.claude_bin, "-p", prompt,
        "--output-format", "stream-json", "--verbose",
        "--dangerously-skip-permissions",  # scoped to the sandbox dir (see module docstring)
    ]
    if settings.claude_code_model:
        cmd += ["--model", settings.claude_code_model]

    await emitter.emit(
        EventType.LOG,
        {"line": f"$ claude -p {_trunc(prompt, 90)}", "stream": "cmd"},
        model=MODEL_TAG,
    )

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdin=asyncio.subprocess.DEVNULL,   # avoid the CLI's 3s "no stdin" wait
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None

    tool_names: dict[str, str] = {}   # tool_use_id -> tool name
    final_text = ""
    tokens: int | None = None
    cost: float | None = None
    is_error = False

    async for raw in proc.stdout:
        line = raw.decode(errors="replace").strip()
        if not line:
            continue
        try:
            evt = json.loads(line)
        except json.JSONDecodeError:
            # a plain warning/log line the CLI printed — surface it dimly
            await emitter.emit(EventType.LOG, {"line": line, "stream": "stderr"}, model=MODEL_TAG)
            continue

        t = evt.get("type")

        if t == "system" and evt.get("subtype") == "init":
            model = evt.get("model", "?")
            await emitter.emit(
                EventType.LOG,
                {"line": f"● session started · {model} · {cwd}", "stream": "system"},
                model=MODEL_TAG,
            )

        elif t == "assistant":
            for b in evt.get("message", {}).get("content", []):
                bt = b.get("type")
                if bt == "text":
                    text = (b.get("text") or "").strip()
                    if text:
                        await emitter.emit(EventType.LOG, {"line": text, "stream": "assistant"}, model=MODEL_TAG)
                elif bt == "tool_use":
                    name = b.get("name", "?")
                    tool_names[b.get("id", "")] = name
                    inp = b.get("input", {})
                    await emitter.emit(
                        EventType.LOG,
                        {"line": f"⏺ {name}({_summarize_input(inp)})", "stream": "tool"},
                        model=MODEL_TAG,
                    )
                    await emitter.emit(EventType.TOOL_CALL, {"tool": name, "input": inp}, model=MODEL_TAG)
                # 'thinking' blocks are intentionally not surfaced

        elif t == "user":
            for b in evt.get("message", {}).get("content", []):
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    name = tool_names.get(b.get("tool_use_id", ""), "tool")
                    out = _stringify(b.get("content"))
                    await emitter.emit(
                        EventType.LOG,
                        {"line": f"  ⎿ {_trunc(out, 110)}", "stream": "result"},
                        model=MODEL_TAG,
                    )
                    await emitter.emit(
                        EventType.TOOL_RESULT,
                        {"tool": name, "output": _trunc(out, 300)},
                        model=MODEL_TAG,
                    )

        elif t == "result":
            final_text = str(evt.get("result") or "")
            is_error = bool(evt.get("is_error"))
            cost = evt.get("total_cost_usd")
            usage = evt.get("usage") or {}
            tokens = sum(
                int(usage.get(k) or 0)
                for k in (
                    "input_tokens", "output_tokens",
                    "cache_read_input_tokens", "cache_creation_input_tokens",
                )
            ) or None

        # rate_limit_event and anything else: ignored

    rc = await proc.wait()

    if is_error or rc != 0:
        raise RuntimeError(final_text or f"claude_code exited with code {rc}")

    await emitter.emit(
        EventType.FINAL,
        {"text": final_text},
        model=MODEL_TAG,
        tokens=tokens,
        cost_usd=cost,
    )
    return final_text


# --- formatting helpers -----------------------------------------------------

def _trunc(s: str, n: int) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _summarize_input(inp) -> str:
    """A short, readable rendering of a tool's input for the terminal line."""
    if not isinstance(inp, dict):
        return _trunc(inp, 60)
    for k in ("file_path", "path", "command", "pattern", "query", "url", "prompt"):
        if inp.get(k):
            return _trunc(inp[k], 60)
    return _trunc(json.dumps(inp), 60)


def _stringify(content) -> str:
    """Tool-result content is a string or a list of content blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict):
                parts.append(b.get("text") or json.dumps(b))
            else:
                parts.append(str(b))
        return " ".join(parts)
    return str(content)
