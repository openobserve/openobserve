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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, KeepAlive, reactive, ref } from "vue";
import { clearAnnouncements } from "@/lib/feedback/RegionStatus/announcer";
import SearchResult from "@/plugins/traces/SearchResult.vue";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

const mockStore = createStore({
  state: {
    theme: "light",
    API_ENDPOINT: "http://localhost:8080",
    timezone: "UTC",
    selectedOrganization: {
      identifier: "test-org",
    },
  },
});

const mockSearchObj = reactive({
  data: {
    queryResults: {
      hits: [
        {
          trace_id: "trace-1",
          trace_start_time: 1000000000,
          trace_end_time: 1000000100,
          service_name: "test-service-1",
          operation_name: "test-operation-1",
          duration: 100,
          spans: 5,
          errors: 0,
        },
        {
          trace_id: "trace-2",
          trace_start_time: 1000000200,
          trace_end_time: 1000000250,
          service_name: "test-service-2",
          operation_name: "test-operation-2",
          duration: 50,
          spans: 3,
          errors: 1,
        },
      ],
      from: 0,
      total: 2,
    },
    histogram: {
      data: [
        {
          x: [1000000000, 1000000100, 1000000200],
          y: [1, 1, 1],
          type: "scatter",
          mode: "markers",
        },
      ],
      layout: {
        title: "Trace Distribution",
        xaxis: { title: "Time" },
        yaxis: { title: "Count" },
      },
    },
    resultGrid: {
      columns: [
        { name: "service_name", label: "Service Name" },
        { name: "operation_name", label: "Operation Name" },
      ],
      currentPage: 1,
    },
    stream: {
      selectedFields: ["service_name", "operation_name"],
      addToFilter: "",
      selectedStream: {
        label: "default",
        value: "default",
      },
    },
    datetime: {
      startTime: 1000000000,
      endTime: 1000000200,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    searchAround: {
      indexTimestamp: null,
    },
    traceDetails: {
      showSpanDetails: false,
      selectedSpanId: null,
    },
    errorMsg: "",
    editorValue: "",
  },
  meta: {
    showDetailTab: false,
    showTraceDetails: false,
    showHistogram: true,
    resultGrid: {
      rowsPerPage: 10,
      // Mirrors `useTraces`, which seeds this false. Omitting it made the
      // wrap binding start `undefined` and hid the reactivity problem below.
      wrapCells: false,
      navigation: {
        currentRowIndex: 0 as number | null,
        selectionActive: false,
        pendingPageSelection: null as any,
        lastOpenedId: null as string | null,
      },
    },
  },
  loading: false,
  searchApplied: true,
  organizationIdentifier: "test-org",
});

const { mockPatchUrlViewState, mockTracesParser } = vi.hoisted(() => ({
  mockPatchUrlViewState: vi.fn(() => Promise.resolve()),
  mockTracesParser: { value: null as unknown },
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    updatedLocalLogFilterField: vi.fn(),
    patchUrlViewState: mockPatchUrlViewState,
    tracesParser: mockTracesParser,
  }),
}));

vi.mock("./metrics/TracesMetricsDashboard.vue", () => ({
  default: {
    name: "TracesMetricsDashboard",
    template: '<div data-test="red-dashboard-loaded"></div>',
  },
}));

vi.mock("@/utils/traces/convertTraceData", () => ({
  convertTraceData: vi.fn(),
}));

const globalOptions = {
  plugins: [i18n, router],
  provide: {
    store: mockStore,
  },
  stubs: {
    TracesSearchResultList: {
      name: "TracesSearchResultList",
      template: '<div data-test="traces-search-result-list" class="search-list w-full"></div>',
      props: [
        "hits",
        "loading",
        "searchPerformed",
        "showHeader",
        "wrap",
        "showPagination",
        "columnVisibility",
      ],
      emits: ["row-click", "load-more"],
    },
    TracesGroupsTable: {
      name: "TracesGroupsTable",
      template: '<div data-test="traces-groups-stub"></div>',
      props: ["request", "sort", "columns", "columnVisibility", "wrap"],
      emits: ["update:sort"],
    },
    TracesSqlResultTable: {
      name: "TracesSqlResultTable",
      template: '<div data-test="traces-sql-result"></div>',
      props: ["hits", "columns", "shape", "loading", "wrap", "offerAddTraceId", "traceHref"],
      emits: ["open-trace", "add-trace-id"],
    },
    TracesMetricsDashboard: {
      template: '<div data-test="traces-metrics-dashboard"></div>',
      props: ["streamName", "timeRange", "filter", "show", "aiEnabled"],
      methods: {
        loadDashboard: vi.fn(),
      },
    },
  },
};

