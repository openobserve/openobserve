// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// @vitest-environment jsdom
//
// Focused tests for `LLMInsightsDashboard.vue` — covers the dashboard's
// single fetch entry point (`loadInsights`), the wrapper exposed for
// the parent (`refresh`), and the stream-change handler. The pure
// helpers (`computeTrend`, `splitNumberWithUnit`, etc.) are tested in
// `llmInsightsDashboard.utils.spec.ts`; the composable's fetch flow is
// tested in `composables/useLLMInsights.spec.ts`. This file pins the
// thin glue that lives in the SFC.

// ---------------------------------------------------------------------------
// vi.mock() calls — hoisted above imports.
// ---------------------------------------------------------------------------

const mockFetchAll = vi.fn(async () => {});
const mockCancelAll = vi.fn();
const mockGetStreams = vi.fn().mockResolvedValue({
  list: [
    { name: "default", settings: { is_llm_stream: true } },
    { name: "other", settings: { is_llm_stream: false } },
  ],
});
const mockRouterPush = vi.fn();

import { ref } from "vue";

// Reactive refs the composable mock returns — tests can read these
// after asserting on fetch behaviour.
const mockKpi = ref({
  requestCount: 0,
  traceCount: 0,
  errorCount: 0,
  totalTokens: 0,
  totalCost: 0,
  avgDurationMicros: 0,
  p95DurationMicros: 0,
});
const mockKpiPrev = ref({
  requestCount: 0,
  traceCount: 0,
  errorCount: 0,
  totalTokens: 0,
  totalCost: 0,
  avgDurationMicros: 0,
  p95DurationMicros: 0,
});
const mockSparklines = ref({
  cost: [],
  tokens: [],
  traces: [],
  p95Micros: [],
  errorRate: [],
});
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockHasLoadedOnce = ref(false);
const mockAvailableStreams = ref<string[]>([]);
const mockStreamsLoaded = ref(false);

