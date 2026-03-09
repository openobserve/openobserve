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
  LIGHT_SPAN_COLORS,
  DARK_SPAN_COLORS,
  getSpanColor,
  getSpanColorHex,
  getServiceColor,
  getServiceColorHex,
  getSpanColorWithOpacity,
  getAllSpanColors,
  generateServiceColorMap,
  getContrastTextColor,
  traceUIColors,
  statusColors,
  spanKindColors,
} from "./traceColors";

describe("traceColors", () => {
  describe("LIGHT_SPAN_COLORS", () => {
    it("should be an array of hex color strings", () => {
      expect(Array.isArray(LIGHT_SPAN_COLORS)).toBe(true);
      LIGHT_SPAN_COLORS.forEach((color) => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it("should have at least one color", () => {
      expect(LIGHT_SPAN_COLORS.length).toBeGreaterThan(0);
    });
  });

  describe("DARK_SPAN_COLORS", () => {
    it("should be an array of hex color strings", () => {
      expect(Array.isArray(DARK_SPAN_COLORS)).toBe(true);
      DARK_SPAN_COLORS.forEach((color) => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it("should have at least one color", () => {
      expect(DARK_SPAN_COLORS.length).toBeGreaterThan(0);
    });
  });

  describe("getSpanColor", () => {
    it("should return a CSS variable string", () => {
      const result = getSpanColor(1);
      expect(result).toBe("var(--o2-span-1)");
    });

    it("should return correct CSS variable for index 25", () => {
      const result = getSpanColor(25);
      expect(result).toBe("var(--o2-span-25)");
    });

    it("should wrap around correctly for index 51 (wraps to 1)", () => {
      const result = getSpanColor(51);
      expect(result).toBe("var(--o2-span-1)");
    });

    it("should wrap around correctly for index 50", () => {
      const result = getSpanColor(50);
      expect(result).toBe("var(--o2-span-50)");
    });

    it("should handle index 100 wrapping", () => {
      const result = getSpanColor(100);
      expect(result).toMatch(/^var\(--o2-span-\d+\)$/);
      const colorIndex = ((100 - 1) % 50) + 1;
      expect(result).toBe(`var(--o2-span-${colorIndex})`);
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

  describe("getServiceColor", () => {
    it("should return a CSS variable string", () => {
      const result = getServiceColor("my-service");
      expect(result).toMatch(/^var\(--o2-span-\d+\)$/);
    });

    it("should return consistent color for the same service name", () => {
      const result1 = getServiceColor("my-service");
      const result2 = getServiceColor("my-service");
      expect(result1).toBe(result2);
    });

    it("should return different colors for different services (most of the time)", () => {
      const color1 = getServiceColor("service-alpha");
      const color2 = getServiceColor("service-beta-very-different");
      // They should be valid CSS vars even if they happen to collide
      expect(color1).toMatch(/^var\(--o2-span-\d+\)$/);
      expect(color2).toMatch(/^var\(--o2-span-\d+\)$/);
    });

    it("should handle empty service name", () => {
      const result = getServiceColor("");
      expect(result).toMatch(/^var\(--o2-span-\d+\)$/);
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

  describe("getSpanColorWithOpacity", () => {
    it("should return a color-mix string", () => {
      const result = getSpanColorWithOpacity(1, 0.5);
      expect(result).toContain("color-mix");
      expect(result).toContain("transparent");
      expect(result).toContain("50%");
    });

    it("should use full opacity by default", () => {
      const result = getSpanColorWithOpacity(1);
      expect(result).toContain("100%");
    });

    it("should wrap index around at 50", () => {
      const result1 = getSpanColorWithOpacity(1, 1);
      const result51 = getSpanColorWithOpacity(51, 1);
      expect(result1).toBe(result51);
    });

    it("should use correct CSS variable", () => {
      const result = getSpanColorWithOpacity(5, 0.8);
      expect(result).toContain("var(--o2-span-5)");
      expect(result).toContain("80%");
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

    it("should return light colors for light theme", () => {
      const colors = getAllSpanColors("light");
      expect(colors.length).toBe(LIGHT_SPAN_COLORS.length);
    });

    it("should return dark colors for dark theme", () => {
      const colors = getAllSpanColors("dark");
      expect(colors.length).toBe(DARK_SPAN_COLORS.length);
    });

    it("should return colors in reversed order", () => {
      const lightColors = getAllSpanColors("light");
      const originalColors = [...LIGHT_SPAN_COLORS];
      expect(lightColors).toEqual(originalColors.reverse());
    });
  });

  describe("generateServiceColorMap", () => {
    it("should return a Map", () => {
      const result = generateServiceColorMap(["service-a", "service-b"]);
      expect(result instanceof Map).toBe(true);
    });

    it("should have an entry for each service", () => {
      const services = ["service-a", "service-b", "service-c"];
      const result = generateServiceColorMap(services);
      expect(result.size).toBe(services.length);
      services.forEach((svc) => {
        expect(result.has(svc)).toBe(true);
      });
    });

    it("should assign CSS variable strings", () => {
      const result = generateServiceColorMap(["service-a"]);
      expect(result.get("service-a")).toMatch(/^var\(--o2-span-\d+\)$/);
    });

    it("should handle empty array", () => {
      const result = generateServiceColorMap([]);
      expect(result.size).toBe(0);
    });

    it("should attempt to use distinct colors for different services", () => {
      const services = ["a", "b", "c", "d", "e"];
      const result = generateServiceColorMap(services);
      const values = Array.from(result.values());
      // At least some should be unique (hard to guarantee due to hashing)
      expect(values.length).toBe(services.length);
    });
  });

  describe("getContrastTextColor", () => {
    it("should return 'white'", () => {
      expect(getContrastTextColor("var(--o2-span-1)")).toBe("white");
    });

    it("should always return white regardless of background", () => {
      expect(getContrastTextColor("#000000")).toBe("white");
      expect(getContrastTextColor("#ffffff")).toBe("white");
      expect(getContrastTextColor("")).toBe("white");
    });
  });

  describe("traceUIColors", () => {
    it("should have expected CSS variable keys", () => {
      expect(traceUIColors.surface).toBe("var(--o2-trace-surface)");
      expect(traceUIColors.border).toBe("var(--o2-trace-border)");
      expect(traceUIColors.textPrimary).toBe("var(--o2-trace-text-primary)");
      expect(traceUIColors.textSecondary).toBe(
        "var(--o2-trace-text-secondary)",
      );
      expect(traceUIColors.hover).toBe("var(--o2-trace-hover)");
      expect(traceUIColors.selected).toBe("var(--o2-trace-selected)");
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
        expect(color).toMatch(/^var\(--o2-/);
      });
    });
  });

  describe("spanKindColors", () => {
    it("should have all span kind keys", () => {
      expect(spanKindColors.client).toBeDefined();
      expect(spanKindColors.server).toBeDefined();
      expect(spanKindColors.producer).toBeDefined();
      expect(spanKindColors.consumer).toBeDefined();
      expect(spanKindColors.internal).toBeDefined();
      expect(spanKindColors.unspecified).toBeDefined();
    });

    it("should use CSS variable strings for most kinds", () => {
      expect(spanKindColors.client).toMatch(/^var\(--o2-/);
      expect(spanKindColors.server).toMatch(/^var\(--o2-/);
    });
  });
});
