// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import type { DowntimeSchedule } from "@/services/downtimes";
import {
  currentOrNextWindow,
  durationInput,
  formatDuration,
  localToUtcMicros,
  parseDuration,
  recentWindows,
  scheduleSentence,
  utcMicrosToLocal,
} from "./schedule";

const micros = (iso: string) => Date.parse(iso) * 1000;

const weekly: DowntimeSchedule = {
  repeat: "weekly",
  starts_at: micros("2026-09-13T22:00:00Z"),
  ends_at: null,
  timezone: "Europe/Berlin",
  start_time_local: "02:00",
  duration_secs: 5400,
  weekdays: [7],
};

describe("durations", () => {
  it("parses the forms the Duration field accepts", () => {
    expect(parseDuration("90")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("1 h 30 min")).toBe(5400);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1d 2h")).toBe(93600);
  });

  it("rejects text it cannot read", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("1h later")).toBeNull();
  });

  it("writes seconds back as input and as text", () => {
    expect(durationInput(5400)).toBe("1h 30m");
    expect(formatDuration(5400, gt)).toBe("1 h 30 min");
    expect(formatDuration(7200, gt)).toBe("2 h");
    expect(formatDuration(2700, gt)).toBe("45 min");
  });
});

describe("zone conversion", () => {
  it("reads a Berlin wall clock as UTC and back", () => {
    const at = localToUtcMicros("2026-09-20", "02:00", "Europe/Berlin");
    expect(at).toBe(micros("2026-09-20T00:00:00Z"));
    expect(utcMicrosToLocal(at as number, "Europe/Berlin")).toEqual({
      date: "2026-09-20",
      time: "02:00",
    });
  });

  it("returns null for a malformed date or time", () => {
    expect(localToUtcMicros("20-09-2026", "02:00", "UTC")).toBeNull();
    expect(localToUtcMicros("2026-09-20", "2am", "UTC")).toBeNull();
  });
});

describe("currentOrNextWindow", () => {
  it("finds the next Sunday 02:00 Berlin for a weekly rule", () => {
    const now = micros("2026-09-17T12:00:00Z");
    expect(currentOrNextWindow(weekly, now)).toEqual({
      start: micros("2026-09-20T00:00:00Z"),
      end: micros("2026-09-20T01:30:00Z"),
    });
  });

  it("returns the running window when now is inside it, across midnight", () => {
    const daily: DowntimeSchedule = {
      ...weekly,
      repeat: "daily",
      timezone: "UTC",
      start_time_local: "22:00",
      duration_secs: 10 * 3600,
      weekdays: [],
    };
    const now = micros("2026-09-18T03:00:00Z");
    expect(currentOrNextWindow(daily, now)).toEqual({
      start: micros("2026-09-17T22:00:00Z"),
      end: micros("2026-09-18T08:00:00Z"),
    });
  });

  it("returns a one-time window until it ends", () => {
    const once: DowntimeSchedule = {
      repeat: "none",
      starts_at: micros("2026-09-19T22:00:00Z"),
      ends_at: micros("2026-09-20T12:00:00Z"),
      timezone: "America/New_York",
      duration_secs: 50400,
      weekdays: [],
    };
    expect(currentOrNextWindow(once, micros("2026-09-19T00:00:00Z"))?.start).toBe(once.starts_at);
    expect(currentOrNextWindow(once, micros("2026-09-21T00:00:00Z"))).toBeNull();
  });

  it("stops after the repeat-until day", () => {
    const ended = { ...weekly, ends_at: micros("2026-09-18T21:59:00Z") };
    expect(currentOrNextWindow(ended, micros("2026-09-17T12:00:00Z"))).toBeNull();
  });
});

describe("scheduleSentence", () => {
  it("describes a weekly rule", () => {
    expect(scheduleSentence(weekly, gt, "en-US")).toBe(
      "Weekly on Sun · 02:00 for 1 h 30 min · Europe/Berlin",
    );
  });

  it("describes a daily rule", () => {
    expect(scheduleSentence({ ...weekly, repeat: "daily", weekdays: [] }, gt, "en-US")).toBe(
      "Daily · 02:00 for 1 h 30 min · Europe/Berlin",
    );
  });

  it("describes a one-time window in its own zone", () => {
    const once: DowntimeSchedule = {
      repeat: "none",
      starts_at: micros("2026-09-17T14:10:00Z"),
      ends_at: micros("2026-09-17T16:10:00Z"),
      timezone: "UTC",
      duration_secs: 7200,
      weekdays: [],
    };
    expect(scheduleSentence(once, gt, "en-US")).toBe(
      "Once · Thu 17 Sep, 14:10 to Thu 17 Sep, 16:10 · UTC",
    );
  });
});

describe("recentWindows", () => {
  it("returns the last three weekly windows, oldest first", () => {
    const now = micros("2026-09-17T12:00:00Z");
    const starts = [
      "2026-08-30T00:00:00Z",
      "2026-09-06T00:00:00Z",
      "2026-09-13T00:00:00Z",
    ].map(micros);
    const withStart = { ...weekly, starts_at: micros("2026-08-01T00:00:00Z") };
    expect(recentWindows(withStart, now, 3).map((w) => w.start)).toEqual(starts);
  });

  it("returns an ended one-time window and nothing for a future one", () => {
    const once: DowntimeSchedule = {
      repeat: "none",
      starts_at: micros("2026-09-10T20:00:00Z"),
      ends_at: micros("2026-09-10T23:00:00Z"),
      timezone: "UTC",
      duration_secs: 10800,
      weekdays: [],
    };
    expect(recentWindows(once, micros("2026-09-17T00:00:00Z"), 3)).toHaveLength(1);
    expect(recentWindows(once, micros("2026-09-01T00:00:00Z"), 3)).toEqual([]);
  });
});
