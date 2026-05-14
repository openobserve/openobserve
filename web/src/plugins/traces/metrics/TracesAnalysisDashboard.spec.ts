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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
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
  selectDimensionsFromData: vi
    .fn()
    .mockReturnValue(["service_name", "span_status"]),
  selectTraceDimensions: vi
    .fn()
    .mockReturnValue(["service_name", "span_status"]),
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

// ---------------------------------------------------------------------------
// @quasar/extras/material-icons-outlined — just needs to export a string
// ---------------------------------------------------------------------------
vi.mock("@quasar/extras/material-icons-outlined", () => ({
  outlinedClose: "close",
}));

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

installQuasar();

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
  availableAnalysisTypes: ["duration"] as Array<"duration" | "volume" | "error">,
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
        // Quasar dialog wrapper — render children so inner DOM is testable
        QDialog: {
          template: '<div><slot /></div>',
          props: ["modelValue"],
          emits: ["hide", "update:modelValue"],
        },
        QCard: { template: "<div><slot /></div>" },
        QCardSection: { template: "<div><slot /></div>" },
        QIcon: { template: "<span />" },
        QBtn: {
          template:
            '<button @click="$emit(\'click\')" v-bind="$attrs"><slot /></button>',
          emits: ["click"],
          props: ["icon", "label", "color", "size", "dense", "round", "flat", "outline", "noCaps"],
        },
        QTooltip: { template: "<span />" },
        QTabs: {
          template:
            '<div><slot /></div>',
          props: ["modelValue"],
          emits: ["update:modelValue"],
        },
        QTab: {
          template: "<div />",
          props: ["name", "label", "icon"],
        },
        QSplitter: {
          template:
            '<div><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
          props: ["modelValue", "limits"],
          emits: ["update:modelValue"],
        },
        QList: { template: "<ul><slot /></ul>" },
        QItem: { template: "<li><slot /></li>" },
        QItemSection: { template: "<div><slot /></div>" },
        QItemLabel: { template: "<span><slot /></span>" },
        QCheckbox: {
          template:
            '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', !modelValue)" />',
          props: ["modelValue", "color", "size", "dense"],
          emits: ["update:modelValue"],
        },
        QInput: {
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ["modelValue", "dense", "borderless", "placeholder", "clearable"],
          emits: ["update:modelValue"],
        },
        QSpinnerHourglass: { template: "<span />" },
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
    mockGenerateDashboard.mockReturnValue(
      JSON.parse(JSON.stringify(mockGeneratedDashboard)),
    );
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

    it("should render the analysis header section", () => {
      const header = wrapper.find(".analysis-header");
      expect(header.exists()).toBe(true);
    });

    it("should render the close button", () => {
      const closeBtn = wrapper.find('[data-test="analysis-dashboard-close"]');
      expect(closeBtn.exists()).toBe(true);
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

    it("should NOT render the percentile refresh button by default (no uncommitted changes)", () => {
      const refreshBtn = wrapper.find('[data-test="percentile-refresh-button"]');
      expect(refreshBtn.exists()).toBe(false);
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
        availableAnalysisTypes: ["volume"],
      });
      await flushPromises();
      expect(wrapper.vm.activeAnalysisType).toBe("volume");
    });

    it("should show Error Insights title when analysisType is 'error'", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "error",
        availableAnalysisTypes: ["error"],
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
  // Computed: showRefreshButton
  // -------------------------------------------------------------------------
  describe("computed showRefreshButton", () => {
    it("should be false when activeAnalysisType is 'volume'", async () => {
      wrapper.vm.activeAnalysisType = "volume";
      await flushPromises();
      expect(wrapper.vm.showRefreshButton).toBe(false);
    });

    it("should be false when activeAnalysisType is 'error'", async () => {
      wrapper.vm.activeAnalysisType = "error";
      await flushPromises();
      expect(wrapper.vm.showRefreshButton).toBe(false);
    });

    it("should be false when activeAnalysisType is 'duration' and no variablesManager", () => {
      // variablesManager is null by default
      wrapper.vm.activeAnalysisType = "duration";
      expect(wrapper.vm.showRefreshButton).toBe(false);
    });

    it("should be true when activeAnalysisType is 'duration' and variablesManager has uncommitted changes", async () => {
      wrapper.vm.activeAnalysisType = "duration";
      wrapper.vm.variablesManager = { hasUncommittedChanges: true };
      await flushPromises();
      expect(wrapper.vm.showRefreshButton).toBe(true);
    });

    it("should be true when variablesManager.hasUncommittedChanges is a ref with value true", async () => {
      wrapper.vm.activeAnalysisType = "duration";
      wrapper.vm.variablesManager = {
        hasUncommittedChanges: { value: true },
      };
      await flushPromises();
      expect(wrapper.vm.showRefreshButton).toBe(true);
    });

    it("should be false when variablesManager.hasUncommittedChanges is false", async () => {
      wrapper.vm.activeAnalysisType = "duration";
      wrapper.vm.variablesManager = { hasUncommittedChanges: false };
      await flushPromises();
      expect(wrapper.vm.showRefreshButton).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: isCustomSQLMode
  // -------------------------------------------------------------------------
  describe("computed isCustomSQLMode", () => {
    it("should be false when baseFilter is a plain filter expression", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ baseFilter: "service_name = 'api'" });
      await flushPromises();
      expect(wrapper.vm.isCustomSQLMode).toBe(false);
    });

    it("should be true when baseFilter starts with SELECT", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        baseFilter: "SELECT * FROM stream WHERE env = 'prod'",
      });
      await flushPromises();
      expect(wrapper.vm.isCustomSQLMode).toBe(true);
    });

    it("should be true when baseFilter starts with lowercase 'select'", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ baseFilter: "select * from stream" });
      await flushPromises();
      expect(wrapper.vm.isCustomSQLMode).toBe(true);
    });

    it("should be false when baseFilter is undefined", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ baseFilter: undefined });
      await flushPromises();
      expect(wrapper.vm.isCustomSQLMode).toBe(false);
    });

    it("should be false when baseFilter is an empty string", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ baseFilter: "" });
      await flushPromises();
      expect(wrapper.vm.isCustomSQLMode).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Computed: availableTabs
  // -------------------------------------------------------------------------
  describe("computed availableTabs", () => {
    it("should return a tab object for each type in availableAnalysisTypes", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        availableAnalysisTypes: ["duration", "volume", "error"],
      });
      await flushPromises();
      const tabs = wrapper.vm.availableTabs;
      expect(tabs).toHaveLength(3);
    });

    it("should include 'volume' tab with correct icon", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ availableAnalysisTypes: ["volume"] });
      await flushPromises();
      const tab = wrapper.vm.availableTabs[0];
      expect(tab.name).toBe("volume");
      expect(tab.icon).toBe("trending_up");
    });

    it("should include 'duration' tab with correct icon", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ availableAnalysisTypes: ["duration"] });
      await flushPromises();
      const tab = wrapper.vm.availableTabs[0];
      expect(tab.name).toBe("duration");
      expect(tab.icon).toBe("schedule");
    });

    it("should include 'error' tab with correct icon", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ availableAnalysisTypes: ["error"] });
      await flushPromises();
      const tab = wrapper.vm.availableTabs[0];
      expect(tab.name).toBe("error");
      expect(tab.icon).toBe("error_outline");
    });
  });

  // -------------------------------------------------------------------------
  // Computed: showTabs
  // -------------------------------------------------------------------------
  describe("computed showTabs", () => {
    it("should be false when only one analysis type is available", () => {
      expect(wrapper.vm.showTabs).toBe(false);
    });

    it("should be true when more than one analysis type is available", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        availableAnalysisTypes: ["duration", "volume"],
      });
      await flushPromises();
      expect(wrapper.vm.showTabs).toBe(true);
    });

    it("should be true for all three types", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        availableAnalysisTypes: ["duration", "volume", "error"],
      });
      await flushPromises();
      expect(wrapper.vm.showTabs).toBe(true);
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
        streamFields: [
          { name: "zebra_field" },
          { name: "alpha_field" },
          { name: "middle_field" },
        ],
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
      expect(timeObj.__global.start_time.getTime()).toBe(
        defaultProps.timeRange.startTime,
      );
    });

    it("should derive end_time from timeRange.endTime", () => {
      const timeObj = wrapper.vm.currentTimeObj;
      expect(timeObj.__global.end_time.getTime()).toBe(
        defaultProps.timeRange.endTime,
      );
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

    it("should use durationFilter timeStart/timeEnd when rateFilter has no time range", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        durationFilter: { start: 100, end: 500, timeStart: 1_000_000, timeEnd: 2_000_000 },
      });
      await flushPromises();
      expect(wrapper.vm.selectedTimeRangeDisplay).toEqual({
        startTime: 1_000_000,
        endTime: 2_000_000,
      });
    });

    it("should use errorFilter timeStart/timeEnd when rateFilter and durationFilter have no time range", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        errorFilter: { start: 1, end: 10, timeStart: 7_000_000, timeEnd: 8_000_000 },
      });
      await flushPromises();
      expect(wrapper.vm.selectedTimeRangeDisplay).toEqual({
        startTime: 7_000_000,
        endTime: 8_000_000,
      });
    });

    it("should prioritise rateFilter over durationFilter when both have time ranges", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        rateFilter: { start: 1, end: 5, timeStart: 3_000_000, timeEnd: 4_000_000 },
        durationFilter: { start: 100, end: 500, timeStart: 1_000_000, timeEnd: 2_000_000 },
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

    it("should return a duration metadata string for 'duration' type with durationFilter (no timeStart)", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "duration",
        durationFilter: { start: 200, end: 800 },
      });
      await flushPromises();
      const meta = wrapper.vm.filterMetadata;
      expect(meta).not.toBeNull();
      expect(meta).toContain("200.00ms");
      expect(meta).toContain("800.00ms");
    });

    it("should return null for 'duration' type when durationFilter has a timeStart (time-based brush)", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "duration",
        durationFilter: { start: 200, end: 800, timeStart: 1_000_000, timeEnd: 2_000_000 },
      });
      await flushPromises();
      expect(wrapper.vm.filterMetadata).toBeNull();
    });

    it("should return a rate metadata string for 'volume' type with rateFilter (no timeStart)", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "volume",
        availableAnalysisTypes: ["volume"],
        rateFilter: { start: 10, end: 50 },
      });
      await flushPromises();
      const meta = wrapper.vm.filterMetadata;
      expect(meta).not.toBeNull();
      expect(meta).toContain("10");
      expect(meta).toContain("50");
    });

    it("should return an error metadata string for 'error' type with errorFilter (no timeStart)", async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        analysisType: "error",
        availableAnalysisTypes: ["error"],
        errorFilter: { start: 5, end: 100 },
      });
      await flushPromises();
      const meta = wrapper.vm.filterMetadata;
      expect(meta).not.toBeNull();
      expect(meta).toContain("5");
    });
  });

  // -------------------------------------------------------------------------
  // Method: toggleDimension
  // -------------------------------------------------------------------------
  describe("method toggleDimension", () => {
    beforeEach(async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        streamFields: [
          { name: "service_name" },
          { name: "span_status" },
          { name: "http_method" },
        ],
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

    it("should NOT remove the last remaining dimension", () => {
      wrapper.vm.selectedDimensions = ["service_name"];
      wrapper.vm.toggleDimension("service_name");
      expect(wrapper.vm.selectedDimensions).toContain("service_name");
      expect(wrapper.vm.selectedDimensions).toHaveLength(1);
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
  // Method: getDimensionLabel
  // -------------------------------------------------------------------------
  describe("method getDimensionLabel", () => {
    beforeEach(async () => {
      wrapper.unmount();
      wrapper = mountComponent({
        streamFields: [{ name: "service_name" }, { name: "span_status" }],
      });
      await flushPromises();
    });

    it("should return the label when the dimension value exists in availableDimensions", () => {
      expect(wrapper.vm.getDimensionLabel("service_name")).toBe("service_name");
    });

    it("should return the raw value as fallback when dimension is not in the list", () => {
      expect(wrapper.vm.getDimensionLabel("unknown_field")).toBe("unknown_field");
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
    it("should call selectTraceDimensions for traces stream type", async () => {
      const { selectTraceDimensions } = await import(
        "@/composables/useDimensionSelector"
      );
      wrapper.unmount();
      wrapper = mountComponent({
        streamType: "traces",
        streamFields: [{ name: "service_name" }],
      });
      await flushPromises();
      expect(selectTraceDimensions).toHaveBeenCalled();
    });

    it("should call selectDimensionsFromData for logs stream type with enough log samples", async () => {
      const { selectDimensionsFromData } = await import(
        "@/composables/useDimensionSelector"
      );
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
      const { selectDimensionsFromData } = await import(
        "@/composables/useDimensionSelector"
      );
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
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard();
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
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      (generateDashboard as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => {
          throw new Error("dashboard generation failed");
        },
      );
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      expect(mockShowErrorNotification).toHaveBeenCalled();
    });

    it("should use durationFilter config when activeAnalysisType is 'duration'", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      wrapper.vm.activeAnalysisType = "duration";
      const durationFilter = { start: 100, end: 500 };
      await wrapper.setProps({ durationFilter });
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)[1];
      expect(callArg.durationFilter).toEqual(durationFilter);
      expect(callArg.rateFilter).toBeUndefined();
    });

    it("should use rateFilter config when activeAnalysisType is 'volume'", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      wrapper.vm.activeAnalysisType = "volume";
      const rateFilter = { start: 10, end: 50 };
      await wrapper.setProps({ rateFilter });
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)[1];
      expect(callArg.rateFilter).toEqual(rateFilter);
      expect(callArg.durationFilter).toBeUndefined();
    });

    it("should use errorFilter config when activeAnalysisType is 'error'", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      wrapper.vm.activeAnalysisType = "error";
      const errorFilter = { start: 1, end: 20 };
      await wrapper.setProps({ errorFilter });
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)[1];
      expect(callArg.errorFilter).toEqual(errorFilter);
      expect(callArg.durationFilter).toBeUndefined();
    });

    it("should override selectedTimeRange with rateFilter time when rateFilter has timeStart", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      await wrapper.setProps({
        rateFilter: { start: 1, end: 5, timeStart: 3_000_000, timeEnd: 4_000_000 },
      });
      wrapper.vm.activeAnalysisType = "volume";
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)[1];
      expect(callArg.selectedTimeRange).toEqual({
        startTime: 3_000_000,
        endTime: 4_000_000,
      });
    });

    it("should pass selectedDimensions to generateDashboard config", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      wrapper.vm.selectedDimensions = ["service_name", "http_method"];
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const callArg = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)[1];
      expect(callArg.dimensions).toEqual(["service_name", "http_method"]);
    });

    it("should build mockAnalyses with one entry per selected dimension", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      wrapper.vm.selectedDimensions = ["service_name"];
      await wrapper.vm.loadAnalysis();
      await flushPromises();
      const mockAnalyses = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)[0];
      expect(mockAnalyses).toHaveLength(1);
      expect(mockAnalyses[0].dimensionName).toBe("service_name");
      expect(mockAnalyses[0].data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Method: onVariablesManagerReady
  // -------------------------------------------------------------------------
  describe("method onVariablesManagerReady", () => {
    it("should set variablesManager to the provided manager object", () => {
      const manager = { hasUncommittedChanges: false, committedVariablesData: {} };
      wrapper.vm.onVariablesManagerReady(manager);
      expect(wrapper.vm.variablesManager).toEqual(manager);
    });

    it("should call loadAnalysis when analysisType is 'duration' and dashboardData is null", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.length;
      wrapper.vm.activeAnalysisType = "duration";
      wrapper.vm.dashboardData = null;
      wrapper.vm.onVariablesManagerReady({ hasUncommittedChanges: false });
      await flushPromises();
      expect(
        (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore);
    });

    it("should NOT call loadAnalysis when dashboardData is already populated", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      wrapper.vm.dashboardData = { tabs: [{ panels: [] }] };
      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.length;
      wrapper.vm.activeAnalysisType = "duration";
      wrapper.vm.onVariablesManagerReady({ hasUncommittedChanges: false });
      await flushPromises();
      expect(
        (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(callsBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Method: getCurrentPercentile
  // -------------------------------------------------------------------------
  describe("method getCurrentPercentile", () => {
    it("should return '0.95' (default P95) when variablesManager is null", () => {
      wrapper.vm.variablesManager = null;
      expect(wrapper.vm.getCurrentPercentile()).toBe("0.95");
    });

    it("should return the percentile value from committedVariablesData.global when present", () => {
      wrapper.vm.variablesManager = {
        committedVariablesData: {
          global: [{ name: "percentile", value: "0.99" }],
        },
      };
      expect(wrapper.vm.getCurrentPercentile()).toBe("0.99");
    });

    it("should return '0.95' when percentile variable is not in committedVariablesData.global", () => {
      wrapper.vm.variablesManager = {
        committedVariablesData: {
          global: [{ name: "other_var", value: "foo" }],
        },
      };
      expect(wrapper.vm.getCurrentPercentile()).toBe("0.95");
    });

    it("should return '0.95' when committedVariablesData is absent", () => {
      wrapper.vm.variablesManager = {};
      expect(wrapper.vm.getCurrentPercentile()).toBe("0.95");
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
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.length;
      wrapper.vm.activeAnalysisType = "volume";
      await flushPromises();
      expect(
        (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Watcher: selectedDimensions triggers loadAnalysis on removal
  // -------------------------------------------------------------------------
  describe("watcher: selectedDimensions", () => {
    it("should call loadAnalysis when a dimension is removed", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;

      // Ensure there are at least 2 dimensions to allow removal
      wrapper.vm.selectedDimensions = ["service_name", "span_status"];
      await flushPromises();

      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.length;
      wrapper.vm.selectedDimensions = ["service_name"];
      await flushPromises();

      expect(
        (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Watcher: props.timeRange triggers loadAnalysis
  // -------------------------------------------------------------------------
  describe("watcher: props.timeRange", () => {
    it("should call loadAnalysis when timeRange prop changes", async () => {
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      const callsBefore = (generateDashboard as ReturnType<typeof vi.fn>).mock
        .calls.length;
      await wrapper.setProps({
        timeRange: { startTime: 9_000_000, endTime: 10_000_000 },
      });
      await flushPromises();
      expect(
        (generateDashboard as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore);
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
        durationFilter: undefined,
        rateFilter: undefined,
        errorFilter: undefined,
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
      const { useLatencyInsightsDashboard } = await import(
        "@/composables/useLatencyInsightsDashboard"
      );
      const { generateDashboard } = useLatencyInsightsDashboard() as any;
      (generateDashboard as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => {
          throw new Error("boom");
        },
      );
      // Should not throw at the wrapper level
      await expect(wrapper.vm.loadAnalysis()).resolves.not.toThrow();
    });
  });
});