describe("SearchResult", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
  });

  // A long operation name is often the widest thing on a trace or span row,
  // and clipping it hides exactly the part that tells two entries apart. The
  // logs table has this affordance; traces and spans need it too.
  describe("wrap toggle", () => {
    it("renders a wrap button", () => {
      expect(wrapper.find('[data-test="traces-search-result-wrap-btn"]').exists()).toBe(true);
    });

    it("toggles the shared wrap flag and passes it to the list", async () => {
      const before = mockSearchObj.meta.resultGrid.wrapCells;

      await wrapper.find('[data-test="traces-search-result-wrap-btn"]').trigger("click");
      expect(mockSearchObj.meta.resultGrid.wrapCells).toBe(!before);

      const list = wrapper.findComponent({ name: "TracesSearchResultList" });
      expect(list.props("wrap")).toBe(!before);

      await wrapper.find('[data-test="traces-search-result-wrap-btn"]').trigger("click");
      expect(mockSearchObj.meta.resultGrid.wrapCells).toBe(before);
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Columns button", () => {
    const columns = [
      { id: "_timestamp", header: "Timestamp" },
      { id: "service_name", header: "Service", hideable: true },
      { id: "duration", header: "Duration", hideable: true },
    ];
    const toggle = () => wrapper.findComponent({ name: "OTableColumnToggle" });
    const badge = () => wrapper.find('[data-test="o2-table-column-toggle-hidden-badge"]');

    beforeEach(async () => {
      localStorage.clear();
      mockSearchObj.meta.searchMode = "spans";
      mockSearchObj.data.resultGrid.columns = columns as any;
      wrapper.unmount();
      wrapper = mount(SearchResult, { global: globalOptions });
      await flushPromises();
    });

    afterEach(() => {
      mockSearchObj.meta.searchMode = undefined;
      localStorage.clear();
    });

    it("sits after Wrap and lists the table's columns", () => {
      const wrap = wrapper.find('[data-test="traces-search-result-wrap-btn"]').element;
      const button = wrapper.find('[data-test="o2-table-column-toggle-btn"]').element;
      expect(wrap.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(toggle().props("columns")).toEqual(columns);
    });

    it("hides a column in the list and counts it on the badge", async () => {
      expect(badge().exists()).toBe(false);
      toggle().vm.$emit("update:columnVisibility", { service_name: false });
      await flushPromises();
      const list = wrapper.findComponent({ name: "TracesSearchResultList" });
      expect(list.props("columnVisibility")).toEqual({ service_name: false });
      expect(badge().text()).toBe("1");
    });

    it("keeps each view's hidden columns apart, and across a remount", async () => {
      toggle().vm.$emit("update:columnVisibility", { service_name: false });
      await flushPromises();
      mockSearchObj.meta.searchMode = "traces";
      await flushPromises();
      expect(toggle().props("columnVisibility")).toEqual({});

      mockSearchObj.meta.searchMode = "spans";
      wrapper.unmount();
      wrapper = mount(SearchResult, { global: globalOptions });
      await flushPromises();
      expect(toggle().props("columnVisibility")).toEqual({ service_name: false });
    });
  });

  describe("Groups view", () => {
    const request = {
      stream: "default",
      key: "service_name",
      filter: "",
      scope: "",
      startTime: 1,
      endTime: 2,
      runId: 1,
    };
    const groups = () => wrapper.findComponent({ name: "TracesGroupsTable" });
    const toggle = () => wrapper.findComponent({ name: "OTableColumnToggle" });

    beforeEach(async () => {
      localStorage.clear();
      mockSearchObj.meta.searchMode = "spans";
      (mockSearchObj.meta as any).groupsSort = { by: "errors", order: "desc" };
      (mockSearchObj.meta.resultGrid as any).showPagination = true;
      (mockSearchObj.data as any).groupsRequest = request;
      wrapper.unmount();
      wrapper = mount(SearchResult, { global: globalOptions });
      await flushPromises();
    });

    afterEach(() => {
      mockSearchObj.meta.searchMode = undefined;
      (mockSearchObj.data as any).groupsRequest = null;
      delete (mockSearchObj.meta.resultGrid as any).showPagination;
      localStorage.clear();
    });

    it("shows the Groups table in place of the span list, below the RED charts", () => {
      expect(groups().exists()).toBe(true);
      expect(groups().props("request")).toEqual(request);
      expect(wrapper.findComponent({ name: "TracesSearchResultList" }).exists()).toBe(false);
      expect(wrapper.find('[data-test="traces-metrics-dashboard"]').exists()).toBe(true);
    });

    it("hides the page-size select and the pager", () => {
      expect(wrapper.find('[data-test="traces-search-result-records-per-page"]').exists()).toBe(
        false,
      );
      expect(wrapper.findComponent({ name: "OPagination" }).exists()).toBe(false);
    });

    it("lets the Columns button hide Groups columns, apart from the list's", async () => {
      expect(
        toggle()
          .props("columns")
          .map((c: any) => c.id),
      ).toEqual(["value", "spans", "errors", "error_pct", "p50", "p95", "p99", "rate"]);
      toggle().vm.$emit("update:columnVisibility", { p50: false });
      await flushPromises();
      expect(groups().props("columnVisibility")).toEqual({ p50: false });
      (mockSearchObj.data as any).groupsRequest = null;
      await flushPromises();
      expect(toggle().props("columnVisibility")).toEqual({});
    });

    it("lets the last shown Groups column take the leftover width, as the span list does", async () => {
      const fill = () =>
        groups()
          .props("columns")
          .filter((c: any) => c.meta?.autoWidth && c.meta?.fillRemaining)
          .map((c: any) => c.id);
      expect(fill()).toEqual(["rate"]);
      toggle().vm.$emit("update:columnVisibility", { rate: false });
      await flushPromises();
      expect(fill()).toEqual(["p99"]);
    });

    it("keeps the picked sort for the next run and the URL", async () => {
      groups().vm.$emit("update:sort", { by: "p95", order: "asc" });
      await flushPromises();
      expect((mockSearchObj.meta as any).groupsSort).toEqual({ by: "p95", order: "asc" });
      expect(groups().props("sort")).toEqual({ by: "p95", order: "asc" });
    });

    it("shows the span list in SQL mode even before the next run", async () => {
      (mockSearchObj.meta as any).sqlMode = true;
      await flushPromises();
      expect(groups().exists()).toBe(false);
      (mockSearchObj.meta as any).sqlMode = false;
    });
  });

  describe("result count header", () => {
    const countText = () => wrapper.find('[data-test="traces-count-badge"]').text();

    afterEach(() => {
      mockSearchObj.data.queryResults.total = 2;
      (mockSearchObj.meta as any).searchMode = undefined;
    });

    it("names the unit as traces with a matching span", () => {
      expect(countText()).toBe("2 traces with a matching span");
    });

    it("uses the singular for one trace", async () => {
      mockSearchObj.data.queryResults.total = 1;
      await flushPromises();
      expect(countText()).toBe("1 trace with a matching span");
    });

    it("keeps the spans wording in the Spans view", async () => {
      (mockSearchObj.meta as any).searchMode = "spans";
      await flushPromises();
      expect(countText()).toContain("Spans Found");
    });

    it("shows no number, not the page size, when the count failed with none kept", async () => {
      (mockSearchObj.meta as any).searchMode = "spans";
      mockSearchObj.data.queryResults.total = null;
      (mockSearchObj.data.queryResults as any).countFailed = true;
      await flushPromises();
      expect(countText()).toBe("— Spans Found");
      delete (mockSearchObj.data.queryResults as any).countFailed;
    });
  });

  it("should mount SearchResult component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should render the main container with correct data-test attribute", () => {
    const container = wrapper.find('[data-test="traces-search-result"]');
    expect(container.exists()).toBe(true);
    expect(container.classes()).toContain("overflow-hidden");
  });

  it("should render the search list container", () => {
    const searchList = wrapper.find('[data-test="traces-search-result-list"]');
    expect(searchList.exists()).toBe(true);
    expect(searchList.classes()).toContain("search-list");
    expect(searchList.classes()).toContain("w-full");
  });

  it("should render TracesMetricsDashboard component", () => {
    const metricsDashboard = wrapper.find('[data-test="traces-metrics-dashboard"]');
    expect(metricsDashboard.exists()).toBe(true);
  });

  it("pins the RED charts to the scroller's start edge so a sideways table scroll keeps them in view", () => {
    const metricsDashboard = wrapper.find('[data-test="traces-metrics-dashboard"]');
    expect(metricsDashboard.classes()).toEqual(expect.arrayContaining(["sticky", "start-0"]));
  });

  it("should pass hits as a prop to TracesSearchResultList", () => {
    const list = wrapper.findComponent({ name: "TracesSearchResultList" });
    expect(list.exists()).toBe(true);
    expect(list.props("hits")).toHaveLength(2);
  });

  describe("Metrics Dashboard functionality", () => {
    it("should handle time range selection through onMetricsTimeRangeSelected method", () => {
      const start = 1000000000;
      const end = 1000000200;

      wrapper.vm.onMetricsTimeRangeSelected({ start, end });

      expect(wrapper.emitted("update:datetime")).toBeTruthy();
      expect(wrapper.emitted("update:datetime")[0]).toEqual([{ start, end }]);
    });

    it("should relay the heatmap's editor-filter-set as metrics:editor-filter-set", async () => {
      const dashboard = wrapper.findComponent('[data-test="traces-metrics-dashboard"]');
      await dashboard.vm.$emit("editor-filter-set", "(a = '1') and duration < '1ms'");

      expect(wrapper.emitted("metrics:editor-filter-set")).toEqual([
        ["(a = '1') and duration < '1ms'"],
      ]);
    });
  });

  describe("heatmap Ask AI relay", () => {
    it("hands the AI gate to the metrics dashboard", async () => {
      const dashboard = () => wrapper.findComponent('[data-test="traces-metrics-dashboard"]');
      expect(dashboard().props("aiEnabled")).toBe(false);
      await wrapper.setProps({ aiEnabled: true });
      expect(dashboard().props("aiEnabled")).toBe(true);
    });

    it("relays the dashboard's send-to-ai-chat payload unchanged", async () => {
      const payload = { query: "q", chipName: "c", newChat: true, autoSend: false, context: {} };
      const dashboard = wrapper.findComponent('[data-test="traces-metrics-dashboard"]');
      await dashboard.vm.$emit("send-to-ai-chat", payload);
      expect(wrapper.emitted("send-to-ai-chat")).toEqual([[payload]]);
    });
  });

  describe("comparison relays", () => {
    it("should relay the comparison's editor-filter-run as metrics:editor-filter-run", async () => {
      const dashboard = wrapper.findComponent('[data-test="traces-metrics-dashboard"]');
      await dashboard.vm.$emit("editor-filter-run", "(a = '1') and b = '2'");
      expect(wrapper.emitted("metrics:editor-filter-run")).toEqual([["(a = '1') and b = '2'"]]);
    });

    it("should open the comparison through the metrics dashboard", () => {
      const openComparison = vi.fn();
      wrapper.vm.metricsDashboardRef = { openComparison };
      wrapper.vm.openComparison();
      expect(openComparison).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadMore / infinite scroll", () => {
    beforeEach(() => {
      // Reset page and total to known state before each test
      mockSearchObj.data.resultGrid.currentPage = 1;
      mockSearchObj.data.queryResults.total = 2;
      mockSearchObj.meta.resultGrid.rowsPerPage = 1; // page 1 * 1 < 2 → should fire
      mockSearchObj.loading = false;
    });

    afterEach(() => {
      // Restore defaults used by other tests
      mockSearchObj.data.resultGrid.currentPage = 1;
      mockSearchObj.data.queryResults.total = 2;
      mockSearchObj.meta.resultGrid.rowsPerPage = 10;
      mockSearchObj.loading = false;
    });

    it("should emit update:scroll and increment page when more records exist", async () => {
      // currentPage(1) * rowsPerPage(1) = 1 < total(2) → fires
      const list = wrapper.findComponent({ name: "TracesSearchResultList" });
      await list.vm.$emit("page-change", 3);

      expect(wrapper.emitted("update:scroll")).toBeTruthy();

      expect(mockSearchObj.data.resultGrid.currentPage).toBe(2);
    });

    it("should not emit update:scroll when loading is true", async () => {
      mockSearchObj.loading = true;

      const list = wrapper.findComponent({ name: "TracesSearchResultList" });
      await list.vm.$emit("load-more");

      expect(wrapper.emitted("update:scroll")).toBeFalsy();

      mockSearchObj.loading = false;
    });
  });

  describe("Trace block interactions", () => {
    it("should have expandRowDetail method for handling trace clicks", () => {
      expect(wrapper.vm.expandRowDetail).toBeDefined();
      expect(typeof wrapper.vm.expandRowDetail).toBe("function");
    });

    it("writes the list's pending URL state before opening a trace, so Back returns to it", async () => {
      const order: string[] = [];
      mockPatchUrlViewState.mockImplementationOnce(() => {
        order.push("patch");
        return Promise.resolve();
      });
      const push = vi.spyOn(router, "push").mockImplementation(async () => {
        order.push("push");
        return undefined as any;
      });

      await wrapper.vm.expandRowDetail(mockSearchObj.data.queryResults.hits[0]);

      expect(order).toEqual(["patch", "push"]);
      push.mockRestore();
    });

    it("uses the exact aggregated trace range without padding", async () => {
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      const trace = mockSearchObj.data.queryResults.hits[0];

      await wrapper.vm.expandRowDetail(trace);

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            from: trace.trace_start_time,
            to: trace.trace_end_time,
          }),
        }),
      );
      push.mockRestore();
    });
  });

  describe("Open trace in a new tab", () => {
    const openFrom = async (row: any) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const list = wrapper.findComponent({ name: "TracesSearchResultList" });
      await list.vm.$emit("open-in-new-tab", row);
      const call = open.mock.calls[0];
      open.mockRestore();
      return call;
    };

    afterEach(() => {
      mockSearchObj.meta.searchMode = "traces";
    });

    it("opens the trace details with the row window and org in a noopener tab", async () => {
      mockSearchObj.meta.searchMode = "traces";
      const trace = { trace_id: "t-1", trace_start_time: 111, trace_end_time: 222 };
      const [href, target, features] = await openFrom(trace);
      const url = new URL(href as string, "http://localhost");
      expect(url.searchParams.get("trace_id")).toBe("t-1");
      expect(url.searchParams.get("from")).toBe("111");
      expect(url.searchParams.get("to")).toBe("222");
      expect(url.searchParams.get("org_identifier")).toBe("test-org");
      expect(url.searchParams.has("span_id")).toBe(false);
      expect(target).toBe("_blank");
      expect(features).toBe("noopener");
    });

    it("includes span_id and the padded span window in spans mode", async () => {
      mockSearchObj.meta.searchMode = "spans";
      const span = { trace_id: "t-2", span_id: "s-9", start_time: 5_000_000, end_time: 6_000_000 };
      const [href] = await openFrom(span);
      const url = new URL(href as string, "http://localhost");
      expect(url.searchParams.get("span_id")).toBe("s-9");
      expect(url.searchParams.get("from")).toBe(String(5_000 - 60_000_000));
      expect(url.searchParams.get("to")).toBe(String(6_000 + 3_600_000_000));
    });
  });

  describe("Time boxed search", () => {
    it("should handle time boxed search", async () => {
      const timeBoxData = { key: 1000000000 };
      await wrapper.vm.onTimeBoxed(timeBoxData);

      expect(wrapper.emitted("search:timeboxed")).toBeTruthy();
      expect(wrapper.emitted("search:timeboxed")[0]).toEqual([timeBoxData]);
    });
  });

  describe("Component setup", () => {
    it("should have access to i18n", () => {
      expect(wrapper.vm.t).toBeDefined();
    });

    it("should have access to store", () => {
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should have access to router", () => {
      expect(wrapper.vm.$router).toBeDefined();
    });

    it("should have metricsDashboardRef reference", () => {
      expect(wrapper.vm.metricsDashboardRef).toBeDefined();
    });

    it("should have searchObj from composable", () => {
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(wrapper.vm.searchObj.data.queryResults.hits).toHaveLength(2);
    });

    it("should have updatedLocalLogFilterField from composable", () => {
      expect(wrapper.vm.updatedLocalLogFilterField).toBeDefined();
    });
  });

  describe("Metrics Dashboard rendering", () => {
    it("should have getDashboardData method", () => {
      expect(wrapper.vm.getDashboardData).toBeDefined();
      expect(typeof wrapper.vm.getDashboardData).toBe("function");
    });

    it("should have metricsDashboardRef available", () => {
      expect(wrapper.vm.metricsDashboardRef).toBeDefined();
    });
  });

  describe("Column management", () => {
    it("should handle closeColumn method", () => {
      const column = { name: "service_name" };
      const initialColumnsLength = mockSearchObj.data.resultGrid.columns.length;
      const initialFieldsLength = mockSearchObj.data.stream.selectedFields.length;

      wrapper.vm.closeColumn(column);

      expect(mockSearchObj.data.resultGrid.columns.length).toBe(initialColumnsLength - 1);
      expect(mockSearchObj.data.stream.selectedFields.length).toBe(initialFieldsLength - 1);
    });
  });

  describe("Component emits", () => {
    it("should declare all required emits", () => {
      const expectedEmits = [
        "update:scroll",
        "update:datetime",
        "update:sort",
        "remove:searchTerm",
        "search:timeboxed",
        "get:traceDetails",
        "metrics:editor-filter-set",
        "metrics:editor-filter-run",
        "run-query",
        "remove-filter",
        "jump-to-stream-data",
        "error-only-toggled",
        "ask-ai",
        "send-to-ai-chat",
        "open-mobile-fields",
        "add-trace-id",
        "run-sql",
        "open-group",
      ];

      expect(wrapper.vm.$options.emits).toEqual(expectedEmits);
    });
  });

  describe("Component components", () => {
    it("should include TracesMetricsDashboard component", () => {
      expect(wrapper.vm.$options.components).toHaveProperty("TracesMetricsDashboard");
    });

    it("should include TracesSearchResultList component", () => {
      expect(wrapper.vm.$options.components).toHaveProperty("TracesSearchResultList");
    });
  });

  describe("J/K selection across pages (4a §3.4)", () => {
    const navigation = () => mockSearchObj.meta.resultGrid.navigation;
    const select = (index: number) => {
      navigation().selectionActive = true;
      navigation().currentRowIndex = index;
    };

    beforeEach(() => {
      mockSearchObj.loading = false;
      navigation().pendingPageSelection = null;
    });

    it("a paginator change clears the selection, so page 2 row 7 never inherits page 1's (AC6.4)", () => {
      select(7);
      wrapper.vm.changePage(2);
      expect(navigation().selectionActive).toBe(false);
      expect(navigation().currentRowIndex).toBeNull();
      expect(mockSearchObj.data.resultGrid.currentPage).toBe(1);
      expect(wrapper.emitted("update:scroll")).toBeTruthy();
    });

    it("a J/K crossing keeps its pending selection", () => {
      select(9);
      navigation().pendingPageSelection = { page: 2, position: "first", requestId: null };
      wrapper.findComponent({ name: "TracesSearchResultList" }).vm.$emit("cross-page", 2);
      expect(navigation().pendingPageSelection?.page).toBe(2);
      expect(navigation().selectionActive).toBe(true);
      expect(mockSearchObj.data.resultGrid.currentPage).toBe(1);
    });

    it("rows-per-page and sort changes clear the selection", () => {
      select(3);
      wrapper.vm.changeRowsPerPage(25);
      expect(navigation().selectionActive).toBe(false);
      select(3);
      wrapper.vm.changeSortBy("duration", "asc");
      expect(navigation().currentRowIndex).toBeNull();
    });

    it("remembers the opened trace for the Back restore", () => {
      mockSearchObj.meta.searchMode = "traces";
      wrapper.vm.expandRowDetail({ trace_id: "abc", trace_start_time: 1, trace_end_time: 2 });
      expect(navigation().lastOpenedId).toBe("abc");
    });
  });
});

