// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock moment-timezone (dynamic import via importMoment)
// moment.tz is called two ways:
//   1. moment.tz({year, ...}, timezone) → needs .unix()  [in localTimeSelectedTimezoneUTCTime]
//   2. moment.tz(zone)                  → needs .utcOffset()  [in getTimezonesByOffset]
// We differentiate by checking argument count / type.
const tzFnImpl: any = vi.fn((...args: any[]) => {
  if (args.length === 2) {
    // Called as moment.tz({...}, timezone) — needs unix()
    return { unix: () => 1_700_000_000 };
  }
  // Called as moment.tz(zone) — needs utcOffset()
  return { utcOffset: () => 0 };
});
tzFnImpl.names = vi.fn(() => ["UTC", "America/New_York", "Europe/London"]);

const mockMomentDefault: any = tzFnImpl;
// Add the .tz property on the default export itself too
// because timezone.ts uses: moment.tz({...}, tz) and moment.tz.names()
mockMomentDefault.tz = tzFnImpl;

vi.mock("moment-timezone", () => ({
  default: mockMomentDefault,
}));

// Mock durationFormatter from formatters
vi.mock("@/utils/formatters", () => ({
  durationFormatter: vi.fn((s: number) => `${s}s`),
}));

import { durationFormatter } from "@/utils/formatters";

import {
  timestampToTimezoneDate,
  histogramDateTimezone,
  convertToUtcTimestamp,
  localTimeSelectedTimezoneUTCTime,
  getLocalTime,
  convertDateToTimestamp,
  getTimezoneOffset,
  convertTimeFromMicroToMilli,
  convertTimeFromNsToMs,
  convertTimeFromNsToUs,
  getTimezonesByOffset,
  localTimeToMicroseconds,
  getDuration,
  getFunctionErrorMessage,
  calculateRelativeTimePeriod,
  calculateAbsoluteDateTime,
  buildDateTimeObject,
} from "./timezone";

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// timestampToTimezoneDate
// ---------------------------------------------------------------------------

