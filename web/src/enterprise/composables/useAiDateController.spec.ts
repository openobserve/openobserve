// @vitest-environment jsdom
// Tests for useAiDateController — the AI-page date state + URL-sync logic
//   • applyRelative sets timeRange + relative dateState

import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineComponent, h, onMounted, ref } from "vue";
import { mount } from "@vue/test-utils";

// ── Route/router mocks ──────────────────────────────────────────────────────
// The route query is a mutable object so individual tests can seed from/to/period.
const routeQuery: Record<string, any> = {};
const replaceMock = vi.fn((_to: { query: Record<string, string> }) => Promise.resolve());

vi.mock("vue-router", () => ({
  useRoute: () => ({
    get query() {
      return routeQuery;
    },
  }),
  useRouter: () => ({ replace: replaceMock }),
}));

// The org the page shows; an org switch puts it in the store before the route.
const storeState = { selectedOrganization: { identifier: "default" } };
vi.mock("vuex", () => ({ useStore: () => ({ state: storeState }) }));

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
const WINDOWS: Record<string, { startTime: number; endTime: number }> = {
  "15m": { startTime: 1_100_000, endTime: 2_000_000 },
  "1h": { startTime: 100_000, endTime: 2_000_000 },
  "2h": { startTime: 50_000, endTime: 2_000_000 },
  "6h": { startTime: 10_000, endTime: 2_000_000 },
  "30d": { startTime: 1_000, endTime: 2_000_000 },
};
vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn((period: string) => WINDOWS[period]),
}));

import { useAiDateController } from "./useAiDateController";

function resetRouteQuery() {
  for (const k of Object.keys(routeQuery)) delete routeQuery[k];
}

/** A controller whose construction-time resolve is already behind it. */
function created(opts?: Parameters<typeof useAiDateController>[0]) {
  const c = useAiDateController(opts);
  replaceMock.mockClear();
  resolveAiDateWindowMock.mockClear();
  return c;
}

function lastWrittenQuery() {
  return replaceMock.mock.lastCall?.[0].query;
}

beforeEach(() => {
  replaceMock.mockClear();
  resolveAiDateWindowMock.mockReset();
  resetRouteQuery();
  storeState.selectedOrganization = { identifier: "default" };
  mockState = ref({
    valueType: "relative",
    startTime: null,
    endTime: null,
    relativeTimePeriod: "15m",
  });
});

describe("useAiDateController — resolves on construction", () => {
  it("URL wins: reads from URL and does not consult resolveAiDateWindow", () => {
    routeQuery.from = "1000";
    routeQuery.to = "2000";
    const c = useAiDateController();
    expect(c.dateState.value.valueType).toBe("absolute");
    expect(c.timeRange.value).toEqual({ startTime: 1000, endTime: 2000 });
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
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
  });

  it("falls back to default relative when resolveAiDateWindow returns null", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    const c = useAiDateController();
    expect(c.timeRange.value).toEqual({ startTime: 1_100_000, endTime: 2_000_000 });
    expect(c.dateState.value.relativeTimePeriod).toBe("15m");
  });

  it("honors a custom defaultRelative for the null fallback", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    const c = useAiDateController({ defaultRelative: "1h" });
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
  });

  it("writes URL after resolving from shared state", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    useAiDateController();
    expect(lastWrittenQuery()).toEqual({ period: "15m" });
  });

  it("an invalid URL period falls back to shared state and is rewritten", () => {
    routeQuery.period = "1.5h";
    mockState.value = { ...mockState.value, relativeTimePeriod: "1h" };
    resolveAiDateWindowMock.mockReturnValue(WINDOWS["1h"]);
    const c = useAiDateController();
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(lastWrittenQuery()).toEqual({ period: "1h" });
  });
});

// The picker replays its mount seed as a date-change before the page's onMounted; a deep link must survive it.
describe("useAiDateController — a deep link beats the previous visit's range", () => {
  const Picker = defineComponent({
    props: { seed: { type: String, required: true } },
    emits: ["date-change"],
    setup(props, { emit }) {
      onMounted(() =>
        emit("date-change", {
          valueType: "relative",
          relativeTimePeriod: props.seed,
          userChangedValue: false,
        }),
      );
      return () => h("div");
    },
  });

  function mountPage() {
    let controller!: ReturnType<typeof useAiDateController>;
    let replayChanged: boolean | undefined;
    const Page = defineComponent({
      setup() {
        controller = useAiDateController();
        return () =>
          h(Picker, {
            seed: controller.dateState.value.relativeTimePeriod ?? "",
            onDateChange: (v: unknown) => {
              replayChanged = controller.onDateChange(v);
            },
          });
      },
    });
    mount(Page);
    return { controller, replayChanged };
  }

  it.each(["6h", "30d"])("period=%s stays in state, picker seed and URL", (period) => {
    // The previous visit left 2h in the shared state.
    mockState.value = { ...mockState.value, relativeTimePeriod: "2h" };
    resolveAiDateWindowMock.mockReturnValue(WINDOWS["2h"]);
    routeQuery.period = period;

    const { controller, replayChanged } = mountPage();

    expect(controller.dateState.value.relativeTimePeriod).toBe(period);
    expect(controller.timeRange.value).toEqual(WINDOWS[period]);
    // A replace would cancel a navigation in flight (an org switch).
    expect(replaceMock).not.toHaveBeenCalled();
    expect(replayChanged).toBe(false);
  });
});

