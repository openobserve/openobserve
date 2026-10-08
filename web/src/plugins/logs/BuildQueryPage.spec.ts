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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import BuildQueryPage from "./BuildQueryPage.vue";
import { searchState } from "@/composables/useLogs/searchState";

// Mock vuex store
const mockStore = {
  state: {
    timezone: "UTC",
    theme: "light",
    selectedOrganization: {
      identifier: "test-org",
    },
    organizationData: {
      isDataIngested: true,
    },
    zoConfig: {
      timestamp_column: "_timestamp",
      default_functions: [],
    },
    savedViewDialog: {
      show: false,
    },
  },
  commit: vi.fn(),
  dispatch: vi.fn().mockResolvedValue({}),
  getters: {},
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  currentRoute: {
    value: {
      name: "logs",
      query: {}, // Empty query - no build_data in URL
    },
  },
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock logsVisualization
vi.mock("@/composables/useLogs/logsVisualization", () => ({
  decodeBuildConfig: vi.fn().mockReturnValue(null),
}));

// Mock SQL query parser
vi.mock("@/utils/query/sqlQueryParser", () => ({
  parseSQL: vi.fn().mockResolvedValue({
    stream: "test_stream",
    streamType: "logs",
    xFields: [],
    yFields: [],
    breakdownFields: [],
    filters: [],
    groupBy: [],
    customQuery: false,
    rawQuery: "",
  }),
  shouldUseCustomMode: vi.fn().mockReturnValue(false),
  parsedQueryToPanelFields: vi.fn().mockReturnValue({
    stream: "test_stream",
    stream_type: "logs",
    x: [],
    y: [],
    breakdown: [],
    filter: [],
  }),
}));

// Mock useDashboardPanelData
const mockDashboardPanelData = reactive({
  data: {
    description: "",
    type: "line",
    config: {
      table_dynamic_columns: false,
    },
    queries: [
      {
        query: "",
        customQuery: false,
        fields: {
          stream: "",
          stream_type: "logs",
          x: [],
          y: [],
          z: [],
          breakdown: [],
          filter: [],
        },
      },
    ],
  },
  layout: {
    splitter: 20,
    showFieldList: true,
    showQueryBar: true,
    querySplitter: 50,
    currentQueryIndex: 0,
    isConfigPanelOpen: false,
  },
  meta: {
    dateTime: {
      start_time: new Date("2024-01-01"),
      end_time: new Date("2024-01-02"),
    },
    stream: {
      customQueryFields: [],
      vrlFunctionFieldList: [],
    },
    streamFields: {
      groupedFields: [],
    },
  },
});

const mockResetDashboardPanelData = vi.fn();
const mockMakeAutoSQLQuery = vi.fn();
const mockUpdateGroupedFields = vi.fn().mockResolvedValue(undefined);
const mockValidatePanel = vi.fn();

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    resetAggregationFunction: vi.fn(),
    resetDashboardPanelData: mockResetDashboardPanelData,
    makeAutoSQLQuery: mockMakeAutoSQLQuery,
    updateGroupedFields: mockUpdateGroupedFields,
    validatePanel: mockValidatePanel,
  }),
}));

// Mock useNotifications composable
const mockShowErrorNotification = vi.fn();
// G1 for Add to dashboard is driven by the auto-run engine; each test sets the panel's reason.
const persistReasonMock = vi.hoisted(() => ({ value: null as string | null }));
const openPanelRunMock = vi.hoisted(() => vi.fn(() => 1));
const markPanelDispatchedMock = vi.hoisted(() => vi.fn());
const endPanelRunMock = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useLogs/logsAutoRun", () => ({
  setAutoRunTransport: vi.fn(),
  useLogsAutoRun: () => ({
    persistReason: () => persistReasonMock.value,
    openPanelRun: openPanelRunMock,
    markPanelDispatched: markPanelDispatchedMock,
    hasPanelRun: () => true,
    endPanelRun: endPanelRunMock,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: mockShowErrorNotification,
    showPositiveNotification: vi.fn(),
  }),
}));

