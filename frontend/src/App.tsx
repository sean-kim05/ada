import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  startRun,
  spawnAgent,
  listAgents,
  openFleet,
  type AgentEvent,
  type AgentType,
  type RunSnapshot,
  type RunStatus,
  type FleetMsg,
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
  borderRadius: 13,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.03), 0 1px 2px rgba(0,0,0,.45)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minWidth: 0,
};
const phead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "13px 16px",
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
};
const NavIcon = ({ name }: { name: string }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name]}
  </svg>
);

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
  { name: "Calendar", view: "deck" as const },
  { name: "Tasks", view: "deck" as const },
  { name: "Docs", view: "deck" as const, pill: "RAG" },
];

/* ── demo data for the side panels (wired to real tools later) ── */
const HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const CAL_EVENTS = [
  { top: 30, height: 34, time: "09:30", title: "Standup", kind: "dim" as const },
  { top: 90, height: 34, time: "11:00", title: "1:1 · Priya", kind: "dim" as const },
  { top: 290, height: 34, time: "16:00", title: "Design Sync", kind: "accent" as const, was: "was 15:00" },
  { top: 330, height: 40, time: "17:00", title: "Focus block", kind: "normal" as const },
];
const REMINDERS = [
  { text: "Call the dentist", when: "2:00 PM", active: true },
  { text: "Renew ada.computer domain", when: "TMRW" },
  { text: "Sarah's birthday", when: "FRI" },
];
const INITIAL_TASKS = [
  { text: "Reply to Priya about specs", due: "2 PM", done: false },
  { text: "Prep for the Joby panel", due: "Today", done: false },
  { text: "Review Q3 roadmap draft", due: "Wed", done: true },
];

const GREETING: ChatMsg = {
  role: "ada",
  text:
    "Morning. I'm Ada — your secretary. Ask me to manage tasks, your calendar, or email, and watch the plan run live in the trace on the right.",
  time: "",
};

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function App() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([GREETING]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [newTask, setNewTask] = useState("");
  const [view, setView] = useState<"deck" | "fleet">("deck");
  const [fleet, setFleet] = useState<Record<string, FleetRun>>({});
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [launchType, setLaunchType] = useState("researcher");
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const chatEnd = useRef<HTMLDivElement>(null);
  const traceEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, running]);
  useEffect(() => {
    traceEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // launcher agent types + the always-on fleet feed (every agent, one socket)
  useEffect(() => {
    listAgents().then(setAgentTypes).catch(() => {});
  }, []);
  useEffect(() => openFleet((m) => setFleet((prev) => reduceFleet(prev, m))), []);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  async function sendText(text: string) {
    text = text.trim();
    if (!text || running) return;
    setMsgs((m) => [...m, { role: "user", text, time: now() }]);
    setInput("");
    setEvents([]);
    setRunning(true);
    await startRun(text, (e) => {
      setEvents((prev) => [...prev, e]);
      if (e.type === "final") setMsgs((m) => [...m, { role: "ada", text: String(e.payload.text ?? ""), time: now() }]);
      if (e.type === "error") setMsgs((m) => [...m, { role: "ada", text: `Something broke: ${e.payload.message}`, time: now() }]);
    });
    setRunning(false);
  }
  const replay = () => {
    const last = [...msgs].reverse().find((m) => m.role === "user");
    if (last) sendText(last.text);
  };
  const launch = async () => {
    const p = launchPrompt.trim();
    if (!p) return;
    setLaunchPrompt("");
    const id = await spawnAgent(launchType, p);
    setFocused(id);
  };

  const t = summarize(events);
  const localPct = t.tools ? Math.round((t.local / t.tools) * 100) : 0;
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
              background: "linear-gradient(160deg,#13161f,#090b0f)",
              border: "1px solid var(--line-2)",
              boxShadow: "0 0 24px -8px rgba(var(--accent-rgb),.6), inset 0 1px 0 rgba(255,255,255,.06)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <PunchA size={23} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 5 }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 23, fontWeight: 600, letterSpacing: ".015em", lineHeight: 0.8 }}>ADA</span>
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
            const active = n.name === (view === "fleet" ? "Fleet" : "Chat");
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
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
              {msgs.map((m, i) => (
                <Message key={i} msg={m} />
              ))}
              {running && <Working />}
              <div ref={chatEnd} />
            </div>
            <div style={{ flex: "none", padding: "14px 16px", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 11, padding: "4px 4px 4px 14px" }}>
                <input
                  className="bare"
                  value={input}
                  placeholder="Message Ada…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendText(input)}
                  style={{ flex: 1, color: "var(--text)", fontFamily: "var(--sans)", fontSize: 13.5, padding: "8px 0" }}
                />
                <button
                  className="btn-accent"
                  onClick={() => sendText(input)}
                  disabled={running}
                  style={{ width: 34, height: 34, flex: "none", borderRadius: 8, background: "var(--accent)", border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: running ? "default" : "pointer", opacity: running ? 0.5 : 1 }}
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
              <div style={{ ...mono(10, "var(--text-faint)", ".08em"), paddingLeft: 2, marginBottom: 14 }}>
                {events[0] ? `${events[0].run_id} · plan → act → observe` : "waiting for a run · plan → act → observe"}
              </div>
              {events.length === 0 && <div style={{ ...mono(12, "var(--text-faint)"), padding: "8px 2px" }}>Send a message — steps stream here as Ada thinks.</div>}
              {events.map((e, i) => (
                <TraceRow key={i} e={e} last={i === events.length - 1} />
              ))}
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
          <CalendarPanel />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <TodoPanel
              tasks={tasks}
              newTask={newTask}
              setNewTask={setNewTask}
              onToggle={(i) => setTasks((ts) => ts.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              onAdd={() => {
                const v = newTask.trim();
                if (!v) return;
                setTasks((ts) => [...ts, { text: v, due: "", done: false }]);
                setNewTask("");
              }}
            />
            <RemindersPanel />
          </div>
        </section>
        </>
        ) : (
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
            clock={clock}
          />
        )}
      </main>
    </div>
  );
}

