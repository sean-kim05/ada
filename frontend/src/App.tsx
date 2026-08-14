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
const panel: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r3)",
  boxShadow: "var(--hair-top), var(--sh-2)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minWidth: 0,
};
const phead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--s3) var(--s4)",
  borderBottom: "1px solid var(--line)",
  flex: "none",
};
const mono = (size: number, color = "var(--text)", ls = "0"): CSSProperties => ({
  fontFamily: "var(--mono)",
  fontSize: size,
  color,
  letterSpacing: ls,
});
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

const NAV = [
  { name: "Chat", view: "deck" as const },
  { name: "Agent Trace", view: "deck" as const },
  { name: "Fleet", view: "fleet" as const },
  { name: "Arena", view: "arena" as const },
  { name: "Mission", view: "mission" as const },
  { name: "Calendar", view: "deck" as const },
  { name: "Tasks", view: "deck" as const },
  { name: "Docs", view: "docs" as const, pill: "RAG" },
  { name: "Router", view: "router" as const, pill: "LOCAL" },
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
  const chatEnd = useRef<HTMLDivElement>(null);
  const traceEnd = useRef<HTMLDivElement>(null);

  // No accent hue any more — identity comes from the punch-card mark + type.
  // Keep --accent-rgb defined (white) so any legacy rgba(var(--accent-rgb),…) stays neutral.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent-rgb", "237,237,237");
    document.documentElement.style.setProperty("--tex-op", "0");
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, running]);
  useEffect(() => {
    traceEnd.current?.scrollIntoView({ behavior: "smooth" });
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
  const status = running ? "RUNNING" : events.length ? "DONE" : "READY";
  const statusColor = running ? "var(--accent)" : events.length ? "var(--accent)" : "var(--text-faint)";

  return (
    <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "236px minmax(0,1fr)", minHeight: "calc(100vh / 1.5)" }}>
      {/* ═══ LEFT RAIL ═══ */}
      <aside
        style={{
          position: "sticky",
          top: 0,
          height: "calc(100vh / 1.5)",
          borderRight: "1px solid var(--line)",
          background: "linear-gradient(180deg, rgba(255,255,255,.014), transparent 40%)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            style={{
              width: 38,
              height: 38,
              flex: "none",
              borderRadius: 10,
              background: "linear-gradient(160deg,#161b24,#0d1017)",
              border: "1px solid rgba(var(--accent-rgb),.42)",
              boxShadow: "0 0 24px -8px rgba(var(--accent-rgb),.7), inset 0 1px 0 rgba(255,255,255,.05)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <PunchA size={23} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 5 }}>
              <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.015em", lineHeight: 0.85 }}>Ada</span>
              <span
                style={{
                  width: 6,
                  height: 15,
                  marginBottom: 2,
                  background: "var(--accent)",
                  borderRadius: 1,
                  boxShadow: "0 0 8px rgba(var(--accent-rgb),.6)",
                  animation: "adaCursor 1.1s steps(1) infinite",
                }}
              />
            </div>
            <span style={mono(8, "var(--text-faint)", ".2em")}>AGENT OS TERMINAL</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "14px 0 0 3px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", animation: "adaPulse 2.4s ease-in-out infinite" }} />
          <span style={mono(9.5, "var(--accent)", ".14em")}>ONLINE</span>
          <span style={mono(9.5, "var(--text-faint)", ".1em")}>· HAIKU</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 28 }}>
          {NAV.map((n) => {
            const active = view === n.view && (n.view !== "deck" || n.name === "Chat");
            return (
            <div
              key={n.name}
              onClick={() => setView(n.view)}
              className={`nav-item${active ? " active" : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 11px",
                borderRadius: 8,
                cursor: "pointer",
                color: active ? "var(--accent)" : "var(--text-dim)",
                background: active ? "rgba(var(--accent-rgb),.08)" : undefined,
                boxShadow: active ? "inset 2px 0 0 var(--accent)" : undefined,
              }}
            >
              <NavIcon name={n.name} />
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{n.name}</span>
              {n.pill && <span style={{ ...mono(8.5, "var(--text-faint)", ".1em"), border: "1px solid var(--line)", borderRadius: 4, padding: "1px 4px", marginLeft: "auto" }}>{n.pill}</span>}
            </div>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <RailStat label="SPEND TODAY" value={`$${t.cost.toFixed(3)}`} accent />
          <RailStat label="TOOL CALLS" value={String(t.tools)} />
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", ...mono(9, "var(--text-faint)", ".1em"), marginBottom: 6 }}>
              <span>LOCAL {localPct}%</span>
              <span>API {100 - localPct}%</span>
            </div>
            <div style={{ height: 5, borderRadius: 4, overflow: "hidden", display: "flex", background: "rgba(255,255,255,.05)" }}>
              <div style={{ width: `${localPct}%`, background: "var(--accent)" }} />
              <div style={{ width: 2 }} />
              <div style={{ flex: 1, background: "rgba(255,255,255,.22)" }} />
            </div>
          </div>
          <ThemeBar accent={accent} setAccent={setAccent} grid={grid} setGrid={setGrid} />
        </div>
      </aside>

      {/* ═══ WORKSPACE ═══ */}
      <main style={{ padding: "18px 20px 22px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {view === "deck" ? (
        <>
        {/* header */}
        <header style={{ height: 40, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={mono(12, "var(--text)", ".14em")}>MISSION DECK</span>
            <span style={mono(11, "var(--text-faint)", ".1em")}>M1 · SECRETARY · LIVE</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <HeaderPill text="ROUTER · AUTO" />
            <HeaderPill text="MODEL · HAIKU" />
            <HeaderPill text={`CTX · ${events.length ? Math.min(99, events.length * 3) : 0}%`} accent />
          </div>
        </header>

        {/* top zone: chat + trace */}
        <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 16, height: "calc(100vh / 1.5 - 74px)", minHeight: 560 }}>
          {/* CHAT */}
          <div style={panel}>
            <div style={phead}>
              <span style={mono(11, "var(--text-dim)", ".16em")}>CHAT</span>
              <span style={mono(10, "var(--text-faint)", ".08em")}>SESSION · TODAY</span>
            </div>
            {msgs.length <= 1 && !running ? (
              <div style={{ flex: 1, overflowY: "auto", padding: "var(--s5) var(--s5)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
                <div style={{ opacity: 0.5, marginBottom: 18 }}><PunchA size={34} /></div>
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em", color: "var(--text)", marginBottom: 8 }}>How can I help, Sean?</div>
                <div style={{ ...mono(11.5, "var(--text-faint)", ".02em"), maxWidth: 300, textAlign: "center", lineHeight: 1.6, marginBottom: 24 }}>
                  Your secretary and agent runtime. Ask, and watch the plan run live on the right.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 340 }}>
                  {CHAT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="row-hover"
                      onClick={() => sendText(s)}
                      style={{ textAlign: "left", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "var(--r2)", padding: "11px 13px", cursor: "pointer", color: "var(--text-dim)", fontFamily: "var(--sans)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", opacity: 0.85 }}><path d="M5 12h13M12 5l7 7-7 7" /></svg>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", padding: "var(--s5) 18px", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 18 }}>
                {msgs.map((m, i) => (
                  <Message key={i} msg={m} />
                ))}
                {running && <Working />}
                <div ref={chatEnd} />
              </div>
            )}
            <div style={{ flex: "none", padding: "14px 16px", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 11, padding: "4px 4px 4px 14px" }}>
                <input
                  className="bare"
                  value={input}
                  placeholder={running ? "Steer Ada while she works…" : "Message Ada…"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendText(input)}
                  style={{ flex: 1, color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13.5, padding: "8px 0" }}
                />
                <button
                  className="btn-accent"
                  onClick={() => sendText(input)}
                  title={running ? "Steer the running task" : "Send"}
                  style={{ width: 34, height: 34, flex: "none", borderRadius: 8, background: "var(--accent)", border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", opacity: 1 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0c0e11" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h13M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* AGENT TRACE (hero) */}
          <div style={{ ...panel, boxShadow: "inset 0 1px 0 rgba(255,255,255,.03), 0 1px 2px rgba(0,0,0,.45), 0 0 40px -20px rgba(var(--accent-rgb),.3)" }}>
            <div style={phead}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={mono(11, "var(--text)", ".16em")}>AGENT TRACE</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, ...tagStyle("accent"), fontWeight: 400 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: running ? "adaBlink 1.1s infinite" : "none" }} />
                  {status}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={mono(10.5, "var(--text-faint)")}>{events.length} steps</span>
                <button className="btn-ghost" onClick={replay} disabled={running} style={{ display: "inline-flex", alignItems: "center", gap: 5, ...mono(10, "var(--text-dim)", ".06em"), background: "transparent", border: "1px solid var(--line-2)", borderRadius: 6, padding: "4px 9px", cursor: running ? "default" : "pointer" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
                  </svg>
                  REPLAY
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 0 }}>
              {events.length === 0 ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center", padding: "24px 20px" }}>
                  <div style={{ opacity: 0.35 }}><PunchA size={30} /></div>
                  <div style={mono(12, "var(--text-dim)", ".04em")}>waiting for a run</div>
                  <div style={{ ...mono(11, "var(--text-faint)", ".02em"), maxWidth: 240, lineHeight: 1.6 }}>
                    Send a message and Ada's plan streams here — <span style={{ color: "var(--text-dim)" }}>plan → act → observe</span>.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ ...mono(10, "var(--text-faint)", ".08em"), paddingLeft: 2, marginBottom: 14 }}>
                    {events[0].run_id} · plan → act → observe
                  </div>
                  {events.map((e, i) => (
                    <TraceRow key={i} e={e} last={i === events.length - 1} />
                  ))}
                </>
              )}
              <div ref={traceEnd} />
            </div>
            <div style={{ flex: "none", borderTop: "1px solid var(--line)", background: "rgba(255,255,255,.015)", padding: "11px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...mono(11, statusColor, ".06em") }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
                {status}
              </span>
              <span style={{ width: 1, height: 14, background: "var(--line-2)" }} />
              <span style={mono(12, "var(--text)")}>
                <span style={mono(10, "var(--text-faint)")}>TOOLS </span>
                {t.tools}
              </span>
              <span style={mono(12, "var(--text)")}>{fmtMs(t.timeMs)}</span>
              <span style={mono(12, "var(--accent)")}>${t.cost.toFixed(3)}</span>
              <span style={{ marginLeft: "auto", ...mono(11, "var(--text-faint)") }}>{t.tokens ? `${t.tokens} tok` : "—"}</span>
            </div>
          </div>
        </section>

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
function Avatar() {
  return (
    <div style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", background: "rgba(var(--accent-rgb),.1)", border: "1px solid rgba(var(--accent-rgb),.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <PunchA size={15} />
    </div>
  );
}
function Message({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="rise" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, alignSelf: "flex-end", maxWidth: "82%" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {msg.time && <span style={mono(10, "var(--text-faint)")}>{msg.time}</span>}
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>You</span>
        </div>
        <div style={{ background: "rgba(var(--accent-rgb),.1)", border: "1px solid rgba(var(--accent-rgb),.24)", borderRadius: "12px 4px 12px 12px", padding: "11px 14px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text)" }}>{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="rise" style={{ display: "flex", gap: 11, maxWidth: "90%" }}>
      <Avatar />
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Ada</span>
          {msg.time && <span style={mono(10, "var(--text-faint)")}>{msg.time}</span>}
        </div>
        <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "4px 12px 12px 12px", padding: "11px 13px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text)" }}><Markdown text={msg.text} /></div>
      </div>
    </div>
  );
}
function Working() {
  return (
    <div style={{ display: "flex", gap: 11, maxWidth: "90%" }}>
      <Avatar />
      <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, width: "fit-content" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 0.18, 0.36].map((d, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: `adaType 1.2s ${d}s infinite` }} />
          ))}
        </div>
        <span style={mono(11, "var(--text-dim)", ".06em")}>running plan · watch the trace →</span>
      </div>
    </div>
  );
}

/* ── trace timeline ────────────────────────── */
function TraceRow({ e, last }: { e: AgentEvent; last: boolean }) {
  const lat = e.latency_ms != null ? `${e.latency_ms}ms` : "";
  const isLocal = e.model?.includes("local");
  const kind = e.type;
  const dot =
    kind === "final" ? "var(--accent)" : kind === "error" ? "var(--red)" : kind === "message" ? "var(--accent)" : kind === "tool_result" ? "rgba(var(--accent-rgb),.6)" : "var(--text-dim)";
  const glow = kind === "final" ? "0 0 10px rgba(var(--accent-rgb),.7)" : "none";

  let content: JSX.Element | null = null;
  if (kind === "tool_call") {
    const detail = fmt(e.payload.input);
    content = (
      <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={tagStyle()}>TOOL</span>
          <span style={{ ...mono(12, "var(--text)"), fontWeight: 500 }}>{String(e.payload.tool)}</span>
          <span style={{ flex: 1 }} />
          {e.model && <span style={modelBadge}>{isLocal ? "QWEN" : "CLAUDE"}</span>}
          <span style={mono(11, "var(--text-faint)")}>{lat}</span>
        </div>
        {detail && <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text-dim)", wordBreak: "break-word" }}>{detail}</div>}
      </div>
    );
  } else if (kind === "tool_result") {
    content = (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "1px 2px" }}>
        <span style={mono(12, "var(--accent)")}>↳</span>
        <span style={{ ...mono(12, "var(--text-dim)"), lineHeight: 1.45, flex: 1, wordBreak: "break-word" }}>{fmt(e.payload.output)}</span>
        <span style={mono(10.5, "var(--text-faint)")}>{lat}</span>
      </div>
    );
  } else if (kind === "final") {
    content = (
      <div style={{ background: "linear-gradient(180deg, rgba(var(--accent-rgb),.06), transparent 82%)", border: "1px solid rgba(var(--accent-rgb),.3)", borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={tagStyle("accent")}>FINAL</span>
          <span style={{ flex: 1 }} />
          <span style={modelBadge}>CLAUDE</span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}><Markdown text={String(e.payload.text ?? "")} /></div>
      </div>
    );
  } else if (kind === "error") {
    content = (
      <div style={{ background: "rgba(255,138,128,.05)", border: "1px solid rgba(255,138,128,.3)", borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={tagStyle("error")}>ERROR</span>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text-dim)" }}>{String(e.payload.message ?? "")}</div>
      </div>
    );
  } else if (kind === "message") {
    // A user steer injected mid-task (payload.steer), or an agent→agent handoff (Arena/Mission).
    const steer = Boolean(e.payload.steer);
    content = (
      <div style={{ background: steer ? "rgba(var(--accent-rgb),.06)" : "var(--panel-2)", border: `1px solid ${steer ? "rgba(var(--accent-rgb),.28)" : "var(--line)"}`, borderRadius: 10, padding: "9px 13px", display: "flex", alignItems: "baseline", gap: 9 }}>
        <span style={{ ...mono(10, "var(--accent)", ".1em"), fontWeight: 600, flex: "none" }}>{steer ? "YOU ▸" : `${String(e.payload.from ?? "msg")} ▸`}</span>
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text)", flex: 1, wordBreak: "break-word" }}>{String(e.payload.text ?? "")}</span>
        {steer && <span style={{ ...mono(9, "var(--text-faint)", ".1em"), flex: "none" }}>STEER</span>}
      </div>
    );
  }
  if (!content) return null;

  return (
    <div className="rise" style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: 11 }}>
      <div style={{ position: "relative" }}>
        {!last && <div style={{ position: "absolute", left: "50%", top: 5, bottom: -14, width: 1, transform: "translateX(-.5px)", background: "var(--line)" }} />}
        <div style={{ position: "absolute", left: "50%", top: 5, width: 9, height: 9, borderRadius: "50%", transform: "translateX(-50%)", border: "2px solid var(--bg)", background: dot, boxShadow: glow }} />
      </div>
      <div style={{ paddingBottom: 14, minWidth: 0 }}>{content}</div>
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
function FleetView(p: FleetProps) {
  const [tab, setTab] = useState<"trace" | "terminal" | "diff">("trace");
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={mono(11, "var(--text)", ".16em")}>FLEET</span>
            <span style={tagStyle(running ? "accent" : undefined)}>
              {running} RUNNING · {runs.length} TOTAL
            </span>
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
                    <AgentGlyph type={a.type} size={14} />
                  </span>
                  {a.name}
                </button>
              );
            })}
          </div>
          {launchBlurb && (
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: typeColor(p.launchType), display: "inline-flex" }}>
                <AgentGlyph type={p.launchType} size={13} />
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
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(228px,1fr))", gap: 12, alignContent: "start" }}>
          {runs.length === 0 && (
            <div style={{ ...mono(12, "var(--text-faint)"), gridColumn: "1/-1", padding: "8px 2px", lineHeight: 1.6 }}>
              No agents running. Launch one above — or in Chat, ask Ada to “spawn a researcher on …” and it appears here.
            </div>
          )}
          {runs.map((r) => (
            <FleetCard key={r.id} id={r.id} run={r} focused={r.id === focusId} onClick={() => p.setFocused(r.id)} clock={p.clock} />
          ))}
        </div>
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
            {focusRun && focusRun.events.map((e, i) => <TraceRow key={i} e={e} last={i === focusRun.events.length - 1} />)}
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

function FleetCard({ id, run, focused, onClick, clock }: { id: string; run: FleetRun; focused: boolean; onClick: () => void; clock: number }) {
  const meta = run.meta;
  const accent = accentColor(
    meta?.agent_type === "researcher" ? "cyan"
      : meta?.agent_type === "planner" ? "violet"
      : meta?.agent_type === "claude_code" ? "green"
      : "amber",
  );
  const sc = run.status === "running" ? "var(--accent)" : run.status === "error" ? "var(--red)" : "var(--text-dim)";
  const elapsed = meta ? Math.max(0, Math.floor(clock - meta.started_at)) : 0;
  return (
    <div
      onClick={onClick}
      className="row-hover"
      style={{ background: "var(--panel-2)", border: `1px solid ${focused ? "rgba(var(--accent-rgb),.45)" : "var(--line)"}`, borderRadius: 11, padding: "13px 14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 9, boxShadow: focused ? "0 0 24px -14px var(--accent)" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 24, height: 24, flex: "none", borderRadius: 7, display: "grid", placeItems: "center", color: accent, background: "rgba(255,255,255,.03)", border: `1px solid ${focused ? accent : "var(--line-2)"}`, boxShadow: run.status === "running" ? `0 0 10px -2px ${accent}` : undefined }}>
          <AgentGlyph type={meta?.agent_type} size={14} />
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{meta?.name ?? "agent"}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, ...mono(9.5, sc, ".1em") }}>
          {run.status === "running" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "adaBlink 1.1s infinite" }} />}
          {run.status.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.4, minHeight: 34, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta?.prompt ?? id}</div>
      {meta?.agent_type === "claude_code" && meta?.workdir && (
        <div style={{ ...mono(10, "var(--text-faint)", ".02em"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={meta.workdir}>
          ▸ {shortPath(meta.workdir)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...mono(10.5, "var(--text-faint)") }}>
        <span>{run.events.length} steps</span>
        {!!meta?.tokens && <span>· {fmtTokens(meta.tokens)} tok</span>}
        {!!meta?.cost_usd && <span>· ${meta.cost_usd.toFixed(3)}</span>}
        <span style={{ marginLeft: "auto" }}>{fmtUptime(elapsed)}</span>
      </div>
      {run.lastStep && (
        <div style={{ ...mono(10.5, run.status === "running" ? "var(--accent)" : "var(--text-faint)"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.lastStep}</div>
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
              <AgentGlyph type={a.type} size={13} />
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
        <AgentGlyph type={type} size={20} />
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
            <AgentGlyph type={m.from_type} size={12} />
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
  const SAMPLES = [
    "Plan a weekend launch of an AI note-taking app",
    "Research and outline a blog post on RAG",
    "Scope an MVP for a habit tracker",
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "calc(100vh / 1.5 - 74px)", minHeight: 560 }}>
      <div style={{ ...panel, flex: 1 }}>
        <div style={phead}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={mono(11, "var(--text)", ".16em")}>MISSION</span>
            <span style={tagStyle(running ? "accent" : undefined)}>
              {running ? "RUNNING" : final ? "DONE" : "M5 · PLANNER DELEGATES"}
            </span>
          </div>
          <span style={mono(10, "var(--text-faint)")}>{tasks.length ? `${Math.min(done, tasks.length)}/${tasks.length} subtasks` : ""}</span>
        </div>

        {/* launcher */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={mono(10.5, "var(--text-faint)", ".08em")}>ATLAS DELEGATES TO</span>
            <ArenaPicker agentTypes={agentTypes.filter((a) => a.type !== "ada")} value={worker} onPick={setWorker} disabled={running} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="bare"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="A goal to accomplish…"
              style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 9, padding: "10px 13px", color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13 }}
            />
            <button
              className="btn-accent"
              onClick={start}
              disabled={running}
              style={{ ...mono(11, "#0c0e11", ".06em"), fontWeight: 600, background: "var(--accent)", border: 0, borderRadius: 9, padding: "0 20px", cursor: running ? "default" : "pointer", opacity: running ? 0.5 : 1 }}
            >
              RUN
            </button>
          </div>
          {events.length === 0 && !running && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {SAMPLES.map((s) => (
                <button key={s} className="btn-ghost" onClick={() => setGoal(s)} style={{ ...mono(10.5, "var(--text-dim)"), background: "transparent", border: "1px solid var(--line)", borderRadius: 20, padding: "5px 12px", cursor: "pointer" }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {events.length === 0 && !running && (
            <div style={{ ...mono(12, "var(--text-faint)"), textAlign: "center", marginTop: 34 }}>
              Give Atlas a goal — it breaks it into subtasks, delegates each to a {workerName}, and synthesizes the result.
            </div>
          )}

          {/* plan */}
          {tasks.length > 0 && (
            <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 11, padding: "13px 15px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
                <span style={{ color: typeColor("planner"), display: "inline-flex" }}>
                  <AgentGlyph type="planner" size={15} />
                </span>
                <span style={mono(10.5, "var(--text-dim)", ".1em")}>ATLAS · PLAN</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {tasks.map((t, i) => {
                  const st = i < done ? "done" : i === done && running ? "running" : "pending";
                  const c = st === "done" ? typeColor("planner") : st === "running" ? "var(--accent)" : "var(--text-faint)";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ marginTop: 1, width: 16, height: 16, flex: "none", borderRadius: "50%", border: `1px solid ${c}`, background: st === "done" ? c : "transparent", display: "grid", placeItems: "center" }}>
                        {st === "done" && (
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#0c0e11" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 6.2 5 8.6 9.5 3.6" />
                          </svg>
                        )}
                        {st === "running" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "adaBlink 1.1s infinite" }} />}
                      </span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.45, color: st === "pending" ? "var(--text-dim)" : "var(--text)" }}>{t}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* handoffs */}
          {handoffs.map((m, i) => (
            <ArenaMessage key={i} m={m.payload as unknown as ArenaMsg} left={m.payload.from_type === "planner"} />
          ))}

          {/* synthesis */}
          {final && (
            <div style={{ background: "linear-gradient(180deg, rgba(var(--accent-rgb),.06), transparent 82%)", border: "1px solid rgba(var(--accent-rgb),.3)", borderRadius: 11, padding: "13px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ ...tagStyle("accent"), alignSelf: "flex-start" }}>SYNTHESIS</span>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
                <Markdown text={String(final.payload.text ?? "")} />
              </div>
            </div>
          )}

          {running && !final && (
            <div style={{ textAlign: "center", padding: "4px 0" }}>
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
