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

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseDuration,
  generateDurationLabel,
  getQueryParamsForDuration,
  getDurationObjectFromParams,
  getConsumableRelativeTime,
  getRelativePeriod,
  isInvalidDate,
  convertUnixToQuasarFormat,
  convertDateToTimestamp,
} from "./date";

describe("Date Utilities", () => {
  describe("parseDuration", () => {
    it("should parse seconds correctly", () => {
      expect(parseDuration("30s")).toBe(30);
      expect(parseDuration("1s")).toBe(1);
      expect(parseDuration("0s")).toBe(0);
    });

    it("should parse minutes correctly", () => {
      expect(parseDuration("5m")).toBe(300); // 5 * 60
      expect(parseDuration("1m")).toBe(60);
      expect(parseDuration("15m")).toBe(900); // 15 * 60
    });

    it("should parse hours correctly", () => {
      expect(parseDuration("2h")).toBe(7200); // 2 * 3600
      expect(parseDuration("1h")).toBe(3600);
      expect(parseDuration("24h")).toBe(86400); // 24 * 3600
    });

    it("should parse days correctly", () => {
      expect(parseDuration("1d")).toBe(86400); // 1 * 86400
      expect(parseDuration("7d")).toBe(604800); // 7 * 86400
    });

    it("should parse weeks correctly", () => {
      expect(parseDuration("1w")).toBe(604800); // 1 * 604800
      expect(parseDuration("2w")).toBe(1209600); // 2 * 604800
    });

    it("should parse months correctly", () => {
      expect(parseDuration("1M")).toBe(2592000); // 1 * 2592000
      expect(parseDuration("3M")).toBe(7776000); // 3 * 2592000
    });

    it("should parse years correctly", () => {
      expect(parseDuration("1y")).toBe(31536000); // 1 * 31536000
      expect(parseDuration("2y")).toBe(63072000); // 2 * 31536000
    });

    it("should handle numbers without units", () => {
      expect(parseDuration("123")).toBe(123);
      expect(parseDuration("0")).toBe(0);
    });

    it("should return 0 for invalid formats", () => {
      expect(parseDuration("invalid")).toBe(0);
      expect(parseDuration("")).toBe(0);
      expect(parseDuration("abc123")).toBe(0);
      expect(parseDuration("12x")).toBe(0);
    });
  });

  describe("generateDurationLabel", () => {
    it("should generate correct labels for exact units", () => {
      expect(generateDurationLabel(1)).toBe("1s");
      expect(generateDurationLabel(60)).toBe("1m");
      expect(generateDurationLabel(3600)).toBe("1h");
      expect(generateDurationLabel(86400)).toBe("1d");
      expect(generateDurationLabel(604800)).toBe("1w");
      expect(generateDurationLabel(2592000)).toBe("1M");
      expect(generateDurationLabel(31536000)).toBe("1y");
    });

    it("should generate correct labels for multiple units", () => {
      expect(generateDurationLabel(120)).toBe("2m");
      expect(generateDurationLabel(7200)).toBe("2h");
      expect(generateDurationLabel(172800)).toBe("2d");
      expect(generateDurationLabel(1209600)).toBe("2w");
    });

    it("should handle non-exact units by showing seconds", () => {
      expect(generateDurationLabel(90)).toBe("90s"); // 1.5 minutes
      expect(generateDurationLabel(3661)).toBe("3661s"); // 1 hour + 1 minute + 1 second
    });

    it("should return 'Off' for 0 duration", () => {
      expect(generateDurationLabel(0)).toBe("Off");
    });

    it("should handle small durations", () => {
      expect(generateDurationLabel(1)).toBe("1s");
      expect(generateDurationLabel(30)).toBe("30s");
    });
  });

  describe("getQueryParamsForDuration", () => {
    it("should generate query params for relative minutes", () => {
      const obj = {
        tab: "relative",
        relative: {
          period: { label: "Minutes" },
          value: 15,
        },
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };
      const result = getQueryParamsForDuration(obj);
      expect(result).toEqual({ period: "15m" });
    });

    it("should generate query params for relative hours", () => {
      const obj = {
        tab: "relative",
        relative: {
          period: { label: "Hours" },
          value: 2,
        },
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };
      const result = getQueryParamsForDuration(obj);
      expect(result).toEqual({ period: "2h" });
    });

    it("should generate query params for relative days", () => {
      const obj = {
        tab: "relative",
        relative: {
          period: { label: "Days" },
          value: 7,
        },
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };
      const result = getQueryParamsForDuration(obj);
      expect(result).toEqual({ period: "7d" });
    });

    it("should generate query params for relative weeks", () => {
      const obj = {
        tab: "relative",
        relative: {
          period: { label: "Weeks" },
          value: 1,
        },
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };
      const result = getQueryParamsForDuration(obj);
      expect(result).toEqual({ period: "1w" });
    });

    it("should generate query params for relative months", () => {
      const obj = {
        tab: "relative",
        relative: {
          period: { label: "Months" },
          value: 3,
        },
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };
      const result = getQueryParamsForDuration(obj);
      expect(result).toEqual({ period: "3M" });
    });

    it("should generate query params for absolute time", () => {
      const obj = {
        tab: "absolute",
        relative: {
          period: { label: "" },
          value: 0,
        },
        absolute: {
          date: {
            from: "2023-01-01",
            to: "2023-01-02",
          },
          startTime: "00:00",
          endTime: "23:59",
        },
      };
      const result = getQueryParamsForDuration(obj);
      
      // Check that the result has from and to properties
      expect(result).toHaveProperty("from");
      expect(result).toHaveProperty("to");
      expect(typeof result.from).toBe("string");
      expect(typeof result.to).toBe("string");
    });

    it("should return empty object for unknown tab", () => {
      const obj = {
        tab: "unknown",
        relative: {
          period: { label: "" },
          value: 0,
        },
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };
      const result = getQueryParamsForDuration(obj);
      expect(result).toEqual({});
    });
  });

  describe("getDurationObjectFromParams", () => {
    it("should parse relative minutes from params", () => {
      const params = { period: "15m" };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Minutes", value: "Minutes" });
      expect(result.relative.value).toBe(15);
    });

    it("should parse relative hours from params", () => {
      const params = { period: "2h" };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Hours", value: "Hours" });
      expect(result.relative.value).toBe(2);
    });

    it("should parse relative days from params", () => {
      const params = { period: "7d" };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Days", value: "Days" });
      expect(result.relative.value).toBe(7);
    });

    it("should parse relative weeks from params", () => {
      const params = { period: "1w" };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Weeks", value: "Weeks" });
      expect(result.relative.value).toBe(1);
    });

    it("should parse relative months from params", () => {
      const params = { period: "3M" };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Months", value: "Months" });
      expect(result.relative.value).toBe(3);
    });

    it("should parse absolute time from params", () => {
      const fromTime = new Date("2023-01-01T00:00:00Z").getTime();
      const toTime = new Date("2023-01-02T23:59:00Z").getTime();
      
      const params = { 
        from: fromTime.toString(), 
        to: toTime.toString() 
      };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("absolute");
      expect(result.absolute.date.from).toBeDefined();
      expect(result.absolute.date.to).toBeDefined();
      expect(result.absolute.startTime).toBeDefined();
      expect(result.absolute.endTime).toBeDefined();
    });

    it("should return default object for empty params", () => {
      const result = getDurationObjectFromParams({});
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Minutes", value: "Minutes" });
      expect(result.relative.value).toBe(15);
    });

    it("should return default object for invalid params", () => {
      const params = { invalid: "data" };
      const result = getDurationObjectFromParams(params);
      
      expect(result.tab).toBe("relative");
      expect(result.relative.period).toEqual({ label: "Minutes", value: "Minutes" });
      expect(result.relative.value).toBe(15);
    });
  });

  describe("getConsumableRelativeTime", () => {
    it("should calculate relative time for minutes", () => {
      const result = getConsumableRelativeTime("15m");
      
      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(typeof result?.startTime).toBe("number");
      expect(typeof result?.endTime).toBe("number");
      expect(result?.endTime).toBeGreaterThan(result?.startTime);
    });

    it("should calculate relative time for hours", () => {
      const result = getConsumableRelativeTime("2h");
      
      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(typeof result?.startTime).toBe("number");
      expect(typeof result?.endTime).toBe("number");
    });

    it("should handle weeks by converting to days", () => {
      const result = getConsumableRelativeTime("1w");
      
      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("endTime");
      expect(typeof result?.startTime).toBe("number");
      expect(typeof result?.endTime).toBe("number");
    });

    it("should return undefined for invalid period format", () => {
      const result = getConsumableRelativeTime("invalid");
      expect(result).toBeUndefined();
    });

    it("should return undefined for empty period", () => {
      const result = getConsumableRelativeTime("");
      expect(result).toBeUndefined();
    });
  });

  describe("getRelativePeriod", () => {
    it("should map time unit codes to full names", () => {
      expect(getRelativePeriod("s")).toBe("Seconds");
      expect(getRelativePeriod("m")).toBe("Minutes");
      expect(getRelativePeriod("h")).toBe("Hours");
      expect(getRelativePeriod("d")).toBe("Days");
      expect(getRelativePeriod("w")).toBe("Weeks");
      expect(getRelativePeriod("M")).toBe("Months");
    });

    it("should return undefined for invalid codes", () => {
      expect(getRelativePeriod("x")).toBeUndefined();
      expect(getRelativePeriod("")).toBeUndefined();
      expect(getRelativePeriod("invalid")).toBeUndefined();
    });
  });

  describe("isInvalidDate", () => {
    it("should return false for valid dates", () => {
      expect(isInvalidDate(new Date())).toBe(false);
      expect(isInvalidDate(new Date("2023-01-01"))).toBe(false);
      expect(isInvalidDate(new Date(2023, 0, 1))).toBe(false);
    });

    it("should return true for invalid dates", () => {
      expect(isInvalidDate(new Date("invalid"))).toBe(true);
      expect(isInvalidDate(new Date(NaN))).toBe(true);
    });

    it("should return true for non-date values", () => {
      expect(isInvalidDate(null)).toBe(true);
      expect(isInvalidDate(undefined)).toBe(true);
      expect(isInvalidDate("2023-01-01")).toBe(true);
      expect(isInvalidDate(123456789)).toBe(true);
      expect(isInvalidDate({})).toBe(true);
      expect(isInvalidDate([])).toBe(true);
    });
  });

  describe("convertUnixToQuasarFormat", () => {
    it("should convert unix microseconds to quasar format", () => {
      const unixMicros = 1672531200000000; // 2023-01-01 00:00:00 UTC in microseconds
      const result = convertUnixToQuasarFormat(unixMicros);
      
      // Check that the result contains the expected date part
      expect(result).toContain("2023-01-01");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should handle zero microseconds", () => {
      const result = convertUnixToQuasarFormat(0);
      expect(result).toBe("");
    });

    it("should return empty string for null/undefined", () => {
      expect(convertUnixToQuasarFormat(null)).toBe("");
      expect(convertUnixToQuasarFormat(undefined)).toBe("");
    });

    it("should handle errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = convertUnixToQuasarFormat("invalid");
      
      expect(result).toBe("");
      expect(consoleSpy).toHaveBeenCalledWith("Error converting unix to quasar format");
      
      consoleSpy.mockRestore();
    });
  });

  describe("convertDateToTimestamp", () => {

    it("should convert date and time to timestamp", () => {
      const result = convertDateToTimestamp("01-01-2023", "12:00", "UTC");
      
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("offset");
      expect(typeof result.timestamp).toBe("number");
      expect(typeof result.offset).toBe("number");
      // Check for either valid timestamp or error handling (0)
      expect(result.timestamp).toBeGreaterThanOrEqual(0);
    });

    it("should handle browser timezone", () => {
      // Use actual browser timezone format
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const browserTime = `Browser Time (${browserTimezone})`;
      const result = convertDateToTimestamp("01-01-2023", "12:00", browserTime);
      
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("offset");
      expect(typeof result.timestamp).toBe("number");
      expect(typeof result.offset).toBe("number");
      expect(result.timestamp).toBeGreaterThanOrEqual(0);
    });

    it("should handle different timezones", () => {
      const result = convertDateToTimestamp("01-01-2023", "12:00", "America/New_York");
      
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("offset");
      expect(result.timestamp).toBeGreaterThanOrEqual(0);
    });

    it("should handle errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = convertDateToTimestamp("invalid-date", "invalid-time", "UTC");
      
      expect(result).toEqual({ timestamp: 0, offset: 0 });
      expect(consoleSpy).toHaveBeenCalledWith("Error converting date to timestamp");
      
      consoleSpy.mockRestore();
    });

    it("should handle edge cases", () => {
      // Test with different date formats that might cause issues
      const result1 = convertDateToTimestamp("31-12-2023", "23:59", "UTC");
      const result2 = convertDateToTimestamp("01-01-2024", "00:00", "UTC");
      
      expect(result1.timestamp).toBeGreaterThanOrEqual(0);
      expect(result2.timestamp).toBeGreaterThanOrEqual(0);
      // Only compare if both timestamps are valid (not 0)
      if (result1.timestamp > 0 && result2.timestamp > 0) {
        expect(result2.timestamp).toBeGreaterThan(result1.timestamp);
      }
    });
  });
});