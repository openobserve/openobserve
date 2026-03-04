// Copyright 2023 OpenObserve Inc.
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

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import SearchResult from "@/plugins/traces/SearchResult.vue";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

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

const mockSearchObj = {
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
      navigation: {
        currentRowIndex: 0,
      },
    },
  },
  loading: false,
  searchApplied: true,
  organizationIdentifier: "test-org",
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    updatedLocalLogFilterField: vi.fn(),
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
    "q-resize-observer": true,
    TracesSearchResultList: {
      name: "TracesSearchResultList",
      template: '<div data-test="traces-search-result-list" class="search-list tw:w-full"></div>',
      props: ["hits", "loading", "searchPerformed", "showHeader"],
      emits: ["row-click", "load-more"],
    },
    TracesMetricsDashboard: {
      template: '<div data-test="traces-metrics-dashboard"></div>',
      props: ["streamName", "timeRange", "filter", "show"],
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

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
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
    expect(searchList.classes()).toContain("tw:w-full");
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
      await list.vm.$emit("load-more");

      expect(wrapper.emitted("update:scroll")).toBeTruthy();
      expect(mockSearchObj.data.resultGrid.currentPage).toBe(2);
    });

    it("should not emit update:scroll when all records are already loaded", async () => {
      mockSearchObj.meta.resultGrid.rowsPerPage = 10;
      // currentPage(1) * rowsPerPage(10) = 10 >= total(2) → does not fire

      const list = wrapper.findComponent({ name: "TracesSearchResultList" });
      await list.vm.$emit("load-more");

      expect(wrapper.emitted("update:scroll")).toBeFalsy();
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
        "remove:searchTerm",
        "search:timeboxed",
        "get:traceDetails",
        "metrics:filters-updated",
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
});
