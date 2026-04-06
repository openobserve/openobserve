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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  formatDate,
  isTimeSeries,
  isTimeStamp,
  convertOffsetToSeconds,
  getUTCTimestampFromZonedTimestamp,
} from "@/utils/dashboard/dateTimeUtils";

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    date: {
      subtractFromDate: vi.fn((dateInput: any, subtractObj: any) => {
        const result = new Date(dateInput);
        if (subtractObj.seconds) result.setSeconds(result.getSeconds() - subtractObj.seconds);
        if (subtractObj.minutes) result.setMinutes(result.getMinutes() - subtractObj.minutes);
        if (subtractObj.hours) result.setHours(result.getHours() - subtractObj.hours);
        if (subtractObj.days) result.setDate(result.getDate() - subtractObj.days);
        if (subtractObj.months) result.setMonth(result.getMonth() - subtractObj.months);
        return result;
      }),
    },
  };
});

describe("dateTimeUtils", () => {
  describe("formatDate", () => {
    it("formats a date correctly", () => {
      const date = new Date(2024, 0, 15, 10, 30, 45); // Jan 15, 2024 10:30:45
      expect(formatDate(date)).toBe("2024-01-15 10:30:45");
    });

    it("pads single-digit month and day", () => {
      const date = new Date(2024, 2, 5, 9, 5, 3); // Mar 5, 2024 09:05:03
      expect(formatDate(date)).toBe("2024-03-05 09:05:03");
    });

    it("handles midnight (00:00:00)", () => {
      const date = new Date(2024, 11, 31, 0, 0, 0); // Dec 31, 2024
      expect(formatDate(date)).toBe("2024-12-31 00:00:00");
    });

    it("handles end of day (23:59:59)", () => {
      const date = new Date(2024, 0, 1, 23, 59, 59);
      expect(formatDate(date)).toBe("2024-01-01 23:59:59");
    });

    it("includes full year", () => {
      const date = new Date(2025, 5, 20, 12, 0, 0);
      const result = formatDate(date);
      expect(result.startsWith("2025-")).toBe(true);
    });
  });

  describe("isTimeSeries", () => {
    it("returns true for valid ISO 8601 timestamp array", () => {
      const sample = ["2024-01-15T10:30:45", "2024-01-15T11:00:00"];
      expect(isTimeSeries(sample)).toBe(true);
    });

    it("returns false for array with non-ISO values", () => {
      const sample = ["not-a-date", "2024-01-15T10:30:45"];
      expect(isTimeSeries(sample)).toBe(false);
    });

    it("returns false for plain date strings without time", () => {
      const sample = ["2024-01-15"];
      expect(isTimeSeries(sample)).toBe(false);
    });

    it("returns true for single valid ISO timestamp", () => {
      const sample = ["2024-01-15T00:00:00"];
      expect(isTimeSeries(sample)).toBe(true);
    });

    it("returns false for empty string in array", () => {
      const sample = [""];
      expect(isTimeSeries(sample)).toBe(false);
    });

    it("returns false for numeric values", () => {
      const sample = [1234567890123456];
      expect(isTimeSeries(sample)).toBe(false);
    });

    it("handles array with mixed valid/invalid values", () => {
      const sample = ["2024-01-15T10:30:45", "invalid"];
      expect(isTimeSeries(sample)).toBe(false);
    });

    it("returns true for array with all valid ISO timestamps", () => {
      const sample = [
        "2024-01-15T10:30:45",
        "2024-02-20T15:45:00",
        "2024-12-31T23:59:59",
      ];
      expect(isTimeSeries(sample)).toBe(true);
    });
  });

  describe("isTimeStamp", () => {
    const validMicroseconds = ["1234567890123456", "9876543210654321"];
    const invalidValues = ["123", "hello", "12345678901234567"];

    it("returns false when treatAsNonTimestamp is true", () => {
      expect(isTimeStamp(validMicroseconds, true)).toBe(false);
    });

    it("returns true for 16-digit values when treatAsNonTimestamp is false", () => {
      expect(isTimeStamp(validMicroseconds, false)).toBe(true);
    });

    it("returns false for non-16-digit values when treatAsNonTimestamp is false", () => {
      expect(isTimeStamp(invalidValues, false)).toBe(false);
    });

    it("returns true for 16-digit values when treatAsNonTimestamp is null", () => {
      expect(isTimeStamp(validMicroseconds, null)).toBe(true);
    });

    it("returns true for 16-digit values when treatAsNonTimestamp is undefined", () => {
      expect(isTimeStamp(validMicroseconds, undefined)).toBe(true);
    });

    it("returns false for non-16-digit values when treatAsNonTimestamp is null", () => {
      expect(isTimeStamp(["12345"], null)).toBe(false);
    });

    it("returns undefined for unknown treatAsNonTimestamp value", () => {
      // The function has no return for other values (e.g., "auto")
      expect(isTimeStamp(validMicroseconds, "auto")).toBeUndefined();
    });

    it("handles numeric 16-digit values by converting to string", () => {
      const sample = [1234567890123456];
      expect(isTimeStamp(sample, false)).toBe(true);
    });

    it("checks all values in sample (all must be 16-digit)", () => {
      const mixed = ["1234567890123456", "12345"]; // second is not 16 digits
      expect(isTimeStamp(mixed, false)).toBe(false);
    });
  });

  describe("convertOffsetToSeconds", () => {
    const endTimestamp = new Date("2024-01-15T12:00:00Z").getTime();

    it("converts seconds offset correctly", () => {
      const result = convertOffsetToSeconds("30s", endTimestamp);
      expect(result.seconds).toBe(30000); // 30 seconds in ms
      expect(result.periodAsStr).toBe("30 Seconds ago");
    });

    it("converts minutes offset correctly", () => {
      const result = convertOffsetToSeconds("5m", endTimestamp);
      expect(result.seconds).toBe(300000); // 5 minutes in ms
      expect(result.periodAsStr).toBe("5 Minutes ago");
    });

    it("converts hours offset correctly", () => {
      const result = convertOffsetToSeconds("2h", endTimestamp);
      expect(result.seconds).toBe(7200000); // 2 hours in ms
      expect(result.periodAsStr).toBe("2 Hours ago");
    });

    it("converts days offset correctly", () => {
      const result = convertOffsetToSeconds("1d", endTimestamp);
      expect(result.seconds).toBe(86400000); // 1 day in ms
      expect(result.periodAsStr).toBe("1 Days ago");
    });

    it("converts weeks offset correctly (7 days)", () => {
      const result = convertOffsetToSeconds("1w", endTimestamp);
      expect(result.seconds).toBe(604800000); // 7 days in ms
      expect(result.periodAsStr).toBe("1 Weeks ago");
    });

    it("converts months offset correctly", () => {
      const result = convertOffsetToSeconds("1M", endTimestamp);
      expect(result.seconds).toBeGreaterThan(0);
      expect(result.periodAsStr).toBe("1 Months ago");
    });

    it("returns 0 seconds for invalid unit", () => {
      const result = convertOffsetToSeconds("5x", endTimestamp);
      expect(result.seconds).toBe(0);
      expect(result.periodAsStr).toBe("");
    });

    it("returns 0 seconds for NaN numeric part", () => {
      const result = convertOffsetToSeconds("xs", endTimestamp);
      expect(result.seconds).toBe(0);
      expect(result.periodAsStr).toBe("");
    });

    it("handles 2-week offset (14 days)", () => {
      const result = convertOffsetToSeconds("2w", endTimestamp);
      expect(result.seconds).toBe(1209600000); // 14 days in ms
      expect(result.periodAsStr).toBe("2 Weeks ago");
    });
  });

  describe("getUTCTimestampFromZonedTimestamp", () => {
    it("returns null for falsy timestampMs", () => {
      expect(getUTCTimestampFromZonedTimestamp(0, "UTC")).toBeNull();
    });

    it("returns null for null timestampMs", () => {
      expect(getUTCTimestampFromZonedTimestamp(null as any, "UTC")).toBeNull();
    });

    it("converts UTC timestamp and returns microseconds", () => {
      // 2024-01-15T12:00:00Z in milliseconds
      const ts = new Date("2024-01-15T12:00:00Z").getTime();
      const result = getUTCTimestampFromZonedTimestamp(ts, "UTC");
      // Result should be in microseconds range (much larger than ms)
      expect(result).toBeGreaterThan(ts);
      // Should be approximately ts * 1000 (within 24h of timezone offset)
      const approxExpected = Math.trunc(ts * 1000);
      expect(Math.abs((result as number) - approxExpected)).toBeLessThan(
        24 * 60 * 60 * 1000 * 1000, // 24h in microseconds
      );
    });

    it("returns a number (microseconds)", () => {
      const ts = new Date("2024-01-15T12:00:00Z").getTime();
      const result = getUTCTimestampFromZonedTimestamp(ts, "UTC");
      expect(typeof result).toBe("number");
      // Microseconds should be much larger than milliseconds
      expect(result).toBeGreaterThan(ts);
    });

    it("returns integer (Math.trunc)", () => {
      const ts = new Date("2024-01-15T12:00:00.500Z").getTime();
      const result = getUTCTimestampFromZonedTimestamp(ts, "UTC");
      expect(Number.isInteger(result)).toBe(true);
    });

    it("handles different timezones", () => {
      const ts = new Date("2024-01-15T12:00:00Z").getTime();
      const utcResult = getUTCTimestampFromZonedTimestamp(ts, "UTC");
      const nyResult = getUTCTimestampFromZonedTimestamp(ts, "America/New_York");
      // Results should differ for different timezones
      expect(utcResult).not.toBe(nyResult);
    });
  });
});
