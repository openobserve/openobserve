// @vitest-environment jsdom
// Tests for useAiDateRange — the shared date-range singleton used by LLM
// Insights, LLM Sessions, and Quality. Covers:
//   • initial load from localStorage (defaults, malformed JSON, garbled
//     field types, valid persisted state)
//   • writes mirror back to localStorage (incl. quota / private-mode
//     fallthrough)
//   • singleton identity across multiple `useAiDateRange()` calls
//   • `resolveAiDateWindow` for both relative + absolute, incl. the
//     incomplete-state null branch
//
// The composable initializes its singleton ref at import time, so every
// "initial load" test uses `vi.resetModules()` + a fresh dynamic import
// to exercise the load path with the LS state set just before.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { nextTick } from "vue";

const LS_KEY = "aiObservability:dateRange";

// Mock the date helper so tests don't depend on wall-clock drift. The
// composable only calls it from `resolveAiDateWindow`, so this lets us
// assert deterministic outputs.
vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn((period: string) => {
    // Deterministic: pretend "now" is 2_000_000 µs and each token shifts
    // a fixed amount back. Unknown tokens return undefined to exercise
    // the null-window branch.
    if (period === "15m") return { startTime: 1_100_000, endTime: 2_000_000 };
    if (period === "1h") return { startTime: 100_000, endTime: 2_000_000 };
    return undefined;
  }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules(); // reload the composable so its singleton picks up fresh LS
});

afterEach(() => {
  localStorage.clear();
});

describe("useAiDateRange — initial load", () => {
  it("returns the default state when localStorage is empty", async () => {
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "15m",
    });
  });

  it("returns the default state when localStorage holds malformed JSON", async () => {
    localStorage.setItem(LS_KEY, "{not json");
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value.valueType).toBe("relative");
    expect(state.value.relativeTimePeriod).toBe("15m");
  });

  it("returns the default state when localStorage holds a non-object payload", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify("just a string"));
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "15m",
    });
  });

  it("returns the default state when localStorage holds null", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(null));
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value.valueType).toBe("relative");
  });

  it("hydrates a valid relative state from localStorage", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        valueType: "relative",
        startTime: null,
        endTime: null,
        relativeTimePeriod: "1h",
      }),
    );
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    });
  });

  it("hydrates a valid absolute state from localStorage", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        valueType: "absolute",
        startTime: 100,
        endTime: 200,
        relativeTimePeriod: null,
      }),
    );
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value).toEqual({
      valueType: "absolute",
      startTime: 100,
      endTime: 200,
      relativeTimePeriod: null,
    });
  });

  it("coerces an unknown valueType to 'relative'", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        valueType: "bogus",
        startTime: null,
        endTime: null,
        relativeTimePeriod: "1h",
      }),
    );
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value.valueType).toBe("relative");
    expect(state.value.relativeTimePeriod).toBe("1h");
  });

  it("nulls non-numeric startTime/endTime fields", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        valueType: "absolute",
        startTime: "100",
        endTime: ["200"],
        relativeTimePeriod: null,
      }),
    );
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value.startTime).toBeNull();
    expect(state.value.endTime).toBeNull();
  });

  it("falls back to '15m' when relativeTimePeriod isn't a string", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        valueType: "relative",
        startTime: null,
        endTime: null,
        relativeTimePeriod: 42,
      }),
    );
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value.relativeTimePeriod).toBe("15m");
  });

  it("falls back to the default state if localStorage.getItem throws", async () => {
    // Simulate a privacy-mode browser that throws on storage access.
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();
    expect(state.value.valueType).toBe("relative");
    expect(state.value.relativeTimePeriod).toBe("15m");
    spy.mockRestore();
  });
});

describe("useAiDateRange — persistence on write", () => {
  it("writes the new state to localStorage when state.value is reassigned", async () => {
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();

    state.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };
    await nextTick();

    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
    expect(stored.relativeTimePeriod).toBe("1h");
    expect(stored.valueType).toBe("relative");
  });

  it("survives a setItem that throws (private mode / quota)", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { useAiDateRange } = await import("./useAiDateRange");
    const { state } = useAiDateRange();

    // Should not throw.
    state.value = {
      valueType: "absolute",
      startTime: 1,
      endTime: 2,
      relativeTimePeriod: null,
    };
    await nextTick();

    expect(state.value.valueType).toBe("absolute");
    spy.mockRestore();
  });
});

describe("useAiDateRange — singleton identity", () => {
  it("hands every caller the same ref instance", async () => {
    const { useAiDateRange } = await import("./useAiDateRange");
    const a = useAiDateRange();
    const b = useAiDateRange();
    expect(a.state).toBe(b.state);
  });

  it("writes from one consumer are visible to another", async () => {
    const { useAiDateRange } = await import("./useAiDateRange");
    const a = useAiDateRange();
    const b = useAiDateRange();

    a.state.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };

    expect(b.state.value.relativeTimePeriod).toBe("1h");
  });
});

describe("resolveAiDateWindow", () => {
  it("returns the picker-derived window for a relative state", async () => {
    const { resolveAiDateWindow } = await import("./useAiDateRange");
    const window = resolveAiDateWindow({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    });
    expect(window).toEqual({ startTime: 100_000, endTime: 2_000_000 });
  });

  it("falls back to '15m' when relativeTimePeriod is null", async () => {
    const { resolveAiDateWindow } = await import("./useAiDateRange");
    const window = resolveAiDateWindow({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: null,
    });
    expect(window).toEqual({ startTime: 1_100_000, endTime: 2_000_000 });
  });

  it("returns null when getConsumableRelativeTime can't parse the period", async () => {
    const { resolveAiDateWindow } = await import("./useAiDateRange");
    const window = resolveAiDateWindow({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "garbage",
    });
    expect(window).toBeNull();
  });

  it("returns the literal bounds for an absolute state", async () => {
    const { resolveAiDateWindow } = await import("./useAiDateRange");
    const window = resolveAiDateWindow({
      valueType: "absolute",
      startTime: 42,
      endTime: 84,
      relativeTimePeriod: null,
    });
    expect(window).toEqual({ startTime: 42, endTime: 84 });
  });

  it("returns null when an absolute state is missing startTime", async () => {
    const { resolveAiDateWindow } = await import("./useAiDateRange");
    const window = resolveAiDateWindow({
      valueType: "absolute",
      startTime: null,
      endTime: 84,
      relativeTimePeriod: null,
    });
    expect(window).toBeNull();
  });

  it("returns null when an absolute state is missing endTime", async () => {
    const { resolveAiDateWindow } = await import("./useAiDateRange");
    const window = resolveAiDateWindow({
      valueType: "absolute",
      startTime: 42,
      endTime: null,
      relativeTimePeriod: null,
    });
    expect(window).toBeNull();
  });
});
