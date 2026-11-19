// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { checkGapNote, scheduleOverlap } from "./scheduleOverlap";

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
