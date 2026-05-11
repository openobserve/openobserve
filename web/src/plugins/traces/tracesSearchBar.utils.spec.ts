// Copyright 2026 OpenObserve Inc.
//
// Tests for the `isDatetimeChanged` helper that filters out the
// DateTime component's mount-replay emits in the traces SearchBar.
//
// The pattern this guards against: when a tab switch remounts the
// picker, the picker fires `on:date-change` once with its current
// value (no real change). Without filtering, that mount-replay emits
// a `searchdata` signal and triggers a redundant search.

import { describe, it, expect } from "vitest";
import { isDatetimeChanged } from "./tracesSearchBar.utils";

// ===========================================================================
// Relative range — must compare by relativeTimePeriod, NOT raw start/end.
// ===========================================================================

describe("isDatetimeChanged — relative ranges", () => {
  // Mount-replay scenario: same period ("12h") but the picker
  // recomputed startTime/endTime from `Date.now()` on remount, so the
  // raw values drifted. Must NOT be flagged as changed.
  it("returns false when relativeTimePeriod is unchanged (raw timestamps drifted)", () => {
    const prev = {
      startTime: 1_000_000_000,
      endTime: 2_000_000_000,
      relativeTimePeriod: "12h",
      type: "relative",
    };
    const value = {
      // Drifted by 1 second — what happens on a remount.
      startTime: 1_000_001_000,
      endTime: 2_000_001_000,
      relativeTimePeriod: "12h",
    };
    expect(isDatetimeChanged(prev, value)).toBe(false);
  });

  // Real user-driven change: user picked a different relative period.
  // Must fire.
  it("returns true when the relativeTimePeriod itself changes", () => {
    const prev = {
      startTime: 1,
      endTime: 2,
      relativeTimePeriod: "15m",
      type: "relative",
    };
    const value = {
      startTime: 100,
      endTime: 200,
      relativeTimePeriod: "12h",
    };
    expect(isDatetimeChanged(prev, value)).toBe(true);
  });

  // Edge: previous was absolute, new is relative — relativeTimePeriod
  // goes from undefined to set, so this is a real switch.
  it("returns true when switching FROM absolute TO relative", () => {
    const prev = {
      startTime: 100,
      endTime: 200,
      relativeTimePeriod: undefined,
      type: "absolute",
    };
    const value = {
      startTime: 1,
      endTime: 2,
      relativeTimePeriod: "1h",
    };
    expect(isDatetimeChanged(prev, value)).toBe(true);
  });

  // Edge: prev had a different period but the new emit has neither set
  // (defensive — shouldn't happen in practice but be safe).
  it("returns true when relativeTimePeriod is dropped", () => {
    const prev = {
      startTime: 1,
      endTime: 2,
      relativeTimePeriod: "1h",
      type: "relative",
    };
    // value has no relativeTimePeriod → isRelative=false → falls into
    // absolute comparison branch → start/end differ → changed=true.
    const value = {
      startTime: 100,
      endTime: 200,
    };
    expect(isDatetimeChanged(prev, value)).toBe(true);
  });
});

// ===========================================================================
// Absolute range — must compare raw startTime/endTime.
// ===========================================================================

describe("isDatetimeChanged — absolute ranges", () => {
  // Mount-replay for absolute: same boundaries → no change.
  it("returns false when absolute start/end match", () => {
    const prev = {
      startTime: 1_000_000,
      endTime: 2_000_000,
      type: "absolute",
    };
    const value = {
      startTime: 1_000_000,
      endTime: 2_000_000,
    };
    expect(isDatetimeChanged(prev, value)).toBe(false);
  });

  // Real user change to start time.
  it("returns true when startTime changes", () => {
    const prev = { startTime: 100, endTime: 200, type: "absolute" };
    const value = { startTime: 99, endTime: 200 };
    expect(isDatetimeChanged(prev, value)).toBe(true);
  });

  // Real user change to end time.
  it("returns true when endTime changes", () => {
    const prev = { startTime: 100, endTime: 200, type: "absolute" };
    const value = { startTime: 100, endTime: 201 };
    expect(isDatetimeChanged(prev, value)).toBe(true);
  });

  // Switch from relative to absolute with same effective range.
  // value has no relativeTimePeriod → absolute branch → start/end
  // differ from prev's stale relative-derived values → changed.
  it("returns true when switching FROM relative TO absolute", () => {
    const prev = {
      startTime: 1,
      endTime: 2,
      relativeTimePeriod: "12h",
      type: "relative",
    };
    const value = { startTime: 100, endTime: 200 };
    expect(isDatetimeChanged(prev, value)).toBe(true);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("isDatetimeChanged — defensive cases", () => {
  // First load: no prev → always treat as changed so the initial
  // search can run.
  it("returns true when prev is null", () => {
    expect(
      isDatetimeChanged(null, { startTime: 1, endTime: 2 }),
    ).toBe(true);
  });

  it("returns true when prev is undefined", () => {
    expect(
      isDatetimeChanged(undefined, { startTime: 1, endTime: 2 }),
    ).toBe(true);
  });

  // String-typed timestamps (some date pickers emit strings) — the
  // comparison still works because `===` checks values, not types.
  it("compares string timestamps via strict equality", () => {
    expect(
      isDatetimeChanged(
        { startTime: "100", endTime: "200" } as any,
        { startTime: "100", endTime: "200" },
      ),
    ).toBe(false);
    expect(
      isDatetimeChanged(
        { startTime: "100", endTime: "200" } as any,
        { startTime: "999", endTime: "200" },
      ),
    ).toBe(true);
  });

  // Strict equality means string-vs-number with the same value is
  // treated as a change. This is intentional — type drift between
  // emits is unusual and worth surfacing as a search refresh.
  it("treats string vs number as different (strict equality)", () => {
    expect(
      isDatetimeChanged(
        { startTime: 100, endTime: 200 } as any,
        { startTime: "100", endTime: "200" },
      ),
    ).toBe(true);
  });
});