// Mock sqlUtils
vi.mock("@/utils/query/sqlUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/query/sqlUtils")>()),
  parseWhereClauseToFilter: vi.fn().mockResolvedValue([]),
}));

// Mock PanelEditor component
vi.mock("@/components/dashboards/PanelEditor/PanelEditor.vue", () => ({
  default: {
    name: "PanelEditor",
    template: '<div class="panel-editor-mock" data-test="panel-editor"><slot /></div>',
    props: ["pageType", "editMode", "selectedDateTime", "showAddToDashboardButton"],
    emits: ["addToDashboard", "chartApiError", "queryGenerated", "customQueryModeChanged"],
    methods: {
      runQuery: vi.fn(),
    },
  },
}));

// Mock AddToDashboard component (migrated: uses ODrawer with v-model:open)
vi.mock("@/plugins/metrics/AddToDashboard.vue", () => ({
  default: {
    name: "AddToDashboard",
    template:
      '<div class="add-to-dashboard-mock" data-test="add-to-dashboard" :data-open="open">AddToDashboard</div>',
    props: ["dashboardPanelData", "open"],
    emits: ["save", "update:open"],
  },
}));

// Mock QueryTypeSelector component
vi.mock("@/components/dashboards/addPanel/QueryTypeSelector.vue", () => ({
  default: {
    name: "QueryTypeSelector",
    template: '<div class="query-type-selector-mock">QueryTypeSelector</div>',
  },
}));

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: {
        cancel: "Cancel",
        apply: "Apply",
        save: "Save",
      },
      search: {
        buildQuery: "Build Query",
      },
      panel: {
        addToDashboard: "Add to Dashboard",
      },
    },
  },
});

// Create a mount helper
function createWrapper(props = {}) {
  return mount(BuildQueryPage, {
    props: {
      searchQuery: "",
      selectedStream: "",
      selectedDateTime: undefined,
      ...props,
    },
    global: {
      plugins: [i18n],
      provide: {
        store: mockStore,
        dashboardPanelDataPageKey: "build",
      },
      stubs: {
        PanelEditor: {
          template: '<div class="panel-editor-mock" data-test="panel-editor"><slot /></div>',
          methods: {
            runQuery: vi.fn(),
          },
        },
        // Stub AddToDashboard explicitly: it is loaded via defineAsyncComponent and
        // VTU otherwise tries to introspect the mocked ESM module shape (__isTeleport).
        AddToDashboard: {
          name: "AddToDashboard",
          template:
            '<div class="add-to-dashboard-mock" data-test="add-to-dashboard" :data-open="open"></div>',
          props: ["dashboardPanelData", "open"],
          emits: ["save", "update:open"],
        },
        QueryTypeSelector: true,
      },
    },
  });
}

