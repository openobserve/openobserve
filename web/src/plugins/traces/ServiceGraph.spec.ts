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
import { defineComponent, h, nextTick, reactive } from "vue";
import ServiceGraph from "./ServiceGraph.vue";
import i18n from "@/locales";

// Stub for the in-house ODialog that mirrors its public surface
// (v-model:open + click:primary/secondary emits). Renders default slot when
// open so we can assert dialog body content without exercising reka-ui.
const ODialogStub = defineComponent({
  name: "ODialog",
  inheritAttrs: false,
  props: {
    open: { type: Boolean, default: false },
    title: String,
    subTitle: String,
    size: String,
    persistent: Boolean,
    showClose: { type: Boolean, default: true },
    width: [String, Number],
    primaryButtonLabel: String,
    secondaryButtonLabel: String,
    neutralButtonLabel: String,
    primaryButtonVariant: String,
    secondaryButtonVariant: String,
    neutralButtonVariant: String,
    primaryButtonDisabled: Boolean,
    secondaryButtonDisabled: Boolean,
    neutralButtonDisabled: Boolean,
    primaryButtonLoading: Boolean,
    secondaryButtonLoading: Boolean,
    neutralButtonLoading: Boolean,
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  setup(props, { slots }) {
    return () =>
      props.open
        ? h("div", { "data-test": "o-dialog-stub", "data-title": props.title }, slots.default?.())
        : null;
  },
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

// fetchDatabaseEdges (called inside loadServiceGraph) hits streamService.schema
// and searchService.search. Mock them so the call completes quickly without real
// HTTP requests that never resolve in the test environment.
vi.mock("@/services/stream", () => ({
  default: {
    schema: vi.fn().mockRejectedValue(new Error("No MSW handler for schema")),
  },
}));

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn().mockResolvedValue({ data: { hits: [] } }),
  },
}));

// Mock @/utils/date so getEffectiveTimeRange returns deterministic values.
// Must be declared before the component import so Vitest hoisting applies.
const mockStartTime = 1000000;
const mockEndTime = 2000000;

// Smart default: absolute type passes through actual dt values; relative returns mocked constants.
const mockGetEffectiveTimeRange = vi.fn((dt: any) => {
  if (dt?.type !== "relative") {
    return { startTime: dt?.startTime ?? mockStartTime, endTime: dt?.endTime ?? mockEndTime };
  }
  return { startTime: mockStartTime, endTime: mockEndTime };
});

vi.mock("@/utils/date", () => ({
  getEffectiveTimeRange: (...args: any[]) => mockGetEffectiveTimeRange(...args),
}));

