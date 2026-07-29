// @vitest-environment jsdom
// Tests for useAiDateController — the AI-page date state + URL-sync logic
// extracted (byte-identical) from SessionsPage.vue. This composable owns ONLY
// the date state + URL sync; it does NOT own the child refresh. Covers:
//   • applyRelative sets timeRange + relative dateState
//   • readFromUrl: absolute {from,to} → true; {period} → applyRelative + true;
//     neither → false
//   • writeToUrl: router.replace with period (relative) / from,to (absolute)
//   • onDateChange: relative vs absolute paths, both write URL
//   • mountResolve precedence: URL > resolveAiDateWindow > default relative
//   • urlSync:false → readFromUrl returns false, writeToUrl is a no-op

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";

// ── Route/router mocks ──────────────────────────────────────────────────────
// The route query is a mutable object so individual tests can seed from/to/period.
const routeQuery: Record<string, any> = {};
const replaceMock = vi.fn(() => Promise.resolve());

vi.mock("vue-router", () => ({
  useRoute: () => ({
    get query() {
      return routeQuery;
    },
  }),
  useRouter: () => ({ replace: replaceMock }),
}));

// ── Shared date-range singleton mock ────────────────────────────────────────
// A fresh state ref is installed per-test so writes don't leak across cases.
let mockState = ref<any>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "15m",
});
const resolveAiDateWindowMock = vi.fn();

vi.mock("./useAiDateRange", () => ({
  useAiDateRange: () => ({ state: mockState }),
  resolveAiDateWindow: (...args: any[]) => resolveAiDateWindowMock(...args),
}));

// ── Date helper mock (deterministic, no wall-clock drift) ────────────────────
vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn((period: string) => {
    if (period === "15m") return { startTime: 1_100_000, endTime: 2_000_000 };
    if (period === "1h") return { startTime: 100_000, endTime: 2_000_000 };
    return undefined;
  }),
}));

import { useAiDateController } from "./useAiDateController";

function resetRouteQuery() {
  for (const k of Object.keys(routeQuery)) delete routeQuery[k];
}

beforeEach(() => {
  replaceMock.mockClear();
  resolveAiDateWindowMock.mockReset();
  resetRouteQuery();
  mockState = ref({
    valueType: "relative",
    startTime: null,
    endTime: null,
    relativeTimePeriod: "15m",
  });
});

describe("useAiDateController — applyRelative", () => {
  it("sets timeRange from getConsumableRelativeTime and marks dateState relative", () => {
    const c = useAiDateController();
    c.applyRelative("1h");
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(c.dateState.value.valueType).toBe("relative");
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(c.dateState.value.startTime).toBe(100_000);
    expect(c.dateState.value.endTime).toBe(2_000_000);
  });

  it("is a no-op when the period can't be parsed", () => {
    const c = useAiDateController();
    c.applyRelative("garbage");
    expect(c.timeRange.value).toEqual({ startTime: 0, endTime: 0 });
    expect(c.dateState.value.relativeTimePeriod).toBe("15m");
  });
});

describe("useAiDateController — readFromUrl", () => {
  it("sets absolute state and returns true for valid {from,to}", () => {
    routeQuery.from = "1000";
    routeQuery.to = "2000";
    const c = useAiDateController();
    expect(c.readFromUrl()).toBe(true);
    expect(c.dateState.value).toEqual({
      valueType: "absolute",
      startTime: 1000,
      endTime: 2000,
      relativeTimePeriod: null,
    });
    expect(c.timeRange.value).toEqual({ startTime: 1000, endTime: 2000 });
  });

  it("ignores {from,to} when endTime <= startTime", () => {
    routeQuery.from = "2000";
    routeQuery.to = "1000";
    const c = useAiDateController();
    expect(c.readFromUrl()).toBe(false);
  });

  it("applies relative and returns true for {period}", () => {
    routeQuery.period = "1h";
    const c = useAiDateController();
    expect(c.readFromUrl()).toBe(true);
    expect(c.dateState.value.valueType).toBe("relative");
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
  });

  it("returns false when neither from/to nor period is present", () => {
    const c = useAiDateController();
    expect(c.readFromUrl()).toBe(false);
  });

  it("returns false when urlSync is disabled even with {from,to} present", () => {
    routeQuery.from = "1000";
    routeQuery.to = "2000";
    const c = useAiDateController({ urlSync: false });
    expect(c.readFromUrl()).toBe(false);
  });
});

