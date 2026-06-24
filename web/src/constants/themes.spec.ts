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

import { describe, it, expect, beforeEach } from "vitest";
import {
  PREDEFINED_THEMES,
  CUSTOM_THEME_NAME,
  DEFAULT_THEME_NAME,
  THEME_STORAGE_KEYS,
  getThemeByName,
  getThemeById,
  getDefaultTheme,
  resolveThemeForMode,
  migrateLegacyThemeStorage,
} from "./themes";

// A small in-memory Storage stand-in for migration tests.
const createStorage = (initial: Record<string, string> = {}): Storage => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};

describe("theme registry", () => {
  describe("lookups", () => {
    it("finds a theme by name", () => {
      expect(getThemeByName("Ocean Breeze")?.id).toBe(2);
    });

    it("returns undefined for an unknown name", () => {
      expect(getThemeByName("Does Not Exist")).toBeUndefined();
    });

    it("returns undefined for null/empty name", () => {
      expect(getThemeByName(null)).toBeUndefined();
      expect(getThemeByName("")).toBeUndefined();
    });

    it("finds a theme by legacy id", () => {
      expect(getThemeById(10)?.name).toBe("O2 Signature");
    });

    it("returns undefined for an unknown id", () => {
      expect(getThemeById(9999)).toBeUndefined();
    });

    it("resolves the default theme to O2 Signature", () => {
      expect(DEFAULT_THEME_NAME).toBe("O2 Signature");
      expect(getDefaultTheme().name).toBe("O2 Signature");
    });
  });

  describe("resolveThemeForMode priority", () => {
    it("prefers the live preview color above everything", () => {
      const r = resolveThemeForMode({
        mode: "light",
        tempColor: "#ABCDEF",
        appliedThemeName: "Ocean Breeze",
        customColor: "#111111",
        orgColor: "#222222",
      });
      expect(r.source).toBe("preview");
      expect(r.themeColor).toBe("#ABCDEF");
    });

    it("resolves a predefined theme by NAME from the current registry color", () => {
      const ocean = getThemeByName("Ocean Breeze")!;
      const r = resolveThemeForMode({
        mode: "light",
        appliedThemeName: "Ocean Breeze",
        // a stale cached color must be ignored in favour of the registry color
        customColor: "#000000",
      });
      expect(r.source).toBe("predefined");
      expect(r.themeColor).toBe(ocean.light.themeColor);
    });

    it("carries semantic colors for predefined themes that define them", () => {
      const crimson = getThemeByName("O2 Crimson Ink")!;
      const r = resolveThemeForMode({
        mode: "dark",
        appliedThemeName: "O2 Crimson Ink",
      });
      expect(r.semanticColors).toEqual(crimson.dark.semanticColors);
    });

    it("falls back to default when the selected name no longer exists", () => {
      const r = resolveThemeForMode({
        mode: "light",
        appliedThemeName: "Removed In v2",
        orgColor: null,
      });
      expect(r.source).toBe("default");
      expect(r.themeColor).toBe(getDefaultTheme().light.themeColor);
    });

    it("uses the stored hex color for a custom theme", () => {
      const r = resolveThemeForMode({
        mode: "light",
        appliedThemeName: CUSTOM_THEME_NAME,
        customColor: "#FF0000",
      });
      expect(r.source).toBe("custom");
      expect(r.themeColor).toBe("#FF0000");
    });

    it("falls back to org color when nothing is selected", () => {
      const r = resolveThemeForMode({
        mode: "dark",
        appliedThemeName: null,
        orgColor: "#123456",
      });
      expect(r.source).toBe("org");
      expect(r.themeColor).toBe("#123456");
    });

    it("falls back to the default theme (O2 Signature) when nothing else is set", () => {
      const def = getDefaultTheme();
      const r = resolveThemeForMode({ mode: "dark", appliedThemeName: null });
      expect(r.source).toBe("default");
      expect(r.themeColor).toBe(def.dark.themeColor);
    });

    it("never marks the result as the base default (always applies real colors)", () => {
      const r = resolveThemeForMode({ mode: "light", appliedThemeName: null });
      expect(r.isDefault).toBe(false);
    });
  });

  describe("migrateLegacyThemeStorage", () => {
    let storage: Storage;

    beforeEach(() => {
      storage = createStorage();
    });

    it("converts a numeric legacy id to the theme name", () => {
      storage.setItem("appliedLightTheme", "2");
      migrateLegacyThemeStorage(storage);
      expect(storage.getItem(THEME_STORAGE_KEYS.light.appliedName)).toBe(
        "Ocean Breeze",
      );
      expect(storage.getItem("appliedLightTheme")).toBeNull();
    });

    it("converts the legacy custom marker (-1) to CUSTOM_THEME_NAME", () => {
      storage.setItem("appliedDarkTheme", "-1");
      migrateLegacyThemeStorage(storage);
      expect(storage.getItem(THEME_STORAGE_KEYS.dark.appliedName)).toBe(
        CUSTOM_THEME_NAME,
      );
      expect(storage.getItem("appliedDarkTheme")).toBeNull();
    });

    it("drops an unknown legacy id (falls back to default at resolve time)", () => {
      storage.setItem("appliedLightTheme", "9999");
      migrateLegacyThemeStorage(storage);
      expect(storage.getItem(THEME_STORAGE_KEYS.light.appliedName)).toBeNull();
      expect(storage.getItem("appliedLightTheme")).toBeNull();
    });

    it("does not overwrite an already-migrated name key", () => {
      storage.setItem("appliedLightTheme", "2");
      storage.setItem(THEME_STORAGE_KEYS.light.appliedName, "Sky Blue");
      migrateLegacyThemeStorage(storage);
      expect(storage.getItem(THEME_STORAGE_KEYS.light.appliedName)).toBe(
        "Sky Blue",
      );
    });

    it("is a no-op when there is no legacy key", () => {
      migrateLegacyThemeStorage(storage);
      expect(storage.getItem(THEME_STORAGE_KEYS.light.appliedName)).toBeNull();
      expect(storage.getItem(THEME_STORAGE_KEYS.dark.appliedName)).toBeNull();
    });
  });

  describe("registry integrity", () => {
    it("has unique ids and names", () => {
      const ids = PREDEFINED_THEMES.map((t) => t.id);
      const names = PREDEFINED_THEMES.map((t) => t.name);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(names).size).toBe(names.length);
    });

    it("includes the default theme name in the registry", () => {
      expect(names()).toContain(DEFAULT_THEME_NAME);
    });
  });
});

function names() {
  return PREDEFINED_THEMES.map((t) => t.name);
}
