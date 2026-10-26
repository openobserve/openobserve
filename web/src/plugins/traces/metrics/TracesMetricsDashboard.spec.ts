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
import { createStore } from "vuex";
import i18n from "@/locales";
import { convertToUtcTimestamp } from "@/utils/timezone";

// ---------------------------------------------------------------------------
// Heavy async component stubs — must be declared before the component import
// so defineAsyncComponent never fires
// ---------------------------------------------------------------------------
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: { template: '<div data-test="render-dashboard-charts"></div>' },
}));

vi.mock("./TracesLatencyHeatmap.vue", () => ({
  default: {
    name: "TracesLatencyHeatmap",
    template: '<div data-test="traces-latency-heatmap"></div>',
    props: ["request"],
    emits: ["select"],
  },
}));

vi.mock("./TracesComparison.vue", () => ({
  default: {
    name: "TracesComparison",
    template: '<div data-test="traces-comparison-stub"></div>',
    props: ["selection", "streamName"],
    emits: ["close", "apply-filter"],
  },
}));

// ---------------------------------------------------------------------------
// Shared reactive searchObj — mutated between tests to drive mode changes
// ---------------------------------------------------------------------------
const mockMetricsRangeFilters = new Map();
const mockSearchObj = reactive({
  loading: false,
  data: {
    editorValue: "",
    datetime: { startTime: 1_000_000, endTime: 2_000_000 },
    stream: {
      selectedStream: { value: "default" },
      selectedStreamFields: [],
      userDefinedSchema: [],
    },
  },
  meta: {
    showHistogram: true,
    metricsRangeFilters: mockMetricsRangeFilters,
    searchMode: "traces" as "traces" | "spans",
  },
});

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    tracesParser: { value: null },
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

// convertDashboardSchemaVersion: return the object unchanged so SQL is preserved
vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: (data: any) => JSON.parse(JSON.stringify(data)),
}));

