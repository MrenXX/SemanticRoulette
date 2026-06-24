import type { Theme } from "../tokens.js";

/**
 * Deep space — the hidden target is the central luminous body; other words are
 * stars/planets; a guess lands at distance-from-centre = score (closer = better).
 */
export const deepspace: Theme = {
  name: "deepspace",
  label: "Deep space",
  kind: "3d",
  tokens: {
    bg: "#04050a",
    panel: "rgba(12, 16, 26, 0.6)",
    "panel-border": "rgba(150, 175, 220, 0.14)",
    text: "#e9eef8",
    "text-dim": "#8b93a8",
    accent: "#74b3ff",
    "accent-soft": "rgba(116, 179, 255, 0.16)",
    good: "#9fe7c5",
    bad: "#e69aa0",
    "font-sans": "'Space Grotesk', 'Inter', system-ui, sans-serif",
    "font-display": "'Space Grotesk', 'Inter', system-ui, sans-serif",
    "font-mono": "'IBM Plex Mono', ui-monospace, monospace",
    radius: "12px",
    shadow: "0 18px 50px rgba(0, 0, 0, 0.55)",
  },
  scene: {
    background: "#04050a",
    point: "#8492b0",
    pointActive: "#dcebff",
    pointTarget: "#ffcf6e",
    guess: "#74b3ff",
    bloom: 0.55,
    fog: 0.5,
    pointSize: 0.3,
  },
};
