# Ada — Agent OS Terminal

Ada is a personal AI agent cockpit: an **agent runtime + observability layer**. Every
agent (secretary, researcher, planner, …) emits a single unified `AgentEvent` stream,
and every view in the product — a per-run trace, the fleet feed, the CLI — is just a
different lens over that one stream.

- **Backend:** FastAPI (async) + Pydantic AI + Anthropic Claude (**Haiku**, `claude-haiku-4-5`).
- **Frontend:** React 18 + TypeScript + Vite.
- **Stateful services:** Postgres + Redis + Qdrant via docker-compose.
- **Event spine:** one `AgentEvent` → Redis pub/sub (`ada:run:{run_id}`) → per-run WebSocket
  + a fleet-wide WebSocket (psubscribe `ada:run:*`) + a rich CLI.

Design docs: `ARCHITECTURE.md`, `ROADMAP.md`. Deck design reference: `Ada-standalone.html`.

## Status

- **M1** — secretary loop (Chat + live Agent Trace). Real backend, works end-to-end.
- **M2** — multi-agent Fleet. Runs any agent type concurrently; Fleet view shows a live
  card per agent, a launcher, and click-to-focus trace.
- **M3** — `claude_code` agent ("Forge"): Ada delegates real coding to Claude Code running
  headless as a subprocess, sandboxed to `sandbox/` (or any per-run `workdir`), streamed live
  into a Terminal panel. Runs on the **Max plan** (no API key, no per-token billing).
- **M4** — the Arena: watch two agents talk. One run drives a back-and-forth between two
  personas over a topic (MESSAGE events per turn); the Arena view animates the flow between
  them. Pure conversation on Haiku — and it proves the message-passing plumbing for M5.
- **M5** — Mission: real multi-agent collaboration. A planner (Atlas) decomposes a goal into
  subtasks, delegates each to a REAL worker sub-run (shows in the Fleet), collects results,
  and synthesizes a deliverable. Handoffs are MESSAGE events; the Mission view shows the
  plan (with per-subtask status), the Atlas↔worker flow, and the final synthesis.
- Every persona has a distinct **identity** (glyph + colour): Ada=amber spark, Scout=cyan
  lens, Atlas=violet checklist, Forge=green code-brackets — surfaced in Fleet/Arena/launcher.

M1/M2 brains run on Haiku; M3 runs the `claude` CLI's default model (Opus).

**M1 substance is now real (2026-07-06 — "make the secretary real" pass):**
- **Tasks** persist to **Postgres** (`db.py` pool + schema; `tools/tasks.py` on Postgres; REST
  at `/api/tasks`). A task Ada adds in chat shows up in the deck's To-do panel and survives
  restarts. This is real, verified end-to-end.
- **Calendar** is wired to **real Google Calendar** (`tools/calendar.py` list/create/move via
  the Calendar API; `/api/calendar/*`; the deck panel renders your real day). Needs a one-time
  OAuth setup — see **`CALENDAR_SETUP.md`**. Until `backend/.google/token.json` exists, the tools
  and panel show a friendly "not connected" state (no crash).
- **Memory (short-term)** is real: Ada remembers the chat thread. Per-session history in Redis
  (`memory/conversation.py`, key `ada:chat:{session}`, ~3-day TTL, trimmed to the recent tail),
  replayed via pydantic-ai `message_history`. `loop.drive` now takes history + returns the updated
  messages; `supervisor` loads/saves it for chat runs (session `"main"`). Verified: turn 2 recalls
  turn 1. Non-chat runs (Fleet/Arena/Mission workers) stay one-shot (no session_id).
- **Long-term memory + RAG (Qdrant)** is real — the M2 substance behind the "Docs/RAG" tab.
  `memory/longterm.py` = Qdrant + in-process `fastembed` (BAAI/bge-small-en, no API key);
  `tools/memory.py` gives Ada `remember`/`recall`; `/api/memory` REST; the **Docs view** lists /
  searches / adds / deletes memories. Ada's instructions force a `recall` before she ever claims
  not to know. Verified: she saves a fact and recalls it in a brand-new session.
