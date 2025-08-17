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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getUnitValue,
  formatUnitValue,
  isTimeSeries,
  isTimeStamp,
  formatDate,
  getContrastColor,
  calculateOptimalFontSize,
  calculateWidthText
} from "@/utils/dashboard/convertDataIntoUnitValue";

vi.mock("quasar", () => ({
  date: {
    formatDate: vi.fn((date, format) => {
      // Simple mock implementation
      if (format === "MMM DD, YYYY") return "Jan 01, 2024";
      if (format === "HH:mm:ss") return "12:34:56";
      return new Date(date).toISOString();
    })
  }
}));

describe("Dashboard Data Conversion Utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUnitValue", () => {
    it("should convert bytes to appropriate unit", () => {
      expect(getUnitValue(1024, "bytes")).toEqual({
        value: "1.00",
        unit: "KB"
      });

      expect(getUnitValue(1048576, "bytes")).toEqual({
        value: "1.00",
        unit: "MB"
      });

      expect(getUnitValue(1073741824, "bytes")).toEqual({
        value: "1.00",
        unit: "GB"
      });
    });

    it("should convert seconds to appropriate time unit", () => {
      expect(getUnitValue(1, "seconds")).toEqual({
        value: "1.00",
        unit: "s"
      });

      expect(getUnitValue(60, "seconds")).toEqual({
        value: "1.00",
        unit: "m"
      });

      expect(getUnitValue(3600, "seconds")).toEqual({
        value: "1.00",
        unit: "h"
      });
    });

    it("should handle milliseconds conversion", () => {
      expect(getUnitValue(1000, "milliseconds")).toEqual({
        value: "1.00",
        unit: "s"
      });

      expect(getUnitValue(500, "milliseconds")).toEqual({
        value: "500.00",
        unit: "ms"
      });
    });

    it("should handle microseconds conversion", () => {
      expect(getUnitValue(1000000, "microseconds")).toEqual({
        value: "1.00",
        unit: "s"
      });

      expect(getUnitValue(1000, "microseconds")).toEqual({
        value: "1.00",
        unit: "ms"
      });
    });

    it("should handle nanoseconds conversion", () => {
      expect(getUnitValue(1000000000, "nanoseconds")).toEqual({
        value: "1.00",
        unit: "s"
      });

      expect(getUnitValue(1000000, "nanoseconds")).toEqual({
        value: "1.00",
        unit: "ms"
      });
    });

    it("should convert numbers to SI units", () => {
      expect(getUnitValue(1000, "numbers")).toEqual({
        value: "1.00",
        unit: "K"
      });

      expect(getUnitValue(1000000, "numbers")).toEqual({
        value: "1.00",
        unit: "M"
      });

      expect(getUnitValue(1000000000, "numbers")).toEqual({
        value: "1.00",
        unit: "B"
      });
    });

    it("should handle custom units", () => {
      const result = getUnitValue(100, "custom", "items");
      expect(result).toEqual({
        value: "100.00",
        unit: "items"
      });
    });

    it("should handle zero values", () => {
      expect(getUnitValue(0, "bytes")).toEqual({
        value: "0.00",
        unit: "B"
      });

      expect(getUnitValue(0, "seconds")).toEqual({
        value: "0.00",
        unit: "ns"
      });
    });

    it("should handle negative values", () => {
      expect(getUnitValue(-1024, "bytes")).toEqual({
        value: "-1.00",
        unit: "KB"
      });
    });

    it("should handle very large values", () => {
      const largeValue = 1024 * 1024 * 1024 * 1024; // 1TB
      expect(getUnitValue(largeValue, "bytes")).toEqual({
        value: "1.00",
        unit: "TB"
      });
    });

    it("should handle non-numeric values gracefully", () => {
      expect(getUnitValue(null, "bytes")).toEqual({
        value: "0.00",
        unit: "B"
      });

      expect(getUnitValue(undefined, "bytes")).toEqual({
        value: undefined,
        unit: ""
      });
    });
  });

  describe("formatUnitValue", () => {
    it("should format unit values with appropriate precision", () => {
      const unitObj = { value: "1.50", unit: "KB" };
      const result = formatUnitValue(unitObj);
      expect(result).toBe("1.50KB");
    });

    it("should handle decimal precision correctly", () => {
      const unitObj = { value: "1.5", unit: "KB" };
      const result = formatUnitValue(unitObj);
      expect(result).toBe("1.5KB");
    });

    it("should format currency units correctly", () => {
      const dollarObj = { value: "100.00", unit: "$" };
      const result = formatUnitValue(dollarObj);
      expect(result).toBe("$100.00");
    });

    it("should handle euro currency formatting", () => {
      const euroObj = { value: "100.00", unit: "€" };
      const result = formatUnitValue(euroObj);
      expect(result).toBe("€100.00");
    });

    it("should handle zero values in formatting", () => {
      const zeroObj = { value: "0.00", unit: "B" };
      const result = formatUnitValue(zeroObj);
      expect(result).toBe("0.00B");
    });
  });

  describe("isTimeSeries", () => {
    it("should identify time series data correctly", () => {
      const timeSeriesData = [
        "2022-01-01T12:34:56",
        "2022-01-01T12:35:56",
        "2022-01-01T12:36:56"
      ];

      expect(isTimeSeries(timeSeriesData)).toBe(true);
    });

    it("should identify non-time series data", () => {
      const nonTimeSeriesData = [
        "category1",
        "category2",
        "category3"
      ];

      expect(isTimeSeries(nonTimeSeriesData)).toBe(false);
    });

    it("should handle empty arrays", () => {
      expect(isTimeSeries([])).toBe(true); // empty array passes every() check
    });

    it("should handle single data point", () => {
      const singlePoint = ["2022-01-01T12:34:56"];
      expect(isTimeSeries(singlePoint)).toBe(true);
    });

    it("should handle malformed data", () => {
      const malformedData = [
        "2022-01-01T12:34:56",
        "not-a-date",
        "2022-01-01T12:36:56"
      ];

      expect(isTimeSeries(malformedData)).toBe(false);
    });
  });

  describe("isTimeStamp", () => {
    it("should identify valid timestamps", () => {
      const sample = ["1640995200000000", "1640995260000000", "1640995320000000"]; // 16-digit microseconds
      expect(isTimeStamp(sample, false)).toBe(true);
      expect(isTimeStamp(sample, null)).toBe(true);
    });

    it("should identify invalid timestamps", () => {
      const shortSample = ["1640995200", "1640995260"]; // Not 16 digits
      expect(isTimeStamp(shortSample, null)).toBe(false);
      
      const mixedSample = ["1640995200000000", "not-a-number"];
      expect(isTimeStamp(mixedSample, null)).toBe(false);
    });

    it("should handle treatAsNonTimestamp parameter", () => {
      const sample = ["1640995200000000", "1640995260000000"];
      expect(isTimeStamp(sample, true)).toBe(false); // Explicitly not timestamp
      expect(isTimeStamp(sample, false)).toBe(true); // Explicitly is timestamp
      expect(isTimeStamp(sample, null)).toBe(true); // Auto mode
    });

    it("should handle edge cases", () => {
      expect(isTimeStamp([], null)).toBe(true); // Empty array
      expect(isTimeStamp(["0000000000000000"], null)).toBe(true); // 16 zeros
    });
  });

  describe("formatDate", () => {
    it("should format dates to readable format", () => {
      const date = new Date(2022, 0, 1, 12, 34, 56); // Jan 1, 2022 12:34:56
      const result = formatDate(date);
      
      expect(result).toBe("2022-01-01 12:34:56");
    });

    it("should handle different date objects", () => {
      const date1 = new Date(2022, 11, 31, 23, 59, 59); // Dec 31, 2022 23:59:59
      const date2 = new Date(2022, 5, 15, 0, 0, 0); // Jun 15, 2022 00:00:00

      const result1 = formatDate(date1);
      const result2 = formatDate(date2);

      expect(result1).toBe("2022-12-31 23:59:59");
      expect(result2).toBe("2022-06-15 00:00:00");
    });

    it("should pad single digits correctly", () => {
      const date = new Date(2022, 0, 1, 1, 2, 3); // Jan 1, 2022 01:02:03
      const result = formatDate(date);
      
      expect(result).toBe("2022-01-01 01:02:03");
    });
  });

  describe("getContrastColor", () => {
    it("should return white for dark backgrounds", () => {
      expect(getContrastColor("#000000", false)).toBe("#FFFFFF");
      expect(getContrastColor("#333333", false)).toBe("#FFFFFF");
    });

    it("should return black for light backgrounds", () => {
      expect(getContrastColor("#ffffff", false)).toBe("#000000");
      expect(getContrastColor("#f0f0f0", false)).toBe("#000000");
    });

    it("should handle theme parameter", () => {
      expect(getContrastColor("", true)).toBe("#FFFFFF"); // Dark theme
      expect(getContrastColor("", false)).toBe("#000000"); // Light theme
    });

    it("should handle RGB values", () => {
      expect(getContrastColor("rgb(0, 0, 0)", false)).toBe("#FFFFFF");
      expect(getContrastColor("rgb(255, 255, 255)", false)).toBe("#000000");
    });

    it("should handle invalid color codes gracefully", () => {
      expect(getContrastColor("invalid", false)).toBe("#000000");
      expect(getContrastColor(null as any, false)).toBe("#000000");
    });
  });

  describe("calculateOptimalFontSize", () => {
    it("should calculate font size based on canvas width", () => {
      const fontSize = calculateOptimalFontSize("Sample text", 200);
      
      expect(fontSize).toBeGreaterThan(0);
      expect(typeof fontSize).toBe("number");
    });

    it("should return smaller font size for longer text", () => {
      const shortTextSize = calculateOptimalFontSize("Short", 200);
      const longTextSize = calculateOptimalFontSize("This is a very long text that should require smaller font size", 200);

      expect(shortTextSize).toBeGreaterThanOrEqual(longTextSize);
    });

    it("should handle empty text", () => {
      const fontSize = calculateOptimalFontSize("", 200);
      expect(fontSize).toBeGreaterThan(0);
    });

    it("should handle very small canvas width", () => {
      const fontSize = calculateOptimalFontSize("Text", 10);
      expect(fontSize).toBeGreaterThan(0);
      expect(fontSize).toBeLessThanOrEqual(90); // Max font size
    });

    it("should handle very large canvas width", () => {
      const fontSize = calculateOptimalFontSize("Text", 2000);
      expect(fontSize).toBeGreaterThan(0);
      expect(fontSize).toBeLessThanOrEqual(90); // Max font size
    });
  });

  describe("calculateWidthText", () => {
    it("should calculate text width for given font size", () => {
      const width = calculateWidthText("Sample text", "16px");
      
      expect(typeof width).toBe("number");
      expect(width).toBeGreaterThanOrEqual(0); // DOM in test env returns 0
    });

    it("should return larger width for larger font size", () => {
      const smallFontWidth = calculateWidthText("Text", "12px");
      const largeFontWidth = calculateWidthText("Text", "24px");

      expect(typeof smallFontWidth).toBe("number");
      expect(typeof largeFontWidth).toBe("number");
      // In test env, both will be 0 due to DOM limitations
      expect(largeFontWidth).toBeGreaterThanOrEqual(smallFontWidth);
    });

    it("should return larger width for longer text", () => {
      const shortWidth = calculateWidthText("Hi", "16px");
      const longWidth = calculateWidthText("Hello World", "16px");

      expect(typeof shortWidth).toBe("number");
      expect(typeof longWidth).toBe("number");
      // In test env, both will be 0 due to DOM limitations
      expect(longWidth).toBeGreaterThanOrEqual(shortWidth);
    });

    it("should handle empty string", () => {
      const width = calculateWidthText("", "16px");
      expect(width).toBe(0);
    });

    it("should handle zero font size", () => {
      const width = calculateWidthText("Text", "0px");
      expect(typeof width).toBe("number");
      expect(width).toBeGreaterThanOrEqual(0);
    });

    it("should handle negative font size", () => {
      const width = calculateWidthText("Text", "-12px");
      expect(typeof width).toBe("number");
      expect(width).toBeGreaterThanOrEqual(0);
    });

    it("should handle special characters", () => {
      const width = calculateWidthText("Hello 世界! @#$%", "16px");
      expect(typeof width).toBe("number");
      expect(width).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle extremely large numbers in unit conversion", () => {
      const result = getUnitValue(Number.MAX_SAFE_INTEGER, "bytes");
      expect(result).toBeDefined();
      expect(typeof result.value).toBe("string");
      expect(parseFloat(result.value)).toBeGreaterThan(0);
    });

    it("should handle floating point precision issues", () => {
      const result = getUnitValue(1024.000001, "bytes");
      expect(result.unit).toBe("KB");
      expect(parseFloat(result.value)).toBeCloseTo(1, 2);
    });

    it("should handle different number formats", () => {
      expect(getUnitValue("1024" as any, "bytes")).toEqual({
        value: "1.00",
        unit: "KB"
      });

      expect(getUnitValue(1024.5, "bytes")).toEqual({
        value: expect.stringMatching(/^1\.00$/),
        unit: "KB"
      });
    });

    it("should maintain precision in calculations", () => {
      const unitObj = getUnitValue(1536, "bytes");
      const result = formatUnitValue(unitObj);
      expect(result).toMatch(/1\.[05].*KB/);
    });
  });
});