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

import { describe, expect, it, beforeEach, vi, afterEach, Mock } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import Index from "@/plugins/logs/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
vi.mock("@/stores", async () => {
  const { default: store } = await import("@/test/unit/helpers/store");
  return { default: store };
});
import { createRouter, createMemoryHistory } from "vue-router";

// A light in-memory router: the app router lazy-loads real pages on navigation.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div />" } },
    { path: "/logs", name: "logs", component: { template: "<div />" } },
  ],
});
import { getFieldsFromQuery } from "@/utils/query/sqlUtils";
import searchService from "@/services/search";
import {
  activePermalink,
  permalinkBanner,
  resetPermalinkForTests,
  sharedLineRecord,
} from "@/composables/useLogs/useLogPermalink";
import { resetLogsUrlForTests, sharedPage } from "@/composables/useLogs/useLogsUrl";

Object.defineProperty(global, "CSS", {
  value: {
    supports: () => false,
    escape: () => "",
  },
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

vi.mock("@/utils/query/sqlUtils", () => ({
  buildSqlQuery: vi.fn(),
  getFieldsFromQuery: vi.fn(),
  isSimpleSelectAllQuery: vi.fn((query) => {
    if (!query || typeof query !== "string") return false;
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    const selectAllPattern = /^select\s+\*\s+from\s+/i;
    return selectAllPattern.test(normalizedQuery);
  }),
}));
vi.mock("@/composables/useDashboardPanelData", () => ({
  default: () => ({
    dashboardPanelData: {
      data: {
        version: 5,
        queries: [
          {
            fields: {
              stream_type: "",
              stream: "",
              x: [],
              y: [],
              z: [],
              breakdown: [],
              filter: [],
              latitude: null,
              longitude: null,
              weight: null,
              name: null,
              value_for_maps: null,
            },
          },
        ],
        id: "",
        type: "bar",
        title: "",
        description: "",
        config: {
          trellis: {
            layout: null,
            num_of_columns: 1,
            group_by_y_axis: false,
          },
          show_legends: true,
          legends_position: null,
          unit: null,
          unit_custom: null,
          decimals: 2,
          line_thickness: 1.5,
          step_value: "0",
          y_axis_min: null,
          y_axis_max: null,
          top_results: null,
          top_results_others: false,
          axis_width: null,
          axis_border_show: false,
          label_option: {
            position: null,
            rotate: 0,
          },
          show_symbol: true,
          line_interpolation: "smooth",
          legend_width: {
            value: null,
            unit: "px",
          },
          base_map: {
            type: "osm",
          },
          map_type: {
            type: "world",
          },
          map_view: {
            zoom: 1,
            lat: 0,
            lng: 0,
          },
          map_symbol_style: {
            size: "by Value",
            size_by_value: {
              min: 1,
              max: 100,
            },
            size_fixed: 2,
          },
          drilldown: [],
          mark_line: [],
          override_config: [],
          connect_nulls: false,
          no_value_replacement: "",
          wrap_table_cells: false,
          table_transpose: false,
          table_dynamic_columns: false,
          color: {
            mode: "palette-classic-by-series",
            fixedColor: ["#53ca53"],
            seriesBy: "last",
          },
          background: null,
        },
        htmlContent: "",
        markdownContent: "",
        customChartContent: ` // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
      `,
        customChartResult: {},
        queryType: "sql",
      },
      layout: {
        splitter: 20,
        querySplitter: 41,
        showQueryBar: false,
        isConfigPanelOpen: false,
        currentQueryIndex: 0,
        vrlFunctionToggle: false,
        showFieldList: true,
      },
      meta: {
        parsedQuery: "",
        dragAndDrop: {
          dragging: false,
          dragElement: null,
          dragSource: null,
          dragSourceIndex: null,
          currentDragArea: null,
          targetDragIndex: null,
        },
        errors: {
          queryErrors: [],
        },
        editorValue: "",
        dateTime: { start_time: "", end_time: "" },
        filterValue: <any>[],
        stream: {
          hasUserDefinedSchemas: false,
          interestingFieldList: [],
          userDefinedSchema: [],
          vrlFunctionFieldList: [],
          selectedStreamFields: [],
          useUserDefinedSchemas: "user_defined_schema",
          customQueryFields: [],
          functions: [],
          streamResults: <any>[],
          streamResultsType: "",
          filterField: "",
        },
      },
    },
    validatePanel: vi.fn(),
    generateLabelFromName: (name: string) => name,
    resetDashboardPanelData: vi.fn(),
  }),
}));
const loaderCalls = vi.hoisted(() => [] as string[]);
// Each page-load run's promise, so a test waits for the load itself instead of wall time.
const loadRuns = vi.hoisted(() => [] as Promise<unknown>[]);
// The grid executor's call into the search, so a test can see the origin it hands down without a network search.
const gridRuns = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/composables/useLogs", async () => {
  const actual =
    await vi.importActual<typeof import("@/composables/useLogs")>("@/composables/useLogs");

  return {
    ...actual,
    default: (...args: Parameters<typeof actual.default>) => {
      const api = actual.default(...args);
      return {
        ...api,
        loadLogsData: (...loadArgs: Parameters<typeof api.loadLogsData>) => {
          loaderCalls.push("logs");
          const run = api.loadLogsData(...loadArgs);
          loadRuns.push(run);
          return run;
        },
        runGridSearch: (...gridArgs: unknown[]) => {
          gridRuns.push(gridArgs);
          return Promise.resolve();
        },
        loadVisualizeData: () => {
          loaderCalls.push("visualize");
          return api.loadVisualizeData();
        },
      };
    },
    clearSearchObj: vi.fn(),
  };
});