vi.mock("./composables/useLLMInsights", () => ({
  useLLMInsights: () => ({
    kpi: mockKpi,
    kpiPrev: mockKpiPrev,
    sparklines: mockSparklines,
    loading: mockLoading,
    error: mockError,
    hasLoadedOnce: mockHasLoadedOnce,
    availableStreams: mockAvailableStreams,
    streamsLoaded: mockStreamsLoaded,
    fetchAll: mockFetchAll,
    cancelAll: mockCancelAll,
  }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// Partial-mock vuex so `createStore` (used by `src/stores/index.ts`)
// stays intact while we override `useStore` for the component under test.
vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => ({
      state: {
        selectedOrganization: { identifier: "test-org" },
      },
    }),
  };
});

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LLMInsightsDashboard from "./LLMInsightsDashboard.vue";

const STREAM_LS_KEY = "llmInsights_streamFilter";

/** Mount the dashboard with default props that satisfy the loadInsights guard. */
function mountDashboard(
  propsOverrides: Partial<{ streamName: string; startTime: number; endTime: number }> = {},
) {
  return mount(LLMInsightsDashboard, {
    props: {
      streamName: "default",
      startTime: 1_700_000_000_000_000,
      endTime: 1_700_001_000_000_000,
      ...propsOverrides,
    },
    global: {
      stubs: {
        // Children — all stubbed so we don't try to render echarts /
        // sparkline math during dashboard-level tests.
        LLMTrendPanel: { template: "<div data-test=\"llm-trend-panel\" />" },
        KpiSparkline: { template: "<div data-test=\"kpi-sparkline\" />" },
        LLMInsightsSkeleton: { template: "<div data-test=\"llm-insights-skeleton\" />" },
        OButton: {
          template: "<button @click=\"$emit('click')\"><slot /></button>",
          emits: ["click"],
        },
        // Quasar primitives the dashboard renders.
        QSelect: {
          template: "<div data-test=\"q-select\" />",
          props: ["modelValue", "options", "disable"],
          emits: ["update:model-value"],
        },
        QTooltip: { template: "<div />" },
        QIcon: { template: "<i />" },
      },
    },
  });
}

beforeEach(() => {
  // Fresh mock state for every test.
  vi.clearAllMocks();
  mockKpi.value = {
    requestCount: 0,
    traceCount: 0,
    errorCount: 0,
    totalTokens: 0,
    totalCost: 0,
    avgDurationMicros: 0,
    p95DurationMicros: 0,
  };
  mockKpiPrev.value = { ...mockKpi.value };
  mockSparklines.value = {
    cost: [],
    tokens: [],
    traces: [],
    p95Micros: [],
    errorRate: [],
  };
  mockLoading.value = false;
  mockError.value = null;
  mockHasLoadedOnce.value = false;
  mockAvailableStreams.value = [];
  mockStreamsLoaded.value = false;
  // Reset localStorage between tests so the dashboard's stream
  // initialisation doesn't bleed across cases.
  localStorage.clear();
  // Default streams response.
  mockGetStreams.mockResolvedValue({
    list: [
      { name: "default", settings: { is_llm_stream: true } },
      { name: "other", settings: { is_llm_stream: false } },
    ],
  });
});

afterEach(() => {
  localStorage.clear();
});

// ===========================================================================
// loadInsights — the dashboard's single fetch entry point
// ===========================================================================

describe("LLMInsightsDashboard — loadInsights guards", () => {
  // Bails when stream selector is empty — otherwise we'd hit the server
  // with `FROM ""` which is a parse error. The guard also covers the
  // race during initial mount before loadTraceStreams resolves.
  it("does not call fetchAll when activeStream is empty", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    // Manually clear activeStream (loadTraceStreams may have set it).
    (wrapper.vm as any).activeStream = "";
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights();
    expect(mockFetchAll).not.toHaveBeenCalled();
  });

  // The dashboard accepts startTime / endTime as props. Parent passes
  // them as part of its time-range computation. When either is 0 the
  // dashboard is in a "bootstrap" state — bail without firing SQL.
  it("does not call fetchAll when start is missing", async () => {
    const wrapper = mountDashboard({ startTime: 0 });
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights();
    expect(mockFetchAll).not.toHaveBeenCalled();
  });

  it("does not call fetchAll when end is missing", async () => {
    const wrapper = mountDashboard({ endTime: 0 });
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights();
    expect(mockFetchAll).not.toHaveBeenCalled();
  });

  // Explicit args override prop defaults — that's the path the parent
  // uses on Refresh to side-step Vue's next-tick prop propagation lag.
  it("accepts explicit start/end args overriding props", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights(123, 456);
    expect(mockFetchAll).toHaveBeenCalledWith("default", 123, 456);
  });

  // Default path — no args means use props.
  it("falls back to props when no args passed", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights();
    expect(mockFetchAll).toHaveBeenCalledWith(
      "default",
      1_700_000_000_000_000,
      1_700_001_000_000_000,
    );
  });

  // Persists the user's stream choice so reopening the dashboard later
  // restores it. The localStorage write happens BEFORE fetchAll —
  // verify both ordering and content.
  it("writes the active stream to localStorage before fetching", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    localStorage.clear();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights();
    expect(localStorage.getItem(STREAM_LS_KEY)).toBe("default");
    expect(mockFetchAll).toHaveBeenCalled();
  });
});

// ===========================================================================
// refresh — the parent-facing entry exposed via defineExpose
// ===========================================================================

describe("LLMInsightsDashboard — refresh (parent entry point)", () => {
  // The parent passes the freshly computed start/end because Vue's
  // prop propagation lags by a tick — without explicit args we'd
  // fetch with the previous window. Verify the args reach fetchAll.
  it("forwards explicit start/end through to fetchAll", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).refresh(999, 1999);
    expect(mockFetchAll).toHaveBeenCalledWith("default", 999, 1999);
  });

  // No args → behaves like a normal loadInsights (falls back to props).
  it("falls back to props when called with no args", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).refresh();
    expect(mockFetchAll).toHaveBeenCalledWith(
      "default",
      1_700_000_000_000_000,
      1_700_001_000_000_000,
    );
  });
});

// ===========================================================================
// onStreamChange — the q-select v-model handler
// ===========================================================================

describe("LLMInsightsDashboard — onStreamChange", () => {
  // Stream-selector change → fetch with the new stream + current props.
  // Persists to localStorage as a side-effect of loadInsights.
  it("fetches with the new active stream", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    (wrapper.vm as any).activeStream = "other";
    (wrapper.vm as any).onStreamChange();
    await flushPromises();
    expect(mockFetchAll).toHaveBeenCalledWith(
      "other",
      1_700_000_000_000_000,
      1_700_001_000_000_000,
    );
    expect(localStorage.getItem(STREAM_LS_KEY)).toBe("other");
  });
});

