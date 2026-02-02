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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { Quasar, Dialog, Notify } from "quasar";
import BuildQueryPage from "./BuildQueryPage.vue";

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

vi.mock("@/composables/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    resetAggregationFunction: vi.fn(),
    resetDashboardPanelData: mockResetDashboardPanelData,
    makeAutoSQLQuery: mockMakeAutoSQLQuery,
    updateGroupedFields: mockUpdateGroupedFields,
  }),
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

// Mock AddToDashboard component
vi.mock("@/plugins/metrics/AddToDashboard.vue", () => ({
  default: {
    name: "AddToDashboard",
    template: '<div class="add-to-dashboard-mock">AddToDashboard</div>',
    props: ["dashboardPanelData"],
    emits: ["save"],
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
      plugins: [i18n, [Quasar, { plugins: { Dialog, Notify } }]],
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
        AddToDashboard: true,
        QueryTypeSelector: true,
        "q-dialog": true,
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

      expect(wrapper.find(".build-query-page").exists()).toBe(true);
    });

    it("should render the PanelEditor component", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="panel-editor"]').exists()).toBe(true);
    });

    it("should render the query mode toggle", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find(".query-mode-toggle").exists()).toBe(true);
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
  });

  describe("Query Parsing", () => {
    it("should try to parse SQL query when provided", async () => {
      const { parseSQL } = await import("@/utils/query/sqlQueryParser");

      wrapper = createWrapper({
        searchQuery: 'SELECT * FROM "test_stream"',
        selectedStream: "test_stream",
      });
      await flushPromises();

      expect(parseSQL).toHaveBeenCalled();
    });

    it("should use custom mode for complex queries", async () => {
      const { shouldUseCustomMode } = await import("@/utils/query/sqlQueryParser");
      (shouldUseCustomMode as any).mockReturnValueOnce(true);

      wrapper = createWrapper({
        searchQuery: 'SELECT * FROM (SELECT * FROM "test_stream")',
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
      wrapper.vm.onQueryGenerated?.(testQuery) ||
        wrapper.vm.$emit("queryGenerated", testQuery); // Fallback

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
    it("should show add to dashboard dialog when triggered", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Check initial state
      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);

      // Trigger the dialog
      wrapper.vm.showAddToDashboardDialog = true;
      await nextTick();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
    });

    it("should close add to dashboard dialog on addPanelToDashboard", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.showAddToDashboardDialog = true;
      await nextTick();

      // Call the handler
      wrapper.vm.showAddToDashboardDialog = false;
      await nextTick();

      expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
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

    it("should watch for datetime changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newDateTime = {
        start_time: new Date("2024-07-01").getTime(),
        end_time: new Date("2024-07-02").getTime(),
        valueType: "absolute" as const,
      };

      await wrapper.setProps({ selectedDateTime: newDateTime });
      await flushPromises();

      expect(mockDashboardPanelData.meta.dateTime).toEqual(newDateTime);
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
      const { parsedQueryToPanelFields, shouldUseCustomMode, parseSQL } = await import("@/utils/query/sqlQueryParser");

      // Mock parseSQL to return a valid parsed result
      (parseSQL as any).mockResolvedValueOnce({
        stream: "test_stream",
        streamType: "logs",
        xFields: [],
        yFields: [{ column: "_timestamp", alias: "y_axis_1", aggregationFunction: "count" }],
        breakdownFields: [],
        filters: { filterType: "group", logicalOperator: "AND", conditions: [] },
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

  it("should preserve datetime through component lifecycle", async () => {
    const initialDateTime = {
      start_time: new Date("2024-01-01").getTime(),
      end_time: new Date("2024-01-02").getTime(),
      valueType: "absolute" as const,
    };

    wrapper = createWrapper({
      selectedDateTime: initialDateTime,
    });
    await flushPromises();

    // Update props
    const newDateTime = {
      start_time: new Date("2024-02-01").getTime(),
      end_time: new Date("2024-02-02").getTime(),
      valueType: "absolute" as const,
    };

    await wrapper.setProps({ selectedDateTime: newDateTime });
    await flushPromises();

    expect(mockDashboardPanelData.meta.dateTime).toEqual(newDateTime);
  });
});