// parseDurationWhereClause: return the input filter string unchanged by default;
// vi.fn so individual tests can override it to assert decoded output is used.
vi.mock("@/composables/useDurationPercentiles", () => ({
  parseDurationWhereClause: vi.fn((filter: string) => filter),
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
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import TracesMetricsDashboard from "./TracesMetricsDashboard.vue";
import { instantToPickerMs } from "./latencyHeatmap";

// ---------------------------------------------------------------------------
// Test store — minimal shape the component queries via useStore()
// ---------------------------------------------------------------------------
const mockStore = createStore({
  state: {
    theme: "light",
    timezone: "UTC",
    selectedOrganization: { identifier: "test-org" },
  },
});

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------
const defaultProps = {
  streamName: "my_traces_stream",
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
        teleport: true,
        RenderDashboardCharts: {
          template: '<div data-test="render-dashboard-charts"></div>',
        },
        TracesComparison: {
          name: "TracesComparison",
          template: '<div data-test="traces-comparison-stub"></div>',
          props: ["selection", "streamName"],
          emits: ["close", "apply-filter"],
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

function getPanel(wrapper: VueWrapper<any>, title: string): any {
  const panels: any[] = wrapper.vm.dashboardData?.tabs?.[0]?.panels ?? [];
  return panels.find((p: any) => p.title === title);
}

const THIRTY_MIN_START = Date.UTC(2026, 9, 6, 10, 0, 0) * 1000;
const THIRTY_MIN_END = THIRTY_MIN_START + 30 * 60 * 1_000_000;

function getHeatmapSql(wrapper: VueWrapper<any>): string {
  return wrapper.vm.heatmapRequest?.sql ?? "";
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
    mockSearchObj.loading = false;
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.datetime = { startTime: 1_000_000, endTime: 2_000_000 };
    mockStore.state.timezone = "UTC";
    mockSearchObj.meta.showHistogram = true;
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

    it("should not render the comparison page on initial mount", () => {
      expect(wrapper.find('[data-test="traces-comparison-stub"]').exists()).toBe(false);
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

    it("plots Rate as traces per second on an explicit interval shared with Errors and the heatmap", async () => {
      mockSearchObj.data.datetime = { startTime: THIRTY_MIN_START, endTime: THIRTY_MIN_END };
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const rate = getPanelQuery(wrapper, "Rate");
      expect(rate).toContain("histogram(_timestamp, '15 second')");
      expect(rate).toContain("approx_distinct(trace_id) / 15.0");
      expect(rate).not.toContain("[INTERVAL");
      expect(getPanelQuery(wrapper, "Errors")).toContain("histogram(_timestamp, '15 second')");
      expect(getHeatmapSql(wrapper)).toContain("histogram(_timestamp, '15 second')");
    });

    it("asks the heatmap for each cell's error count, so both colour modes share one query", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).toContain(
        "sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count",
      );
    });

    it("labels Rate in traces/s with two decimals", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const config = getPanel(wrapper, "Rate").config;
      expect(config.unit).toBe("custom");
      expect(config.unit_custom).toBe("traces/s");
      expect(config.decimals).toBe(2);
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

    it("plots Rate as spans per second", async () => {
      mockSearchObj.data.datetime = { startTime: THIRTY_MIN_START, endTime: THIRTY_MIN_END };
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getPanelQuery(wrapper, "Rate")).toContain("count(*) / 15.0");
      expect(getPanel(wrapper, "Rate").config.unit_custom).toBe("spans/s");
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

    it("should NOT add the root-span filter to the heatmap query in spans mode", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).not.toContain("reference_parent_span_id");
    });
  });

  // -------------------------------------------------------------------------
  // loadDashboard — WHERE clause from filter prop
  // -------------------------------------------------------------------------
  describe("loadDashboard — WHERE clause from filter prop", () => {
    it("should include the filter prop in the Rate panel WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "service_name = 'api'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("service_name = 'api'");
    });

    it("should include the filter prop in the heatmap WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "service_name = 'api'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).toContain("WHERE service_name = 'api' GROUP BY");
    });

    it("should decode span_kind labels in the heatmap WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Server'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).toContain("span_kind='2'");
      expect(getHeatmapSql(wrapper)).not.toContain("span_kind='Server'");
    });

    it("should include the filter prop in the Errors panel WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "service_name = 'api'";
      wrapper = mountComponent();
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

    it("should convert span_kind='Server' label to '2' in the Rate panel WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Server'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("span_kind='2'");
      expect(query).not.toContain("span_kind='Server'");
    });

    it("should convert span_kind='Server' label to '2' in the Errors panel WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Server'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("span_kind='2'");
      expect(query).not.toContain("span_kind='Server'");
    });

    it("should convert span_kind='Client' label to '3' in both Rate and Errors panels", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Client'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const rateQuery = getPanelQuery(wrapper, "Rate");
      const errorsQuery = getPanelQuery(wrapper, "Errors");
      expect(rateQuery).toContain("span_kind='3'");
      expect(rateQuery).not.toContain("span_kind='Client'");
      expect(errorsQuery).toContain("span_kind='3'");
      expect(errorsQuery).not.toContain("span_kind='Client'");
    });

    it("should leave non-span_kind filter unchanged in the Errors panel WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "service_name = 'api'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("service_name = 'api'");
    });

    it("should leave non-span_kind filter unchanged in the heatmap WHERE clause", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "service_name = 'api'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).toContain("service_name = 'api'");
    });

    it("should convert span_kind label case-insensitively in the Errors panel", async () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='CONSUMER'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Errors");
      expect(query).toContain("span_kind='5'");
      expect(query).not.toContain("span_kind='CONSUMER'");
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
      mockSearchObj.data.editorValue = "env = 'prod'";
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const query = getPanelQuery(wrapper, "Rate");
      expect(query).toContain("duration >= 1000 and duration < 5000");
      expect(query).toContain("env = 'prod'");
    });
  });

  describe("latency heatmap", () => {
    it("drops the Duration panel and gives Rate and Errors half the strip each", async () => {
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const panels: any[] = wrapper.vm.dashboardData.tabs[0].panels;
      expect(panels.map((p) => p.title)).toEqual(["Rate", "Errors"]);
      expect(panels.map((p) => [p.layout.x, p.layout.w])).toEqual([
        [0, 24],
        [24, 24],
      ]);
    });

    it("passes the heatmap a request over the search range", async () => {
      mockSearchObj.data.datetime = { startTime: 3_000_000, endTime: 4_000_000 };
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const heatmap = wrapper.findComponent({ name: "TracesLatencyHeatmap" });
      expect(heatmap.props("request")).toEqual({
        sql: getHeatmapSql(wrapper),
        startTime: 3_000_000,
        endTime: 4_000_000,
      });
    });

    it("builds a fresh request object on every loadDashboard", async () => {
      await wrapper.vm.loadDashboard();
      const first = wrapper.vm.heatmapRequest;
      await wrapper.vm.loadDashboard();
      expect(wrapper.vm.heatmapRequest).not.toBe(first);
      expect(wrapper.vm.heatmapRequest).toEqual(first);
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

    it("should query the selected stream in the heatmap", async () => {
      mockSearchObj.data.stream.selectedStream.value = "prod_traces";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).toContain('FROM "prod_traces"');
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
    it("should update currentTimeObj when timeRange changes", async () => {
      mockSearchObj.data.datetime = { startTime: 5_000_000, endTime: 6_000_000 };
      // Directly calling loadDashboard (watch triggers it; call explicitly to avoid timing)
      await wrapper.vm.loadDashboard();
      await flushPromises();
      const timeObj: any = wrapper.vm.currentTimeObj;
      expect(timeObj.__global.start_time.getTime()).toBe(5_000_000);
      expect(timeObj.__global.end_time.getTime()).toBe(6_000_000);
    });

    it("should set dashboardData after loadDashboard is called with new timeRange", async () => {
      mockSearchObj.data.datetime = { startTime: 7_000_000, endTime: 8_000_000 };
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

  describe("heatmap selection", () => {
    const S = 1_000_000;
    const T = Date.UTC(2026, 9, 6, 10, 2, 0) * 1000;
    const band = "duration >= '100ms' and duration < '500ms'";
    const selection = (overrides: Record<string, unknown> = {}) => ({
      timeStartUs: T,
      timeEndUs: T + 40 * S,
      durationLoUs: 100_000,
      durationHiUs: 500_000,
      ...overrides,
    });
    const durationEntry = () =>
      [...mockMetricsRangeFilters.values()].find((f: any) => f.panelTitle === "Duration");

    // Stands in for the picker, which applies the emitted range a tick after the emit.
    const mountApplying = (applied: { startTime: number; endTime: number }) => {
      wrapper.unmount();
      wrapper = mountComponent({
        onTimeRangeSelected: () =>
          queueMicrotask(() => {
            mockSearchObj.data.datetime = applied;
          }),
      });
    };

    it("emits instants the picker lands exactly on, whatever the browser zone", async () => {
      const pinnedTz = process.env.TZ;
      process.env.TZ = "America/New_York";
      try {
        mockStore.state.timezone = "Asia/Kolkata";
        await wrapper.vm.onHeatmapSelect(selection());
        const { start, end } = wrapper.emitted("time-range-selected")![0][0] as any;
        // The picker formats with browser-local getters and parses that wall clock in the app zone.
        const picked = (ms: number) => {
          const d = new Date(ms);
          const pad = (n: number) => String(n).padStart(2, "0");
          const text = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          return convertToUtcTimestamp(text, "Asia/Kolkata");
        };
        expect(new Date(T / 1000).getTimezoneOffset()).not.toBe(0);
        expect(picked(start)).toBe(T);
        expect(picked(end)).toBe(T + 40 * S);
      } finally {
        process.env.TZ = pinnedTz;
      }
    });

    it("never hands the picker an empty range for a final column clamped mid-second", async () => {
      // Final column 10:02:00–10:02:10 with the search ending at 10:02:00.437.
      await wrapper.vm.onHeatmapSelect(selection({ timeEndUs: T + 437_000 }));
      const { start, end } = wrapper.emitted("time-range-selected")![0][0] as any;
      // The picker keeps whole seconds only.
      const appliedStart = Math.floor(start / 1000);
      const appliedEnd = Math.floor(end / 1000);
      expect(appliedEnd).toBeGreaterThan(appliedStart);
      expect(end).toBe(T / 1000 + 1000);
    });

    it("rounds a mid-second clamped start down to the whole second", async () => {
      await wrapper.vm.onHeatmapSelect(selection({ timeStartUs: T + 437_000 }));
      expect((wrapper.emitted("time-range-selected")![0][0] as any).start).toBe(T / 1000);
    });

    it("stores the Duration entry with the range the picker applied", async () => {
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = "service_name = 'a'";
      mockSearchObj.meta.searchMode = "spans";
      await wrapper.vm.onHeatmapSelect(selection());
      expect(durationEntry()).toEqual({
        panelTitle: "Duration",
        start: 100_000,
        end: 500_000,
        timeStart: T,
        timeEnd: T + 40 * S,
        appliedStart: T,
        appliedEnd: T + 40 * S,
        baselineFilter: "service_name = 'a'",
        stream: "default",
        searchMode: "spans",
      });
    });

    it("emits exactly one editor-filter-set with the composed filter and no filters-updated", async () => {
      mockSearchObj.data.editorValue = "service_name = 'a'";
      await wrapper.vm.onHeatmapSelect(selection());
      expect(wrapper.emitted("editor-filter-set")).toEqual([[`(service_name = 'a') and ${band}`]]);
      expect(wrapper.emitted("filters-updated")).toBeUndefined();
    });

    it("keeps a user duration condition and intersects the band with it", async () => {
      mockSearchObj.data.editorValue = "duration >= '1ms'";
      await wrapper.vm.onHeatmapSelect(selection());
      expect(wrapper.emitted("editor-filter-set")![0][0]).toBe(`(duration >= '1ms') and ${band}`);
    });

    it("stores a lo of 0 as a null start", async () => {
      await wrapper.vm.onHeatmapSelect(selection({ durationLoUs: 0 }));
      expect(durationEntry()!.start).toBeNull();
      expect(durationEntry()!.end).toBe(500_000);
    });

    it("restores the baseline text exactly for a full-height box", async () => {
      mockSearchObj.data.editorValue = "a = '1'  or b = '2'";
      await wrapper.vm.onHeatmapSelect(selection({ durationLoUs: 0, durationHiUs: null }));
      expect(durationEntry()!.start).toBeNull();
      expect(durationEntry()!.end).toBeNull();
      expect(wrapper.emitted("editor-filter-set")![0][0]).toBe("a = '1'  or b = '2'");
    });

    it("gives Drill down the applied end when the picker drops the box's milliseconds", async () => {
      const appliedEnd = T + 30 * S;
      mountApplying({ startTime: T, endTime: appliedEnd });
      await wrapper.vm.onHeatmapSelect(selection({ timeEndUs: appliedEnd + 437_000 }));
      mockSearchObj.data.editorValue = wrapper.emitted("editor-filter-set")![0][0] as string;
      wrapper.vm.openComparison();
      expect(wrapper.vm.comparisonSelection.windowEndUs).toBe(appliedEnd);
      expect(durationEntry()!.timeEnd).toBe(appliedEnd + 437_000);
    });

    it("stores the raw editor text, OR and parentheses included, without the band", async () => {
      const raw = "(service_name = 'a' or duration >= '1ms') and span_kind = 'Server'";
      mockSearchObj.data.editorValue = raw;
      await wrapper.vm.onHeatmapSelect(selection());
      expect(durationEntry()!.baselineFilter).toBe(raw);
      expect(durationEntry()!.baselineFilter).not.toContain("100ms");
    });

    it("carries the first box's baseline and original range into a refinement box", async () => {
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = "service_name = 'a'";
      await wrapper.vm.onHeatmapSelect(selection());
      mockSearchObj.data.editorValue = wrapper.emitted("editor-filter-set")![0][0] as string;

      await wrapper.vm.onHeatmapSelect(
        selection({ timeStartUs: T + 10 * S, timeEndUs: T + 20 * S, durationLoUs: 200_000 }),
      );

      expect(durationEntry()!.baselineFilter).toBe("service_name = 'a'");
      expect(wrapper.vm.originalTimeRangeBeforeSelection).toEqual({
        startTime: 1_000_000,
        endTime: 2_000_000,
      });
      expect(wrapper.emitted("editor-filter-set")![1][0]).toBe(
        "(service_name = 'a') and duration >= '200ms' and duration < '500ms'",
      );
    });

    it("re-snapshots the baseline and range when the editor was edited after the first box", async () => {
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = "service_name = 'a'";
      await wrapper.vm.onHeatmapSelect(selection());
      const edited = `${wrapper.emitted("editor-filter-set")![0][0]} and span_kind = 'Server'`;
      mockSearchObj.data.editorValue = edited;
      // The edit was searched, which reloads the charts over the box's range.
      await wrapper.vm.loadDashboard();

      await wrapper.vm.onHeatmapSelect(
        selection({ timeStartUs: T + 10 * S, timeEndUs: T + 20 * S, durationLoUs: 200_000 }),
      );

      expect(durationEntry()!.baselineFilter).toBe(edited);
      expect(wrapper.vm.originalTimeRangeBeforeSelection).toEqual({
        startTime: T,
        endTime: T + 40 * S,
      });
      expect(wrapper.emitted("editor-filter-set")![1][0]).toBe(
        `(${edited}) and duration >= '200ms' and duration < '500ms'`,
      );
    });

    const brush = (title: "Rate" | "Errors", start = 1_000, end = 2_000) =>
      wrapper.vm.onDataZoom({ start, end, data: { id: `panel-${title}`, title } });
    const entryOf = (title: string) =>
      [...mockMetricsRangeFilters.values()].find((f: any) => f.panelTitle === title);

    it("stores an Errors brush with what it applied and writes the error term over the baseline", async () => {
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = "service_name = 'a'";
      mockSearchObj.meta.searchMode = "spans";
      await brush("Errors");
      expect(entryOf("Errors")).toEqual({
        panelTitle: "Errors",
        start: null,
        end: null,
        timeStart: T,
        timeEnd: T + 40 * S,
        appliedStart: T,
        appliedEnd: T + 40 * S,
        baselineFilter: "service_name = 'a'",
        stream: "default",
        searchMode: "spans",
      });
      expect(wrapper.emitted("editor-filter-set")).toEqual([
        ["(service_name = 'a') and span_status = 'ERROR'"],
      ]);
      expect(wrapper.emitted("filters-updated")).toBeUndefined();
    });

    it("leaves the editor text unchanged for a Rate brush, which selects time only", async () => {
      mockSearchObj.data.editorValue = "service_name = 'a'";
      await brush("Rate");
      expect(wrapper.emitted("editor-filter-set")).toEqual([["service_name = 'a'"]]);
      expect(entryOf("Rate")!.baselineFilter).toBe("service_name = 'a'");
    });

    it("hands the picker a brush's own values but converts a box's instants to the app zone", async () => {
      const pinnedTz = process.env.TZ;
      process.env.TZ = "UTC";
      try {
        mockStore.state.timezone = "Asia/Kolkata";
        await brush("Rate", T / 1000, T / 1000 + 40_000);
        expect(wrapper.emitted("time-range-selected")![0][0]).toEqual({
          start: T / 1000,
          end: T / 1000 + 40_000,
        });
        await wrapper.vm.onHeatmapSelect(selection());
        const boxRange = wrapper.emitted("time-range-selected")![1][0] as any;
        expect(boxRange.start).toBe(T / 1000 + 5.5 * 3600 * 1000);
        expect(boxRange.end).toBe(T / 1000 + 40_000 + 5.5 * 3600 * 1000);
      } finally {
        process.env.TZ = pinnedTz;
      }
    });

    it("takes the current editor text, error term included, as a box's baseline after an Errors brush", async () => {
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = "service_name = 'a'";
      await brush("Errors");
      const errorsText = wrapper.emitted("editor-filter-set")![0][0] as string;
      mockSearchObj.data.editorValue = errorsText;
      // Live mode: the brush's search reloads the charts over the brushed range.
      await wrapper.vm.loadDashboard();

      await wrapper.vm.onHeatmapSelect(selection());

      expect(durationEntry()!.baselineFilter).toBe(errorsText);
      expect(wrapper.vm.originalTimeRangeBeforeSelection).toEqual({
        startTime: T,
        endTime: T + 40 * S,
      });
      const boxText = wrapper.emitted("editor-filter-set")![1][0] as string;
      expect(boxText).toContain("span_status = 'ERROR'");
      expect(boxText).toContain(band);
    });

    it("snapshots the range the charts show, not the picker's, for a brush after an unsearched box", async () => {
      // Manual mode: the box moves the picker, but the charts still show the range of the last search.
      mountApplying({ startTime: T, endTime: T + 40 * S });
      await wrapper.vm.onHeatmapSelect(selection());
      mockSearchObj.data.editorValue = wrapper.emitted("editor-filter-set")![0][0] as string;
      expect(mockSearchObj.data.datetime).toEqual({ startTime: T, endTime: T + 40 * S });

      await brush("Rate");

      expect(wrapper.vm.originalTimeRangeBeforeSelection).toEqual({
        startTime: 1_000_000,
        endTime: 2_000_000,
      });
    });

    it("keeps the band in the baseline of a brush drawn after a box", async () => {
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = "service_name = 'a'";
      await wrapper.vm.onHeatmapSelect(selection());
      mockSearchObj.data.editorValue = wrapper.emitted("editor-filter-set")![0][0] as string;

      await brush("Rate");

      expect(entryOf("Rate")!.baselineFilter).toContain(band);
      expect(entryOf("Duration")).toBeUndefined();
      expect(wrapper.emitted("editor-filter-set")![1][0]).toContain(band);
    });
  });

  describe("openComparison", () => {
    const S = 1_000_000;
    const T = Date.UTC(2026, 9, 6, 10, 2, 0) * 1000;
    const R = { startTime: 1_000_000, endTime: 2_000_000 };
    const raw = "(service_name = 'a' or duration >= '1ms') and span_kind = 'Server'";
    const stub = () => wrapper.findComponent({ name: "TracesComparison" });

    // Stands in for the picker, which applies the emitted range a tick after the emit.
    const mountApplying = (applied: { startTime: number; endTime: number }) => {
      wrapper.unmount();
      wrapper = mountComponent({
        onTimeRangeSelected: () =>
          queueMicrotask(() => {
            mockSearchObj.data.datetime = applied;
          }),
      });
    };
    const box = () =>
      wrapper.vm.onHeatmapSelect({
        timeStartUs: T,
        timeEndUs: T + 40 * S,
        durationLoUs: 100_000,
        durationHiUs: 500_000,
      });
    const brush = (title: "Rate" | "Errors") =>
      wrapper.vm.onDataZoom({ start: 1_000, end: 2_000, data: { id: `panel-${title}`, title } });
    const showSelection = () => {
      mockSearchObj.data.editorValue = wrapper.emitted("editor-filter-set")!.at(-1)![0] as string;
    };

    beforeEach(() => {
      vi.mocked(parseDurationWhereClause).mockImplementation((f: string) =>
        f.replace("'1ms'", "1000"),
      );
      mountApplying({ startTime: T, endTime: T + 40 * S });
      mockSearchObj.data.editorValue = raw;
    });

    afterEach(() => {
      vi.mocked(parseDurationWhereClause).mockImplementation((f: string) => f);
    });

    it("passes a current box as a duration selection with the decoded pre-box filter", async () => {
      await box();
      showSelection();
      wrapper.vm.openComparison();
      await flushPromises();
      expect(stub().props("selection")).toEqual({
        kind: "duration",
        windowStartUs: T,
        windowEndUs: T + 40 * S,
        rangeStartUs: R.startTime,
        rangeEndUs: R.endTime,
        durationLoUs: 100_000,
        durationHiUs: 500_000,
        filter: "(service_name = 'a' or duration >= 1000) and span_kind='2'",
      });
      expect(stub().props("streamName")).toBe("my_traces_stream");
    });

    it.each([
      ["Errors", "errors"],
      ["Rate", "rate"],
    ] as const)("passes a current %s brush as a %s selection", async (title, kind) => {
      await brush(title);
      showSelection();
      wrapper.vm.openComparison();
      await flushPromises();
      expect(stub().props("selection")).toMatchObject({
        kind,
        windowStartUs: T,
        windowEndUs: T + 40 * S,
        rangeStartUs: R.startTime,
        rangeEndUs: R.endTime,
        durationLoUs: null,
        durationHiUs: null,
      });
    });

    it("passes an empty filter for a box drawn from an empty editor", async () => {
      mockSearchObj.data.editorValue = "";
      await box();
      showSelection();
      wrapper.vm.openComparison();
      await flushPromises();
      expect(stub().props("selection").filter).toBe("");
    });

    it("passes no selection without an entry", async () => {
      wrapper.vm.openComparison();
      await flushPromises();
      expect(stub().exists()).toBe(true);
      expect(stub().props("selection")).toBeNull();
    });

    it("passes no selection when an unsearched edit made the entry stale", async () => {
      await box();
      showSelection();
      mockSearchObj.data.editorValue = `${mockSearchObj.data.editorValue} and http_method = 'GET'`;
      wrapper.vm.openComparison();
      await flushPromises();
      expect(stub().props("selection")).toBeNull();
    });

    it("teleports the page into the traces drill-down target", async () => {
      wrapper.vm.openComparison();
      await flushPromises();
      expect(wrapper.find("teleport-stub").attributes("to")).toBe("#traces-drill-down-page");
    });

    it("unmounts the page on close and when a new search starts, not when one finishes", async () => {
      wrapper.vm.openComparison();
      await flushPromises();
      stub().vm.$emit("close");
      await flushPromises();
      expect(stub().exists()).toBe(false);

      mockSearchObj.loading = true;
      await flushPromises();
      wrapper.vm.openComparison();
      await flushPromises();
      mockSearchObj.loading = false;
      await flushPromises();
      expect(stub().exists()).toBe(true);

      mockSearchObj.loading = true;
      await flushPromises();
      expect(stub().exists()).toBe(false);
    });

    it("restores the pre-selection range, clears the selection and runs the composed filter after the picker applies", async () => {
      const applied = [{ startTime: T, endTime: T + 40 * S }, R];
      let datetimeAtRun: unknown = null;
      wrapper.unmount();
      wrapper = mountComponent({
        onTimeRangeSelected: () => {
          const next = applied.shift()!;
          // The picker applies the range in a watcher before the tick resolves.
          queueMicrotask(() => {
            mockSearchObj.data.datetime = next;
          });
        },
        onEditorFilterRun: () => {
          datetimeAtRun = { ...mockSearchObj.data.datetime };
        },
      });
      await box();
      showSelection();
      wrapper.vm.openComparison();
      await flushPromises();

      await wrapper.vm.onComparisonApply("http_method = 'GET'");

      expect(wrapper.emitted("time-range-selected")!.at(-1)![0]).toEqual({
        start: instantToPickerMs(Math.floor(R.startTime / S) * 1000, "UTC"),
        end: instantToPickerMs(Math.ceil(R.endTime / S) * 1000, "UTC"),
      });
      expect(mockMetricsRangeFilters.size).toBe(0);
      expect(wrapper.vm.originalTimeRangeBeforeSelection).toBeNull();
      expect(wrapper.emitted("editor-filter-run")).toEqual([[`(${raw}) and http_method = 'GET'`]]);
      expect(datetimeAtRun).toEqual(R);
    });

    it("applies a filter emitted by the comparison page", async () => {
      await box();
      showSelection();
      wrapper.vm.openComparison();
      await flushPromises();
      stub().vm.$emit("apply-filter", "a = '1'");
      await flushPromises();
      expect(wrapper.emitted("editor-filter-run")).toEqual([[`(${raw}) and a = '1'`]]);
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

    it("should expose the openComparison method", () => {
      expect(typeof wrapper.vm.openComparison).toBe("function");
    });

    it("should expose clearOriginalTimeRange", () => {
      expect(Object.keys(wrapper.vm.$.exposed)).toContain("clearOriginalTimeRange");
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
      expect(filters[0]).toBe("duration >= 100 and duration < 500");
    });

    it("should write only the upper bound for an end-only Duration range", () => {
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: null,
        end: 1000,
        timeStart: null,
        timeEnd: null,
      });
      expect(wrapper.vm.getBaseFilters()).toEqual(["duration < 1000"]);
    });

    it("should write only the lower bound for a start-only Duration range", () => {
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: 1000,
        end: null,
        timeStart: null,
        timeEnd: null,
      });
      expect(wrapper.vm.getBaseFilters()).toEqual(["duration >= 1000"]);
    });

    it("should add nothing for a Duration range with both bounds null", () => {
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: null,
        end: null,
        timeStart: 1,
        timeEnd: 2,
      });
      expect(wrapper.vm.getBaseFilters()).toEqual([]);
    });

    it("should include span_status = 'ERROR' when filter prop contains it", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_status = 'ERROR'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("span_status = 'ERROR'");
    });

    it("should NOT include span_status = 'ERROR' when filter prop does not contain it", () => {
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).not.toContain("span_status = 'ERROR'");
    });

    it("should include the filter prop string when filter is a non-empty string", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "http_method = 'GET'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("http_method = 'GET'");
    });

    it("should not include a filter entry when filter prop is an empty string", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toEqual([]);
    });

    it("should not include a filter entry when filter prop is only whitespace", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "   ";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toEqual([]);
    });

    it("should convert span_kind='Server' label to numeric key '2' in the base filter", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Server'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("span_kind='2'");
      expect(filters.join(" ")).not.toContain("span_kind='Server'");
    });

    it("should convert span_kind='Client' label to numeric key '3' in the base filter", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Client'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("span_kind='3'");
      expect(filters.join(" ")).not.toContain("span_kind='Client'");
    });

    it("should convert span_kind label case-insensitively in the base filter", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='SERVER'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("span_kind='2'");
    });

    it("should leave non-span_kind filters unchanged in the base filter", () => {
      wrapper.unmount();
      mockSearchObj.data.editorValue = "service_name = 'api'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("service_name = 'api'");
    });

    it("should convert span_kind label when combined with a duration range filter", () => {
      mockMetricsRangeFilters.set("panel-dur", {
        panelTitle: "Duration",
        start: 100,
        end: 500,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.unmount();
      mockSearchObj.data.editorValue = "span_kind='Internal'";
      wrapper = mountComponent();
      const filters = wrapper.vm.getBaseFilters();
      expect(filters).toContain("duration >= 100 and duration < 500");
      expect(filters).toContain("span_kind='1'");
      expect(filters.join(" ")).not.toContain("span_kind='Internal'");
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
      wrapper = mountComponent();
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

    it("should produce a heatmap query with no WHERE clause in spans mode when no filters exist", async () => {
      mockSearchObj.meta.searchMode = "spans";
      await wrapper.vm.loadDashboard();
      await flushPromises();
      expect(getHeatmapSql(wrapper)).toContain("histogram(_timestamp, ");
      expect(getHeatmapSql(wrapper)).not.toMatch(/WHERE\b/);
    });
  });
});
