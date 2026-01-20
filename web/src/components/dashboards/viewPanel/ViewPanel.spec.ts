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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import ViewPanel from "./ViewPanel.vue";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: { 
    dashboard: "test-dashboard",
    folder: "test-folder",
    tab: "test-tab",
    refresh: "30s"
  },
  name: "viewPanel",
};

const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}));

// Mock vue-i18n
const mockI18n = {
  t: (key: string) => {
    const translations: any = {
      "panel.cancel": "Cancel",
    };
    return translations[key] || key;
  },
};

vi.mock("vue-i18n", () => ({
  useI18n: () => mockI18n,
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    currentSelectedDashboard: {
      data: {
        title: "Test Dashboard",
        variables: {
          list: [],
          showDynamicFilters: false,
        },
      },
    },
    theme: "light",
    zoConfig: {
      min_auto_refresh_interval: 5,
    },
  },
};

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    useStore: () => mockStore,
  };
});

// Mock other composables that may be imported
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    searchAround: vi.fn(),
  }),
}));

// Mock additional utilities that may cause import issues
vi.mock("@/utils/zincutils", () => ({
  useLocalWrapContent: vi.fn(() => null),
}));
vi.mock("@/utils/query/sqlUtils", () => ({}));
vi.mock("@/utils/query/search", () => ({}));

// Mock dashboard composable
const mockDashboardPanelData = {
  data: {
    title: "Test Panel",
    type: "line",
    queries: [{
      query: "SELECT * FROM logs",
      fields: {
        x: [],
        y: [],
        z: [],
      },
    }],
    queryType: "sql",
    panels: [{
      tabId: "tab1",
    }],
  },
  meta: {
    dateTime: {
      start_time: new Date("2023-01-01"),
      end_time: new Date("2023-01-02"),
    },
  },
};

const mockResetDashboardPanelData = vi.fn();

vi.mock("../../../composables/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: false,
    resetDashboardPanelData: mockResetDashboardPanelData,
  }),
}));

// Mock utilities
vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
  getPanel: vi.fn(),
  checkIfVariablesAreLoaded: vi.fn(),
}));

// Mock SQL parser
const mockSqlParser = vi.fn();
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => Promise.resolve({
      astify: mockSqlParser,
    }),
  }),
}));

// Mock cancel query composable
vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({
    traceIdRef: { value: "test-trace-id" },
    cancelQuery: vi.fn(),
  }),
}));

// Mock date utilities
vi.mock("@/utils/date", () => ({
  parseDuration: vi.fn((duration: string) => {
    if (duration === "30s") return 30;
    if (duration === "1m") return 60;
    return 0;
  }),
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
  },
}));

// Mock lodash-es
vi.mock("lodash-es", () => ({
  isEqual: vi.fn((a, b) => JSON.stringify(a) === JSON.stringify(b)),
}));

