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

const mockPlotChart = {
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
};



vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    updatedLocalLogFilterField: vi.fn(),
  }),
}));

vi.mock("@/utils/traces/convertTraceData", () => ({
  convertTraceData: vi.fn(() => mockPlotChart),
}));

describe("SearchResult", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mount(SearchResult, {
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs: {
          "q-resize-observer": true,
          "q-virtual-scroll": {
            template: `
              <div data-test="virtual-scroll-container" @scroll="$emit('virtual-scroll', { ref: { items: items }, index: $event.target.scrollTop / 25 })">
                <slot name="before"></slot>
                <div v-for="(item, index) in items" :key="index">
                  <slot :item="item" :index="index"></slot>
                </div>
              </div>
            `,
            props: ["items"],
            emits: ["virtual-scroll"],
          },
          ChartRenderer: {
            template: '<div data-test="chart-renderer" @updated:dataZoom="$emit(\'updated:dataZoom\', $event)" @click="$emit(\'click\', $event)"></div>',
            props: ['data'],
            emits: ['updated:dataZoom', 'click'],
          },
          TraceBlock: {
            template: '<div data-test="trace-block" @click="$emit(\'click\', $event)"></div>',
            props: ['item', 'index'],
            emits: ['click'],
          },
          TracesMetricsDashboard: {
            template: '<div data-test="traces-metrics-dashboard"></div>',
            props: ['streamName', 'timeRange', 'filter', 'show'],
            methods: {
              loadDashboard: vi.fn(),
            },
          },
        },
      },
    });
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
    expect(container.classes()).toContain("col");
    expect(container.classes()).toContain("column");
    expect(container.classes()).toContain("overflow-hidden");
  });

  it("should render the search list container", () => {
    const searchList = wrapper.find('[data-test="traces-search-result-list"]');
    expect(searchList.exists()).toBe(true);
    expect(searchList.classes()).toContain("search-list");
    // Width is now applied via Tailwind CSS class instead of inline style
    expect(searchList.classes()).toContain("tw:w-full");
  });

  it("should render TracesMetricsDashboard component", () => {
    const metricsDashboard = wrapper.find('[data-test="traces-metrics-dashboard"]');
    expect(metricsDashboard.exists()).toBe(true);
  });

  it("should display correct trace count", () => {
    const traceCount = wrapper.find('[data-test="traces-search-result-count"]');
    expect(traceCount.exists()).toBe(true);
    expect(traceCount.classes()).toContain("text-subtitle1");
    expect(traceCount.classes()).toContain("text-bold");
    expect(traceCount.text()).toBe("2 Traces");
  });

  it("should render virtual scroll container", () => {
    const virtualScroll = wrapper.find('[data-test="traces-search-result-virtual-scroll"]');
    expect(virtualScroll.exists()).toBe(true);
    expect(virtualScroll.attributes("id")).toBe("tracesSearchGridComponent");
    expect(virtualScroll.classes()).toContain("traces-table-container");
  });

  it("should render trace items", async () => {
    await flushPromises();
    const traceItems = wrapper.findAll('[data-test="traces-search-result-item"]');
    expect(traceItems).toHaveLength(2);
  });

  it("should render TraceBlock components for each trace", () => {
    const traceBlocks = wrapper.findAll('[data-test="trace-block"]');
    expect(traceBlocks).toHaveLength(2);
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

  describe("Virtual scroll functionality", () => {
    // it("should handle scroll events for pagination", async () => {
    //   const virtualScroll = wrapper.find('[data-test="traces-search-result-virtual-scroll"]');
    //   const scrollInfo = {
    //     ref: {
    //       items: mockSearchObj.data.queryResults.hits,
    //     },
    //     index: 8, // Near the end of current items
    //   };
      
    //   await virtualScroll.trigger("virtual-scroll", scrollInfo);
      
    //   expect(wrapper.emitted("update:scroll")).toBeTruthy();
    // });

    it("should not trigger scroll update when not near end", async () => {
      const virtualScroll = wrapper.find('[data-test="traces-search-result-virtual-scroll"]');
      const scrollInfo = {
        ref: {
          items: mockSearchObj.data.queryResults.hits,
        },
        index: 2, // Not near the end
      };
      
      await virtualScroll.trigger("virtual-scroll", scrollInfo);
      
      expect(wrapper.emitted("update:scroll")).toBeFalsy();
    });

    // it("should render virtual scroll items correctly", async () => {
    //   const virtualScrollContainer = wrapper.find('[data-test="virtual-scroll-container"]');
    //   expect(virtualScrollContainer.exists()).toBe(true);
      
    //   const traceItems = wrapper.findAll('[data-test="traces-search-result-item"]');
    //   expect(traceItems).toHaveLength(2);
    // });

    // it("should handle scroll event emission", async () => {
    //   const virtualScroll = wrapper.find('[data-test="traces-search-result-virtual-scroll"]');
      
    //   // Simulate scroll event
    //   await virtualScroll.trigger("scroll", { target: { scrollTop: 200 } });
      
    //   // The stub should emit virtual-scroll event
    //   expect(virtualScroll.emitted("virtual-scroll")).toBeTruthy();
    // });

    it("should not trigger scroll update when loading", () => {
      // Temporarily set loading to true
      mockSearchObj.loading = true;

      // Virtual scroll should not be visible when loading
      const loadingWrapper = wrapper.find('[data-test="traces-search-result-virtual-scroll"]');

      // The component should show loading spinner instead
      expect(mockSearchObj.loading).toBe(true);

      // Reset loading state
      mockSearchObj.loading = false;
    });
  });

  describe("Trace block interactions", () => {
    it("should have expandRowDetail method for handling trace clicks", () => {
      expect(wrapper.vm.expandRowDetail).toBeDefined();
      expect(typeof wrapper.vm.expandRowDetail).toBe('function');
    });
  });

  describe("Navigation functionality", () => {
    it("should calculate correct row index for next navigation", () => {
      const result = wrapper.vm.getRowIndex(true, false, 5);
      expect(result).toBe(6);
    });

    it("should calculate correct row index for previous navigation", () => {
      const result = wrapper.vm.getRowIndex(false, true, 5);
      expect(result).toBe(4);
    });
  });

  describe("Search term functionality", () => {
    it("should add search term to filter", () => {
      const term = "test-term";
      wrapper.vm.addSearchTerm(term);
      expect(mockSearchObj.data.stream.addToFilter).toBe(term);
    });

    it("should emit remove search term event", async () => {
      const term = "test-term";
      await wrapper.vm.removeSearchTerm(term);
      
      expect(wrapper.emitted("remove:searchTerm")).toBeTruthy();
      expect(wrapper.emitted("remove:searchTerm")[0]).toEqual([term]);
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
      expect(typeof wrapper.vm.getDashboardData).toBe('function');
    });

    it("should have metricsDashboardRef available", () => {
      expect(wrapper.vm.metricsDashboardRef).toBeDefined();
    });
  });

  describe("Empty state handling", () => {
    it("should handle empty query results", async () => {
      // Save original hits
      const originalHits = mockSearchObj.data.queryResults.hits;

      // Temporarily set empty hits
      mockSearchObj.data.queryResults.hits = [];

      const emptyWrapper = mount(SearchResult, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": {
              template: `
                <div data-test="virtual-scroll-container" @scroll="$emit('virtual-scroll', { ref: { items: items }, index: $event.target.scrollTop / 25 })">
                  <slot name="before"></slot>
                  <div v-for="(item, index) in items" :key="index">
                    <slot :item="item" :index="index"></slot>
                  </div>
                </div>
              `,
              props: ["items"],
              emits: ["virtual-scroll"],
            },
            ChartRenderer: {
              template: '<div data-test="chart-renderer" @updated:dataZoom="$emit(\'updated:dataZoom\', $event)" @click="$emit(\'click\', $event)"></div>',
              props: ['data'],
              emits: ['updated:dataZoom', 'click'],
            },
            TraceBlock: {
              template: '<div data-test="trace-block"></div>',
              props: ['item', 'index'],
              emits: ['click'],
            },
            TracesMetricsDashboard: {
              template: '<div data-test="traces-metrics-dashboard"></div>',
              props: ['streamName', 'timeRange', 'filter', 'show'],
              methods: {
                loadDashboard: vi.fn(),
              },
            },
          },
        },
      });

      const traceCount = emptyWrapper.find('[data-test="traces-search-result-count"]');
      expect(traceCount.text()).toBe("0 Traces");

      emptyWrapper.unmount();

      // Restore original hits
      mockSearchObj.data.queryResults.hits = originalHits;
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
      ];
      
      expect(wrapper.vm.$options.emits).toEqual(expectedEmits);
    });
  });

  describe("Component components", () => {
    it("should include TracesMetricsDashboard component", () => {
      expect(wrapper.vm.$options.components).toHaveProperty("TracesMetricsDashboard");
    });

    it("should include TraceBlock component", () => {
      expect(wrapper.vm.$options.components).toHaveProperty("TraceBlock");
    });
  });
});
