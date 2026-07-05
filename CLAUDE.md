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

Both run on Haiku today. Deck's Calendar / To-do / Reminders are still **demo data** (M1 tail).

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

- `agents/loop.py` — generic `drive(agent, prompt, emitter)` loop used by **every** agent.
- `agents/registry.py` — `SPECS` (personas + tools): `ada`/Ada (secretary + `spawn_agent`),
  `researcher`/Scout (`web_search` + `save_note`), `planner`/Atlas (task tools). `build(type)`
  makes a fresh agent.
- `tools/` — `spawn.py` (`spawn_agent`, late-imports supervisor to dodge a cycle),
  `research.py` (`web_search` **STUB** + `save_note`), `tasks.py`.
- `runtime/supervisor.py` — `Supervisor.start(type, prompt)` launches concurrent runs;
  `Run.snapshot()`; `start_ada()` = the chat entrypoint.
- `runtime/bus.py` — Redis pub/sub; `subscribe_all()` (psubscribe `ada:run:*`) = the fleet feed.
- `runtime/events.py` — `AgentEvent` schema (keep `frontend/src/lib/ada.ts` in sync).
- `routers/chat.py` — `POST /api/chat` (secretary), `POST /api/agents/spawn`, `GET /api/agents`,
  `GET /api/runs`, `WS /api/runs/{id}/ws` (one run), `WS /api/fleet/ws` (all runs).
- `agents/ada.py` — **DEAD** (superseded by loop + registry); safe to delete.

## Frontend

- `src/lib/ada.ts` — API/WS client: `startRun`, `spawnAgent`, `listAgents`, `openFleet`.
  Mirrors the backend `AgentEvent` — keep the two in sync.
- `src/App.tsx` — view switch (deck ↔ fleet), always-on fleet feed, `FleetView`/`FleetCard`.
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

## Pydantic AI note (bit us once)

In pydantic-ai 2.5, `FunctionToolCallEvent` fires on the **call-tools** node, not the
model-request node. Both the tool call *and* result events come off `node.stream(run.ctx)`
when `Agent.is_call_tools_node(node)`. `run.usage` is an attribute (not a method);
`event.part.tool_name` / `event.part.content` for the parts. `loop.py` already handles this
correctly — mirror it in any new agent driver.
