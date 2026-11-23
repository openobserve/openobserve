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
import {
  isDatetimeChanged,
  tracesRunIsStaged,
  tracesRunSignature,
  tracesSearchRunSignature,
  tracesToolbarLayout,
} from "./tracesSearchBar.utils";

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

describe("isDatetimeChanged — calendar periods", () => {
  it("re-runs when the same calendar token resolves to another window", () => {
    const prev = {
      startTime: 100,
      endTime: 200,
      relativeTimePeriod: "calendar:day:-1",
      type: "relative",
    };
    expect(
      isDatetimeChanged(prev, {
        startTime: 100,
        endTime: 300,
        relativeTimePeriod: "calendar:day:-1",
      }),
    ).toBe(false);
    expect(
      isDatetimeChanged(prev, {
        startTime: 50,
        endTime: 150,
        relativeTimePeriod: "calendar:day:-1",
      }),
    ).toBe(true);
    expect(
      isDatetimeChanged(
        { ...prev, startTime: undefined as unknown as number },
        { startTime: 50, endTime: 150, relativeTimePeriod: "calendar:day:-1" },
      ),
    ).toBe(false);
  });
});

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
    expect(isDatetimeChanged(null, { startTime: 1, endTime: 2 })).toBe(true);
  });

  it("returns true when prev is undefined", () => {
    expect(isDatetimeChanged(undefined, { startTime: 1, endTime: 2 })).toBe(true);
  });

  // String-typed timestamps (some date pickers emit strings) — the
  // comparison still works because `===` checks values, not types.
  it("compares string timestamps via strict equality", () => {
    expect(
      isDatetimeChanged({ startTime: "100", endTime: "200" } as any, {
        startTime: "100",
        endTime: "200",
      }),
    ).toBe(false);
    expect(
      isDatetimeChanged({ startTime: "100", endTime: "200" } as any, {
        startTime: "999",
        endTime: "200",
      }),
    ).toBe(true);
  });

  // Strict equality means string-vs-number with the same value is
  // treated as a change. This is intentional — type drift between
  // emits is unusual and worth surfacing as a search refresh.
  it("treats string vs number as different (strict equality)", () => {
    expect(
      isDatetimeChanged({ startTime: 100, endTime: 200 } as any, {
        startTime: "100",
        endTime: "200",
      }),
    ).toBe(true);
  });
});

describe("tracesRunSignature", () => {
  const staged = (over: Record<string, unknown> = {}) => ({
    editorValue: "service_name = 'a'",
    stream: "default",
    sqlMode: false,
    datetime: { startTime: 1, endTime: 2, relativeTimePeriod: "15m", type: "relative" },
    ...over,
  });

  it("is equal for the same staged state even when relative timestamps drift", () => {
    const later = staged({
      datetime: { startTime: 50, endTime: 60, relativeTimePeriod: "15m", type: "relative" },
    });
    expect(tracesRunSignature(later)).toBe(tracesRunSignature(staged()));
  });

  it.each([
    ["editor text", { editorValue: "service_name = 'b'" }],
    ["stream", { stream: "other" }],
    ["sql mode", { sqlMode: true }],
    [
      "relative period",
      { datetime: { startTime: 1, endTime: 2, relativeTimePeriod: "1h", type: "relative" } },
    ],
    ["absolute window", { datetime: { startTime: 1, endTime: 3, type: "absolute" } }],
  ])("changes when the %s changes", (_label, over) => {
    expect(tracesRunSignature(staged(over))).not.toBe(tracesRunSignature(staged()));
  });

  it("ignores surrounding whitespace in the editor", () => {
    expect(tracesRunSignature(staged({ editorValue: "  service_name = 'a'\n" }))).toBe(
      tracesRunSignature(staged()),
    );
  });
});

describe("tracesRunIsStaged", () => {
  const searchObj = (editorValue: string, liveMode: boolean) => {
    const obj = {
      meta: { sqlMode: false, liveMode, lastRunSignature: null as string | null },
      data: {
        editorValue: "service_name = 'a'",
        stream: { selectedStream: { value: "default" } },
        datetime: { startTime: 1, endTime: 2, relativeTimePeriod: "15m", type: "relative" },
      },
    };
    obj.meta.lastRunSignature = tracesSearchRunSignature(obj);
    obj.data.editorValue = editorValue;
    return obj;
  };

  it("is staged when the editor differs from the last Run and auto-run is off", () => {
    expect(tracesRunIsStaged(searchObj("service_name = 'b'", false), true)).toBe(true);
    expect(tracesRunIsStaged(searchObj("service_name = 'b'", true), false)).toBe(true);
  });

  it("is not staged when auto-run is on", () => {
    expect(tracesRunIsStaged(searchObj("service_name = 'b'", true), true)).toBe(false);
  });

  it("is not staged when nothing changed since the last Run", () => {
    expect(tracesRunIsStaged(searchObj("service_name = 'a'", false), false)).toBe(false);
  });

  it("is not staged before the first Run", () => {
    const obj = searchObj("service_name = 'b'", false);
    obj.meta.lastRunSignature = null;
    expect(tracesRunIsStaged(obj, false)).toBe(false);
  });
});

describe("tracesToolbarLayout", () => {
  const layout = (available: number, over: Record<string, unknown> = {}) =>
    tracesToolbarLayout({
      available,
      serviceGraph: true,
      drillDown: true,
      reset: true,
      pinnedWidth: 0,
      ...over,
    });

  it.each([
    [1200, "full"],
    [739, "full"],
    [738, "compactButtons"],
    [642, "compactButtons"],
    [641, "iconToggle"],
    [370, "iconToggle"],
    [369, "resetInMenu"],
    [0, "resetInMenu"],
  ])("at %i px picks the %s stage", (available, stage) => {
    expect(layout(available).stage).toBe(stage);
  });

  it("drops button labels before the view toggle labels", () => {
    expect(layout(700).stage).toBe("compactButtons");
  });

  it("shrinks labels before a pinned group falls back into More", () => {
    expect(layout(800).stage).toBe("full");
    expect(layout(800, { pinnedWidth: 150 }).stage).toBe("compactButtons");
  });

  it("keeps the toggle icon-only, not Reset in More, while the base items still fit", () => {
    const result = layout(400, { pinnedWidth: 171 });
    expect(result.stage).toBe("iconToggle");
    expect(result.pinnedBudget).toBe(400 - 310);
  });

  it("uses the narrower toggle when Service Graph is hidden", () => {
    expect(layout(650, { serviceGraph: false }).stage).toBe("full");
  });

  it("never reaches Reset in More on a mode without Reset", () => {
    expect(layout(0, { reset: false, drillDown: false }).stage).toBe("iconToggle");
  });
});
