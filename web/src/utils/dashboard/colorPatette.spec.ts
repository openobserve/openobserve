// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi } from "vitest";
import {
  ColorModeWithoutMinMax,
  classicColorPaletteLightTheme,
  classicColorPaletteDarkTheme,
  getColorPalette,
  shadeColor,
  getMetricMinMaxValue,
  getSQLMinMaxValue,
  getSeriesColor,
} from "./colorPalette";

// Mock d3-scale
vi.mock("d3-scale", () => ({
  scaleLinear: vi.fn().mockReturnValue(vi.fn().mockReturnValue("#ff0000")),
}));

describe("Color Palette Utils", () => {
  describe("ColorModeWithoutMinMax enum", () => {
    it("should have correct enum values", () => {
      expect(ColorModeWithoutMinMax.PALETTE_CLASSIC_BY_SERIES).toBe("palette-classic-by-series");
      expect(ColorModeWithoutMinMax.PALETTE_CLASSIC).toBe("palette-classic");
      expect(ColorModeWithoutMinMax.FIXED).toBe("fixed");
    });
  });

  describe("Color Palettes", () => {
    it("should have valid light theme colors", () => {
      expect(classicColorPaletteLightTheme).toBeDefined();
      expect(Array.isArray(classicColorPaletteLightTheme)).toBe(true);
      expect(classicColorPaletteLightTheme.length).toBeGreaterThan(0);
      
      classicColorPaletteLightTheme.forEach(color => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it("should have valid dark theme colors", () => {
      expect(classicColorPaletteDarkTheme).toBeDefined();
      expect(Array.isArray(classicColorPaletteDarkTheme)).toBe(true);
      expect(classicColorPaletteDarkTheme.length).toBeGreaterThan(0);
      
      classicColorPaletteDarkTheme.forEach(color => {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it("should have different colors for light and dark themes", () => {
      expect(classicColorPaletteLightTheme).not.toEqual(classicColorPaletteDarkTheme);
    });
  });

  describe("getColorPalette", () => {
    it("should return dark theme colors for dark theme", () => {
      const result = getColorPalette("dark");
      expect(result).toBe(classicColorPaletteDarkTheme);
    });

    it("should return light theme colors for light theme", () => {
      const result = getColorPalette("light");
      expect(result).toBe(classicColorPaletteLightTheme);
    });

    it("should return light theme colors for unknown theme", () => {
      const result = getColorPalette("unknown");
      expect(result).toBe(classicColorPaletteLightTheme);
    });

    it("should return light theme colors for empty string", () => {
      const result = getColorPalette("");
      expect(result).toBe(classicColorPaletteLightTheme);
    });
  });

  describe("shadeColor", () => {
    it("should return shaded color for valid hex color", () => {
      const result = shadeColor("#ff0000", 50, 0, 100);
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(result).not.toBe("#ff0000");
    });

    it("should handle hex colors without # prefix", () => {
      const result = shadeColor("ff0000", 50, 0, 100);
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return null for invalid hex color", () => {
      expect(shadeColor("invalid", 50, 0, 100)).toBeNull();
      expect(shadeColor("gggggg", 50, 0, 100)).toBeNull();
      expect(shadeColor("#gggggg", 50, 0, 100)).toBeNull();
    });

    it("should return null for non-number parameters", () => {
      expect(shadeColor("#ff0000", "50" as any, 0, 100)).toBeNull();
      expect(shadeColor("#ff0000", 50, "0" as any, 100)).toBeNull();
      expect(shadeColor("#ff0000", 50, 0, "100" as any)).toBeNull();
    });

    it("should handle edge case where min equals max", () => {
      const result = shadeColor("#ff0000", 50, 100, 100);
      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should handle values outside min-max range", () => {
      const result1 = shadeColor("#ff0000", -10, 0, 100);
      const result2 = shadeColor("#ff0000", 150, 0, 100);
      
      expect(result1).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(result2).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should produce different shades for different values", () => {
      const shade1 = shadeColor("#ff0000", 25, 0, 100);
      const shade2 = shadeColor("#ff0000", 75, 0, 100);
      
      expect(shade1).not.toBe(shade2);
    });
  });

  describe("getMetricMinMaxValue", () => {
    it("should return correct min and max from metric data", () => {
      const data = [
        {
          result: [
            { values: [[1, 10], [2, 20], [3, 30]] },
            { values: [[4, 5], [5, 15], [6, 25]] }
          ]
        },
        {
          result: [
            { values: [[7, 35], [8, 2], [9, 40]] }
          ]
        }
      ];

      const [min, max] = getMetricMinMaxValue(data);
      expect(min).toBe(2);
      expect(max).toBe(40);
    });

    it("should handle empty data", () => {
      const [min, max] = getMetricMinMaxValue([]);
      expect(min).toBe(Infinity);
      expect(max).toBe(-Infinity);
    });

    it("should handle data with no results", () => {
      const data = [{ result: [] }, {}];
      const [min, max] = getMetricMinMaxValue(data);
      expect(min).toBe(Infinity);
      expect(max).toBe(-Infinity);
    });

    it("should filter out NaN values", () => {
      const data = [
        {
          result: [
            { values: [[1, 10], [2, NaN], [3, 30]] }
          ]
        }
      ];

      const [min, max] = getMetricMinMaxValue(data);
      expect(min).toBe(10);
      expect(max).toBe(30);
    });

    it("should handle undefined result", () => {
      const data = [
        { result: undefined },
        {
          result: [
            { values: [[1, 10], [2, 20]] }
          ]
        }
      ];

      const [min, max] = getMetricMinMaxValue(data);
      expect(min).toBe(10);
      expect(max).toBe(20);
    });
  });

  describe("getSQLMinMaxValue", () => {
    const yaxisKeys = ['value1', 'value2'];
    
    it("should return correct min and max from SQL data", () => {
      const data = [
        { value1: 10, value2: 20, other: 100 },
        { value1: 5, value2: 30, other: 200 },
        { value1: 15, value2: 10, other: 300 }
      ];

      const [min, max] = getSQLMinMaxValue(yaxisKeys, data);
      expect(min).toBe(5);
      expect(max).toBe(30);
    });

    it("should handle empty data", () => {
      const [min, max] = getSQLMinMaxValue(yaxisKeys, []);
      expect(min).toBe(Infinity);
      expect(max).toBe(-Infinity);
    });

    it("should handle empty yaxis keys", () => {
      const data = [{ value1: 10, value2: 20 }];
      const [min, max] = getSQLMinMaxValue([], data);
      expect(min).toBe(Infinity);
      expect(max).toBe(-Infinity);
    });

    it("should filter out null, undefined, and NaN values", () => {
      const data = [
        { value1: 10, value2: null },
        { value1: undefined, value2: 20 },
        { value1: NaN, value2: 30 },
        { value1: 5, value2: 15 }
      ];

      const [min, max] = getSQLMinMaxValue(yaxisKeys, data);
      expect(min).toBe(5);
      expect(max).toBe(30);
    });

    it("should handle non-number values", () => {
      const data = [
        { value1: "10", value2: 20 },
        { value1: true, value2: 30 },
        { value1: 5, value2: "invalid" }
      ];

      const [min, max] = getSQLMinMaxValue(yaxisKeys, data);
      expect(min).toBe(5);
      expect(max).toBe(30);
    });

    it("should handle data without specified keys", () => {
      const data = [
        { other1: 10, other2: 20 },
        { different: 30 }
      ];

      const [min, max] = getSQLMinMaxValue(yaxisKeys, data);
      expect(min).toBe(Infinity);
      expect(max).toBe(-Infinity);
    });
  });

  describe("getSeriesColor", () => {
    const mockTheme = "light";
    const mockSeriesName = "test-series";
    const mockValue = [10, 20, 30];
    const chartMin = 0;
    const chartMax = 100;

    it("should return custom color from colorBySeries mapping", () => {
      const colorBySeries = [
        { value: "test-series", color: "#custom" }
      ];

      const result = getSeriesColor(
        null,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme,
        colorBySeries
      );

      expect(result).toBe("#custom");
    });

    it("should return palette color when no config provided", () => {
      const result = getSeriesColor(
        null,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return fixed color for fixed mode", () => {
      const colorCfg = {
        mode: "fixed" as const,
        fixedColor: ["#123456"]
      };

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toBe("#123456");
    });

    it("should return default fixed color when fixedColor is not provided", () => {
      const colorCfg = {
        mode: "fixed" as const
      };

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toBe("#53ca53");
    });

    it("should return shaded color for shades mode", () => {
      const colorCfg = {
        mode: "shades" as const,
        fixedColor: ["#ff0000"]
      };

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(result).not.toBe("#ff0000");
    });

    it("should return palette color for palette-classic-by-series mode", () => {
      const colorCfg = {
        mode: "palette-classic-by-series" as const
      };

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return null for palette-classic mode", () => {
      const colorCfg = {
        mode: "palette-classic" as const
      };

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toBeNull();
    });

    it("should use d3 scale for continuous color modes", () => {
      const colorCfg = {
        mode: "continuous-green-yellow-red" as const,
        fixedColor: ["#00ff00", "#ffff00", "#ff0000"]
      };

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toBe("#ff0000"); // Mocked d3 scale result
    });

    it("should handle empty series name", () => {
      const result = getSeriesColor(
        null,
        "",
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should handle undefined series name", () => {
      const result = getSeriesColor(
        null,
        undefined as any,
        mockValue,
        chartMin,
        chartMax,
        mockTheme
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should prioritize custom color mapping over config", () => {
      const colorCfg = {
        mode: "fixed" as const,
        fixedColor: ["#ffffff"]
      };
      const colorBySeries = [
        { value: mockSeriesName, color: "#000000" }
      ];

      const result = getSeriesColor(
        colorCfg,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme,
        colorBySeries
      );

      expect(result).toBe("#000000");
    });

    it("should handle empty colorBySeries array", () => {
      const result = getSeriesColor(
        null,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        mockTheme,
        []
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should use dark theme colors", () => {
      const result = getSeriesColor(
        null,
        mockSeriesName,
        mockValue,
        chartMin,
        chartMax,
        "dark"
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe("Integration Tests", () => {
    it("should work together for complete color processing workflow", () => {
      const mockData = [
        { metric1: 10, metric2: 20 },
        { metric1: 30, metric2: 5 },
        { metric1: 15, metric2: 25 }
      ];
      
      const [min, max] = getSQLMinMaxValue(['metric1', 'metric2'], mockData);
      expect(min).toBe(5);
      expect(max).toBe(30);

      const colorCfg = {
        mode: "shades" as const,
        fixedColor: ["#ff0000"]
      };

      const color = getSeriesColor(
        colorCfg,
        "test-series",
        [20],
        min,
        max,
        "light"
      );

      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should handle metric data processing workflow", () => {
      const metricData = [
        {
          result: [
            { values: [[1, 10], [2, 20], [3, 30]] }
          ]
        }
      ];

      const [min, max] = getMetricMinMaxValue(metricData);
      expect(min).toBe(10);
      expect(max).toBe(30);

      const color = getSeriesColor(
        null,
        "metric-series",
        [25],
        min,
        max,
        "dark"
      );

      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe("Edge Cases", () => {
    it("should handle extreme values in shadeColor", () => {
      const result1 = shadeColor("#ffffff", Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
      const result2 = shadeColor("#000000", Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0);
      
      expect(result1).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(result2).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should handle very long series names", () => {
      const longSeriesName = "a".repeat(1000);
      const result = getSeriesColor(
        null,
        longSeriesName,
        [10],
        0,
        100,
        "light"
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should handle series names with special characters", () => {
      const specialSeriesName = "test-series_with.special@chars#123$%^&*()";
      const result = getSeriesColor(
        null,
        specialSeriesName,
        [10],
        0,
        100,
        "light"
      );

      expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});
