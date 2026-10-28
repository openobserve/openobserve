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
const mockRouterReplace = vi.fn(() => Promise.resolve());
const mockListAgents = vi.fn();
// Mutable per test; the default (set in beforeEach) is `?type=stream`.
const mockRouteQuery: Record<string, string> = {};

import { reactive, ref } from "vue";
import type { DataHealthResponse } from "@/services/gen-ai-data-health.service";

const mockStoreState = reactive({ selectedOrganization: { identifier: "test-org" } });

// Reactive refs the composable mock returns — tests can read these
// after asserting on fetch behaviour.
const mockKpi = ref({
  requestCount: 0,
  traceCount: 0,
  errorCount: 0,
  totalTokens: 0,
  totalCost: 0,
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
const mockP95Loading = ref(false);
const mockError = ref<string | null>(null);
const mockHasLoadedOnce = ref(false);
const mockAvailableStreams = ref<string[]>([]);
const mockStreamsLoaded = ref(false);
const mockHealth = ref<DataHealthResponse | null>(null);

vi.mock("./composables/useLLMInsights", () => ({
  useLLMInsights: () => ({
    kpi: mockKpi,
    sparklines: mockSparklines,
    loading: mockLoading,
    p95Loading: mockP95Loading,
    error: mockError,
    hasLoadedOnce: mockHasLoadedOnce,
    availableStreams: mockAvailableStreams,
    streamsLoaded: mockStreamsLoaded,
    fetchAll: mockFetchAll,
    cancelAll: mockCancelAll,
  }),
}));

vi.mock("./composables/useLLMDataHealth", () => ({
  useLLMDataHealth: () => ({
    health: mockHealth,
    loading: ref(false),
    error: ref(false),
    samples: ref(null),
    samplesLoading: ref(false),
    fetchHealth: vi.fn(),
    fetchSamples: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, params?: Record<string, any>) => (params ? key + JSON.stringify(params) : key),
  })),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  // Most of this suite exercises the stream-mode paths, driven through the URL
  // (`?type=stream`) the way the component reads it; scope tests override it.
  useRoute: () => ({ query: mockRouteQuery }),
}));

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    listAgents: (...args: any[]) => mockListAgents(...args),
    listVersionsForCompare: vi.fn().mockResolvedValue([]),
  },
}));

// Partial-mock vuex so `createStore` (used by `src/stores/index.ts`)
// stays intact while we override `useStore` for the component under test.
vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => ({ state: mockStoreState }),
  };
});

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import LLMInsightsDashboard from "./LLMInsightsDashboard.vue";
import config from "@/aws-exports";
// The KPI cache is a module singleton (survives remounts in the app); clear it
// between tests so a warmed entry from one mount doesn't suppress the fetch in
// the next.
import { kpiCache } from "./llmInsightsCache";
import { queryClient } from "@/composables/query/queryClient";
import { SCOPE_MODE_CHOICE_LS_KEY } from "@/enterprise/composables/useAgentScope";

const STREAM_LS_KEY = "llmInsights_streamFilter";

// The stream each panel mount was given, in mount order — a remount (which
// cancels the panel's in-flight query) shows up as a second entry.
let panelMounts: string[] = [];

// Earlier tests' dashboards would otherwise stay mounted and react to the shared mock refs.
enableAutoUnmount(afterEach);

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
        LLMSchemaPanel: { template: '<div data-test="llm-schema-panel" />' },
        LLMErrorTable: {
          props: ["streamName"],
          template: '<div data-test="llm-error-table" />',
          mounted(this: { streamName: string }) {
            panelMounts.push(this.streamName);
          },
        },
        KpiSparkline: { template: '<div data-test="kpi-sparkline" />' },
        LLMDataHealthStrip: { template: '<div data-test="llm-data-health-strip" />' },
        LLMInsightsSkeleton: { template: '<div data-test="llm-insights-skeleton" />' },
        OButton: {
          template: "<button @click=\"$emit('click')\"><slot /></button>",
          emits: ["click"],
        },
      },
    },
  });
}