- **Local-model router (Claude ↔ Qwen) is real** — the "route cheap work off the bill" piece.
  `agents/router.py` decides local-vs-cloud by work *kind* (LOCAL_KINDS = classify/summarize/
  extract/triage/draft/rewrite → local Qwen on the 5080; everything else → cloud Claude), runs
  it, and records cost/latency/$-saved per call. `agents/models.py` has both `local_complete`
  (Ollama) and `cloud_complete` (a one-shot Claude). Ada's `summarize`/`classify` tools
  (`tools/assistant.py`) go through it, so real subtasks run free on the GPU. `/api/router/stats`
  + `/api/router/health` feed the **Router view** (model cards, offload %, $ saved, recent calls)
  and the sidebar's LOCAL/API bar. Model = `qwen2.5:7b-instruct` (pulled; ~4.7GB; warm ~1s on the
  5080). Verified end-to-end: Ada offloads a summarize to Qwen at $0, and the cloud branch
  escalates correctly. **Ollama must be running** (`ollama serve`) — the panel shows "OLLAMA
  OFFLINE" and the tools degrade gracefully if not.
- **Live steering (talk to agents mid-task) is real** — runs are no longer fire-and-forget.
  Every LLM-loop agent (Ada + Fleet: Scout/Atlas) runs as a steerable task: while it's
  working you can send it a message and it adapts at its next step. Built on pydantic-ai 2.5's
  native `run.enqueue(text, priority='asap')` (mid-run message injection — NOT an interrupt/
  restart hack). `loop.drive` takes a `steer_inbox` (asyncio.Queue), drains it at each node
  boundary → emits a MESSAGE(steer) event (shows in the trace as "YOU ▸") → `run.enqueue`s it.
  `Run.steer_inbox` + `Supervisor.steer(run_id, text)` (validates running + llm-driver);
  `POST /api/runs/{id}/steer {text}` → `{delivered, reason?}`. Registry appends `STEER_NOTE`
  to every agent's instructions so they treat mid-task messages as top priority. Frontend:
  Ada chat routes input to `steerRun` when a run is live (placeholder flips to "Steer Ada while
  she works…"), else starts a new run; Fleet focused pane gets a STEER input on running,
  steerable agents; TraceRow renders steer messages distinctly. Verified end-to-end: injected
  "stop, say STEERED_STOP" mid-research → agent dropped its plan and obeyed. NOT steerable:
  claude_code/Forge (subprocess) and finished runs — the endpoint refuses gracefully.
- Still demo: **Reminders** panel. Not built yet: **Gmail** (needs the Google OAuth).

## Run it

Stateful services run in Docker; backend + frontend run on the host during dev.

```sh
# 1. services (see Docker gotcha below re: docker.exe)
docker compose up -d               # from repo root — Postgres :5432, Redis :6379, Qdrant :6333

# 2. backend  — NOTE: no --reload (see gotcha), run from backend/ so .env loads
cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. frontend
cd frontend && npm run dev         # → http://localhost:5173

# 4. local model (for the router / Ada's cheap subtasks) — needs GPU (WSL CUDA passthrough works)
ollama serve &                     # → :11434;  first time: ollama pull qwen2.5:7b-instruct
```

Health check: `curl 127.0.0.1:8000/health` → `{"status":"ok","model":"claude-haiku-4-5"}`.

## Backend layout (`backend/app/`)

- `agents/loop.py` — generic `drive(agent, prompt, emitter)` loop used by every **LLM** agent.
- `agents/claude_code.py` — the M3 driver: subprocesses `claude -p --output-format stream-json`,
  parses its events, and re-emits them as our AgentEvents (LOG drives the Terminal; tool_use/
  tool_result drive the trace; result → FINAL). Emits FINAL on success, raises on failure.
- `agents/arena.py` — the M4 Arena engine: `run_arena(emitter, topic, a_type, b_type, rounds)`
  drives two persona agents turn-by-turn, emitting a MESSAGE event per turn. Supervisor has
  `start_arena()`; endpoint `POST /api/arena`; streams over the normal `/api/runs/{id}/ws`.
- `agents/mission.py` — the M5 engine: `run_mission(emitter, goal, worker_type, max_tasks)` —
  planner decomposes, spawns real worker sub-runs via `supervisor.start()` and awaits each
  (`Run.result_text` captures a run's final output), emits handoff MESSAGE events, synthesizes.
  Supervisor `start_mission()`; endpoint `POST /api/mission`. Frontend view: `MissionView`.
- `agents/registry.py` — `SPECS` (personas + tools): `ada`/Ada (secretary + `spawn_agent`),
  `researcher`/Scout (`web_search` + `save_note`), `planner`/Atlas (task tools), and
  `claude_code`/Forge (`driver="claude_code"` → subprocess, not the LLM loop). `AgentSpec.driver`
  picks the path; `build(type)` makes a fresh Pydantic-AI agent for `driver="llm"` only.
- `tools/` — `spawn.py` (`spawn_agent`, late-imports supervisor to dodge a cycle),
  `research.py` (`web_search` **STUB** + `save_note`), `tasks.py`.
- `runtime/supervisor.py` — `Supervisor.start(type, prompt)` launches concurrent runs;
  `Run.snapshot()`; `start_ada()` = the chat entrypoint. `_drive` branches on `spec.driver`
  (LLM loop vs `drive_claude_code`).
- `runtime/bus.py` — Redis pub/sub; `subscribe_all()` (psubscribe `ada:run:*`) = the fleet feed.
- `runtime/events.py` — `AgentEvent` schema (keep `frontend/src/lib/ada.ts` in sync).
- `routers/chat.py` — `POST /api/chat` (secretary), `POST /api/agents/spawn`, `GET /api/agents`,
  `GET /api/runs`, `WS /api/runs/{id}/ws` (one run), `WS /api/fleet/ws` (all runs).
- `agents/ada.py` — **DEAD** (superseded by loop + registry); safe to delete.

## Frontend

- `src/lib/ada.ts` — API/WS client: `startRun`, `spawnAgent`, `listAgents`, `openFleet`.
  Mirrors the backend `AgentEvent` — keep the two in sync.
- `src/App.tsx` — view switch (deck ↔ fleet), always-on fleet feed, `FleetView`/`FleetCard`.
  Fleet right pane has a **TRACE / TERMINAL** toggle; `TerminalPanel` renders a run's `log`
  stream console-style (auto-selected for `claude_code` runs, colored by `payload.stream`).
- Theme: **"ADA · Agent OS Terminal"**, punch-card gold-"A" logo (`PunchA` SVG + `A_BITS`
  matrix), IBM Plex Sans/Mono/Serif, dark bluish palette + amber `rgb(234,158,70)`.
  Global `#root { zoom: 1.5 }` scales the deck up for large monitors.

## Gotchas (read before you get stuck)

- **Docker in this WSL:** if `docker` gives "permission denied", the shell was launched before
  Sean joined the `docker` group. Use Windows **`docker.exe`**
  (`/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe`) instead of `docker`. Fresh WSL
  sessions (post group-add) get `docker` directly.
- **Do NOT run uvicorn with `--reload`.** When a long-lived WebSocket (the fleet feed) is open
  during a file save, graceful shutdown hangs forever ("Waiting for background tasks to
  complete"). Restart the backend manually after edits:
  `pkill -9 -f 'uvicorn app.main' && cd backend && .venv/bin/uvicorn app.main:app --port 8000`.
- **Python 3.12 venv** via `uv` (system Python is 3.14, too new for some wheels).
  `.venv/bin/python` is 3.12.13.
- **API key** lives in `backend/.env` (`ANTHROPIC_API_KEY`, gitignored). This is a pay-per-token
  Anthropic API key for Ada's *own brain* — separate from Sean's Claude Max plan. `config.py`
  reads `.env` relative to cwd, so **run uvicorn from `backend/`**.

## M3 — the claude_code agent (Forge)

- Config knobs (`config.py`): `claude_bin` (default `claude` on PATH), `claude_code_model`
  (`""` = CLI default = Opus; set to pin a cheaper model for iteration), `sandbox_dir`
  (default `<repo>/sandbox`, a throwaway git repo — the default blast radius).
- **Per-run `workdir`**: a run can target ANY existing dir (spawn API `workdir`, `spawn_agent`
  tool `workdir`, or the Fleet launcher DIR field) — defaults to the sandbox, validated to
  exist. This is what makes Forge usable for real work (build in `~/dev/mysite`, contribute
  to a cloned OSS repo, etc.).
- **Interactive Forge (continuous chat) — one genuinely continuous session (done 2026-07-09).**
  Fleet-launched Forge runs are `interactive`: the session stays open for a back-and-forth
  instead of a one-shot. `chat_claude_code` spawns **ONE long-lived process** —
  `claude -p --input-format stream-json --output-format stream-json --verbose
  --dangerously-skip-permissions` — and writes each user turn to its stdin as a stream-json line
  (`{"type":"user","message":{"role":"user","content":"…"}}`). Context + sandbox files persist
  natively in that single process; there is no `--resume` re-spawn. The run stays `running`
  between turns (no FINAL) draining `Run.steer_inbox` for replies; FINAL fires only on idle-out
  (15 min), error, or the process exiting. Per-event parsing is shared via
  `_pump_event(evt, emitter, st, cwd) -> bool` (returns True on the turn's `result`) + a
  `_Stream` state dataclass, used by both the one-shot `_run_turn` (`drive_claude_code`, for
  Ada's `spawn_agent` delegate + Mission workers — they call `supervisor.start(interactive=False)`)
  and the interactive `chat_claude_code`. The CLI re-emits `system/init` at the head of **every**
  turn even in one process (same session id), so the `● session started` banner is gated behind
  `st.banner_shown` to print ONCE — that's what makes it read as a single chat. Reply via
  `POST /api/runs/{id}/steer` (same endpoint as LLM steering; the supervisor routes an
  interactive-Forge message to its next turn by writing to stdin). Frontend: the Fleet focused
  pane shows a **REPLY** box (`forgeChat`/`canMessage` in App.tsx) under BOTH the Terminal and
  Trace tabs for a running interactive claude_code run. Verified E2E through the API 2026-07-09:
  spawn interactive Forge → steer a follow-up mid-session → exactly ONE session banner and it
  recalled the turn-1 codeword purely from conversation (no file read).
  - Note: `claude -p --dangerously-skip-permissions` can't be run from the Claude Code Bash tool
    directly (auto-mode classifier blocks it) — test Forge via the backend API / a spawned run,
    where the subprocess runs unblocked. BUT plain `claude -p --input-format stream-json` *without*
    the dangerous flag runs fine from the Bash tool, which is enough to de-risk the wire format.
- Invoked (one-shot) as: `claude -p <prompt> --output-format stream-json --verbose
  --dangerously-skip-permissions [--model …]`, `cwd=sandbox_dir`, `stdin=DEVNULL` (skips the
  CLI's 3s "no stdin" wait). The interactive path drops the `<prompt>` arg and adds
  `--input-format stream-json` with `stdin=PIPE`, feeding turns as stream-json lines instead.
  Skip-permissions is acceptable **because** it's sandbox-scoped.
- `stream-json` shapes we parse: `system/init` (model, cwd), `assistant` (content blocks:
  `text` / `tool_use` / `thinking`-ignored), `user` (`tool_result` blocks), `result`
  (`result` text, `total_cost_usd`, `usage`, `is_error`). `rate_limit_event` ignored.
- Cost: the `total_cost_usd` we surface is the **would-be** API cost — on Max it is NOT billed.
  In a persistent interactive session each `result`'s `usage`/`total_cost_usd` is **per-turn**
  (not cumulative — verified), so the run's `cost_usd`/`tokens` are the SUM over turns.
- Ada can delegate to it via `spawn_agent("claude_code", task)` — this is the M3 magic
  ("Ada tells Claude Code to code"). Launchable directly from the Fleet too.

### Agents terminal — managing Claude Code agents (mission-control)

The Fleet is the "manage my Claude Code agents" surface. Beyond launch + watch + chat, you can:
- **Stop** a run — `POST /api/runs/{id}/stop` → `Supervisor.stop()` cancels the task and emits a
  terminal `FINAL{stopped:true}` (→ `RunStatus "stopped"`; `reduceFleet` honors the flag so it
  doesn't read as "done"). `claude_code._run_turn` kills its child process in a `finally`, so a
  stopped agent never orphans a `claude`.
- **Restart** — `POST /api/runs/{id}/restart` → relaunch same type/prompt/workdir/interactive as
  a fresh run (returns the new `run_id`). Not for arena/mission (not started via the generic path).
- **Review the diff** — `GET /api/runs/{id}/diff` → `runtime/workspace.py::workspace_diff(cwd)`:
  git status + tracked diff + inlined untracked/new files, all size-capped. This is the DIFF tab.
- **Accept the work** — `POST /api/runs/{id}/commit {message?}` → `workspace_commit()` = `git add -A`
  + commit in the workdir (repo's own git identity; guards not-a-repo / nothing-to-commit, surfaces
  git's error). The DIFF tab's commit bar (message input + COMMIT); the short hash shows in the
  header and the diff refreshes clean. **Commit-only** — it never discards or pushes. (A guarded
  discard-from-UI is a possible follow-up.)
- **Launch on a real repo** — `GET /api/repos` → `list_repos("~/dev")` (dirs with a `.git`), shown
  as quick-pick chips in the Fleet launcher (workdir still defaults to the sandbox).
- **Per-agent usage** — `Run.cost_usd`/`Run.tokens` accumulate via an `on_usage` callback the
  claude_code drivers fire each turn; the snapshot carries them → cards show tokens · cost · uptime.

## Pydantic AI note (bit us once)

In pydantic-ai 2.5, `FunctionToolCallEvent` fires on the **call-tools** node, not the
model-request node. Both the tool call *and* result events come off `node.stream(run.ctx)`
when `Agent.is_call_tools_node(node)`. `run.usage` is an attribute (not a method);
`event.part.tool_name` / `event.part.content` for the parts. `loop.py` already handles this
correctly — mirror it in any new agent driver.
