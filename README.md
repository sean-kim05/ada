# Ada

Personal agent cockpit. Runs agents (starting with a secretary), and it's where you watch
them work. See `ARCHITECTURE.md` for the design and `ROADMAP.md` for the build plan.

## Stack

FastAPI + Pydantic AI (agent loop) · React/TS/Vite (dashboard) · Postgres/Redis/Qdrant
(Docker) · Claude (orchestrator) + Qwen-14B local via Ollama (cheap subtasks).

## Run it (dev)

**1. Start the stateful services** (leave running):

```bash
docker compose up -d
```

**2. Backend** — in `backend/`:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then paste your ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
```

**3. Frontend** — in `frontend/`:

```bash
npm install
npm run dev                 # http://localhost:5173
```

Open the dashboard, type a request (e.g. *"add a task to prep for the Joby panel, then
list my tasks"*), and watch the trace panel stream Ada's steps live.

**CLI trace** (same event stream, terminal-side) — in `backend/` with the venv active
and the backend running:

```bash
python cli.py "what tasks do I have?"
```

## Optional: local model

Install Ollama, then `ollama pull qwen2.5:14b`. Call `local_complete()` from inside a
tool to route cheap work to the 5080 instead of Claude. Wired but not yet used in M1.

## Where things live

- `backend/app/runtime/` — the event schema + bus + supervisor (the spine)
- `backend/app/agents/` — Ada agent + model router
- `backend/app/tools/` — tools (Tasks now; Calendar/Gmail/etc. drop in here)
- `frontend/src/App.tsx` — the command-deck dashboard
- `frontend/src/lib/ada.ts` — WebSocket client + event types

## Next

You're at **Milestone 1**. Next steps, in order: swap Tasks to Postgres, add the Calendar
tool, add Gmail. Then M2 (multiple agents + Fleet view). See `ROADMAP.md`.