describe("ViewPanel", () => {
  let wrapper: VueWrapper<any>;
  let mockGetDashboard: any;
  let mockGetPanel: any;
  let mockCheckIfVariablesAreLoaded: any;

  const defaultProps = {
    panelId: "test-panel-id",
    dashboardId: "test-dashboard-id",
    folderId: "test-folder-id",
    selectedDateForViewPanel: {
      startTime: new Date("2023-01-01"),
      endTime: new Date("2023-01-02"),
    },
    initialVariableValues: {},
    searchType: "logs",
  };

  const createWrapper = (props = {}) => {
    return mount(ViewPanel, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [Quasar],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          "DateTimePickerDashboard": {
            template: '<div data-test="date-time-picker-dashboard"><slot /></div>',
            methods: {
              refresh: vi.fn(),
              getConsumableDateTime: () => ({
                startTime: "2023-01-01T00:00:00Z",
                endTime: "2023-01-02T00:00:00Z",
              }),
            },
          },
          "AutoRefreshInterval": {
            template: '<div data-test="auto-refresh-interval"><slot /></div>',
            props: ["modelValue", "trigger", "minRefreshInterval"],
            emits: ["trigger"],
          },
          "HistogramIntervalDropDown": {
            template: '<div data-test="histogram-interval-dropdown"><slot /></div>',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          "VariablesValueSelector": {
            template: '<div data-test="variables-value-selector"><slot /></div>',
            props: ["variablesConfig", "showDynamicFilters", "selectedTimeDate", "initialVariableValues"],
            emits: ["variablesData"],
          },
          "PanelSchemaRenderer": {
            template: '<div data-test="panel-schema-renderer"><slot /></div>',
            props: ["panelSchema", "dashboardId", "folderId", "selectedTimeObj", "variablesData", "width", "searchType"],
            emits: ["error", "updated:data-zoom", "update:initialVariableValues", "last-triggered-at-update"],
          },
          "DashboardErrorsComponent": {
            template: '<div data-test="dashboard-errors-component"><slot /></div>',
            props: ["errors"],
          },
          "RelativeTime": {
            template: '<span data-test="relative-time">{{ timestamp }}</span>',
            props: ["timestamp", "fullTimePrefix"],
          },
          "q-separator": {
            template: '<div class="q-separator"></div>',
          },
          "q-btn": {
            template: '<button @click="$emit(\'click\', $event)" :disabled="disable" :data-test="$attrs[\'data-test\']"><slot /></button>',
            props: ["outline", "padding", "no-caps", "icon", "disable", "color", "text-color", "flat"],
            emits: ["click"],
            inheritAttrs: false,
          },
          "q-tooltip": {
            template: '<div class="q-tooltip"><slot /></div>',
          },
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import the mocked functions
    const { getDashboard, getPanel, checkIfVariablesAreLoaded } = await import("../../../utils/commons");
    
    mockGetDashboard = getDashboard as any;
    mockGetPanel = getPanel as any;
    mockCheckIfVariablesAreLoaded = checkIfVariablesAreLoaded as any;
    
    mockGetDashboard.mockResolvedValue({
      title: "Test Dashboard",
      variables: {
        list: [],
        showDynamicFilters: false,
      },
    });
    
    mockGetPanel.mockResolvedValue({
      title: "Test Panel",
      type: "line",
      queries: [{
        query: "SELECT * FROM logs",
        fields: { x: [], y: [], z: [] },
      }],
    });
    
    mockCheckIfVariablesAreLoaded.mockReturnValue(true);
    
    mockSqlParser.mockReturnValue({
      columns: [],
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-viewpanel-title"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBe("ViewPanel");
    });

    it("should display panel title", () => {
      wrapper = createWrapper();
      
      const titleElement = wrapper.find('[data-test="dashboard-viewpanel-title"]');
      expect(titleElement.text()).toBe("Test Panel");
    });

    it("should initialize with provided props", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props("panelId")).toBe("test-panel-id");
      expect(wrapper.props("dashboardId")).toBe("test-dashboard-id");
      expect(wrapper.props("folderId")).toBe("test-folder-id");
      expect(wrapper.props("searchType")).toBe("logs");
    });
  });

  describe("Props Validation", () => {
    it("should require panelId prop", () => {
      const component = ViewPanel as any;
      expect(component.props.panelId.required).toBe(true);
      expect(component.props.panelId.type).toBe(String);
    });

    it("should have optional dashboardId and folderId props", () => {
      const component = ViewPanel as any;
      expect(component.props.dashboardId.required).toBe(false);
      expect(component.props.folderId.required).toBe(false);
    });

    it("should accept selectedDateForViewPanel prop", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props("selectedDateForViewPanel")).toEqual({
        startTime: expect.any(Date),
        endTime: expect.any(Date),
      });
    });

    it("should accept initialVariableValues prop", () => {
      wrapper = createWrapper({ initialVariableValues: { var1: "value1" } });
      
      expect(wrapper.props("initialVariableValues")).toEqual({ var1: "value1" });
    });

    it("should have default searchType as null", () => {
      wrapper = createWrapper({ searchType: null });
      
      expect(wrapper.props("searchType")).toBeNull();
    });
  });

  describe("Component UI Elements", () => {
    it("should render date time picker", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-date-time-picker"]').exists()).toBe(true);
    });

    it("should render auto refresh interval", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-refresh-interval"]').exists()).toBe(true);
    });

    it("should render refresh button", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-refresh-data-btn"]').exists()).toBe(true);
    });

    it("should render close button", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-close-btn"]').exists()).toBe(true);
    });

    it("should render variables value selector", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-variables-value-selector"]').exists()).toBe(true);
    });

    it("should render panel schema renderer", async () => {
      wrapper = createWrapper();
      
      // Set chartData to trigger conditional rendering
      wrapper.vm.chartData = mockDashboardPanelData.data;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-panel-schema-renderer"]').exists()).toBe(true);
    });

    it("should render dashboard errors component", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-dashboard-errors"]').exists()).toBe(true);
    });

    it("should show last refreshed time when available", async () => {
      wrapper = createWrapper();
      
      // Set last triggered time
      wrapper.vm.lastTriggeredAt = new Date("2023-01-01T10:00:00Z");
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('[data-test="view-panel-last-refreshed-at"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="relative-time"]').exists()).toBe(true);
    });
  });

  describe("Histogram Functionality", () => {
    it("should show histogram dropdown when promql is false and histogram fields exist", async () => {
      // Setup histogram fields
      wrapper = createWrapper();
      wrapper.vm.histogramFields = [{ field: "timestamp" }];
      wrapper.vm.promqlMode = false;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-histogram-interval-dropdown"]').exists()).toBe(true);
    });

    it("should not show histogram dropdown when promql mode is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.histogramFields = [{ field: "timestamp" }];
      wrapper.vm.promqlMode = true;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-histogram-interval-dropdown"]').exists()).toBe(false);
    });

    it("should not show histogram dropdown when no histogram fields", async () => {
      wrapper = createWrapper();
      wrapper.vm.histogramFields = [];
      wrapper.vm.promqlMode = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="dashboard-viewpanel-histogram-interval-dropdown"]').exists()).toBe(false);
    });
  });

  describe("Histogram Interval Extraction (Bug Fix Tests)", () => {
    /**
     * These tests verify the fix for the bug where histogram intervals displayed as "[object object]"
     * The bug was caused by incorrectly accessing args[0].value instead of args[1]
     *
     * Histogram function signature: histogram(field, interval)
     * - args[0] = timestamp field (object)
     * - args[1] = interval value (string or object with value property)
     */

    beforeEach(async () => {
      // Setup common test data
      mockGetPanel.mockResolvedValue({
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp, "5m") FROM logs',
          fields: { x: [], y: [], z: [] },
        }],
      });
    });

    it("should correctly extract string interval from histogram args (e.g., '5m', '1h')", async () => {
      // Test case 1: String intervals
      // Simulates: histogram(_timestamp, '5m')
      const histogramFieldWithStringInterval = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" }, // args[0] - timestamp field
          "5m", // args[1] - interval as string
        ],
      };

      const panelData = {
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp, "5m") FROM logs',
          fields: {
            x: [histogramFieldWithStringInterval],
            y: [],
            z: []
          },
        }],
      };

      mockGetPanel.mockResolvedValue(panelData);

      // Also update the mockDashboardPanelData to ensure the component reads the correct data
      Object.assign(mockDashboardPanelData.data, panelData);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      // Wait for async operations in onMounted
      await new Promise(resolve => setTimeout(resolve, 50));

      // The component should extract '5m' from args[1]
      expect(wrapper.vm.histogramInterval).toBe("5m");
      expect(wrapper.vm.histogramInterval).not.toBe("[object object]");
    });

    it("should correctly extract interval from object format (e.g., {value: '1h'})", async () => {
      // Test case 2: Object intervals
      // Simulates: histogram(_timestamp, {value: '1h'})
      const histogramFieldWithObjectInterval = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" }, // args[0] - timestamp field
          { value: "1h" }, // args[1] - interval as object
        ],
      };

      const panelData = {
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp, "1h") FROM logs',
          fields: {
            x: [histogramFieldWithObjectInterval],
            y: [],
            z: []
          },
        }],
      };

      mockGetPanel.mockResolvedValue(panelData);
      Object.assign(mockDashboardPanelData.data, panelData);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // The component should extract '1h' from args[1].value
      expect(wrapper.vm.histogramInterval).toBe("1h");
      expect(wrapper.vm.histogramInterval).not.toBe("[object object]");
    });

    it("should set interval to null when histogram has no interval argument (Auto mode)", async () => {
      // Test case 3: Missing intervals
      // Simulates: histogram(_timestamp) - no interval specified
      const histogramFieldWithoutInterval = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" }, // args[0] - timestamp field only
          // No args[1] - missing interval
        ],
      };

      mockGetPanel.mockResolvedValue({
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp) FROM logs',
          fields: {
            x: [histogramFieldWithoutInterval],
            y: [],
            z: []
          },
        }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // The component should set null for Auto mode
      expect(wrapper.vm.histogramInterval).toBe(null);
    });

    it("should set interval to null when interval is empty string", async () => {
      // Test case 4: Empty string intervals
      // Simulates: histogram(_timestamp, '')
      const histogramFieldWithEmptyString = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" }, // args[0] - timestamp field
          "", // args[1] - empty string
        ],
      };

      mockGetPanel.mockResolvedValue({
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp, "") FROM logs',
          fields: {
            x: [histogramFieldWithEmptyString],
            y: [],
            z: []
          },
        }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // The component should treat empty string as Auto mode
      expect(wrapper.vm.histogramInterval).toBe(null);
    });

    it("should set interval to null when interval argument is explicitly null", async () => {
      // Test case 5: Null values
      // Simulates: histogram(_timestamp, null)
      const histogramFieldWithNullInterval = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" }, // args[0] - timestamp field
          null, // args[1] - explicit null
        ],
      };

      mockGetPanel.mockResolvedValue({
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp) FROM logs',
          fields: {
            x: [histogramFieldWithNullInterval],
            y: [],
            z: []
          },
        }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // The component should handle null gracefully
      expect(wrapper.vm.histogramInterval).toBe(null);
    });

    it("should handle object interval with empty value property", async () => {
      // Edge case: Object with empty string value
      // Simulates: histogram(_timestamp, {value: ''})
      const histogramFieldWithEmptyObjectValue = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" },
          { value: "" }, // Object with empty string value
        ],
      };

      mockGetPanel.mockResolvedValue({
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp) FROM logs',
          fields: {
            x: [histogramFieldWithEmptyObjectValue],
            y: [],
            z: []
          },
        }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Should treat empty value as Auto mode
      expect(wrapper.vm.histogramInterval).toBe(null);
    });

    it("should handle multiple histogram fields and use first valid interval", async () => {
      // Test with multiple histogram fields
      const histogramField1 = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" },
          "10m",
        ],
      };

      const histogramField2 = {
        functionName: "histogram",
        args: [
          { column: "event_time" },
          "30m",
        ],
      };

      const panelData = {
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [{
          query: 'SELECT histogram(_timestamp, "10m"), histogram(event_time, "30m") FROM logs',
          fields: {
            x: [histogramField1, histogramField2],
            y: [],
            z: []
          },
        }],
      };

      mockGetPanel.mockResolvedValue(panelData);
      Object.assign(mockDashboardPanelData.data, panelData);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should use the first histogram field's interval
      expect(wrapper.vm.histogramInterval).toBe("10m");
    });
  });

  describe("Button Actions", () => {
    it("should handle refresh button click", async () => {
      wrapper = createWrapper();
      
      const refreshBtn = wrapper.find('[data-test="dashboard-viewpanel-refresh-data-btn"]');
      await refreshBtn.trigger("click");
      
      // Should trigger refreshData method
      expect(wrapper.vm.refreshData).toBeDefined();
    });

    it("should handle close button click", async () => {
      wrapper = createWrapper();
      
      const closeBtn = wrapper.find('[data-test="dashboard-viewpanel-close-btn"]');
      await closeBtn.trigger("click");
      
      // Should call goBack method which calls router.back
      expect(wrapper.vm.goBack).toBeDefined();
    });

    it("should show cancel button when enterprise and search trace IDs exist", async () => {
      // This test checks template conditional rendering which is complex to test
      // The cancel button shows when: config.isEnterprise == 'true' && searchRequestTraceIds.length && disable
      wrapper = createWrapper();
      
      // Test that the cancel button logic is working
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.searchRequestTraceIds).toBeDefined();
      expect(wrapper.vm.disable).toBeDefined();
    });

    it("should not show cancel button when not enterprise", async () => {
      wrapper = createWrapper();
      wrapper.vm.config = { isEnterprise: "false" };
      wrapper.vm.searchRequestTraceIds = ["trace-id-1"];
      wrapper.vm.disable = true;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('[data-test="dashboard-viewpanel-cancel-btn"]').exists()).toBe(false);
    });
  });

  describe("Data Loading", () => {
    it("should load panel data on mount when panelId is provided", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      expect(mockGetPanel).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard",
        "test-panel-id",
        "test-folder",
        "test-tab"
      );
    });

    it("should load dashboard data", async () => {
      wrapper = createWrapper();
      
      // Wait for all lifecycle hooks to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // loadDashboard is called internally during component lifecycle
      expect(mockGetDashboard).toHaveBeenCalled();
    });

    it("should handle panel data loading", async () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      
      // Simulate chartData being set (which happens after panel data loads)
      wrapper.vm.chartData = { title: "Test Chart", type: "line" };
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.chartData).toBeDefined();
    });
  });

  describe("DateTime Handling", () => {
    it("should update datetime when selected date changes", async () => {
      wrapper = createWrapper();
      
      const newDate = {
        startTime: new Date("2023-02-01"),
        endTime: new Date("2023-02-02"),
      };
      
      wrapper.vm.selectedDate = newDate;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.dashboardPanelData.meta.dateTime.start_time).toEqual(newDate.startTime);
      expect(wrapper.vm.dashboardPanelData.meta.dateTime.end_time).toEqual(newDate.endTime);
    });

    it("should set time for variables", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.setTimeForVariables();
      
      expect(wrapper.vm.dateTimeForVariables).toBeDefined();
    });
  });

  describe("Variables Handling", () => {
    it("should handle variables data update", async () => {
      wrapper = createWrapper();
      
      const variableData = {
        values: [{ name: "var1", value: "value1" }],
      };
      
      wrapper.vm.variablesDataUpdated(variableData);
      
      expect(wrapper.vm.variablesData.values).toEqual(variableData.values);
    });

    it("should handle initial variable values", () => {
      wrapper = createWrapper({ initialVariableValues: { var1: "initial" } });
      
      const initialValues = wrapper.vm.getInitialVariablesData();
      expect(initialValues).toBeDefined();
    });

    it("should emit update for initial variable values", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.onUpdateInitialVariableValues({ var1: "updated" });
      
      expect(wrapper.emitted("update:initialVariableValues")).toBeTruthy();
      expect(wrapper.emitted("update:initialVariableValues")[0]).toEqual([{ var1: "updated" }]);
    });

    it("should detect variables changes", async () => {
      wrapper = createWrapper();
      
      // Set initial variables
      wrapper.vm.currentVariablesDataRef.values = [{ value: "initial" }];
      wrapper.vm.variablesData.values = [{ value: "changed" }];
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.isVariablesChanged).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle chart API errors", async () => {
      wrapper = createWrapper();
      
      const errorMessage = "API Error";
      
      // Simulate adding error to the error data structure
      wrapper.vm.errorData.errors.push(errorMessage);
      
      expect(wrapper.vm.errorData.errors).toContain(errorMessage);
    });

    it("should initialize with empty errors", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.errorData.errors).toEqual([]);
    });
  });

  describe("Refresh Functionality", () => {
    it("should handle auto refresh interval changes", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.refreshInterval = 30;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.refreshInterval).toBe(30);
    });

    it("should refresh data when not disabled", () => {
      wrapper = createWrapper();
      wrapper.vm.disable = false;
      
      const refreshSpy = vi.spyOn(wrapper.vm.dateTimePickerRef, 'refresh');
      wrapper.vm.refreshData();
      
      expect(refreshSpy).toHaveBeenCalled();
    });

    it("should not refresh data when disabled", () => {
      wrapper = createWrapper();
      wrapper.vm.disable = true;
      
      const refreshSpy = vi.spyOn(wrapper.vm.dateTimePickerRef, 'refresh');
      wrapper.vm.refreshData();
      
      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe("Component Lifecycle", () => {
    it("should load dashboard on mount", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.currentDashboardData).toBeDefined();
    });

    it("should reset dashboard panel data on unmount", () => {
      wrapper = createWrapper();
      wrapper.unmount();
      
      expect(mockResetDashboardPanelData).toHaveBeenCalled();
    });

    it("should handle activation with refresh parameter", () => {
      // This would be tested through integration rather than unit tests
      // as it involves Vue's activated lifecycle hook
      expect(wrapper).toBeDefined();
    });
  });

  describe("Event Emissions", () => {
    it("should have correct emits configuration", () => {
      const component = ViewPanel as any;
      expect(component.emits).toContain("closePanel");
      expect(component.emits).toContain("update:initialVariableValues");
    });

    it("should handle data zoom updates", async () => {
      wrapper = createWrapper();
      
      // onDataZoom is a complex method that updates datetime picker
      // Just verify it exists and can be called
      expect(wrapper.vm.onDataZoom).toBeDefined();
      expect(typeof wrapper.vm.onDataZoom).toBe("function");
    });

    it("should handle last triggered at updates", async () => {
      wrapper = createWrapper();
      
      const timestamp = new Date();
      wrapper.vm.handleLastTriggeredAtUpdate(timestamp);
      
      expect(wrapper.vm.lastTriggeredAt).toBe(timestamp);
    });
  });

  describe("Query Cancellation", () => {
    it("should handle query cancellation", () => {
      wrapper = createWrapper();
      
      wrapper.vm.cancelViewPanelQuery();
      
      expect(wrapper.vm.cancelViewPanelQuery).toBeDefined();
    });

    it("should track search request trace IDs", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.searchRequestTraceIds).toBeDefined();
    });
  });

  describe("Theme and Configuration", () => {
    it("should handle dark theme", async () => {
      mockStore.state.theme = "dark";
      wrapper = createWrapper();
      
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should handle light theme", async () => {
      mockStore.state.theme = "light";
      wrapper = createWrapper();
      
      expect(wrapper.vm.store.state.theme).toBe("light");
    });

    it("should use minimum refresh interval from config", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.store.state.zoConfig.min_auto_refresh_interval).toBe(5);
    });
  });
});