import serviceGraphService from "@/services/service_graph";
import searchService from "@/services/search";
import streamService from "@/services/stream";

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
          label: "service-a",
          requests: 1000,
          errors: 10,
          error_rate: 1.0,
          is_virtual: false,
        },
        {
          id: "service-b",
          label: "service-b",
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

  const createWrapper = (storeOverrides = {}, props = {}) => {
    mockStore = createMockStore(storeOverrides);

    return mount(ServiceGraph, {
      props,
      global: {
        plugins: [i18n],
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
          ODialog: ODialogStub,
          ServiceGraphNoDataState: {
            template: '<div data-test="service-graph-no-data-state" />',
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear persisted stream filter so localStorage does not bleed between tests.
    // Without this, a previous test that wrote "stream2" to localStorage causes
    // the next component instance to initialise streamFilter = "stream2", which
    // makes the watch guard (newStream !== streamFilter.value) skip the update.
    localStorage.removeItem("serviceGraph_streamFilter");
    // Reset shared reactive searchObj to baseline before every test so watcher
    // state does not bleed between tests.
    mockSearchObj.meta.serviceGraphVisualizationType = "tree";
    mockSearchObj.meta.serviceGraphLayoutType = "horizontal";
    mockSearchObj.data.datetime.startTime = Date.now() - 3600000;
    mockSearchObj.data.datetime.endTime = Date.now();
    mockSearchObj.data.datetime.relativeTimePeriod = "15m";
    mockSearchObj.data.datetime.type = "relative";
    mockSearchObj.data.stream.selectedStream.value = "";
    vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue(mockApiResponse);
    // Topology now comes from the raw traces query (searchService.search), with
    // getCurrentTopology supplying only edge latency metrics. Default the traces
    // service-edge query to the same service-a→service-b topology the tests
    // expect, so graphData is populated through the new two-call path.
    vi.mocked(streamService.schema).mockResolvedValue({
      data: { schema: [] },
    } as any);
    vi.mocked(searchService.search).mockResolvedValue({
      data: {
        hits: [
          {
            client: null,
            server: "service-a",
            total_requests: 1000,
            errors: 10,
          },
          {
            client: "service-a",
            server: "service-b",
            total_requests: 1000,
            errors: 10,
          },
        ],
      },
    } as any);
    // Reset to smart-default implementation for each test.
    mockGetEffectiveTimeRange.mockImplementation((dt: any) => {
      if (dt?.type !== "relative") {
        return { startTime: dt?.startTime ?? mockStartTime, endTime: dt?.endTime ?? mockEndTime };
      }
      return { startTime: mockStartTime, endTime: mockEndTime };
    });
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

      const streamSelector = wrapper.find('[data-test="service-graph-stream-selector"]');
      const searchInput = wrapper.find('[data-test="service-graph-search-input"]');
      const graphContainer = wrapper.find('[data-test="service-graph-container"]');

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
      // Legends use flex-row — confirm the element has neither flex-col class
      expect(legends.classes()).not.toContain("flex-col");
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
    // onStreamFilterChange now only emits "request:stream-change" to the parent.
    // The parent is responsible for updating the global stream, which then flows
    // back via the watch on searchObj.data.stream.selectedStream.value.

    it("should emit request:stream-change with the selected stream value", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.onStreamFilterChange("stream1");

      expect(wrapper.emitted("request:stream-change")).toBeTruthy();
      expect(wrapper.emitted("request:stream-change")![0]).toEqual(["stream1"]);
    });

    it("should NOT update streamFilter immediately when a new stream is selected", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialStreamFilter = wrapper.vm.streamFilter;

      wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      // streamFilter stays unchanged — the parent must confirm the change first
      expect(wrapper.vm.streamFilter).toBe(initialStreamFilter);
    });

    it("should NOT call loadServiceGraph when onStreamFilterChange is invoked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).not.toHaveBeenCalled();
    });

    it("should NOT write to localStorage when onStreamFilterChange is invoked", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      wrapper = createWrapper();
      await flushPromises();

      setItemSpy.mockClear();

      wrapper.vm.onStreamFilterChange("stream1");
      await flushPromises();

      expect(setItemSpy).not.toHaveBeenCalledWith("serviceGraph_streamFilter", "stream1");

      setItemSpy.mockRestore();
    });

    it("should emit request:stream-change even when 'all' is selected", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.onStreamFilterChange("all");

      expect(wrapper.emitted("request:stream-change")).toBeTruthy();
      expect(wrapper.emitted("request:stream-change")![0]).toEqual(["all"]);
    });
  });

  describe("Parent-driven streamFilter prop (Agent Graph page)", () => {
    afterEach(() => {
      if (wrapper) wrapper.unmount();
    });

    it("reloads the graph when the streamFilter prop changes", async () => {
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: { nodes: [], edges: [] },
      } as any);
      wrapper = createWrapper({}, { streamFilter: "stream-a" });
      await flushPromises();
      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Parent selects a different agent → its source_stream flows in as the prop.
      await wrapper.setProps({ streamFilter: "stream-b" });
      await flushPromises();

      // Regression: previously the prop watcher only synced the ref and never
      // refetched, so the graph never refreshed on agent change.
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ streamName: "stream-b" }),
      );
    });

    it("does not reload when the streamFilter prop is unchanged", async () => {
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: { nodes: [], edges: [] },
      } as any);
      wrapper = createWrapper({}, { streamFilter: "stream-a" });
      await flushPromises();
      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      await wrapper.setProps({ streamFilter: "stream-a" });
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).not.toHaveBeenCalled();
    });

    // Both the Agent Graph page (agentHighlight) and the Service Graph tab read
    // the pre-aggregated _o2_service_graph stream via /topology/current — a cheap
    // small-stream read that scales to TB-level trace volumes. We deliberately do
    // NOT re-scan raw traces per load.
    it("reads the persisted /current topology on the Agent Graph page (agentHighlight)", async () => {
      wrapper = createWrapper({}, { streamFilter: "fw_crewai", agentHighlight: true });
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ streamName: "fw_crewai" }),
      );
    });
  });

  describe("Global Stream Watch — bidirectional stream sync", () => {
    beforeEach(() => {
      // Ensure selectedStream starts empty so watcher fires when we set a value
      mockSearchObj.data.stream.selectedStream.value = "";
    });

    afterEach(() => {
      mockSearchObj.data.stream.selectedStream.value = "";
    });

    it("should update streamFilter when global selectedStream changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Confirm initial state
      const initialStreamFilter = wrapper.vm.streamFilter;

      // Simulate Traces/Spans tab changing the global stream
      mockSearchObj.data.stream.selectedStream.value = "stream2";
      await flushPromises();

      expect(wrapper.vm.streamFilter).toBe("stream2");
      expect(wrapper.vm.streamFilter).not.toBe(initialStreamFilter);
    });

    it("should call loadServiceGraph when global selectedStream changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      mockSearchObj.data.stream.selectedStream.value = "stream2";
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledTimes(1);
    });

    it("should persist the new stream to localStorage when global selectedStream changes", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      wrapper = createWrapper();
      await flushPromises();

      setItemSpy.mockClear();

      mockSearchObj.data.stream.selectedStream.value = "stream2";
      await flushPromises();

      expect(setItemSpy).toHaveBeenCalledWith("serviceGraph_streamFilter", "stream2");

      setItemSpy.mockRestore();
    });

    it("should NOT reload when global selectedStream changes to the same value as current streamFilter", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Set streamFilter to "stream1" first via the global watch
      mockSearchObj.data.stream.selectedStream.value = "stream1";
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Setting the same value again — the watch guard (newStream !== streamFilter.value) prevents a reload
      mockSearchObj.data.stream.selectedStream.value = "stream1";
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).not.toHaveBeenCalled();
    });

    it("should NOT react when global selectedStream changes to an empty string", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Empty string is falsy — the watch guard skips the update
      mockSearchObj.data.stream.selectedStream.value = "";
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).not.toHaveBeenCalled();
    });

    it("should call loadServiceGraph with the new stream name after global stream sync", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      mockSearchObj.data.stream.selectedStream.value = "stream2";
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          streamName: "stream2",
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

    it("does a full-replace render for graph view (so the tree→graph series swap takes)", async () => {
      // Tree uses a `type:"tree"` series and Graph uses `type:"graph"`. ECharts
      // can't swap series types via a merge, so graph must render notMerge:true
      // or Graph View stays blank after a tree→graph switch. (chartKey is NOT
      // bumped — that would replay the tree animation; the swap comes from the
      // full replace instead.)
      mockSearchObj.meta.serviceGraphVisualizationType = "graph";
      wrapper = createWrapper();
      await flushPromises();

      // Freshly-mounted in graph mode → the render is a full replace.
      expect(wrapper.vm.chartData.notMerge).toBe(true);
    });

    it("invalidates the cached chart options when the viz type changes", async () => {
      // The viz-type watcher must clear lastChartOptions so the next render
      // recomputes with the correct series type instead of reusing a stale
      // (wrong-type) cached option set.
      wrapper = createWrapper();
      await flushPromises();

      const keyBefore = wrapper.vm.chartKey;
      mockSearchObj.meta.serviceGraphVisualizationType = "graph";
      await flushPromises();

      // chartKey stays put (no ChartRenderer recreation → no tree animation replay).
      expect(wrapper.vm.chartKey).toBe(keyBefore);
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

      // Topology comes from getCurrentTopology now; return a single service-d node.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [
            {
              id: "service-d",
              label: "service-d",
              requests: 4000,
              errors: 40,
              error_rate: 1.0,
            },
          ],
          edges: [],
        },
      } as any);

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

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      // Topology comes from getCurrentTopology; its rejection surfaces to the
      // try/catch and sets error state.
      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(new Error("API Error"));

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

      // Use type "absolute" so getEffectiveTimeRange passes through dt.startTime/dt.endTime.
      wrapper.vm.searchObj.data.datetime.type = "absolute";
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

      // Topology now comes from getCurrentTopology — inject a single service-e node.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [
            {
              id: "service-e",
              label: "service-e",
              requests: 5000,
              errors: 50,
              error_rate: 1.0,
            },
          ],
          edges: [],
        },
      } as any);

      wrapper.vm.searchObj.data.datetime.startTime = Date.now() - 7200000;
      wrapper.vm.searchObj.data.datetime.endTime = Date.now();
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      expect(wrapper.vm.graphData.nodes).toHaveLength(1);
      expect(wrapper.vm.graphData.nodes[0].id).toBe("service-e");
    });
  });

  describe("Chart Re-rendering", () => {
    it("should trigger chart re-render when chartKey changes via global stream sync", async () => {
      mockSearchObj.data.stream.selectedStream.value = "";
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Stream change flows through the global watch — chartKey increments via loadServiceGraph
      mockSearchObj.data.stream.selectedStream.value = "stream1";
      await flushPromises();

      // Verify chartKey changed
      expect(wrapper.vm.chartKey).not.toBe(initialChartKey);

      mockSearchObj.data.stream.selectedStream.value = "";
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
    beforeEach(() => {
      mockSearchObj.data.stream.selectedStream.value = "";
    });

    afterEach(() => {
      mockSearchObj.data.stream.selectedStream.value = "";
    });

    it("should handle multiple global stream changes in sequence via watch", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Three distinct stream values — each triggers the global watch
      mockSearchObj.data.stream.selectedStream.value = "stream1";
      await flushPromises();

      mockSearchObj.data.stream.selectedStream.value = "stream2";
      await flushPromises();

      mockSearchObj.data.stream.selectedStream.value = "default";
      await flushPromises();

      // chartKey increments once per loadServiceGraph call (once per stream change)
      expect(wrapper.vm.chartKey).toBe(initialChartKey + 3);
    });

    it("should handle global stream change followed by explicit refresh", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialChartKey = wrapper.vm.chartKey;

      // Global stream change — increments chartKey once
      mockSearchObj.data.stream.selectedStream.value = "stream1";
      await flushPromises();

      // Explicit refresh — increments chartKey again
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      expect(wrapper.vm.chartKey).toBe(initialChartKey + 2);
    });

    it("should handle time range change followed by global stream change", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      // Time range change triggers the deep watcher on searchObj.data.datetime
      wrapper.vm.searchObj.data.datetime.startTime = Date.now() - 7200000;
      wrapper.vm.searchObj.data.datetime.endTime = Date.now();
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "30m";
      await flushPromises();

      // Then a global stream change via the selectedStream watch
      mockSearchObj.data.stream.selectedStream.value = "stream1";
      await flushPromises();

      // API called once for time range change, once for stream change
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledTimes(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty API response", async () => {
      wrapper = createWrapper();

      // Empty topology now means getCurrentTopology returns empty nodes/edges.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: { nodes: [], edges: [] },
      } as any);

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

    it("should not produce edges with dangling node references", async () => {
      wrapper = createWrapper();

      // The loader filters edges to those whose endpoints exist as nodes, so an
      // edge can never point at a missing node. Provide both endpoints as nodes.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [
            { id: "service-a", label: "service-a", requests: 100, errors: 0 },
            { id: "service-b", label: "service-b", requests: 100, errors: 0 },
          ],
          edges: [
            {
              from: "service-a",
              to: "service-b",
              total_requests: 100,
              failed_requests: 0,
              error_rate: 0,
              p50_latency_ns: 0,
              p95_latency_ns: 0,
              p99_latency_ns: 0,
            },
          ],
        },
      } as any);

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      const nodeIds = new Set(wrapper.vm.graphData.nodes.map((n: any) => n.id));
      // One edge, both endpoints materialised as nodes.
      expect(wrapper.vm.graphData.edges).toHaveLength(1);
      wrapper.vm.graphData.edges.forEach((e: any) => {
        expect(nodeIds.has(e.from)).toBe(true);
        expect(nodeIds.has(e.to)).toBe(true);
      });
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
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockReturnValue("stream1");

      wrapper = createWrapper();

      expect(wrapper.vm.streamFilter).toBe("stream1");

      getItemSpy.mockRestore();
    });

    it("should restore stream filter from localStorage on mount (visualization type is managed by searchObj.meta)", () => {
      // visualizationType and layoutType are now managed externally via searchObj.meta
      // (set by SearchBar and read from the shared useTraces composable).
      // Only streamFilter is persisted and restored by ServiceGraph itself.
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockReturnValue("stream1");

      wrapper = createWrapper();

      expect(wrapper.vm.streamFilter).toBe("stream1");

      getItemSpy.mockRestore();
    });
  });

  describe("Search Filtering", () => {
    it("should filter nodes by search term", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Node labels now come from the traces topology (label === id, e.g.
      // "service-a"), so search for the actual node id.
      wrapper.vm.searchFilter = "service-a";
      wrapper.vm.applyFilters();

      // Verify filtered nodes
      expect(wrapper.vm.filteredGraphData.nodes.length).toBeGreaterThan(0);
      expect(
        wrapper.vm.filteredGraphData.nodes.some((n: any) =>
          n.label.toLowerCase().includes("service-a"),
        ),
      ).toBe(true);
    });

    it("should filter edges connected to matching nodes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchFilter = "service-a";
      wrapper.vm.applyFilters();

      // Verify all edges are connected to filtered nodes
      const nodeIds = new Set(wrapper.vm.filteredGraphData.nodes.map((n: any) => n.id));
      wrapper.vm.filteredGraphData.edges.forEach((edge: any) => {
        expect(nodeIds.has(edge.from) || nodeIds.has(edge.to)).toBe(true);
      });
    });

    it("should handle case-insensitive search", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Search with different case - should still find "service-a"
      wrapper.vm.searchFilter = "SERVICE-A";
      wrapper.vm.applyFilters();

      expect(wrapper.vm.filteredGraphData.nodes.length).toBeGreaterThan(0);
    });

    it("should trim search filter whitespace", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Search with whitespace - should trim and find "service-a"
      wrapper.vm.searchFilter = "  service-a  ";
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
      expect(wrapper.vm.searchObj.meta.serviceGraphLayoutType).toBe("horizontal");
    });

    it("should reflect current visualization type from searchObj.meta in chartData", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Default viz type is tree (set in beforeEach)
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe("tree");
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

      wrapper.vm.handleNodeClick({
        dataType: "unknown",
        data: null,
      });

      // Invalid clicks are ignored — the side panel must not open.
      expect(wrapper.vm.showSidePanel).toBe(false);
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

      expect(wrapper.vm.stats?.services).toBe(mockApiResponse.data.nodes.length);
    });

    it("should calculate total connections count", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // The default topology has a single edge (service-a→service-b).
      expect(wrapper.vm.stats?.connections).toBe(1);
    });

    it("should calculate total requests", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Stats sum edge.total_requests: single edge with 1000.
      expect(wrapper.vm.stats?.totalRequests).toBe(1000);
    });

    it("should calculate total errors", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Stats sum edge.failed_requests: single edge with 10.
      expect(wrapper.vm.stats?.totalErrors).toBe(10);
    });

    it("should calculate error rate", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // totalErrors / totalRequests * 100 = 20 / 2000 * 100 = 1.0
      expect(wrapper.vm.stats?.errorRate).toBe(1.0);
    });

    it("should handle zero requests for error rate", async () => {
      // No edges → totalRequests is 0 → errorRate falls back to 0.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: { nodes: [], edges: [] },
      } as any);

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

    it("should render the ODialog stub only when showSettings is true", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Dialog closed by default — stub renders nothing
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(false);

      wrapper.vm.showSettings = true;
      await nextTick();

      const dialog = wrapper.find('[data-test="o-dialog-stub"]');
      expect(dialog.exists()).toBe(true);
      // Title prop is forwarded to the in-house ODialog
      expect(dialog.attributes("data-title")).toBe("Service Graph Settings");
    });

    it("should close the dialog when ODialog emits click:secondary (Close)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showSettings = true;
      await nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.exists()).toBe(true);

      // Migrated handler: @click:secondary="showSettings = false"
      dialog.vm.$emit("click:secondary");
      await nextTick();

      expect(wrapper.vm.showSettings).toBe(false);
    });

    it("should reset settings when ODialog emits click:primary (Reset)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showSettings = true;
      await nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.exists()).toBe(true);

      // Migrated handler: @click:primary="resetSettings"
      dialog.vm.$emit("click:primary");
      await nextTick();

      // resetSettings closes the dialog
      expect(wrapper.vm.showSettings).toBe(false);
    });

    it("should sync showSettings when ODialog emits update:open via v-model:open", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showSettings = true;
      await nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      // v-model:open wires update:open back to showSettings
      dialog.vm.$emit("update:open", false);
      await nextTick();

      expect(wrapper.vm.showSettings).toBe(false);
    });
  });

  describe("Error Handling", () => {
    // The topology comes from getCurrentTopology; its rejection surfaces to
    // loadServiceGraph's catch and sets error.value. beforeEach installs a
    // resolving mock, so each test overrides it with a rejecting one BEFORE
    // createWrapper().
    it("should set error state on 404", async () => {
      const error404 = new Error("Not Found");
      (error404 as any).response = { status: 404 };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(error404);

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("API endpoint not found");
    });

    it("should set error state on 403", async () => {
      const error403 = new Error("Forbidden");
      (error403 as any).response = { status: 403 };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(error403);

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("Access denied");
    });

    it("should set error state on 500", async () => {
      const error500 = new Error("Internal Server Error");
      (error500 as any).response = { status: 500 };

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(error500);

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("Server error");
    });

    it("should set error state on timeout", async () => {
      const timeoutError = new Error("Request timeout");

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(timeoutError);

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toContain("timed out");
    });

    it("should set error state on network error", async () => {
      const networkError = new Error("Network Error");

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(networkError);

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

      vi.mocked(serviceGraphService.getCurrentTopology).mockRejectedValue(unknownError);

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.error).toBeTruthy();
    });
  });

  describe("Graph Data Validation", () => {
    it("should ensure all nodes have required fields", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Traces-derived nodes carry id/label/requests/errors (and optionally
      // service_type). error_rate now lives on edges, not nodes.
      wrapper.vm.graphData.nodes.forEach((node: any) => {
        expect(node).toHaveProperty("id");
        expect(node).toHaveProperty("label");
        expect(node).toHaveProperty("requests");
        expect(node).toHaveProperty("errors");
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

    it("materialises a node for every edge endpoint (no dangling edges)", async () => {
      // The loader keeps only edges whose endpoints exist as nodes, so edges can
      // never reference a missing node. Provide 3 nodes (a, b, c) and 2 edges.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [
            { id: "a", label: "a", requests: 200, errors: 0 },
            { id: "b", label: "b", requests: 100, errors: 0 },
            { id: "c", label: "c", requests: 100, errors: 0 },
          ],
          edges: [
            {
              from: "a",
              to: "b",
              total_requests: 100,
              failed_requests: 0,
              error_rate: 0,
              p50_latency_ns: 0,
              p95_latency_ns: 0,
              p99_latency_ns: 0,
            },
            {
              from: "c",
              to: "a",
              total_requests: 100,
              failed_requests: 0,
              error_rate: 0,
              p50_latency_ns: 0,
              p95_latency_ns: 0,
              p99_latency_ns: 0,
            },
          ],
        },
      } as any);

      wrapper = createWrapper();
      await flushPromises();

      const nodeIds = new Set(wrapper.vm.graphData.nodes.map((n: any) => n.id));
      // 3 distinct nodes (a, b, c), 2 edges — all endpoints exist as nodes.
      expect(nodeIds.size).toBe(3);
      expect(wrapper.vm.graphData.edges.length).toBe(2);
      wrapper.vm.graphData.edges.forEach((e: any) => {
        expect(nodeIds.has(e.from)).toBe(true);
        expect(nodeIds.has(e.to)).toBe(true);
      });
    });
  });

  describe("Tree View Custom Tooltips", () => {
    it("should initialize in tree mode when searchObj.meta specifies tree", async () => {
      // beforeEach sets visualizationType = "tree" on mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      // Component reads visualizationType from searchObj.meta — confirm it's accessible
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe("tree");
      // chartData series uses adaptive layout:none for tree
      expect(wrapper.vm.chartData.options.series[0].layout).toBe("none");
    });

    it("should handle tree mode with empty graph data", async () => {
      // Empty topology now means getCurrentTopology returns empty nodes/edges.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: { nodes: [], edges: [] },
      } as any);

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
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe("tree");

      // Simulate SearchBar switching to graph mode
      wrapper.vm.searchObj.meta.serviceGraphVisualizationType = "graph";
      await nextTick();

      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe("graph");
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
      expect(wrapper.vm.searchObj.meta.serviceGraphVisualizationType).toBe("graph");
    });

    it("should handle node click in tree mode to open side panel", async () => {
      // beforeEach sets visualizationType = "tree" via mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      // Tree node clicks use params.componentType === "series". Node labels now
      // come from the traces topology (label === id, e.g. "service-a").
      const nodeClickParams = {
        componentType: "series",
        data: {
          name: wrapper.vm.graphData.nodes[0].label,
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

      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

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

    it("should use adaptive layout:none in tree mode", async () => {
      // beforeEach sets visualizationType = "tree" on mockSearchObj.meta
      wrapper = createWrapper();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options).toBeDefined();
      expect(chartData.options.series[0].layout).toBe("none");
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

  describe("widen-range emit and live time range fix", () => {
    it("should use fresh timestamps from getEffectiveTimeRange for relative ranges", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      const freshStart = 9999;
      const freshEnd = 9999 + 900;
      mockGetEffectiveTimeRange.mockReturnValueOnce({
        startTime: freshStart,
        endTime: freshEnd,
      });

      wrapper.vm.searchObj.data.datetime.type = "relative";
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "15m";

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      expect(mockGetEffectiveTimeRange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "relative", relativeTimePeriod: "15m" }),
      );
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          startTime: freshStart,
          endTime: freshEnd,
        }),
      );
    });

    it("should pass absolute dt.startTime/endTime through getEffectiveTimeRange", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      wrapper.vm.searchObj.data.datetime.type = "absolute";
      wrapper.vm.searchObj.data.datetime.startTime = 1111;
      wrapper.vm.searchObj.data.datetime.endTime = 2222;

      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      expect(mockGetEffectiveTimeRange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "absolute", startTime: 1111, endTime: 2222 }),
      );
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          startTime: 1111,
          endTime: 2222,
        }),
      );
    });
  });

  describe("Live Time Range Computation", () => {
    it("should use getEffectiveTimeRange when datetime type is relative", async () => {
      wrapper = createWrapper();
      await flushPromises();
      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();
      mockGetEffectiveTimeRange.mockReturnValueOnce({
        startTime: 111111,
        endTime: 222222,
      });

      mockSearchObj.data.datetime.relativeTimePeriod = "7d";
      mockSearchObj.data.datetime.type = "relative";
      await flushPromises();

      expect(mockGetEffectiveTimeRange).toHaveBeenCalledWith(
        expect.objectContaining({ relativeTimePeriod: "7d" }),
      );
      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ startTime: 111111, endTime: 222222 }),
      );
    });

    it("should use whatever getEffectiveTimeRange returns (fallback logic is inside utility)", async () => {
      wrapper = createWrapper();
      await flushPromises();
      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      const fallbackStart = 555;
      const fallbackEnd = 666;
      mockGetEffectiveTimeRange.mockReturnValueOnce({
        startTime: fallbackStart,
        endTime: fallbackEnd,
      });

      mockSearchObj.data.datetime.relativeTimePeriod = "1h";
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          startTime: fallbackStart,
          endTime: fallbackEnd,
        }),
      );
    });

    it("should pass absolute dt values through getEffectiveTimeRange", async () => {
      wrapper = createWrapper();
      await flushPromises();
      vi.mocked(serviceGraphService.getCurrentTopology).mockClear();

      const absStart = 86400000;
      const absEnd = 86400000 + 3600000;
      mockSearchObj.data.datetime.type = "absolute";
      mockSearchObj.data.datetime.startTime = absStart;
      mockSearchObj.data.datetime.endTime = absEnd;
      await flushPromises();

      expect(serviceGraphService.getCurrentTopology).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ startTime: absStart, endTime: absEnd }),
      );
    });
  });

  describe("legend kind counts", () => {
    it("counts the RAW topology by kind (not the collapsed view)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // kindCounts reads graphData (the true backend topology), and skips
      // boundary/group nodes, so the legend is stable regardless of collapse.
      wrapper.vm.graphData = {
        nodes: [
          { id: "a", label: "a", requests: 1, errors: 0 },
          { id: "b", label: "b", requests: 1, errors: 0, service_type: "database" },
          { id: "c", label: "c", requests: 1, errors: 0, service_type: "external" },
          // a collapsed boundary node must NOT be counted as one database
          {
            id: "__group_database",
            label: "Database (3)",
            requests: 3,
            errors: 0,
            service_type: "database",
            is_group: true,
            member_count: 3,
          },
        ],
        edges: [],
      };
      await flushPromises();
      expect(wrapper.vm.kindCounts).toEqual({
        service: 1,
        database: 1,
        queue: 0,
        external: 1,
        rpc: 0,
        agent: 0,
        tool: 0,
        model: 0,
      });
    });

    it("sums every kind into totalEntities for the header inventory chip", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.graphData = {
        nodes: [
          { id: "a", label: "a", requests: 1, errors: 0 },
          { id: "b", label: "b", requests: 1, errors: 0, service_type: "database" },
          { id: "c", label: "c", requests: 1, errors: 0, service_type: "external" },
          { id: "d", label: "d", requests: 1, errors: 0, service_type: "queue" },
          // group nodes are excluded (kindCounts skips them), so total = 4
          {
            id: "__group_external",
            label: "External (5)",
            requests: 5,
            errors: 0,
            service_type: "external",
            is_group: true,
            member_count: 5,
          },
        ],
        edges: [],
      };
      await flushPromises();
      expect(wrapper.vm.totalEntities).toBe(4);
    });

    it("exposes kindRows with counts; only dependency kinds are toggleable", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.graphData = {
        nodes: [
          { id: "a", label: "a", requests: 1, errors: 0 },
          { id: "b", label: "b", requests: 1, errors: 0, service_type: "database" },
        ],
        edges: [],
      };
      await flushPromises();
      const rows = wrapper.vm.kindRows;
      const service = rows.find((r: any) => r.key === "service");
      const database = rows.find((r: any) => r.key === "database");
      // Services are the graph spine — always shown, never a toggle.
      expect(service).toMatchObject({ label: "Services", count: 1, toggleable: false });
      // Dependency kinds carry a live count and can be hidden.
      expect(database).toMatchObject({ label: "Datastores", count: 1, toggleable: true });
    });
  });

  describe("topology from traces", () => {
    it("sorts nodes + edges deterministically at ingest (same topology → same graph)", async () => {
      // The backend does not guarantee node/edge order, and the layouts are
      // order-sensitive — so ingest must sort, or the same topology renders a
      // different graph each fetch. Feed an UNSORTED topology and assert the
      // stored graphData comes out in a stable, sorted order.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [
            { id: "gamma", label: "gamma", requests: 1, errors: 0 },
            { id: "alpha", label: "alpha", requests: 1, errors: 0 },
            { id: "beta", label: "beta", requests: 1, errors: 0 },
          ],
          edges: [
            { from: "gamma", to: "alpha", total_requests: 1, failed_requests: 0 },
            { from: "alpha", to: "beta", total_requests: 1, failed_requests: 0 },
            { from: "alpha", to: "gamma", total_requests: 1, failed_requests: 0 },
          ],
        },
      } as any);

      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      // Nodes sorted by id.
      expect(wrapper.vm.graphData.nodes.map((n: any) => n.id)).toEqual(["alpha", "beta", "gamma"]);
      // Edges sorted by (from, to).
      expect(wrapper.vm.graphData.edges.map((e: any) => `${e.from}->${e.to}`)).toEqual([
        "alpha->beta",
        "alpha->gamma",
        "gamma->alpha",
      ]);
    });

    it("builds a typed inferred node from the traces queries", async () => {
      // The backend now returns a fully classified topology; a database-typed
      // node arrives with service_type set and is used directly.
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [
            { id: "cart", label: "cart", requests: 10, errors: 0 },
            {
              id: "valkey",
              label: "valkey",
              requests: 10,
              errors: 0,
              service_type: "database",
            },
          ],
          edges: [
            {
              from: "cart",
              to: "valkey",
              total_requests: 10,
              failed_requests: 0,
              error_rate: 0,
              p50_latency_ns: 0,
              p95_latency_ns: 0,
              p99_latency_ns: 0,
              connection_type: "database",
            },
          ],
        },
      } as any);

      const wrapper = createWrapper();
      await flushPromises();
      // Force a fresh load now that mocks are in place (mount may have run first).
      await wrapper.vm.loadServiceGraph();
      await flushPromises();

      const valkey = wrapper.vm.graphData.nodes.find((n: any) => n.id === "valkey");
      expect(valkey).toBeTruthy();
      expect(valkey.service_type).toBe("database");
    });
  });

  describe("adaptive collapse", () => {
    it("collapses inferred deps when node count exceeds threshold", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const exts = Array.from({ length: 8 }, (_, i) => ({
        id: `ext${i}`,
        label: `ext${i}`,
        requests: 1,
        errors: 0,
        service_type: "external",
      }));
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: {
          nodes: [{ id: "svc", label: "svc", requests: 1, errors: 0 }, ...exts],
          edges: exts.map((e) => ({
            from: "svc",
            to: e.id,
            total_requests: 1,
            failed_requests: 0,
          })),
        },
      } as any);
      wrapper.vm.collapseThreshold = 5; // force collapse
      await wrapper.vm.loadServiceGraph();
      await flushPromises();
      const ids = wrapper.vm.filteredGraphData.nodes.map((n: any) => n.id);
      // Per-caller boundary node: svc's externals collapse into svc's own group.
      expect(ids).toContain("__group_external__svc");
      expect(ids).not.toContain("ext0");
    });

    it("expands ONLY the clicked group (by boundary id) via toggleGroupExpansion", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // Per-group: the FULL boundary id is toggled, not the kind — so one
      // caller's group expands without expanding every group of that kind.
      wrapper.vm.toggleGroupExpansion("__group_external__payment");
      await flushPromises();
      expect(wrapper.vm.expandedGroups.has("__group_external__payment")).toBe(true);
      // A different caller's external group stays untouched.
      expect(wrapper.vm.expandedGroups.has("__group_external__product")).toBe(false);
      wrapper.vm.toggleGroupExpansion("__group_external__payment");
      expect(wrapper.vm.expandedGroups.has("__group_external__payment")).toBe(false);
    });

    it("clicking a collapsed boundary node toggles that specific group (graph params)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // ECharts graph-view click: data has the full boundary id + is_group.
      wrapper.vm.handleNodeClick({
        dataType: "node",
        data: {
          id: "__group_external__payment",
          is_group: true,
          service_type: "external",
        },
      });
      expect(wrapper.vm.expandedGroups.has("__group_external__payment")).toBe(true);
      // Side panel must NOT open for a group node.
      expect(wrapper.vm.showSidePanel).toBe(false);
    });

    it("clicking a collapsed boundary node toggles that specific group (tree params)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // ECharts tree-view click: data carries id (name is the label).
      wrapper.vm.handleNodeClick({
        componentType: "series",
        data: {
          id: "__group_rpc__api-gateway",
          name: "Rpc (3)",
          is_group: true,
          service_type: "rpc",
        },
      });
      expect(wrapper.vm.expandedGroups.has("__group_rpc__api-gateway")).toBe(true);
    });

    it("switches collapse mode", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.setCollapseMode("expanded");
      expect(wrapper.vm.collapseMode).toBe("expanded");
    });

    it("zoom in/out adjust the series zoom from the CURRENT level; fit recreates", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      // Stub an ECharts instance whose live zoom is read via getOption and
      // written via setOption. The buttons read the current zoom first so they
      // stay in sync with wheel zoom.
      let liveZoom = 1;
      const setOptionCalls: any[] = [];
      (wrapper.vm as any).chartRendererRef = {
        chart: {
          getOption: () => ({ series: [{ zoom: liveZoom }] }),
          setOption: (opt: any) => {
            setOptionCalls.push(opt);
            liveZoom = opt.series[0].zoom; // reflect the write back
          },
        },
      };

      // Zoom in → series zoom increases above 1.
      wrapper.vm.zoomIn();
      expect(setOptionCalls.at(-1).series[0].zoom).toBeGreaterThan(1);
      const afterIn = setOptionCalls.at(-1).series[0].zoom;

      // Zoom out → adjusts from the (now zoomed-in) live level, so it decreases.
      wrapper.vm.zoomOut();
      expect(setOptionCalls.at(-1).series[0].zoom).toBeLessThan(afterIn);

      // Zoom is clamped — many zoom-outs never go below the floor.
      for (let i = 0; i < 30; i++) wrapper.vm.zoomOut();
      expect(setOptionCalls.at(-1).series[0].zoom).toBeGreaterThanOrEqual(0.4);

      // Fit-to-screen recreates the chart (bumps chartKey) to re-fit at zoom 1.
      const keyBefore = wrapper.vm.chartKey;
      wrapper.vm.fitToScreen();
      expect(wrapper.vm.chartKey).toBeGreaterThan(keyBefore);
    });

    it("hides a kind via the visibility toggle", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.toggleKindVisibility("external");
      expect(wrapper.vm.hiddenKinds.has("external")).toBe(true);
    });

    it("shows a filter-active dot on the Show types button when any type is hidden", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const dotSelector = '[data-test="service-graph-active-filter-indicator"]';

      // No types hidden → no dot, count 0.
      expect(wrapper.vm.activeFilterCount).toBe(0);
      expect(wrapper.find(dotSelector).exists()).toBe(false);

      // Hide a type → dot appears so the user knows the graph is filtered
      // (entities withheld) rather than simply empty. A plain dot (not a count)
      // avoids the "N shown vs N hidden" ambiguity.
      wrapper.vm.toggleKindVisibility("external");
      await flushPromises();

      expect(wrapper.vm.activeFilterCount).toBe(1);
      expect(wrapper.find(dotSelector).exists()).toBe(true);

      // Un-hide → dot disappears.
      wrapper.vm.toggleKindVisibility("external");
      await flushPromises();
      expect(wrapper.vm.activeFilterCount).toBe(0);
      expect(wrapper.find(dotSelector).exists()).toBe(false);
    });

    it("renders the compact Density dropdown trigger", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // The controls live inside a dropdown; only the trigger is always in the
      // toolbar (keeps it compact). The mode/kind setters are covered above.
      expect(wrapper.find('[data-test="service-graph-density-btn"]').exists()).toBe(true);
    });
  });
});
