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

import type { SemanticColors } from "@/utils/theme";

/**
 * Theme registry — single source of truth for predefined themes.
 *
 * Theme SELECTION is persisted by NAME (not by color), so when a theme's
 * color codes change in a future release, every user who selected that theme
 * by name automatically picks up the new colors on next load.
 *
 * - Predefined theme  → persisted by `name` (e.g. "O2 Signature").
 * - Custom theme      → persisted by `CUSTOM_THEME_NAME` + the chosen hex color.
 * - Default/fallback  → resolves to `DEFAULT_THEME_NAME` ("O2 Signature") by name,
 *                       so editing O2 Signature's colors also changes the default.
 */

export interface ThemeModeColors {
  // Hex color used for buttons/toggles/borders and to derive the primary palette
  themeColor: string;
  // Optional multi-color semantic palette (errors/success/secondary button, etc.)
  semanticColors?: SemanticColors;
}

export interface PredefinedTheme {
  // Stable numeric id — kept only for legacy localStorage migration.
  id: number;
  // Stable display name — this is the persisted key for theme selection.
  name: string;
  light: ThemeModeColors;
  dark: ThemeModeColors;
}

/** Marker stored in `appliedXThemeName` when the user picked a custom color. */
export const CUSTOM_THEME_NAME = "__custom__";

/** The theme used as the default/fallback when nothing else is selected. */
export const DEFAULT_THEME_NAME = "O2 Signature";

/** localStorage keys, grouped per mode. */
export const THEME_STORAGE_KEYS = {
  light: {
    appliedName: "appliedLightThemeName",
    color: "customLightColor",
    semantic: "lightSemanticColors",
    legacyApplied: "appliedLightTheme",
  },
  dark: {
    appliedName: "appliedDarkThemeName",
    color: "customDarkColor",
    semantic: "darkSemanticColors",
    legacyApplied: "appliedDarkTheme",
  },
} as const;

/** Predefined themes with both light and dark mode colors. */
export const PREDEFINED_THEMES: PredefinedTheme[] = [
  {
    id: 10,
    name: "O2 Signature",
    light: {
      themeColor: "#6B76E3",
    },
    dark: {
      themeColor: "#8B8DF0",
    },
  },
  {
    id: 2,
    name: "O2 Pulse",
    light: {
      themeColor: "#3F7994",
    },
    dark: {
      themeColor: "#3F7994",
    },
  },
  {
    id: 4,
    name: "O2 Horizon",
    light: {
      themeColor: "#077A7F",
    },
    dark: {
      themeColor: "#588CF3",
    },
  },
  {
    id: 5,
    name: "O2 Beacon",
    light: {
      themeColor: "#3369D6",
    },
    dark: {
      themeColor: "#6EA8FE",
    },
  },
  {
    id: 8,
    name: "O2 Lens",
    light: {
      themeColor: "#4682FA",
    },
    dark: {
      themeColor: "#E56D17",
    },
  },
  {
    id: 14,
    name: "O2 Crimson Ink",
    light: {
      themeColor: "#E11D48",
      semanticColors: {
        error: "#F97316",
        errorBg: "#FFF7ED",
        errorText: "#C2410C",
        success: "#6366F1",
        successBg: "#EEF2FF",
        successText: "#3730A3",
        secondaryBtnBg: "#FFE4E6",
        secondaryBtnText: "#BE123C",
        secondaryBtnBorder: "#FECDD3",
        outlineText: "#BE123C",
        outlineBorder: "#FECDD3",
        ghostText: "#BE123C",
      },
    },
    dark: {
      themeColor: "#FB7185",
      semanticColors: {
        error: "#FB923C",
        errorBg: "#3A1A08",
        errorText: "#FB923C",
        success: "#818CF8",
        successBg: "#1E1B4B",
        successText: "#A5B4FC",
        secondaryBtnBg: "#3D0617",
        secondaryBtnText: "#FECDD3",
        secondaryBtnBorder: "#9F1239",
        outlineText: "#FECDD3",
        outlineBorder: "#9F1239",
        ghostText: "#FECDD3",
      },
    },
  },
];

/** Find a predefined theme by its stable name. */
export const getThemeByName = (
  name: string | null | undefined,
): PredefinedTheme | undefined =>
  name ? PREDEFINED_THEMES.find((t) => t.name === name) : undefined;

/** Find a predefined theme by its legacy numeric id. */
export const getThemeById = (
  id: number | null | undefined,
): PredefinedTheme | undefined =>
  id == null ? undefined : PREDEFINED_THEMES.find((t) => t.id === id);