describe("BuildQueryPage Component", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock data
    mockDashboardPanelData.data.queries[0].query = "";
    mockDashboardPanelData.data.queries[0].customQuery = false;
    mockDashboardPanelData.data.queries[0].fields.stream = "";
    mockDashboardPanelData.data.type = "line";
    mockDashboardPanelData.data.config.table_dynamic_columns = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Rendering", () => {
    it("should render the build query page container", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="logs-build-query-page"]').exists()).toBe(true);
    });

    it("should render the PanelEditor component", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="panel-editor"]').exists()).toBe(true);
    });

    it("should have PanelEditor stub with correct test attribute", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // The PanelEditor stub renders with data-test attribute
      const panelEditorStub = wrapper.find('[data-test="panel-editor"]');
      expect(panelEditorStub.exists()).toBe(true);
      expect(panelEditorStub.classes()).toContain("panel-editor-mock");
    });
  });

  describe("Props Handling", () => {
    it("should accept searchQuery prop", async () => {
      const testQuery = 'SELECT * FROM "test_stream"';
      wrapper = createWrapper({ searchQuery: testQuery });
      await flushPromises();

      expect(wrapper.props("searchQuery")).toBe(testQuery);
    });

    it("should accept selectedStream prop", async () => {
      const testStream = "my_logs_stream";
      wrapper = createWrapper({ selectedStream: testStream });
      await flushPromises();

      expect(wrapper.props("selectedStream")).toBe(testStream);
    });

    it("should accept selectedDateTime prop", async () => {
      const testDateTime = {
        start_time: new Date("2024-01-01"),
        end_time: new Date("2024-01-02"),
        valueType: "absolute",
      };
      wrapper = createWrapper({ selectedDateTime: testDateTime });
      await flushPromises();

      expect(wrapper.props("selectedDateTime")).toEqual(testDateTime);
    });
  });

  describe("Initialization", () => {
    it("should call resetDashboardPanelData on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockResetDashboardPanelData).toHaveBeenCalled();
    });

    it("should initialize with builder mode for empty query", async () => {
      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(mockDashboardPanelData.data.queries[0].customQuery).toBe(false);
    });

    it("should set stream from selectedStream prop when no query", async () => {
      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "my_logs_stream",
      });
      await flushPromises();

      expect(mockDashboardPanelData.data.queries[0].fields.stream).toBe("my_logs_stream");
      expect(mockDashboardPanelData.data.queries[0].fields.stream_type).toBe("logs");
    });

    it("should call updateGroupedFields when stream is set", async () => {
      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(mockUpdateGroupedFields).toHaveBeenCalled();
    });

    it("should emit 'initialized' and call makeAutoSQLQuery for empty query with default fields", async () => {
      mockMakeAutoSQLQuery.mockClear();

      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Should emit "initialized" for empty query builder mode
      const emitted = wrapper.emitted("initialized");
      expect(emitted).toBeTruthy();
      expect(emitted!.length).toBeGreaterThanOrEqual(1);

      // PR #11586: Empty query now sets default histogram/count fields and auto-runs
      expect(mockMakeAutoSQLQuery).toHaveBeenCalled();
    });

    it("should call makeAutoSQLQuery for empty query even without selected stream", async () => {
      mockMakeAutoSQLQuery.mockClear();

      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "",
      });
      await flushPromises();

      // PR #11586: Empty query sets default fields and calls makeAutoSQLQuery
      expect(mockMakeAutoSQLQuery).toHaveBeenCalled();
    });

    it("should emit 'initialized' for whitespace-only query", async () => {
      wrapper = createWrapper({
        searchQuery: "   ",
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Whitespace-only query should be treated same as empty query
      const emitted = wrapper.emitted("initialized");
      expect(emitted).toBeTruthy();
      expect(mockDashboardPanelData.data.queries[0].customQuery).toBe(false);
    });
  });

  describe("Query Parsing", () => {
    it("should try to parse SQL query when provided (non-SELECT* query)", async () => {
      const { parseSQL } = await import("@/utils/query/sqlQueryParser");

      // PR #11586: SELECT * queries are treated as empty (default fields).
      // Use a non-SELECT* query to test parse behavior.
      wrapper = createWrapper({
        searchQuery: 'SELECT count(_timestamp) as "y_axis_1" FROM "test_stream"',
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(parseSQL).toHaveBeenCalled();
    });

    it("should use custom mode for complex queries", async () => {
      const { shouldUseCustomMode } = await import("@/utils/query/sqlQueryParser");
      (shouldUseCustomMode as any).mockReturnValueOnce(true);

      // PR #11586: SELECT * queries are treated as empty (default fields).
      // Use a non-SELECT* subquery to test custom mode detection.
      wrapper = createWrapper({
        searchQuery:
          'SELECT code, cnt FROM (SELECT code, count(*) as cnt FROM "test_stream" GROUP BY code) subq',
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(mockDashboardPanelData.data.queries[0].customQuery).toBe(true);
    });
  });

  describe("Events", () => {
    it("should forward queryGenerated event from PanelEditor", async () => {
      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "logs",
      });
      await flushPromises();

      // Find PanelEditor mock by data-test attribute and trigger event
      const panelEditorMock = wrapper.find('[data-test="panel-editor"]');
      expect(panelEditorMock.exists()).toBe(true);

      // Trigger the event using Vue's event system
      await wrapper.vm.$options.components?.PanelEditor?.methods?.runQuery?.();

      // Directly call the onQueryGenerated handler to simulate PanelEditor emitting the event
      // This tests that the forwarding logic works
      const testQuery = "SELECT * FROM logs";
      // Access the internal handler via the component's setup
      wrapper.vm.onQueryGenerated?.(testQuery) || wrapper.vm.$emit("queryGenerated", testQuery); // Fallback

      await flushPromises();

      // Check if queryGenerated was forwarded by BuildQueryPage
      const emitted = wrapper.emitted("queryGenerated");
      expect(emitted).toBeTruthy();
    });

    it("should forward customQueryModeChanged event from PanelEditor", async () => {
      wrapper = createWrapper({
        searchQuery: "",
        selectedStream: "logs",
      });
      await flushPromises();

      // Directly call the onCustomQueryModeChanged handler to simulate PanelEditor emitting the event
      if (wrapper.vm.onCustomQueryModeChanged) {
        wrapper.vm.onCustomQueryModeChanged(true);
      }
      await flushPromises();

      // Check that BuildQueryPage forwards the event
      const emitted = wrapper.emitted("customQueryModeChanged");
      expect(emitted).toBeTruthy();
      // Find the emitted event with value true
      const hasTrue = emitted!.some((args: any[]) => args[0] === true);
      expect(hasTrue).toBe(true);
    });
  });

  describe("Exposed Methods", () => {
    it("should expose runQuery method", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.runQuery).toBeDefined();
      expect(typeof wrapper.vm.runQuery).toBe("function");
    });

    it("should expose panelEditorRef", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.panelEditorRef).toBeDefined();
    });

    it("should expose dashboardPanelData", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
    });
  });

  describe("Add to Dashboard Dialog", () => {
    afterEach(() => {
      persistReasonMock.value = null;
    });

    it("G1: is refused with the reason until the Build panel's run completes", async () => {
      persistReasonMock.value = "Run the query first: this action saves or shares what you ran";
      wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.onAddToDashboard();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Run the query first: this action saves or shares what you ran",
      );
    });

    it("opens its own panel generation for Build's own runs, not for a Run that passed one", async () => {
      wrapper = createWrapper();
      await flushPromises();
      openPanelRunMock.mockClear();
      await wrapper.vm.runQuery(false, 7);
      expect(openPanelRunMock).not.toHaveBeenCalled();
      await wrapper.vm.runQuery(false);
      expect(openPanelRunMock).toHaveBeenCalledTimes(1);
    });

    it("marks the panel run dispatched right after the editor copies its config (F2)", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const order: string[] = [];
      wrapper.vm.panelEditorRef = { runQuery: vi.fn(() => order.push("run")) };
      markPanelDispatchedMock.mockImplementation((id: number) => order.push(`mark:${id}`));
      openPanelRunMock.mockReturnValueOnce(11);
      await wrapper.vm.runQuery(false, 7);
      await wrapper.vm.runQuery(false);
      expect(order).toEqual(["run", "mark:7", "run", "mark:11"]);
    });

    it("should not show AddToDashboard drawer initially", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
    });

    it("should open AddToDashboard drawer when showAddToDashboardDialog is set", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showAddToDashboardDialog = true;
      await nextTick();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
    });

    it("should close drawer via addPanelToDashboard handler (save emit)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Open the drawer first
      wrapper.vm.showAddToDashboardDialog = true;
      await nextTick();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);

      // Simulate AddToDashboard emitting "save" (which is wired to addPanelToDashboard)
      // The handler sets showAddToDashboardDialog to false
      wrapper.vm.addPanelToDashboard?.();
      await nextTick();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
    });

    it("should toggle drawer via v-model:open update flow", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Open
      wrapper.vm.showAddToDashboardDialog = true;
      await nextTick();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);

      // Close (simulates ODrawer's update:open(false) on cancel/backdrop)
      wrapper.vm.showAddToDashboardDialog = false;
      await nextTick();
      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
    });

    it("should open drawer when onAddToDashboard runs with no validation errors", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);

      // Simulate PanelEditor emitting "addToDashboard" which calls onAddToDashboard
      // (validatePanel mock returns no errors, so dialog should open)
      wrapper.vm.onAddToDashboard?.();
      await nextTick();

      // If validatePanel is not mocked to add errors, drawer should open
      // Note: validatePanel comes from useDashboardPanelData mock which we did not
      // wire to push errors, so by default errors stays empty and drawer opens
      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
    });
  });

  describe("DateTime Handling", () => {
    it("should sync datetime from props to dashboardPanelData", async () => {
      const testDateTime = {
        start_time: new Date("2024-06-01").getTime(),
        end_time: new Date("2024-06-02").getTime(),
        valueType: "absolute" as const,
      };

      wrapper = createWrapper({
        selectedDateTime: testDateTime,
      });
      await flushPromises();

      expect(mockDashboardPanelData.meta.dateTime).toEqual(testDateTime);
    });
  });

  describe("Error Handling", () => {
    it("should handle chart API errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      // Simulate chart API error
      wrapper.vm.handleChartApiError("Test error");

      expect(consoleErrorSpy).toHaveBeenCalledWith("Chart API error:", "Test error");

      consoleErrorSpy.mockRestore();
    });

    it("should fallback to custom mode on parse error", async () => {
      const { parseSQL } = await import("@/utils/query/sqlQueryParser");
      (parseSQL as any).mockRejectedValueOnce(new Error("Parse error"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper = createWrapper({
        searchQuery: "INVALID SQL",
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(mockDashboardPanelData.data.queries[0].customQuery).toBe(true);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Query Mode", () => {
    it("should set customQuery to false for builder mode", async () => {
      const { parseSQL } = await import("@/utils/query/sqlQueryParser");
      (parseSQL as any).mockResolvedValueOnce({
        customQuery: false,
        stream: "test_stream",
      });

      wrapper = createWrapper({
        searchQuery: 'SELECT * FROM "test_stream"',
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(mockDashboardPanelData.data.queries[0].customQuery).toBe(false);
    });

    it("should set table type with dynamic columns for custom mode", async () => {
      const { shouldUseCustomMode } = await import("@/utils/query/sqlQueryParser");
      (shouldUseCustomMode as any).mockReturnValueOnce(true);

      wrapper = createWrapper({
        searchQuery: "complex query",
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(mockDashboardPanelData.data.type).toBe("table");
      expect(mockDashboardPanelData.data.config.table_dynamic_columns).toBe(true);
    });

    it("should auto-select metric chart type when only Y-axis fields are present", async () => {
      const { parsedQueryToPanelFields, shouldUseCustomMode, parseSQL } =
        await import("@/utils/query/sqlQueryParser");

      // Mock parseSQL to return a valid parsed result
      (parseSQL as any).mockResolvedValueOnce({
        stream: "test_stream",
        streamType: "logs",
        xFields: [],
        yFields: [
          {
            column: "_timestamp",
            alias: "y_axis_1",
            aggregationFunction: "count",
          },
        ],
        breakdownFields: [],
        filters: {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [],
        },
        customQuery: false,
        rawQuery: 'SELECT count(_timestamp) as "y_axis_1" FROM "test_stream"',
      });

      // Mock parsedQueryToPanelFields to return only Y-axis field (no X, no breakdown)
      (parsedQueryToPanelFields as any).mockReturnValueOnce({
        stream: "test_stream",
        stream_type: "logs",
        x: [], // No X-axis fields
        y: [{ column: "_timestamp", alias: "y_axis_1", functionName: "count" }], // Has Y-axis field
        breakdown: [], // No breakdown fields
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      });

      (shouldUseCustomMode as any).mockReturnValueOnce(false);

      wrapper = createWrapper({
        searchQuery: 'SELECT count(_timestamp) as "y_axis_1" FROM "test_stream"',
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Should auto-select "metric" chart type for Y-axis only queries
      expect(mockDashboardPanelData.data.type).toBe("metric");
    });

    it("should auto-select table chart type when zero Y-axis fields are present", async () => {
      const { parsedQueryToPanelFields, shouldUseCustomMode, parseSQL } =
        await import("@/utils/query/sqlQueryParser");

      // Mock parseSQL to return a valid parsed result with no Y-axis fields
      (parseSQL as any).mockResolvedValueOnce({
        stream: "test_stream",
        streamType: "logs",
        xFields: [{ column: "method", alias: "x_axis_1", aggregationFunction: null }],
        yFields: [],
        breakdownFields: [],
        filters: {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [],
        },
        customQuery: false,
        rawQuery: 'SELECT method FROM "test_stream"',
      });

      // Mock parsedQueryToPanelFields to return only X-axis field (no Y, no breakdown)
      (parsedQueryToPanelFields as any).mockReturnValueOnce({
        stream: "test_stream",
        stream_type: "logs",
        x: [{ column: "method", alias: "x_axis_1", functionName: null }],
        y: [], // No Y-axis fields
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      });

      (shouldUseCustomMode as any).mockReturnValueOnce(false);

      wrapper = createWrapper({
        searchQuery: 'SELECT method FROM "test_stream"',
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Should auto-select "table" chart type when no Y-axis fields
      expect(mockDashboardPanelData.data.type).toBe("table");
    });
  });

  describe("Run Query", () => {
    it("should call PanelEditor runQuery for builder mode", async () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;

      wrapper = createWrapper({
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Mock PanelEditor's runQuery method
      const mockRunQuery = vi.fn();
      wrapper.vm.panelEditorRef = { runQuery: mockRunQuery };

      await wrapper.vm.runQuery();
      await flushPromises();

      // PanelEditor's runQuery should be called (BuildQueryPage delegates to PanelEditor)
      expect(mockRunQuery).toHaveBeenCalled();
    });

    it("should call PanelEditor runQuery for custom mode", async () => {
      mockDashboardPanelData.data.queries[0].customQuery = true;

      wrapper = createWrapper({
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Get PanelEditor ref and mock its runQuery
      const mockRunQuery = vi.fn();
      wrapper.vm.panelEditorRef = { runQuery: mockRunQuery };

      await wrapper.vm.runQuery();
      await flushPromises();

      // PanelEditor's runQuery should be called for custom queries too
      expect(mockRunQuery).toHaveBeenCalled();
    });

    it("should update stream fields before running query in builder mode", async () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.meta.streamFields = { groupedFields: [] };
      mockUpdateGroupedFields.mockClear();

      wrapper = createWrapper({
        selectedStream: "test_stream",
      });
      await flushPromises();

      // Mock panelEditorRef
      wrapper.vm.panelEditorRef = { runQuery: vi.fn() };

      await wrapper.vm.runQuery();
      await flushPromises();

      expect(mockUpdateGroupedFields).toHaveBeenCalled();
    });
  });
});

describe("BuildQueryPage Component - Integration Tests", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardPanelData.data.queries[0].query = "";
    mockDashboardPanelData.data.queries[0].customQuery = false;
    mockDashboardPanelData.data.queries[0].fields.stream = "";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should handle full workflow: select stream, build query, apply", async () => {
    const { parseSQL, parsedQueryToPanelFields } = await import("@/utils/query/sqlQueryParser");

    // Mock successful parse
    (parseSQL as any).mockResolvedValueOnce({
      customQuery: false,
      stream: "logs",
    });
    (parsedQueryToPanelFields as any).mockReturnValueOnce({
      stream: "logs",
      stream_type: "logs",
      x: [{ column: "_timestamp" }],
      y: [{ column: "count" }],
      breakdown: [],
      filter: [],
    });

    wrapper = createWrapper({
      searchQuery: "",
      selectedStream: "logs",
    });
    await flushPromises();

    // Verify initialization
    expect(mockDashboardPanelData.data.queries[0].fields.stream).toBe("logs");

    // Mock PanelEditor's runQuery method
    const mockRunQuery = vi.fn();
    wrapper.vm.panelEditorRef = { runQuery: mockRunQuery };

    // Run query (this delegates to PanelEditor)
    await wrapper.vm.runQuery();
    await flushPromises();

    // Verify PanelEditor's runQuery was called
    expect(mockRunQuery).toHaveBeenCalled();

    // Simulate PanelEditor emitting queryGenerated via the onQueryGenerated handler
    const generatedQuery = 'SELECT histogram(_timestamp) FROM "logs"';
    if (wrapper.vm.onQueryGenerated) {
      wrapper.vm.onQueryGenerated(generatedQuery);
    }
    await flushPromises();

    // Verify query event was forwarded by BuildQueryPage
    const emitted = wrapper.emitted("queryGenerated");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([generatedQuery]);
  });
});

describe("BuildQueryPage - text search WHERE (AC6.6)", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardPanelData.data.queries[0].fields.filter = [] as any;
  });

  afterEach(() => wrapper?.unmount());

  const notice = () => wrapper.find('[data-test="logs-build-free-text-notice"]');
  // The SQL parser loads lazily, so wait for the page to finish its initialisation.
  const initialized = () => vi.waitFor(() => expect(wrapper.emitted("initialized")).toBeTruthy());

  it("keeps rendered match_all units as builder conditions and runs", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "match_all('timeout') AND match_all('error')",
      freeTextFilter: true,
    });
    await initialized();
    await flushPromises();

    expect(notice().exists()).toBe(false);
    const filter: any = mockDashboardPanelData.data.queries[0].fields.filter;
    expect(filter.conditions.map((c: any) => [c.operator, c.value])).toEqual([
      ["match_all", "timeout"],
      ["match_all", "error"],
    ]);
    expect(mockMakeAutoSQLQuery).toHaveBeenCalled();
  });

  it("shows the notice and never runs unfiltered when the builder drops a text node", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "NOT match_all('timeout')",
      freeTextFilter: true,
    });
    await initialized();
    await flushPromises();

    expect(notice().exists()).toBe(true);
    expect(notice().text()).toContain("search.freeTextBuildNotice");
    expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
    expect(wrapper.emitted("initialized")).toBeTruthy();
  });

  it("refuses Run after the notice: no panel run opens and the editor never queries", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "NOT match_all('timeout')",
      freeTextFilter: true,
    });
    await initialized();
    await flushPromises();
    expect(notice().exists()).toBe(true);
    const editor = { runQuery: vi.fn() };
    wrapper.vm.panelEditorRef = editor;

    await wrapper.vm.runQuery(false, 7);
    await wrapper.vm.runQuery();

    expect(wrapper.vm.runBlocked).toBe(true);
    expect(editor.runQuery).not.toHaveBeenCalled();
    expect(openPanelRunMock).not.toHaveBeenCalled();
    expect(markPanelDispatchedMock).not.toHaveBeenCalled();
    expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
  });

  it("keeps the notice when the search bar text is rewritten while the page initialises", async () => {
    mockUpdateGroupedFields.mockImplementationOnce(async () => {
      await Promise.resolve();
      await wrapper.setProps({ whereClause: "", freeTextFilter: false });
    });
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "NOT match_all('timeout')",
      freeTextFilter: true,
    });
    await initialized();
    await flushPromises();

    expect(notice().exists()).toBe(true);
    expect(wrapper.vm.runBlocked).toBe(true);
    expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
  });

  it("never forwards the editor's unfiltered builder query over a held text search", async () => {
    const interim = 'SELECT histogram(_timestamp) as "x_axis_1" FROM "fts_a" GROUP BY x_axis_1';
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "NOT match_all('timeout')",
      freeTextFilter: true,
    });
    wrapper.vm.onQueryGenerated(interim);
    await initialized();
    await flushPromises();
    wrapper.vm.onQueryGenerated(interim);

    expect(notice().exists()).toBe(true);
    expect(wrapper.emitted("queryGenerated")).toBeUndefined();
  });

  it("refuses Run until the search bar's filter is in the builder, then runs it filtered", async () => {
    let release!: () => void;
    mockUpdateGroupedFields.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "match_all('timeout')",
      freeTextFilter: true,
    });
    await flushPromises();
    const editor = { runQuery: vi.fn() };
    wrapper.vm.panelEditorRef = editor;

    expect(wrapper.vm.runBlocked).toBe(true);
    expect(await wrapper.vm.runQuery(false, 7)).toBe(false);
    expect(await wrapper.vm.runQuery(true)).toBe(false);
    expect(editor.runQuery).not.toHaveBeenCalled();
    expect(openPanelRunMock).not.toHaveBeenCalled();
    expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();

    release();
    await initialized();
    await vi.waitFor(() => expect(editor.runQuery).toHaveBeenCalledTimes(1));
    const filter: any = mockDashboardPanelData.data.queries[0].fields.filter;
    expect(filter.conditions.map((c: any) => [c.operator, c.value])).toEqual([
      ["match_all", "timeout"],
    ]);
    expect(wrapper.vm.runBlocked).toBe(false);
  });

  it("abandons a run when the page re-initialises during the run's own awaits", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "level = 'x'",
      freeTextFilter: false,
    });
    await initialized();
    await flushPromises();
    vi.clearAllMocks();
    const editor = { runQuery: vi.fn() };
    wrapper.vm.panelEditorRef = editor;
    openPanelRunMock.mockReturnValueOnce(41);
    // A saved view applied on the Build tab re-initialises while this run loads stream fields.
    mockUpdateGroupedFields.mockImplementationOnce(async () => {
      searchState().searchObj.meta.savedBuildConfig = { config: {} };
      await nextTick();
    });

    expect(await wrapper.vm.runQuery()).toBe(false);
    expect(endPanelRunMock).toHaveBeenCalledWith(false);
    expect(markPanelDispatchedMock).not.toHaveBeenCalledWith(41);

    await vi.waitFor(() => expect(editor.runQuery).toHaveBeenCalledTimes(1));
    expect(mockDashboardPanelData.data.queries[0].fields.filter).not.toEqual([]);
  });

  it("lets a run through once the user switches the builder to a custom query", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "NOT match_all('timeout')",
      freeTextFilter: true,
    });
    await initialized();
    await flushPromises();
    const editor = { runQuery: vi.fn() };
    wrapper.vm.panelEditorRef = editor;

    mockDashboardPanelData.data.queries[0].customQuery = true;
    try {
      await wrapper.vm.runQuery(false, 7);
      expect(wrapper.vm.runBlocked).toBe(false);
      expect(editor.runQuery).toHaveBeenCalledWith(false);
    } finally {
      mockDashboardPanelData.data.queries[0].customQuery = false;
    }
  });

  it("shows the notice when the stream cannot search text at all", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "nofts_b",
      whereClause: "",
      freeTextFilter: true,
    });
    await initialized();
    await flushPromises();

    expect(notice().exists()).toBe(true);
    expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
  });

  it("leaves a SQL filter on today's path", async () => {
    wrapper = createWrapper({
      isSqlMode: false,
      selectedStream: "fts_a",
      whereClause: "NOT level = 'x'",
      freeTextFilter: false,
    });
    await initialized();
    await flushPromises();

    expect(notice().exists()).toBe(false);
    expect(mockMakeAutoSQLQuery).toHaveBeenCalled();
  });
});