describe("SearchResult count chip", () => {
  let wrapper: any;
  const badge = () => wrapper.find('[data-test="traces-count-badge"]');

  afterEach(() => {
    wrapper?.unmount();
    mockSearchObj.data.queryResults.total = 2;
    delete (mockSearchObj.data.queryResults as any).countPending;
  });

  it("shows a static skeleton, not 0 or a spinner, while the first count runs", async () => {
    Object.assign(mockSearchObj.data.queryResults, { total: null, countPending: true });
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();

    expect(badge().find('[data-test="traces-count-pending"]').exists()).toBe(false);
    expect(badge().find('[data-test="traces-count-skeleton"]').exists()).toBe(true);
    expect(badge().attributes("aria-busy")).toBe("true");
    expect(badge().find(".sr-only").text()).toBe("Loading...");
    expect(badge().text()).not.toMatch(/\d/);
    expect(badge().text()).not.toContain("—");
    expect(badge().text()).toContain("traces with a matching span");
  });

  it("shows the counted total once the count settles", async () => {
    Object.assign(mockSearchObj.data.queryResults, { total: 662900, countPending: false });
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();

    expect(badge().find('[data-test="traces-count-pending"]').exists()).toBe(false);
    expect(badge().text()).toContain("662.9K");
  });

  it("falls back to the rows on the page when the count gave no total", async () => {
    Object.assign(mockSearchObj.data.queryResults, { total: null, countPending: false });
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();

    expect(badge().text()).toMatch(/^2\s/);
  });
});

