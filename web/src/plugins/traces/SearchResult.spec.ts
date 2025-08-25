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
    },
    searchAround: {
      indexTimestamp: null,
    },
    traceDetails: {
      showSpanDetails: false,
      selectedSpanId: null,
    },
  },
  meta: {
    showDetailTab: false,
    showTraceDetails: false,
    resultGrid: {
      rowsPerPage: 10,
      navigation: {
        currentRowIndex: 0,
      },
    },
  },
  loading: false,
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



describe("SearchResult", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/composables/useTraces", () => ({
        default: () => ({
          searchObj: mockSearchObj,
          updatedLocalLogFilterField: vi.fn(),
        }),
    }));

    vi.doMock("@/utils/traces/convertTraceData", () => ({
        convertTraceData: vi.fn(() => mockPlotChart),
      }));
      
    const SearchResult = (await import("@/plugins/traces/SearchResult.vue")).default;
    
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
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
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
    expect(searchList.attributes("style")).toContain("width: 100%");
  });

  it("should render ChartRenderer component", () => {
    const chartRenderer = wrapper.find('[data-test="traces-search-result-bar-chart"]');
    expect(chartRenderer.exists()).toBe(true);
    expect(chartRenderer.attributes("id")).toBe("traces_scatter_chart");
    expect(chartRenderer.attributes("style")).toContain("height: 150px");
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
    expect(virtualScroll.attributes("style")).toContain("height: 400px");
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

  describe("Chart functionality", () => {
    it("should handle chart update events", async () => {
      const chartRenderer = wrapper.find('[data-test="traces-search-result-bar-chart"]');
      const start = 1000000000;
      const end = 1000000200;
      
      await chartRenderer.trigger("updated:dataZoom", { start, end });
      
      expect(wrapper.emitted("update:datetime")).toBeTruthy();
      expect(wrapper.emitted("update:datetime")[0]).toEqual([{ start, end }]);
    });

    it("should handle chart click events", async () => {
      const chartRenderer = wrapper.find('[data-test="traces-search-result-bar-chart"]');
      const clickData = { dataIndex: 0 };
      
      await chartRenderer.trigger("click", clickData);
      
      expect(wrapper.emitted("get:traceDetails")).toBeTruthy();
      expect(wrapper.emitted("get:traceDetails")[0]).toEqual([mockSearchObj.data.queryResults.hits[0]]);
    });

    it("should not emit update:datetime when start or end is missing", async () => {
      const chartRenderer = wrapper.find('[data-test="traces-search-result-bar-chart"]');
      
      await chartRenderer.trigger("updated:dataZoom", { start: null, end: 1000000200 });
      expect(wrapper.emitted("update:datetime")).toBeFalsy();
      
      await chartRenderer.trigger("updated:dataZoom", { start: 1000000000, end: null });
      expect(wrapper.emitted("update:datetime")).toBeFalsy();
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

    it("should not trigger scroll update when loading", async () => {
      const loadingSearchObj = {
        ...mockSearchObj,
        loading: true,
      };

      vi.doMock("@/composables/useTraces", () => ({
        default: () => ({
          searchObj: loadingSearchObj,
          updatedLocalLogFilterField: vi.fn(),
        }),
      }));

      const loadingWrapper = mount(SearchResult, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": true,
            ChartRenderer: {
              template: '<div data-test="chart-renderer"></div>',
              props: ['data'],
              emits: ['updated:dataZoom', 'click'],
            },
            TraceBlock: {
              template: '<div data-test="trace-block"></div>',
              props: ['item', 'index'],
              emits: ['click'],
            },
          },
        },
      });

      const virtualScroll = loadingWrapper.find('[data-test="traces-search-result-virtual-scroll"]');
      const scrollInfo = {
        ref: {
          items: loadingSearchObj.data.queryResults.hits,
        },
        index: 8,
      };
      
      await virtualScroll.trigger("virtual-scroll", scrollInfo);
      expect(loadingWrapper.emitted("update:scroll")).toBeFalsy();

      loadingWrapper.unmount();
    });
  });

  describe("Trace block interactions", () => {
    it("should handle trace block click events", async () => {
      const traceBlocks = wrapper.findAll('[data-test="trace-block"]');
      const firstTrace = mockSearchObj.data.queryResults.hits[0];

      await traceBlocks[0].trigger("click", firstTrace);

      expect(wrapper.emitted("get:traceDetails")).toBeTruthy();
      expect(wrapper.emitted("get:traceDetails")[0]).toEqual([firstTrace]);
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

    it("should have plotChart reactive reference", () => {
      expect(wrapper.vm.plotChart).toBeDefined();
    });

    it("should have searchObj from composable", () => {
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(wrapper.vm.searchObj.data.queryResults.hits).toHaveLength(2);
    });

    it("should have updatedLocalLogFilterField from composable", () => {
      expect(wrapper.vm.updatedLocalLogFilterField).toBeDefined();
    });
  });

  describe("Chart rendering", () => {
    let convertTraceDataStub;
    let wrapperLocal: any;
    beforeEach(async () => {
      const convertTraceData = (await import("@/utils/traces/convertTraceData"));
      convertTraceDataStub = vi.spyOn(convertTraceData, "convertTraceData");
      vi.resetModules();

      const SearchResult = (await import("@/plugins/traces/SearchResult.vue")).default;
        
        wrapperLocal = mount(SearchResult, {
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
            },
          },
        })

    });

    afterEach(() => {
        wrapper.unmount();
        vi.clearAllMocks();
      });

    it("should call reDrawChart on mount", () => {
      expect(wrapper.vm.plotChart).toBeDefined();
    });

    it("should handle chart data conversion", () => {
      expect(convertTraceDataStub).toHaveBeenCalledWith(
        mockSearchObj.data.histogram,
        mockStore.state.timezone
      );
    });
  });

  describe("Empty state handling", () => {
    it("should handle empty query results", async () => {
      const emptySearchObj = {
        ...mockSearchObj,
        data: {
          ...mockSearchObj.data,
          queryResults: {
            hits: [],
            from: 0,
          },
        },
      };

      vi.doMock("@/composables/useTraces", () => ({
        default: () => ({
          searchObj: emptySearchObj,
          updatedLocalLogFilterField: vi.fn(),
        }),
      }));

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
          },
        },
      });

      const traceCount = emptyWrapper.find('[data-test="traces-search-result-count"]');
      expect(traceCount.text()).toBe("0 Traces");

      emptyWrapper.unmount();
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
    it("should include ChartRenderer component", () => {
      expect(wrapper.vm.$options.components).toHaveProperty("ChartRenderer");
    });

    it("should include TraceBlock component", () => {
      expect(wrapper.vm.$options.components).toHaveProperty("TraceBlock");
    });
  });
});
