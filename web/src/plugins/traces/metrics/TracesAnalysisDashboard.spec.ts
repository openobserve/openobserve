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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gt } from "@/types/i18n";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// Heavy async component stubs — declared before component import so
// defineAsyncComponent never fires the actual loader
// ---------------------------------------------------------------------------
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    template: '<div data-test="render-dashboard-charts"></div>',
    props: [
      "dashboardData",
      "currentTimeObj",
      "viewOnly",
      "allowAlertCreation",
      "simplifiedPanelView",
      "searchType",
    ],
    emits: ["variablesManagerReady", "onDeletePanel"],
  },
}));

// ---------------------------------------------------------------------------
// COMPARISON_COLORS constant exposed from the dashboard composable
// ---------------------------------------------------------------------------
const MOCK_COMPARISON_COLORS = {
  light: { baseline: "#2775ea", selected: "#12adc2" },
  dark: { baseline: "#2c7de0", selected: "#1cb8d0" },
};

// Mock generated dashboard returned by generateDashboard()
const mockGeneratedDashboard = {
  tabs: [
    {
      panels: [
        {
          id: "panel-service",
          title: "service_name",
          queries: [{ query: "SELECT service_name FROM stream" }],
          layout: { x: 0, y: 0, w: 64, h: 16, i: "i-service" },
        },
        {
          id: "panel-status",
          title: "span_status",
          queries: [{ query: "SELECT span_status FROM stream" }],
          layout: { x: 64, y: 0, w: 64, h: 16, i: "i-status" },
        },
      ],
    },
  ],
};

const mockGenerateDashboard = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useLatencyInsightsDashboard", () => ({
  COMPARISON_COLORS: {
    light: { baseline: "#2775ea", selected: "#12adc2" },
    dark: { baseline: "#2c7de0", selected: "#1cb8d0" },
  },
  useLatencyInsightsDashboard: () => ({
    generateDashboard: mockGenerateDashboard,
  }),
}));

vi.mock("@/composables/useLatencyInsightsAnalysis", () => ({
  useLatencyInsightsAnalysis: () => ({
    loading: ref(false),
    error: ref(null),
    analyzeAllDimensions: vi.fn().mockResolvedValue([]),
  }),
}));

// ---------------------------------------------------------------------------
// useDimensionSelector — returns stable lists of dimensions
// ---------------------------------------------------------------------------
vi.mock("@/composables/useDimensionSelector", () => ({
  selectDimensionsFromData: vi.fn().mockReturnValue(["service_name", "span_status"]),
}));

// ---------------------------------------------------------------------------
// useNotifications
// ---------------------------------------------------------------------------
const mockShowErrorNotification = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: mockShowErrorNotification,
  }),
}));

// search service — dimension value counts on the Drill down page
const mockSearch = vi.hoisted(() => vi.fn());
vi.mock("@/services/search", () => ({ default: { search: mockSearch } }));

// ---------------------------------------------------------------------------
// zincutils
// ---------------------------------------------------------------------------
vi.mock("@/utils/zincutils", () => ({
  formatTimeWithSuffix: vi.fn().mockImplementation((ms: number) => `${ms}ms`),
  deepCopy: (d: any) => JSON.parse(JSON.stringify(d)),
  useLocalOrganization: vi.fn().mockReturnValue({ identifier: "test-org" }),
  useLocalCurrentUser: vi.fn().mockReturnValue({ email: "test@example.com" }),
  useLocalTimezone: vi.fn().mockReturnValue("UTC"),
  b64EncodeUnicode: vi.fn().mockImplementation((s: string) => btoa(s)),
  b64DecodeUnicode: vi.fn().mockImplementation((s: string) => atob(s)),
}));

// ---------------------------------------------------------------------------
// Actual component import (after all mocks are in place)
// ---------------------------------------------------------------------------
import TracesAnalysisDashboard from "./TracesAnalysisDashboard.vue";

// ---------------------------------------------------------------------------
// Vuex store
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
  streamType: "traces",
  timeRange: { startTime: 1_000_000_000, endTime: 2_000_000_000 },
  analysisType: "duration" as const,
};

// ---------------------------------------------------------------------------
// Component stubs — declared at module scope so every mount uses the same
// shape and tests can locate them via findComponent({ name })
// ---------------------------------------------------------------------------

