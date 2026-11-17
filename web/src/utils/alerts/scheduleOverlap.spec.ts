// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { scheduleOverlap } from "./scheduleOverlap";

describe("scheduleOverlap", () => {
  it.each([
    [60, 15, { kind: "overlap", minutes: 45 }],
    [5, 5, { kind: "equal", minutes: 0 }],
    [5, 15, { kind: "gaps", minutes: 10 }],
  ])("look-back %i min every %i min → %o", (period, frequency, expected) => {
    expect(scheduleOverlap(period, frequency)).toEqual(expected);
  });
});
