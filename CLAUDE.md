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
- Every persona has a distinct **identity** (glyph + colour): Ada=amber spark, Scout=cyan
  lens, Atlas=violet checklist, Forge=green code-brackets — surfaced in Fleet/Arena/launcher.

M1/M2 brains run on Haiku; M3 runs the `claude` CLI's default model (Opus). Deck's
Calendar / To-do / Reminders are still **demo data** (M1 tail).

## Run it

Stateful services run in Docker; backend + frontend run on the host during dev.

```sh
# 1. services (see Docker gotcha below re: docker.exe)
docker compose up -d               # from repo root — Postgres :5432, Redis :6379, Qdrant :6333

# 2. backend  — NOTE: no --reload (see gotcha), run from backend/ so .env loads
cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. frontend
cd frontend && npm run dev         # → http://localhost:5173
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
  to a cloned OSS repo, etc.). Runs one-shot today; session-resume for follow-ups is TODO.
- Invoked as: `claude -p <prompt> --output-format stream-json --verbose
  --dangerously-skip-permissions [--model …]`, `cwd=sandbox_dir`, `stdin=DEVNULL` (skips the
  CLI's 3s "no stdin" wait). Skip-permissions is acceptable **because** it's sandbox-scoped.
- `stream-json` shapes we parse: `system/init` (model, cwd), `assistant` (content blocks:
  `text` / `tool_use` / `thinking`-ignored), `user` (`tool_result` blocks), `result`
  (`result` text, `total_cost_usd`, `usage`, `is_error`). `rate_limit_event` ignored.
- Cost: the `total_cost_usd` we surface is the **would-be** API cost — on Max it is NOT billed.
- Ada can delegate to it via `spawn_agent("claude_code", task)` — this is the M3 magic
  ("Ada tells Claude Code to code"). Launchable directly from the Fleet too.

## Pydantic AI note (bit us once)

In pydantic-ai 2.5, `FunctionToolCallEvent` fires on the **call-tools** node, not the
model-request node. Both the tool call *and* result events come off `node.stream(run.ctx)`
when `Agent.is_call_tools_node(node)`. `run.usage` is an attribute (not a method);
`event.part.tool_name` / `event.part.content` for the parts. `loop.py` already handles this
correctly — mirror it in any new agent driver.
