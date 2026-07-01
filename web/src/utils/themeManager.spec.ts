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

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the DOM-applying layer so we can assert on the resolved color/args.
vi.mock("@/utils/theme", () => ({
  applyThemeColors: vi.fn(),
}));

import {
  applyThemeForMode,
  applyCurrentTheme,
  bootstrapTheme,
} from "./themeManager";
import { applyThemeColors } from "@/utils/theme";
import {
  CUSTOM_THEME_NAME,
  getThemeByName,
  getDefaultTheme,
  THEME_STORAGE_KEYS,
} from "@/constants/themes";

const storeWith = (overrides: any = {}) => ({
  state: {
    theme: "light",
    tempThemeColors: { light: null, dark: null },
    ...overrides,
  },
});

describe("themeManager", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("applies the default theme (O2 Signature) when nothing is selected", () => {
    const def = getDefaultTheme();
    const resolved = applyThemeForMode("light", storeWith());

    expect(resolved.source).toBe("default");
    expect(applyThemeColors).toHaveBeenCalledWith(
      def.light.themeColor,
      "light",
      false,
      def.light.semanticColors,
    );
  });

  it("resolves a predefined theme by name and refreshes the color cache", () => {
    const ocean = getThemeByName("O2 Pulse")!;
    localStorage.setItem(THEME_STORAGE_KEYS.light.appliedName, "O2 Pulse");
    // Stale cached color that must be overwritten from the registry.
    localStorage.setItem(THEME_STORAGE_KEYS.light.color, "#000000");

    const resolved = applyThemeForMode("light", storeWith());

    expect(resolved.source).toBe("predefined");
    expect(applyThemeColors).toHaveBeenCalledWith(
      ocean.light.themeColor,
      "light",
      false,
      undefined,
    );
    // Cache refreshed to the current registry color.
    expect(localStorage.getItem(THEME_STORAGE_KEYS.light.color)).toBe(
      ocean.light.themeColor,
    );
  });

  it("caches semantic colors for a predefined theme that defines them", () => {
    const crimson = getThemeByName("O2 Crimson Ink")!;
    localStorage.setItem(THEME_STORAGE_KEYS.dark.appliedName, "O2 Crimson Ink");

    applyThemeForMode("dark", storeWith({ theme: "dark" }));

    expect(localStorage.getItem(THEME_STORAGE_KEYS.dark.semantic)).toBe(
      JSON.stringify(crimson.dark.semanticColors),
    );
  });

  it("uses the stored hex for a custom theme and does not rewrite the cache", () => {
    localStorage.setItem(
      THEME_STORAGE_KEYS.light.appliedName,
      CUSTOM_THEME_NAME,
    );
    localStorage.setItem(THEME_STORAGE_KEYS.light.color, "#FF0000");

    const resolved = applyThemeForMode("light", storeWith());

    expect(resolved.source).toBe("custom");
    expect(applyThemeColors).toHaveBeenCalledWith(
      "#FF0000",
      "light",
      false,
      undefined,
    );
    expect(localStorage.getItem(THEME_STORAGE_KEYS.light.color)).toBe("#FF0000");
  });

  it("does not persist the transient live preview color", () => {
    const resolved = applyThemeForMode(
      "light",
      storeWith({ tempThemeColors: { light: "#ABCDEF", dark: null } }),
    );
    expect(resolved.source).toBe("preview");
    expect(localStorage.getItem(THEME_STORAGE_KEYS.light.color)).toBeNull();
  });

  it("applyCurrentTheme uses the store's current mode", () => {
    const def = getDefaultTheme();
    applyCurrentTheme(storeWith({ theme: "dark" }));
    expect(applyThemeColors).toHaveBeenCalledWith(
      def.dark.themeColor,
      "dark",
      false,
      def.dark.semanticColors,
    );
  });

  it("refreshes the render-cache for the default theme so charts track it", () => {
    const def = getDefaultTheme();
    applyThemeForMode("light", storeWith());
    // No explicit selection, but the cache now reflects the default color.
    expect(localStorage.getItem(THEME_STORAGE_KEYS.light.color)).toBe(
      def.light.themeColor,
    );
  });

  describe("bootstrapTheme", () => {
    it("applies the default theme synchronously when nothing is stored", () => {
      const def = getDefaultTheme();
      bootstrapTheme();
      expect(applyThemeColors).toHaveBeenCalledWith(
        def.light.themeColor,
        "light",
        false,
        def.light.semanticColors,
      );
    });

    it("uses the saved mode and selected predefined theme", () => {
      const ocean = getThemeByName("O2 Pulse")!;
      localStorage.setItem("theme", "dark");
      localStorage.setItem(THEME_STORAGE_KEYS.dark.appliedName, "O2 Pulse");

      bootstrapTheme();

      expect(applyThemeColors).toHaveBeenCalledWith(
        ocean.dark.themeColor,
        "dark",
        false,
        undefined,
      );
    });

    it("migrates a legacy id selection before applying", () => {
      localStorage.setItem("appliedLightTheme", "2"); // legacy id for O2 Pulse
      const ocean = getThemeByName("O2 Pulse")!;

      bootstrapTheme();

      expect(localStorage.getItem(THEME_STORAGE_KEYS.light.appliedName)).toBe(
        "O2 Pulse",
      );
      expect(applyThemeColors).toHaveBeenCalledWith(
        ocean.light.themeColor,
        "light",
        false,
        undefined,
      );
    });
  });
});
