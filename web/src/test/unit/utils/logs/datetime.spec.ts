// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  extractTimestamps,
  getCurrentTimestamp,
  formatTimePeriod,
  isValidTimePeriod,
  getCurrentTimestampMicroseconds,
  millisecondsToMicroseconds,
  microsecondsToMilliseconds,
  calculateDuration,
  formatDuration,
  TIME_MULTIPLIERS
} from "@/utils/logs/datetime";

describe("Datetime Utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("extractTimestamps", () => {
    it("should extract timestamps for seconds", () => {
      const result = extractTimestamps("30s");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(30 * 1000);
    });

    it("should extract timestamps for minutes", () => {
      const result = extractTimestamps("15m");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(15 * 60 * 1000);
    });

    it("should extract timestamps for hours", () => {
      const result = extractTimestamps("2h");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(2 * 60 * 60 * 1000);
    });

    it("should extract timestamps for days", () => {
      const result = extractTimestamps("7d");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("should extract timestamps for weeks", () => {
      const result = extractTimestamps("2w");
      expect(result).toBeDefined();
      expect(result!.to - result!.from).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    });

    it("should extract timestamps for months", () => {
      const result = extractTimestamps("1M");
      expect(result).toBeDefined();
      // Should go back to beginning of previous month
      const expectedFromDate = new Date(2023, 11, 1); // December 2023
      expect(result!.from).toBe(expectedFromDate.getTime());
    });

    it("should handle invalid period format", () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = extractTimestamps("invalid");
      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith("Invalid period format!");
      consoleSpy.mockRestore();
    });

    it("should handle invalid number", () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = extractTimestamps("abcs");
      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith("Invalid period format!");
      consoleSpy.mockRestore();
    });
  });

  describe("isValidTimePeriod", () => {
    it("should validate correct time periods", () => {
      expect(isValidTimePeriod("15m")).toBe(true);
      expect(isValidTimePeriod("1h")).toBe(true);
      expect(isValidTimePeriod("7d")).toBe(true);
      expect(isValidTimePeriod("30s")).toBe(true);
      expect(isValidTimePeriod("2w")).toBe(true);
      expect(isValidTimePeriod("1M")).toBe(true);
    });

    it("should reject invalid time periods", () => {
      expect(isValidTimePeriod("")).toBe(false);
      expect(isValidTimePeriod("invalid")).toBe(false);
      expect(isValidTimePeriod("15")).toBe(false);
      expect(isValidTimePeriod("m")).toBe(false);
      expect(isValidTimePeriod("15x")).toBe(false);
    });

    it("should handle non-string inputs", () => {
      expect(isValidTimePeriod(null as any)).toBe(false);
      expect(isValidTimePeriod(undefined as any)).toBe(false);
      expect(isValidTimePeriod(123 as any)).toBe(false);
    });
  });

  describe("formatTimePeriod", () => {
    it("should format singular periods correctly", () => {
      expect(formatTimePeriod("1s")).toBe("1 second");
      expect(formatTimePeriod("1m")).toBe("1 minute");
      expect(formatTimePeriod("1h")).toBe("1 hour");
      expect(formatTimePeriod("1d")).toBe("1 day");
      expect(formatTimePeriod("1w")).toBe("1 week");
      expect(formatTimePeriod("1M")).toBe("1 month");
    });

    it("should format plural periods correctly", () => {
      expect(formatTimePeriod("30s")).toBe("30 seconds");
      expect(formatTimePeriod("15m")).toBe("15 minutes");
      expect(formatTimePeriod("2h")).toBe("2 hours");
      expect(formatTimePeriod("7d")).toBe("7 days");
      expect(formatTimePeriod("2w")).toBe("2 weeks");
      expect(formatTimePeriod("3M")).toBe("3 months");
    });

    it("should return original string for invalid format", () => {
      expect(formatTimePeriod("invalid")).toBe("invalid");
      expect(formatTimePeriod("")).toBe("");
    });
  });

  describe("getCurrentTimestamp", () => {
    it("should return current timestamp in milliseconds", () => {
      const result = getCurrentTimestamp();
      expect(result).toBe(new Date('2024-01-15T10:30:00Z').getTime());
    });
  });

  describe("getCurrentTimestampMicroseconds", () => {
    it("should return current timestamp in microseconds", () => {
      const result = getCurrentTimestampMicroseconds();
      expect(result).toBe(new Date('2024-01-15T10:30:00Z').getTime() * 1000);
    });
  });

  describe("millisecondsToMicroseconds", () => {
    it("should convert milliseconds to microseconds", () => {
      expect(millisecondsToMicroseconds(1000)).toBe(1000000);
      expect(millisecondsToMicroseconds(500)).toBe(500000);
    });
  });

  describe("microsecondsToMilliseconds", () => {
    it("should convert microseconds to milliseconds", () => {
      expect(microsecondsToMilliseconds(1000000)).toBe(1000);
      expect(microsecondsToMilliseconds(500000)).toBe(500);
    });
  });

  describe("calculateDuration", () => {
    it("should calculate duration correctly", () => {
      expect(calculateDuration(1000, 2000)).toBe(1000);
      expect(calculateDuration(2000, 1000)).toBe(1000); // Should handle reverse order
    });
  });

  describe("formatDuration", () => {
    it("should format short durations", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(1000)).toBe("1s");
      expect(formatDuration(30000)).toBe("30s");
    });

    it("should format durations with minutes", () => {
      expect(formatDuration(60000)).toBe("1m");
      expect(formatDuration(90000)).toBe("1m 30s");
      expect(formatDuration(150000)).toBe("2m 30s");
    });

    it("should format durations with hours", () => {
      expect(formatDuration(3600000)).toBe("1h");
      expect(formatDuration(3661000)).toBe("1h 1m 1s");
    });

    it("should format durations with days", () => {
      expect(formatDuration(86400000)).toBe("1d");
      expect(formatDuration(90061000)).toBe("1d 1h 1m 1s");
    });
  });

  describe("TIME_MULTIPLIERS", () => {
    it("should have correct time multipliers", () => {
      expect(TIME_MULTIPLIERS.s).toBe(1000);
      expect(TIME_MULTIPLIERS.m).toBe(60 * 1000);
      expect(TIME_MULTIPLIERS.h).toBe(60 * 60 * 1000);
      expect(TIME_MULTIPLIERS.d).toBe(24 * 60 * 60 * 1000);
      expect(TIME_MULTIPLIERS.w).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});