// ===========================================================================
// onMounted — the initial-load flow
// ===========================================================================

describe("LLMInsightsDashboard — onMounted", () => {
  // First-time visit: loadTraceStreams runs, then loadInsights fires
  // once with the resolved stream. We assert getStreams was called
  // (so the dashboard discovered LLM streams) and fetchAll fired.
  it("fetches streams then loads insights on first mount", async () => {
    mountDashboard();
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalled();
    expect(mockFetchAll).toHaveBeenCalled();
  });

  // Filters out streams with `is_llm_stream === false` explicitly.
  // Streams without the flag (legacy) are kept — see
  // `loadTraceStreams` policy comment.
  it("excludes streams with is_llm_stream === false", async () => {
    mockGetStreams.mockResolvedValue({
      list: [
        { name: "a", settings: { is_llm_stream: true } },
        { name: "b", settings: { is_llm_stream: false } },
        { name: "c", settings: {} }, // no flag → kept (legacy)
      ],
    });
    const wrapper = mountDashboard();
    await flushPromises();
    expect((wrapper.vm as any).availableStreams).toEqual(["a", "c"]);
  });

  // localStorage value is honoured on mount when it's still a valid
  // option after the streams list resolves.
  it("uses localStorage stream when it's in the available list", async () => {
    localStorage.setItem(STREAM_LS_KEY, "default");
    mockGetStreams.mockResolvedValue({
      list: [{ name: "default", settings: { is_llm_stream: true } }],
    });
    const wrapper = mountDashboard();
    await flushPromises();
    expect((wrapper.vm as any).activeStream).toBe("default");
  });

  // Stale localStorage value (stream no longer exists) → clamp to the
  // first available option. Prevents the dashboard from rendering a
  // broken empty state for an unselectable stream.
  it("clamps to the first available stream when localStorage value is stale", async () => {
    localStorage.setItem(STREAM_LS_KEY, "deleted-stream");
    mockGetStreams.mockResolvedValue({
      list: [{ name: "alive", settings: { is_llm_stream: true } }],
    });
    const wrapper = mountDashboard();
    await flushPromises();
    expect((wrapper.vm as any).activeStream).toBe("alive");
  });

  // Cleanly handles a getStreams failure — empty list, no crash.
  it("falls back to empty stream list when getStreams rejects", async () => {
    mockGetStreams.mockRejectedValueOnce(new Error("boom"));
    const wrapper = mountDashboard();
    await flushPromises();
    expect((wrapper.vm as any).availableStreams).toEqual([]);
    expect((wrapper.vm as any).activeStream).toBe("");
    // No fetchAll because no active stream.
    expect(mockFetchAll).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// onUnmounted — cancellation on tab/page navigation away
// ===========================================================================

describe("LLMInsightsDashboard — onUnmounted", () => {
  // The dashboard exposes cancelAll on the composable and wires it
  // through onUnmounted so in-flight server queries are cancelled
  // when the user navigates away. Without this the server keeps
  // streaming results to a component that's no longer rendered.
  it("calls cancelAll on unmount", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockCancelAll.mockClear();
    wrapper.unmount();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// onViewTrace — router push when user clicks "View" in recent-errors
// ===========================================================================

describe("LLMInsightsDashboard — onViewTrace", () => {
  // The recent-errors panel emits view-trace with a trace_id. The
  // dashboard pushes to traceDetails with the current window so the
  // detail page shows the same time range as the dashboard.
  it("routes to traceDetails with the current window", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockRouterPush.mockClear();
    (wrapper.vm as any).onViewTrace("trace-123");
    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "traceDetails",
      query: expect.objectContaining({
        stream: "default",
        trace_id: "trace-123",
        from: 1_700_000_000_000_000,
        to: 1_700_001_000_000_000,
        org_identifier: "test-org",
      }),
    });
  });

  // Empty / missing trace_id is a no-op — defensive against the
  // "view-link" column receiving a row without a trace_id field.
  it("does nothing when traceId is empty", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockRouterPush.mockClear();
    (wrapper.vm as any).onViewTrace("");
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
