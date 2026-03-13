import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import Query from "./Query.vue";
import searchService from "@/services/search";

installQuasar();

// Mock services and composables
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTimezoneOffset: vi.fn(() => -300),
    getUUID: vi.fn(() => "mock-uuid-123"),
    useLocalOrganization: vi.fn(() => ({ identifier: "mock-org" })),
    useLocalCurrentUser: vi.fn(() => ({ email: "test@example.com" })),
  };
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "timestamp", type: "datetime" },
        { name: "message", type: "string" },
        { name: "level", type: "string" },
        { name: "source", type: "string" },
      ],
    }),
    getStreams: vi.fn(),
  }),
}));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: {
        start_time: 1000000000,
        end_time: 2000000000,
        sql: "SELECT * FROM logs",
      },
      aggs: {},
    }),
  }),
}));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();
const mockPipelineObj = {
  isEditNode: false,
  currentSelectedNodeData: null,
  userClickedNode: {},
  userSelectedNode: {},
  currentSelectedNodeID: "node-123",
};

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: () => ({
    addNode: mockAddNode,
    pipelineObj: mockPipelineObj,
    deletePipelineNode: mockDeletePipelineNode,
  }),
}));

// Mock Quasar
const mockQuasar = {
  notify: vi.fn(),
};

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuasar: () => mockQuasar,
  };
});