describe("SearchResult toolbar controls while a query runs", () => {
  let wrapper: any;

  const mountWith = async (results: Record<string, unknown>) => {
    Object.assign(mockSearchObj.data.queryResults, results);
    (mockSearchObj.meta.resultGrid as any).showPagination = true;
    mockSearchObj.meta.resultGrid.rowsPerPage = 10;
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
  };

  afterEach(() => {
    wrapper?.unmount();
    mockSearchObj.loading = false;
    mockSearchObj.data.queryResults.total = 2;
    delete (mockSearchObj.data.queryResults as any).countPending;
    delete (mockSearchObj.data.queryResults as any).errorCount;
    delete (mockSearchObj.meta.resultGrid as any).showPagination;
  });

  it("stops keyboard row navigation crossing pages while the new count is pending", async () => {
    const list = () => wrapper.findComponent({ name: "TracesSearchResultList" });
    await mountWith({ total: 50, countPending: false });
    expect(list().props("showPagination")).toBe(true);

    Object.assign(mockSearchObj.data.queryResults, { total: null, countPending: true });
    await flushPromises();
    expect(list().props("showPagination")).toBe(false);
  });
});

describe("SearchResult in a kept-alive page", () => {
  it("restores the results scroll position when the page returns from the cache", async () => {
    const show = ref(true);
    const Parent = defineComponent({
      setup: () => () =>
        h(KeepAlive, null, { default: () => (show.value ? h(SearchResult) : h("div")) }),
    });
    // Spied before mount: the first activation queues a restore frame too, and a real one can land after re-attach.
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => frames.push(callback));
    const parent = mount(Parent, { global: globalOptions, attachTo: document.body });
    await flushPromises();
    frames.splice(0).forEach((callback) => callback(0));
    const scroller = parent.find('[data-test="traces-search-result"] .overflow-auto')
      .element as HTMLElement;
    // Like a browser: a detached element reads 0 and comes back scrolled to the top.
    let offset = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => (scroller.isConnected ? offset : (offset = 0)),
      set: (value: number) => {
        if (scroller.isConnected) offset = value;
      },
    });
    scroller.scrollTop = 480;
    scroller.dispatchEvent(new Event("scroll"));

    show.value = false;
    await flushPromises();
    expect(scroller.scrollTop).toBe(0);
    show.value = true;
    await flushPromises();
    expect(scroller.scrollTop).toBe(0);
    frames.splice(0).forEach((callback) => callback(0));

    expect(scroller.scrollTop).toBe(480);
    raf.mockRestore();
    parent.unmount();
  });

  describe("SQL mode results", () => {
    let wrapper: any;
    const original = mockSearchObj.data.queryResults;

    beforeEach(async () => {
      const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
      mockTracesParser.value = new mod.default.Parser();
      wrapper = mount(SearchResult, { global: globalOptions });
      await flushPromises();
    });
    const sqlTable = () => wrapper.findComponent({ name: "TracesSqlResultTable" });
    const redIcon = () => wrapper.find('[data-test="traces-red-unavailable-icon"]');
    const lossWarning = () => wrapper.find('[data-test="traces-sql-histogram-loss-warning"]');
    const dashboard = () => wrapper.find('[data-test="traces-metrics-dashboard"]');
    const showResults = async (sql: string, hits: any[], extra: Record<string, unknown> = {}) => {
      (mockSearchObj.meta as any).sqlMode = true;
      (mockSearchObj.meta as any).searchMode = "spans";
      (mockSearchObj.data as any).queryResults = {
        hits,
        total: hits.length,
        from: 0,
        sql,
        ...extra,
      };
      await flushPromises();
    };

    afterEach(() => {
      wrapper.unmount();
      (mockSearchObj.meta as any).sqlMode = false;
      (mockSearchObj.meta as any).searchMode = undefined;
      (mockSearchObj.data as any).queryResults = original;
    });

    it("offers no Columns button over a SQL result table", async () => {
      await showResults(`SELECT service_name, count(*) AS n FROM "default" GROUP BY service_name`, [
        { service_name: "a", n: 1 },
      ]);
      expect(sqlTable().exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-column-toggle-btn"]').exists()).toBe(false);
    });

    it("keeps the RED charts and counts the rows for a GROUP BY", async () => {
      await showResults(`SELECT service_name, count(*) AS n FROM "default" GROUP BY service_name`, [
        { n: 4, service_name: "api" },
        { n: 2, service_name: "db" },
      ]);
      expect(dashboard().exists()).toBe(true);
      expect(redIcon().exists()).toBe(false);
      expect(wrapper.find('[data-test="traces-sql-rows-count"]').text()).toBe("2 rows");
      expect(wrapper.find('[data-test="traces-count-badge"]').exists()).toBe(false);
      expect(sqlTable().props("shape")).toBe("rows");
      expect(
        sqlTable()
          .props("columns")
          .map((c: any) => c.id),
      ).toEqual(["service_name", "n"]);
      expect(sqlTable().props("offerAddTraceId")).toBe(false);
    });

    it("keeps the RED charts and the span table for a plain query", async () => {
      await showResults(`SELECT * FROM "default" WHERE a = 1`, [{ trace_id: "t", span_id: "s" }]);
      expect(dashboard().exists()).toBe(true);
      expect(sqlTable().exists()).toBe(false);
      expect(wrapper.findComponent({ name: "TracesSearchResultList" }).exists()).toBe(true);
    });

    it.each([
      `SELECT * FROM "default" LIMIT 10`,
      `SELECT a FROM "default" UNION SELECT a FROM "default"`,
      `SELECT * FROM "default" p JOIN "default" c ON p.trace_id = c.trace_id`,
      `WITH t AS (SELECT * FROM "default") SELECT * FROM t`,
      `SELECT DISTINCT a FROM "default"`,
    ])("never unmounts the RED charts for %s", async (sql) => {
      await showResults(sql, [{ a: 1 }]);
      expect(dashboard().exists()).toBe(true);
    });

    it("keeps the RED charts when the server says the query is not histogram eligible", async () => {
      await showResults(`SELECT * FROM "default"`, [{ trace_id: "t", span_id: "s" }], {
        is_histogram_eligible: false,
      });
      expect(dashboard().exists()).toBe(true);
    });

    it("warns that histogram() over a subquery or CTE can lose spans", async () => {
      await showResults(
        `SELECT histogram(_timestamp) AS t, count(*) AS n FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default") GROUP BY t`,
        [{ t: "2026-01-01T00:00:00", n: 1 }],
      );
      expect(lossWarning().exists()).toBe(true);
      expect(lossWarning().text()).toBe("This query shape can lose spans across time partitions");
    });

    it("does not warn for histogram() over a JOIN", async () => {
      await showResults(
        `SELECT histogram(p._timestamp) AS t, count(*) AS n FROM "default" p JOIN "default" c ON p.trace_id = c.trace_id GROUP BY t`,
        [{ t: "2026-01-01T00:00:00", n: 1 }],
      );
      expect(lossWarning().exists()).toBe(false);
    });

    it("opens a trace row by trace_id inside the page time range", async () => {
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      await showResults(`SELECT trace_id, max(duration) AS d FROM "default" GROUP BY trace_id`, [
        { trace_id: "t-1", d: 3 },
      ]);
      expect(sqlTable().props("shape")).toBe("traces");

      await sqlTable().vm.$emit("open-trace", { trace_id: "t-1", d: 3 });
      await flushPromises();

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "traceDetails",
          query: expect.objectContaining({
            trace_id: "t-1",
            from: mockSearchObj.data.datetime.startTime,
            to: mockSearchObj.data.datetime.endTime,
          }),
        }),
      );
      expect(push.mock.calls[0][0]).not.toHaveProperty("query.span_id");
      push.mockRestore();
    });

    it("offers Add trace_id for plain rows without GROUP BY and relays it", async () => {
      await showResults(`SELECT service_name FROM "default"`, [{ service_name: "api" }]);
      expect(sqlTable().props("offerAddTraceId")).toBe(true);
      await sqlTable().vm.$emit("add-trace-id");
      expect(wrapper.emitted("add-trace-id")).toHaveLength(1);
    });

    it("warns next to the count when the server cut the result", async () => {
      await showResults(`SELECT span_id, count(*) AS n FROM "default" GROUP BY span_id`, [
        { span_id: "a", n: 1 },
      ]);
      expect(wrapper.find('[data-test="traces-sql-partial-icon"]').exists()).toBe(false);
      mockSearchObj.data.queryResults.is_partial = true;
      await flushPromises();
      expect(wrapper.find('[data-test="traces-sql-partial-icon"]').exists()).toBe(true);
    });

    it("offers str_match after a match_all query returns no rows, and runs the rewrite", async () => {
      await showResults(`SELECT * FROM "default"\nWHERE match_all('PlaceOrder')`, []);
      const empty = wrapper.find('[data-test="traces-sql-match-all-empty"]');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain("no populated full-text fields");
      const card = wrapper.find('[data-test="traces-sql-match-all-fix-card"]');
      expect(card.text()).toContain("Runs str_match(operation_name, 'PlaceOrder')");
      await card.trigger("click");
      expect(wrapper.emitted("run-sql")?.[0]).toEqual([
        `SELECT * FROM "default"\nWHERE str_match(operation_name, 'PlaceOrder')`,
      ]);
    });

    it("keeps the usual empty state for a query without match_all", async () => {
      await showResults(`SELECT * FROM "default" WHERE a = 1`, []);
      expect(wrapper.find('[data-test="traces-sql-match-all-empty"]').exists()).toBe(false);
    });

    it("marks a result column that is null in every row as maybe stored in _all", async () => {
      await showResults(
        `SELECT service_name, http_status_code, count(*) AS n FROM "default" GROUP BY 1, 2`,
        [
          { service_name: "api", http_status_code: null, n: 2 },
          { service_name: "db", n: 1 },
        ],
      );
      const columns = sqlTable().props("columns");
      const hinted = columns.filter((c: any) => c.meta?.headerTooltip);
      expect(hinted.map((c: any) => c.id)).toEqual(["http_status_code"]);
      expect(String(hinted[0].meta.headerTooltip)).toBe("This field may be stored in _all");
    });

    it("shows a selected column the server left out of every row, and not its added _timestamp", async () => {
      await showResults(
        `SELECT service_name, http_status_code FROM "default" WHERE service_name = 'redis' LIMIT 20`,
        [
          { _timestamp: 1, service_name: "redis" },
          { _timestamp: 2, service_name: "redis" },
        ],
      );
      const columns = sqlTable().props("columns");
      expect(columns.map((c: any) => c.id)).toEqual(["service_name", "http_status_code"]);
      expect(columns.find((c: any) => c.id === "http_status_code").meta.headerTooltip).toBe(
        "This field may be stored in _all",
      );
    });

    it("opens a span row without span times inside the page time range", async () => {
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      await showResults(`SELECT trace_id, span_id FROM "default"`, [
        { trace_id: "t", span_id: "s" },
      ]);
      await wrapper.vm.expandRowDetail({ trace_id: "t", span_id: "s" });
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            from: mockSearchObj.data.datetime.startTime,
            to: mockSearchObj.data.datetime.endTime,
          }),
        }),
      );
      push.mockRestore();
    });
  });
});