// On org switch the page remounts before MainLayout's push commits, so the route still names the previous org.
describe("useAiDateController — org switch", () => {
  it("writes the store's org, not the previous one left on the route", () => {
    routeQuery.org_identifier = "team1";
    resolveAiDateWindowMock.mockReturnValue(null);
    useAiDateController();
    expect(lastWrittenQuery()).toEqual({ org_identifier: "default", period: "15m" });
  });

  it("does not add an org the URL does not name", () => {
    resolveAiDateWindowMock.mockReturnValue(null);
    useAiDateController();
    expect(lastWrittenQuery()).toEqual({ period: "15m" });
  });
});

describe("useAiDateController — applyRelative", () => {
  it("sets timeRange from getConsumableRelativeTime and marks dateState relative", () => {
    const c = created();
    c.applyRelative("1h");
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(c.dateState.value.valueType).toBe("relative");
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(c.dateState.value.startTime).toBe(100_000);
    expect(c.dateState.value.endTime).toBe(2_000_000);
  });

  it("is a no-op when the period can't be parsed", () => {
    const c = created();
    const before = { ...c.timeRange.value };
    c.applyRelative("garbage");
    expect(c.timeRange.value).toEqual(before);
    expect(c.dateState.value.relativeTimePeriod).toBe("15m");
  });
});

describe("useAiDateController — readFromUrl", () => {
  it("sets absolute state and returns true for valid {from,to}", () => {
    const c = created();
    routeQuery.from = "1000";
    routeQuery.to = "2000";
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
    const c = created();
    expect(c.readFromUrl()).toBe(false);
  });

  it("applies relative and returns true for {period}", () => {
    const c = created();
    routeQuery.period = "1h";
    expect(c.readFromUrl()).toBe(true);
    expect(c.dateState.value.valueType).toBe("relative");
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
  });

  it("writes a leading-zero period as the picker names it", () => {
    const c = created();
    routeQuery.period = "06h";
    expect(c.readFromUrl()).toBe(true);
    expect(c.dateState.value.relativeTimePeriod).toBe("6h");
  });

  it.each(["1.5h", "0h", "abc", "6 hours", ""])("returns false for period=%j", (period) => {
    const c = created();
    routeQuery.period = period;
    expect(c.readFromUrl()).toBe(false);
  });

  it("returns false when neither from/to nor period is present", () => {
    const c = created();
    expect(c.readFromUrl()).toBe(false);
  });
});

describe("useAiDateController — writeToUrl", () => {
  it("writes period and drops from/to for a relative state", () => {
    routeQuery.other = "keep";
    const c = created();
    c.dateState.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };
    c.writeToUrl();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(lastWrittenQuery()).toEqual({ other: "keep", period: "1h" });
  });

  it("falls back to DEFAULT_RELATIVE when relativeTimePeriod is null", () => {
    routeQuery.period = "1h";
    const c = created();
    c.dateState.value = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: null,
    };
    c.writeToUrl();
    expect(lastWrittenQuery()?.period).toBe("15m");
  });

  it("writes from/to and drops period for an absolute state", () => {
    routeQuery.period = "15m";
    const c = created();
    c.dateState.value = {
      valueType: "absolute",
      startTime: 1000,
      endTime: 2000,
      relativeTimePeriod: null,
    };
    c.writeToUrl();
    const query = lastWrittenQuery();
    expect(query?.from).toBe("1000");
    expect(query?.to).toBe("2000");
    expect(query?.period).toBeUndefined();
  });
});

describe("useAiDateController — onDateChange", () => {
  it("replaces nothing when the URL already holds the date; a change still writes", () => {
    routeQuery.org_identifier = "default";
    routeQuery.period = "6h";
    const c = created();
    expect(c.onDateChange({ valueType: "relative", relativeTimePeriod: "6h" })).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();

    c.onDateChange({ valueType: "relative", relativeTimePeriod: "1h" });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(lastWrittenQuery()).toEqual({ org_identifier: "default", period: "1h" });
  });

  it("applies relative on a relative value and writes URL", () => {
    const c = created();
    expect(c.onDateChange({ valueType: "relative", relativeTimePeriod: "1h" })).toBe(true);
    expect(c.dateState.value.valueType).toBe("relative");
    expect(c.dateState.value.relativeTimePeriod).toBe("1h");
    expect(c.timeRange.value).toEqual({ startTime: 100_000, endTime: 2_000_000 });
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("sets absolute state on an absolute value and writes URL", () => {
    const c = created();
    expect(c.onDateChange({ startTime: 5, endTime: 9 })).toBe(true);
    expect(c.dateState.value).toEqual({
      valueType: "absolute",
      startTime: 5,
      endTime: 9,
      relativeTimePeriod: null,
    });
    expect(c.timeRange.value).toEqual({ startTime: 5, endTime: 9 });
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("reports no change for the range already in force", () => {
    const c = created();
    expect(c.onDateChange({ valueType: "relative", relativeTimePeriod: "15m" })).toBe(false);
    c.onDateChange({ startTime: 5, endTime: 9 });
    expect(c.onDateChange({ startTime: 5, endTime: 9 })).toBe(false);
  });

  it("keeps a sub-second deep link when the picker echoes it back rounded to the second", () => {
    routeQuery.from = "1730000000123456";
    routeQuery.to = "1730003600987654";
    const c = created();
    expect(c.onDateChange({ startTime: 1730000000000000, endTime: 1730003600000000 })).toBe(false);
    expect(c.timeRange.value).toEqual({ startTime: 1730000000123456, endTime: 1730003600987654 });
    // A real move of a second or more is a new range.
    expect(c.onDateChange({ startTime: 1730000060000000, endTime: 1730003600000000 })).toBe(true);
  });
});