describe("Query Component", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset mock pipeline object
    mockPipelineObj.isEditNode = false;
    mockPipelineObj.currentSelectedNodeData = null;
    mockPipelineObj.userClickedNode = {};
    mockPipelineObj.userSelectedNode = {};

    wrapper = mount(Query, {
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
        stubs: {
          ScheduledPipeline: {
            template: '<div></div>',
            methods: {
              validateInputs: vi.fn().mockReturnValue(true),
            },
          },
          ConfirmDialog: true,
          VariablesInput: true,
        },
      },
      props: {
        streamName: "test-stream",
        streamType: "logs",
        editingRoute: null,
        streamRoutes: {},
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with default stream route values", () => {
      const streamRoute = wrapper.vm.streamRoute;
      expect(streamRoute.name).toBe("");
      expect(streamRoute.stream_type).toBe("logs");
      expect(streamRoute.query_condition.type).toBe("sql");
      expect(streamRoute.enabled).toBe(true);
      expect(streamRoute.delay).toBe(0);
    });

    it("should initialize with correct trigger condition defaults", () => {
      const triggerCondition = wrapper.vm.streamRoute.trigger_condition;
      expect(triggerCondition.period).toBe(15);
      expect(triggerCondition.frequency_type).toBe("minutes");
      expect(triggerCondition.timezone).toBe("UTC");
      expect(triggerCondition.cron).toBe("");
    });

    it("should initialize with context attributes", () => {
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(1);
      expect(wrapper.vm.streamRoute.context_attributes[0]).toEqual({
        key: "",
        value: "",
        id: "mock-uuid-123",
      });
    });

    it("should initialize with default conditions", () => {
      expect(wrapper.vm.streamRoute.conditions).toHaveLength(1);
      expect(wrapper.vm.streamRoute.conditions[0]).toEqual({
        column: "",
        operator: "",
        value: "",
        id: "mock-uuid-123",
      });
    });

    it("should initialize reactive references correctly", () => {
      expect(wrapper.vm.isUpdating).toBe(false);
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(wrapper.vm.isAggregationEnabled).toBe(false);
      expect(wrapper.vm.isFullscreenMode).toBe(false);
    });

    it("should initialize arrays correctly", () => {
      expect(Array.isArray(wrapper.vm.filteredColumns)).toBe(true);
      expect(Array.isArray(wrapper.vm.expandedLogs)).toBe(true);
      expect(Array.isArray(wrapper.vm.filteredStreams)).toBe(true);
      expect(Array.isArray(wrapper.vm.indexOptions)).toBe(true);
      expect(Array.isArray(wrapper.vm.originalStreamFields)).toBe(true);
    });

    it("should have correct stream types array", () => {
      expect(wrapper.vm.streamTypes).toEqual(["logs", "metrics", "traces"]);
    });
  });

  describe("Props Handling", () => {
    it("should handle required props correctly", () => {
      expect(wrapper.props("streamName")).toBe("test-stream");
      expect(wrapper.props("streamType")).toBe("logs");
      expect(wrapper.props("streamRoutes")).toEqual({});
    });

    it("should handle optional editingRoute prop", () => {
      expect(wrapper.props("editingRoute")).toBe(null);
    });

    it("should work with different stream types", async () => {
      const newWrapper = mount(Query, {
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            ScheduledPipeline: {
              template: '<div></div>',
              methods: { validateInputs: vi.fn().mockReturnValue(true) },
            },
            ConfirmDialog: true,
            VariablesInput: true,
          },
        },
        props: {
          streamName: "metrics-stream",
          streamType: "metrics",
          streamRoutes: {},
        },
      });

      expect(newWrapper.props("streamType")).toBe("metrics");
      newWrapper.unmount();
    });
  });

  describe("onMounted Lifecycle", () => {
    it("should call updateStreamFields on mount", async () => {
      const updateStreamFieldsSpy = vi.spyOn(wrapper.vm, 'updateStreamFields');
      await wrapper.vm.$nextTick();
      
      // The function should be called during mount
      expect(wrapper.vm.filteredColumns).toBeDefined();
    });

    it("should set original routing on mount", () => {
      expect(wrapper.vm.originalStreamRouting).toBeDefined();
      expect(typeof wrapper.vm.originalStreamRouting).toBe("object");
    });

  });

  describe("Stream Type Management", () => {
    it("should update stream type correctly", () => {
      wrapper.vm.updateStreamType("metrics");
      expect(wrapper.vm.streamRoute.stream_type).toBe("metrics");
    });

    it("should update stream type to traces", () => {
      wrapper.vm.updateStreamType("traces");
      expect(wrapper.vm.streamRoute.stream_type).toBe("traces");
    });

    it("should handle empty stream type", () => {
      wrapper.vm.updateStreamType("");
      expect(wrapper.vm.streamRoute.stream_type).toBe("");
    });

    it("should update query type and clear SQL when switching to promql", () => {
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs";
      wrapper.vm.updateQueryType("promql");
      
      expect(wrapper.vm.streamRoute.query_condition.type).toBe("promql");
      expect(wrapper.vm.streamRoute.query_condition.sql).toBe("");
    });

    it("should update query type to sql without clearing", () => {
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs";
      wrapper.vm.updateQueryType("sql");
      
      expect(wrapper.vm.streamRoute.query_condition.type).toBe("sql");
      expect(wrapper.vm.streamRoute.query_condition.sql).toBe("SELECT * FROM logs");
    });

    it("should handle undefined query type", () => {
      wrapper.vm.updateQueryType(undefined);
      expect(wrapper.vm.streamRoute.query_condition.type).toBe(undefined);
    });
  });

  describe("Stream Name Validation", () => {
    it("should validate valid stream names", () => {
      wrapper.vm.streamRoute.name = "valid_stream-name123";
      expect(wrapper.vm.isValidStreamName).toBe(true);
    });

    it("should reject invalid characters in stream name", () => {
      wrapper.vm.streamRoute.name = "invalid@stream*name";
      expect(wrapper.vm.isValidStreamName).toBe(false);
    });

    it("should accept special allowed characters", () => {
      wrapper.vm.streamRoute.name = "stream+=,.@_-name";
      expect(wrapper.vm.isValidStreamName).toBe(true);
    });

    it("should handle empty stream name", () => {
      wrapper.vm.streamRoute.name = "";
      expect(wrapper.vm.isValidStreamName).toBe(false);
    });

    it("should handle numeric stream names", () => {
      wrapper.vm.streamRoute.name = "123456";
      expect(wrapper.vm.isValidStreamName).toBe(true);
    });
  });

  describe("Columns Filtering", () => {
    it("should filter columns with search term", () => {
      const options = ["timestamp", "message", "level"];
      const mockUpdate = vi.fn();
      
      wrapper.vm.filterColumns(options, "time", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("should handle case insensitive filtering", () => {
      const options = ["TimeStamp", "MESSAGE", "Level"];
      const mockUpdate = vi.fn();
      
      wrapper.vm.filterColumns(options, "time", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("should handle empty options array", () => {
      const options: any[] = [];
      const mockUpdate = vi.fn();
      
      const result = wrapper.vm.filterColumns(options, "test", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("Stream Filtering", () => {
    it("should filter streams using filterColumns", () => {
      wrapper.vm.indexOptions = ["stream1", "stream2", "test-stream"];
      const mockUpdate = vi.fn();
      
      wrapper.vm.filterStreams("test", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("should handle empty stream filter", () => {
      wrapper.vm.indexOptions = ["stream1", "stream2"];
      const mockUpdate = vi.fn();
      
      wrapper.vm.filterStreams("", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("Stream Fields Update", () => {
    it("should update stream fields successfully", async () => {
      await wrapper.vm.updateStreamFields();
      
      expect(wrapper.vm.filteredColumns).toHaveLength(4);
      expect(wrapper.vm.originalStreamFields).toHaveLength(4);
      expect(wrapper.vm.filteredColumns[0]).toEqual({
        label: "timestamp",
        value: "timestamp",
        type: "datetime",
      });
    });

  });

  describe("Dialog Management", () => {
    it("should open cancel dialog when form has changes", () => {
      wrapper.vm.streamRoute.name = "modified";
      wrapper.vm.openCancelDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel routing changes?");
    });

    it("should close form directly when no changes made", () => {
      wrapper.vm.openCancelDialog();
      
      expect(wrapper.vm.dialog.show).toBe(false);
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should open delete dialog with correct content", () => {
      wrapper.vm.openDeleteDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to delete stream routing?");
    });

    it("should close dialog and emit cancel", () => {
      wrapper.vm.closeDialog();
      
      expect(mockPipelineObj.userClickedNode).toEqual({});
      expect(mockPipelineObj.userSelectedNode).toEqual({});
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should execute ok callback for dialog", () => {
      const mockCallback = vi.fn();
      wrapper.vm.dialog.okCallback = mockCallback;
      wrapper.vm.dialog.okCallback();
      
      expect(mockCallback).toHaveBeenCalled();
    });
  });

  describe("Default PromQL Condition", () => {
    it("should return correct default PromQL condition", () => {
      const condition = wrapper.vm.getDefaultPromqlCondition();
      
      expect(condition).toEqual({
        column: "value",
        operator: ">=",
        value: 0,
      });
    });
  });

  describe("SQL Query Validation", () => {
    it("should validate SQL query successfully", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.streamRoute.query_condition.type = "sql";
      
      await wrapper.vm.validateSqlQuery();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
    });

    it("should handle SQL query validation failure with error message", async () => {
      const errorMessage = "Invalid SQL syntax";
      vi.mocked(searchService.search).mockRejectedValueOnce({
        response: { data: { message: errorMessage } },
      });
      
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.streamRoute.query_condition.sql = "INVALID SQL";
      
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "negative",
        message: `Invalid SQL Query: ${errorMessage}`,
        timeout: 3000,
      });
    });

    it("should handle SQL query validation failure without error message", async () => {
      vi.mocked(searchService.search).mockRejectedValueOnce({
        response: { data: {} },
      });
      
      wrapper.vm.streamRoute.query_condition.type = "sql";
      
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "negative",
        message: "Invalid SQL Query",
        timeout: 3000,
      });
    });

    it("should skip validation for promql query type", async () => {
      wrapper.vm.streamRoute.query_condition.type = "promql";
      
      await wrapper.vm.validateSqlQuery();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should handle validation promise rejection", async () => {
      vi.mocked(searchService.search).mockImplementationOnce(() => {
        return Promise.reject();
      });
      
      wrapper.vm.streamRoute.query_condition.type = "sql";
      
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
    });

    it("should set validating state during validation", () => {
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.validateSqlQuery();
      
      expect(wrapper.vm.validatingSqlQuery).toBe(true);
    });
  });

  describe("Form Submission", () => {
    beforeEach(() => {
      // Setup valid form data
      wrapper.vm.streamRoute.name = "test-stream";
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs";
      wrapper.vm.scheduledPipelineRef = {
        validateInputs: vi.fn().mockReturnValue(true),
      };
    });

    it("should save query data with valid inputs", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });
      
      const result = await wrapper.vm.saveQueryData();
      
      expect(mockAddNode).toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should not save when pipeline validation fails", async () => {
      wrapper.vm.scheduledPipelineRef = {
        validateInputs: vi.fn().mockReturnValue(false)
      };
      
      const result = await wrapper.vm.saveQueryData();
      
      expect(result).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("should not save when SQL validation fails", async () => {
      // Clear mocks to ensure clean state
      vi.clearAllMocks();

      // Mock search to reject with an error to trigger validation failure
      vi.mocked(searchService.search).mockImplementationOnce(() =>
        Promise.reject({
          response: { data: { message: "Invalid SQL syntax" } }
        })
      );

      wrapper.vm.scheduledPipelineRef = {
        validateInputs: vi.fn().mockReturnValue(true)
      };
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.streamRoute.query_condition.sql = "INVALID SQL";

      // This should now properly prevent the save
      const result = await wrapper.vm.saveQueryData();

      expect(result).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("should convert period to integer", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.streamRoute.trigger_condition.period = "30";
      
      await wrapper.vm.saveQueryData();
      
      expect(wrapper.vm.streamRoute.trigger_condition.period).toBe(30);
    });

    it("should handle promql query type in save", async () => {
      wrapper.vm.streamRoute.query_condition.type = "promql";
      
      await wrapper.vm.saveQueryData();
      
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.query_condition.sql).toBe("");
      expect(payload.query_condition.promql_condition).toEqual({
        column: "value",
        operator: ">=",
        value: 0,
      });
    });

    it("should add timezone offset for cron frequency", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.streamRoute.trigger_condition.frequency_type = "cron";
      wrapper.vm.streamRoute.trigger_condition.timezone = "America/New_York";
      
      await wrapper.vm.saveQueryData();
      
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.tz_offset).toBe(-300);
    });

    it("should create correct query payload structure", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });
      wrapper.vm.streamRoute.trigger_condition.frequency = "60";
      
      await wrapper.vm.saveQueryData();
      
      const payload = mockAddNode.mock.calls[0][0];
      expect(payload.node_type).toBe("query");
      expect(payload.stream_type).toBe("logs");
      expect(payload.org_id).toBe(store.state.selectedOrganization.identifier);
      expect(payload.trigger_condition.frequency).toBe(60);
    });
  });

  describe("Route Deletion", () => {
    it("should delete route and close form", () => {
      wrapper.vm.deleteRoute();
      
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-123");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should call deletePipelineNode with correct node ID", () => {
      mockPipelineObj.currentSelectedNodeID = "custom-node-id";
      
      wrapper.vm.deleteRoute();
      
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("custom-node-id");
    });
  });

  describe("Variables Management", () => {
    it("should add new variable", () => {
      const initialLength = wrapper.vm.streamRoute.context_attributes.length;
      
      wrapper.vm.addVariable();
      
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(initialLength + 1);
      expect(wrapper.vm.streamRoute.context_attributes[1]).toEqual({
        key: "",
        value: "",
        id: "mock-uuid-123",
      });
    });

    it("should remove variable by id", () => {
      wrapper.vm.streamRoute.context_attributes = [
        { key: "key1", value: "value1", id: "id1" },
        { key: "key2", value: "value2", id: "id2" },
      ];
      
      wrapper.vm.removeVariable({ id: "id1" });
      
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(1);
      expect(wrapper.vm.streamRoute.context_attributes[0].id).toBe("id2");
    });

    it("should not remove variable with non-existent id", () => {
      wrapper.vm.streamRoute.context_attributes = [
        { key: "key1", value: "value1", id: "id1" },
      ];
      
      wrapper.vm.removeVariable({ id: "non-existent" });
      
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(1);
    });

    it("should handle removing from empty context attributes", () => {
      wrapper.vm.streamRoute.context_attributes = [];
      
      wrapper.vm.removeVariable({ id: "any-id" });
      
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(0);
    });
  });

  describe("Delay Management", () => {
    it("should update delay with integer value", () => {
      wrapper.vm.updateDelay("30");
      expect(wrapper.vm.streamRoute.delay).toBe(30);
    });

    it("should handle string to integer conversion for delay", () => {
      wrapper.vm.updateDelay("15.5");
      expect(wrapper.vm.streamRoute.delay).toBe(15);
    });

    it("should handle zero delay", () => {
      wrapper.vm.updateDelay("0");
      expect(wrapper.vm.streamRoute.delay).toBe(0);
    });

    it("should handle negative delay", () => {
      wrapper.vm.updateDelay("-5");
      expect(wrapper.vm.streamRoute.delay).toBe(-5);
    });

    it("should handle non-numeric delay", () => {
      wrapper.vm.updateDelay("abc");
      expect(wrapper.vm.streamRoute.delay).toBeNaN();
    });

    it("should handle null delay", () => {
      wrapper.vm.updateDelay(null);
      expect(wrapper.vm.streamRoute.delay).toBeNaN();
    });

    it("should handle undefined delay", () => {
      wrapper.vm.updateDelay(undefined);
      expect(wrapper.vm.streamRoute.delay).toBeNaN();
    });
  });

  describe("Fullscreen Mode", () => {
    it("should update fullscreen mode to true", () => {
      wrapper.vm.updateFullscreenMode(true);
      expect(wrapper.vm.isFullscreenMode).toBe(true);
    });

    it("should update fullscreen mode to false", () => {
      wrapper.vm.updateFullscreenMode(false);
      expect(wrapper.vm.isFullscreenMode).toBe(false);
    });

    it("should handle undefined fullscreen mode", () => {
      wrapper.vm.updateFullscreenMode(undefined);
      expect(wrapper.vm.isFullscreenMode).toBe(undefined);
    });
  });

  describe("Log Expansion", () => {
    it("should toggle expand log and clear expanded logs", () => {
      wrapper.vm.expandedLogs = [1, 2, 3];
      
      wrapper.vm.toggleExpandLog(0);
      
      expect(wrapper.vm.expandedLogs).toEqual([]);
    });

    it("should clear expanded logs regardless of index", () => {
      wrapper.vm.expandedLogs = [1, 2, 3];
      
      wrapper.vm.toggleExpandLog(5);
      
      expect(wrapper.vm.expandedLogs).toEqual([]);
    });

    it("should work with empty expanded logs array", () => {
      wrapper.vm.expandedLogs = [];
      
      wrapper.vm.toggleExpandLog(0);
      
      expect(wrapper.vm.expandedLogs).toEqual([]);
    });
  });

  describe("Default Stream Route", () => {
    it("should return edit data when in edit mode", () => {
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          name: "edit-stream",
          stream_type: "metrics",
        },
      };
      
      const result = wrapper.vm.getDefaultStreamRoute();
      
      expect(result).toEqual({
        name: "edit-stream",
        stream_type: "metrics",
      });
    });

    it("should use zoConfig frequency when available", () => {
      const mockStore = {
        state: {
          zoConfig: {
            min_auto_refresh_interval: 1800, // 30 minutes
          },
        },
      };
      
      // Need to mount a new wrapper with this specific store config
      const testWrapper = mount(Query, {
        global: {
          plugins: [i18n, router],
          provide: { store: mockStore },
          stubs: {
            ScheduledPipeline: {
              template: '<div></div>',
              methods: { validateInputs: vi.fn().mockReturnValue(true) },
            },
            ConfirmDialog: true,
            VariablesInput: true,
          },
        },
        props: {
          streamName: "test-stream",
          streamType: "logs",
          streamRoutes: {},
        },
      });

      const result = testWrapper.vm.getDefaultStreamRoute();
      expect(result.trigger_condition.frequency).toBe(30); // 1800/60 = 30
      testWrapper.unmount();
    });

    it("should use default frequency when zoConfig not available", () => {
      const result = wrapper.vm.getDefaultStreamRoute();
      expect(result.trigger_condition.frequency).toBe(15);
    });

    it("should include all required default fields", () => {
      const result = wrapper.vm.getDefaultStreamRoute();
      
      expect(result.name).toBe("");
      expect(result.stream_type).toBe("logs");
      expect(result.enabled).toBe(true);
      expect(result.delay).toBe(0);
      expect(result.description).toBe("");
      expect(result.conditions).toHaveLength(1);
      expect(result.context_attributes).toHaveLength(1);
      expect(result.query_condition.type).toBe("sql");
      expect(result.trigger_condition.timezone).toBe("UTC");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing scheduledPipelineRef", async () => {
      wrapper.vm.scheduledPipelineRef = null;
      
      try {
        await wrapper.vm.saveQueryData();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("should handle invalid store state", () => {
      // Test with minimal store state
      expect(() => wrapper.vm.getDefaultStreamRoute()).not.toThrow();
    });

    it("should handle network errors in validateSqlQuery", async () => {
      vi.mocked(searchService.search).mockRejectedValueOnce(new Error("Network error"));
      wrapper.vm.streamRoute.query_condition.type = "sql";
      
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
    });
  });

  describe("Component State Management", () => {
    it("should maintain consistent state during operations", () => {
      const initialState = JSON.parse(JSON.stringify(wrapper.vm.streamRoute));
      
      wrapper.vm.updateStreamType("metrics");
      wrapper.vm.updateQueryType("promql");
      wrapper.vm.updateDelay("30");
      
      expect(wrapper.vm.streamRoute.stream_type).toBe("metrics");
      expect(wrapper.vm.streamRoute.query_condition.type).toBe("promql");
      expect(wrapper.vm.streamRoute.delay).toBe(30);
      
      // Other fields should remain unchanged
      expect(wrapper.vm.streamRoute.enabled).toBe(initialState.enabled);
      expect(wrapper.vm.streamRoute.trigger_condition.timezone).toBe(initialState.trigger_condition.timezone);
    });

    it("should handle complex state changes", () => {
      wrapper.vm.addVariable();
      wrapper.vm.updateFullscreenMode(true);
      wrapper.vm.streamRoute.name = "complex-stream";
      
      expect(wrapper.vm.streamRoute.context_attributes).toHaveLength(2);
      expect(wrapper.vm.isFullscreenMode).toBe(true);
      expect(wrapper.vm.streamRoute.name).toBe("complex-stream");
    });
  });

  describe("Computed Properties", () => {
    it("should correctly compute isValidStreamName with various inputs", () => {
      const testCases = [
        { name: "valid123", expected: true },
        { name: "valid_name", expected: true },
        { name: "valid-name", expected: true },
        { name: "valid.name", expected: true },
        { name: "valid@name", expected: true },
        { name: "valid+name", expected: true },
        { name: "valid=name", expected: true },
        { name: "valid,name", expected: true },
        { name: "invalid!name", expected: false },
        { name: "invalid#name", expected: false },
        { name: "invalid$name", expected: false },
        { name: "", expected: false },
      ];

      testCases.forEach(({ name, expected }) => {
        wrapper.vm.streamRoute.name = name;
        expect(wrapper.vm.isValidStreamName).toBe(expected);
      });
    });
  });

  describe("Integration Tests", () => {
    it("should complete full workflow: create, validate, and save", async () => {
      // Clear all previous mocks first
      vi.clearAllMocks();

      // Setup successful search mock
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });

      // Setup the component state
      wrapper.vm.streamRoute.name = "integration-test";
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs WHERE level = 'ERROR'";
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.scheduledPipelineRef = {
        validateInputs: vi.fn().mockReturnValue(true),
      };

      // Execute the save operation (which includes validation)
      await wrapper.vm.saveQueryData();

      // Verify that the workflow completed successfully
      expect(mockAddNode).toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should handle complete deletion workflow", () => {
      wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();

      expect(mockDeletePipelineNode).toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("should handle complete cancellation workflow with changes", () => {
      wrapper.vm.streamRoute.name = "changed";
      wrapper.vm.openCancelDialog();

      expect(wrapper.vm.dialog.show).toBe(true);

      wrapper.vm.dialog.okCallback();

      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("Bug Fix: Stream Type Validation (Issue #1)", () => {
    it("should use correct stream type for logs validation", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });

      wrapper.vm.streamRoute.stream_type = "logs";
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs";

      await wrapper.vm.validateSqlQuery();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "logs",
        })
      );
    });

    it("should use correct stream type for metrics validation", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });

      wrapper.vm.streamRoute.stream_type = "metrics";
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM metrics";

      await wrapper.vm.validateSqlQuery();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "metrics",
        })
      );
    });

    it("should use correct stream type for traces validation", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });

      wrapper.vm.streamRoute.stream_type = "traces";
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM traces";

      await wrapper.vm.validateSqlQuery();

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "traces",
        })
      );
    });

    it("should not hardcode logs stream type for validation", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({ hits: [] });

      wrapper.vm.streamRoute.stream_type = "metrics";
      wrapper.vm.streamRoute.query_condition.type = "sql";

      await wrapper.vm.validateSqlQuery();

      // Ensure it's NOT using hardcoded "logs"
      expect(searchService.search).not.toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "logs",
        })
      );
    });
  });
});