beforeEach(() => {
  // Fresh mock state for every test.
  vi.clearAllMocks();
  kpiCache.clear();
  queryClient.clear();
  panelMounts = [];
  for (const k of Object.keys(mockRouteQuery)) delete mockRouteQuery[k];
  mockRouteQuery.type = "stream";
  mockListAgents.mockResolvedValue({ agents: [] });
  mockStoreState.selectedOrganization = { identifier: "test-org" };
  mockKpi.value = {
    requestCount: 0,
    traceCount: 0,
    errorCount: 0,
    totalTokens: 0,
    totalCost: 0,
    p95DurationMicros: 0,
  };
  mockSparklines.value = {
    cost: [],
    tokens: [],
    traces: [],
    p95Micros: [],
    errorRate: [],
  };
  mockLoading.value = false;
  mockP95Loading.value = false;
  mockError.value = null;
  mockHasLoadedOnce.value = false;
  mockAvailableStreams.value = [];
  mockStreamsLoaded.value = false;
  mockHealth.value = null;
  // Reset localStorage between tests so the dashboard's stream
  // initialisation doesn't bleed across cases.
  localStorage.clear();
  // Stream mode is opted into via `?type=stream` in the useRoute mock above
  // (the dashboard no longer reads a saved mode preference on init).
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
    // 4th arg is the selected agent (null = All Agents).
    expect(mockFetchAll).toHaveBeenCalledWith("default", 123, 456, null);
  });

  // Default path — no args means use props. `force` bypasses the in-memory KPI
  // cache that onMounted already warmed for this window (a same-window reload is
  // otherwise served from the snapshot — see the caching tests).
  it("falls back to props when no args passed", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights(undefined, undefined, { force: true });
    expect(mockFetchAll).toHaveBeenCalledWith(
      "default",
      1_700_000_000_000_000,
      1_700_001_000_000_000,
      null,
    );
  });

  // Persists the user's stream choice so reopening the dashboard later
  // restores it. The localStorage write happens BEFORE fetchAll —
  // verify both ordering and content. (`force` to bypass the warm KPI cache.)
  it("writes the active stream to localStorage before fetching", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    localStorage.clear();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights(undefined, undefined, { force: true });
    expect(localStorage.getItem(STREAM_LS_KEY)).toBe("default");
    expect(mockFetchAll).toHaveBeenCalled();
  });

  // The KPI cache: a same-window reload of the same selection is served from the
  // snapshot (no refetch); `force` and a new window both bypass it.
  it("restores KPI from cache on a same-window reload (no refetch)", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    // The insights fetch is parent-driven — trigger the first fetch via the
    // exposed refresh(), which populates the KPI cache for this window.
    await (wrapper.vm as any).refresh();
    await flushPromises();
    expect(mockFetchAll).toHaveBeenCalledTimes(1);
    mockFetchAll.mockClear();
    // Same window + selection, non-forced → served from the cache snapshot.
    await (wrapper.vm as any).loadInsights();
    expect(mockFetchAll).not.toHaveBeenCalled();
  });

  it("does not serve another org's KPI snapshot for the same stream and window", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await (wrapper.vm as any).refresh();
    await flushPromises();
    expect(mockFetchAll).toHaveBeenCalledTimes(1);
    mockFetchAll.mockClear();
    // An org switch keeps the module-level cache; only the org differs.
    mockStoreState.selectedOrganization = { identifier: "other-org" };
    await (wrapper.vm as any).loadInsights();
    expect(mockFetchAll).toHaveBeenCalledTimes(1);
  });

  it("refetches KPI after the time window changes", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockFetchAll.mockClear();
    await (wrapper.vm as any).loadInsights(2_000_000_000_000_000, 2_000_001_000_000_000);
    expect(mockFetchAll).toHaveBeenCalledTimes(1);
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
    expect(mockFetchAll).toHaveBeenCalledWith("default", 999, 1999, null);
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
      null,
    );
  });
});

// ===========================================================================
// onStreamChange — the OSelect v-model handler
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
      null,
    );
    expect(localStorage.getItem(STREAM_LS_KEY)).toBe("other");
  });

  // Stream is an identity dimension: the compare A/B pair belongs to the OLD
  // stream's agents, so switching stream must exit compare mode (otherwise the
  // comparison lingers on agents that may not exist in the new stream).
  it("exits compare mode when the active stream changes (stream mode)", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    // Stream mode: effectiveStream follows the page stream picker (activeStream).
    // (In agent mode effectiveStream follows the agent's source_stream, which the
    // selectedAgentName watcher already covers.)
    (wrapper.vm as any).filterMode = "stream";
    (wrapper.vm as any).activeStream = "start-stream";
    await wrapper.vm.$nextTick();
    await flushPromises();
    // Enter compare AFTER the mode/stream have settled, so the identity watcher
    // isn't fired by the setup itself.
    (wrapper.vm as any).compareMode = true;
    await wrapper.vm.$nextTick();
    expect((wrapper.vm as any).compareMode).toBe(true);

    // Now the real action: switch stream → compare mode must exit.
    (wrapper.vm as any).activeStream = "another-stream";
    await wrapper.vm.$nextTick();
    await flushPromises();

    expect((wrapper.vm as any).compareMode).toBe(false);
  });
});