/* ── chat pieces ───────────────────────────── */
function Avatar() {
  return (
    <div style={{ width: 26, height: 26, flex: "none", borderRadius: 7, background: "rgba(var(--accent-rgb),.12)", border: "1px solid rgba(var(--accent-rgb),.3)", display: "flex", alignItems: "center", justifyContent: "center", ...mono(13, "var(--accent)"), fontWeight: 600 }}>
      A
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
        <div style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "4px 12px 12px 12px", padding: "11px 13px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text)" }}>{msg.text}</div>
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
    kind === "final" ? "var(--accent)" : kind === "error" ? "var(--red)" : kind === "tool_result" ? "rgba(var(--accent-rgb),.6)" : "var(--text-dim)";
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
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>{String(e.payload.text ?? "")}</div>
      </div>
    );
  } else if (kind === "error") {
    content = (
      <div style={{ background: "rgba(255,138,128,.05)", border: "1px solid rgba(255,138,128,.3)", borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={tagStyle("error")}>ERROR</span>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text-dim)" }}>{String(e.payload.message ?? "")}</div>
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

/* ── side panels (demo) ────────────────────── */
function CalendarPanel() {
  return (
    <div style={{ ...panel, boxShadow: panel.boxShadow }}>
      <div style={phead}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={mono(11, "var(--text-dim)", ".16em")}>CALENDAR</span>
          <span style={mono(9.5, "var(--text-faint)", ".1em")}>DAY · DEMO</span>
        </div>
        <span style={{ ...mono(10, "var(--accent)"), border: "1px solid rgba(var(--accent-rgb),.3)", background: "rgba(var(--accent-rgb),.07)", borderRadius: 5, padding: "2px 7px" }}>4 EVENTS</span>
      </div>
      <div style={{ position: "relative", height: 384, padding: "0 16px" }}>
        {HOURS.map((h, i) => (
          <div key={h}>
            <div style={{ position: "absolute", left: 52, right: 16, top: 10 + i * 40, height: 1, background: "var(--line)" }} />
            <div style={{ position: "absolute", left: 16, top: 4 + i * 40, ...mono(9.5, "var(--text-faint)") }}>{h}</div>
          </div>
        ))}
        {/* now line */}
        <div style={{ position: "absolute", left: 44, right: 16, top: 183, height: 1, background: "var(--accent)", opacity: 0.85, zIndex: 3 }} />
        <div style={{ position: "absolute", left: 40, top: 180, width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px rgba(var(--accent-rgb),.7)", zIndex: 3 }} />
        {CAL_EVENTS.map((ev, i) => {
          const accent = ev.kind === "accent";
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 58,
                right: 16,
                top: ev.top,
                height: ev.height,
                background: accent ? "rgba(var(--accent-rgb),.09)" : "var(--panel-2)",
                border: accent ? "1px solid rgba(var(--accent-rgb),.36)" : "1px solid var(--line)",
                borderLeft: `2px solid ${accent ? "var(--accent)" : ev.kind === "normal" ? "var(--text-dim)" : "var(--text-faint)"}`,
                borderRadius: 7,
                padding: "0 11px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: ev.kind === "dim" ? 0.55 : 1,
                boxShadow: accent ? "0 0 24px -10px rgba(var(--accent-rgb),.7)" : undefined,
                zIndex: accent ? 2 : 1,
              }}
            >
              <span style={mono(11, accent ? "var(--accent)" : "var(--text-dim)")}>{ev.time}</span>
              <span style={{ fontSize: 12.5, color: accent ? "var(--text)" : undefined }}>{ev.title}</span>
              {ev.was && <span style={{ ...mono(9, "var(--text-faint)"), textDecoration: "line-through", marginLeft: "auto" }}>{ev.was}</span>}
            </div>
          );
        })}
      </div>
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
  tasks: typeof INITIAL_TASKS;
  newTask: string;
  setNewTask: (v: string) => void;
  onToggle: (i: number) => void;
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
        {tasks.map((t, i) => (
          <div key={i} className="row-hover" onClick={() => onToggle(i)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
            <div style={{ width: 17, height: 17, flex: "none", borderRadius: 5, border: `1px solid ${t.done ? "var(--accent)" : "var(--line-2)"}`, background: t.done ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {t.done && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#0c0e11" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.2 5 8.6 9.5 3.6" />
                </svg>
              )}
            </div>
            <span style={{ fontSize: 13, flex: 1, color: t.done ? "var(--text-faint)" : "var(--text)", textDecoration: t.done ? "line-through" : undefined }}>{t.text}</span>
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

function RemindersPanel() {
  return (
    <div style={panel}>
      <div style={phead}>
        <span style={mono(11, "var(--text-dim)", ".16em")}>REMINDERS</span>
        <span style={mono(10, "var(--text-faint)")}>{REMINDERS.length}</span>
      </div>
      <div>
        {REMINDERS.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderBottom: i < REMINDERS.length - 1 ? "1px solid var(--line)" : undefined }}>
            <span style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", background: r.active ? "var(--accent)" : "var(--line-2)", boxShadow: r.active ? "0 0 8px rgba(var(--accent-rgb),.7)" : undefined }} />
            <span style={{ fontSize: 13, flex: 1 }}>{r.text}</span>
            <span style={mono(10.5, r.active ? "var(--accent)" : "var(--text-faint)")}>{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── small bits ────────────────────────────── */
function RailStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={mono(9.5, "var(--text-faint)", ".13em")}>{label}</span>
      <span style={mono(13, accent ? "var(--accent)" : "var(--text)")}>{value}</span>
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
  clock: number;
}
function FleetView(p: FleetProps) {
  const [tab, setTab] = useState<"trace" | "terminal">("trace");
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
  // auto-show the Terminal for coding agents, the Trace for the rest
  const isCoder = focusRun?.meta?.agent_type === "claude_code";
  useEffect(() => {
    setTab(isCoder ? "terminal" : "trace");
  }, [focusId, isCoder]);

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
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: accentColor(a.accent) }} />
                  {a.name}
                </button>
              );
            })}
          </div>
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
            {(["trace", "terminal"] as const).map((tb) => (
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
                {tb === "trace" ? "TRACE" : "TERMINAL"}
              </span>
            ))}
          </div>
          {focusRun?.meta && (
            <span style={mono(10, "var(--text-faint)")}>
              {focusRun.meta.name} · {focusId}
            </span>
          )}
        </div>
        {tab === "terminal" ? (
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
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, boxShadow: run.status === "running" ? `0 0 8px ${accent}` : undefined }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{meta?.name ?? "agent"}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, ...mono(9.5, sc, ".1em") }}>
          {run.status === "running" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "adaBlink 1.1s infinite" }} />}
          {run.status.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.4, minHeight: 34, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta?.prompt ?? id}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, ...mono(10.5, "var(--text-faint)") }}>
        <span>{run.tools} tools</span>
        <span>·</span>
        <span>{run.events.length} steps</span>
        <span style={{ marginLeft: "auto" }}>{elapsed}s</span>
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
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", background: "#07090d", borderRadius: "0 0 13px 13px" }}>
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
  if (m.type === "final") status = "done";
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
