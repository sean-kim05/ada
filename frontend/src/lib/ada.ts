// Mirror of the backend AgentEvent. Keep in sync with runtime/events.py.

export type EventType =
  | "plan"
  | "tool_call"
  | "tool_result"
  | "message"
  | "log"
  | "final"
  | "error";

export interface AgentEvent {
  run_id: string;
  agent_id: string;
  seq: number;
  type: EventType;
  payload: Record<string, unknown>;
  model: string | null;
  latency_ms: number | null;
  tokens: number | null;
  cost_usd: number | null;
  ts: number;
}

export type RunStatus = "running" | "done" | "error" | "stopped";

export interface AgentType {
  type: string;
  name: string;
  blurb: string;
  accent: string;
}

export interface RunSnapshot {
  run_id: string;
  agent_type: string;
  agent_id: string;
  name: string;
  prompt: string;
  status: RunStatus;
  started_at: number;
  workdir?: string | null;
  interactive?: boolean; // claude_code: session stays open for a continuous chat
  cost_usd?: number; // accumulated would-be cost across the run's turns
  tokens?: number; // accumulated tokens across the run's turns
}

// The fleet feed carries two kinds of messages: a roster entry (a run), or an
// event tagged with the run it belongs to.
export type FleetMsg =
  | ({ kind: "run" } & RunSnapshot)
  | ({ kind: "event"; run?: RunSnapshot } & AgentEvent);

const API = "http://127.0.0.1:8000";
const WS = "ws://127.0.0.1:8000";

// Start a secretary (Ada) run and stream its events. Resolves when the run ends. `onStart`
// fires with the run id the moment the run begins — hold onto it to steer the run live
// (see steerRun) while it's still working.
export async function startRun(
  message: string,
  onEvent: (e: AgentEvent) => void,
  onStart?: (runId: string) => void,
): Promise<void> {
  const resp = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const { run_id } = await resp.json();
  onStart?.(run_id);

  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/api/runs/${run_id}/ws`);
    ws.onmessage = (msg) => {
      const event: AgentEvent = JSON.parse(msg.data);
      onEvent(event);
      if (event.type === "final" || event.type === "error") {
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => resolve();
  });
}

// Send a message to a RUNNING agent — steer it mid-task. The agent picks it up at its next
// step and adapts. Returns { delivered } — false if the run already finished or can't be
// steered live (e.g. a claude_code subprocess).
export async function steerRun(runId: string, text: string): Promise<{ delivered: boolean; reason?: string }> {
  const r = await fetch(`${API}/api/runs/${runId}/steer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return r.json();
}

// Kill a running agent. Returns { stopped } — false if it already finished.
export async function stopRun(runId: string): Promise<{ stopped: boolean; reason?: string }> {
  const r = await fetch(`${API}/api/runs/${runId}/stop`, { method: "POST" });
  return r.json();
}

// Relaunch an agent with the same task/workdir as a fresh run. Returns the new run id.
export async function restartRun(runId: string): Promise<{ run_id?: string; error?: string }> {
  const r = await fetch(`${API}/api/runs/${runId}/restart`, { method: "POST" });
  return r.json();
}

// What a coding agent changed in its working directory (git diff of the run's workdir).
export interface DiffFile {
  path: string;
  status: string; // git porcelain code: M, A, D, ??, R…
}
export interface RunDiff {
  dir?: string;
  is_git: boolean;
  files: DiffFile[];
  diff: string;
  truncated?: boolean;
  error?: string;
}
export async function getRunDiff(runId: string): Promise<RunDiff> {
  const r = await fetch(`${API}/api/runs/${runId}/diff`);
  return r.json();
}

// Accept an agent's work — commit everything in its workdir. Returns the new commit's short hash.
export interface CommitResult {
  committed: boolean;
  hash?: string;
  message?: string;
  total_commits?: string;
  error?: string;
}
export async function commitRun(runId: string, message?: string): Promise<CommitResult> {
  const r = await fetch(`${API}/api/runs/${runId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: message ?? null }),
  });
  return r.json();
}

// The user's real git repos — quick-launch targets for a coding agent.
export interface Repo {
  name: string;
  path: string;
}
export async function listRepos(): Promise<Repo[]> {
  const r = await fetch(`${API}/api/repos`);
  return r.json();
}

// The agent types the runtime can launch (for the Fleet launcher).
export async function listAgents(): Promise<AgentType[]> {
  const r = await fetch(`${API}/api/agents`);
  return r.json();
}

// Launch any agent type on a prompt. Returns the new run id. `workdir` (optional) is the
// directory a claude_code agent works in — defaults to the sandbox on the backend.
export async function spawnAgent(agentType: string, prompt: string, workdir?: string): Promise<string> {
  const r = await fetch(`${API}/api/agents/spawn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: agentType, prompt, workdir: workdir || null }),
  });
  const j = await r.json();
  return j.run_id;
}

// ── Tasks (real, Postgres-backed) ─────────────────────────
// The same store the secretary's task tools write to — so a task Ada adds in chat
// shows up in the deck's To-do panel, and vice-versa.
export interface Task {
  id: string;
  title: string;
  due: string | null;
  done: boolean;
  created: string;
}

export async function listTasks(): Promise<Task[]> {
  const r = await fetch(`${API}/api/tasks`);
  return r.json();
}