vi.mock("@/composables/useLogs/usePatterns", () => ({
  default: () => ({
    extractPatterns: vi.fn().mockResolvedValue(undefined),
    patternsState: { value: { patterns: null, loading: false, error: null, lastQuery: null } },
  }),
  patternsState: { value: { patterns: null, loading: false, error: null, lastQuery: null } },
}));

// Drill down page content — stubbed so the tests assert what Index passes it.
vi.mock("@/plugins/traces/metrics/TracesAnalysisDashboard.vue", () => ({
  __esModule: true,
  default: {
    name: "TracesAnalysisDashboard",
    props: {
      embedded: Boolean,
      streamName: null,
      streamType: null,
      timeRange: null,
      rateFilter: null,
      baseFilter: null,
      streamFields: null,
      logSamples: null,
      analysisType: null,
      availableAnalysisTypes: null,
    },
    template: '<div data-test="drill-down-dashboard-stub" />',
  },
}));

// Item 2 landing flows need a stream list; the list API is replaced by a fixed, readable set.
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async () => ({
      list: [{ name: "k8s_json", stream_type: "logs", stats: { doc_time_max: 0 }, schema: [] }],
    })),
    getStream: vi.fn(async () => ({ name: "k8s_json", schema: [{ name: "_timestamp" }] })),
    isStreamExists: vi.fn(() => true),
    isStreamFetched: vi.fn(() => true),
    getMultiStreams: vi.fn(async () => []),
  }),
}));

const TS = Date.now() * 1000 - 60e6;
const line = { _timestamp: TS, level: "error", message: "payment declined" };

