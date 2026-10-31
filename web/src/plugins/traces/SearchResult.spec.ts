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

const { mockPatchUrlViewState } = vi.hoisted(() => ({
  mockPatchUrlViewState: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    updatedLocalLogFilterField: vi.fn(),
    patchUrlViewState: mockPatchUrlViewState,
  }),
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
      props: ["hits", "loading", "searchPerformed", "showHeader", "wrap"],
      emits: ["row-click", "load-more"],
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

  it("shows a pending count instead of 0 while the count query runs", async () => {
    Object.assign(mockSearchObj.data.queryResults, { total: null, countPending: true });
    wrapper = mount(SearchResult, { global: globalOptions });
    await flushPromises();

    expect(badge().find('[data-test="traces-count-pending"]').exists()).toBe(true);
    expect(badge().attributes("aria-busy")).toBe("true");
    expect(badge().text()).not.toMatch(/\d/);
    expect(badge().text()).toBe("— traces with a matching span");
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

describe("SearchResult in a kept-alive page", () => {
  it("restores the results scroll position when the page returns from the cache", async () => {
    const show = ref(true);
    const Parent = defineComponent({
      setup: () => () =>
        h(KeepAlive, null, { default: () => (show.value ? h(SearchResult) : h("div")) }),
    });
    const parent = mount(Parent, { global: globalOptions, attachTo: document.body });
    await flushPromises();
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
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => frames.push(callback));
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
});