export async function addTask(title: string, due?: string): Promise<Task> {
  const r = await fetch(`${API}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, due: due ?? null }),
  });
  return r.json();
}

export async function setTaskDone(id: string, done: boolean): Promise<Task> {
  const r = await fetch(`${API}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  return r.json();
}

// ── Calendar (real Google Calendar) ───────────────────────
export interface CalEvent {
  id: string;
  title: string;
  start: string; // RFC3339 datetime, or ISO date for all-day
  end: string;
  all_day: boolean;
  location: string | null;
  attendees: string[];
  link: string | null;
}
export interface CalState {
  authorized: boolean;
  needs_auth?: boolean;
  error?: string;
  events: CalEvent[];
}

// Fetch the day's real events. `authorized:false` → deck shows a "connect Google" state.
export async function getCalendar(day?: string): Promise<CalState> {
  const r = await fetch(`${API}/api/calendar/events${day ? `?day=${day}` : ""}`);
  return r.json();
}

// Create a calendar event. start/end are RFC3339 with offset.
export async function addCalendarEvent(title: string, start: string, end: string, attendees?: string[]): Promise<{ authorized: boolean; error?: string; event: CalEvent | null }> {
  const r = await fetch(`${API}/api/calendar/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, start, end, attendees: attendees ?? null }),
  });
  return r.json();
}

// ── Gmail (real Gmail, read-only) ─────────────────────────
export interface GmailMsg {
  id: string;
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  important: boolean;
  starred: boolean;
  body?: string; // present only on a single-message fetch
}
export interface GmailOverview {
  authorized: boolean;
  needs_auth?: boolean;
  error?: string;
  unread: number;
  important: GmailMsg[];
  brief: string;
  messages: GmailMsg[];
}

// The morning brief: unread count, important threads, and a local-model summary of the inbox.
export async function getGmailOverview(): Promise<GmailOverview> {
  const r = await fetch(`${API}/api/gmail/overview`);
  return r.json();
}

// A raw message list for a Gmail search query (default the inbox).
export async function getGmailMessages(q = "in:inbox", max = 20): Promise<{ authorized: boolean; needs_auth?: boolean; error?: string; messages: GmailMsg[] }> {
  const r = await fetch(`${API}/api/gmail/messages?q=${encodeURIComponent(q)}&max=${max}`);
  return r.json();
}

// ── Long-term memory (Qdrant / RAG) ───────────────────────
export interface Memory {
  id: string;
  text: string;
  kind?: string;
  source?: string;
  created?: string;
  score?: number; // present on search results
}

export async function listMemories(): Promise<Memory[]> {
  const r = await fetch(`${API}/api/memory`);
  return r.json();
}
export async function searchMemory(q: string): Promise<Memory[]> {
  const r = await fetch(`${API}/api/memory/search?q=${encodeURIComponent(q)}`);
  return r.json();
}
export async function addMemory(text: string): Promise<Memory> {
  const r = await fetch(`${API}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return r.json();
}
export async function deleteMemory(id: string): Promise<void> {
  await fetch(`${API}/api/memory/${id}`, { method: "DELETE" });
}

// ── Model router (local Qwen vs cloud Claude) ─────────────
// Ada pushes cheap subtasks (summarize/classify) to the free local model on the 5080;
// the router records each call so the split — and the $ saved — is visible here.
export interface RouterCall {
  kind: string;
  where: "local" | "cloud";
  model: string;
  prompt_chars: number;
  output_chars: number;
  latency_ms: number;
  cost_usd: number;
  saved_usd: number;
  ts: number;
}
export interface RouterStats {
  local_model: string;
  cloud_model: string;
  total_calls: number;
  local_calls: number;
  cloud_calls: number;
  cost_usd: number;
  saved_usd: number;
  local_avg_ms: number;
  cloud_avg_ms: number;
  recent: RouterCall[];
}
export interface RouterHealth {
  reachable: boolean;
  ready: boolean;
  target: string;
  models?: string[];
  error?: string;
}

export async function getRouterStats(): Promise<RouterStats> {
  const r = await fetch(`${API}/api/router/stats`);
  return r.json();
}
export async function getRouterHealth(): Promise<RouterHealth> {
  const r = await fetch(`${API}/api/router/health`);
  return r.json();
}

// Open the fleet feed — every agent's activity on one socket. Returns a close fn.
export function openFleet(onMsg: (m: FleetMsg) => void): () => void {
  const ws = new WebSocket(`${WS}/api/fleet/ws`);
  ws.onmessage = (msg) => onMsg(JSON.parse(msg.data));
  return () => ws.close();
}

// One message in an Arena run (agent -> agent).
export interface ArenaMsg {
  from: string;
  to: string;
  from_type: string;
  to_type: string;
  text: string;
}

// Start an Arena — two agents talk. Streams a MESSAGE per turn; resolves when done.
export async function startArena(
  topic: string,
  agentA: string,
  agentB: string,
  rounds: number,
  onMsg: (m: ArenaMsg) => void,
): Promise<void> {
  const resp = await fetch(`${API}/api/arena`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, agent_a: agentA, agent_b: agentB, rounds }),
  });
  const { run_id } = await resp.json();
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/api/runs/${run_id}/ws`);
    ws.onmessage = (msg) => {
      const e: AgentEvent = JSON.parse(msg.data);
      if (e.type === "message") onMsg(e.payload as unknown as ArenaMsg);
      if (e.type === "final" || e.type === "error") {
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => resolve();
  });
}

// Start a Mission — a planner decomposes `goal` and delegates to worker sub-runs. Streams
// every event of the mission run (plan, message handoffs, final synthesis). Resolves at end.
export async function startMission(
  goal: string,
  workerType: string,
  maxTasks: number,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const resp = await fetch(`${API}/api/mission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, worker_type: workerType, max_tasks: maxTasks }),
  });
  const { run_id } = await resp.json();
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/api/runs/${run_id}/ws`);
    ws.onmessage = (msg) => {
      const e: AgentEvent = JSON.parse(msg.data);
      onEvent(e);
      if (e.type === "final" || e.type === "error") {
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => resolve();
  });
}