describe("SearchResult announcements from a kept-alive page", () => {
  afterEach(() => {
    clearAnnouncements();
    mockSearchObj.loading = false;
  });

  it("says nothing when leaving the page ends its search", async () => {
    const show = ref(true);
    const Parent = defineComponent({
      setup: () => () =>
        h(KeepAlive, null, { default: () => (show.value ? h(SearchResult) : h("div")) }),
    });
    mockSearchObj.loading = true;
    const parent = mount(Parent, { global: globalOptions, attachTo: document.body });
    await flushPromises();

    show.value = false;
    await flushPromises();
    mockSearchObj.loading = false;
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(document.querySelector('[data-test="region-announcer"]')?.textContent ?? "").toBe("");
    parent.unmount();
  });
});

describe("SearchResult header through a re-run (T-3)", () => {
  let wrapper: any;
  const badge = () => wrapper.find('[data-test="traces-count-badge"]');
  const errorChip = () => wrapper.find('[data-test="traces-error-count-badge"]');
  const pagerGroup = () => wrapper.find('[data-test="traces-search-result-pager-group"]');

  const settle = (total: number, errorCount: number) =>
    Object.assign(mockSearchObj.data.queryResults, { total, errorCount, countPending: false });

  beforeEach(() => {
    vi.useFakeTimers();
    (mockSearchObj.meta as any).searchMode = "spans";
    (mockSearchObj.meta.resultGrid as any).showPagination = true;
    mockSearchObj.meta.resultGrid.rowsPerPage = 10;
    settle(1284, 38);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    mockSearchObj.loading = false;
    (mockSearchObj.meta as any).searchMode = undefined;
    (mockSearchObj.meta.resultGrid as any).showPagination = false;
    mockSearchObj.data.stream.selectedStream.value = "default";
    Object.assign(mockSearchObj.data.queryResults, { total: 2, errorCount: 0 });
    delete (mockSearchObj.data.queryResults as any).countPending;
  });

  const startRerun = async () => {
    mockSearchObj.loading = true;
    Object.assign(mockSearchObj.data.queryResults, { total: null, countPending: true });
    await wrapper.vm.$nextTick();
  };

  it("keeps the count, error chip and pager mounted with the previous values", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();

    expect(badge().text()).toBe("1.3K Spans Found");
    expect(errorChip().exists()).toBe(true);
    expect(errorChip().text()).toContain("38");
    expect(pagerGroup().exists()).toBe(true);
    expect(wrapper.vm.totalPages).toBe(129);
  });

  it("dims the kept values only after 150 ms, and marks the stale actions aria-disabled", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();

    expect(badge().find(".opacity-60").exists()).toBe(false);
    vi.advanceTimersByTime(149);
    await wrapper.vm.$nextTick();
    expect(badge().find(".opacity-60").exists()).toBe(false);
    vi.advanceTimersByTime(1);
    await wrapper.vm.$nextTick();
    expect(badge().find(".opacity-60").exists()).toBe(true);
    expect(errorChip().classes()).toContain("opacity-60");
    expect(errorChip().attributes("aria-disabled")).toBe("true");
    expect(pagerGroup().classes()).toContain("opacity-60");
    expect(pagerGroup().attributes("aria-disabled")).toBe("true");
  });

  it("writes the new values once, at full opacity, when the count settles", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();
    vi.advanceTimersByTime(200);
    mockSearchObj.loading = false;
    await wrapper.vm.$nextTick();
    expect(badge().text()).toBe("1.3K Spans Found");

    settle(2500, 41);
    await wrapper.vm.$nextTick();
    expect(badge().text()).toBe("2.5K Spans Found");
    expect(badge().find(".opacity-60").exists()).toBe(false);
    expect(errorChip().text()).toContain("41");
  });

  it("shows the skeleton, not the other mode's count, after Spans to Traces", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    (mockSearchObj.meta as any).searchMode = "traces";
    await startRerun();

    expect(badge().find('[data-test="traces-count-skeleton"]').exists()).toBe(true);
    expect(badge().text()).not.toContain("1.3K");
    expect(errorChip().exists()).toBe(false);
  });

  it("shows the skeleton, not the other stream's count, after a stream change", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    mockSearchObj.data.stream.selectedStream.value = "checkout";
    await startRerun();

    expect(badge().find('[data-test="traces-count-skeleton"]').exists()).toBe(true);
    expect(badge().text()).not.toContain("1.3K");
    expect(errorChip().exists()).toBe(false);
  });

  it("wraps the refresh control's data age in its own test id, keeping the control's id", async () => {
    (mockSearchObj.meta as any).lastRunAt = Date.UTC(2026, 10, 1, 10, 42);
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();

    const dataAge = wrapper.find('[data-test="traces-search-result-data-age"]');
    expect(dataAge.exists()).toBe(true);
    expect(dataAge.find('[data-test="traces-search-result-refresh"]').exists()).toBe(true);
    expect(dataAge.text()).toContain("Updated");
  });

  it("keeps the data age readable and the control focusable through a run, with no spinner of its own", async () => {
    (mockSearchObj.meta as any).lastRunAt = Date.UTC(2026, 10, 1, 10, 42);
    wrapper = mount(SearchResult, { global: globalOptions, attachTo: document.body });
    await flushPromises();
    const control = () => wrapper.find('[data-test="traces-search-result-refresh"]');
    (control().element as HTMLElement).focus();
    await startRerun();
    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();

    expect(control().attributes("aria-busy")).toBe("true");
    expect(control().attributes("disabled")).toBeUndefined();
    expect(document.activeElement).toBe(control().element);
    expect(control().find(".animate-spin").exists()).toBe(false);
    expect(control().find(".text-transparent").exists()).toBe(false);
    expect(wrapper.find('[data-test="traces-search-result-data-age"]').text()).toContain("Updated");
  });

  it("dims the kept values with the auto-run toggle on, as the rows do", async () => {
    (mockSearchObj.meta as any).liveMode = true;
    try {
      wrapper = mount(SearchResult, { global: globalOptions });
      await flushPromises();
      await startRerun();
      vi.advanceTimersByTime(150);
      await wrapper.vm.$nextTick();

      expect(badge().find(".opacity-60").exists()).toBe(true);
      expect(errorChip().classes()).toContain("opacity-60");
      expect(pagerGroup().classes()).toContain("opacity-60");
    } finally {
      (mockSearchObj.meta as any).liveMode = false;
    }
  });

  it("moves the data age, failure and pager to a second header row by the results' width, not by state", async () => {
    (mockSearchObj.meta as any).lastRunAt = Date.UTC(2026, 10, 1, 10, 42);
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    const header = wrapper.find('[data-test="traces-section-header"]');
    const rowBreak = wrapper.find('[data-test="traces-search-result-header-break"]');
    const dataAge = wrapper.find('[data-test="traces-search-result-data-age"]');

    expect(header.element.parentElement?.classList).toContain("@container/results");
    expect(header.classes()).toContain("@max-[58rem]/results:flex-wrap");
    expect(rowBreak.classes()).toEqual(
      expect.arrayContaining(["hidden", "basis-full", "@max-[58rem]/results:block"]),
    );
    expect(rowBreak.element.nextElementSibling?.classList).toContain(
      "@max-[58rem]/results:flex-none",
    );
    expect(dataAge.classes()).toEqual(
      expect.arrayContaining(["min-w-0", "@max-[58rem]/results:flex-1"]),
    );

    (mockSearchObj.meta as any).refreshFailedAt = Date.UTC(2026, 10, 1, 10, 47);
    await flushPromises();
    expect(wrapper.find('[data-test="traces-search-result-header-break"]').element).toBe(
      rowBreak.element,
    );
    (mockSearchObj.meta as any).refreshFailedAt = null;
  });

  it("returns the kept values and actions to full opacity once a refresh fails", async () => {
    (mockSearchObj.meta as any).lastRunAt = Date.UTC(2026, 10, 1, 10, 42);
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();
    vi.advanceTimersByTime(200);
    await wrapper.vm.$nextTick();
    expect(pagerGroup().classes()).toContain("opacity-60");

    (mockSearchObj.meta as any).refreshFailedAt = Date.UTC(2026, 10, 1, 10, 47);
    settle(1284, 38);
    mockSearchObj.loading = false;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="traces-search-result-refresh-failed"]').exists()).toBe(true);
    expect(badge().find(".opacity-60").exists()).toBe(false);
    expect(badge().text()).toBe("1.3K Spans Found");
    expect(errorChip().classes()).not.toContain("opacity-60");
    expect(errorChip().attributes("aria-disabled")).toBeUndefined();
    expect(pagerGroup().classes()).not.toContain("opacity-60");
    expect(pagerGroup().attributes("aria-disabled")).toBeUndefined();
    await errorChip().trigger("click");
    expect(wrapper.emitted("error-only-toggled")).toHaveLength(1);
    (mockSearchObj.meta as any).refreshFailedAt = null;
  });

  it("refuses the pager, rows-per-page and error chip after the rows land until the count settles", async () => {
    mockSearchObj.data.resultGrid.currentPage = 0;
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();
    mockSearchObj.loading = false;
    await wrapper.vm.$nextTick();

    expect(pagerGroup().attributes("aria-disabled")).toBe("true");
    expect(errorChip().attributes("aria-disabled")).toBe("true");
    wrapper.findComponent({ name: "OPagination" }).vm.$emit("update:modelValue", 129);
    wrapper
      .find('[data-test="traces-search-result-records-per-page"]')
      .findComponent({ name: "OSelect" })
      .vm.$emit("update:modelValue", 100);
    await errorChip().trigger("click");
    expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
    expect(mockSearchObj.meta.resultGrid.rowsPerPage).toBe(10);
    expect(wrapper.emitted("update:scroll")).toBeUndefined();
    expect(wrapper.emitted("error-only-toggled")).toBeUndefined();

    settle(30, 2);
    await wrapper.vm.$nextTick();
    expect(pagerGroup().attributes("aria-disabled")).toBeUndefined();
    wrapper.findComponent({ name: "OPagination" }).vm.$emit("update:modelValue", 2);
    expect(mockSearchObj.data.resultGrid.currentPage).toBe(1);
    expect(wrapper.emitted("update:scroll")).toHaveLength(1);
    mockSearchObj.data.resultGrid.currentPage = 1;
  });

  it("marks the stale actions aria-disabled as the run starts, before the dim", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();

    expect(pagerGroup().classes()).not.toContain("opacity-60");
    expect(pagerGroup().attributes("aria-disabled")).toBe("true");
    expect(errorChip().attributes("aria-disabled")).toBe("true");
  });

  it("ignores the error chip while the values are stale", async () => {
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    await startRerun();
    await errorChip().trigger("click");
    expect(wrapper.emitted("error-only-toggled")).toBeUndefined();
  });

  it("swaps the data age for the red failed-refresh sentence and keeps the old age", async () => {
    (mockSearchObj.meta as any).lastRunAt = Date.UTC(2026, 10, 1, 10, 42);
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();
    mockSearchObj.loading = true;
    await wrapper.vm.$nextTick();
    (mockSearchObj.meta as any).refreshFailedAt = Date.UTC(2026, 10, 1, 10, 47);
    mockSearchObj.loading = false;
    await wrapper.vm.$nextTick();

    const dataAge = wrapper.find('[data-test="traces-search-result-data-age"]');
    expect(dataAge.find('[data-test="traces-search-result-refresh-failed"]').text()).toContain(
      "Refresh failed at",
    );
    expect((mockSearchObj.meta as any).lastRunAt).toBe(Date.UTC(2026, 10, 1, 10, 42));
    (mockSearchObj.meta as any).refreshFailedAt = null;
  });
});

