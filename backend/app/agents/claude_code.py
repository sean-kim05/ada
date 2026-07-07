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
from dataclasses import dataclass

from app.config import settings
from app.runtime.bus import Emitter
from app.runtime.events import EventType

MODEL_TAG = "claude-code"

# How long an interactive Forge conversation waits for the next reply before it closes
# itself (so parked sessions don't linger forever).
_CHAT_IDLE_SECONDS = 15 * 60


@dataclass
class TurnResult:
    text: str
    session_id: str | None
    tokens: int | None
    cost: float | None
    is_error: bool


async def _run_turn(
    prompt: str, emitter: Emitter, cwd: str, resume_session: str | None = None
) -> TurnResult:
    """Run ONE headless Claude Code turn and stream it as AgentEvents (LOG/TOOL_CALL/
    TOOL_RESULT). Captures the CLI session id (for --resume) and the turn's result/usage,
    but does NOT emit FINAL — the caller decides whether the run is over. `resume_session`
    continues a prior conversation so Forge keeps full context across turns."""
    cmd = [
        settings.claude_bin, "-p", prompt,
        "--output-format", "stream-json", "--verbose",
        "--dangerously-skip-permissions",  # scoped to the sandbox dir (see module docstring)
    ]
    if resume_session:
        cmd += ["--resume", resume_session]
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
    session_id: str | None = None
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
            session_id = evt.get("session_id") or session_id
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
    if rc != 0 and not final_text:
        is_error = True
        final_text = f"claude_code exited with code {rc}"
    return TurnResult(final_text, session_id, tokens, cost, is_error)


async def drive_claude_code(prompt: str, emitter: Emitter, cwd: str) -> str:
    """One-shot Forge — used when Ada delegates a task (spawn_agent) or a Mission worker runs.
    Emits FINAL on success and returns the final text; raises on failure so the supervisor's
    error path emits ERROR (mirrors the LLM loop's contract)."""
    r = await _run_turn(prompt, emitter, cwd)
    if r.is_error:
        raise RuntimeError(r.text or "claude_code failed")
    await emitter.emit(
        EventType.FINAL, {"text": r.text}, model=MODEL_TAG, tokens=r.tokens, cost_usd=r.cost
    )
    return r.text


async def chat_claude_code(
    prompt: str, emitter: Emitter, cwd: str, inbox: "asyncio.Queue[str]"
) -> str:
    """Interactive Forge — a continuous conversation. Each turn resumes the CLI session so
    Forge keeps full context (and the sandbox files persist on disk regardless). The run
    stays alive between turns (no FINAL) waiting for the next reply from `inbox`; it emits
    FINAL only when the user idles out or an error occurs. This is what makes Forge chattable
    from the Fleet/Terminal instead of a one-shot."""
    session: str | None = None
    current = prompt
    last_text = ""
    while True:
        r = await _run_turn(current, emitter, cwd, resume_session=session)
        last_text = r.text or last_text
        if r.session_id:
            session = r.session_id
        if r.is_error:
            raise RuntimeError(r.text or "claude_code failed")

        await emitter.emit(
            EventType.LOG,
            {"line": "● ready — reply to keep going, or leave it here.", "stream": "system"},
            model=MODEL_TAG,
        )
        try:
            current = await asyncio.wait_for(inbox.get(), timeout=_CHAT_IDLE_SECONDS)
        except asyncio.TimeoutError:
            break

        # echo the user's reply into the terminal + trace, then run the next turn
        await emitter.emit(EventType.LOG, {"line": f"› {current}", "stream": "cmd"}, model=MODEL_TAG)
        await emitter.emit(
            EventType.MESSAGE, {"role": "user", "text": current, "steer": True}, model="user"
        )

    await emitter.emit(EventType.FINAL, {"text": last_text}, model=MODEL_TAG)
    return last_text


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