describe("useAiDateController — writeToUrl", () => {
  it("writes period and drops from/to for a relative state", () => {
    routeQuery.other = "keep";
    const c = useAiDateController();
    c.dateState.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };
    c.writeToUrl();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock.mock.calls[0][0]).toEqual({ query: { other: "keep", period: "1h" } });
  });

  it("falls back to DEFAULT_RELATIVE when relativeTimePeriod is null", () => {
    const c = useAiDateController();
    c.dateState.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: null,
    };
    c.writeToUrl();
    expect(replaceMock.mock.calls[0][0].query.period).toBe("15m");
  });

  it("writes from/to and drops period for an absolute state", () => {
    routeQuery.period = "15m";
    const c = useAiDateController();
    c.dateState.value = {
      valueType: "absolute",
      startTime: 1000,
      endTime: 2000,
      relativeTimePeriod: null,
    };
    c.writeToUrl();
    const query = replaceMock.mock.calls[0][0].query;
    expect(query.from).toBe("1000");
    expect(query.to).toBe("2000");
    expect(query.period).toBeUndefined();
  });

  it("is a no-op when urlSync is disabled", () => {
    const c = useAiDateController({ urlSync: false });
    c.dateState.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };
    c.writeToUrl();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("useAiDateController — onDateChange", () => {
  it("applies relative on a relative value and writes URL", () => {
    const c = useAiDateController();
    c.onDateChange({ valueType: "relative", relativeTimePeriod: "1h" });
    expect(c.dateState.value.valueType).toBe("relative");
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("sets absolute state on an absolute value and writes URL", () => {
    const c = useAiDateController();
    c.onDateChange({ startTime: 5, endTime: 9 });
    expect(c.dateState.value).toEqual({
      valueType: "absolute",
      startTime: 5,
      endTime: 9,
      relativeTimePeriod: null,
    });
    expect(c.timeRange.value).toEqual({ startTime: 5, endTime: 9 });
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });
});

describe("useAiDateController — mountResolve precedence", () => {
  it("URL wins: reads from URL and does not consult resolveAiDateWindow", () => {
    routeQuery.from = "1000";
    routeQuery.to = "2000";
    const c = useAiDateController();
    c.mountResolve();
    expect(c.dateState.value.valueType).toBe("absolute");
    expect(resolveAiDateWindowMock).not.toHaveBeenCalled();
  });

  it("falls back to resolveAiDateWindow when no URL hint (absolute window)", () => {
    mockState.value = {
      valueType: "absolute",
      startTime: 42,
      endTime: 84,
      relativeTimePeriod: null,
    };
    resolveAiDateWindowMock.mockReturnValue({ startTime: 42, endTime: 84 });
    const c = useAiDateController();
    c.mountResolve();
    expect(resolveAiDateWindowMock).toHaveBeenCalledTimes(1);
    expect(c.timeRange.value).toEqual({ startTime: 42, endTime: 84 });
  });

  it("re-anchors via applyRelative when resolved window is relative", () => {
    mockState.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };
    resolveAiDateWindowMock.mockReturnValue({ startTime: 100_000, endTime: 2_000_000 });
    const c = useAiDateController();
    c.mountResolve();
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
  });

  it("falls back to default relative when resolveAiDateWindow returns null", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    const c = useAiDateController();
    c.mountResolve();
    expect(c.timeRange.value).toEqual({ startTime: 1_100_000, endTime: 2_000_000 });
    expect(c.dateState.value.relativeTimePeriod).toBe("15m");
  });

  it("honors a custom defaultRelative for the null fallback", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    const c = useAiDateController({ defaultRelative: "1h" });
    c.mountResolve();
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
  });

  it("writes URL after resolving when urlSync is enabled", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    const c = useAiDateController();
    c.mountResolve();
    expect(replaceMock).toHaveBeenCalled();
  });

  it("does not write URL after resolving when urlSync is disabled", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    const c = useAiDateController({ urlSync: false });
    c.mountResolve();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
