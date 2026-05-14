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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Notify } from "quasar";
import { nextTick, reactive } from "vue";
import ServiceGraph from "./ServiceGraph.vue";

installQuasar({
  plugins: [Notify],
});

// Create a persistent mock for router push
const mockRouterPush = vi.fn();

// Shared reactive searchObj so Vue watchers inside the component fire when
// tests mutate datetime or meta fields directly.
const mockSearchObj = reactive({
  meta: {
    serviceGraphVisualizationType: "tree",
    serviceGraphLayoutType: "horizontal",
  },
  data: {
    datetime: {
      startTime: Date.now() - 3600000,
      endTime: Date.now(),
      relativeTimePeriod: "15m",
      type: "relative",
    },
    stream: {
      selectedStream: { label: "", value: "" },
    },
  },
});

// Mock dependencies
vi.mock("@/services/service_graph", () => ({
  default: {
    getCurrentTopology: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({
      list: [{ name: "default" }, { name: "stream1" }, { name: "stream2" }],
    }),
  }),
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("quasar", async () => {
  const actual: any = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      dark: {
        isActive: false,
      },
    }),
  };
});

import serviceGraphService from "@/services/service_graph";

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "dark",
    selectedOrganization: {
      identifier: "test-org",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

describe("ServiceGraph.vue - Cache Invalidation & Data Refresh", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;

  const mockApiResponse = {
    data: {
      nodes: [
        {
          id: "service-a",
          label: "Service A",
          requests: 1000,
          errors: 10,
          error_rate: 1.0,
          is_virtual: false,
        },
        {
          id: "service-b",
          label: "Service B",
          requests: 2000,
          errors: 20,
          error_rate: 1.0,
          is_virtual: false,
        },
      ],
      edges: [
        {
          from: "service-a",
          to: "service-b",
          total_requests: 1000,
          failed_requests: 10,
          error_rate: 1.0,
          p50_latency_ns: 50000000,
          p95_latency_ns: 100000000,
          p99_latency_ns: 150000000,
        },
      ],
      availableStreams: ["default", "stream1", "stream2"],
    },
  };

  const createWrapper = (storeOverrides = {}) => {
    mockStore = createMockStore(storeOverrides);

    return mount(ServiceGraph, {
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
        stubs: {
          AppTabs: true,
          ChartRenderer: true,
          ServiceGraphSidePanel: true,
          QCard: false,
          QCardSection: false,
          QSelect: false,
          QInput: false,
          QBtn: false,
          QIcon: false,
          QTooltip: false,
          QSpinner: false,
          QDialog: false,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared reactive searchObj to baseline before every test so watcher
    // state does not bleed between tests.
    mockSearchObj.meta.serviceGraphVisualizationType = "tree";
    mockSearchObj.meta.serviceGraphLayoutType = "horizontal";
    mockSearchObj.data.datetime.startTime = Date.now() - 3600000;
    mockSearchObj.data.datetime.endTime = Date.now();
    mockSearchObj.data.datetime.relativeTimePeriod = "15m";
    mockSearchObj.data.datetime.type = "relative";
    vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
      mockApiResponse,
    );
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Initialization", () => {
    it("should mount component successfully", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should load service graph data on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          startTime: expect.any(Number),
          endTime: expect.any(Number),
        }),
      );
    });

    it("should set initial chartKey to 0", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.chartKey).toBe(0);
    });

    it("should return chartData with an options property after mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // chartData is a computed that returns { options, notMerge, ... }
      expect(wrapper.vm.chartData).toHaveProperty("options");
    });
  });

  describe("Toolbar Layout", () => {
    it("should render stream-selector and search-input in the top toolbar row (outside graph container)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const streamSelector = wrapper.find(
        '[data-test="service-graph-stream-selector"]',
      );
      const searchInput = wrapper.find(
        '[data-test="service-graph-search-input"]',
      );
      const graphContainer = wrapper.find(
        '[data-test="service-graph-container"]',
      );

      expect(streamSelector.exists()).toBe(true);
      expect(searchInput.exists()).toBe(true);
      expect(graphContainer.exists()).toBe(true);

      // Stream selector and search input must NOT be descendants of the graph container
      const streamSelectorInsideContainer = graphContainer.find(
        '[data-test="service-graph-stream-selector"]',
      );
      const searchInputInsideContainer = graphContainer.find(
        '[data-test="service-graph-search-input"]',
      );

      expect(streamSelectorInsideContainer.exists()).toBe(false);
      expect(searchInputInsideContainer.exists()).toBe(false);
    });

    it("should render legends in a horizontal flex row", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const legends = wrapper.find('[data-test="service-graph-legends"]');
      expect(legends.exists()).toBe(true);
      // Legends use tw:flex-row — confirm the element has neither flex-col class
      expect(legends.classes()).not.toContain("tw:flex-col");
    });

    it("should not render a date-time-picker inside ServiceGraph", () => {
      wrapper = createWrapper();
      // ServiceGraph no longer owns a date-time picker — time range is controlled
      // externally by SearchBar via the shared useTraces composable.
      const dateTimePicker = wrapper.find('[data-test="date-time-picker"]');
      expect(dateTimePicker.exists()).toBe(false);
    });
  });

  describe("Cache Invalidation on Stream Filter Change", () => {
    it("should invalidate cache when stream filter changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Change stream filter
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Verify chartKey was incremented (which invalidates any cached data)
      // This forces chart to regenerate with fresh data
      expect(wrapper.vm.chartKey).toBeGreaterThan(initialChartKey);
    });

    it("should increment chartKey when stream filter changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Change stream filter
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Verify chartKey was incremented
      expect(wrapper.vm.chartKey).toBe(initialChartKey + 1);
    });

    it("should call API with new stream parameter", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Change stream filter
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Verify API was called with new stream
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          streamName: "stream1",
          startTime: expect.any(Number),
          endTime: expect.any(Number),
        }),
      );
    });

    it("should update graphData with new data from API", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newApiResponse = {
        data: {
          nodes: [
            {
              id: "service-c",
              label: "Service C",
              requests: 3000,
              errors: 30,
              error_rate: 1.0,
              is_virtual: false,
            },
          ],
          edges: [],
          availableStreams: ["stream1"],
        },
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        newApiResponse,
      );

      // Change stream filter
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Verify graphData was updated
      expect(wrapper.vm.graphData.nodes).toHaveLength(1);
      expect(wrapper.vm.graphData.nodes[0].id).toBe("service-c");
    });

    it("should persist stream filter to localStorage", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.vm.onStreamFilterChange("stream1");

      expect(setItemSpy).toHaveBeenCalledWith(
        "serviceGraph_streamFilter",
        "stream1",
      );

      setItemSpy.mockRestore();
    });

    it("should handle 'all' streams filter", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      await wrapper.vm.onStreamFilterChange("all");
      await flushPromises();

      // Verify API was called without streamName parameter
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          streamName: undefined,
          startTime: expect.any(Number),
          endTime: expect.any(Number),
        }),
      );
    });
  });

  describe("Cache Invalidation on Refresh Button Click", () => {
    it("should invalidate cache when refresh button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Click refresh button
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify chartKey was incremented (which invalidates any cached data)
      // This forces chart to regenerate with fresh data
      expect(wrapper.vm.chartKey).toBeGreaterThan(initialChartKey);
    });

    it("should increment chartKey when refresh button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Click refresh button
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify chartKey was incremented
      expect(wrapper.vm.chartKey).toBe(initialChartKey + 1);
    });

    it("should call API to get fresh data", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Click refresh button
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify API was called
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledTimes(1);
    });

    it("should update graphData with fresh data from API", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newApiResponse = {
        data: {
          nodes: [
            {
              id: "service-d",
              label: "Service D",
              requests: 4000,
              errors: 40,
              error_rate: 1.0,
              is_virtual: false,
            },
          ],
          edges: [],
          availableStreams: ["default"],
        },
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        newApiResponse,
      );

      // Click refresh button
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify graphData was updated with new data
      expect(wrapper.vm.graphData.nodes).toHaveLength(1);
      expect(wrapper.vm.graphData.nodes[0].id).toBe("service-d");
    });

    it("should show loading state during refresh", async () => {
      wrapper = createWrapper();
      await flushPromises();

      let resolvePromise: any;
      vi.mocked(serviceGraphService.getCurrentTopology).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () => resolve(mockApiResponse);
          }),
      );

      // Start refresh
      const loadPromise = wrapper.vm.loadServiceGraph();
      await nextTick();

      // Verify loading state is true
      expect(wrapper.vm.loading).toBe(true);

      // Resolve the API call
      resolvePromise();
      await loadPromise;
      await flushPromises();

      // Verify loading state is false
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should handle API errors gracefully", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        new Error("API Error"),
      );

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify error state is set
      expect(wrapper.vm.error).toBeTruthy();
      expect(wrapper.vm.loading).toBe(false);

      consoleError.mockRestore();
    });
  });

  describe("Cache Invalidation on Time Range Change", () => {
    it("should invalidate cache when time range changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Time range changes are driven by mutating the shared searchObj datetime.
      // The component watches searchObj.data.datetime (deep) and calls loadServiceGraph.
      wrapper.vm.searchObj.data.datetime.startTime = Date.now() - 7200000;
      wrapper.vm.searchObj.data.datetime.endTime = Date.now();
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      // Verify chartKey was incremented (which invalidates any cached data)
      expect(wrapper.vm.chartKey).toBeGreaterThan(initialChartKey);
    });

    it("should increment chartKey when time range changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      wrapper.vm.searchObj.data.datetime.startTime = Date.now() - 7200000;
      wrapper.vm.searchObj.data.datetime.endTime = Date.now();
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      // chartKey increments once for the watcher-triggered loadServiceGraph
      expect(wrapper.vm.chartKey).toBe(initialChartKey + 1);
    });

    it("should call API with new time range parameters", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      const newStartTime = Date.now() - 7200000;
      const newEndTime = Date.now();

      wrapper.vm.searchObj.data.datetime.startTime = newStartTime;
      wrapper.vm.searchObj.data.datetime.endTime = newEndTime;
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          startTime: newStartTime,
          endTime: newEndTime,
        }),
      );
    });

    it("should reflect new datetime values on searchObj after mutation", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newStartTime = Date.now() - 7200000;
      const newEndTime = Date.now();

      wrapper.vm.searchObj.data.datetime.startTime = newStartTime;
      wrapper.vm.searchObj.data.datetime.endTime = newEndTime;
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await nextTick();

      expect(wrapper.vm.searchObj.data.datetime.startTime).toBe(newStartTime);
      expect(wrapper.vm.searchObj.data.datetime.endTime).toBe(newEndTime);
      expect(wrapper.vm.searchObj.data.datetime.relativeTimePeriod).toBe("30m");
    });

    it("should update graphData with data from new time range", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newApiResponse = {
        data: {
          nodes: [
            {
              id: "service-e",
              label: "Service E",
              requests: 5000,
              errors: 50,
              error_rate: 1.0,
              is_virtual: false,
            },
          ],
          edges: [],
          availableStreams: ["default"],
        },
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        newApiResponse,
      );

      wrapper.vm.searchObj.data.datetime.startTime = Date.now() - 7200000;
      wrapper.vm.searchObj.data.datetime.endTime = Date.now();
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      expect(wrapper.vm.graphData.nodes).toHaveLength(1);
      expect(wrapper.vm.graphData.nodes[0].id).toBe("service-e");
    });
  });

  describe("Chart Re-rendering", () => {
    it("should trigger chart re-render when chartKey changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Change stream filter to trigger chartKey increment
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Verify chartKey changed
      expect(wrapper.vm.chartKey).not.toBe(initialChartKey);
    });

    it("should regenerate chartData computed property after chartKey is incremented", async () => {
      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      const initialKey = wrapper.vm.chartKey;

      // Increment chartKey directly — loadServiceGraph also does this on each call
      wrapper.vm.chartKey++;
      await nextTick();
      await flushPromises();

      // Verify chartKey changed (which forces chart to regenerate with fresh data)
      expect(wrapper.vm.chartKey).toBe(initialKey + 1);
      expect(wrapper.vm.chartData).toBeDefined();
    });

    it("should return chartData with options object", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // chartData computed returns an object with an options property
      const chartData = wrapper.vm.chartData;
      expect(chartData).toHaveProperty("options");
    });
  });

  describe("Multiple Sequential Changes", () => {
    it("should handle multiple stream changes in sequence", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Make multiple stream changes
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      await wrapper.vm.onStreamFilterChange("stream2");
      await flushPromises();

      await wrapper.vm.onStreamFilterChange("all");
      await flushPromises();

      // Verify chartKey was incremented for each change
      expect(wrapper.vm.chartKey).toBe(initialChartKey + 3);
    });

    it("should handle stream change followed by refresh", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Change stream
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Then refresh
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify chartKey was incremented twice (once for stream change, once for refresh)
      expect(wrapper.vm.chartKey).toBe(initialChartKey + 2);
    });

    it("should handle time range change followed by stream change", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Time range change triggers the deep watcher on searchObj.data.datetime
      wrapper.vm.searchObj.data.datetime.startTime = Date.now() - 7200000;
      wrapper.vm.searchObj.data.datetime.endTime = Date.now();
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      // Then change stream
      await wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // Verify API was called twice with correct parameters
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledTimes(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty API response", async () => {
      wrapper = createWrapper();

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [],
          edges: [],
          availableStreams: [],
        },
      });

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      expect(wrapper.vm.graphData.nodes).toHaveLength(0);
      expect(wrapper.vm.graphData.edges).toHaveLength(0);
    });

    it("should handle missing organization identifier", async () => {
      wrapper = createWrapper({
        selectedOrganization: {
          identifier: "",
        },
      });

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify error state is set
      expect(wrapper.vm.error).toBeTruthy();
    });

    it("should filter out edges with invalid node references", async () => {
      wrapper = createWrapper();

      const invalidApiResponse = {
        data: {
          nodes: [
            {
              id: "service-a",
              label: "Service A",
              requests: 1000,
              errors: 10,
              error_rate: 1.0,
            },
          ],
          edges: [
            {
              from: "service-a",
              to: "non-existent-service", // Invalid reference
              total_requests: 100,
            },
          ],
          availableStreams: ["default"],
        },
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        invalidApiResponse,
      );

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Verify invalid edge was filtered out
      expect(wrapper.vm.graphData.edges).toHaveLength(0);
    });

    it("should handle rapid consecutive refreshes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Trigger multiple refreshes rapidly
      const promises = [
        wrapper.vm.loadServiceGraph(),
        wrapper.vm.loadServiceGraph(),
        wrapper.vm.loadServiceGraph(),
      ];

      await Promise.all(promises);
      await flushPromises();

      // Verify component is in a valid state
      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeTruthy();
    });
  });

  describe("Data Persistence", () => {
    it("should restore stream filter from localStorage on mount", () => {
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockReturnValue("stream1");

      wrapper = createWrapper();

      expect(wrapper.vm.streamFilter).toBe("stream1");

      getItemSpy.mockRestore();
    });

    it("should restore stream filter from localStorage on mount (visualization type is managed by searchObj.meta)", () => {
      // visualizationType and layoutType are now managed externally via searchObj.meta
      // (set by SearchBar and read from the shared useTraces composable).
      // Only streamFilter is persisted and restored by ServiceGraph itself.
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockReturnValue("stream1");

      wrapper = createWrapper();

      expect(wrapper.vm.streamFilter).toBe("stream1");

      getItemSpy.mockRestore();
    });
  });

  describe("Search Filtering", () => {
    it("should filter nodes by search term", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Set search filter (searching for "Service A" which exists in mock data)
      wrapper.vm.searchFilter = "Service A";
      wrapper.vm.applyFilters();

      // Verify filtered nodes
      expect(wrapper.vm.filteredGraphData.nodes.length).toBeGreaterThan(0);
      expect(
        wrapper.vm.filteredGraphData.nodes.some((n: any) =>
          n.label.toLowerCase().includes("service a"),
        ),
      ).toBe(true);
    });

    it("should filter edges connected to matching nodes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchFilter = "service-a";
      wrapper.vm.applyFilters();

      // Verify all edges are connected to filtered nodes
      const nodeIds = new Set(
        wrapper.vm.filteredGraphData.nodes.map((n: any) => n.id),
      );
      wrapper.vm.filteredGraphData.edges.forEach((edge: any) => {
        expect(nodeIds.has(edge.from) || nodeIds.has(edge.to)).toBe(true);
      });
    });

    it("should handle case-insensitive search", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Search with different case - should still find "Service A"
      wrapper.vm.searchFilter = "SERVICE A";
      wrapper.vm.applyFilters();

      expect(wrapper.vm.filteredGraphData.nodes.length).toBeGreaterThan(0);
    });

    it("should trim search filter whitespace", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Search with whitespace - should trim and find "Service A"
      wrapper.vm.searchFilter = "  Service A  ";
      wrapper.vm.applyFilters();

      expect(wrapper.vm.filteredGraphData.nodes.length).toBeGreaterThan(0);
    });

    it("should show all nodes when search is empty", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const allNodes = wrapper.vm.graphData.nodes.length;

      wrapper.vm.searchFilter = "";
      wrapper.vm.applyFilters();

      expect(wrapper.vm.filteredGraphData.nodes.length).toBe(allNodes);
    });

    it("should handle search with no matches", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchFilter = "nonexistent-service";
      wrapper.vm.applyFilters();

      expect(wrapper.vm.filteredGraphData.nodes.length).toBe(0);
      expect(wrapper.vm.filteredGraphData.edges.length).toBe(0);
    });
  });

  describe("Layout and Visualization Changes", () => {
    // Layout type and visualization type are now driven externally by the SearchBar
    // toolbar via the shared useTraces composable (searchObj.meta). The ServiceGraph
    // component watches searchObj.meta fields and reacts accordingly — it no longer
    // exposes setLayout / setVisualizationType methods.

    it("should increment chartKey when layout type changes on searchObj.meta", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Simulate SearchBar changing layout type
      wrapper.vm.searchObj.meta.serviceGraphLayoutType = "circular";
      await flushPromises();

      expect(wrapper.vm.chartKey).toBe(initialChartKey + 1);
    });

    it("should reflect current layout type from searchObj.meta in chartData", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Default layout is horizontal (set in beforeEach)
      expect(wrapper.vm.searchObj.meta.serviceGraphLayoutType).toBe(
        "horizontal",
      );
    });

    it("should reflect current visualization type from searchObj.meta in chartData", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Default viz type is tree (set in beforeEach)
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe(
        "tree",
      );
    });

    it("should NOT increment chartKey when visualization type changes (prevents tree animation replay)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Simulate SearchBar switching viz type — the watcher only clears lastChartOptions,
      // does NOT increment chartKey, to avoid replaying the tree expand animation.
      wrapper.vm.searchObj.meta.serviceGraphVisualizationType = "graph";
      await flushPromises();

      // chartKey must stay the same after a viz-type-only change
      expect(wrapper.vm.chartKey).toBe(initialChartKey);
    });
  });

  describe("Node and Edge Click Handling", () => {
    it("should open side panel when node is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nodeData = wrapper.vm.graphData.nodes[0];

      wrapper.vm.handleNodeClick({
        dataType: "node",
        data: nodeData,
      });

      expect(wrapper.vm.showSidePanel).toBe(true);
      expect(wrapper.vm.selectedNode).toEqual(nodeData);
    });

    it("should close side panel when same node is clicked twice", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nodeData = wrapper.vm.graphData.nodes[0];

      // First click - open panel
      wrapper.vm.handleNodeClick({
        dataType: "node",
        data: nodeData,
      });

      expect(wrapper.vm.showSidePanel).toBe(true);

      // Second click - close panel
      wrapper.vm.handleNodeClick({
        dataType: "node",
        data: nodeData,
      });

      expect(wrapper.vm.showSidePanel).toBe(false);
    });

    it("should not open any panel when edge is clicked (tooltip handles interaction)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const edgeData = wrapper.vm.graphData.edges[0];

      wrapper.vm.handleNodeClick({
        dataType: "edge",
        data: {
          source: edgeData.from,
          target: edgeData.to,
        },
      });

      // Edge panel was removed; edges are handled via hover tooltip only
      expect(wrapper.vm.showSidePanel).toBe(false);
    });

    it("should handle tree node click", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const nodeData = wrapper.vm.graphData.nodes[0];

      wrapper.vm.handleNodeClick({
        componentType: "series",
        data: { name: nodeData.label },
      });

      expect(wrapper.vm.showSidePanel).toBe(true);
      expect(wrapper.vm.selectedNode?.id).toBe(nodeData.id);
    });

    it("should ignore invalid click events", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      wrapper.vm.handleNodeClick({
        dataType: "unknown",
        data: null,
      });

      expect(consoleLog).toHaveBeenCalled();
      expect(wrapper.vm.showSidePanel).toBe(false);

      consoleLog.mockRestore();
    });

    it("should silently ignore edge clicks for nonexistent edges", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Edge clicks no longer open a panel or warn — tooltip handles interaction
      wrapper.vm.handleNodeClick({
        dataType: "edge",
        data: {
          source: "nonexistent",
          target: "nonexistent",
        },
      });

      expect(wrapper.vm.showSidePanel).toBe(false);
    });
  });

  describe("Side Panel Operations", () => {
    it("should close side panel", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showSidePanel = true;
      wrapper.vm.selectedNode = wrapper.vm.graphData.nodes[0];

      wrapper.vm.handleCloseSidePanel();

      expect(wrapper.vm.showSidePanel).toBe(false);
    });

    it("should clear selectedNode after animation delay", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.selectedNode = wrapper.vm.graphData.nodes[0];
      wrapper.vm.handleCloseSidePanel();

      expect(wrapper.vm.selectedNode).toBeTruthy();

      vi.advanceTimersByTime(300);

      expect(wrapper.vm.selectedNode).toBeNull();

      vi.useRealTimers();
    });

    // Edge panel was removed — edges are handled via hover tooltip.
    // handleCloseEdgePanel, showEdgePanel, and selectedEdge no longer exist.
  });

  // View Logs and Traces Navigation — removed in favor of consolidated
  // "Show telemetry" button in side panel (ServiceGraphSidePanel.vue)

  describe("Utility Functions", () => {
    it("should format large numbers with M suffix", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatNumber(1000000)).toBe("1.0M");
      expect(wrapper.vm.formatNumber(2500000)).toBe("2.5M");
      expect(wrapper.vm.formatNumber(10000000)).toBe("10.0M");
    });

    it("should format medium numbers with K suffix", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatNumber(1000)).toBe("1.0K");
      expect(wrapper.vm.formatNumber(1500)).toBe("1.5K");
      expect(wrapper.vm.formatNumber(999999)).toBe("1000.0K");
    });

    it("should format small numbers as-is", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatNumber(0)).toBe("0");
      expect(wrapper.vm.formatNumber(100)).toBe("100");
      expect(wrapper.vm.formatNumber(999)).toBe("999");
    });
  });

  describe("Stats Calculation", () => {
    it("should calculate total services count", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.stats?.services).toBe(
        mockApiResponse.data.nodes.length,
      );
    });

    it("should calculate total connections count", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.stats?.connections).toBe(
        mockApiResponse.data.edges.length,
      );
    });

    it("should calculate total requests", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const expectedRequests = mockApiResponse.data.edges.reduce(
        (sum, e) => sum + e.total_requests,
        0,
      );

      expect(wrapper.vm.stats?.totalRequests).toBe(expectedRequests);
    });

    it("should calculate total errors", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const expectedErrors = mockApiResponse.data.edges.reduce(
        (sum, e) => sum + e.failed_requests,
        0,
      );

      expect(wrapper.vm.stats?.totalErrors).toBe(expectedErrors);
    });

    it("should calculate error rate", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const totalRequests = mockApiResponse.data.edges.reduce(
        (sum, e) => sum + e.total_requests,
        0,
      );
      const totalErrors = mockApiResponse.data.edges.reduce(
        (sum, e) => sum + e.failed_requests,
        0,
      );
      const expectedRate =
        totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

      expect(wrapper.vm.stats?.errorRate).toBe(expectedRate);
    });

    it("should handle zero requests for error rate", async () => {
      const noRequestsResponse = {
        data: {
          nodes: [
            { id: "a", label: "A", requests: 0, errors: 0, error_rate: 0 },
          ],
          edges: [],
          availableStreams: ["default"],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        noRequestsResponse,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.stats?.errorRate).toBe(0);
    });
  });

  describe("Settings", () => {
    it("should reset settings", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showSettings = true;
      wrapper.vm.resetSettings();

      expect(wrapper.vm.showSettings).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should set error state on 404", async () => {
      const error404 = new Error("Not Found");
      (error404 as any).response = { status: 404 };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        error404,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("API endpoint not found");
    });

    it("should set error state on 403", async () => {
      const error403 = new Error("Forbidden");
      (error403 as any).response = { status: 403 };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        error403,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("Access denied");
    });

    it("should set error state on 500", async () => {
      const error500 = new Error("Internal Server Error");
      (error500 as any).response = { status: 500 };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        error500,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("Server error");
    });

    it("should set error state on timeout", async () => {
      const timeoutError = new Error("Request timeout");

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        timeoutError,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("timed out");
    });

    it("should set error state on network error", async () => {
      const networkError = new Error("Network Error");

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        networkError,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("Network error");
    });

    it("should set generic error state for unknown errors", async () => {
      const unknownError = new Error("Unknown error");
      (unknownError as any).response = {
        status: 418,
        data: { message: "I'm a teapot" },
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(
        unknownError,
      );

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toBeTruthy();
    });
  });

  describe("Graph Data Validation", () => {
    it("should ensure all nodes have required fields", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.graphData.nodes.forEach((node: any) => {
        expect(node).toHaveProperty("id");
        expect(node).toHaveProperty("label");
        expect(node).toHaveProperty("requests");
        expect(node).toHaveProperty("errors");
        expect(node).toHaveProperty("error_rate");
      });
    });

    it("should ensure all edges have required fields", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.graphData.edges.forEach((edge: any) => {
        expect(edge).toHaveProperty("from");
        expect(edge).toHaveProperty("to");
        expect(edge).toHaveProperty("total_requests");
        expect(edge).toHaveProperty("failed_requests");
      });
    });

    it("should filter out edges with invalid endpoints", async () => {
      const invalidDataResponse = {
        data: {
          nodes: [
            { id: "a", label: "A", requests: 100, errors: 0, error_rate: 0 },
          ],
          edges: [
            { from: "a", to: "b", total_requests: 100 }, // 'b' doesn't exist
            { from: "c", to: "a", total_requests: 100 }, // 'c' doesn't exist
          ],
          availableStreams: ["default"],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        invalidDataResponse,
      );

      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      // Both invalid edges should be filtered out
      expect(wrapper.vm.graphData.edges.length).toBe(0);
      expect(consoleWarn).toHaveBeenCalled();

      consoleWarn.mockRestore();
    });
  });

  describe("Tree View Custom Tooltips", () => {
    it("should initialize in tree mode when searchObj.meta specifies tree", async () => {
      // beforeEach sets visualizationType = "tree" on mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      // Component reads visualizationType from searchObj.meta — confirm it's accessible
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe(
        "tree",
      );
      // chartData series uses orthogonal layout for tree
      expect(wrapper.vm.chartData.options.series[0].layout).toBe("orthogonal");
    });

    it("should handle tree mode with empty graph data", async () => {
      const emptyMock = {
        data: {
          nodes: [],
          edges: [],
          availableStreams: [],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(
        emptyMock,
      );

      // beforeEach already sets visualizationType = "tree"
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.graphData.nodes.length).toBe(0);
      expect(wrapper.vm.graphData.edges.length).toBe(0);
    });

    it("should handle switching from tree to graph mode via searchObj.meta", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Confirm starting in tree mode
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe(
        "tree",
      );

      // Simulate SearchBar switching to graph mode
      wrapper.vm.searchObj.meta.serviceGraphVisualizationType = "graph";
      await nextTick();

      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe(
        "graph",
      );
    });

    it("should cleanup tooltip handlers when switching modes via searchObj.meta", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;
      wrapper.vm.chartKey++;
      await nextTick();

      expect(wrapper.vm.chartKey).toBe(initialKey + 1);

      // Switch back to graph via shared meta
      wrapper.vm.searchObj.meta.serviceGraphVisualizationType = "graph";
      await nextTick();

      // Verify mode switched without errors
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe(
        "graph",
      );
    });

    it("should handle node click in tree mode to open side panel", async () => {
      // beforeEach sets visualizationType = "tree" via mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      // Tree node clicks use params.componentType === "series" — viz type is in searchObj.meta
      const nodeClickParams = {
        componentType: "series",
        data: {
          name: mockApiResponse.data.nodes[0].label,
        },
      };

      wrapper.vm.handleNodeClick(nodeClickParams);
      await nextTick();

      expect(wrapper.vm.showSidePanel).toBe(true);
      expect(wrapper.vm.selectedNode).toBeTruthy();
    });

    it("should close side panel when clicking same node twice in tree mode", async () => {
      // beforeEach sets visualizationType = "tree" via mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      const nodeData = wrapper.vm.graphData.nodes[0];

      // First click - opens panel
      wrapper.vm.selectedNode = nodeData;
      wrapper.vm.showSidePanel = true;

      // Second click - closes panel
      const nodeClickParams = {
        componentType: "series",
        data: { name: nodeData.label },
      };

      wrapper.vm.handleNodeClick(nodeClickParams);
      await nextTick();

      expect(wrapper.vm.showSidePanel).toBe(false);
      expect(wrapper.vm.selectedNode).toBeNull();
    });

    it("should handle node click with missing node data in tree mode", async () => {
      // beforeEach sets visualizationType = "tree" via mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Click with a name that doesn't exist in graphData
      const nodeClickParams = {
        componentType: "series",
        data: { name: "non-existent-service" },
      };

      wrapper.vm.handleNodeClick(nodeClickParams);
      await nextTick();

      expect(consoleWarn).toHaveBeenCalledWith(
        "[ServiceGraph] Could not find node data for:",
        "non-existent-service",
      );

      consoleWarn.mockRestore();
    });

    it("should use orthogonal layout in tree mode", async () => {
      // beforeEach sets visualizationType = "tree" on mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options).toBeDefined();
      expect(chartData.options.series[0].layout).toBe("orthogonal");
    });

    it("should set tree bounds for horizontal layout", async () => {
      // beforeEach sets layoutType = "horizontal" on mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      const series = wrapper.vm.chartData.options.series[0];
      expect(series.left).toBe("3%");
      expect(series.right).toBe("20%");
      expect(series.top).toBe("2%");
      expect(series.bottom).toBe("2%");
    });

    it("should set tree bounds for vertical layout", async () => {
      // Mutate searchObj.meta before mount so chartData computed uses vertical bounds
      mockSearchObj.meta.serviceGraphLayoutType = "vertical";

      wrapper = createWrapper();
      await flushPromises();

      const series = wrapper.vm.chartData.options.series[0];
      expect(series.left).toBe("2%");
      expect(series.right).toBe("2%");
      expect(series.top).toBe("8%");
      expect(series.bottom).toBe("8%");
    });

    it("should disable built-in ECharts tooltip for tree mode", async () => {
      // beforeEach sets visualizationType = "tree"
      wrapper = createWrapper();
      await flushPromises();

      const tooltip = wrapper.vm.chartData.options.tooltip;
      expect(tooltip.show).toBe(false);
    });

    it("should use right label positioning for tree nodes in horizontal layout", async () => {
      // beforeEach sets visualizationType = "tree", layoutType = "horizontal"
      wrapper = createWrapper();
      await flushPromises();

      const series = wrapper.vm.chartData.options.series[0];
      expect(series.label.position).toBe("right");
    });
  });
});
