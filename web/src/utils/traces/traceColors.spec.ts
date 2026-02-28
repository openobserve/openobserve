// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import {
  getSpanColorHex,
  generateServiceColorMap,
  LIGHT_SPAN_COLORS,
  DARK_SPAN_COLORS,
} from "./traceColors";

describe("traceColors", () => {
  describe("getSpanColorHex", () => {
    it("returns a valid hex color for index 1", () => {
      const color = getSpanColorHex(1);
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("wraps around when index exceeds light colors array length", () => {
      const len = LIGHT_SPAN_COLORS.length;
      expect(getSpanColorHex(1)).toBe(getSpanColorHex(len + 1));
    });

    it("wraps around when index exceeds dark colors array length", () => {
      const len = DARK_SPAN_COLORS.length;
      expect(getSpanColorHex(1, "dark")).toBe(getSpanColorHex(len + 1, "dark"));
    });

    it("handles index far beyond array length (200)", () => {
      const color = getSpanColorHex(200);
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("handles index 0 without returning undefined", () => {
      const color = getSpanColorHex(0);
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("handles negative index without returning undefined", () => {
      const color = getSpanColorHex(-5);
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe("generateServiceColorMap — 200 services", () => {
    const serviceNames = Array.from({ length: 200 }, (_, i) => `service-${i}`);
    let colorMap: Map<string, string>;

    it("generates a color for all 200 services", () => {
      colorMap = generateServiceColorMap(serviceNames);
      expect(colorMap.size).toBe(200);
    });

    it("every generated color is a valid CSS variable referencing a span index", () => {
      colorMap = generateServiceColorMap(serviceNames);
      for (const [, color] of colorMap) {
        expect(color).toMatch(/^var\(--o2-span-\d+\)$/);
      }
    });

    it("span index in every CSS variable is within 1–50", () => {
      colorMap = generateServiceColorMap(serviceNames);
      for (const [, color] of colorMap) {
        const match = color.match(/var\(--o2-span-(\d+)\)/);
        expect(match).not.toBeNull();
        const index = Number(match![1]);
        expect(index).toBeGreaterThanOrEqual(1);
        expect(index).toBeLessThanOrEqual(50);
      }
    });

    it("each service always gets the same color (deterministic)", () => {
      const mapA = generateServiceColorMap(serviceNames);
      const mapB = generateServiceColorMap(serviceNames);
      for (const name of serviceNames) {
        expect(mapA.get(name)).toBe(mapB.get(name));
      }
    });
  });
});