/** The default/fallback theme (O2 Signature), with a safe fallback to the first theme. */
export const getDefaultTheme = (): PredefinedTheme =>
  getThemeByName(DEFAULT_THEME_NAME) ?? PREDEFINED_THEMES[0];

/** Slugify a theme name into kebab-case for data-test attributes ("O2 Pulse" -> "o2-pulse"). */
export const themeNameSlug = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, "-");

/**
 * User-facing label for a theme. The stored `name` is the persisted selection key
 * and must never change, but the "O2 " prefix is dropped for display on every
 * theme except the signature theme ("O2 Signature" stays branded).
 */
export const themeDisplayName = (name: string): string =>
  name === DEFAULT_THEME_NAME ? name : name.replace(/^O2\s+/, "");

export type ThemeSource = "preview" | "predefined" | "custom" | "default";

export interface ResolveThemeInput {
  mode: "light" | "dark";
  /** Live preview color from Vuex `tempThemeColors[mode]` (highest priority). */
  tempColor?: string | null;
  /** Persisted selection: a predefined theme name or `CUSTOM_THEME_NAME`. */
  appliedThemeName?: string | null;
  /** Persisted hex color (source of truth for custom; render-cache for predefined). */
  customColor?: string | null;
  /** Persisted semantic colors for a custom theme, if any. */
  customSemanticColors?: SemanticColors | null;
}

export interface ResolvedTheme {
  themeColor: string;
  semanticColors?: SemanticColors;
  /**
   * Always false: we always apply real colors (the default is O2 Signature's
   * colors), so the inline primary palette is always synced rather than cleared.
   */
  isDefault: boolean;
  source: ThemeSource;
}

/**
 * Resolve the effective theme colors for a mode, by priority:
 *   1. Live preview (tempColor)
 *   2. Selected predefined theme — resolved by NAME from the registry
 *   3. Selected custom theme — the persisted hex color
 *   4. Default theme (O2 Signature) — resolved by NAME from the registry
 *
 * The named default is authoritative: when no theme is explicitly selected it
 * always wins, so changing the default theme's colors in the registry takes
 * effect immediately. (Org-level theme colors are not part of this resolution.)
 */
export const resolveThemeForMode = (input: ResolveThemeInput): ResolvedTheme => {
  const mode = input.mode;

  // 1. Live preview from General Settings color picker
  if (input.tempColor) {
    return { themeColor: input.tempColor, isDefault: false, source: "preview" };
  }

  const name = input.appliedThemeName;

  // 2. Predefined theme selected by name — always read the CURRENT registry color
  if (name && name !== CUSTOM_THEME_NAME) {
    const theme = getThemeByName(name);
    if (theme) {
      const m = theme[mode];
      return {
        themeColor: m.themeColor,
        semanticColors: m.semanticColors,
        isDefault: false,
        source: "predefined",
      };
    }
    // Unknown name (theme removed in a release) → fall through to default.
  }

  // 3. Custom theme — use the persisted hex color
  if (name === CUSTOM_THEME_NAME && input.customColor) {
    return {
      themeColor: input.customColor,
      semanticColors: input.customSemanticColors ?? undefined,
      isDefault: false,
      source: "custom",
    };
  }

  // 4. Default theme (O2 Signature), resolved by name
  const def = getDefaultTheme();
  const m = def[mode];
  return {
    themeColor: m.themeColor,
    semanticColors: m.semanticColors,
    isDefault: false,
    source: "default",
  };
};

/**
 * One-time migration of the legacy id-based selection to the name-based model.
 *   - legacy `appliedLightTheme` / `appliedDarkTheme` held a numeric id, or "-1" for custom.
 *   - new `appliedLightThemeName` / `appliedDarkThemeName` hold a theme name or CUSTOM_THEME_NAME.
 * Safe to call repeatedly; it only acts when a legacy key is present and the new key is absent.
 */
export const migrateLegacyThemeStorage = (
  storage: Storage = localStorage,
): void => {
  (["light", "dark"] as const).forEach((mode) => {
    const keys = THEME_STORAGE_KEYS[mode];
    const legacy = storage.getItem(keys.legacyApplied);
    if (legacy === null) return;

    // Only set the new key if it hasn't been written already.
    if (storage.getItem(keys.appliedName) === null) {
      if (legacy === "-1") {
        storage.setItem(keys.appliedName, CUSTOM_THEME_NAME);
      } else {
        const theme = getThemeById(parseInt(legacy, 10));
        if (theme) storage.setItem(keys.appliedName, theme.name);
      }
    }

    storage.removeItem(keys.legacyApplied);
  });
};
