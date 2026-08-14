import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  startRun,
  steerRun,
  stopRun,
  restartRun,
  getRunDiff,
  commitRun,
  listRepos,
  spawnAgent,
  listAgents,
  openFleet,
  startArena,
  startMission,
  listTasks,
  addTask,
  setTaskDone,
  getCalendar,
  listMemories,
  searchMemory,
  addMemory,
  deleteMemory,
  getRouterStats,
  getRouterHealth,
  type Task,
  type CalState,
  type Memory,
  type RouterStats,
  type RouterHealth,
  type AgentEvent,
  type AgentType,
  type RunSnapshot,
  type RunStatus,
  type RunDiff,
  type Repo,
  type FleetMsg,
  type ArenaMsg,
} from "./lib/ada";
import {
  panel as panelBase,
  phead as pheadBase,
  mono,
  text,
  btn,
  input as inputStyle,
  tag,
  dot,
  surface2,
  well,
  overlay,
  scroller,
  shrinkable,
  laneHue,
  type AgentState,
} from "./styleHelpers";
import { PixelAgent, AgentBadge } from "./PixelAgent";
import { CREW, BENCH } from "./sprites";
import { buildTimeline, type RawEvent } from "./traceSpans";

interface ChatMsg {
  role: "user" | "ada";
  text: string;
  time: string;
}

// One agent's live state on the Fleet, accumulated from the fleet feed.
interface FleetRun {
  meta: RunSnapshot | null;
  events: AgentEvent[];
  status: RunStatus;
  tools: number;
  lastStep: string;
}

/* ── style helpers ─────────────────────────── */
// Token-based panel/phead (from styleHelpers) composed with the structural props
// existing call sites rely on — flex column for panels, spread header for pheads.
// Individual headers migrate to the new title→pill→gap→meta order in later phases.
const panel: CSSProperties = { ...panelBase, display: "flex", flexDirection: "column", minWidth: 0 };
const phead: CSSProperties = { ...pheadBase, justifyContent: "space-between" };
const modelBadge: CSSProperties = {
  ...mono(9.5, "var(--text-dim)", ".06em"),
  border: "1px solid var(--line-2)",
  borderRadius: 5,
  padding: "2px 7px",
};
function tagStyle(kind?: "accent" | "error"): CSSProperties {
  const base: CSSProperties = {
    ...mono(9.5, "var(--text-dim)", ".1em"),
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 5,
    border: "1px solid var(--line-2)",
  };
  if (kind === "accent")
    return { ...base, color: "var(--accent)", borderColor: "rgba(var(--accent-rgb),.3)", background: "rgba(var(--accent-rgb),.08)" };
  if (kind === "error")
    return { ...base, color: "var(--red)", borderColor: "rgba(255,138,128,.35)", background: "rgba(255,138,128,.08)" };
  return base;
}

/* ── icons ─────────────────────────────────── */
const ICONS: Record<string, JSX.Element> = {
  Fleet: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  Chat: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="3" />
      <path d="M8 21v-4" />
    </>
  ),
  "Agent Trace": (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M6 8v8M10 6h9M10 18h6M10 12h11" />
    </>
  ),
  Calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </>
  ),
  Tasks: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <path d="M14 6.5l2 2 4-4M4 15h16M4 20h11" />
    </>
  ),
  Docs: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </>
  ),
  Arena: (
    <>
      <circle cx="7" cy="12" r="3.4" />
      <circle cx="17" cy="12" r="3.4" />
      <path d="M10.4 12h3.2" />
    </>
  ),
  Router: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 12l6-4.5a3 3 0 011.8-.6h2.4M7 12l6 4.5a3 3 0 001.8.6h2.4" />
    </>
  ),
  Mission: (
    <>
      <path d="M5 21V4h11l-2 3.5L16 11H5" />
      <circle cx="5" cy="21" r="0.6" />
    </>
  ),
};
const NavIcon = ({ name }: { name: string }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name]}
  </svg>
);

// Per-agent identity: a distinct glyph + colour for each persona.
const AGENT_ICONS: Record<string, JSX.Element> = {
  ada: <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z" />,
  researcher: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </>
  ),
  planner: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4.5 6l1.1 1.1L7.5 4.6M4.5 12l1.1 1.1L7.5 10.6M4.5 18l1.1 1.1L7.5 16.6" />
    </>
  ),
  claude_code: (
    <>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
      <path d="M13 6l-2 12" />
    </>
  ),
  arena: (
    <>
      <circle cx="7" cy="12" r="3.4" />
      <circle cx="17" cy="12" r="3.4" />
      <path d="M10.4 12h3.2" />
    </>
  ),
};
function AgentGlyph({ type, size = 16 }: { type?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {AGENT_ICONS[type ?? ""] ?? AGENT_ICONS.ada}
    </svg>
  );
}
function typeColor(type?: string): string {
  return type === "researcher"
    ? "#5ec7d6"
    : type === "planner"
    ? "#a68bf0"
    : type === "claude_code"
    ? "#7fd88f"
    : "var(--accent)";
}

// The crew: each agent type maps to a pixel-sprite station + a human role label.
// Ada herself keeps the punch-card mark and is never a crewmate.
function spriteFor(type?: string): string {
  switch (type) {
    case "researcher": return "astronaut"; // Scout
    case "planner": return "commander";    // Commander
    case "claude_code": return "engineer"; // Engineer
    case "arena": return "comms";          // Comms
    default: return "commander";
  }
}
function crewRole(type?: string): string {
  switch (type) {
    case "researcher": return "Scout · researcher";
    case "planner": return "Commander · planner";
    case "claude_code": return "Engineer · coder";
    case "arena": return "Comms · dialogue";
    default: return "Crew";
  }
}

// The "punch card" A — the ADA brand mark, a matrix of gold cells forming an A.
const A_BITS = [
  "...1...",
  "..1.1..",
  "..1.1..",
  ".1...1.",
  ".11111.",
  "1.....1",
  "1.....1",
];
function PunchA({ size = 22, color = "var(--accent)" }: { size?: number; color?: string }) {
  const cells: JSX.Element[] = [];
  A_BITS.forEach((row, r) =>
    [...row].forEach((c, x) => {
      if (c === "1")
        cells.push(<rect key={`${r}-${x}`} x={x + 0.13} y={r + 0.13} width={0.74} height={0.74} rx={0.17} fill={color} />);
    })
  );
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" fill="none">
      {cells}
    </svg>
  );
}

type ViewKey = "deck" | "fleet" | "arena" | "mission" | "docs" | "router";
type NavItem = { name: string; view: ViewKey; icon: string };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { name: "Chat", view: "deck", icon: "Chat" },
      { name: "Agent Trace", view: "deck", icon: "Agent Trace" },
      { name: "Fleet", view: "fleet", icon: "Fleet" },
      { name: "Arena", view: "arena", icon: "Arena" },
      { name: "Mission", view: "mission", icon: "Mission" },
    ],
  },
  {
    label: "Secretary",
    items: [
      { name: "Calendar", view: "deck", icon: "Calendar" },
      { name: "Tasks", view: "deck", icon: "Tasks" },
      { name: "Docs", view: "docs", icon: "Docs" },
    ],
  },
  {
    label: "System",
    items: [{ name: "Router", view: "router", icon: "Router" }],
  },
];

/* ── accent themes (swaps --accent-rgb at the root) ── */
const ACCENTS: { key: string; rgb: string }[] = [
  { key: "mono", rgb: "250,250,250" },
  { key: "amber", rgb: "234,158,70" },
  { key: "gold", rgb: "216,180,96" },
  { key: "coral", rgb: "233,124,92" },
  { key: "cyan", rgb: "61,214,230" },
  { key: "violet", rgb: "150,134,240" },
  { key: "emerald", rgb: "74,198,150" },
];

/* ── side-panel scaffolding — HOURS drives the Calendar day grid ── */
const HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const GREETING: ChatMsg = {
  role: "ada",
  text:
    "Morning. I'm Ada — your secretary. Ask me to manage tasks, your calendar, or email, and watch the plan run live in the trace on the right.",
  time: "",
};

