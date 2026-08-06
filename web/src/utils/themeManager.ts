// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { applyThemeColors, type SemanticColors } from "@/utils/theme";
import {
  resolveThemeForMode,
  migrateLegacyThemeStorage,
  THEME_STORAGE_KEYS,
  type ResolvedTheme,
} from "@/constants/themes";

/**
 * Theme manager — the single orchestrator that resolves the effective theme
 * (by name for predefined / default, by color for custom) and applies it.
 *
 * Used by main.ts (synchronous bootstrap before first paint), App.vue (on load
 * and theme-mode toggle) and PredefinedThemes.vue, so resolution logic lives in
 * exactly one place.
 */

type ThemeMode = "light" | "dark";

// Minimal shape of the parts of the Vuex store this module reads.
interface ThemeStoreLike {
  state: {
    theme?: string;
    tempThemeColors?: { light?: string | null; dark?: string | null };
  };
}

const parseSemantic = (raw: string | null): SemanticColors | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SemanticColors;
  } catch {
    return undefined;
  }
};

/**
 * Resolve and apply the theme for a specific mode, then refresh the localStorage
 * render-cache (`customLightColor`/`customDarkColor` + semantic colors) so chart
 * consumers that read those keys directly always reflect the active theme.
 *
 * The cache is rewritten for every persisted source (predefined re-derived by
 * name, custom, and the default theme) — so a color change shipped in a release
 * propagates to direct localStorage readers too. The transient live preview is
 * never persisted.
 */
export const applyThemeForMode = (mode: ThemeMode, store: ThemeStoreLike): ResolvedTheme => {
  const keys = THEME_STORAGE_KEYS[mode];

  const resolved = resolveThemeForMode({
    mode,
    tempColor: store.state.tempThemeColors?.[mode],
    appliedThemeName: localStorage.getItem(keys.appliedName),
    customColor: localStorage.getItem(keys.color),
    customSemanticColors: parseSemantic(localStorage.getItem(keys.semantic)),
  });

  applyThemeColors(resolved.themeColor, mode, resolved.isDefault, resolved.semanticColors);

  // Refresh the render-cache for any persisted source so direct localStorage
  // readers (charts) stay in sync. Never persist the transient live preview.
  if (resolved.source !== "preview") {
    localStorage.setItem(keys.color, resolved.themeColor);
    if (resolved.semanticColors) {
      localStorage.setItem(keys.semantic, JSON.stringify(resolved.semanticColors));
    } else {
      localStorage.removeItem(keys.semantic);
    }
  }

  return resolved;
};

/** Resolve and apply the theme for the store's current mode. */
export const applyCurrentTheme = (store: ThemeStoreLike): ResolvedTheme => {
  const mode: ThemeMode = store.state.theme === "dark" ? "dark" : "light";
  return applyThemeForMode(mode, store);
};

/**
 * Synchronous theme bootstrap — call BEFORE the app mounts (in main.ts) so the
 * very first paint already uses the resolved theme instead of the base
 * stylesheet default. Resolution here depends only on localStorage + the theme
 * registry (no Vuex/org/network), so it can run fully synchronously.
 */
export const bootstrapTheme = (): void => {
  // Convert any legacy id-based selection to the name-based model first, so the
  // resolve below reads the correct `appliedXThemeName` keys.
  migrateLegacyThemeStorage();

  const mode: ThemeMode = localStorage.getItem("theme") === "dark" ? "dark" : "light";

  // No store yet → no live preview at boot.
  applyThemeForMode(mode, { state: { theme: mode, tempThemeColors: {} } });
};
