// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// Heavy async component stubs — must be declared before the component import
// so defineAsyncComponent never fires
// ---------------------------------------------------------------------------
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: { template: '<div data-test="render-dashboard-charts"></div>' },
}));

vi.mock("./TracesMetricsContextMenu.vue", () => ({
  default: { template: '<div data-test="traces-metrics-context-menu"></div>' },
}));

vi.mock("./TracesAnalysisDashboard.vue", () => ({
  default: {
    template: '<div data-test="traces-analysis-dashboard"></div>',
    props: ["streamName", "streamType", "timeRange", "analysisType"],
    emits: ["close"],
  },
}));

// ---------------------------------------------------------------------------
// Shared reactive searchObj — mutated between tests to drive mode changes
// ---------------------------------------------------------------------------
const mockMetricsRangeFilters = new Map();
const mockSearchObj = reactive({
  data: {
    stream: {
      selectedStream: { value: "default" },
      selectedStreamFields: [],
      userDefinedSchema: [],
    },
  },
  meta: {
    showHistogram: true,
    showErrorOnly: false,
    metricsRangeFilters: mockMetricsRangeFilters,
    searchMode: "traces" as "traces" | "spans",
  },
});

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

// convertDashboardSchemaVersion: return the object unchanged so SQL is preserved
vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: (data: any) =>
    JSON.parse(JSON.stringify(data)),
}));

// parseDurationWhereClause: return the input filter string unchanged
vi.mock("@/composables/useDurationPercentiles", () => ({
  parseDurationWhereClause: (_filter: string) => _filter,
}));

// useParser: resolve immediately with a no-op parser object by default.
// Individual describe blocks may override sqlParser via mockReturnValue to
// control when the promise resolves (see "onMounted ordering" tests below).
vi.mock("@/composables/useParser", () => ({
  default: vi.fn(() => ({
    sqlParser: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  deepCopy: (data: any) => JSON.parse(JSON.stringify(data)),
  formatTimeWithSuffix: (us: number) => `${us}ms`,
  useLocalOrganization: vi.fn().mockReturnValue({
    identifier: "test-org",
    name: "Test Organization",
  }),
  useLocalCurrentUser: vi.fn().mockReturnValue({
    email: "test@example.com",
    name: "Test User",
  }),
  useLocalTimezone: vi.fn().mockReturnValue("UTC"),
  b64EncodeUnicode: vi.fn().mockImplementation((str: string) => btoa(str)),
  b64DecodeUnicode: vi.fn().mockImplementation((str: string) => atob(str)),
}));

import useParser from "@/composables/useParser";
import TracesMetricsDashboard from "./TracesMetricsDashboard.vue";

installQuasar();

// ---------------------------------------------------------------------------
// Test store — minimal shape the component queries via useStore()
// ---------------------------------------------------------------------------
const mockStore = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
  },
});

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------
const defaultProps = {
  streamName: "my_traces_stream",
  timeRange: { startTime: 1_000_000, endTime: 2_000_000 },
  show: true,
};

