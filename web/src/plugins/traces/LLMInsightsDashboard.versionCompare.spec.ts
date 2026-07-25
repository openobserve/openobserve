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
// Focused tests for the version-compare wiring in `LLMInsightsDashboard.vue`
// (Task 11): entering/exiting compare mode, the entry button's disabled
// state, and the date-picker disabled contract exposed to the parent page.
// Mirrors `LLMInsightsDashboard.spec.ts`'s mount/mock pattern.

// ---------------------------------------------------------------------------
// vi.mock() calls — hoisted above imports.
// ---------------------------------------------------------------------------

const mockFetchAll = vi.fn(async () => {});
const mockCancelAll = vi.fn();
const mockGetStreams = vi.fn().mockResolvedValue({
  list: [{ name: "default", settings: { is_llm_stream: true } }],
});
const mockListAgents = vi.fn();
const mockListVersionsForCompare = vi.fn();
const mockRouterPush = vi.fn();

import { ref } from "vue";

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

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

// useVersionCompare's raw-sample query runner rides fetchQueryDataWithHttpStream
// directly (same transport as useLLMInsights, but not through the mocked
// composable) — stub it to resolve with zero hits so `run()` completes without
// hitting a real streaming client.
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (_req: any, handlers: any) => {
      handlers.complete?.();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    listAgents: (...args: any[]) => mockListAgents(...args),
    listVersionsForCompare: (...args: any[]) => mockListVersionsForCompare(...args),
  },
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, params?: Record<string, any>) => (params ? key + JSON.stringify(params) : key),
  })),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(() => Promise.resolve()) }),
  useRoute: () => ({ query: {} }),
}));

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
import { kpiCache } from "./llmInsightsCache";

const AGENT_V15 = {
  name: "checkout-agent",
  id: "a1",
  source_stream: "default",
  source_stream_type: "traces",
  env: "prod",
  version: "1.5.0",
  first_seen: 1_700_000_000_000_000,
  last_seen: 1_700_100_000_000_000,
};
const AGENT_V14 = {
  ...AGENT_V15,
  id: "a2",
  version: "1.4.0",
  first_seen: 1_699_000_000_000_000,
  last_seen: 1_699_500_000_000_000,
};

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
        LLMSchemaPanel: { template: '<div data-test="llm-schema-panel" />' },
        LLMErrorTable: { template: '<div data-test="llm-error-table" />' },
        KpiSparkline: { template: '<div data-test="kpi-sparkline" />' },
        LLMInsightsSkeleton: { template: '<div data-test="llm-insights-skeleton" />' },
        // Compare-mode surfaces stubbed with a distinguishing data-test each,
        // so we can assert presence/absence without mounting echarts/reka-ui.
        VersionCompareBar: { template: '<div data-test="version-compare-bar" />' },
        VersionCompareBanner: { template: '<div data-test="version-compare-banner" />' },
        VersionWindowCard: {
          props: ["arm"],
          template: '<div :data-test="`version-window-card-${arm}`" />',
        },
        VersionDeltaStrip: { template: '<div data-test="version-delta-strip" />' },
        VersionOverlayChart: { template: '<div data-test="version-overlay-chart" />' },
        OButton: {
          props: ["disabled"],
          template:
            "<button :disabled=\"disabled\" @click=\"$emit('click')\"><slot /></button>",
          emits: ["click"],
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  kpiCache.clear();
  mockLoading.value = false;
  mockP95Loading.value = false;
  mockError.value = null;
  mockHasLoadedOnce.value = true;
  mockAvailableStreams.value = [];
  mockStreamsLoaded.value = false;
  localStorage.clear();
  // Agent mode is the module default; seed two versions of one agent so
  // canCompare resolves true in most tests.
  localStorage.setItem("llmInsights_filterMode", "agent");
  mockGetStreams.mockResolvedValue({
    list: [{ name: "default", settings: { is_llm_stream: true } }],
  });
  mockListAgents.mockResolvedValue({ agents: [AGENT_V15, AGENT_V14] });
  mockListVersionsForCompare.mockResolvedValue([AGENT_V15, AGENT_V14]);
});

afterEach(() => {
  localStorage.clear();
});

