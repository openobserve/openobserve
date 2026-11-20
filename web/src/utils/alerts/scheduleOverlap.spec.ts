// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { checkGapNote, checkTimeline, scheduleOverlap } from "./scheduleOverlap";

const t = i18n.global.t as unknown as TranslateFn;

describe("scheduleOverlap", () => {
  it.each([
    [60, 15, { kind: "overlap", minutes: 45 }],
    [5, 5, { kind: "equal", minutes: 0 }],
    [5, 15, { kind: "gaps", minutes: 10 }],
  ])("look-back %i min every %i min → %o", (period, frequency, expected) => {
    expect(scheduleOverlap(period, frequency)).toEqual(expected);
  });
});

describe("checkGapNote", () => {
  it.each([
    ["checks every 10 min reading 5", 5, 10, 1, 5],
    ["the org floor is above the look back, so no fix", 5, 10, 10, null],
    ["equal", 10, 10, 1, undefined],
    ["overlapping", 15, 10, 1, undefined],
    ["no look back yet", 0, 10, 1, undefined],
  ])("%s", (_, period, frequency, floor, fixMinutes) => {
    const note = checkGapNote(period, frequency, floor, t);
    if (fixMinutes === undefined) return expect(note).toBeNull();
    expect(note?.fixMinutes).toBe(fixMinutes);
    expect(note?.text).toContain(`${frequency - period} minutes`);
  });
});

describe("checkTimeline", () => {
  const nowMs = Date.UTC(2026, 10, 20, 17, 20);
  it.each([
    ["overlap", { frequency: 10, period: 30 }, "overlap", "20 min read by both checks", 20],
    ["equal", { frequency: 10, period: 10 }, "equal", "Back to back · no gap, no overlap", 0],
    ["gap", { frequency: 10, period: 5 }, "gaps", "5 min read by neither check", 5],
    [
      "every hour over a day",
      { frequency: 60, period: 1440 },
      "overlap",
      "23 h read by both checks",
      1380,
    ],
    [
      "every minute over an hour",
      { frequency: 1, period: 60 },
      "overlap",
      "59 min read by both checks",
      59,
    ],
    [
      "PromQL newest value",
      { frequency: 1, period: 5, promqlLatest: true },
      "promql",
      "Newest value only · overlap doesn't apply",
      0,
    ],
    [
      "cron, last runs 12:00 and 17:00",
      { frequency: 0, period: 240, cron: "0 9,12,17 * * *", timezone: "UTC" },
      "gaps",
      "1 h read by neither check",
      60,
    ],
  ] as const)("%s", (_, input, relation, bracket, minutes) => {
    const timeline = checkTimeline({ ...input, nowMs }, t);
    expect(timeline).toMatchObject({ relation, bracket, minutes });
    if (!("cron" in input)) return;
    expect(timeline?.checks).toEqual([-320, -20]);
    expect(timeline?.cron?.sentence).toBe(
      "Checks follow the cron schedule, 3 to 16 hours apart. Each check looks at the last 4 hours, so some checks overlap and up to 12 hours between checks are never read.",
    );
  });

  it("draws nothing for a cron that does not parse", () => {
    expect(checkTimeline({ frequency: 0, period: 60, cron: "not a cron", nowMs }, t)).toBeNull();
  });
});
