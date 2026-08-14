import React from "react";
import { SPRITES, type SpriteName } from "./sprites";

/**
 * Renders a 16x16 crew sprite as a single element with a box-shadow list — one
 * shadow per opaque pixel. Same primitive as the existing PunchA mark.
 *
 * The unit MUST snap to a whole pixel. A fractional unit (e.g. size=20 -> 1.25px)
 * puts every cell edge on a sub-pixel boundary and the browser antialiases it,
 * which destroys the pixel look. So the host box is always `unit * 16`, NOT the
 * requested size — request 16, 32, or 48 and you get exactly that.
 *
 *   16px  trace row, nav
 *   32px  card, avatar tile
 *   48px  roster
 */
export function PixelAgent({
  name,
  size = 32,
  title,
}: {
  name: SpriteName | string;
  size?: 16 | 32 | 48 | number;
  title?: string;
}) {
  const sprite = SPRITES[name as SpriteName];

  const { box, shadow } = React.useMemo(() => {
    if (!sprite) return { box: 0, shadow: "" };
    const unit = Math.max(1, Math.round(size / 16));
    const parts: string[] = [];
    for (let y = 0; y < 16; y++) {
      const row = sprite.rows[y] ?? "";
      for (let x = 0; x < 16; x++) {
        const color = sprite.palette[row[x]];
        if (color) parts.push(`${x * unit}px ${y * unit}px 0 ${color}`);
      }
    }
    return { box: unit * 16, shadow: parts.join(",") };
  }, [sprite, size]);

  if (!sprite) return null;

  return (
    <span
      role="img"
      aria-label={title ?? String(name)}
      style={{ display: "block", position: "relative", width: box, height: box, flex: "none" }}
    >
      <i
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "block",
          width: box / 16,
          height: box / 16,
          boxShadow: shadow,
        }}
      />
    </span>
  );
}

/**
 * The standard identity treatment: a 40px neutral tile holding a 32px sprite, with a
 * 9px status notch at the bottom-right.
 *
 * You read WHO from the character and HOW IT'S GOING from the notch, so the two never
 * compete — which is why the tile stays neutral and only the notch carries colour.
 */
export function AgentBadge({
  sprite,
  state,
  name,
}: {
  sprite: SpriteName | string;
  state: "running" | "ok" | "error" | "idle";
  name: string;
}) {
  const notch: Record<string, string> = {
    running: "var(--state-running)",
    ok: "var(--state-ok)",
    error: "var(--state-error)",
    idle: "transparent",
  };
  return (
    <span
      style={{
        position: "relative",
        width: 40,
        height: 40,
        flex: "none",
        borderRadius: "var(--r-card)",
        background: "var(--surface-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PixelAgent name={sprite} size={32} title={name} />
      <i
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: 9,
          height: 9,
          borderRadius: 5,
          background: notch[state],
          border: `2px solid ${state === "idle" ? "var(--state-idle)" : "var(--bg)"}`,
          animation: state === "running" ? "adaPulse var(--pulse)" : undefined,
        }}
      />
    </span>
  );
}
