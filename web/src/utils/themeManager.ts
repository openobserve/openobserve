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
  THEME_STORAGE_KEYS,
  type ResolvedTheme,
} from "@/constants/themes";

/**
 * Theme manager — the single orchestrator that resolves the effective theme
 * (by name for predefined / default, by color for custom) and applies it.
 *
 * Used by App.vue (on load and theme-mode toggle) and PredefinedThemes.vue so
 * resolution logic lives in exactly one place.
 */

type ThemeMode = "light" | "dark";

// Minimal shape of the parts of the Vuex store this module reads.
interface ThemeStoreLike {
  state: {
    theme?: string;
    tempThemeColors?: { light?: string | null; dark?: string | null };
    organizationData?: {
      organizationSettings?: {
        light_mode_theme_color?: string | null;
        dark_mode_theme_color?: string | null;
      };
    };
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
 * consumers that read those keys directly stay in sync with the selected theme.
 *
 * The render-cache is only rewritten for predefined themes (where colors are
 * re-derived from the registry by name). For custom themes the cache already IS
 * the source of truth, and for preview/org/default we leave it untouched.
 */
export const applyThemeForMode = (
  mode: ThemeMode,
  store: ThemeStoreLike,
): ResolvedTheme => {
  const keys = THEME_STORAGE_KEYS[mode];
  const org = store.state?.organizationData?.organizationSettings;

  const resolved = resolveThemeForMode({
    mode,
    tempColor: store.state.tempThemeColors?.[mode],
    appliedThemeName: localStorage.getItem(keys.appliedName),
    customColor: localStorage.getItem(keys.color),
    customSemanticColors: parseSemantic(localStorage.getItem(keys.semantic)),
    orgColor:
      mode === "light"
        ? org?.light_mode_theme_color
        : org?.dark_mode_theme_color,
  });

  applyThemeColors(
    resolved.themeColor,
    mode,
    resolved.isDefault,
    resolved.semanticColors,
  );

  // Refresh the render-cache from the registry for predefined themes so a
  // color change shipped in a release propagates to direct localStorage readers.
  if (resolved.source === "predefined") {
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
