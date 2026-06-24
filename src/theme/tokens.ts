/**
 * Design-token system. A `Theme` describes both the 2D HUD (CSS custom
 * properties) and the 3D scene (colors/intensities the renderer reads). The
 * core is built theme-agnostic; the three design variants live in ./themes.
 */
export interface SceneTokens {
  /** Scene clear / paper color. */
  background: string;
  /** Light "ink on paper" mode (ink theme). */
  light?: boolean;
  /** Resting point / ink color. */
  point: string;
  /** Color of points flashing during the slot-machine cycle. */
  pointActive: string;
  /** The central target body color (deep space) / reveal ink. */
  pointTarget: string;
  /** Hint mark color. */
  guess: string;
  /** Bloom strength (0 disables). */
  bloom: number;
  /** Fog density factor 0..1 (depth falloff). */
  fog: number;
  /** Base point size in world units. */
  pointSize: number;
  /** Ink palette (suminagashi). */
  inks?: string[];
  /** Canvas label font family (ink theme). */
  font?: string;
  /** Canvas label text color (ink theme). */
  text?: string;
}

export interface Theme {
  name: string;
  label: string;
  /** Which renderer this theme uses. */
  kind: "2d" | "3d";
  tokens: Record<string, string>;
  scene: SceneTokens;
}

/**
 * Apply a theme: write CSS custom properties to :root and tag the document so
 * CSS and the renderer can react. Returns the theme for convenience.
 */
export function applyTheme(theme: Theme): Theme {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.dataset.theme = theme.name;
  return theme;
}