// ===========================================================================
// onMounted — the initial-load flow
// ===========================================================================

describe("LLMInsightsDashboard — onMounted", () => {
  // First-time visit: onMounted loads the stream list ONLY — the insights
  // fetch is owned by the parent (via the exposed refresh()), so we don't
  // double-fetch on load. Mount discovers streams; the parent's refresh()
  // is what fires fetchAll.
  it("loads streams on mount but leaves the insights fetch to the parent", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    expect(mockGetStreams).toHaveBeenCalled();
    // Mount alone must NOT fetch — that's the parent's job.
    expect(mockFetchAll).not.toHaveBeenCalled();
    // Parent-driven fetch.
    await (wrapper.vm as any).refresh();
    await flushPromises();
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
  // The dashboard wires cancellation through onUnmounted so in-flight server
  // queries are cancelled when the user navigates away. Without this the server
  // keeps streaming results to a component that's no longer rendered. Unmount
  // cancels the dashboard's own queries plus the version-compare arms (armA +
  // armB), which share the mocked stream-query — three cancelAll calls total.
  it("calls cancelAll on unmount", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    mockCancelAll.mockClear();
    wrapper.unmount();
    expect(mockCancelAll).toHaveBeenCalledTimes(3);
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

describe("LLMInsightsDashboard — OSS builds (neither isEnterprise nor isCloud is 'true')", () => {
  const originalIsEnterprise = config.isEnterprise;
  const originalIsCloud = config.isCloud;

  afterEach(() => {
    config.isEnterprise = originalIsEnterprise;
    config.isCloud = originalIsCloud;
  });

  it("keeps the Stream/Agent toggle (Agent locked) and hides the Compare entry — both need the enterprise-only agent-mapping API", async () => {
    config.isEnterprise = "false";
    const wrapper = mountDashboard();
    await (wrapper.vm as any).refresh();
    await flushPromises();
    expect(wrapper.find("[data-test='llm-insights-filter-mode']").exists()).toBe(true);
    expect(wrapper.find("[data-test='llm-insights-compare-entry']").exists()).toBe(false);
  });

  it("still shows the toggle on a cloud build (isCloud true) even with isEnterprise false — cloud registers the same enterprise route/backend", async () => {
    config.isEnterprise = "false";
    config.isCloud = "true";
    const wrapper = mountDashboard();
    await (wrapper.vm as any).refresh();
    await flushPromises();
    expect(wrapper.find("[data-test='llm-insights-filter-mode']").exists()).toBe(true);
  });
});

// ===========================================================================
// Scope: mode resolution (AIO-02/03), URL scope (AIO-08), one agents fetch (AIO-18)
// ===========================================================================

const agentAt = (name: string, stream: string, env: string, version: string) => ({
  name,
  id: `id-${name}`,
  source_stream: stream,
  source_stream_type: "traces",
  env,
  version,
});

/** Mount and run the parent's mount-time load (DateTime's window replay: no force). */
async function mountAndEnter() {
  const wrapper = mountDashboard();
  await (wrapper.vm as any).refresh(undefined, undefined, false);
  await flushPromises();
  return wrapper;
}

// Agent mode needs the enterprise-only agent-mapping API, so these run as an
// enterprise build regardless of the local `.env` (CI has none, so it is OSS).
describe("LLMInsightsDashboard — scope resolution", () => {
  const originalIsEnterprise = config.isEnterprise;

  beforeEach(() => {
    config.isEnterprise = "true";
    delete mockRouteQuery.type;
  });

  afterEach(() => {
    config.isEnterprise = originalIsEnterprise;
  });

  it("opens in Stream mode with the 'No agent identity found' banner when the window has no agents but an LLM stream exists", async () => {
    mockListAgents.mockResolvedValue({ agents: [] });

    const wrapper = await mountAndEnter();

    expect((wrapper.vm as any).filterMode).toBe("stream");
    expect(mockFetchAll).toHaveBeenCalledWith(
      "default",
      1_700_000_000_000_000,
      1_700_001_000_000_000,
      null,
    );
    expect(wrapper.find("[data-test='llm-insights-no-agent-identity']").exists()).toBe(true);
    // The auto-picked mode stays out of the URL, so a reload re-decides.
    const lastQuery = (mockRouterReplace.mock.calls.at(-1) as any[])[0].query;
    expect(lastQuery.type).toBeUndefined();
    expect(lastQuery.stream).toBe("default");
  });

  it("opens in Agent mode when the window has agents", async () => {
    mockListAgents.mockResolvedValue({ agents: [agentAt("omp", "s1", "production", "1")] });

    const wrapper = await mountAndEnter();

    expect((wrapper.vm as any).filterMode).toBe("agent");
    // The auto-picked agent stays out of the URL too, so a reload with no agents ends in Stream.
    const lastQuery = (mockRouterReplace.mock.calls.at(-1) as any[])[0].query;
    expect([lastQuery.type, lastQuery.agent, lastQuery.env, lastQuery.version]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(wrapper.find("[data-test='llm-insights-no-agent-identity']").exists()).toBe(false);
  });

  it("mounts the panels once, with the final scope — never the first agent then the linked one", async () => {
    Object.assign(mockRouteQuery, { agent: "omp", env: "production", version: "2" });
    mockListAgents.mockResolvedValue({
      agents: [
        agentAt("a23ca1dd38a1ff350", "s_hash", "staging", "1"),
        agentAt("omp", "s_staging", "staging", "2"),
        agentAt("omp", "s_prod", "production", "2"),
      ],
    });

    const wrapper = await mountAndEnter();

    const vm = wrapper.vm as any;
    expect([vm.filterMode, vm.selectedEnv, vm.selectedAgentName, vm.selectedVersion]).toEqual([
      "agent",
      "production",
      "omp",
      "2",
    ]);
    expect(panelMounts).toEqual(["s_prod"]);
    expect(mockFetchAll).toHaveBeenCalledTimes(1);
  });

  it("keeps a remembered explicit Agent choice even when the window has no agents", async () => {
    localStorage.setItem(SCOPE_MODE_CHOICE_LS_KEY, "agent");
    mockListAgents.mockResolvedValue({ agents: [] });

    const wrapper = await mountAndEnter();

    expect((wrapper.vm as any).filterMode).toBe("agent");
    expect(wrapper.find("[data-test='llm-insights-agent-empty']").exists()).toBe(true);
  });

  it("keeps the URL's explicit Stream choice even when the window has agents", async () => {
    mockRouteQuery.type = "stream";
    mockListAgents.mockResolvedValue({ agents: [agentAt("omp", "s1", "production", "1")] });

    const wrapper = await mountAndEnter();

    expect((wrapper.vm as any).filterMode).toBe("stream");
  });

  it("remembers a toggle click as the explicit choice and writes it to the URL", async () => {
    mockListAgents.mockResolvedValue({ agents: [] });
    const wrapper = await mountAndEnter();

    (wrapper.vm as any).onFilterModeChange("agent");
    await flushPromises();

    expect(localStorage.getItem(SCOPE_MODE_CHOICE_LS_KEY)).toBe("agent");
    expect((mockRouterReplace.mock.calls.at(-1) as any[])[0].query.type).toBe("agent");
  });

  it("fetches gen_ai/agents once per view across mount replays and mode toggles", async () => {
    mockListAgents.mockResolvedValue({ agents: [agentAt("omp", "s1", "production", "1")] });
    const wrapper = mountDashboard();
    const vm = wrapper.vm as any;
    // DateTime may replay its window more than once on mount, concurrently.
    await Promise.all([
      vm.refresh(undefined, undefined, false),
      vm.refresh(undefined, undefined, false),
    ]);
    await flushPromises();
    vm.onFilterModeChange("stream");
    await flushPromises();
    vm.onFilterModeChange("agent");
    await flushPromises();

    expect(mockListAgents).toHaveBeenCalledTimes(1);
  });

  it("decides an auto mode again when the user picks a window with no agents", async () => {
    mockListAgents.mockResolvedValue({ agents: [agentAt("omp", "s1", "production", "1")] });
    const wrapper = await mountAndEnter();
    const vm = wrapper.vm as any;
    expect(vm.filterMode).toBe("agent");

    // A mount-time replay of another window decides nothing.
    mockListAgents.mockResolvedValue({ agents: [] });
    await vm.refresh(1_600_000_000_000_000, 1_600_001_000_000_000, false);
    await flushPromises();
    expect(vm.filterMode).toBe("agent");

    // The user's own pick does: the new window has no agents, so Stream.
    await vm.refresh(1_500_000_000_000_000, 1_500_001_000_000_000, true, true);
    await flushPromises();
    expect(vm.filterMode).toBe("stream");
    expect(mockFetchAll.mock.calls.at(-1)).toEqual([
      "default",
      1_500_000_000_000_000,
      1_500_001_000_000_000,
      null,
    ]);
  });

  it("keeps an explicit Agent choice when the user picks a window with no agents", async () => {
    mockRouteQuery.type = "agent";
    mockListAgents.mockResolvedValue({ agents: [agentAt("omp", "s1", "production", "1")] });
    const wrapper = await mountAndEnter();
    const vm = wrapper.vm as any;

    mockListAgents.mockResolvedValue({ agents: [] });
    await vm.refresh(1_500_000_000_000_000, 1_500_001_000_000_000, true, true);
    await flushPromises();
    expect(vm.filterMode).toBe("agent");
  });
});

describe("LLMInsightsDashboard — Total Cost tile", () => {
  async function costTileText(cost: number, tokens: number, unpricedTokens: number) {
    // A window with requests, so the tiles render rather than the empty state.
    mockKpi.value = {
      ...mockKpi.value,
      requestCount: 10,
      traceCount: 5,
      totalCost: cost,
      totalTokens: tokens,
    };
    mockHealth.value =
      unpricedTokens > 0
        ? {
            checked_at: 1,
            checks: [
              {
                id: "unpriced_models",
                status: "warning",
                affected: 3,
                total: 10,
                models: [{ model: "mystery-model", spans: 3, tokens: unpricedTokens }],
              },
            ],
          }
        : null;
    mockHasLoadedOnce.value = true;
    const wrapper = mountDashboard();
    await (wrapper.vm as any).refresh(undefined, undefined, false);
    await flushPromises();
    return wrapper.find("[data-test='llm-insights-kpi-value']").text();
  }

  it("reads 'cost unknown' when none of the tokens were priced", async () => {
    const text = await costTileText(0, 1000, 1000);
    expect(text).toContain("llmDataTrust.cost.unknown");
    expect(text).not.toContain("≥");
    expect(text).not.toContain("0.00");
  });

  it("reads as a lower bound when some tokens were priced", async () => {
    const text = await costTileText(1.5, 1000, 400);
    expect(text).toContain("≥");
    expect(text).toContain("1.50");
  });

  it("reads plain when every token was priced", async () => {
    const text = await costTileText(1.5, 1000, 0);
    expect(text).not.toContain("≥");
    expect(text).toContain("1.50");
  });

  it("reads the server's uncapped unpriced tokens, not the sum of the listed models", async () => {
    mockKpi.value = {
      ...mockKpi.value,
      requestCount: 10,
      traceCount: 5,
      totalCost: 1.5,
      totalTokens: 1000,
    };
    // The listed top models hold 400 tokens; models past the list cap hold the other 600.
    mockHealth.value = {
      checked_at: 1,
      checks: [
        {
          id: "unpriced_models",
          status: "warning",
          affected: 30,
          total: 40,
          models: [{ model: "mystery-model", spans: 3, tokens: 400 }],
          model_count: 25,
          unpriced_tokens: 1000,
          models_truncated: true,
        },
      ],
    };
    mockHasLoadedOnce.value = true;
    const wrapper = mountDashboard();
    // Exposed by the component for tests; the cast names only the method used here.
    const vm = wrapper.vm as unknown as { refresh: (...args: unknown[]) => Promise<void> };
    await vm.refresh(undefined, undefined, false);
    await flushPromises();
    expect(wrapper.find("[data-test='llm-insights-kpi-value']").text()).toContain(
      "llmDataTrust.cost.unknown",
    );
    // The tooltip names the listed models as the top ones of all 25.
    const tooltip = wrapper.find("[data-test='llm-insights-cost-unpriced']").attributes("title");
    expect(tooltip).toContain("llmDataTrust.topModels");
    expect(tooltip).toContain('\\"shown\\":1,\\"total\\":\\"25\\"');
  });
});