describe("SearchResult pending first load (T-1)", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    mockSearchObj.searchApplied = true;
    mockSearchObj.data.stream.selectedStream.value = "default";
  });

  it("draws the header, a count skeleton and reserved chart placeholders before any stream is known", async () => {
    mockSearchObj.searchApplied = false;
    mockSearchObj.data.stream.selectedStream.value = "";
    wrapper = mount(SearchResult, { global: globalOptions, props: { pending: true } });
    await flushPromises();

    expect(wrapper.find('[data-test="traces-section-header"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="traces-count-skeleton"]').exists()).toBe(true);
    const placeholder = wrapper.find('[data-test="traces-metrics-placeholder"]');
    expect(placeholder.exists()).toBe(true);
    expect(placeholder.classes()).toContain("md:h-40");
    expect(placeholder.findAll('[role="img"]')).toHaveLength(3);
    expect(placeholder.find('[role="img"]').attributes("aria-label")).toBe("Loading chart");
    expect(wrapper.findComponent({ name: "TracesSearchResultList" }).props("loading")).toBe(true);
    expect(wrapper.find('[data-test="traces-search-loading"]').exists()).toBe(true);
    const pager = wrapper.find('[data-test="traces-search-result-pager-group"]');
    expect(pager.exists()).toBe(true);
    expect(pager.classes()).toContain("opacity-60");
    expect(pager.attributes("aria-disabled")).toBe("true");
  });

  it("paints the three panel titles, the rate unit and the Duration panel's Color by chrome at once", async () => {
    (mockSearchObj.meta as any).searchMode = "spans";
    mockSearchObj.searchApplied = false;
    wrapper = mount(SearchResult, { global: globalOptions, props: { pending: true } });
    await flushPromises();

    const titles = wrapper
      .find('[data-test="traces-metrics-placeholder"]')
      .findAll('[data-test="traces-metrics-placeholder-title"]')
      .map((title: any) =>
        title
          .findAll(":scope > span:not([inert])")
          .map((part: any) => part.text())
          .join(" "),
      );
    expect(titles).toEqual(["Rate spans/s", "Errors", "Duration"]);
    const colorBy = wrapper.find('[data-test="traces-metrics-placeholder-color-toggle"]');
    expect(colorBy.exists()).toBe(true);
    expect(colorBy.text()).toContain("Spans");
    expect(colorBy.text()).toContain("Errors");
    expect(colorBy.element.closest("[inert]")).not.toBeNull();
    expect(wrapper.find('[data-test="traces-latency-heatmap-color-toggle"]').exists()).toBe(false);
    (mockSearchObj.meta as any).searchMode = undefined;
  });

  it("draws the chart placeholder while the charts' own chunk loads, so the table never moves up and back", () => {
    const { TracesMetricsDashboard: _stubbed, ...stubs } = globalOptions.stubs;
    wrapper = mount(SearchResult, {
      global: { ...globalOptions, stubs },
      props: { pending: false },
    });

    const placeholder = wrapper.find('[data-test="traces-metrics-placeholder"]');
    expect(placeholder.exists()).toBe(true);
    expect(placeholder.classes()).toContain("md:h-40");
    expect(wrapper.find('[data-test="traces-search-loading"]').exists()).toBe(false);
  });
});