const CHAT_SUGGESTIONS = [
  "What's on my calendar today?",
  "Add a task to prep the Ada demo",
  "Summarize my open tasks",
  "Research the latest local LLM releases",
];

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function App() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([GREETING]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [cal, setCal] = useState<CalState>({ authorized: false, events: [] });
  const [routerStats, setRouterStats] = useState<RouterStats | null>(null);
  const refreshTasks = () => listTasks().then(setTasks).catch(() => {});
  const refreshCal = () => getCalendar().then(setCal).catch(() => {});
  const [view, setView] = useState<"deck" | "fleet" | "arena" | "mission" | "docs" | "router">("deck");
  const [fleet, setFleet] = useState<Record<string, FleetRun>>({});
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [launchType, setLaunchType] = useState("researcher");
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [launchDir, setLaunchDir] = useState("");
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const [accent, setAccent] = useState<string>(() => localStorage.getItem("ada.accent.v2") || "amber");
  const [grid, setGrid] = useState<boolean>(() => localStorage.getItem("ada.grid") !== "0");
  const chatScroll = useRef<HTMLDivElement>(null);
  const traceScroll = useRef<HTMLDivElement>(null);

  // No accent hue any more — identity comes from the punch-card mark + type.
  // Keep --accent-rgb defined (white) so any legacy rgba(var(--accent-rgb),…) stays neutral.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent-rgb", "237,237,237");
    document.documentElement.style.setProperty("--tex-op", "0");
  }, []);

  // Autoscroll by pinning scrollTop to the bottom — never scrollIntoView (it breaks the app).
  useEffect(() => {
    const el = chatScroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, running]);
  useEffect(() => {
    const el = traceScroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  // launcher agent types + the always-on fleet feed (every agent, one socket)
  useEffect(() => {
    listAgents().then(setAgentTypes).catch(() => {});
    refreshTasks();
    refreshCal();
  }, []);
  useEffect(() => openFleet((m) => setFleet((prev) => reduceFleet(prev, m))), []);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  // Real local-vs-cloud split from the router (the offload happens inside tools, so the
  // per-run event stream can't see it — poll the router's own accounting instead).
  useEffect(() => {
    const pull = () => getRouterStats().then(setRouterStats).catch(() => {});
    pull();
    const id = setInterval(pull, 4000);
    return () => clearInterval(id);
  }, []);

  async function sendText(text: string) {
    text = text.trim();
    if (!text) return;
    // If Ada is mid-task, this message STEERS the live run instead of starting a new one —
    // she picks it up at her next step. The backend also echoes it into the trace.
    if (running && activeRunId) {
      setMsgs((m) => [...m, { role: "user", text, time: now() }]);
      setInput("");
      const r = await steerRun(activeRunId, text);
      if (!r.delivered) setMsgs((m) => [...m, { role: "ada", text: `(couldn't steer — ${r.reason ?? "run ended"})`, time: now() }]);
      return;
    }
    setMsgs((m) => [...m, { role: "user", text, time: now() }]);
    setInput("");
    setEvents([]);
    setRunning(true);
    await startRun(
      text,
      (e) => {
        setEvents((prev) => [...prev, e]);
        if (e.type === "final") setMsgs((m) => [...m, { role: "ada", text: String(e.payload.text ?? ""), time: now() }]);
        if (e.type === "error") setMsgs((m) => [...m, { role: "ada", text: `Something broke: ${e.payload.message}`, time: now() }]);
      },
      (runId) => setActiveRunId(runId),
    );
    setRunning(false);
    setActiveRunId(null);
    refreshTasks(); // Ada may have added/completed tasks via her tools — reflect it
    refreshCal(); // …or created/moved a calendar event
  }
  const replay = () => {
    const last = [...msgs].reverse().find((m) => m.role === "user");
    if (last) sendText(last.text);
  };
  const launch = async () => {
    const p = launchPrompt.trim();
    if (!p) return;
    setLaunchPrompt("");
    const id = await spawnAgent(launchType, p, launchDir.trim() || undefined);
    setFocused(id);
  };

  const t = summarize(events);
  const localPct =
    routerStats && routerStats.total_calls
      ? Math.round((routerStats.local_calls / routerStats.total_calls) * 100)
      : 0;
  const traceState: AgentState = running ? "running" : events.length ? "ok" : "idle";
  const statusLabel = running ? "Running" : events.length ? "Done" : "Ready";
  const runningCount = Object.values(fleet).filter((r) => r.status === "running").length;
  const openTasks = tasks.filter((t) => !t.done).length;
  const navCount = (name: string): number | null =>
    name === "Fleet" ? runningCount || null : name === "Tasks" ? openTasks || null : name === "Calendar" ? cal.events.length || null : null;

  return (
    <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "var(--w-sidebar) minmax(0,1fr)", minHeight: "calc(100vh / 1.5)" }}>
      {/* ═══ SIDEBAR ═══ */}
      <aside
        style={{
          position: "sticky",
          top: 0,
          height: "calc(100vh / 1.5)",
          width: "var(--w-sidebar)",
          borderRight: "1px solid var(--border)",
          background: "var(--surface-1)",
          display: "flex",
          flexDirection: "column",
          padding: "16px 12px",
        }}
      >
        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px", marginBottom: 20 }}>
          <div style={{ width: 30, height: 30, flex: "none", borderRadius: "var(--r-card)", background: "var(--surface-2)", border: "1px solid var(--border)", display: "grid", placeItems: "center" }}>
            <PunchA size={17} color="var(--text-hi)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...text("title"), lineHeight: 1.15 }}>Ada</div>
            <div style={text("caption", "var(--text-lo)")}>Agent OS Terminal</div>
          </div>
        </div>

        {/* nav — three sentence-case groups; live counts turn it into a status board */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <div style={{ ...text("caption", "var(--text-lo)"), padding: "0 8px", marginBottom: 6 }}>{g.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {g.items.map((it) => {
                  const active = view === it.view && (it.view !== "deck" || it.name === "Chat");
                  const count = navCount(it.name);
                  return (
                    <div
                      key={it.name}
                      onClick={() => setView(it.view)}
                      className={`nav-item${active ? " active" : ""}`}
                      style={{
                        height: "var(--h-navrow)",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "0 8px",
                        borderRadius: "var(--r-control)",
                        cursor: "pointer",
                        color: active ? "var(--text-hi)" : "var(--text-mid)",
                        background: active ? "var(--surface-active)" : undefined,
                      }}
                    >
                      <NavIcon name={it.icon} />
                      <span style={{ ...text("ui", "inherit") }}>{it.name}</span>
                      {count != null && <span style={{ marginLeft: "auto", ...mono(11, "var(--text-lo)") }}>{count}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* footer — two status rows, nothing else */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 8px" }}>
            <span style={text("caption", "var(--text-lo)")}>Spend today</span>
            <span style={mono(12, "var(--text-hi)")}>${t.cost.toFixed(3)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 8px" }}>
            <span style={text("caption", "var(--text-lo)")}>Local share</span>
            <span style={mono(12, "var(--text-mid)")}>{localPct}%</span>
          </div>
        </div>
      </aside>

      {/* ═══ WORKSPACE ═══ */}
      <main style={{ padding: view === "deck" ? 0 : "18px 20px 22px", display: "flex", flexDirection: "column", gap: view === "deck" ? 0 : 16, minWidth: 0 }}>
        {view === "deck" ? (
        <>
        {/* top bar — plain metadata, no chips */}
        <header style={{ height: "var(--h-topbar)", flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 20px", borderBottom: "1px solid var(--border)" }}>
          <span style={text("title")}>Chat</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...text("caption", "var(--text-lo)"), ...shrinkable }}>
            Haiku · Auto routing · {events.length ? Math.min(99, events.length * 3) : 0}% context
          </span>
          <span style={{ width: 1, height: 16, background: "var(--border)", flex: "none" }} />
          <span style={{ ...mono(11, "var(--text-lo)"), border: "1px solid var(--border)", borderRadius: "var(--r-tag)", padding: "2px 6px", flex: "none" }}>⌘K</span>
        </header>

        {/* home: conversation | rule | trace — no panels, no nested boxes */}
        <section style={{ display: "flex", height: "calc(100vh / 1.5 - var(--h-topbar))", minHeight: 520 }}>
          {/* CONVERSATION */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div ref={chatScroll} style={scroller}>
              <div style={{ maxWidth: "var(--w-measure)", margin: "0 auto", padding: "40px 32px 24px", display: "flex", flexDirection: "column", gap: 32 }}>
                {msgs.map((m, i) => (
                  <Message key={i} msg={m} serif={i === 0 && m.role === "ada"} />
                ))}
                {running && <Working />}
                {msgs.length <= 1 && !running && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 28 }}>
                    {CHAT_SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => sendText(s)} style={{ ...btn("ghost"), height: "auto", padding: "8px 12px", ...text("ui", "var(--text-mid)") }}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* composer */}
            <div style={{ flex: "none", padding: "12px 20px 18px", maxWidth: "calc(var(--w-measure) + 40px)", width: "100%", margin: "0 auto" }}>
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-bubble)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  className="bare"
                  value={input}
                  placeholder={running ? "Steer Ada while she works…" : "Message Ada…"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendText(input)}
                  style={{ ...text("body", "var(--text-hi)"), background: "transparent", width: "100%" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={text("caption", "var(--text-lo)")}>Tools · 9</span>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => sendText(input)}
                    title={running ? "Steer the running task" : "Send"}
                    style={{ width: 28, height: 28, flex: "none", borderRadius: "50%", background: "var(--action-bg)", border: "none", display: "grid", placeItems: "center", cursor: "pointer" }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--action-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h13M12 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* single vertical rule */}
          <div style={{ width: 1, background: "var(--border)", flex: "none" }} />

          {/* TRACE */}
          <div style={{ width: "var(--w-trace)", flex: "none", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ height: "var(--h-panelhead)", flex: "none", position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid var(--border)" }}>
              <span style={text("ui")}>Trace</span>
              {running && <span style={{ ...tag("running") }}><span style={dot("running", 6)} />live</span>}
              <span style={{ flex: 1 }} />
              <span style={mono(11, "var(--text-lo)")}>{events.length} steps</span>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 2 }}>
                <div style={{ height: 2, width: `${running ? Math.min(90, events.length * 12) : events.length ? 100 : 0}%`, background: running ? "var(--state-running)" : "var(--state-ok)", transition: "width var(--t-arrive)" }} />
              </div>
            </div>
            <div ref={traceScroll} style={{ ...scroller, padding: "8px 0" }}>
              {events.length === 0 ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: "40px 24px" }}>
                  <div style={{ opacity: 0.4 }}><PunchA size={30} color="var(--text-hi)" /></div>
                  <div style={text("title")}>No active run</div>
                  <div style={{ ...text("caption", "var(--text-lo)"), maxWidth: 230 }}>Send a message and each step — plan, act, observe — appears here.</div>
                </div>
              ) : (
                events.map((e, i) => (
                  <TraceRow key={i} e={e} last={i === events.length - 1} active={running && i === events.length - 1} />
                ))
              )}
            </div>
            <div style={{ height: "var(--h-panelhead)", flex: "none", borderTop: "1px solid var(--border)", padding: "0 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...text("caption", "var(--text-lo)") }}>
                <span style={dot(traceState, 6)} />
                {statusLabel}
              </span>
              <span style={{ flex: 1 }} />
              <span style={mono(11, "var(--text-lo)")}>{fmtMs(t.timeMs)}</span>
              <span style={mono(12, "var(--text-hi)")}>${t.cost.toFixed(3)}</span>
            </div>
          </div>
        </section>

        {/* secretary surfaces below the fold */}
        <div style={{ padding: "16px 20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* secondary panels */}
        <section style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start" }}>
          <CalendarPanel cal={cal} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <TodoPanel
              tasks={tasks}
              newTask={newTask}
              setNewTask={setNewTask}
              onToggle={(t) => {
                // optimistic flip, then persist + reconcile
                setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
                setTaskDone(t.id, !t.done).then(refreshTasks).catch(refreshTasks);
              }}
              onAdd={() => {
                const v = newTask.trim();
                if (!v) return;
                setNewTask("");
                addTask(v).then(refreshTasks).catch(refreshTasks);
              }}
            />
            <RemindersPanel tasks={tasks} />
          </div>
        </section>
        </div>
        </>
        ) : view === "fleet" ? (
          <FleetView
            fleet={fleet}
            agentTypes={agentTypes}
            focused={focused}
            setFocused={setFocused}
            onLaunch={launch}
            launchType={launchType}
            setLaunchType={setLaunchType}
            launchPrompt={launchPrompt}
            setLaunchPrompt={setLaunchPrompt}
            launchDir={launchDir}
            setLaunchDir={setLaunchDir}
            clock={clock}
          />
        ) : view === "arena" ? (
          <ArenaView agentTypes={agentTypes} />
        ) : view === "docs" ? (
          <DocsView />
        ) : view === "router" ? (
          <RouterView />
        ) : (
          <MissionView agentTypes={agentTypes} />
        )}
      </main>
    </div>
  );
}

/* ── chat pieces ───────────────────────────── */
// Ada's replies are unboxed — a 20px mark tile, name, timestamp, then plain body text.
// Only the user gets a bubble. Halving the border count is the biggest calm-per-line win.
function AdaTile() {
  return (
    <span style={{ width: 20, height: 20, flex: "none", borderRadius: "var(--r-control)", background: "var(--surface-2)", display: "grid", placeItems: "center" }}>
      <PunchA size={12} color="var(--text-hi)" />
    </span>
  );
}
function Message({ msg, serif }: { msg: ChatMsg; serif?: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="rise" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, alignSelf: "flex-end", maxWidth: "85%" }}>
        <div style={{ ...surface2, border: "none", borderRadius: "var(--r-bubble)", padding: "12px 16px", ...text("body", "var(--text-hi)") }}>{msg.text}</div>
        {msg.time && <span style={mono(11, "var(--text-lo)")}>{msg.time}</span>}
      </div>
    );
  }
  return (
    <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AdaTile />
        <span style={text("ui")}>Ada</span>
        {msg.time && <span style={mono(11, "var(--text-lo)")}>{msg.time}</span>}
      </div>
      <div
        style={{
          paddingLeft: 28,
          ...(serif
            ? { fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 16, lineHeight: "26px", color: "var(--text-mid)" }
            : text("body", "var(--text-hi)")),
        }}
      >
        <Markdown text={msg.text} />
      </div>
    </div>
  );
}
function Working() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AdaTile />
        <span style={text("ui")}>Ada</span>
      </div>
      <div style={{ paddingLeft: 28, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 0.18, 0.36].map((d, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--state-running)", animation: `adaType 1.2s ${d}s infinite` }} />
          ))}
        </div>
        <span style={text("caption", "var(--text-lo)")}>working…</span>
      </div>
    </div>
  );
}

/* ── trace timeline ────────────────────────── */
// One calm anatomy for every event: a node punched through a single spine, a title,
// a muted sub-line, right-aligned latency, and one expandable payload line — no cards,
// no chips, no nested boxes.
function traceMeta(e: AgentEvent): { state: AgentState; title: string; sub?: string; payload?: string } {
  const isLocal = e.model?.includes("local");
  const model = e.model ? (isLocal ? "Qwen" : "Claude") : undefined;
  switch (e.type) {
    case "tool_call":
      return { state: "ok", title: String(e.payload.tool ?? "tool"), sub: "Tool call", payload: fmt(e.payload.input) };
    case "tool_result":
      return { state: "ok", title: "Observed result", sub: model, payload: fmt(e.payload.output) };
    case "final":
      return { state: "ok", title: "Final response", sub: model, payload: String(e.payload.text ?? "") };
    case "error":
      return { state: "error", title: "Error", payload: String(e.payload.message ?? "") };
    case "message": {
      const steer = Boolean(e.payload.steer);
      const title = steer ? "You steered the run" : `${String(e.payload.from ?? "Agent")} → ${String(e.payload.to ?? "Agent")}`;
      return { state: steer ? "running" : "ok", title, payload: String(e.payload.text ?? "") };
    }
    default:
      return { state: "ok", title: String(e.type).replace(/_/g, " "), payload: fmt(e.payload) };
  }
}

function TraceRow({ e, last, active = false }: { e: AgentEvent; last: boolean; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const lat = e.latency_ms != null ? `${e.latency_ms}ms` : "";
  const { state, title, sub, payload } = traceMeta(e);
  const st: AgentState = active ? "running" : state;
  const nodeColor = st === "error" ? "transparent" : st === "running" ? "var(--state-running)" : "var(--state-ok)";

  return (
    <div
      className="rise row-hover"
      onClick={() => payload && setOpen((o) => !o)}
      style={{
        display: "grid",
        gridTemplateColumns: "20px minmax(0,1fr)",
        columnGap: 12,
        padding: "8px 14px",
        cursor: payload ? "pointer" : "default",
        borderLeft: active ? "2px solid var(--state-running)" : "2px solid transparent",
        background: active ? "rgba(255,255,255,.045)" : undefined,
      }}
    >
      {/* spine + node */}
      <div style={{ position: "relative" }}>
        {!last && <div style={{ position: "absolute", left: 10, top: 8, bottom: -8, width: 1, transform: "translateX(-.5px)", background: "var(--border)" }} />}
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 6,
            width: 7,
            height: 7,
            borderRadius: 7,
            transform: "translateX(-50%)",
            background: nodeColor,
            border: st === "error" ? "1.5px solid var(--state-error)" : undefined,
            boxShadow: st === "error" ? "0 0 0 4px var(--bg)" : `0 0 0 4px var(--bg)`,
            animation: st === "running" ? "adaPulse var(--pulse)" : undefined,
          }}
        />
      </div>
      {/* body */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ ...text("ui"), ...shrinkable }}>{title}</span>
          <span style={{ flex: 1 }} />
          {lat && <span style={mono(11, "var(--text-lo)")}>{lat}</span>}
        </div>
        {sub && <div style={{ ...text("caption", "var(--text-lo)"), marginTop: 2 }}>{sub}</div>}
        {payload && (
          <div
            style={{
              ...well,
              ...mono(11, st === "error" ? "var(--state-error-text)" : "var(--text-mid)"),
              marginTop: 6,
              padding: "6px 9px",
              borderRadius: "var(--r-control)",
              ...(open
                ? { whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflowY: "auto" }
                : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }),
            }}
          >
            {payload}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── side panels ───────────────────────────── */
const CAL_TOP0 = 10; // px offset of the 09:00 gridline
const CAL_HOUR_H = 40; // px per hour
const CAL_START = 9; // first hour shown
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const toY = (hoursFromMidnight: number) => CAL_TOP0 + (hoursFromMidnight - CAL_START) * CAL_HOUR_H;

function CalendarPanel({ cal }: { cal: CalState }) {
  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const nowY = toY(nowH);
  const showNow = nowH >= CAL_START && nowH <= CAL_START + HOURS.length - 1;
  const timed = cal.events.filter((e) => !e.all_day && e.start.includes("T"));

  return (
    <div style={{ ...panel, boxShadow: panel.boxShadow }}>
      <div style={phead}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={mono(11, "var(--text-dim)", ".16em")}>CALENDAR</span>
          <span style={mono(9.5, "var(--text-faint)", ".1em")}>DAY</span>
        </div>
        {cal.authorized ? (
          <span style={{ ...mono(10, "var(--accent)"), border: "1px solid rgba(var(--accent-rgb),.3)", background: "rgba(var(--accent-rgb),.07)", borderRadius: 5, padding: "2px 7px" }}>{timed.length} EVENT{timed.length === 1 ? "" : "S"}</span>
        ) : (
          <span style={{ ...mono(10, "var(--text-faint)"), border: "1px solid var(--line-2)", borderRadius: 5, padding: "2px 7px" }}>NOT CONNECTED</span>
        )}
      </div>

      {!cal.authorized ? (
        <div style={{ padding: "34px 22px", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <span style={{ fontSize: 13, color: "var(--text)" }}>Connect your Google Calendar</span>
          <span style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Ada will show your real day here and can reschedule events for you. Drop your OAuth client into <code style={{ fontFamily: "var(--mono)", fontSize: "0.85em", color: "var(--text)" }}>backend/.google/</code> and run <code style={{ fontFamily: "var(--mono)", fontSize: "0.85em", color: "var(--text)" }}>authorize_google.py</code> once.
          </span>
        </div>
      ) : (
        <div style={{ position: "relative", height: 384, padding: "0 16px" }}>
          {HOURS.map((h, i) => (
            <div key={h}>
              <div style={{ position: "absolute", left: 52, right: 16, top: CAL_TOP0 + i * CAL_HOUR_H, height: 1, background: "var(--line)" }} />
              <div style={{ position: "absolute", left: 16, top: CAL_TOP0 - 6 + i * CAL_HOUR_H, ...mono(9.5, "var(--text-faint)") }}>{h}</div>
            </div>
          ))}
          {showNow && (
            <>
              <div style={{ position: "absolute", left: 44, right: 16, top: nowY, height: 1, background: "var(--accent)", opacity: 0.85, zIndex: 3 }} />
              <div style={{ position: "absolute", left: 40, top: nowY - 3, width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px rgba(var(--accent-rgb),.7)", zIndex: 3 }} />
            </>
          )}
          {timed.length === 0 && (
            <div style={{ position: "absolute", left: 58, right: 16, top: 170, ...mono(11, "var(--text-faint)", ".04em") }}>Nothing scheduled today.</div>
          )}
          {timed.map((ev) => {
            const s = new Date(ev.start);
            const e = new Date(ev.end);
            const sh = s.getHours() + s.getMinutes() / 60;
            const eh = e.getHours() + e.getMinutes() / 60;
            const live = now >= s && now < e; // happening right now → accent it
            const top = Math.max(CAL_TOP0, toY(sh));
            const height = Math.max(26, (eh - sh) * CAL_HOUR_H);
            return (
              <div
                key={ev.id}
                title={ev.attendees.length ? ev.attendees.join(", ") : ev.title}
                style={{
                  position: "absolute",
                  left: 58,
                  right: 16,
                  top,
                  height,
                  background: live ? "rgba(var(--accent-rgb),.09)" : "var(--panel-2)",
                  border: live ? "1px solid rgba(var(--accent-rgb),.36)" : "1px solid var(--line)",
                  borderLeft: `2px solid ${live ? "var(--accent)" : "var(--text-dim)"}`,
                  borderRadius: 7,
                  padding: "0 11px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  overflow: "hidden",
                  boxShadow: live ? "0 0 24px -10px rgba(var(--accent-rgb),.7)" : undefined,
                  zIndex: live ? 2 : 1,
                }}
              >
                <span style={mono(11, live ? "var(--accent)" : "var(--text-dim)")}>{hhmm(s)}</span>
                <span style={{ fontSize: 12.5, color: live ? "var(--text)" : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.title}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TodoPanel({
  tasks,
  newTask,
  setNewTask,
  onToggle,
  onAdd,
}: {
  tasks: Task[];
  newTask: string;
  setNewTask: (v: string) => void;
  onToggle: (t: Task) => void;
  onAdd: () => void;
}) {
  const open = tasks.filter((t) => !t.done).length;
  return (
    <div style={panel}>
      <div style={phead}>
        <span style={mono(11, "var(--text-dim)", ".16em")}>TO-DO</span>
        <span style={mono(10, "var(--text-faint)")}>{open} OPEN</span>
      </div>
      <div>
        {tasks.length === 0 && (
          <div style={{ padding: "16px", fontSize: 12.5, color: "var(--text-faint)" }}>No tasks yet — add one below, or ask Ada in chat.</div>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="row-hover" onClick={() => onToggle(t)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
            <div style={{ width: 17, height: 17, flex: "none", borderRadius: 5, border: `1px solid ${t.done ? "var(--accent)" : "var(--line-2)"}`, background: t.done ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {t.done && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#0c0e11" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.2 5 8.6 9.5 3.6" />
                </svg>
              )}
            </div>
            <span style={{ fontSize: 13, flex: 1, color: t.done ? "var(--text-faint)" : "var(--text)", textDecoration: t.done ? "line-through" : undefined }}>{t.title}</span>
            {t.due && <span style={mono(10.5, t.due === "Today" ? "var(--accent)" : "var(--text-faint)")}>{t.due}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px 10px 16px", borderTop: "1px solid var(--line)" }}>
        <span style={{ width: 17, height: 17, flex: "none", borderRadius: 5, border: "1px dashed var(--line-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 14, lineHeight: 1 }}>+</span>
        <input className="bare" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onAdd()} placeholder="Add a task…" style={{ flex: 1, color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13, padding: "4px 0" }} />
        <button className="btn-ghost" onClick={onAdd} style={{ ...mono(10, "var(--text-dim)", ".06em"), background: "transparent", border: "1px solid var(--line-2)", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>ADD</button>
      </div>
    </div>
  );
}

// Turn a task's due-date string into a short "when" label + whether it's due now.
// Parses real dates (ISO etc.); falls back to showing the raw string for freeform dues.
function reminderInfo(due: string): { when: string; active: boolean; sort: number } {
  const d = new Date(due);
  if (isNaN(d.getTime())) return { when: due.slice(0, 12).toUpperCase(), active: false, sort: Number.MAX_SAFE_INTEGER };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const days = Math.round((dd.getTime() - today.getTime()) / 86400000);
  let when: string;
  if (days < 0) when = "OVERDUE";
  else if (days === 0) when = "TODAY";
  else if (days === 1) when = "TMRW";
  else if (days < 7) when = d.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  else when = d.toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase();
  return { when, active: days <= 0, sort: d.getTime() };
}

// Real reminders — the soonest not-done tasks that carry a due date (from Postgres,
// same store as the To-do panel and Ada's task tools). No demo data.
function RemindersPanel({ tasks }: { tasks: Task[] }) {
  const items = tasks
    .filter((t) => !t.done && t.due)
    .map((t) => ({ t, ...reminderInfo(t.due as string) }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 5);
  return (
    <div style={panel}>
      <div style={phead}>
        <span style={mono(11, "var(--text-dim)", ".16em")}>REMINDERS</span>
        <span style={mono(10, "var(--text-faint)")}>{items.length}</span>
      </div>
      <div>
        {items.length === 0 && (
          <div style={{ padding: "16px", fontSize: 12.5, color: "var(--text-faint)" }}>
            Nothing due. Add a task with a due date, or ask Ada to remind you about something.
          </div>
        )}
        {items.map(({ t, when, active }, i) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderBottom: i < items.length - 1 ? "1px solid var(--line)" : undefined }}>
            <span style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", background: active ? "var(--accent)" : "var(--line-2)", boxShadow: active ? "0 0 8px rgba(var(--accent-rgb),.7)" : undefined }} />
            <span style={{ fontSize: 13, flex: 1 }}>{t.title}</span>
            <span style={mono(10.5, active ? "var(--accent)" : "var(--text-faint)")}>{when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── small bits ────────────────────────────── */
/* ── Docs — Ada's long-term memory (Qdrant / RAG) ── */
function DocsView() {
  const [all, setAll] = useState<Memory[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState("");

  const refresh = () => listMemories().then(setAll).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const runSearch = async () => {
    const query = q.trim();
    if (!query) { setHits(null); return; }
    setHits(await searchMemory(query).catch(() => []));
  };
  const add = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    await addMemory(t).catch(() => {});
    refresh();
  };
  const remove = async (id: string) => {
    await deleteMemory(id).catch(() => {});
    setHits((h) => (h ? h.filter((m) => m.id !== id) : h));
    refresh();
  };

  const shown = hits ?? all;
  return (
    <>
      <header style={{ height: 40, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={mono(12, "var(--text)", ".14em")}>DOCS · MEMORY</span>
          <span style={mono(11, "var(--text-faint)", ".1em")}>QDRANT · SEMANTIC RECALL</span>
        </div>
        <HeaderPill text={`${all.length} STORED`} accent />
      </header>

      <div style={{ ...panel, padding: 0, maxWidth: 760, width: "100%" }}>
        {/* search */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input className="bare" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} placeholder="Search Ada's memory by meaning…" style={{ flex: 1, color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13.5, padding: "6px 0" }} />
          {hits !== null && (
            <button className="btn-ghost" onClick={() => { setQ(""); setHits(null); }} style={{ ...mono(10, "var(--text-dim)", ".06em"), background: "transparent", border: "1px solid var(--line-2)", borderRadius: 6, padding: "4px 9px", cursor: "pointer" }}>CLEAR</button>
          )}
          <button className="btn-accent" onClick={runSearch} style={{ ...mono(10, "#0c0e11", ".06em"), fontWeight: 600, background: "var(--accent)", border: 0, borderRadius: 7, padding: "6px 12px", cursor: "pointer" }}>SEARCH</button>
        </div>

        {/* list */}
        <div style={{ maxHeight: "calc(100vh / 1.5 - 320px)", minHeight: 200, overflowY: "auto" }}>
          {shown.length === 0 && (
            <div style={{ padding: 22, fontSize: 12.5, color: "var(--text-faint)" }}>{hits !== null ? "No matches." : "Nothing stored yet. Tell Ada something to remember, or add a memory below."}</div>
          )}
          {shown.map((m) => (
            <div key={m.id} className="row-hover" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ width: 6, height: 6, marginTop: 6, flex: "none", borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 7px rgba(var(--accent-rgb),.6)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.45 }}>{m.text}</div>
                <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
                  {m.created && <span style={mono(9.5, "var(--text-faint)", ".04em")}>{m.created.replace("T", " ").slice(0, 16)}</span>}
                  {m.source && <span style={mono(9.5, "var(--text-faint)", ".08em")}>{m.source.toUpperCase()}</span>}
                  {m.score !== undefined && <span style={mono(9.5, "var(--accent)", ".04em")}>match {m.score.toFixed(2)}</span>}
                </div>
              </div>
              <button className="btn-ghost" onClick={() => remove(m.id)} title="Forget" style={{ ...mono(10, "var(--text-faint)"), background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", flex: "none" }}>✕</button>
            </div>
          ))}
        </div>

        {/* add */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px 10px 16px", borderTop: "1px solid var(--line)" }}>
          <span style={{ width: 17, height: 17, flex: "none", borderRadius: 5, border: "1px dashed var(--line-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 14, lineHeight: 1 }}>+</span>
          <input className="bare" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a memory…" style={{ flex: 1, color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13, padding: "4px 0" }} />
          <button className="btn-ghost" onClick={add} style={{ ...mono(10, "var(--text-dim)", ".06em"), background: "transparent", border: "1px solid var(--line-2)", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>SAVE</button>
        </div>
      </div>
    </>
  );
}

/* ── Router — local Qwen ↔ cloud Claude offload ── */
function RouterView() {
  const [stats, setStats] = useState<RouterStats | null>(null);
  const [health, setHealth] = useState<RouterHealth | null>(null);

  useEffect(() => {
    let live = true;
    const tick = () => {
      getRouterStats().then((s) => live && setStats(s)).catch(() => {});
      getRouterHealth().then((h) => live && setHealth(h)).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const total = stats?.total_calls ?? 0;
  const local = stats?.local_calls ?? 0;
  const cloud = stats?.cloud_calls ?? 0;
  const localPct = total ? Math.round((local / total) * 100) : 0;
  const online = health?.reachable && health?.ready;
  const money = (n: number) => `$${(n ?? 0).toFixed(4)}`;

  return (
    <>
      <header style={{ height: 40, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={mono(12, "var(--text)", ".14em")}>ROUTER · MODEL OFFLOAD</span>
          <span style={mono(11, "var(--text-faint)", ".1em")}>LOCAL QWEN ↔ CLOUD CLAUDE</span>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, ...mono(10, online ? "var(--accent)" : "var(--red)", ".08em"), border: `1px solid ${online ? "rgba(var(--accent-rgb),.3)" : "rgba(255,138,128,.35)"}`, background: online ? "rgba(var(--accent-rgb),.07)" : "rgba(255,138,128,.08)", borderRadius: 6, padding: "4px 9px" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: online ? "var(--accent)" : "var(--red)", boxShadow: online ? "0 0 7px rgba(var(--accent-rgb),.7)" : "none" }} />
          {online ? "LOCAL MODEL READY" : health?.reachable ? "MODEL NOT LOADED" : "OLLAMA OFFLINE"}
        </span>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820, width: "100%" }}>
        {/* two model cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ModelCard tier="LOCAL" role="cheap subtasks · free" model={stats?.local_model ?? health?.target ?? "—"} calls={local} avgMs={stats?.local_avg_ms ?? 0} accent />
          <ModelCard tier="CLOUD" role="reasoning · the bill" model={stats?.cloud_model ?? "claude-haiku-4-5"} calls={cloud} avgMs={stats?.cloud_avg_ms ?? 0} />
        </div>

        {/* headline: split + savings */}
        <div style={{ ...panel, padding: 16, gap: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={mono(10, "var(--text-faint)", ".13em")}>OFFLOADED TO LOCAL</span>
            <span style={mono(11, "var(--text-dim)", ".04em")}>{local} / {total} calls</span>
          </div>
          {/* proportion bar */}
          <div style={{ display: "flex", height: 9, borderRadius: 5, overflow: "hidden", background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            <div style={{ width: `${localPct}%`, background: "var(--accent)", boxShadow: "0 0 10px rgba(var(--accent-rgb),.5)", transition: "width .4s" }} />
            <div style={{ flex: 1, background: "rgba(255,255,255,.06)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 4 }}>
            <BigStat label="RAN LOCAL" value={`${localPct}%`} accent />
            <BigStat label="EST. SAVED vs HAIKU" value={money(stats?.saved_usd ?? 0)} accent />
            <BigStat label="CLOUD SPEND" value={money(stats?.cost_usd ?? 0)} />
          </div>
        </div>

        {/* recent calls */}
        <div style={{ ...panel, padding: 0 }}>
          <div style={{ ...phead }}>
            <span style={mono(11, "var(--text-dim)", ".1em")}>RECENT ROUTED CALLS</span>
            <HeaderPill text={`${total} TOTAL`} />
          </div>
          <div style={{ maxHeight: "calc(100vh / 1.5 - 430px)", minHeight: 140, overflowY: "auto" }}>
            {(!stats || stats.recent.length === 0) && (
              <div style={{ padding: 22, fontSize: 12.5, color: "var(--text-faint)" }}>
                Nothing routed yet. Ask Ada to summarize a note or triage some text — cheap work goes to the local model and shows up here.
              </div>
            )}
            {stats?.recent.map((c, i) => (
              <div key={i} className="row-hover" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
                <span style={{ ...mono(9.5, c.where === "local" ? "var(--accent)" : "var(--text-dim)", ".06em"), border: `1px solid ${c.where === "local" ? "rgba(var(--accent-rgb),.3)" : "var(--line-2)"}`, background: c.where === "local" ? "rgba(var(--accent-rgb),.07)" : undefined, borderRadius: 5, padding: "2px 7px", flex: "none", width: 52, textAlign: "center" }}>{c.where.toUpperCase()}</span>
                <span style={{ ...mono(12, "var(--text)"), flex: "none", width: 84 }}>{c.kind}</span>
                <span style={{ ...mono(10.5, "var(--text-faint)", ".02em"), flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.model}</span>
                <span style={{ ...mono(10.5, "var(--text-dim)"), flex: "none", width: 64, textAlign: "right" }}>{c.latency_ms} ms</span>
                <span style={{ ...mono(10.5, c.saved_usd > 0 ? "var(--accent)" : "var(--text-faint)"), flex: "none", width: 74, textAlign: "right" }}>{c.saved_usd > 0 ? `+${money(c.saved_usd)}` : money(c.cost_usd)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ModelCard({ tier, role, model, calls, avgMs, accent }: { tier: string; role: string; model: string; calls: number; avgMs: number; accent?: boolean }) {
  return (
    <div style={{ ...panel, padding: 15, gap: 11, borderColor: accent ? "rgba(var(--accent-rgb),.22)" : "var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={mono(10, accent ? "var(--accent)" : "var(--text-dim)", ".13em")}>{tier}</span>
        <span style={mono(9.5, "var(--text-faint)", ".06em")}>{role}</span>
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--text)", letterSpacing: ".01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
        <RailStat label="CALLS" value={String(calls)} accent={accent} />
        <div style={{ width: 14 }} />
        <RailStat label="AVG" value={avgMs ? `${avgMs} ms` : "—"} />
      </div>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={mono(9, "var(--text-faint)", ".12em")}>{label}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 500, color: accent ? "var(--accent)" : "var(--text)", letterSpacing: "-.01em" }}>{value}</span>
    </div>
  );
}

function RailStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={mono(9.5, "var(--text-faint)", ".13em")}>{label}</span>
      <span style={mono(13, accent ? "var(--accent)" : "var(--text)")}>{value}</span>
    </div>
  );
}
function ThemeBar({
  accent,
  setAccent,
  grid,
  setGrid,
}: {
  accent: string;
  setAccent: (v: string) => void;
  grid: boolean;
  setGrid: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={mono(9, "var(--text-faint)", ".13em")}>ACCENT</span>
        <span
          onClick={() => setGrid(!grid)}
          title="Toggle dot grid"
          className="btn-ghost"
          style={{
            ...mono(8.5, grid ? "var(--accent)" : "var(--text-faint)", ".1em"),
            border: `1px solid ${grid ? "rgba(var(--accent-rgb),.4)" : "var(--line)"}`,
            borderRadius: 4,
            padding: "1px 5px",
            cursor: "pointer",
          }}
        >
          GRID
        </span>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        {ACCENTS.map((a) => (
          <span
            key={a.key}
            onClick={() => setAccent(a.key)}
            title={a.key}
            className="swatch"
            style={{
              width: 15,
              height: 15,
              flex: "none",
              borderRadius: "50%",
              cursor: "pointer",
              background: `rgb(${a.rgb})`,
              opacity: accent === a.key ? 1 : 0.72,
              boxShadow:
                accent === a.key
                  ? `0 0 0 2px var(--bg), 0 0 0 3.5px rgb(${a.rgb}), 0 0 10px -1px rgb(${a.rgb})`
                  : "inset 0 0 0 1px rgba(0,0,0,.35)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
function HeaderPill({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <span
      style={{
        ...mono(10, accent ? "var(--accent)" : "var(--text-dim)", ".08em"),
        border: `1px solid ${accent ? "rgba(var(--accent-rgb),.3)" : "var(--line)"}`,
        background: accent ? "rgba(var(--accent-rgb),.07)" : undefined,
        borderRadius: 6,
        padding: "4px 9px",
      }}
    >
      {text}
    </span>
  );
}

/* ── fleet cockpit ─────────────────────────── */
const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  ...mono(11, "var(--text-dim)", ".02em"),
  background: "transparent",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  padding: "6px 11px",
  cursor: "pointer",
};
function accentColor(a?: string): string {
  return a === "cyan" ? "#5ec7d6" : a === "violet" ? "#a68bf0" : a === "green" ? "#7fd88f" : "var(--accent)";
}
// colour per Claude-Code output stream, for the Terminal panel
const STREAM_COLORS: Record<string, string> = {
  cmd: "var(--accent)",
  system: "var(--text-faint)",
  assistant: "var(--text)",
  tool: "#7fd88f",
  result: "var(--text-dim)",
  stderr: "var(--red)",
};

interface FleetProps {
  fleet: Record<string, FleetRun>;
  agentTypes: AgentType[];
  focused: string | null;
  setFocused: (id: string) => void;
  onLaunch: () => void;
  launchType: string;
  setLaunchType: (t: string) => void;
  launchPrompt: string;
  setLaunchPrompt: (v: string) => void;
  launchDir: string;
  setLaunchDir: (v: string) => void;
  clock: number;
}
const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);
const code3 = (name?: string) => (name ?? "AGT").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "AGT";
const laneMix = (id: string, a: number) => `color-mix(in oklch, ${laneHue(id)} ${Math.round(a * 100)}%, transparent)`;

// The time-axis Fleet — the view a card grid can't give you: who ran when, and in parallel.
// Fed entirely by buildTimeline() so it draws whatever the event stream provides.
function FleetGantt({ fleet, clock, focusId, setFocused }: { fleet: Record<string, FleetRun>; clock: number; focusId: string | null; setFocused: (id: string) => void }) {
  const raw: RawEvent[] = [];
  for (const [id, run] of Object.entries(fleet)) {
    // Keep the timeline about the current working set — drop long-finished runs that would
    // otherwise stretch the wall clock (a stale chat run from an hour ago, say).
    const startedAt = run.meta?.started_at ?? clock;
    if (run.status !== "running" && clock - startedAt > 1800) continue;
    const evs = run.events.filter((e) => e.type !== "log");
    if (evs.length === 0) {
      // No streamed steps (e.g. the browser connected after the run finished): draw one
      // measured span for the run's own window so the lane, bar and figures still mean something.
      const start = Math.round(startedAt * 1000);
      const end = Math.round((run.status === "running" ? clock : startedAt + 2) * 1000);
      raw.push({ id: `${id}-0`, agentId: id, startedAt: start, endedAt: end, status: run.status === "running" ? "running" : run.status === "error" ? "error" : "ok", title: run.lastStep || run.meta?.name });
    } else {
      evs.forEach((e, i) =>
        raw.push({
          id: `${id}-${e.seq ?? i}`,
          agentId: id,
          at: Math.round(e.ts * 1000),
          tool: e.payload?.tool ? String(e.payload.tool) : undefined,
          phase: e.type === "tool_call" ? "act" : e.type === "final" || e.type === "tool_result" ? "observe" : "act",
          status: e.type === "error" ? "error" : run.status === "running" && i === evs.length - 1 ? "running" : "ok",
          title: e.type === "tool_call" ? String(e.payload?.tool ?? "tool") : e.type,
        }),
      );
    }
  }
  const tl = buildTimeline(raw, Math.round(clock * 1000));
  if (tl.lanes.length === 0) {
    return (
      <div style={{ ...scroller, display: "grid", placeItems: "center", padding: 40 }}>
        <div style={{ ...text("caption", "var(--text-lo)"), textAlign: "center", maxWidth: 260 }}>No agents yet. Launch one above and its timeline appears here.</div>
      </div>
    );
  }
  const figures = [
    { label: "Wall clock", val: fmtSec(tl.wallSec), err: false },
    { label: "Agent-seconds", val: fmtSec(tl.agentSec), err: false },
    { label: "Parallelism", val: `${tl.parallelism.toFixed(1)}×`, err: false },
    { label: "Wasted", val: fmtSec(tl.wastedSec), err: tl.wastedSec > 0 },
  ];
  return (
    <div style={{ ...scroller, padding: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 32, padding: "14px 16px", borderBottom: "1px solid var(--border)", flex: "none" }}>
        {figures.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={text("caption", "var(--text-lo)")}>{f.label}</span>
            <span style={{ ...mono(17, f.err ? "var(--state-error)" : "var(--text-hi)"), lineHeight: "22px" }}>{f.val}</span>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", height: 24, borderBottom: "1px solid var(--border)", flex: "none" }}>
        {tl.ticks.map((tk, i) => (
          <span key={i} style={{ position: "absolute", top: 5, left: `calc(var(--w-lane-gutter) + (100% - var(--w-lane-gutter) - var(--w-lane-cost)) * ${tk.pct / 100})`, ...mono(10, "var(--text-lo)"), transform: "translateX(-50%)" }}>{tk.label}</span>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {tl.lanes.map((lane) => {
          const meta = fleet[lane.agentId]?.meta;
          const focused = lane.agentId === focusId;
          return (
            <div key={lane.agentId} onClick={() => setFocused(lane.agentId)} className="row-hover" style={{ display: "flex", height: "var(--h-lane)", alignItems: "center", cursor: "pointer", background: focused ? "rgba(255,255,255,.03)" : undefined, borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: "var(--w-lane-gutter)", flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minWidth: 0 }}>
                <span style={{ width: 3, height: 24, borderRadius: 2, background: laneHue(lane.agentId), flex: "none" }} />
                <span style={{ ...mono(11, laneHue(lane.agentId, true)), flex: "none" }}>{code3(meta?.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...text("ui"), ...shrinkable }}>{meta?.name ?? lane.agentId}</div>
                  <div style={{ ...text("caption", "var(--text-lo)"), ...shrinkable }}>{crewRole(meta?.agent_type)}</div>
                </div>
              </div>
              <div style={{ flex: 1, position: "relative", height: "var(--h-lane)", borderLeft: "1px solid var(--border)", backgroundImage: "repeating-linear-gradient(90deg, transparent 0 calc(20% - 1px), var(--border) calc(20% - 1px) 20%)" }}>
                {lane.gaps.map((g, i) => (
                  <div key={`g${i}`} style={{ position: "absolute", top: "50%", left: `${g.leftPct}%`, width: `${g.widthPct}%`, borderTop: "1px dashed var(--text-disabled)", transform: "translateY(-50%)" }} />
                ))}
                {lane.spans.map((s) => (
                  <div
                    key={s.id}
                    title={s.tool || s.title || s.phase}
                    style={{
                      position: "absolute",
                      top: "50%",
                      transform: "translateY(-50%)",
                      left: `${s.leftPct}%`,
                      width: `${s.widthPct}%`,
                      height: 24,
                      borderRadius: 3,
                      overflow: "hidden",
                      background: s.derived
                        ? `repeating-linear-gradient(45deg, ${laneMix(lane.agentId, 0.7)} 0 3px, transparent 3px 6px)`
                        : s.phase === "plan"
                        ? laneMix(lane.agentId, 0.35)
                        : laneMix(lane.agentId, 0.8),
                      border: s.phase === "plan" ? `1px solid ${laneMix(lane.agentId, 0.55)}` : undefined,
                      boxShadow: s.status === "running" ? "inset -2px 0 0 var(--text-hi)" : undefined,
                      ...mono(9, "#000"),
                      display: "flex",
                      alignItems: "center",
                      padding: "0 5px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.tool || ""}
                  </div>
                ))}
              </div>
              <div style={{ width: "var(--w-lane-cost)", flex: "none", textAlign: "right", padding: "0 12px", ...mono(11, "var(--text-lo)") }}>{meta?.cost_usd ? `$${meta.cost_usd.toFixed(3)}` : "—"}</div>
            </div>
          );
        })}
      </div>
      {tl.anyDerived && <div style={{ ...text("caption", "var(--text-lo)"), padding: "8px 16px", flex: "none" }}>Durations inferred from step arrival.</div>}
    </div>
  );
}

function FleetView(p: FleetProps) {
  const [tab, setTab] = useState<"trace" | "terminal" | "diff">("trace");
  const [mode, setMode] = useState<"timeline" | "grid">("timeline");
  const [steerText, setSteerText] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  useEffect(() => {
    listRepos().then(setRepos).catch(() => {});
  }, []);
  const runs = Object.entries(p.fleet)
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => {
      const ao = a.status === "running" ? 0 : 1;
      const bo = b.status === "running" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (b.meta?.started_at ?? 0) - (a.meta?.started_at ?? 0);
    });
  const running = runs.filter((r) => r.status === "running").length;
  const focusId = p.focused ?? runs[0]?.id ?? null;
  const focusRun = focusId ? p.fleet[focusId] : null;
  const launchName = p.agentTypes.find((a) => a.type === p.launchType)?.name ?? "agent";
  const launchBlurb = p.agentTypes.find((a) => a.type === p.launchType)?.blurb ?? "";
  // auto-show the Terminal for coding agents, the Trace for the rest
  const isCoder = focusRun?.meta?.agent_type === "claude_code";
  useEffect(() => {
    setTab(isCoder ? "terminal" : "trace");
  }, [focusId, isCoder]);
  const tabList: Array<"trace" | "terminal" | "diff"> = isCoder
    ? ["terminal", "trace", "diff"]
    : ["trace", "terminal"];

  // Mission-control verbs for the focused agent: kill a runaway, relaunch a finished one.
  const restartable = !!focusRun && ["ada", "researcher", "planner", "claude_code"].includes(focusRun.meta?.agent_type ?? "");
  const onStop = async () => {
    if (focusId) await stopRun(focusId);
  };
  const onRestart = async () => {
    if (!focusId) return;
    const r = await restartRun(focusId);
    if (r.run_id) p.setFocused(r.run_id);
  };

  // Live steering: LLM-loop agents (Ada/Scout/Atlas) take a mid-task message injected into
  // their running loop. An interactive Forge (claude_code) takes it as the next turn of a
  // continuous conversation (its session resumes with full context). Either way it's the
  // same endpoint; a finished run or a one-shot Forge can't take one.
  const steerable =
    !!focusRun && focusRun.status === "running" && ["ada", "researcher", "planner"].includes(focusRun.meta?.agent_type ?? "");
  const forgeChat =
    !!focusRun && focusRun.status === "running" && focusRun.meta?.agent_type === "claude_code" && !!focusRun.meta?.interactive;
  const canMessage = steerable || forgeChat;
  const sendSteer = async () => {
    const txt = steerText.trim();
    if (!txt || !focusId) return;
    setSteerText("");
    await steerRun(focusId, txt);
  };

  return (
    <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16, height: "calc(100vh / 1.5 - 74px)", minHeight: 560 }}>
      <div style={panel}>
        <div style={phead}>
          <span style={text("ui")}>Fleet</span>
          {running > 0 && (
            <span style={tag("running")}>
              <span style={dot("running", 6)} />
              {running} running
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={mono(11, "var(--text-lo)")}>{runs.length} total</span>
          <div style={{ display: "flex", padding: 2, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-control)", gap: 2, flex: "none" }}>
            {(["timeline", "grid"] as const).map((m) => (
              <span
                key={m}
                onClick={() => setMode(m)}
                style={{ ...text("caption", mode === m ? "var(--text-hi)" : "var(--text-lo)"), cursor: "pointer", padding: "3px 10px", borderRadius: 4, background: mode === m ? "var(--surface-2)" : "transparent", textTransform: "capitalize" }}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {p.agentTypes.map((a) => {
              const on = p.launchType === a.type;
              return (
                <button
                  key={a.type}
                  className="btn-ghost"
                  onClick={() => p.setLaunchType(a.type)}
                  style={{ ...chip, ...(on ? { color: "var(--text)", borderColor: "rgba(var(--accent-rgb),.4)", background: "rgba(var(--accent-rgb),.06)" } : {}) }}
                >
                  <span style={{ color: typeColor(a.type), display: "inline-flex" }}>
                    <PixelAgent name={spriteFor(a.type)} size={16} />
                  </span>
                  {a.name}
                </button>
              );
            })}
          </div>
          {launchBlurb && (
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: typeColor(p.launchType), display: "inline-flex" }}>
                <PixelAgent name={spriteFor(p.launchType)} size={16} />
              </span>
              <span style={{ ...mono(10.5, "var(--text-faint)", ".01em"), lineHeight: 1.4 }}>
                {launchName} · {launchBlurb}
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="bare"
              value={p.launchPrompt}
              onChange={(e) => p.setLaunchPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && p.onLaunch()}
              placeholder={`Task for ${launchName}…`}
              style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 9, padding: "10px 13px", color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13 }}
            />
            <button
              className="btn-accent"
              onClick={p.onLaunch}
              style={{ ...mono(11, "#0c0e11", ".06em"), fontWeight: 600, background: "var(--accent)", border: 0, borderRadius: 9, padding: "0 18px", cursor: "pointer" }}
            >
              LAUNCH
            </button>
          </div>
          {p.launchType === "claude_code" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={mono(10, "var(--text-faint)", ".08em")}>DIR</span>
                <input
                  className="bare"
                  value={p.launchDir}
                  onChange={(e) => p.setLaunchDir(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && p.onLaunch()}
                  placeholder="working dir — optional, defaults to sandbox (e.g. ~/dev/mysite)"
                  style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 9, padding: "8px 12px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5 }}
                />
                {p.launchDir && (
                  <button className="btn-ghost" onClick={() => p.setLaunchDir("")} style={{ ...mono(9.5, "var(--text-faint)", ".06em"), background: "transparent", border: "1px solid var(--line-2)", borderRadius: 7, padding: "6px 9px", cursor: "pointer", flex: "none" }}>
                    SANDBOX
                  </button>
                )}
              </div>
              {repos.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 70, overflowY: "auto", paddingRight: 2 }}>
                  {repos.map((rp) => {
                    const on = p.launchDir === rp.path;
                    return (
                      <button
                        key={rp.path}
                        className="btn-ghost"
                        onClick={() => p.setLaunchDir(rp.path)}
                        title={rp.path}
                        style={{ ...mono(10, on ? "var(--text)" : "var(--text-faint)", ".02em"), background: on ? "rgba(var(--accent-rgb),.08)" : "transparent", border: `1px solid ${on ? "rgba(var(--accent-rgb),.4)" : "var(--line-2)"}`, borderRadius: 7, padding: "4px 9px", cursor: "pointer" }}
                      >
                        {rp.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        {mode === "timeline" ? (
          <FleetGantt fleet={p.fleet} clock={p.clock} focusId={focusId} setFocused={p.setFocused} />
        ) : (
          <div style={{ ...scroller, padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(228px,1fr))", gap: 12, alignContent: "start" }}>
            {runs.length === 0 && (
              <div style={{ ...text("caption", "var(--text-lo)"), gridColumn: "1/-1", padding: "8px 2px", lineHeight: 1.6 }}>
                No agents running. Launch one above — or in Chat, ask Ada to “spawn a researcher on …” and it appears here.
              </div>
            )}
            {runs.map((r) => (
              <FleetCard key={r.id} id={r.id} run={r} focused={r.id === focusId} onClick={() => p.setFocused(r.id)} clock={p.clock} />
            ))}
          </div>
        )}
      </div>

      <div style={{ ...panel, boxShadow: "inset 0 1px 0 rgba(255,255,255,.03), 0 1px 2px rgba(0,0,0,.45), 0 0 40px -20px rgba(var(--accent-rgb),.3)" }}>
        <div style={phead}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {tabList.map((tb) => (
              <span
                key={tb}
                onClick={() => setTab(tb)}
                style={{
                  ...mono(11, tab === tb ? "var(--text)" : "var(--text-faint)", ".16em"),
                  cursor: "pointer",
                  padding: "3px 9px",
                  borderRadius: 6,
                  background: tab === tb ? "rgba(255,255,255,.05)" : "transparent",
                }}
              >
                {tb.toUpperCase()}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {focusRun?.status === "running" && (
              <button
                className="btn-ghost"
                onClick={onStop}
                title="Kill this agent"
                style={{ ...mono(9.5, "var(--red)", ".08em"), background: "rgba(255,138,128,.07)", border: "1px solid rgba(255,138,128,.3)", borderRadius: 7, padding: "4px 9px", cursor: "pointer" }}
              >
                ■ STOP
              </button>
            )}
            {focusRun && focusRun.status !== "running" && restartable && (
              <button
                className="btn-ghost"
                onClick={onRestart}
                title="Relaunch with the same task"
                style={{ ...mono(9.5, "var(--accent)", ".08em"), background: "rgba(var(--accent-rgb),.07)", border: "1px solid rgba(var(--accent-rgb),.3)", borderRadius: 7, padding: "4px 9px", cursor: "pointer" }}
              >
                ↻ RESTART
              </button>
            )}
            {focusRun?.meta && (
              <span style={mono(10, "var(--text-faint)")}>
                {focusRun.meta.name} · {focusId}
              </span>
            )}
          </div>
        </div>
        {tab === "diff" ? (
          focusRun && focusId ? (
            <DiffPanel runId={focusId} status={focusRun.status} tools={focusRun.tools} />
          ) : (
            <div style={{ flex: 1, ...mono(12, "var(--text-faint)"), padding: "18px 16px" }}>Select an agent to review its changes.</div>
          )
        ) : tab === "terminal" ? (
          focusRun ? (
            <TerminalPanel run={focusRun} />
          ) : (
            <div style={{ flex: 1, ...mono(12, "var(--text-faint)"), padding: "18px 16px" }}>Select an agent to watch its terminal.</div>
          )
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column" }}>
            {!focusRun && <div style={{ ...mono(12, "var(--text-faint)"), padding: "8px 2px" }}>Select an agent to watch its live trace.</div>}
            {focusRun && focusRun.events.filter((e) => e.type !== "log").length === 0 && (
              <div style={{ ...mono(12, "var(--text-faint)"), padding: "8px 2px" }}>No steps captured yet — the agent is warming up.</div>
            )}
            {focusRun && focusRun.events.map((e, i) => <TraceRow key={i} e={e} last={i === focusRun.events.length - 1} active={focusRun.status === "running" && i === focusRun.events.length - 1} />)}
          </div>
        )}
        {canMessage && (
          <div style={{ flex: "none", borderTop: "1px solid var(--line)", background: "rgba(255,255,255,.015)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...mono(9.5, "var(--accent)", ".1em"), fontWeight: 600, flex: "none" }}>{forgeChat ? "REPLY ▸" : "STEER ▸"}</span>
            <input
              className="bare"
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendSteer()}
              placeholder={forgeChat ? `Reply to ${focusRun?.meta?.name ?? "Forge"} — keep the conversation going…` : `Message ${focusRun?.meta?.name ?? "agent"} while it works…`}
              style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 9, padding: "8px 12px", color: "var(--text)", fontFamily: "var(--sans)", fontSize: 12.5 }}
            />
            <button
              className="btn-accent"
              onClick={sendSteer}
              style={{ ...mono(10, "#0c0e11", ".06em"), fontWeight: 600, background: "var(--accent)", border: 0, borderRadius: 8, padding: "8px 13px", cursor: "pointer", flex: "none" }}
            >
              SEND
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function runState(status: RunStatus): AgentState {
  return status === "running" ? "running" : status === "error" ? "error" : status === "done" ? "ok" : "idle";
}

function FleetCard({ id, run, focused, onClick, clock }: { id: string; run: FleetRun; focused: boolean; onClick: () => void; clock: number }) {
  const meta = run.meta;
  const st = runState(run.status);
  const role = crewRole(meta?.agent_type);
  const elapsed = meta ? Math.max(0, Math.floor(clock - meta.started_at)) : 0;
  return (
    <div
      onClick={onClick}
      className="row-hover"
      style={{
        ...surface2,
        border: `1px solid ${focused ? "var(--text-hi)" : "var(--border)"}`,
        borderRadius: "var(--r-card)",
        padding: 14,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AgentBadge sprite={spriteFor(meta?.agent_type)} state={st} name={meta?.name ?? "agent"} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...text("title"), ...shrinkable }}>{meta?.name ?? "agent"}</div>
          <div style={{ ...text("caption", "var(--text-lo)"), ...shrinkable }}>{role}</div>
        </div>
        <span style={{ ...tag(st === "idle" ? "neutral" : st), flex: "none" }}>
          {st === "running" && <span style={dot("running", 6)} />}
          {run.status}
        </span>
      </div>
      <div style={{ ...text("caption", "var(--text-mid)"), minHeight: 32, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta?.prompt ?? id}</div>
      {meta?.agent_type === "claude_code" && meta?.workdir && (
        <div style={{ ...mono(10, "var(--text-lo)"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={meta.workdir}>
          {shortPath(meta.workdir)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, ...mono(11, "var(--text-lo)") }}>
        <span>{run.events.length} steps</span>
        {!!meta?.tokens && <span>{fmtTokens(meta.tokens)} tok</span>}
        {!!meta?.cost_usd && <span>${meta.cost_usd.toFixed(3)}</span>}
        <span style={{ marginLeft: "auto" }}>{fmtUptime(elapsed)}</span>
      </div>
      {run.lastStep && (
        <div style={{ ...mono(11, st === "running" ? "#7FBBFF" : "var(--text-lo)"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.lastStep}</div>
      )}
    </div>
  );
}

// The Terminal panel (M3) — renders a claude_code run's raw `log` stream like a console.
function TerminalPanel({ run }: { run: FleetRun }) {
  const logs = run.events.filter((e) => e.type === "log");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [logs.length]);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", background: "#050506", borderRadius: "0 0 13px 13px" }}>
      {logs.length === 0 && <div style={mono(11.5, "var(--text-faint)")}>waiting for output…</div>}
      {logs.map((e, i) => (
        <div
          key={i}
          style={{
            ...mono(11.5, STREAM_COLORS[String(e.payload.stream ?? "")] ?? "var(--text-dim)"),
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            padding: "1px 0",
            lineHeight: 1.55,
          }}
        >
          {String(e.payload.line ?? "")}
        </div>
      ))}
      {run.status === "running" && (
        <span style={{ display: "inline-block", width: 7, height: 14, marginTop: 4, background: "var(--accent)", animation: "adaCursor 1.1s steps(1) infinite" }} />
      )}
      <div ref={endRef} />
    </div>
  );
}

// The Diff panel — what a coding agent changed in its workdir. Auto-refreshes as the agent
// runs tools (the `tools` count changes) and can be refreshed by hand. This is the "review
// what it did" half of managing an agent.
function DiffPanel({ runId, status, tools }: { runId: string; status: RunStatus; tools: number }) {
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try {
      setDiff(await getRunDiff(runId));
    } catch {
      /* ignore transient fetch errors */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setNote(null);
    load();
    // refetch when the run advances (new tool call) or ends
  }, [runId, status, tools]); // eslint-disable-line react-hooks/exhaustive-deps

  const files = diff?.files ?? [];
  const canCommit = !!diff?.is_git && files.length > 0;
  const doCommit = async () => {
    if (committing) return;
    setCommitting(true);
    setNote(null);
    try {
      const r = await commitRun(runId, msg.trim() || undefined);
      if (r.committed) {
        setNote(`✓ committed ${r.hash}`);
        setMsg("");
        await load(); // diff now clean — the work is captured
      } else {
        setNote(`✕ ${r.error ?? "commit failed"}`);
      }
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <span style={mono(9.5, "var(--text-faint)", ".12em")}>{diff?.is_git ? `${files.length} CHANGED` : "WORKDIR"}</span>
        {files.slice(0, 8).map((f) => (
          <span key={f.path} style={{ ...mono(10, diffStatusColor(f.status)), display: "inline-flex", gap: 4, alignItems: "baseline" }} title={f.path}>
            <b>{f.status}</b>
            {basename(f.path)}
          </span>
        ))}
        {files.length > 8 && <span style={mono(10, "var(--text-faint)")}>+{files.length - 8} more</span>}
        {note && <span style={mono(9.5, note.startsWith("✓") ? "var(--accent)" : "var(--red)", ".04em")}>{note}</span>}
        <button
          className="btn-ghost"
          onClick={load}
          style={{ marginLeft: "auto", ...mono(9.5, "var(--text-dim)", ".06em"), background: "transparent", border: "1px solid var(--line-2)", borderRadius: 6, padding: "4px 9px", cursor: "pointer", flex: "none" }}
        >
          {loading ? "…" : "↻ REFRESH"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", background: "#050506", borderRadius: canCommit ? 0 : "0 0 13px 13px" }}>
        {!diff && <div style={mono(11.5, "var(--text-faint)")}>loading diff…</div>}
        {diff && !diff.is_git && <div style={mono(11.5, "var(--text-faint)")}>{diff.error ?? "not a git repo — nothing to diff"}</div>}
        {diff && diff.is_git && files.length === 0 && (
          <div style={mono(11.5, "var(--text-faint)")}>No changes yet — the agent hasn't touched any files.</div>
        )}
        {diff?.diff &&
          diff.diff.split("\n").map((line, i) => (
            <div key={i} style={{ ...mono(11, diffLineColor(line)), whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
              {line || " "}
            </div>
          ))}
        {diff?.truncated && <div style={{ ...mono(10.5, "var(--text-faint)"), marginTop: 8 }}>… diff truncated</div>}
      </div>
      {canCommit && (
        <div style={{ flex: "none", borderTop: "1px solid var(--line)", background: "rgba(255,255,255,.015)", padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            className="bare"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doCommit()}
            placeholder='commit message… (default: "Agent changes (via Ada)")'
            style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 8, padding: "7px 11px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5 }}
          />
          <button
            className="btn-accent"
            onClick={doCommit}
            disabled={committing}
            title="git add -A + commit the agent's changes in its workdir"
            style={{ ...mono(10, "#0c0e11", ".06em"), fontWeight: 600, background: "var(--accent)", border: 0, borderRadius: 8, padding: "7px 13px", cursor: committing ? "default" : "pointer", flex: "none", opacity: committing ? 0.6 : 1 }}
          >
            {committing ? "…" : "✓ COMMIT"}
          </button>
        </div>
      )}
    </div>
  );
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}
function shortPath(p: string): string {
  const s = p.replace(/^\/home\/[^/]+/, "~");
  const parts = s.split("/").filter(Boolean);
  return parts.length > 3 ? parts[0] + "/…/" + parts.slice(-2).join("/") : s;
}
function fmtTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}
function fmtUptime(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
function diffStatusColor(code: string): string {
  if (code.includes("?") || code.includes("A")) return "#7ee787";
  if (code.includes("D")) return "var(--red)";
  if (code.includes("M") || code.includes("R")) return "rgba(var(--accent-rgb),.85)";
  return "var(--text-dim)";
}
function diffLineColor(line: string): string {
  if (line.startsWith("+")) return "#7ee787";
  if (line.startsWith("-") && !line.startsWith("---")) return "var(--red)";
  if (line.startsWith("@@")) return "rgba(var(--accent-rgb),.75)";
  if (line.startsWith("diff --git") || line.startsWith("new file")) return "var(--text)";
  return "var(--text-dim)";
}

function reduceFleet(prev: Record<string, FleetRun>, m: FleetMsg): Record<string, FleetRun> {
  const id = m.run_id;
  const cur: FleetRun = prev[id] ?? { meta: null, events: [], status: "running", tools: 0, lastStep: "" };
  if (m.kind === "run") {
    const { kind, ...meta } = m;
    void kind;
    return { ...prev, [id]: { ...cur, meta, status: m.status } };
  }
  const events = [...cur.events, m];
  const meta = m.run ?? cur.meta;
  let status: RunStatus = cur.status;
  if (m.type === "final") status = m.payload?.stopped ? "stopped" : "done";
  else if (m.type === "error") status = "error";
  else status = "running";
  const tools = cur.tools + (m.type === "tool_call" ? 1 : 0);
  const lastStep =
    m.type === "tool_call"
      ? `calling ${String(m.payload.tool)}`
      : m.type === "tool_result"
      ? `${String(m.payload.tool)} → done`
      : m.type === "final"
      ? "finished"
      : m.type === "error"
      ? "error"
      : cur.lastStep;
  return { ...prev, [id]: { meta, events, status, tools, lastStep } };
}

/* ── helpers ───────────────────────────────── */
/* ── arena (M4) ────────────────────────────── */
function ArenaView({ agentTypes }: { agentTypes: AgentType[] }) {
  const [topic, setTopic] = useState("");
  const [aType, setAType] = useState("researcher");
  const [bType, setBType] = useState("planner");
  const [msgs, setMsgs] = useState<ArenaMsg[]>([]);
  const [running, setRunning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const nameOf = (t: string) => agentTypes.find((x) => x.type === t)?.name ?? t;
  const start = async () => {
    const tp = topic.trim();
    if (!tp || running) return;
    setMsgs([]);
    setRunning(true);
    await startArena(tp, aType, bType, 3, (m) => setMsgs((prev) => [...prev, m]));
    setRunning(false);
  };
  const SAMPLES = [
    "Ship fast and messy, or slow and polished?",
    "Should AI agents have long-term memory by default?",
    "Is a monorepo worth it for a small team?",
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "calc(100vh / 1.5 - 74px)", minHeight: 560 }}>
      <div style={{ ...panel, flex: 1 }}>
        <div style={phead}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={mono(11, "var(--text)", ".16em")}>ARENA</span>
            <span style={tagStyle(running ? "accent" : undefined)}>
              {running ? "LIVE" : msgs.length ? "DONE" : "M4 · TWO AGENTS TALK"}
            </span>
          </div>
          <span style={mono(10, "var(--text-faint)")}>{msgs.length} messages</span>
        </div>

        {/* launcher */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <ArenaPicker agentTypes={agentTypes} value={aType} onPick={setAType} disabled={running} />
            <span style={mono(11, "var(--text-faint)", ".1em")}>VS</span>
            <ArenaPicker agentTypes={agentTypes} value={bType} onPick={setBType} disabled={running} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="bare"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="A topic for them to hash out…"
              style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 9, padding: "10px 13px", color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13 }}
            />
            <button
              className="btn-accent"
              onClick={start}
              disabled={running}
              style={{ ...mono(11, "#0c0e11", ".06em"), fontWeight: 600, background: "var(--accent)", border: 0, borderRadius: 9, padding: "0 20px", cursor: running ? "default" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              START
            </button>
          </div>
          {msgs.length === 0 && !running && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {SAMPLES.map((s) => (
                <button key={s} className="btn-ghost" onClick={() => setTopic(s)} style={{ ...mono(10.5, "var(--text-dim)"), background: "transparent", border: "1px solid var(--line)", borderRadius: 20, padding: "5px 12px", cursor: "pointer" }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* the two combatants */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 26px", borderBottom: "1px solid var(--line)", background: "rgba(255,255,255,.012)" }}>
          <ArenaCombatant type={aType} name={nameOf(aType)} side="left" active={running} />
          <span style={mono(12, "var(--text-faint)", ".2em")}>VS</span>
          <ArenaCombatant type={bType} name={nameOf(bType)} side="right" active={running} />
        </div>

        {/* message flow */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--line)", transform: "translateX(-.5px)" }} />
          {msgs.length === 0 && !running && (
            <div style={{ ...mono(12, "var(--text-faint)"), textAlign: "center", marginTop: 34, position: "relative" }}>
              Pick two agents and a topic, then hit START — watch them go back and forth.
            </div>
          )}
          {msgs.map((m, i) => (
            <ArenaMessage key={i} m={m} left={m.from_type === aType} />
          ))}
          {running && (
            <div style={{ textAlign: "center", position: "relative", padding: "4px 0" }}>
              <span style={{ display: "inline-flex", gap: 4 }}>
                {[0, 0.18, 0.36].map((d, i) => (
                  <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: `adaType 1.2s ${d}s infinite` }} />
                ))}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </section>
  );
}

function ArenaPicker({ agentTypes, value, onPick, disabled }: { agentTypes: AgentType[]; value: string; onPick: (t: string) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {agentTypes.map((a) => {
        const on = value === a.type;
        const c = typeColor(a.type);
        return (
          <button
            key={a.type}
            className="btn-ghost"
            onClick={() => !disabled && onPick(a.type)}
            title={a.blurb}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              ...mono(11, on ? "var(--text)" : "var(--text-dim)", ".02em"),
              background: on ? "rgba(255,255,255,.05)" : "transparent",
              border: `1px solid ${on ? c : "var(--line-2)"}`,
              borderRadius: 8,
              padding: "6px 10px",
              cursor: disabled ? "default" : "pointer",
              opacity: disabled && !on ? 0.5 : 1,
            }}
          >
            <span style={{ color: c, display: "inline-flex" }}>
              <PixelAgent name={spriteFor(a.type)} size={16} />
            </span>
            {a.name}
          </button>
        );
      })}
    </div>
  );
}

function ArenaCombatant({ type, name, side, active }: { type: string; name: string; side: "left" | "right"; active: boolean }) {
  const c = typeColor(type);
  return (
    <div style={{ display: "flex", flexDirection: side === "left" ? "row" : "row-reverse", alignItems: "center", gap: 11 }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", color: c, background: "rgba(255,255,255,.03)", border: `1px solid ${c}`, boxShadow: active ? `0 0 22px -6px ${c}` : undefined }}>
        <PixelAgent name={spriteFor(type)} size={16} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: side === "left" ? "flex-start" : "flex-end" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{name}</span>
        <span style={mono(9.5, "var(--text-faint)", ".08em")}>{type.toUpperCase()}</span>
      </div>
    </div>
  );
}

function ArenaMessage({ m, left }: { m: ArenaMsg; left: boolean }) {
  const c = typeColor(m.from_type);
  return (
    <div className="rise" style={{ display: "flex", justifyContent: left ? "flex-start" : "flex-end", position: "relative" }}>
      <div
        style={{
          maxWidth: "70%",
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          borderLeft: left ? `2px solid ${c}` : "1px solid var(--line)",
          borderRight: left ? "1px solid var(--line)" : `2px solid ${c}`,
          borderRadius: left ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
          padding: "10px 13px",
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexDirection: left ? "row" : "row-reverse" }}>
          <span style={{ color: c, display: "inline-flex" }}>
            <PixelAgent name={spriteFor(m.from_type)} size={16} />
          </span>
          <span style={{ ...mono(10.5, c, ".04em"), fontWeight: 600 }}>{m.from}</span>
          <span style={mono(9.5, "var(--text-faint)")}>→ {m.to}</span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
          <Markdown text={m.text} />
        </div>
      </div>
    </div>
  );
}

/* ── mission (M5) — planner decomposes → delegates → synthesizes ── */
// A mission stage: a nowrap label followed by a 1px rule that fills the row.
function Stage({ label, children }: { label: string; children: JSX.Element }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ ...text("caption", "var(--text-lo)"), whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      {children}
    </div>
  );
}

function MissionView({ agentTypes }: { agentTypes: AgentType[] }) {
  const [goal, setGoal] = useState("");
  const [worker, setWorker] = useState("researcher");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const start = async () => {
    const g = goal.trim();
    if (!g || running) return;
    setEvents([]);
    setRunning(true);
    await startMission(g, worker, 3, (e) => setEvents((prev) => [...prev, e]));
    setRunning(false);
  };

  const plan = events.find((e) => e.type === "plan");
  const tasks = (plan?.payload.tasks as string[] | undefined) ?? [];
  const handoffs = events.filter(
    (e) => e.type === "message" && e.payload.from_type !== e.payload.to_type,
  );
  const done = events.filter(
    (e) => e.type === "message" && e.payload.from_type !== "planner",
  ).length;
  const final = events.find((e) => e.type === "final");
  const workerName = agentTypes.find((a) => a.type === worker)?.name ?? worker;
  const results = events.filter((e) => e.type === "message" && e.payload.from_type === worker && e.payload.to_type === "planner");
  const objective = String(plan?.payload.goal ?? goal ?? "");
  const elapsedSec = events.length > 1 ? Math.max(0, events[events.length - 1].ts - events[0].ts) : 0;
  const spend = events.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
  const figures: [string, string][] = [
    ["Agents", String(tasks.length)],
    ["Steps", String(events.length)],
    ["Elapsed", fmtSec(elapsedSec)],
    ["Spend", `$${spend.toFixed(3)}`],
  ];
  const SAMPLES = [
    "Plan a weekend launch of an AI note-taking app",
    "Research and outline a blog post on RAG",
    "Scope an MVP for a habit tracker",
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "calc(100vh / 1.5 - 74px)", minHeight: 560 }}>
      <div style={{ ...panel, flex: 1 }}>
        {/* header — mission id, objective, four figures */}
        <div style={{ ...phead, height: "auto", flexDirection: "column", alignItems: "stretch", gap: 8, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={text("ui")}>Mission</span>
            {running ? (
              <span style={tag("running")}><span style={dot("running", 6)} />running</span>
            ) : final ? (
              <span style={tag("ok")}>done</span>
            ) : (
              <span style={mono(11, "var(--text-lo)")}>Atlas delegates → workers → synthesis</span>
            )}
            <span style={{ flex: 1 }} />
            <span style={mono(11, "var(--text-lo)")}>{tasks.length ? `${Math.min(done, tasks.length)}/${tasks.length} subtasks` : ""}</span>
          </div>
          {objective && <div style={{ ...text("title"), ...shrinkable }}>{objective}</div>}
          {events.length > 0 && (
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              {figures.map(([l, v]) => (
                <div key={l} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={text("caption", "var(--text-lo)")}>{l}</span>
                  <span style={{ ...mono(15, "var(--text-hi)"), lineHeight: "20px" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* launcher */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={text("caption", "var(--text-lo)")}>Atlas delegates to</span>
            <ArenaPicker agentTypes={agentTypes.filter((a) => a.type !== "ada")} value={worker} onPick={setWorker} disabled={running} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="bare"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="A goal to accomplish…"
              style={{ flex: 1, ...inputStyle(), height: "auto", padding: "10px 13px" }}
            />
            <button onClick={start} disabled={running} style={{ ...btn("primary"), height: "auto", padding: "0 20px", opacity: running ? 0.5 : 1 }}>
              Run
            </button>
          </div>
          {events.length === 0 && !running && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {SAMPLES.map((s) => (
                <button key={s} onClick={() => setGoal(s)} style={{ ...btn("ghost"), height: "auto", padding: "6px 12px", borderRadius: "var(--rpill)", ...text("caption", "var(--text-mid)") }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* body — three stages, auto-fit, stack below ~1000px */}
        <div style={{ ...scroller, padding: 16 }}>
          {events.length === 0 && !running ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: "40px 24px" }}>
              <div style={{ opacity: 0.4 }}><PixelAgent name="commander" size={32} /></div>
              <div style={text("title")}>Give Atlas a goal</div>
              <div style={{ ...text("caption", "var(--text-lo)"), maxWidth: 300 }}>It breaks the goal into subtasks, delegates each to a {workerName}, and synthesizes the result.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px,100%),1fr))", gap: 12, alignItems: "start" }}>
              {/* 01 · Plan */}
              <Stage label="01 · Plan">
                <div style={{ ...surface2, padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <PixelAgent name={spriteFor("planner")} size={16} />
                    <span style={text("ui")}>Commander · Atlas</span>
                  </div>
                  {tasks.map((t, i) => {
                    const st = i < done ? "done" : i === done && running ? "running" : "pending";
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ ...mono(12, st === "done" ? "var(--state-ok)" : st === "running" ? "var(--state-running)" : "var(--text-lo)"), flex: "none", width: 16 }}>{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ ...text("caption", st === "pending" ? "var(--text-lo)" : "var(--text-hi)"), lineHeight: 1.5 }}>{t}</span>
                      </div>
                    );
                  })}
                </div>
              </Stage>

              {/* 02 · Execute — elevation encodes state: live work is literally closer */}
              <Stage label="02 · Execute">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {tasks.map((t, i) => {
                    const st = i < done ? "done" : i === done && running ? "running" : "pending";
                    const res = results[i];
                    return (
                      <div
                        key={i}
                        style={{
                          background: st === "running" ? "var(--surface-2)" : "var(--surface-1)",
                          border: `1px solid ${st === "running" ? "rgba(50,145,255,.35)" : "var(--border)"}`,
                          borderRadius: "var(--r-card)",
                          padding: 12,
                          opacity: st === "pending" ? 0.5 : 1,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <PixelAgent name={spriteFor(worker)} size={16} />
                          <span style={{ ...text("ui"), ...shrinkable }}>{workerName}</span>
                          <span style={{ flex: 1 }} />
                          <span style={tag(st === "done" ? "ok" : st === "running" ? "running" : "neutral")}>
                            {st === "running" && <span style={dot("running", 6)} />}
                            {st}
                          </span>
                        </div>
                        <div style={{ ...text("caption", "var(--text-mid)"), lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {res ? String(res.payload.text ?? "") : t}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Stage>

              {/* 03 · Synthesize */}
              <Stage label="03 · Synthesize">
                {final ? (
                  <div style={{ ...surface2, padding: 14 }}>
                    <div style={text("body", "var(--text-hi)")}>
                      <Markdown text={String(final.payload.text ?? "")} />
                    </div>
                  </div>
                ) : (
                  <div style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--r-card)", padding: "28px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                    <span style={text("caption", "var(--text-lo)")}>{running ? "Atlas is waiting on the workers…" : "Synthesis appears once every subtask returns."}</span>
                  </div>
                )}
              </Stage>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </section>
  );
}

// minimal inline markdown so **bold**, *italic*, `code` render instead of showing raw
function renderInline(text: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={k++} style={{ fontWeight: 600, color: "var(--text)" }}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={k++} style={{ fontFamily: "var(--mono)", fontSize: "0.9em", background: "rgba(255,255,255,.06)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 5px" }}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((ln, i) => (
        <span key={i}>
          {renderInline(ln)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function fmt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function fmtMs(ms: number): string {
  if (!ms) return "0ms";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function summarize(events: AgentEvent[]) {
  let cost = 0,
    tools = 0,
    local = 0,
    api = 0,
    timeMs = 0,
    tokens = 0;
  for (const e of events) {
    if (e.cost_usd) cost += e.cost_usd;
    if (e.latency_ms) timeMs += e.latency_ms;
    if (e.tokens) tokens = e.tokens;
    if (e.type === "tool_call") {
      tools++;
      if (e.model?.includes("local")) local++;
      else api++;
    }
  }
  return { cost, tools, local, api, timeMs, tokens };
}
