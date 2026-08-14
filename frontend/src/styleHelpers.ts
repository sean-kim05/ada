// Ada — shared style primitives.
//
// Every value reads from a CSS custom property in index.css (the token layer) so
// nothing here hard-codes a colour or a spacing number.

import type { CSSProperties } from "react";

const v = (name: string) => `var(--${name})`;

/* ------------------------------------------------------------------ surfaces */

/** The default container. One hairline, radius 8. NEVER a second border under a header. */
export const panel: CSSProperties = {
  background: v("surface-1"),
  border: `1px solid ${v("border")}`,
  borderRadius: v("r-card"),
  overflow: "hidden",
};

/** Raised inside a panel: rows, inputs, chips, avatar tiles, the user's message bubble. */
export const surface2: CSSProperties = {
  background: v("surface-2"),
  border: `1px solid ${v("border")}`,
  borderRadius: v("r-control"),
  boxShadow: v("shadow-raised"),
};

/** Sunken. Terminal output and raw stdout only — the one inset surface in the app. */
export const well: CSSProperties = {
  background: v("surface-well"),
  boxShadow: v("inset-well"),
};

/** Only things that genuinely float: menus, command palette, tooltips, modals. */
export const overlay: CSSProperties = {
  background: v("surface-overlay"),
  border: `1px solid ${v("border-strong")}`,
  borderRadius: v("r-overlay"),
  boxShadow: v("shadow-overlay"),
};

/* -------------------------------------------------------------------- headers */

/** Panel header. Always 44px. Order is fixed:
 *  title -> state pill -> flex gap -> metadata -> actions. */
export const phead: CSSProperties = {
  height: v("h-panelhead"),
  flex: "none",
  display: "flex",
  alignItems: "center",
  gap: v("s-md"),
  padding: `0 ${v("s-lg")}`,
  borderBottom: `1px solid ${v("border")}`,
};

/* ----------------------------------------------------------------------- type */

/** Machine-authored values only: costs, token counts, latencies, ids, tool names,
 *  file paths, timestamps, key caps, terminal output.
 *  NOT for nav labels, chat bodies, empty-state prose, buttons, or headings.
 *  (Third arg `ls` is a back-compat letter-spacing hook for un-migrated call sites.) */
export const mono = (size = 11, color = v("text-lo"), ls?: string): CSSProperties => ({
  fontFamily: v("font-mono"),
  fontSize: size,
  lineHeight: `${Math.round(size * 1.4)}px`,
  fontVariantNumeric: "tabular-nums",
  color,
  ...(ls ? { letterSpacing: ls } : {}),
});

type TextRole = "display" | "heading" | "title" | "body" | "ui" | "caption";

/** The whole type ramp. Hierarchy comes from weight and colour first, size last. */
export const text = (role: TextRole, color = v("text-hi")): CSSProperties => {
  const spec: Record<TextRole, CSSProperties> = {
    display: { fontSize: 40, lineHeight: "46px", fontWeight: 600, letterSpacing: "-0.03em" },
    heading: { fontSize: 22, lineHeight: "28px", fontWeight: 600, letterSpacing: "-0.022em" },
    title:   { fontSize: 14, lineHeight: "20px", fontWeight: 500, letterSpacing: "-0.012em" },
    body:    { fontSize: 15, lineHeight: "26px", fontWeight: 400 },
    ui:      { fontSize: 13, lineHeight: "18px", fontWeight: 500 },
    caption: { fontSize: 12, lineHeight: "16px", fontWeight: 400 },
  };
  return { fontFamily: v("font-sans"), color, ...spec[role] };
};

/* -------------------------------------------------------------------- controls */

type BtnKind = "primary" | "secondary" | "ghost" | "danger";

/** Primary is a white fill with black text — the single strongest element on a screen.
 *  Max one per view. Danger is OUTLINED, never filled. */