describe("SearchResult header holds still as the first data lands", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("reserves the widest pager from first paint, so the count landing moves nothing to its left", async () => {
    (mockSearchObj.meta.resultGrid as any).showPagination = true;
    mockSearchObj.meta.resultGrid.rowsPerPage = 25;
    Object.assign(mockSearchObj.data.queryResults, { total: 0 });
    wrapper = mount(SearchResult, { global: globalOptions });
    const pager = () => wrapper.findComponent({ name: "OPagination" });
    expect(pager().props("maxPages")).toBe(5);
    expect(wrapper.find('[data-test="traces-search-result-data-age"]').classes()).toContain(
      "@min-[58rem]/results:min-w-33",
    );
    expect(pager().classes()).toEqual(expect.arrayContaining(["min-w-54", "justify-end"]));
    Object.assign(mockSearchObj.data.queryResults, { total: 1284 });
    await flushPromises();
    expect(pager().classes()).toEqual(expect.arrayContaining(["min-w-54", "justify-end"]));
  });

  it("draws no results progress line, even through a run", async () => {
    wrapper = mount(SearchResult, { global: globalOptions, props: { pending: true } });
    await flushPromises();
    expect(wrapper.find('[data-test="traces-search-result-progress"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "LoadingProgress" }).exists()).toBe(false);
  });
});