describe("Logs Index — opening a line link (4c C5)", { timeout: 30000 }, () => {
  let wrapper: any;
  const org = store.state.selectedOrganization.identifier;
  const originalZoConfig = { ...store.state.zoConfig };

  const land = async (
    query: Record<string, string>,
    zoConfig: Record<string, unknown> = {},
    options: { realExecutor?: boolean } = {},
  ) => {
    store.state.zoConfig = {
      ...originalZoConfig,
      auto_query_enabled: true,
      query_on_stream_selection: true,
      ...zoConfig,
    };
    (store.state as any).logs = { isInitialized: false, logs: {} };
    vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
    (getFieldsFromQuery as Mock).mockResolvedValue({ fields: [], filters: [], streamName: "" });
    await router.replace({ name: "logs", query: { org_identifier: org, ...query } });
    loadRuns.length = 0;
    wrapper = mount(Index, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    const logs = vi.fn();
    if (!options.realExecutor) wrapper.vm.autoRun.setExecutors({ logs });
    await vi.waitFor(() => expect(loadRuns.length).toBeGreaterThan(0), { timeout: 10000 });
    await Promise.allSettled(loadRuns);
    // A line link's absolute window makes the picker emit a typed-time refinement with its 2.5 s debounce.
    await vi.waitFor(() => expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false), {
      timeout: 6000,
    });
    await flushPromises();
    return logs;
  };

  const linkQuery = (extra: Record<string, string> = {}) => ({
    stream: "k8s_json",
    stream_type: "logs",
    from: String(TS - 600e6),
    to: String(TS + 1),
    log_stream: "k8s_json",
    log_ts: String(TS),
    ...extra,
  });

  beforeEach(() => {
    localStorage.clear();
    resetPermalinkForTests();
    resetLogsUrlForTests();
  });

  afterEach(async () => {
    wrapper?.unmount();
    store.state.zoConfig = originalZoConfig;
    vi.restoreAllMocks();
    localStorage.clear();
    await router.replace({ path: router.currentRoute.value.path, query: {} });
  });

  it("resolves the line over its 1 µs window while the initial run carries the permalink-init origin (C4, C5 step 6)", async () => {
    const search = vi
      .spyOn(searchService, "search")
      .mockResolvedValue({ status: 200, data: { hits: [line], is_partial: false } } as any);
    const logs = await land(linkQuery());
    await vi.waitFor(() => expect(permalinkBanner.value?.state).toBe("found"));
    const [options, searchType, , useCache] = search.mock.calls[0] as any[];
    expect(options.query.query).toMatchObject({ start_time: TS, end_time: TS + 1 });
    expect([searchType, useCache]).toEqual(["other", false]);
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls[0][0].origin).toMatch(/^permalink-init:/);
    expect(sharedLineRecord.value).toEqual(line);
    expect(router.currentRoute.value.query.log_ts).toBe(String(TS));
  });

  it("the page's grid executor hands the init origin to the search it runs (C5 step 6)", async () => {
    vi.spyOn(searchService, "search").mockResolvedValue({
      status: 200,
      data: { hits: [line], is_partial: false },
    } as any);
    gridRuns.length = 0;
    await land(linkQuery(), {}, { realExecutor: true });
    await vi.waitFor(() => expect(gridRuns.length).toBeGreaterThan(0));
    expect(gridRuns[0][2]).toMatch(/^permalink-init:/);
  });

  it("over a guard-blocked URL load the drawer still opens, and Run anyway keeps the init origin (CROSS-SPEC row 10)", async () => {
    localStorage.setItem("oo_toggle_auto_run", "false");
    vi.spyOn(searchService, "search").mockResolvedValue({
      status: 200,
      data: { hits: [line], is_partial: false },
    } as any);
    const logs = await land(linkQuery(), { auto_query_max_scan_mb: 1 });
    wrapper.vm.searchObj.data.streamResults.list[0].stats = {
      doc_time_min: TS - 3600e6 * 48,
      doc_time_max: TS,
      storage_size: 4800,
    };
    const origin = logs.mock.calls[0]?.[0]?.origin;
    wrapper.vm.autoRun.engine.resetScope("url");
    wrapper.vm.autoRun.request("url", { origin });
    await vi.waitFor(() => expect(wrapper.vm.searchObj.meta.autoRunBlocked).not.toBeNull());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="logs-permalink-detail-dialog"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-test="log-detail-json-content"]')?.textContent).toContain(
      "payment declined",
    );
    logs.mockClear();
    wrapper.vm.onGuardRunAnyway();
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls[0][0].origin).toBe(origin);
    expect(activePermalink.value).not.toBeNull();
  });

  it("Narrow to is a user scope change: its run carries no init origin", async () => {
    vi.spyOn(searchService, "search").mockResolvedValue({
      status: 200,
      data: { hits: [line], is_partial: false },
    } as any);
    const logs = await land(linkQuery(), { auto_query_max_scan_mb: 5 });
    logs.mockClear();
    wrapper.vm.onGuardNarrow("1m");
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls[0][0].origin).toBeUndefined();
  });

  it("Show these lines runs [log_ts, log_ts+1) and keeps it through the picker's echo (J-C15)", async () => {
    vi.spyOn(searchService, "search").mockResolvedValue({
      status: 200,
      data: { hits: [line], is_partial: true },
    } as any);
    const ts = Math.floor(TS / 1e6) * 1e6 + 777;
    const logs = await land(linkQuery({ log_ts: String(ts) }));
    await vi.waitFor(() => expect(permalinkBanner.value?.state).toBe("incomplete"));
    logs.mockClear();
    const datetimeAtRun: unknown[] = [];
    logs.mockImplementation(() => {
      const { startTime, endTime } = wrapper.vm.searchObj.data.datetime;
      datetimeAtRun.push([startTime, endTime]);
    });
    wrapper.vm.onPermalinkShowLines(ts);
    await vi.waitFor(() => expect(logs).toHaveBeenCalledTimes(1));
    expect(logs.mock.calls[0][0].origin).toBeUndefined();
    await vi.waitFor(() => expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false), {
      timeout: 6000,
    });
    await flushPromises();
    expect(datetimeAtRun).toEqual([[ts, ts + 1]]);
    const { startTime, endTime, type } = wrapper.vm.searchObj.data.datetime;
    expect([startTime, endTime, type]).toEqual([ts, ts + 1, "absolute"]);
    expect(logs).toHaveBeenCalledTimes(1);
    expect(activePermalink.value).toBeNull();
  });

  it("a link for another org resolves nothing in the current one (J-C20)", async () => {
    const search = vi.spyOn(searchService, "search");
    await land({ ...linkQuery(), org_identifier: "some_other_org" });
    expect(search).not.toHaveBeenCalled();
    expect(activePermalink.value).toBeNull();
    expect(permalinkBanner.value).toBeNull();
  });

  it("a shared page waits for the notice; with auto-refresh on it is ignored (J-C21)", async () => {
    await land({ stream: "k8s_json", stream_type: "logs", period: "15m", page: "3" });
    expect(sharedPage.value).toBe(3);
    expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(1);
    wrapper.unmount();
    wrapper = null;
    await land({ stream: "k8s_json", stream_type: "logs", period: "15m", page: "3", refresh: "5" });
    expect(sharedPage.value).toBeNull();
  });

  it("leaving Logs drops the permalink, its banner and the page notice (J-C18)", async () => {
    vi.spyOn(searchService, "search").mockResolvedValue({
      status: 200,
      data: { hits: [line], is_partial: false },
    } as any);
    await land(linkQuery());
    await vi.waitFor(() => expect(permalinkBanner.value?.state).toBe("found"));
    wrapper.unmount();
    wrapper = null;
    expect(activePermalink.value).toBeNull();
    expect(permalinkBanner.value).toBeNull();
    expect(sharedLineRecord.value).toBeNull();
  });
});
