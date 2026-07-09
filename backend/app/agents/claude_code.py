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
from dataclasses import dataclass, field

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


@dataclass
class _Stream:
    """Mutable state threaded through a Claude Code output stream. For a one-shot run it
    lives for one turn; for an interactive session it persists across turns (so the session
    id, the tool-name map, and the once-only banner survive from one reply to the next)."""
    tool_names: dict[str, str] = field(default_factory=dict)  # tool_use_id -> tool name
    session_id: str | None = None
    final_text: str = ""
    tokens: int | None = None
    cost: float | None = None
    is_error: bool = False
    banner_shown: bool = False


async def _pump_event(evt: dict, emitter: Emitter, st: _Stream, cwd: str) -> bool:
    """Translate ONE stream-json event into AgentEvents, mutating `st`. Returns True when the
    event is the turn's terminating `result`. The CLI re-emits a system/init at the head of
    every turn (even within one persistent session), so the '● session started' banner is
    shown only the first time — that's what makes an interactive session read as one chat."""
    t = evt.get("type")

    if t == "system" and evt.get("subtype") == "init":
        st.session_id = evt.get("session_id") or st.session_id
        if not st.banner_shown:
            st.banner_shown = True
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
                st.tool_names[b.get("id", "")] = name
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
                name = st.tool_names.get(b.get("tool_use_id", ""), "tool")
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
        st.final_text = str(evt.get("result") or "")
        st.is_error = bool(evt.get("is_error"))
        st.cost = evt.get("total_cost_usd")
        usage = evt.get("usage") or {}
        st.tokens = sum(
            int(usage.get(k) or 0)
            for k in (
                "input_tokens", "output_tokens",
                "cache_read_input_tokens", "cache_creation_input_tokens",
            )
        ) or None
        return True

    # rate_limit_event and anything else: ignored
    return False


def _user_line(text: str) -> bytes:
    """A single stream-json user message, newline-terminated — one turn of input."""
    return (json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n").encode()


async def _run_turn(prompt: str, emitter: Emitter, cwd: str) -> TurnResult:
    """Run ONE headless Claude Code turn and stream it as AgentEvents (LOG/TOOL_CALL/
    TOOL_RESULT). Captures the turn's result/usage but does NOT emit FINAL — the caller
    decides whether the run is over."""
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

    st = _Stream()
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
        await _pump_event(evt, emitter, st, cwd)

    rc = await proc.wait()
    if rc != 0 and not st.final_text:
        st.is_error = True
        st.final_text = f"claude_code exited with code {rc}"
    return TurnResult(st.final_text, st.session_id, st.tokens, st.cost, st.is_error)


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
    """Interactive Forge — ONE long-lived Claude Code process: a single continuous session,
    not a re-spawn per reply. Each user turn is written to the process's stdin as a stream-json
    message; context and sandbox files persist natively. The run stays alive between turns (no
    FINAL) waiting for the next reply from `inbox`; it emits FINAL only when the user idles out,
    the session errors, or the process exits. This is what makes Forge feel like one chat you
    keep talking to instead of a one-shot."""
    cmd = [
        settings.claude_bin, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",  # scoped to the sandbox dir (see module docstring)
    ]
    if settings.claude_code_model:
        cmd += ["--model", settings.claude_code_model]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdin is not None and proc.stdout is not None

    async def send(text: str) -> None:
        proc.stdin.write(_user_line(text))
        await proc.stdin.drain()

    async def read_one_turn(st: _Stream) -> bool:
        """Read stdout up to (and including) the turn's `result`. False if the process died."""
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                return False  # EOF — the process is gone
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                await emitter.emit(EventType.LOG, {"line": line, "stream": "stderr"}, model=MODEL_TAG)
                continue
            if await _pump_event(evt, emitter, st, cwd):
                return True

    st = _Stream()
    last_text = ""
    await emitter.emit(
        EventType.LOG, {"line": f"$ claude · interactive session · {cwd}", "stream": "cmd"}, model=MODEL_TAG
    )
    await emitter.emit(EventType.LOG, {"line": f"› {_trunc(prompt, 100)}", "stream": "cmd"}, model=MODEL_TAG)

    try:
        await send(prompt)
        while True:
            # Each turn overwrites st.final_text/is_error; session_id + banner persist.
            st.final_text = ""
            st.is_error = False
            alive = await read_one_turn(st)
            if not alive:
                st.is_error = True
                st.final_text = st.final_text or "claude_code session ended unexpectedly"
                break
            last_text = st.final_text or last_text
            if st.is_error:
                break

            await emitter.emit(
                EventType.LOG,
                {"line": "● ready — reply to keep going, or leave it here.", "stream": "system"},
                model=MODEL_TAG,
            )
            try:
                nxt = await asyncio.wait_for(inbox.get(), timeout=_CHAT_IDLE_SECONDS)
            except asyncio.TimeoutError:
                break

            # echo the user's reply into the terminal + trace, then feed it to the live session
            await emitter.emit(EventType.LOG, {"line": f"› {nxt}", "stream": "cmd"}, model=MODEL_TAG)
            await emitter.emit(
                EventType.MESSAGE, {"role": "user", "text": nxt, "steer": True}, model="user"
            )
            await send(nxt)
    finally:
        # Close the session down cleanly on any exit path (idle-out, error, cancel).
        if proc.returncode is None:
            try:
                proc.stdin.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=10)
            except (asyncio.TimeoutError, ProcessLookupError):
                proc.kill()

    if st.is_error:
        raise RuntimeError(st.final_text or "claude_code failed")
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