describe("LLMInsightsDashboard — version compare entry", () => {
  it("enables the compare entry when the agent has >= 2 versions", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    await (wrapper.vm as any).loadInsights();
    await flushPromises();
    const btn = wrapper.find('[data-test="llm-insights-compare-entry"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeFalsy();
  });

  it("disables the compare entry when the agent has only 1 version", async () => {
    mockListAgents.mockResolvedValue({ agents: [AGENT_V15] });
    mockListVersionsForCompare.mockResolvedValue([AGENT_V15]);
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    await (wrapper.vm as any).loadInsights();
    await flushPromises();
    const btn = wrapper.find('[data-test="llm-insights-compare-entry"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeDefined();
  });
});

describe("LLMInsightsDashboard — compare mode surfaces", () => {
  it("entering compare mode renders the 5 compare surfaces and hides the single-select body; exit restores it", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    await (wrapper.vm as any).loadInsights();
    await flushPromises();

    // Single-select body present before entering compare mode.
    expect(wrapper.find('[data-test="llm-insights-compare-view"]').exists()).toBe(false);

    const btn = wrapper.find('[data-test="llm-insights-compare-entry"]');
    await btn.trigger("click");
    await flushPromises();
    await flushPromises();

    const compareView = wrapper.find('[data-test="llm-insights-compare-view"]');
    expect(compareView.exists()).toBe(true);
    expect(compareView.find('[data-test="version-compare-bar"]').exists()).toBe(true);
    expect(compareView.find('[data-test="version-compare-banner"]').exists()).toBe(true);
    expect(compareView.find('[data-test="version-window-card-a"]').exists()).toBe(true);
    expect(compareView.find('[data-test="version-window-card-b"]').exists()).toBe(true);
    expect(compareView.find('[data-test="version-delta-strip"]').exists()).toBe(true);
    expect(compareView.find('[data-test="version-overlay-chart"]').exists()).toBe(true);

    // Single-select body hidden while compare mode is on.
    expect(wrapper.find('[data-test="llm-insights-skeleton"]').exists()).toBe(false);

    // Exit restores the single-select body — emit VersionCompareView's real
    // @exit event directly (equivalent to clicking VersionCompareBar's exit
    // button, which is covered by VersionCompareBar's own component spec).
    await wrapper.findComponent({ name: "VersionCompareView" }).vm.$emit("exit");
    await flushPromises();

    expect(wrapper.find('[data-test="llm-insights-compare-view"]').exists()).toBe(false);
  });
});

describe("LLMInsightsDashboard — sameWallClock shared window (C1)", () => {
  it("passes the page window as sharedWindow and re-runs on date-picker change while in sameWallClock", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    await (wrapper.vm as any).loadInsights();
    await flushPromises();

    const btn = wrapper.find('[data-test="llm-insights-compare-entry"]');
    await btn.trigger("click");
    await flushPromises();
    await flushPromises();

    const compareView = wrapper.findComponent({ name: "VersionCompareView" });
    await compareView.vm.$emit("run", {
      a: AGENT_V15,
      b: AGENT_V14,
      align: "sameWallClock",
    });
    await flushPromises();
    await flushPromises();

    expect((wrapper.vm as any).versionCompare.windows.value).not.toBeNull();
    const callsBefore = mockFetchAll.mock.calls.length;

    await wrapper.setProps({ startTime: 1_700_000_500_000_000, endTime: 1_700_001_500_000_000 });
    await flushPromises();
    await flushPromises();

    expect(mockFetchAll.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("does NOT re-run on date-picker change when align is sinceRollout", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    await (wrapper.vm as any).loadInsights();
    await flushPromises();

    const btn = wrapper.find('[data-test="llm-insights-compare-entry"]');
    await btn.trigger("click");
    await flushPromises();
    await flushPromises();

    const compareView = wrapper.findComponent({ name: "VersionCompareView" });
    await compareView.vm.$emit("run", {
      a: AGENT_V15,
      b: AGENT_V14,
      align: "sinceRollout",
    });
    await flushPromises();
    await flushPromises();

    const callsBefore = mockFetchAll.mock.calls.length;

    await wrapper.setProps({ startTime: 1_700_000_500_000_000, endTime: 1_700_001_500_000_000 });
    await flushPromises();
    await flushPromises();

    expect(mockFetchAll.mock.calls.length).toBe(callsBefore);
  });
});

describe("LLMInsightsDashboard — date-picker disabled contract (compareDateDisabled)", () => {
  it("is false before entering compare mode", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    expect((wrapper.vm as any).compareDateDisabled).toBe(false);
  });

  it("is true by default once compare mode is entered (sinceRollout)", async () => {
    const wrapper = mountDashboard();
    await flushPromises();
    await flushPromises();
    await (wrapper.vm as any).loadInsights();
    await flushPromises();
    const btn = wrapper.find('[data-test="llm-insights-compare-entry"]');
    await btn.trigger("click");
    await flushPromises();
    await flushPromises();
    expect((wrapper.vm as any).compareDateDisabled).toBe(true);
  });
});