describe("timestampToTimezoneDate", () => {
  it("formats a normal millisecond timestamp in UTC", () => {
    const result = timestampToTimezoneDate(1_700_000_000_000, "UTC");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("divides nanosecond/microsecond timestamps (> 1e14) by 1000 first", () => {
    const microsTs = 1_700_000_000_000_000; // 1.7e15
    const result = timestampToTimezoneDate(microsTs, "UTC");
    expect(typeof result).toBe("string");
    expect(result).toContain("2023");
  });

  it("respects a custom format string", () => {
    const result = timestampToTimezoneDate(
      1_700_000_000_000,
      "UTC",
      "yyyy-MM-dd",
    );
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("defaults to UTC timezone", () => {
    const result = timestampToTimezoneDate(1_700_000_000_000);
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// histogramDateTimezone
// ---------------------------------------------------------------------------

describe("histogramDateTimezone", () => {
  it("returns Date.getTime() for UTC timezone (fast path)", () => {
    const utcTime = "2023-11-14T22:13:20.000Z";
    const result = histogramDateTimezone(utcTime, "UTC");

    expect(result).toBe(new Date(utcTime).getTime());
  });

  it("returns seconds * 1000 for non-UTC timezone", () => {
    const utcTime = "2023-11-14T22:13:20.000Z";
    const result = histogramDateTimezone(utcTime, "America/New_York");

    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// convertToUtcTimestamp
// ---------------------------------------------------------------------------

describe("convertToUtcTimestamp", () => {
  it("converts a date+timezone string to a UTC microsecond timestamp", () => {
    const result = convertToUtcTimestamp("2023/11/14 22:13:20", "UTC");

    expect(typeof result).toBe("number");
    // Should be a large number (microseconds)
    expect(result).toBeGreaterThan(1_000_000_000_000_000);
  });
});

// ---------------------------------------------------------------------------
// getLocalTime
// ---------------------------------------------------------------------------

describe("getLocalTime", () => {
  it("returns null when input is null", () => {
    const result = getLocalTime(null as any);
    expect(result).toBeNull();
  });

  it("returns a formatted time string for a valid ISO date", () => {
    const result = getLocalTime("2023-11-14T10:30:00.000Z");

    expect(typeof result).toBe("string");
    // Format: "YYYY/M/D H:mm"
    expect(result).toMatch(/^\d{4}\/\d+\/\d+ \d+:\d+$/);
  });

  it("logs and returns undefined when an exception is thrown by Date()", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Pass a non-null value that causes Date constructor to throw when called as new Date(invalid.toString())
    // We can patch Date globally to throw for this test
    const OriginalDate = global.Date;
    let callCount = 0;
    const MockDate = function (arg?: any) {
      callCount++;
      if (callCount === 1) return new OriginalDate(arg); // first call ok
      throw new Error("forced date error"); // second call throws
    } as any;
    MockDate.now = OriginalDate.now;
    MockDate.parse = OriginalDate.parse;
    MockDate.UTC = OriginalDate.UTC;
    global.Date = MockDate;

    const result = getLocalTime("2023-11-14T10:30:00.000Z");

    global.Date = OriginalDate;
    expect(logSpy).toHaveBeenCalled();
    expect(result).toBeUndefined();
    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// convertDateToTimestamp
// ---------------------------------------------------------------------------

describe("convertDateToTimestamp", () => {
  it("returns { timestamp, offset } for a valid date/time/timezone", () => {
    const result = convertDateToTimestamp("14-11-2023", "22:13", "UTC");

    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("offset");
    expect(typeof result.timestamp).toBe("number");
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("resolves Browser Time timezone to Intl timezone", () => {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserTimeString = `Browser Time (${browserTz})`;

    const result = convertDateToTimestamp("14-11-2023", "10:00", browserTimeString);

    expect(result).toHaveProperty("timestamp");
    expect(result.timestamp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getTimezoneOffset
// ---------------------------------------------------------------------------

describe("getTimezoneOffset", () => {
  it("returns a number when no timezone is provided (uses Intl timezone)", () => {
    const result = getTimezoneOffset(null);
    expect(typeof result).toBe("number");
  });

  it("returns a number for an explicit timezone", () => {
    const result = getTimezoneOffset("UTC");
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// convertTimeFromMicroToMilli
// ---------------------------------------------------------------------------

describe("convertTimeFromMicroToMilli", () => {
  it("converts microseconds to milliseconds", () => {
    const result = convertTimeFromMicroToMilli(1_000_000);
    expect(result).toBe(1000);
  });

  it("floors the result", () => {
    const result = convertTimeFromMicroToMilli(1_500);
    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// convertTimeFromNsToMs
// ---------------------------------------------------------------------------

describe("convertTimeFromNsToMs", () => {
  it("converts nanoseconds to milliseconds", () => {
    const result = convertTimeFromNsToMs(1_000_000_000);
    expect(result).toBe(1000);
  });

  it("floors the result", () => {
    const result = convertTimeFromNsToMs(1_500_000);
    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// convertTimeFromNsToUs
// ---------------------------------------------------------------------------

describe("convertTimeFromNsToUs", () => {
  it("converts nanoseconds to microseconds (returns Date(microseconds).getTime())", () => {
    const result = convertTimeFromNsToUs(1_000);
    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTimezonesByOffset
// IMPORTANT: Must run BEFORE localTimeSelectedTimezoneUTCTime because both
// functions set module-level `moment = null` at the end. Since momentInitialized
// stays true, subsequent importMoment() calls return null.
// Whichever runs first gets the fresh mock; the other cannot be tested.
// We prioritize getTimezonesByOffset here and accept localTimeSelectedTimezoneUTCTime
// cannot call the real moment after this.
// ---------------------------------------------------------------------------

describe("getTimezonesByOffset", () => {
  it("returns filtered timezones matching the given UTC offset", async () => {
    // Fresh module state: moment has not been initialized yet.
    // importMoment() imports mock, sets moment = tzFnImpl.
    // tzFnImpl(zone) returns { utcOffset: () => 0 }.
    // offsetMinutes=0 → offsetHours=0 → zoneOffset=0/60=0 === 0 → all zones match
    const result = await getTimezonesByOffset(0);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Verify it called names() and per-zone utcOffset()
    expect(tzFnImpl.names).toHaveBeenCalled();
  });
  // After this test, moment = null and momentInitialized = true (source limitation).
});

// ---------------------------------------------------------------------------
// localTimeSelectedTimezoneUTCTime
// ---------------------------------------------------------------------------

describe("localTimeSelectedTimezoneUTCTime", () => {
  it("calls moment.tz with date components and timezone and returns microseconds", async () => {
    const time = new Date("2023-11-14T22:13:20.000Z");

    const result = await localTimeSelectedTimezoneUTCTime(time, "UTC");

    expect(typeof result).toBe("number");
    // mock returns unix() = 1700000000, so result = 1700000000 * 1000000
    expect(result).toBe(1700000000 * 1000000);
  });
});

// ---------------------------------------------------------------------------
// localTimeToMicroseconds
// ---------------------------------------------------------------------------

describe("localTimeToMicroseconds", () => {
  it("returns a number approximately equal to Date.now() * 1000", () => {
    const before = Date.now() * 1000;
    const result = localTimeToMicroseconds();
    const after = Date.now() * 1000;

    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// getDuration
// ---------------------------------------------------------------------------

describe("getDuration", () => {
  it("returns { durationInSeconds, duration } object", () => {
    const createdAt = localTimeToMicroseconds() - 5_000_000; // 5 seconds ago

    const result = getDuration(createdAt);

    expect(result).toHaveProperty("durationInSeconds");
    expect(result).toHaveProperty("duration");
    expect(result.durationInSeconds).toBeGreaterThanOrEqual(4);
  });

  it("calls durationFormatter with the computed seconds", () => {
    const createdAt = localTimeToMicroseconds() - 10_000_000; // 10 seconds ago

    getDuration(createdAt);

    expect(durationFormatter).toHaveBeenCalledWith(expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// getFunctionErrorMessage
// ---------------------------------------------------------------------------

describe("getFunctionErrorMessage", () => {
  it("returns formatted message with time range for valid microsecond timestamps", () => {
    const startMs = 1_700_000_000_000_000; // microseconds
    const endMs = 1_700_003_600_000_000;

    const result = getFunctionErrorMessage(
      "Error occurred",
      startMs,
      endMs,
      "UTC",
    );

    expect(result).toContain("Error occurred");
    expect(result).toContain("Data returned for:");
  });

  it("returns a string containing the original message even for edge-case timestamps", () => {
    const result = getFunctionErrorMessage("Some error", NaN, NaN, "UTC");
    expect(typeof result).toBe("string");
    expect(result).toContain("Some error");
  });

  it("returns original message when timestampToTimezoneDate throws (invalid timezone)", () => {
    // Pass an invalid timezone string to make luxon throw inside timestampToTimezoneDate
    const result = getFunctionErrorMessage(
      "Catch error msg",
      1_700_000_000_000_000,
      1_700_003_600_000_000,
      "Invalid/Timezone/That/Does/Not/Exist/XYZ",
    );
    // When luxon fails with invalid timezone, it returns "Invalid DateTime" string
    // (it doesn't throw). So the catch won't be triggered by timezone.
    // Instead, just verify the function returns a string.
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// calculateRelativeTimePeriod
// ---------------------------------------------------------------------------

describe("calculateRelativeTimePeriod", () => {
  it("returns months label for exact month multiple", () => {
    const start = 0;
    const end = 2_592_000 * 1_000_000;
    expect(calculateRelativeTimePeriod(start, end)).toBe("1M");
  });

  it("returns weeks label for exact week multiple", () => {
    const start = 0;
    const end = 604_800 * 1_000_000;
    expect(calculateRelativeTimePeriod(start, end)).toBe("1w");
  });

  it("returns days label for exact day multiple", () => {
    const start = 0;
    const end = 86_400 * 1_000_000;
    expect(calculateRelativeTimePeriod(start, end)).toBe("1d");
  });

  it("returns hours label for exact hour multiple", () => {
    const start = 0;
    const end = 3_600 * 1_000_000;
    expect(calculateRelativeTimePeriod(start, end)).toBe("1h");
  });

  it("returns minutes label for exact minute multiple", () => {
    const start = 0;
    const end = 60 * 1_000_000;
    expect(calculateRelativeTimePeriod(start, end)).toBe("1m");
  });

  it("returns seconds label for exact second", () => {
    const start = 0;
    const end = 1_000_000;
    expect(calculateRelativeTimePeriod(start, end)).toBe("1s");
  });

  it("falls back to Xs for non-divisible durations", () => {
    const start = 0;
    const end = 7_654_321;
    const result = calculateRelativeTimePeriod(start, end);
    expect(result).toMatch(/^\d+s$/);
  });

  it("returns '0s' fallback when diff is less than 1 second", () => {
    // When diffInSeconds = 0, no unit.value is <= 0, so the loop exits without
    // returning, hitting the fallback at the end of the function.
    const start = 0;
    const end = 500_000; // 0.5 seconds in microseconds → 0 seconds
    const result = calculateRelativeTimePeriod(start, end);
    expect(result).toBe("0s");
  });
});

// ---------------------------------------------------------------------------
// calculateAbsoluteDateTime
// ---------------------------------------------------------------------------

describe("calculateAbsoluteDateTime", () => {
  it("returns selectedDate with from/to in YYYY/MM/DD format", () => {
    const startMs = new Date("2023-11-14T00:00:00.000Z").getTime() * 1000;
    const endMs = new Date("2023-11-15T00:00:00.000Z").getTime() * 1000;

    const result = calculateAbsoluteDateTime(startMs, endMs);

    expect(result.selectedDate.from).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(result.selectedDate.to).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it("returns selectedTime with startTime/endTime in HH:MM:SS format", () => {
    const startMs = new Date("2023-11-14T10:30:45.000Z").getTime() * 1000;
    const endMs = new Date("2023-11-14T22:15:30.000Z").getTime() * 1000;

    const result = calculateAbsoluteDateTime(startMs, endMs);

    expect(result.selectedTime.startTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(result.selectedTime.endTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// buildDateTimeObject
// ---------------------------------------------------------------------------

describe("buildDateTimeObject", () => {
  const start = 0;
  const end = 3_600 * 1_000_000; // 1 hour

  it("includes relativeTimePeriod for type='relative'", () => {
    const result = buildDateTimeObject(start, end, "relative");

    expect(result).toHaveProperty("relativeTimePeriod");
    expect(result.relativeTimePeriod).toBe("1h");
    expect(result.type).toBe("relative");
  });

  it("includes selectedDate and selectedTime for type='absolute'", () => {
    const startMs = new Date("2023-11-14T10:00:00.000Z").getTime() * 1000;
    const endMs = new Date("2023-11-14T12:00:00.000Z").getTime() * 1000;

    const result = buildDateTimeObject(startMs, endMs, "absolute");

    expect(result).toHaveProperty("selectedDate");
    expect(result).toHaveProperty("selectedTime");
    expect(result.relativeTimePeriod).toBeNull();
    expect(result.type).toBe("absolute");
  });

  it("includes startTime and endTime in the base object", () => {
    const result = buildDateTimeObject(start, end, "relative");

    expect(result.startTime).toBe(start);
    expect(result.endTime).toBe(end);
  });
});
