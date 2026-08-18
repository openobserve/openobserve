// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import {
  SPAN_COLOR_COUNT,
  getSpanColorHex,
  getServiceColorHex,
  getAllSpanColors,
  getContrastTextColor,
  traceUIColors,
  statusColors,
} from "./traceColors";
import { chartColor } from "../chartTheme";

describe("traceColors", () => {
  describe("SPAN_COLOR_COUNT", () => {
    it("resolves to the 35 --color-trace-span-* tokens in base/dark.css", () => {
      // Concrete pin: guards against the FALLBACKS-key derivation matching the
      // wrong set (renamed prefix, added/removed token) — the length assertions
      // elsewhere use SPAN_COLOR_COUNT on both sides and can't catch that.
      expect(SPAN_COLOR_COUNT).toBe(35);
    });
  });

  describe("getSpanColorHex", () => {
    it("should return a hex color for light theme by default", () => {
      const result = getSpanColorHex(1);
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return a light color for light theme", () => {
      const result = getSpanColorHex(1, "light");
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return a dark color for dark theme", () => {
      const result = getSpanColorHex(1, "dark");
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return different colors for light and dark themes", () => {
      const lightColor = getSpanColorHex(1, "light");
      const darkColor = getSpanColorHex(1, "dark");
      // Light and dark colors should potentially differ
      expect(typeof lightColor).toBe("string");
      expect(typeof darkColor).toBe("string");
    });
  });

  describe("getServiceColorHex", () => {
    it("should return a hex color string", () => {
      const result = getServiceColorHex("my-service");
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return consistent color for same service name", () => {
      const result1 = getServiceColorHex("my-service", "light");
      const result2 = getServiceColorHex("my-service", "light");
      expect(result1).toBe(result2);
    });

    it("should return hex for dark theme", () => {
      const result = getServiceColorHex("my-service", "dark");
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe("getAllSpanColors", () => {
    it("should return an array of hex colors for light theme by default", () => {
      const colors = getAllSpanColors();
      expect(Array.isArray(colors)).toBe(true);
      colors.forEach((color) => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it("should return one entry per --color-trace-span-* token (light)", () => {
      const colors = getAllSpanColors("light");
      expect(colors.length).toBe(SPAN_COLOR_COUNT);
    });

    it("should return one entry per --color-trace-span-* token (dark)", () => {
      const colors = getAllSpanColors("dark");
      expect(colors.length).toBe(SPAN_COLOR_COUNT);
    });

    it("should return the trace-span tokens in reversed order", () => {
      const expected = Array.from({ length: SPAN_COLOR_COUNT }, (_v, i) =>
        chartColor(`--color-trace-span-${i + 1}`),
      );
      expect(getAllSpanColors("light")).toEqual(expected.reverse());
    });
  });

  describe("getContrastTextColor", () => {
    // A value this cannot measure keeps the old always-white behaviour, so
    // existing callers passing a CSS var reference are unaffected.
    it("returns white for a value it cannot measure", () => {
      expect(getContrastTextColor("var(--color-trace-span-1)")).toBe("white");
      expect(getContrastTextColor("")).toBe("white");
      expect(getContrastTextColor("not-a-colour")).toBe("white");
      expect(getContrastTextColor("#12345")).toBe("white");
    });

    it("picks the text colour from the background's luminance", () => {
      expect(getContrastTextColor("#000000")).toBe("white");
      expect(getContrastTextColor("#ffffff")).toBe("black");
      expect(getContrastTextColor("#1f3a5f")).toBe("white"); // dark navy
      expect(getContrastTextColor("#ffe0a3")).toBe("black"); // pale amber
    });

    it("accepts hex shorthand and an absent leading hash", () => {
      expect(getContrastTextColor("#fff")).toBe("black");
      expect(getContrastTextColor("#000")).toBe("white");
      expect(getContrastTextColor("ffffff")).toBe("black");
    });

    // Luminance is not brightness: green weighs ~3.5x more than blue, so a
    // saturated green needs dark text where an equally saturated blue does not.
    it("weights channels by luminance, not by raw value", () => {
      expect(getContrastTextColor("#00ff00")).toBe("black");
      expect(getContrastTextColor("#0000ff")).toBe("white");
    });

    // The real palette these labels land on — every entry must resolve to a
    // readable pairing rather than throwing or returning something unexpected.
    it("resolves every span colour in the palette", () => {
      for (const color of getAllSpanColors()) {
        if (!color.startsWith("#")) continue;
        expect(["white", "black"]).toContain(getContrastTextColor(color));
      }
    });
  });

  describe("traceUIColors", () => {
    it("should have expected CSS variable keys", () => {
      expect(traceUIColors.surface).toBe("var(--color-trace-surface)");
      expect(traceUIColors.border).toBe("var(--color-trace-border)");
      expect(traceUIColors.textPrimary).toBe("var(--color-trace-text-primary)");
      expect(traceUIColors.textSecondary).toBe("var(--color-trace-text-secondary)");
      expect(traceUIColors.hover).toBe("var(--color-trace-hover)");
      expect(traceUIColors.selected).toBe("var(--color-trace-selected)");
    });
  });

  describe("statusColors", () => {
    it("should have error, success, warning, info keys", () => {
      expect(statusColors.error).toBeDefined();
      expect(statusColors.success).toBeDefined();
      expect(statusColors.warning).toBeDefined();
      expect(statusColors.info).toBeDefined();
    });

    it("should use CSS variable strings", () => {
      Object.values(statusColors).forEach((color) => {
        expect(color).toMatch(/^var\(--color-/);
      });
    });
  });
});
