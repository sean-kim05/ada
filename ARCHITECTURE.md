# Ada — Architecture

Ada is a personal agent cockpit. It runs one or more agents, and it's the place you
watch them work. The secretary features (calendar, email, tasks, RAG, reminders) are
*one agent*. The system underneath is a runtime + an observability layer, and every
agent — the secretary, a Claude Code worker, a sub-agent in a multi-agent task — is the
same abstraction: **something that emits events.**

Build that abstraction once. Everything else is a view over the event stream.

## Two systems

### 1. Agent Runtime — runs agents

- Runs Ada's own loop (the secretary).
- Runs **multiple agents concurrently**, each on its own task.
- Can invoke **Claude Code** as an agent type (delegates real coding work).
- Agents can **message each other** (arena → real multi-agent).

### 2. Observability Layer — lets you see them

- Every agent emits the same structured event stream (plan / act / observe / message /
  log / done).
- Dashboard shows **each running agent as a live panel** — status, current step,
  progress, latency, cost.
- **Terminal view** shows raw agent output, including Claude Code's actual terminal work.
- **Arena** visualizes agents communicating.

## The event — the whole thing hinges on this

Every agent, whatever it is, emits events with this shape. One schema, three consumers
(CLI, dashboard over WebSocket, Postgres for replay).

```
AgentEvent {
  run_id:    str          # which run this belongs to
  agent_id:  str          # which agent emitted it (ada-core, claude-code-1, research-2)
  seq:       int          # ordering within the run
  type:      "plan" | "tool_call" | "tool_result" | "message" | "log" | "final" | "error"
  payload:   dict         # type-specific: tool name+input, message text, log line, etc.
  model:     str | None   # "claude" | "qwen-14b-local" | None
  latency_ms: int | None
  tokens:    int | None
  cost_usd:  float | None
  ts:        float
}
```

- `message` events (agent → agent) are what the Arena renders.
- `log` events carry raw stdout (e.g. Claude Code's terminal lines) → the Terminal view.
- Everything else drives the Trace / Fleet panels.

## Flow

```
                        ┌─────────────────────────────────────┐
                        │            Agent Runtime            │
   React dashboard      │                                     │
   (Fleet/Trace/Term/   │   ┌─────────┐   ┌──────────────┐    │
    Arena/Chat/Cal/     │   │ ada-core│   │ claude-code  │    │
    Tasks/Docs)         │   │ (secre- │   │  worker      │ …  │
        ▲               │   │  tary)  │   └──────────────┘    │
        │ WebSocket     │   └─────────┘         …             │
        │               │        │    all emit AgentEvent     │
   ┌────┴─────┐         │        ▼                            │
   │ FastAPI  │◄────────┤   ┌─────────────┐                   │
   │          │  events │   │  Event Bus  │ (Redis pub/sub)   │
   └────┬─────┘         │   └──────┬──────┘                   │
        │               └──────────┼──────────────────────────┘
        │                          │
   ┌────┴────┐   fan-out   ┌───────┼────────┬──────────────┐
   │ Postgres│◄────────────┤   WebSocket    │   rich CLI   │
   │ (replay)│             │  → dashboard   │  (live trace)│
   └─────────┘             └────────────────┴──────────────┘

   Tools (per agent): calendar, gmail, tasks, rag, reminders,
                      github, slack, discord, claude_code, spawn_agent
   Model router:      claude (plan/reason) | qwen-14b local (classify/summarize/embed)
   Memory:            Redis (short-term) | Qdrant (long-term + RAG)
```

## Stack

- **Backend:** FastAPI (async), Python 3.11+
- **Agent framework:** Pydantic AI for the agent loop + tool calling (typed, provider-
  agnostic, minimal). Hand-rolled: the runtime (concurrent agent supervision), the event
  bus, the observability layer. Framework does the solved part; we own the part that's Ada.
- **Models:** Anthropic SDK (Claude) + Ollama (Qwen-14B local on the 5080), behind a router.
- **State:** PostgreSQL (tasks, run/event history), Redis (short-term memory, event
  pub/sub, reminder queue), Qdrant (vectors: long-term memory + RAG).
- **Frontend:** React + TypeScript + Vite. WebSocket for live events. xterm.js for the
  Terminal view. Command-deck aesthetic (dark, amber accent, mono/sans contrast).
- **Infra:** Docker Compose (Postgres + Redis + Qdrant now; full containerization for deploy).

## Runtime model

- A **Run** = one task given to one agent (has a `run_id`, a status, an event stream).
- The **Supervisor** launches runs as async tasks, tracks their status, and is where
  multi-agent orchestration lives (a planner run can `spawn_agent` → child runs).
- Concurrency: `asyncio` tasks for I/O-bound agent work (Claude/tool calls). Claude Code
  workers run as subprocesses; their stdout is streamed as `log` events.
- The **Event Bus** is Redis pub/sub keyed by `run_id`; the WebSocket layer subscribes
  and forwards to connected dashboard clients; a writer subscribes and persists to Postgres.

## Security notes (this is a local-first personal tool)

- The embedded terminal + Claude Code invocation mean Ada can run commands on your
  machine. **Ada binds to localhost only. Do not expose it publicly** without an auth
  layer + sandboxing. This is fine for a daily-driver on your own box; it's the one thing
  that would need real work before any public deployment.
- OAuth tokens (Google, GitHub, Slack) live in `.env` / a local secrets store, never in
  the repo.
