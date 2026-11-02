import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import VisualizeLogsQuery from "@/plugins/logs/VisualizeLogsQuery.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

// Create a mock router
const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div>Home</div>" } },
    { path: "/logs", name: "logs", component: { template: "<div>Logs</div>" } },
  ],
});

// Mock CodeQueryEditor component
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: { name: "CodeQueryEditor", template: "<div>CodeQueryEditor</div>" },
}));

// Mock useLogs composable to avoid lifecycle hook issues
vi.mock("@/composables/useLogs", () => ({
  default: vi.fn(() => ({
    searchObj: {
      data: {
        stream: {
          selectedStreamFields: [],
          selectedFields: [],
        },
        query: "",
        queryResults: [],
      },
    },
    buildSearch: vi.fn(),
  })),
}));

// Mock useWebSocket to avoid onBeforeUnmount issues
vi.mock("@/composables/useWebSocket", () => ({
  default: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    onMessage: vi.fn(),
  })),
}));

// Mock composables
const mockDashboardPanelData = {
  data: {
    queries: [
      {
        query: "SELECT * FROM logs",
        customQuery: false,
        fields: {
          x: [{ alias: "timestamp", isDerived: false }],
          y: [{ alias: "count", isDerived: false }],
          z: [{ alias: "level", isDerived: false }],
          breakdown: [{ alias: "source", isDerived: false }],
          latitude: { alias: "lat", isDerived: false },
          longitude: { alias: "lng", isDerived: false },
          weight: { alias: "weight", isDerived: false },
          source: { alias: "src", isDerived: false },
          target: { alias: "tgt", isDerived: false },
          value: { alias: "val", isDerived: false },
        },
      },
    ],
  },
  layout: {
    isConfigPanelOpen: false,
    showQueryBar: false,
    querySplitter: 41,
    showFieldList: true,
    splitter: 20,
    currentQueryIndex: 0,
  },
  meta: {
    dateTime: {
      startTime: Date.now() - 86400000, // 24 hours ago
      endTime: Date.now(),
      type: "relative",
      period: "1d",
    },
    stream: {
      customQueryFields: [{ name: "custom_field" }],
      vrlFunctionFieldList: [],
      streamType: "logs",
      selectedStream: "default",
      streamResults: [],
    },
    streamFields: {
      groupedFields: [],
    },
  },
};

const mockResetAggregationFunction = vi.fn();
const mockValidatePanel = vi.fn();

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData,
    resetAggregationFunction: mockResetAggregationFunction,
    validatePanel: mockValidatePanel,
    isOutDated: false,
    onActivated: vi.fn(),
    addXAxisItem: vi.fn(),
    addYAxisItem: vi.fn(),
    addZAxisItem: vi.fn(),
    addBreakDownAxisItem: vi.fn(),
    addFilteredItem: vi.fn(),
    isAddXAxisNotAllowed: false,
    isAddBreakdownNotAllowed: false,
    isAddYAxisNotAllowed: false,
    isAddZAxisNotAllowed: false,
    promqlMode: false,
    addLatitude: vi.fn(),
    addLongitude: vi.fn(),
    addWeight: vi.fn(),
    addMapName: vi.fn(),
    addMapValue: vi.fn(),
    addSource: vi.fn(),
    addTarget: vi.fn(),
    addValue: vi.fn(),
    cleanupDraggingFields: vi.fn(),
    updateGroupedFields: vi.fn(),
    fetchPromQLLabels: vi.fn(),
  })),
}));

// Mock useDashboardPanelData to avoid lifecycle issues
vi.mock("@/composables/useDashboardPanelData", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData,
    resetAggregationFunction: mockResetAggregationFunction,
    validatePanel: mockValidatePanel,
    addXAxisItem: vi.fn(),
    addYAxisItem: vi.fn(),
    addZAxisItem: vi.fn(),
    addBreakDownAxisItem: vi.fn(),
    addFilteredItem: vi.fn(),
    isAddXAxisNotAllowed: false,
    isAddBreakdownNotAllowed: false,
    isAddYAxisNotAllowed: false,
    isAddZAxisNotAllowed: false,
    promqlMode: false,
    addLatitude: vi.fn(),
    addLongitude: vi.fn(),
    addWeight: vi.fn(),
    addMapName: vi.fn(),
    addMapValue: vi.fn(),
    addSource: vi.fn(),
    addTarget: vi.fn(),
    addValue: vi.fn(),
    cleanupDraggingFields: vi.fn(),
    updateGroupedFields: vi.fn(),
    fetchPromQLLabels: vi.fn(),
  })),
}));