export const btn = (kind: BtnKind = "secondary", small = false): CSSProperties => {
  const base: CSSProperties = {
    height: small ? v("h-btn-sm") : v("h-btn"),
    padding: `0 ${small ? v("s-xs") : v("s-md")}`,
    borderRadius: small ? 5 : v("r-control"),
    display: "inline-flex",
    alignItems: "center",
    gap: v("s-xs"),
    fontFamily: v("font-sans"),
    fontSize: small ? 11 : 12,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: "nowrap",
    flex: "none",
    cursor: "pointer",
    border: "1px solid transparent",
    transition: `background ${v("t-hover")}, color ${v("t-hover")}`,
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    primary:   { background: v("action-bg"), color: v("action-fg"), border: "none" },
    secondary: { background: v("surface-2"), color: v("text-hi"), borderColor: v("border-strong"), boxShadow: v("shadow-raised") },
    ghost:     { background: "transparent", color: v("text-mid"), borderColor: v("border-strong") },
    danger:    { background: "rgba(255,97,102,.08)", color: v("state-error-text"), borderColor: "rgba(255,97,102,.28)" },
  };
  return { ...base, ...kinds[kind] };
};

/** 30px, radius 6, always on --surface-2 so a field reads as raised before focus.
 *  Focus is the only place a border takes a colour. */
export const input = (state: "default" | "focus" | "invalid" = "default"): CSSProperties => ({
  height: v("h-input"),
  padding: `0 ${v("s-sm")}`,
  borderRadius: v("r-control"),
  background: v("surface-2"),
  color: v("text-hi"),
  fontFamily: v("font-sans"),
  fontSize: 13,
  outline: "none",
  border:
    state === "focus"   ? `1px solid ${v("text-hi")}` :
    state === "invalid" ? "1px solid rgba(255,97,102,.5)" :
                          `1px solid ${v("border-strong")}`,
  boxShadow: state === "focus" ? "0 0 0 3px rgba(255,255,255,.18)" : undefined,
});

/* ------------------------------------------------------------------ status */

export type AgentState = "running" | "ok" | "error" | "idle";

const STATE_HUE: Record<AgentState, { dot: string; text: string; tint: string }> = {
  running: { dot: v("state-running"), text: "#7FBBFF", tint: "rgba(50,145,255,.10)" },
  ok:      { dot: v("state-ok"),      text: "#7BE8A4", tint: "rgba(69,222,124,.10)" },
  error:   { dot: v("state-error"),   text: v("state-error-text"), tint: "rgba(255,97,102,.12)" },
  idle:    { dot: v("state-idle"),    text: v("text-lo"), tint: "rgba(255,255,255,.05)" },
};

/** 18px, radius 4, mono 10 uppercase, tinted fill at ~10% with the label lifted. */
export const tag = (state: AgentState | "neutral" = "neutral"): CSSProperties => {
  const hue = state === "neutral" ? STATE_HUE.idle : STATE_HUE[state];
  return {
    height: v("h-tag"),
    padding: `0 ${v("s-xs")}`,
    borderRadius: v("r-tag"),
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: hue.tint,
    border: state === "neutral" ? `1px solid ${v("border")}` : "none",
    fontFamily: v("font-mono"),
    fontSize: 10,
    letterSpacing: ".05em",
    textTransform: "uppercase",
    color: hue.text,
    whiteSpace: "nowrap",
  };
};

/** A dot means LIVE state. No dot means a static attribute — don't add one to a model tag. */
export const dot = (state: AgentState, size = 7): CSSProperties => ({
  width: size,
  height: size,
  flex: "none",
  borderRadius: size,
  background: state === "idle" ? "transparent" : STATE_HUE[state].dot,
  border: state === "idle" ? `1.5px solid ${v("state-idle")}` : undefined,
  animation: state === "running" ? `adaPulse ${v("pulse")}` : undefined,
});

/* ------------------------------------------------------------------- layout */

/** Put this on EVERY scroller. */
export const scroller: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
};

/** A flex row of chips/metadata that must survive narrow widths. */
export const shrinkable: CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Lane colour for a Fleet agent — deterministic from the id, survives a reload. */
export const laneHue = (agentId: string, label = false) => {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) | 0;
  return v(`lane-${(Math.abs(h) % 6) + 1}${label ? "-label" : ""}`);
};
