# Ada — Build Roadmap

Each milestone is a place you can stop and still have a whole, useful tool. Build in
order; don't start a milestone until the previous one actually works end to end.

---

## Phase 0 — Skeleton  ✅ (scaffolded)

Docker Compose (Postgres/Redis/Qdrant), FastAPI backend, React frontend, WebSocket
wiring, the event-bus foundation. Goal: `docker compose up` + two dev commands → an
empty but running Ada, health checks green, a test event flows backend → dashboard.

**Done when:** you can send a message in the UI and see a hard-coded event appear in the
trace panel over WebSocket.

---

## Milestone 1 — One agent, fully observable  ← START HERE

The secretary loop (Ada) running for real, emitting events, with the dashboard showing
its live trace and the CLI showing the same.

- Pydantic AI agent + Claude, plan→act→observe loop.
- Event emission wired into the loop (every step → AgentEvent → bus).
- Tools: **Tasks** (own DB, no external auth) first, then **Calendar**, then **Gmail**.
- Memory: Redis short-term.
- Trace panel (card view) + `rich` CLI trace both consuming the live stream.

**Stop-here value:** a working AI secretary with great observability. Genuinely usable.

---

## Milestone 2 — Multiple agents at once + Fleet view

Run more than one agent concurrently; see them all.

- Supervisor: launch N runs as async tasks, track status.
- `spawn_agent` capability (Ada can kick off a background agent).
- **Fleet** panel: one live card per running agent (status, current step, cost).
- Qdrant long-term memory + RAG tool lands here (Docs tab).

**Stop-here value:** "multi-agent" — launch a research agent while the secretary runs.

---

## Milestone 3 — Claude Code as an agent + real terminal (A + B)

Ada can delegate coding work, and you watch it happen.

- `claude_code` agent type: invoke Claude Code headless as a subprocess against a repo.
- Stream its stdout as `log` events.
- **Terminal** panel (xterm.js) renders the raw output — real Claude Code work, live.
- Embedded terminal is localhost-only (see ARCHITECTURE security notes).

**Stop-here value:** Ada orchestrates real software engineering; you supervise from the deck.

---

## Milestone 4 — The Arena (toy first)

Watch two agents talk. Bolt-on visualizer over the `message` event type.

- A sandbox run that spins up two agents with a shared conversation (debate / negotiate /
  plan a thing together).
- **Arena** panel: message-flow viz (A ⇄ B), messages animating between them.
- Independent of core secretary work — pure observability over `message` events.

**Stop-here value:** the fun visual + it proves the message-passing plumbing for M5.

---

## Milestone 5 — Real multi-agent collaboration

The finale: a planner agent decomposes a task and delegates to specialized sub-agents,
and the Arena/Fleet show the real handoffs.

- Planner run → `spawn_agent` for sub-tasks (e.g. calendar-agent + email-agent).
- Sub-agents report back; planner synthesizes.
- Arena visualizes the *real* collaboration, not a toy.

**Stop-here value:** a genuine multi-agent control plane.

---

## Later / optional integrations layer

Each is one tool, drop-in once the M1 tool interface exists:

- **GitHub** tool (PRs, issues, notifications) — high daily value.
- **Slack** tool + optional Slack bot front-end (text Ada from your phone).
- **Discord** tool + optional Discord bot front-end.
- **DSA tracking** — read your tracker spreadsheet or LeetCode's unofficial API (NeetCode
  has no API; don't scrape it).

---

## Guardrails

- Don't spec ahead. Finish M1 before touching M2.
- Every tool is: a schema + auth + a function. Once the registry exists, adds are hours.
- One finished milestone beats two half-built ones.