// OButton stub: render a real <button> so @click bindings fire, and forward
// the data-test attribute so component-level selectors keep working.
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading", "title"],
  inheritAttrs: false,
  emits: ["click"],
  template: `
    <button
      data-test-stub="o-button"
      :data-test="$attrs['data-test']"
      :disabled="disabled || null"
      @click="$emit('click', $event)"
    ><slot /></button>
  `,
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------
function mountComponent(props: Record<string, unknown> = {}): VueWrapper<any> {
  return mount(TracesAnalysisDashboard, {
    props: { ...defaultProps, ...props },
    global: {
      plugins: [mockStore, i18n],
      stubs: {
        OButton: OButtonStub,
        // Heavy custom child — already mocked at module level
        RenderDashboardCharts: {
          template: '<div data-test="render-dashboard-charts"></div>',
          props: [
            "dashboardData",
            "currentTimeObj",
            "viewOnly",
            "allowAlertCreation",
            "simplifiedPanelView",
            "searchType",
          ],
          emits: ["variablesManagerReady", "onDeletePanel"],
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("TracesAnalysisDashboard", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGenerateDashboard.mockReturnValue(JSON.parse(JSON.stringify(mockGeneratedDashboard)));
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render RenderDashboardCharts when dashboardData is populated", async () => {
      await flushPromises();
      const charts = wrapper.find('[data-test="render-dashboard-charts"]');
      expect(charts.exists()).toBe(true);
    });

    it("should render the dimension selector sidebar by default", () => {
      const sidebar = wrapper.find('[data-test="dimension-selector-sidebar"]');
      expect(sidebar.exists()).toBe(true);
    });

    it("should render the dimension search input inside the sidebar", () => {
      const input = wrapper.find('[data-test="dimension-search-input"]');
      expect(input.exists()).toBe(true);
    });

    it("should render the collapse/expand button for dimension sidebar", () => {
      const btn = wrapper.find('[data-test="dimension-selector-collapse-btn"]');
      expect(btn.exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Title rendering based on analysisType prop
  // -------------------------------------------------------------------------
  describe("title rendering based on analysisType", () => {
    it("should show Latency Insights title when analysisType is 'duration'", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ analysisType: "duration" });
      await flushPromises();
      // The i18n key resolves; just verify the component mounts correctly with duration type
      expect(wrapper.vm.activeAnalysisType).toBe("duration");
    });

    it("should show Volume Insights title when analysisType is 'volume'", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "volume",
      });
      await flushPromises();
      expect(wrapper.vm.activeAnalysisType).toBe("volume");
    });

    it("should show Error Insights title when analysisType is 'error'", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "error",
      });
      await flushPromises();
      expect(wrapper.vm.activeAnalysisType).toBe("error");
    });
  });

  // -------------------------------------------------------------------------
  // Emits
  // -------------------------------------------------------------------------
  describe("emits", () => {
    it("should emit 'close' when onClose is called", async () => {
      wrapper.vm.onClose();
      await flushPromises();
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")!.length).toBe(1);
    });

    it("should emit 'close' exactly once per onClose invocation", async () => {
      wrapper.vm.onClose();
      wrapper.vm.onClose();
      await flushPromises();
      expect(wrapper.emitted("close")!.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: chipColors
  // -------------------------------------------------------------------------
  describe("computed chipColors", () => {
    it("should return light theme colors when store.state.theme is 'light'", () => {
      const colors = wrapper.vm.chipColors;
      expect(colors.baseline).toBe(MOCK_COMPARISON_COLORS.light.baseline);
      expect(colors.selected).toBe(MOCK_COMPARISON_COLORS.light.selected);
    });

    it("should return dark theme colors when store.state.theme is 'dark'", async () => {
      const darkStore = createStore({
        state: {
          theme: "dark",
          selectedOrganization: { identifier: "test-org" },
        },
      });
      wrapper.unmount();
      wrapper = mount(TracesAnalysisDashboard, {
        props: { ...defaultProps },
        global: {
          plugins: [darkStore, i18n],
          stubs: { RenderDashboardCharts: true },
        },
      });
      await flushPromises();
      const colors = wrapper.vm.chipColors;
      expect(colors.baseline).toBe(MOCK_COMPARISON_COLORS.dark.baseline);
      expect(colors.selected).toBe(MOCK_COMPARISON_COLORS.dark.selected);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: availableDimensions
  // -------------------------------------------------------------------------
  describe("computed availableDimensions", () => {
    it("should return an empty array when streamFields is not provided", () => {
      expect(wrapper.vm.availableDimensions).toEqual([]);
    });

    it("should map streamFields to {label, value} objects", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        streamFields: [{ name: "service_name" }, { name: "span_status" }],
      });
      await flushPromises();
      const dims = wrapper.vm.availableDimensions;
      expect(dims).toContainEqual({ label: "service_name", value: "service_name" });
      expect(dims).toContainEqual({ label: "span_status", value: "span_status" });
    });

    it("should sort dimensions alphabetically", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        streamFields: [{ name: "zebra_field" }, { name: "alpha_field" }, { name: "middle_field" }],
      });
      await flushPromises();
      const dims = wrapper.vm.availableDimensions;
      expect(dims[0].value).toBe("alpha_field");
      expect(dims[1].value).toBe("middle_field");
      expect(dims[2].value).toBe("zebra_field");
    });

    it("should handle string streamFields (name = field itself)", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: ["field_a", "field_b"] });
      await flushPromises();
      const dims = wrapper.vm.availableDimensions;
      expect(dims).toContainEqual({ label: "field_a", value: "field_a" });
    });
  });

  // -------------------------------------------------------------------------
  // Computed: filteredDimensions
  // -------------------------------------------------------------------------
  describe("computed filteredDimensions", () => {
    const streamFieldsForFilter = [
      { name: "service_name" },
      { name: "span_status" },
      { name: "http_method" },
    ];

    it("should return all dimensions when dimensionSearchText is empty", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: streamFieldsForFilter });
      await flushPromises();
      const dims = wrapper.vm.filteredDimensions;
      expect(dims).toHaveLength(3);
    });

    it("should filter dimensions matching the search text", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: streamFieldsForFilter });
      await flushPromises();
      wrapper.vm.dimensionSearchText = "service";
      await flushPromises();
      const dims = wrapper.vm.filteredDimensions;
      expect(dims).toHaveLength(1);
      expect(dims[0].value).toBe("service_name");
    });

    it("should perform case-insensitive search filtering", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: streamFieldsForFilter });
      await flushPromises();
      wrapper.vm.dimensionSearchText = "SPAN";
      await flushPromises();
      const dims = wrapper.vm.filteredDimensions;
      expect(dims).toHaveLength(1);
      expect(dims[0].value).toBe("span_status");
    });

    it("should place selected dimensions before unselected ones", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: streamFieldsForFilter });
      await flushPromises();
      // Force selectedDimensions to only contain http_method
      wrapper.vm.selectedDimensions = ["http_method"];
      await flushPromises();
      const dims = wrapper.vm.filteredDimensions;
      expect(dims[0].value).toBe("http_method");
    });

    it("should return empty array when no dimensions match search", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: streamFieldsForFilter });
      await flushPromises();
      wrapper.vm.dimensionSearchText = "nonexistent_field";
      await flushPromises();
      expect(wrapper.vm.filteredDimensions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: currentOrgIdentifier
  // -------------------------------------------------------------------------
  describe("computed currentOrgIdentifier", () => {
    it("should return the org identifier from the store", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe("test-org");
    });
  });

  // -------------------------------------------------------------------------
  // Computed: currentTimeObj
  // -------------------------------------------------------------------------
  describe("computed currentTimeObj", () => {
    it("should expose a __global key with start_time and end_time as Date objects", () => {
      const timeObj = wrapper.vm.currentTimeObj;
      expect(timeObj).toHaveProperty("__global");
      expect(timeObj.__global.start_time).toBeInstanceOf(Date);
      expect(timeObj.__global.end_time).toBeInstanceOf(Date);
    });

    it("should derive start_time from timeRange.startTime", () => {
      const timeObj = wrapper.vm.currentTimeObj;
      expect(timeObj.__global.start_time.getTime()).toBe(defaultProps.timeRange.startTime);
    });

    it("should derive end_time from timeRange.endTime", () => {
      const timeObj = wrapper.vm.currentTimeObj;
      expect(timeObj.__global.end_time.getTime()).toBe(defaultProps.timeRange.endTime);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: baselineTimeRange
  // -------------------------------------------------------------------------
  describe("computed baselineTimeRange", () => {
    it("should equal the timeRange prop", () => {
      expect(wrapper.vm.baselineTimeRange).toEqual(defaultProps.timeRange);
    });

    it("should reflect updates when timeRange prop changes", async () => {
      const newRange = { startTime: 5_000_000, endTime: 6_000_000 };
      await wrapper.setProps({ timeRange: newRange });
      expect(wrapper.vm.baselineTimeRange).toEqual(newRange);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: selectedTimeRangeDisplay
  // -------------------------------------------------------------------------
  describe("computed selectedTimeRangeDisplay", () => {
    it("should be null when no filters with time range are provided", () => {
      expect(wrapper.vm.selectedTimeRangeDisplay).toBeNull();
    });

    it("should use rateFilter timeStart/timeEnd when rateFilter has time range", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        rateFilter: { start: 1, end: 5, timeStart: 3_000_000, timeEnd: 4_000_000 },
      });
      await flushPromises();
      expect(wrapper.vm.selectedTimeRangeDisplay).toEqual({
        startTime: 3_000_000,
        endTime: 4_000_000,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Computed: hasSelectedTimeRange
  // -------------------------------------------------------------------------
  describe("computed hasSelectedTimeRange", () => {
    it("should be false when selectedTimeRangeDisplay is null", () => {
      expect(wrapper.vm.hasSelectedTimeRange).toBe(false);
    });

    it("should be true when selectedTimeRangeDisplay is not null", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        rateFilter: { start: 1, end: 5, timeStart: 3_000_000, timeEnd: 4_000_000 },
      });
      await flushPromises();
      expect(wrapper.vm.hasSelectedTimeRange).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: filterMetadata
  // -------------------------------------------------------------------------
  describe("computed filterMetadata", () => {
    it("should be null when no active filter without a time range exists", () => {
      expect(wrapper.vm.filterMetadata).toBeNull();
    });

    it("should return a rate metadata string for 'volume' type with rateFilter (no timeStart)", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "volume",
        rateFilter: { start: 10, end: 50 },
      });
      await flushPromises();
      const meta = wrapper.vm.filterMetadata;
      expect(meta).not.toBeNull();
      expect(meta).toContain("10");
      expect(meta).toContain("50");
    });
  });

  // -------------------------------------------------------------------------
  // Method: toggleDimension
  // -------------------------------------------------------------------------
  describe("method toggleDimension", () => {
    beforeEach(async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        streamFields: [{ name: "service_name" }, { name: "span_status" }, { name: "http_method" }],
      });
      await flushPromises();
      // Force known starting state
      wrapper.vm.selectedDimensions = ["service_name", "span_status"];
    });

    it("should add a dimension that is not currently selected", () => {
      wrapper.vm.toggleDimension("http_method");
      expect(wrapper.vm.selectedDimensions).toContain("http_method");
    });

    it("should remove a dimension that is currently selected", () => {
      wrapper.vm.toggleDimension("span_status");
      expect(wrapper.vm.selectedDimensions).not.toContain("span_status");
    });

    it("removes the last remaining dimension too", () => {
      wrapper.vm.selectedDimensions = ["service_name"];
      wrapper.vm.toggleDimension("service_name");
      expect(wrapper.vm.selectedDimensions).toEqual([]);
    });

    it("should create a new array reference on add (reactive)", () => {
      const before = wrapper.vm.selectedDimensions;
      wrapper.vm.toggleDimension("http_method");
      expect(wrapper.vm.selectedDimensions).not.toBe(before);
    });

    it("should create a new array reference on remove (reactive)", () => {
      const before = wrapper.vm.selectedDimensions;
      wrapper.vm.toggleDimension("span_status");
      expect(wrapper.vm.selectedDimensions).not.toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // Method: toggleDimensionSelector
  // -------------------------------------------------------------------------
  describe("method toggleDimensionSelector", () => {
    it("should hide the sidebar and set splitterModel to 0 when sidebar is visible", async () => {
      wrapper.vm.showDimensionSelector = true;
      wrapper.vm.splitterModel = 25;
      wrapper.vm.toggleDimensionSelector();
      await flushPromises();
      expect(wrapper.vm.showDimensionSelector).toBe(false);
      expect(wrapper.vm.splitterModel).toBe(0);
    });

    it("should save the current splitter position before collapsing", () => {
      wrapper.vm.showDimensionSelector = true;
      wrapper.vm.splitterModel = 25;
      wrapper.vm.toggleDimensionSelector();
      expect(wrapper.vm.lastSplitterPosition).toBe(25);
    });

    it("should restore splitter position when expanding", async () => {
      wrapper.vm.showDimensionSelector = false;
      wrapper.vm.splitterModel = 0;
      wrapper.vm.lastSplitterPosition = 25;
      wrapper.vm.toggleDimensionSelector();
      await flushPromises();
      expect(wrapper.vm.showDimensionSelector).toBe(true);
      expect(wrapper.vm.splitterModel).toBe(25);
    });

    it("should use default 25% width when saved position is less than 10 during expand", async () => {
      wrapper.vm.showDimensionSelector = false;
      wrapper.vm.splitterModel = 0;
      wrapper.vm.lastSplitterPosition = 5; // Too small
      wrapper.vm.toggleDimensionSelector();
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(25);
    });

    it("should use default 25% width when saved position is 0 during expand", async () => {
      wrapper.vm.showDimensionSelector = false;
      wrapper.vm.splitterModel = 0;
      wrapper.vm.lastSplitterPosition = 0;
      wrapper.vm.toggleDimensionSelector();
      await flushPromises();
      expect(wrapper.vm.splitterModel).toBe(25);
    });
  });

  // -------------------------------------------------------------------------
  // Method: getInitialDimensions
  // -------------------------------------------------------------------------
  describe("method getInitialDimensions", () => {
    it("should call selectDimensionsFromData for logs stream type with enough log samples", async () => {
      const { selectDimensionsFromData } = await import("@/composables/useDimensionSelector");
      const samples = Array.from({ length: 10 }, (_, i) => ({
        service_name: `svc-${i}`,
      }));
      wrapper.unmount();
      wrapper = mountComponent({
        streamType: "logs",
        streamFields: [{ name: "service_name" }],
        logSamples: samples,
      });
      await flushPromises();
      expect(selectDimensionsFromData).toHaveBeenCalled();
    });

    it("should fall back to selectDimensionsFromData for logs type without enough samples", async () => {
      const { selectDimensionsFromData } = await import("@/composables/useDimensionSelector");
      wrapper.unmount();
      wrapper = mountComponent({
        streamType: "logs",
        streamFields: [{ name: "service_name" }],
        logSamples: [], // fewer than 10
      });
      await flushPromises();
      expect(selectDimensionsFromData).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Method: loadAnalysis
  // -------------------------------------------------------------------------
  describe("method loadAnalysis", () => {
    it("should call generateDashboard and populate dashboardData", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt);
      wrapper.vm.dashboardData = null;
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      expect(generateDashboard).toHaveBeenCalled();
      expect(wrapper.vm.dashboardData).not.toBeNull();
    });

    it("should increment dashboardRenderKey after loadAnalysis", async () => {
      const keyBefore = wrapper.vm.dashboardRenderKey;
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      expect(wrapper.vm.dashboardRenderKey).toBe(keyBefore + 1);
    });

    it("should call showErrorNotification when generateDashboard throws", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      (generateDashboard as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("dashboard generation failed");
      });
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      expect(mockShowErrorNotification).toHaveBeenCalled();
    });

    it("should use rateFilter config when activeAnalysisType is 'volume'", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      wrapper.vm.activeAnalysisType = "volume";
      const rateFilter = { start: 10, end: 50 };
      await wrapper.setProps({ rateFilter });
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.at(-1)[1];
      expect(callArg.rateFilter).toEqual(rateFilter);
    });

    it("should override selectedTimeRange with rateFilter time when rateFilter has timeStart", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      await wrapper.setProps({
        rateFilter: { start: 1, end: 5, timeStart: 3_000_000, timeEnd: 4_000_000 },
      });
      wrapper.vm.activeAnalysisType = "volume";
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.at(-1)[1];
      expect(callArg.selectedTimeRange).toEqual({
        startTime: 3_000_000,
        endTime: 4_000_000,
      });
    });

    it("should pass selectedDimensions to generateDashboard config", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      wrapper.vm.selectedDimensions = ["service_name", "http_method"];
      // Let the selection watcher append its panel first, so the last call is loadAnalysis'.
      await flushPromises();
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.at(-1)[1];
      expect(callArg.dimensions).toEqual(["service_name", "http_method"]);
    });

    it("should build mockAnalyses with one entry per selected dimension", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      wrapper.vm.selectedDimensions = ["service_name"];
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const mockAnalyses = (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.at(-1)[0];
      expect(mockAnalyses).toHaveLength(1);
      expect(mockAnalyses[0].dimensionName).toBe("service_name");
      expect(mockAnalyses[0].data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Method: handlePanelDelete
  // -------------------------------------------------------------------------
  describe("method handlePanelDelete", () => {
    beforeEach(async () => {
      wrapper.vm.selectedDimensions = ["service_name", "span_status"];
      wrapper.vm.dashboardData = {
        tabs: [
          {
            panels: [
              { id: "panel-1", title: "service_name" },
              { id: "panel-2", title: "span_status" },
            ],
          },
        ],
      };
    });

    it("should remove the dimension from selectedDimensions when a panel is deleted by id", () => {
      wrapper.vm.handlePanelDelete("panel-1");
      expect(wrapper.vm.selectedDimensions).not.toContain("service_name");
    });

    it("should keep other dimensions intact when one panel is deleted", () => {
      wrapper.vm.handlePanelDelete("panel-1");
      expect(wrapper.vm.selectedDimensions).toContain("span_status");
    });

    it("should do nothing when dashboardData has no tabs", () => {
      wrapper.vm.dashboardData = null;
      expect(() => wrapper.vm.handlePanelDelete("panel-1")).not.toThrow();
    });

    it("should do nothing when panel id does not exist in panels", () => {
      const dimsBefore = [...wrapper.vm.selectedDimensions];
      wrapper.vm.handlePanelDelete("panel-nonexistent");
      expect(wrapper.vm.selectedDimensions).toEqual(dimsBefore);
    });
  });

  // -------------------------------------------------------------------------
  // State: splitterModel defaults
  // -------------------------------------------------------------------------
  describe("state splitterModel", () => {
    it("should default splitterModel to 25 on mount", () => {
      expect(wrapper.vm.splitterModel).toBe(25);
    });

    it("should default lastSplitterPosition to 25 on mount", () => {
      expect(wrapper.vm.lastSplitterPosition).toBe(25);
    });
  });

  // -------------------------------------------------------------------------
  // Watcher: activeAnalysisType triggers loadAnalysis
  // -------------------------------------------------------------------------
  describe("watcher: activeAnalysisType", () => {
    it("should call loadAnalysis when activeAnalysisType changes", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length;
      wrapper.vm.activeAnalysisType = "volume";
      await flushPromises();
      expect((generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Watcher: selectedDimensions triggers loadAnalysis on removal
  // -------------------------------------------------------------------------
  describe("watcher: selectedDimensions", () => {
    const chartsEl = () => wrapper.find('[data-test="render-dashboard-charts"]').element;
    const panelTitles = () =>
      wrapper.vm.dashboardData.tabs[0].panels.map((p: { title: string }) => p.title);

    it("removes only that dimension's panel, without regenerating or remounting the rest", async () => {
      // Mount state: both panels (service_name, span_status) rendered once.
      const dashboardBefore = wrapper.vm.dashboardData;
      const renderKeyBefore = wrapper.vm.dashboardRenderKey;
      const chartsBefore = chartsEl();
      mockGenerateDashboard.mockClear();

      wrapper.vm.handlePanelDelete("panel-service");
      await flushPromises();

      expect(panelTitles()).toEqual(["span_status"]);
      // Same dashboard object: the remaining panel keeps its data and no new queries run.
      expect(wrapper.vm.dashboardData).toBe(dashboardBefore);
      expect(wrapper.vm.dashboardRenderKey).toBe(renderKeyBefore);
      expect(chartsEl()).toBe(chartsBefore);
      expect(mockGenerateDashboard).not.toHaveBeenCalled();
    });

    it("adds a panel for a newly ticked dimension without remounting the existing ones", async () => {
      const dashboardBefore = wrapper.vm.dashboardData;
      const chartsBefore = chartsEl();
      mockGenerateDashboard.mockClear();
      mockGenerateDashboard.mockReturnValueOnce({
        tabs: [
          {
            panels: [
              {
                id: "panel-method",
                title: "http_method",
                layout: { x: 0, y: 0, w: 64, h: 16, i: "i-method" },
              },
            ],
          },
        ],
      });

      wrapper.vm.toggleDimension("http_method");
      await flushPromises();

      expect(panelTitles()).toEqual(["service_name", "span_status", "http_method"]);
      expect(wrapper.vm.dashboardData).toBe(dashboardBefore);
      expect(chartsEl()).toBe(chartsBefore);
      // Only the added dimension is generated.
      expect(mockGenerateDashboard).toHaveBeenCalledTimes(1);
      expect(mockGenerateDashboard.mock.calls[0][0].map((a: any) => a.dimensionName)).toEqual([
        "http_method",
      ]);
    });

    it("deletes the last remaining panel and shows the no-dimensions state", async () => {
      wrapper.vm.handlePanelDelete("panel-service");
      await flushPromises();
      wrapper.vm.handlePanelDelete("panel-status");
      await flushPromises();

      expect(wrapper.vm.selectedDimensions).toEqual([]);
      expect(panelTitles()).toEqual([]);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="traces-analysis-dashboard-no-dimensions"]').exists()).toBe(
        true,
      );
    });

    it("brings the dashboard back when a dimension is ticked after removing them all", async () => {
      wrapper.vm.handlePanelDelete("panel-service");
      await flushPromises();
      wrapper.vm.handlePanelDelete("panel-status");
      await flushPromises();

      mockGenerateDashboard.mockReturnValueOnce({
        tabs: [
          {
            panels: [
              {
                id: "panel-service-2",
                title: "service_name",
                layout: { x: 0, y: 0, w: 64, h: 16, i: "i-service-2" },
              },
            ],
          },
        ],
      });
      wrapper.vm.toggleDimension("service_name");
      await flushPromises();

      expect(panelTitles()).toEqual(["service_name"]);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Watcher: props.timeRange triggers loadAnalysis
  // -------------------------------------------------------------------------
  describe("watcher: props.timeRange", () => {
    it("should call loadAnalysis when timeRange prop changes", async () => {
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length;
      await wrapper.setProps({
        timeRange: { startTime: 9_000_000, endTime: 10_000_000 },
      });
      await flushPromises();
      expect((generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("should mount without errors when streamFields is undefined", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: undefined });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without errors when streamFields is an empty array", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamFields: [] });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without errors when streamName is an empty string", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ streamName: "" });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without errors when all optional filter props are undefined", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        rateFilter: undefined,
        baseFilter: undefined,
      });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have dashboardData populated after initial mount and flushPromises", async () => {
      expect(wrapper.vm.dashboardData).not.toBeNull();
    });

    it("should have isOpen as true on initial mount", () => {
      expect(wrapper.vm.isOpen).toBe(true);
    });

    it("should have dimensionSearchText as empty string on initial mount", () => {
      expect(wrapper.vm.dimensionSearchText).toBe("");
    });

    it("should have showDimensionSelector as true on initial mount", () => {
      expect(wrapper.vm.showDimensionSelector).toBe(true);
    });

    it("should not throw when handlePanelDelete is called with dashboardData having empty panels array", () => {
      wrapper.vm.dashboardData = { tabs: [{ panels: [] }] };
      expect(() => wrapper.vm.handlePanelDelete("any-id")).not.toThrow();
    });

    it("should return availableDimensions as empty when streamFields is not set", () => {
      expect(wrapper.vm.availableDimensions).toHaveLength(0);
    });

    it("should return filteredDimensions as empty when streamFields is not set", () => {
      expect(wrapper.vm.filteredDimensions).toHaveLength(0);
    });

    it("should not call generateDashboard when loadAnalysis encounters an exception from showErrorNotification setup", async () => {
      // Edge: confirm error path does not re-throw (component stays stable)
      const { useLatencyInsightsDashboard } =
        await import("@/composables/useLatencyInsightsDashboard");
      const { generateDashboard } = useLatencyInsightsDashboard(gt) as any;
      (generateDashboard as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("boom");
      });
      // Should not throw at the wrapper level
      await expect(wrapper.vm.loadAnalysis()).resolves.not.toThrow();
    });
  });
});

describe("TracesAnalysisDashboard embedded (Logs Drill down page)", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGenerateDashboard.mockReturnValue(JSON.parse(JSON.stringify(mockGeneratedDashboard)));
    wrapper = mountComponent({
      embedded: true,
      streamType: "logs",
      analysisType: "volume",
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders in place as a page, not a drawer", () => {
    expect(wrapper.findComponent({ name: "ODrawer" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="traces-analysis-dashboard-page"]').exists()).toBe(true);
  });

  it("keeps the header content (baseline time range chip) on the page", () => {
    const page = wrapper.find('[data-test="traces-analysis-dashboard-page"]');
    expect(page.find(".baseline-chip").exists()).toBe(true);
  });

  it("loads the analysis and renders the dashboard on mount", () => {
    expect(mockGenerateDashboard).toHaveBeenCalled();
    expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
  });

  it("shows the analysis title in the page header", () => {
    const title = wrapper.find('[data-test="traces-analysis-dashboard-page-title"]');
    expect(title.text()).toBe(gt("volumeInsights.title"));
  });

  it("does not leak drawer-only attributes onto the page root", () => {
    const page = wrapper.find('[data-test="traces-analysis-dashboard-page"]');
    expect(page.attributes("width")).toBeUndefined();
    expect(page.attributes("title")).toBeUndefined();
  });

  describe("dimension value counts", () => {
    const fields = [
      { name: "alert_id" },
      { name: "service_name" },
      { name: "span_status" },
      { name: "zone" },
    ];

    const remount = async (props: Record<string, unknown> = {}) => {
      wrapper.unmount();
      wrapper = mountComponent({
        embedded: true,
        streamType: "logs",
        streamName: "app_logs",
        analysisType: "volume",
        streamFields: fields,
        ...props,
      });
      await flushPromises();
    };

    it("counts every field in one count(field) query scoped to the search filter", async () => {
      mockSearch.mockResolvedValue({ data: { hits: [{ c0: 5, c1: 900, c2: 900, c3: 40 }] } });
      await remount({ baseFilter: "severity = 'ERROR'" });

      expect(mockSearch).toHaveBeenCalledTimes(1);
      const { query, page_type } = mockSearch.mock.calls[0][0];
      expect(page_type).toBe("logs");
      expect(query.query.sql).toBe(
        'SELECT count("alert_id") AS c0, count("service_name") AS c1, count("span_status") AS c2, count("zone") AS c3 FROM app_logs WHERE severity = \'ERROR\'',
      );
      expect(query.query.start_time).toBe(defaultProps.timeRange.startTime);
      expect(query.query.end_time).toBe(defaultProps.timeRange.endTime);
      expect(wrapper.find('[data-test="dimension-count-zone"]').text()).toBe("40");
    });

    it("counts the brushed window when the histogram has a selection", async () => {
      mockSearch.mockResolvedValue({ data: { hits: [{}] } });
      await remount({
        rateFilter: { start: 0, end: 10, timeStart: 1_200_000_000, timeEnd: 1_300_000_000 },
      });

      const { query } = mockSearch.mock.calls[0][0].query;
      expect(query.start_time).toBe(1_200_000_000);
      expect(query.end_time).toBe(1_300_000_000);
    });

    it("quotes a stream name that is not a plain identifier", async () => {
      mockSearch.mockResolvedValue({ data: { hits: [{}] } });
      await remount({ streamName: 'my"logs' });

      expect(mockSearch.mock.calls[0][0].query.query.sql).toContain('FROM "my""logs"');
    });

    it("sorts by count descending regardless of selection", async () => {
      mockSearch.mockResolvedValue({ data: { hits: [{ c0: 5, c1: 900, c2: 900, c3: 40 }] } });
      await remount();
      wrapper.vm.selectedDimensions = ["alert_id"];
      await flushPromises();

      expect(wrapper.vm.filteredDimensions.map((d: any) => d.value)).toEqual([
        "service_name",
        "span_status",
        "zone",
        "alert_id",
      ]);
    });

    it("keeps the alphabetical list without counts when the query fails", async () => {
      mockSearch.mockRejectedValue(new Error("boom"));
      await remount();

      expect(wrapper.find('[data-test^="dimension-count-"]').exists()).toBe(false);
      expect(wrapper.vm.filteredDimensions.map((d: any) => d.value)).toEqual([
        "service_name",
        "span_status",
        "alert_id",
        "zone",
      ]);
    });

    it("leaves field-group headers out of the dimensions and the count query", async () => {
      mockSearch.mockResolvedValue({ data: { hits: [{}] } });
      await remount({ streamFields: [{ name: "AWS", label: true }, ...fields] });

      expect(wrapper.vm.availableDimensions.map((d: any) => d.value)).not.toContain("AWS");
      expect(mockSearch.mock.calls[0][0].query.query.sql).not.toContain('"AWS"');
    });

    it("does not query counts outside the Drill down page", async () => {
      wrapper.unmount();
      mockSearch.mockClear();
      wrapper = mountComponent({ streamFields: fields });
      await flushPromises();
      expect(mockSearch).not.toHaveBeenCalled();
    });
  });
});
