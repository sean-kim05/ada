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

export type RunStatus = "running" | "done" | "error";

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
}

// The fleet feed carries two kinds of messages: a roster entry (a run), or an
// event tagged with the run it belongs to.
export type FleetMsg =
  | ({ kind: "run" } & RunSnapshot)
  | ({ kind: "event"; run?: RunSnapshot } & AgentEvent);

const API = "http://127.0.0.1:8000";
const WS = "ws://127.0.0.1:8000";

// Start a secretary (Ada) run and stream its events. Resolves when the run ends.
export async function startRun(
  message: string,
  onEvent: (e: AgentEvent) => void
): Promise<void> {
  const resp = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const { run_id } = await resp.json();

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

// Open the fleet feed — every agent's activity on one socket. Returns a close fn.
export function openFleet(onMsg: (m: FleetMsg) => void): () => void {
  const ws = new WebSocket(`${WS}/api/fleet/ws`);
  ws.onmessage = (msg) => onMsg(JSON.parse(msg.data));
  return () => ws.close();
}
