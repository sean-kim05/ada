/**
 * Fleet gantt data adapter.
 *
 * WHY THIS FILE EXISTS
 * The time-axis Fleet view needs a start AND an end per step to draw a bar. Ada's event
 * stream may only record arrival ("this step happened at T"). Rather than making that a
 * blocker, this adapter accepts whichever shape the stream actually emits and always
 * produces drawable spans — so the gantt ships either way.
 *
 * Precision, best to worst:
 *   1. startedAt + endedAt        exact
 *   2. startedAt + durationMs     exact
 *   3. at + durationMs            exact (treats `at` as completion time)
 *   4. at only                    DERIVED — span runs from the agent's previous event
 *                                 to this one. Marked derived: true.
 *
 * Case 4 still shows cross-agent parallelism correctly, because each agent has its own
 * arrival series on a shared wall clock. What it cannot show is idle gaps *within* one
 * agent — so derived bars must be drawn differently (see RENDERING below) rather than
 * silently implying precision that isn't there.
 *
 * RENDERING a derived span: same geometry, but fill with a 45-degree hatch
 *   `repeating-linear-gradient(45deg, <hue> 0 3px, transparent 3px 6px)`
 * and show a single footnote under the axis: "Durations inferred from step arrival."
 * Never render a derived bar identically to a measured one.
 */

export type RawEvent = {
  id: string;
  agentId: string;
  phase?: "plan" | "act" | "observe";
  tool?: string;
  title?: string;
  status?: "ok" | "error" | "running" | "queued";
  /** Preferred: explicit window. */
  startedAt?: number;
  endedAt?: number;
  /** Fallback: arrival timestamp (ms epoch). Treated as the moment the step completed. */
  at?: number;
  /** Fallback: measured duration in ms. */
  durationMs?: number;
};

export type Span = {
  id: string;
  agentId: string;
  tool?: string;
  title?: string;
  status: "ok" | "error" | "running" | "queued";
  phase: "plan" | "act" | "observe";
  startMs: number;
  endMs: number;
  /** Percentages of the run window — feed straight into `left` / `width`. */
  leftPct: number;
  widthPct: number;
  /** True when the window was inferred rather than measured. Draw hatched. */
  derived: boolean;
};

export type Lane = {
  agentId: string;
  spans: Span[];
  /** Contiguous stretches with no work, as run-window percentages. Draw as a 4px
   *  dashed rail, not an empty gap — dead time should be visible. */
  gaps: { leftPct: number; widthPct: number }[];
  costUsd?: number;
};

export type Timeline = {
  lanes: Lane[];
  runStartMs: number;
  runEndMs: number;
  /** Wall clock, seconds. */
  wallSec: number;
  /** Sum of every span, seconds. Exceeds wallSec when agents overlap. */
  agentSec: number;
  /** agentSec / wallSec. 1.0 means nothing ever ran in parallel. */
  parallelism: number;
  /** Seconds spent on spans that ended in error — the "Wasted" figure. */
  wastedSec: number;
  /** True if ANY span was inferred. Drives the axis footnote. */
  anyDerived: boolean;
  /** Tick positions for the axis, as percentages. */
  ticks: { pct: number; label: string }[];
};

function windowFor(e: RawEvent): { start: number; end: number; derived: boolean } | null {
  if (e.startedAt != null && e.endedAt != null) return { start: e.startedAt, end: e.endedAt, derived: false };
  if (e.startedAt != null && e.durationMs != null) return { start: e.startedAt, end: e.startedAt + e.durationMs, derived: false };
  if (e.at != null && e.durationMs != null) return { start: e.at - e.durationMs, end: e.at, derived: false };
  return null; // needs the per-agent derivation pass
}

export function buildTimeline(events: RawEvent[], nowMs = Date.now()): Timeline {
  if (events.length === 0) {
    return { lanes: [], runStartMs: nowMs, runEndMs: nowMs, wallSec: 0, agentSec: 0,
             parallelism: 0, wastedSec: 0, anyDerived: false, ticks: [] };
  }

  // Group by agent, ordered in time by whatever timestamp we have.
  const byAgent = new Map<string, RawEvent[]>();
  for (const e of events) {
    const list = byAgent.get(e.agentId) ?? [];
    list.push(e);
    byAgent.set(e.agentId, list);
  }
  for (const list of byAgent.values()) {
    list.sort((a, b) => (a.startedAt ?? a.at ?? 0) - (b.startedAt ?? b.at ?? 0));
  }

  // Pass 1 — resolve every window, deriving where necessary.
  const resolved = new Map<string, { e: RawEvent; start: number; end: number; derived: boolean }[]>();
  let lo = Infinity;
  let hi = -Infinity;

  for (const [agentId, list] of byAgent) {
    const out: { e: RawEvent; start: number; end: number; derived: boolean }[] = [];
    let prevEnd: number | null = null;

    for (const e of list) {
      let w = windowFor(e);
      if (!w) {
        // Case 4: only an arrival time. Run from the agent's previous end to this arrival.
        const end: number = e.at ?? prevEnd ?? nowMs;
        const start: number = prevEnd ?? end; // first-ever event gets a zero-width start marker
        w = { start, end, derived: true };
      }
      if (w.end < w.start) w = { ...w, end: w.start };
      out.push({ e, ...w });
      prevEnd = w.end;
      lo = Math.min(lo, w.start);
      hi = Math.max(hi, w.end);
    }
    resolved.set(agentId, out);
  }

  // A running step with no end yet extends to now.
  hi = Math.max(hi, events.some((e) => e.status === "running") ? nowMs : hi);
  const span = Math.max(1, hi - lo);
  const pct = (ms: number) => ((ms - lo) / span) * 100;

  // Pass 2 — percentages, gaps, totals.
  const lanes: Lane[] = [];
  let agentMs = 0;
  let wastedMs = 0;
  let anyDerived = false;

  for (const [agentId, list] of resolved) {
    const spans: Span[] = list.map(({ e, start, end, derived }) => {
      agentMs += end - start;
      if (e.status === "error") wastedMs += end - start;
      if (derived) anyDerived = true;
      return {
        id: e.id,
        agentId,
        tool: e.tool,
        title: e.title,
        status: e.status ?? "ok",
        phase: e.phase ?? "act",
        startMs: start,
        endMs: end,
        leftPct: pct(start),
        widthPct: Math.max(0.4, ((end - start) / span) * 100), // floor so instant steps stay visible
        derived,
      };
    });

    const gaps: { leftPct: number; widthPct: number }[] = [];
    let cursor = lo;
    for (const s of spans) {
      if (s.startMs > cursor) gaps.push({ leftPct: pct(cursor), widthPct: ((s.startMs - cursor) / span) * 100 });
      cursor = Math.max(cursor, s.endMs);
    }
    if (cursor < hi) gaps.push({ leftPct: pct(cursor), widthPct: ((hi - cursor) / span) * 100 });

    lanes.push({ agentId, spans, gaps });
  }

  const wallSec = span / 1000;
  const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);

  return {
    lanes,
    runStartMs: lo,
    runEndMs: hi,
    wallSec,
    agentSec: agentMs / 1000,
    parallelism: wallSec > 0 ? agentMs / 1000 / wallSec : 0,
    wastedSec: wastedMs / 1000,
    anyDerived,
    ticks: [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => ({ pct: f * 100, label: fmt(wallSec * f) })),
  };
}