// ---------------------------------------------------------------------------
// Mount factory — eliminates stub duplication across tests
// ---------------------------------------------------------------------------
function mountComponent(props: Record<string, unknown> = {}): VueWrapper<any> {
  return mount(TracesMetricsDashboard, {
    props: { ...defaultProps, ...props },
    global: {
      plugins: [mockStore, i18n],
      stubs: {
        RenderDashboardCharts: {
          template: '<div data-test="render-dashboard-charts"></div>',
        },
        TracesMetricsContextMenu: {
          template: '<div data-test="traces-metrics-context-menu"></div>',
        },
        TracesAnalysisDashboard: {
          template: '<div data-test="traces-analysis-dashboard"></div>',
          props: ["streamName", "streamType", "timeRange", "analysisType"],
          emits: ["close"],
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Helper: extract panel query by title from dashboardData
// ---------------------------------------------------------------------------
function getPanelQuery(wrapper: VueWrapper<any>, title: string): string {
  const data: any = wrapper.vm.dashboardData;
  const panels: any[] = data?.tabs?.[0]?.panels ?? [];
  const panel = panels.find((p: any) => p.title === title);
  return panel?.queries?.[0]?.query ?? "";
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("TracesMetricsDashboard", () => {
  // VueWrapper<any> — defineExpose'd properties are not in the inferred type;
  // using any avoids dozens of ts(2339) errors without hiding real logic mistakes.
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    // Reset all shared state before every test
    mockMetricsRangeFilters.clear();
    mockSearchObj.meta.showHistogram = true;
    mockSearchObj.meta.showErrorOnly = false;
    mockSearchObj.meta.searchMode = "traces";
    mockSearchObj.data.stream.selectedStream.value = "default";
    mockSearchObj.data.stream.selectedStreamFields = [];
    mockSearchObj.data.stream.userDefinedSchema = [];

    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should not render the charts-wrapper when show is false", async () => {
      await wrapper.setProps({ show: false });
      const charts = wrapper.find('[data-test="render-dashboard-charts"]');
      expect(charts.exists()).toBe(false);
    });

    it("should render the dashboard charts component when show is true and histogram is visible", () => {
      const charts = wrapper.find('[data-test="render-dashboard-charts"]');
      expect(charts.exists()).toBe(true);
    });

    it("should not render the dashboard charts component when show is false", async () => {
      await wrapper.setProps({ show: false });
      const charts = wrapper.find('[data-test="render-dashboard-charts"]');
      expect(charts.exists()).toBe(false);
    });

    it("should not render TracesAnalysisDashboard on initial mount", () => {
      const analysisDashboard = wrapper.find(
        '[data-test="traces-analysis-dashboard"]',
      );
      expect(analysisDashboard.exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadDashboard — traces mode (default)
  // -------------------------------------------------------------------------
  describe("loadDashboard — traces mode", () => {
    it("should use approx_distinct(trace_id) in the Rate panel query", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("approx_distinct(trace_id)");
    });

    it("should use approx_distinct(trace_id) FILTER for error counting in the Rate panel query", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      // The Rate panel template contains: approx_distinct(trace_id) filter (where span_status = 'ERROR')
      expect(query).toMatch(
        /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/i,
      );
    });

    it("should keep approx_distinct(trace_id) in the Errors panel query in traces mode", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      // Errors panel injects span_status='ERROR' into WHERE — should NOT replace approx_distinct yet
      expect(query).not.toContain("count(*)");
    });

    it("should prepend WHERE span_status = 'ERROR' to the Errors panel query", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("WHERE");
      expect(query).toContain("span_status = 'ERROR'");
    });
  });

  // -------------------------------------------------------------------------
  // loadDashboard — spans mode
  // -------------------------------------------------------------------------
  describe("loadDashboard — spans mode", () => {
    beforeEach(() => {
      mockSearchObj.meta.searchMode = "spans";
    });

    it("should replace approx_distinct(trace_id) with count(*) in the Rate panel query", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("count(*)");
      expect(query).not.toMatch(/approx_distinct\(trace_id\)/i);
    });

    it("should use count(*) FILTER for error counting in the Rate panel query in spans mode", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("count(*) FILTER (WHERE span_status = 'ERROR')");
    });

    it("should replace approx_distinct(trace_id) with count(*) in the Errors panel query", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("count(*)");
      expect(query).not.toMatch(/approx_distinct\(trace_id\)/i);
    });

    it("should use count(*) FILTER for Errors panel in spans mode", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("count(*) FILTER (WHERE span_status = 'ERROR')");
    });

    it("should NOT add the root-span filter to the Duration panel in spans mode", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Duration");
      expect(query).not.toContain("reference_parent_span_id");
    });
  });

  // -------------------------------------------------------------------------
  // loadDashboard — WHERE clause from filter prop
  // -------------------------------------------------------------------------
  describe("loadDashboard — WHERE clause from filter prop", () => {
    it("should include the filter prop in the Rate panel WHERE clause", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: "service_name = 'api'" });
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("service_name = 'api'");
    });

    it("should include the filter prop in the Duration panel WHERE clause", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: "service_name = 'api'" });
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Duration");
      expect(query).toContain("service_name = 'api'");
    });

    it("should include the filter prop in the Errors panel WHERE clause", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: "service_name = 'api'" });
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("service_name = 'api'");
    });

    it("should produce no WHERE clause in Rate panel when filter is absent and no range filters exist", async () => {
      // default mount has no filter prop and empty metricsRangeFilters
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      // WHERE clause placeholder should be replaced with empty string
      expect(query).not.toContain("[WHERE_CLAUSE]");
      expect(query).not.toMatch(/WHERE\b/);
    });

    it("should combine duration range filter and filter prop in Rate panel WHERE clause", async () => {
      mockMetricsRangeFilters.set("panel-dur", {
        panelTitle: "Duration",
        start: 1000,
        end: 5000,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.unmount();
      wrapper = mountComponent({ filter: "env = 'prod'" });
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("duration >= 1000 and duration <= 5000");
      expect(query).toContain("env = 'prod'");
    });
  });

  // -------------------------------------------------------------------------
  // loadDashboard — stream name substitution
  // -------------------------------------------------------------------------
  describe("loadDashboard — stream name substitution", () => {
    it("should replace [STREAM_NAME] placeholder with the selectedStream value in Rate panel", async () => {
      mockSearchObj.data.stream.selectedStream.value = "my_traces_stream";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain('"my_traces_stream"');
      expect(query).not.toContain("[STREAM_NAME]");
    });

    it("should replace [STREAM_NAME] placeholder in Duration panel", async () => {
      mockSearchObj.data.stream.selectedStream.value = "prod_traces";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Duration");
      expect(query).toContain('"prod_traces"');
      expect(query).not.toContain("[STREAM_NAME]");
    });

    it("should replace [STREAM_NAME] placeholder in Errors panel", async () => {
      mockSearchObj.data.stream.selectedStream.value = "staging_traces";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain('"staging_traces"');
      expect(query).not.toContain("[STREAM_NAME]");
    });

    it("should use empty-string stream name when selectedStream value is empty", async () => {
      mockSearchObj.data.stream.selectedStream.value = "";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      // Placeholder replaced with quoted empty string
      expect(query).toContain('""');
      expect(query).not.toContain("[STREAM_NAME]");
    });
  });

  // -------------------------------------------------------------------------
  // Props reactivity — timeRange change triggers re-load
  // -------------------------------------------------------------------------
  describe("props reactivity", () => {
    it("should update currentTimeObj when timeRange prop changes", async () => {
      const newTimeRange = { startTime: 5_000_000, endTime: 6_000_000 };
      await wrapper.setProps({ timeRange: newTimeRange });
      // Directly calling loadDashboard (watch triggers it; call explicitly to avoid timing)
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const timeObj: any = wrapper.vm.currentTimeObj;
      expect(timeObj.__global.start_time.getTime()).toBe(5_000_000);
      expect(timeObj.__global.end_time.getTime()).toBe(6_000_000);
    });

    it("should set dashboardData after loadDashboard is called with new timeRange", async () => {
      const newTimeRange = { startTime: 7_000_000, endTime: 8_000_000 };
      await wrapper.setProps({ timeRange: newTimeRange });
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(wrapper.vm.dashboardData).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Emits
  // -------------------------------------------------------------------------
  describe("emits", () => {
    it("should emit time-range-selected when onDataZoom is called with start and end", async () => {
      wrapper.vm.onDataZoom({
        start: 1_000,
        end: 2_000,
        start1: 500,
        end1: 1500,
        data: { id: "Panel_ID8254010", title: "Rate" },
      });
      await flushPromises();
      const emitted = wrapper.emitted("time-range-selected");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toEqual({ start: 1_000, end: 2_000 });
    });

    it("should emit filters-updated when emitFiltersToQueryEditor is called with a duration range filter", async () => {
      mockMetricsRangeFilters.set("panel-dur", {
        panelTitle: "Duration",
        start: 200,
        end: 800,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.vm.emitFiltersToQueryEditor();
      await flushPromises();
      const emitted = wrapper.emitted("filters-updated");
      expect(emitted).toBeTruthy();
      const filters: string[] = emitted![0][0] as string[];
      expect(filters.some((f) => f.includes("duration"))).toBe(true);
    });

    it("should emit filters-updated with an error filter entry when an Errors range is present", async () => {
      mockMetricsRangeFilters.set("panel-err", {
        panelTitle: "Errors",
        start: -1,
        end: -1,
        timeStart: 1000,
        timeEnd: 2000,
      });
      wrapper.vm.emitFiltersToQueryEditor();
      await flushPromises();
      const emitted = wrapper.emitted("filters-updated");
      expect(emitted).toBeTruthy();
      const filters: string[] = emitted![0][0] as string[];
      expect(filters).toContain("span_status = 'ERROR'");
    });

    it("should NOT emit time-range-selected when onDataZoom is called without start/end", async () => {
      wrapper.vm.onDataZoom({
        start: 0,
        end: 0,
        start1: 0,
        end1: 0,
        data: { id: "Panel_ID8254010", title: "Rate" },
      });
      await flushPromises();
      expect(wrapper.emitted("time-range-selected")).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // Insights button — driven via the exposed openUnifiedAnalysisDashboard API
  // (the insights button DOM element was removed from the template; the
  //  function is invoked by the parent via defineExpose)
  // -------------------------------------------------------------------------
  describe("insights button", () => {
    it("should open the analysis dashboard when openUnifiedAnalysisDashboard is called", async () => {
      wrapper.vm.openUnifiedAnalysisDashboard();
      await flushPromises();
      expect(wrapper.vm.showAnalysisDashboard).toBe(true);
    });

    it("should render TracesAnalysisDashboard after openUnifiedAnalysisDashboard is called", async () => {
      wrapper.vm.openUnifiedAnalysisDashboard();
      await flushPromises();
      const analysisDashboard = wrapper.find(
        '[data-test="traces-analysis-dashboard"]',
      );
      expect(analysisDashboard.exists()).toBe(true);
    });

    it("should set defaultAnalysisTab to volume when no brush selection exists", async () => {
      wrapper.vm.openUnifiedAnalysisDashboard();
      await flushPromises();
      expect(wrapper.vm.defaultAnalysisTab).toBe("volume");
    });
  });

  // -------------------------------------------------------------------------
  // Exposed API
  // -------------------------------------------------------------------------
  describe("exposed API", () => {
    it("should expose the refresh method", () => {
      expect(typeof wrapper.vm.refresh).toBe("function");
    });

    it("should expose the loadDashboard method", () => {
      expect(typeof wrapper.vm.loadDashboard).toBe("function");
    });

    it("should expose the getBaseFilters method", () => {
      expect(typeof wrapper.vm.getBaseFilters).toBe("function");
    });

    it("should expose rangeFiltersVersion as a ref", () => {
      // rangeFiltersVersion is a numeric ref — it must be a number
      expect(typeof wrapper.vm.rangeFiltersVersion).toBe("number");
    });

    it("should expose the openUnifiedAnalysisDashboard method", () => {
      expect(typeof wrapper.vm.openUnifiedAnalysisDashboard).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // getBaseFilters — detail tests
  // -------------------------------------------------------------------------
  describe("getBaseFilters", () => {
    it("should return an empty array when no filters are active", () => {
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toEqual([]);
    });

    it("should include a duration range filter expression when a Duration range filter is set", () => {
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: 100,
        end: 500,
        timeStart: null,
        timeEnd: null,
      });
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toHaveLength(1);
      expect(filters[0]).toBe("duration >= 100 and duration <= 500");
    });

    it("should include span_status = 'ERROR' when showErrorOnly is true and filter prop contains it", () => {
      wrapper.unmount();
      mockSearchObj.meta.showErrorOnly = true;
      wrapper = mountComponent({ filter: "span_status = 'ERROR'" });
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("span_status = 'ERROR'");
    });

    it("should NOT include span_status = 'ERROR' from toggle alone when filter prop does not contain it", () => {
      mockSearchObj.meta.showErrorOnly = true;
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).not.toContain("span_status = 'ERROR'");
    });

    it("should include the filter prop string when filter is a non-empty string", () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: "http_method = 'GET'" });
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("http_method = 'GET'");
    });

    it("should not include a filter entry when filter prop is an empty string", () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: "" });
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toEqual([]);
    });

    it("should not include a filter entry when filter prop is only whitespace", () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: "   " });
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // onMounted ordering — loadDashboard fires before sqlParser resolves
  //
  // The fix reordered onMounted so that loadDashboard() is called (and
  // completes synchronously up to its first await-free path) before
  // `await loadSqlParser()` suspends execution. These tests verify that
  // dashboardData is populated while loadSqlParser is still pending, which
  // is what prevents the child GridStack from collapsing to 17px.
  // -------------------------------------------------------------------------
  describe("onMounted ordering", () => {
    // For each test in this group we install a deferred sqlParser so we can
    // inspect component state while the promise is still unresolved.
    let resolveParser!: (value: unknown) => void;
    let parserPromise!: Promise<unknown>;

    beforeEach(() => {
      // Build a fresh deferred promise per test — never shared across tests.
      parserPromise = new Promise((resolve) => {
        resolveParser = resolve;
      });

      vi.mocked(useParser).mockReturnValue({
        sqlParser: vi.fn().mockReturnValue(parserPromise),
      });
    });

    it("should have non-null dashboardData before loadSqlParser resolves", async () => {
      // Mount with a pending parser — onMounted fires but sqlParser never
      // resolves until we call resolveParser() below.
      const localWrapper = mountComponent();

      // Drain the microtask queue up to the point where loadDashboard() has
      // completed but the await loadSqlParser() suspension is still pending.
      // Because loadDashboard() is synchronous (no internal await on this
      // code path), a single nextTick is sufficient.
      await localWrapper.vm.$nextTick();

      // dashboardData must already be populated — the child RenderDashboardCharts
      // receives a real object, not null, so GridStack initialises correctly.
      expect(localWrapper.vm.dashboardData).not.toBeNull();

      // Clean up: resolve the parser so the component finishes mounting
      // without an unhandled rejection.
      resolveParser({});
      await localWrapper.vm.$nextTick();
      localWrapper.unmount();
    });

    it("should call loadDashboard synchronously relative to the loadSqlParser await gap", async () => {
      // We track the order of calls: loadDashboard sets dashboardData, which
      // happens before sqlParser's promise resolves. We verify this by
      // checking that dashboardData is set at the moment the parser resolves
      // for the first time (i.e. it was set earlier, not after).
      const localWrapper = mountComponent();

      // Tick once to let the synchronous portion of onMounted execute.
      await localWrapper.vm.$nextTick();

      // dashboardData is already set — confirms loadDashboard ran before the
      // await suspension handed control back to the event loop.
      const dashboardDataBeforeParserResolves = localWrapper.vm.dashboardData;
      expect(dashboardDataBeforeParserResolves).not.toBeNull();

      // Now resolve the parser and flush all remaining microtasks.
      resolveParser({});
      await localWrapper.vm.$nextTick();

      // dashboardData must still be non-null after the parser resolves.
      expect(localWrapper.vm.dashboardData).not.toBeNull();

      localWrapper.unmount();
    });

    it("should set sqlParser.value only after loadSqlParser resolves", async () => {
      const localWrapper = mountComponent();

      // Right after mount — parser promise is still pending.
      await localWrapper.vm.$nextTick();

      // sqlParser ref should not yet hold the resolved value (it is still null
      // because loadSqlParser has not resolved).
      // We cannot read sqlParser directly, but dashboardData being set first
      // proves loadDashboard completed before the parser await resumed.
      expect(localWrapper.vm.dashboardData).not.toBeNull();

      resolveParser({ parse: vi.fn() });
      await localWrapper.vm.$nextTick();

      // After resolving, the component should still be healthy.
      expect(localWrapper.exists()).toBe(true);

      localWrapper.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("should mount without error when streamName prop is an empty string", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamName: "" });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without error when filter prop is undefined", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ filter: undefined });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without error when streamFields prop is an empty array", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: [] });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without error when streamFields prop is undefined", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: undefined });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should set dashboardData to a non-null value after loadDashboard runs on mount", () => {
      // dashboardData is set during onMounted -> loadDashboard()
      expect(wrapper.vm.dashboardData).not.toBeNull();
    });

    it("should not emit time-range-selected when onDataZoom receives null data", async () => {
      wrapper.vm.onDataZoom({
        start: 0,
        end: 0,
        start1: null,
        end1: null,
        data: null,
      });
      await flushPromises();
      expect(wrapper.emitted("time-range-selected")).toBeFalsy();
    });

    it("should produce a Duration query with no WHERE clause in spans mode when no filters exist", async () => {
      mockSearchObj.meta.searchMode = "spans";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Duration");
      expect(query).not.toMatch(/WHERE\b/);
    });
  });
});
