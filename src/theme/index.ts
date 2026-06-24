import type { Theme } from "./tokens.js";
import { deepspace } from "./themes/deepspace.js";

export const THEMES: Record<string, Theme> = {
  deepspace,
};

export const DEFAULT_THEME = "deepspace";

/** Resolve a theme by name (e.g. from a `?theme=` query param), with fallback. */
export function resolveTheme(name: string | null | undefined): Theme {
  return (name && THEMES[name]) || THEMES[DEFAULT_THEME];
}