const persistReasonMock = vi.hoisted(() => {
  const { ref } = require("vue");
  return ref(null as string | null);
});
const openPanelRunMock = vi.hoisted(() => vi.fn(() => 1));
vi.mock("@/composables/useLogs/logsAutoRun", () => ({
  setAutoRunTransport: vi.fn(),
  useLogsAutoRun: () => ({
    persistReason: () => persistReasonMock.value,
    openPanelRun: openPanelRunMock,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({
    showErrorNotification: vi.fn(),
  })),
}));

vi.mock("@/utils/dashboard/checkConfigChangeApiCall", () => ({
  checkIfConfigChangeRequiredApiCallOrNot: vi.fn().mockReturnValue(false),
}));

// Mock lodash functions
vi.mock("lodash-es", () => ({
  isEqual: vi.fn().mockReturnValue(true),
  cloneDeep: vi.fn().mockImplementation((obj) => {
    if (!obj) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }),
  throttle: vi.fn((fn: (...args: any[]) => any) => fn),
}));

// Mock sqlUtils with isSimpleSelectAllQuery function
vi.mock("@/utils/query/sqlUtils", () => {
  return {
    isExplainQuery: vi.fn(() => false),
    isSimpleSelectAllQuery: vi.fn((query: string) => {
      if (!query || typeof query !== "string") return false;
      const normalizedQuery = query.trim().replace(/\s+/g, " ");
      const selectAllPattern = /^select\s+\*\s+from\s+/i;
      return selectAllPattern.test(normalizedQuery);
    }),
    // Add other functions that might be needed
    buildSqlQuery: vi.fn(),
    getFieldsFromQuery: vi.fn(),
    extractFields: vi.fn(),
    addLabelsToSQlQuery: vi.fn(),
    getStreamFromQuery: vi.fn(),
  };
});

describe("VisualizeLogsQuery Component", () => {
  let wrapper: VueWrapper<any>;
  const defaultProps = {
    visualizeChartData: {
      type: "line",
      data: { series: [] },
      config: {},
    },
    errorData: {
      value: "",
      errors: [],
    },
    searchResponse: {
      data: [],
    },
    is_ui_histogram: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    wrapper = mount(VisualizeLogsQuery, {
      props: defaultProps,
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
          dashboardPanelDataPageKey: "logs",
        },
        stubs: {
          PanelSidebar: true,
          ChartSelection: true,
          FieldList: true,
          DashboardQueryBuilder: true,
          DashboardErrorsComponent: true,
          ConfigPanel: true,
          PanelSchemaRenderer: true,
          CustomHTMLEditor: true,
          CustomMarkdownEditor: true,
          AddToDashboard: true,
          CustomChartEditor: true,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should offer area-stacked among the allowed chart types", () => {
      expect(wrapper.vm.allowedChartTypes).toContain("area");
      expect(wrapper.vm.allowedChartTypes).toContain("area-stacked");
    });
  });

  // SKIPPED: seriesDataUpdate method moved to PanelEditor component
  // SKIPPED: metaDataValue method moved to PanelEditor component
  // SKIPPED: layoutSplitterUpdated method moved to PanelEditor component
  describe("handleChartApiError Function", () => {
    beforeEach(() => {
      // Reset error data before each test
      wrapper.props("errorData").errors = [];
    });

    it("should set error message from error object", () => {
      const errorMessage = { message: "API Error occurred" };

      wrapper.vm.handleChartApiError(errorMessage);

      expect(wrapper.props("errorData").errors).toContain("API Error occurred");
    });

    it("should set error message from string", () => {
      const errorMessage = "String error message";

      wrapper.vm.handleChartApiError(errorMessage);

      expect(wrapper.props("errorData").errors).toContain("String error message");
    });

    it("should emit handleChartApiError event", () => {
      const errorMessage = { message: "Test error" };

      wrapper.vm.handleChartApiError(errorMessage);

      expect(wrapper.emitted("handleChartApiError")).toBeTruthy();
      expect(wrapper.emitted("handleChartApiError").length).toBeGreaterThan(0);
    });
  });

  describe("hoveredSeriesState", () => {
    it("should set index values correctly", () => {
      wrapper.vm.hoveredSeriesState.setIndex(5, 2, 123, "2023-01-01");

      expect(wrapper.vm.hoveredSeriesState.dataIndex).toBe(5);
      expect(wrapper.vm.hoveredSeriesState.seriesIndex).toBe(2);
      expect(wrapper.vm.hoveredSeriesState.panelId).toBe(123);
      expect(wrapper.vm.hoveredSeriesState.hoveredTime).toBe("2023-01-01");
    });

    it("should handle null index values", () => {
      wrapper.vm.hoveredSeriesState.setIndex(null, null, null, null);

      expect(wrapper.vm.hoveredSeriesState.dataIndex).toBe(-1);
      expect(wrapper.vm.hoveredSeriesState.seriesIndex).toBe(-1);
      expect(wrapper.vm.hoveredSeriesState.panelId).toBe(-1);
      expect(wrapper.vm.hoveredSeriesState.hoveredTime).toBe(null);
    });
  });

  describe("addToDashboard Function", () => {
    afterEach(() => {
      persistReasonMock.value = null;
    });

    it("G1: stays closed, with the reason for the button, until the panel's run completes", () => {
      persistReasonMock.value = "Run the query first: this action saves or shares what you ran";
      expect((wrapper.vm as any).addToDashboardReason).toBe(
        "Run the query first: this action saves or shares what you ran",
      );
      mockValidatePanel.mockImplementation(() => {});
      wrapper.vm.addToDashboard();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
      expect(mockValidatePanel).not.toHaveBeenCalled();
    });

    it("should show dialog when no errors", () => {
      mockValidatePanel.mockImplementation(() => {
        // No errors added to array
      });

      wrapper.vm.addToDashboard();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
    });

    it("should not show dialog when validation errors exist", () => {
      mockValidatePanel.mockImplementation((errors) => {
        errors.push("Validation error");
      });

      wrapper.vm.addToDashboard();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
      expect(wrapper.props("errorData").errors).toEqual(["Validation error"]);
    });
  });

  describe("addPanelToDashboard Function", () => {
    it("should close add to dashboard dialog", () => {
      wrapper.vm.showAddToDashboardDialog = true;

      wrapper.vm.addPanelToDashboard();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
    });
  });

  // Migration coverage: dialog wrapper removed; AddToDashboard now uses
  // v-model:open and emits update:open / save directly (ODialog/ODrawer contract).
  describe("AddToDashboard integration (ODialog/ODrawer migration)", () => {
    it("should render AddToDashboard stub bound to showAddToDashboardDialog", async () => {
      mockValidatePanel.mockImplementation(() => {});
      wrapper.vm.addToDashboard();
      await wrapper.vm.$nextTick();

      const addToDashboard = wrapper.findComponent({ name: "AddToDashboard" });
      expect(addToDashboard.exists()).toBe(true);
      // showAddToDashboardDialog drives AddToDashboard's open state via v-model:open
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
    });

    it("should close dialog when AddToDashboard emits update:open=false", async () => {
      mockValidatePanel.mockImplementation(() => {});
      wrapper.vm.addToDashboard();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);

      const addToDashboard = wrapper.findComponent({ name: "AddToDashboard" });
      await addToDashboard.vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
    });

    it("should close dialog when AddToDashboard emits save (addPanelToDashboard)", async () => {
      mockValidatePanel.mockImplementation(() => {});
      wrapper.vm.addToDashboard();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);

      const addToDashboard = wrapper.findComponent({ name: "AddToDashboard" });
      await addToDashboard.vm.$emit("save");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
    });
  });

  // SKIPPED: collapseFieldList method moved to PanelEditor component
  // SKIPPED: onResultMetadataUpdate method moved to PanelEditor component
  // SKIPPED: updateVrlFunctionFieldList method moved to PanelEditor component
  // SKIPPED: isOutDated property moved to PanelEditor component
  // SKIPPED: Component lifecycle behavior changed after PanelEditor refactoring
  describe("Event Handling", () => {
    it("should update query splitter when showQueryBar changes to false", async () => {
      wrapper.vm.dashboardPanelData.layout.showQueryBar = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.dashboardPanelData.layout.showQueryBar = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardPanelData.layout.querySplitter).toBe(41);
    });
  });

  describe("Data Watchers", () => {
    it("should update chartData when visualizeChartData prop changes", async () => {
      const newChartData = { type: "bar", data: { series: [1, 2, 3] } };

      await wrapper.setProps({
        visualizeChartData: newChartData,
      });

      expect(wrapper.vm.chartData).toEqual(newChartData);
    });

    it("should deep watch visualizeChartData changes", async () => {
      const newChartData = {
        ...defaultProps.visualizeChartData,
        config: { title: "New Title" },
      };

      await wrapper.setProps({
        visualizeChartData: newChartData,
      });

      expect(wrapper.vm.chartData.config.title).toBe("New Title");
    });
  });

  describe("Error Scenarios", () => {
    it("should handle missing resultMetaData gracefully in addToDashboard", () => {
      wrapper.vm.resultMetaData = null;

      mockValidatePanel.mockImplementation(() => {
        // No errors
      });

      expect(() => wrapper.vm.addToDashboard()).not.toThrow();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined hoveredTime in setIndex", () => {
      wrapper.vm.hoveredSeriesState.setIndex(1, 2, 3);

      expect(wrapper.vm.hoveredSeriesState.hoveredTime).toBe(null);
    });
  });

  /**
   * VRL Visualization Support Tests - handleChartTypeChange
   * PR Reference: https://github.com/openobserve/openobserve/pull/10343
   *
   * Tests for the updated handleChartTypeChange behavior.
   * VRL functions no longer block chart type switching - switching is allowed
   * and VRL editor becomes disabled (readOnly) for non-table charts instead.
   */
  describe("VRL Visualization Support - handleChartTypeChange", () => {
    it("should not block any chart type when VRL functions are present", () => {
      wrapper.vm.dashboardPanelData.meta.stream.vrlFunctionFieldList = [
        { name: "vrl_field", type: "Utf8" },
      ];

      const chartTypes = ["table", "line", "bar", "area", "scatter", "h-bar"];

      if (typeof wrapper.vm.handleChartTypeChange === "function") {
        chartTypes.forEach((chartType) => {
          wrapper.vm.handleChartTypeChange(chartType);
          expect(wrapper.vm.dashboardPanelData.data.type).toBe(chartType);
        });
      }
    });
  });
});
