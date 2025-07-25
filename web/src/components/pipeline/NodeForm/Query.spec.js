import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import useDnD from '@/plugins/pipelines/useDnD';
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import Query from "./Query.vue";
import searchService from "@/services/search";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the services and composables
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "timestamp", type: "datetime" },
        { name: "message", type: "string" },
      ],
    }),
    getStreams: vi.fn(),
  }),
}));

const mockAddNode = vi.fn();
vi.mock('@/plugins/pipelines/useDnD', () => ({
  default: vi.fn(),
  useDnD: () => ({
    addNode: mockAddNode,
    pipelineObj: {
      isEditNode: false,
      currentSelectedNodeData: null,
      userClickedNode: {},
      userSelectedNode: {},
    },
    deletePipelineNode: vi.fn()
  })
}));

describe("Query Component", () => {
  let wrapper;
  let mockPipelineObj;
  let mockStore;

  beforeEach(() => {
    // Setup mock store
    mockStore = {
      state: {
        theme: 'light',
        selectedOrganization: {
          identifier: "test-org"
        },
        zoConfig: {
          min_auto_refresh_interval: 900,
          sql_base64_enabled: false
        }
      }
    };

    // Setup mock pipeline object
    mockPipelineObj = {
      currentSelectedNodeData: {
        data: {},
        type: 'query'
      },
      userSelectedNode: {},
      isEditNode: false
    };

    // Mock useDnD composable
    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      addNode: mockAddNode,
      deletePipelineNode: vi.fn()
    }));

    // Mount component
    wrapper = mount(Query, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          ScheduledPipeline: true,
          ConfirmDialog: true,
        }
      },
      props: {
        streamName: "test-stream",
        streamType: "logs",
        streamRoutes: {}
      }
    });

    const notifyMock = vi.fn();
    wrapper.vm.$q.notify = notifyMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with default stream route values", () => {
      const streamRoute = wrapper.vm.streamRoute;
      expect(streamRoute.stream_type).toBe("logs");
      expect(streamRoute.query_condition.type).toBe("sql");
      expect(streamRoute.enabled).toBe(true);
      expect(streamRoute.delay).toBe(0);
    });

    it("initializes with correct trigger condition defaults", () => {
      const triggerCondition = wrapper.vm.streamRoute.trigger_condition;
      expect(triggerCondition.period).toBe(15);
      expect(triggerCondition.frequency_type).toBe("minutes");
      expect(triggerCondition.timezone).toBe("UTC");
    });
  });

  describe("Stream Type Management", () => {
    it("updates stream type correctly", async () => {
      await wrapper.vm.updateStreamType("metrics");
      expect(wrapper.vm.streamRoute.stream_type).toBe("metrics");
    });

    it("updates query type and clears SQL when switching to promql", async () => {
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs";
      await wrapper.vm.updateQueryType("promql");
      expect(wrapper.vm.streamRoute.query_condition.type).toBe("promql");
      expect(wrapper.vm.streamRoute.query_condition.sql).toBe("");
    });
  });

  describe("SQL Query Validation", () => {
    it("validates SQL query successfully", async () => {
      searchService.search.mockResolvedValueOnce({ hits: [] });
      
      await wrapper.vm.validateSqlQuery();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
    });

    it("handles SQL query validation failure", async () => {
      const errorMessage = "Invalid SQL syntax";
      
      // Setup the mock rejection
      searchService.search.mockImplementationOnce(() => 
        Promise.reject({
            response: { data: { message: errorMessage } },
            message: errorMessage
          })
      )
      
      // Set initial state
      wrapper.vm.streamRoute.query_condition.type = "sql";
      wrapper.vm.streamRoute.query_condition.sql = "SELECT * FROM logs";
      wrapper.vm.isValidSqlQuery = true;
      wrapper.vm.validatingSqlQuery = true;
      
      // Call validate and wait for next tick
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      await wrapper.vm.$nextTick();
      
      // Verify the final state
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: "negative",
        message: `Invalid SQL Query: ${errorMessage}`
      }));
    });

    it("skips validation for promql query type", async () => {
      wrapper.vm.streamRoute.query_condition.type = "promql";
      await wrapper.vm.validateSqlQuery();
      
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(searchService.search).not.toHaveBeenCalled();
    });
  });

  describe("Dialog Handling", () => {
    it("opens cancel dialog when form has changes", async () => {
      wrapper.vm.streamRoute.name = "modified";
      await wrapper.vm.openCancelDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel routing changes?");
    });

    it("closes form directly when no changes made", async () => {
      await wrapper.vm.openCancelDialog();
      
      expect(wrapper.vm.dialog.show).toBe(false);
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("opens delete dialog with correct content", async () => {
      await wrapper.vm.openDeleteDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to delete stream routing?");
    });
  });

  describe("Form Submission", () => {
    it("saves query data with valid inputs", async () => {
      const scheduledPipelineRef = {
        validateInputs: vi.fn().mockReturnValue(true)
      };
      wrapper.vm.scheduledPipelineRef = scheduledPipelineRef;
      searchService.search.mockResolvedValueOnce({ hits: [] });

      await wrapper.vm.saveQueryData();

      expect(mockAddNode).toHaveBeenCalled();
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("does not save when pipeline validation fails", async () => {
      const scheduledPipelineRef = {
        validateInputs: vi.fn().mockReturnValue(false)
      };
      wrapper.vm.scheduledPipelineRef = scheduledPipelineRef;

      await wrapper.vm.saveQueryData();

      expect(mockAddNode).not.toHaveBeenCalled();
      expect(wrapper.emitted()["cancel:hideform"]).toBeFalsy();
    });
  });

  describe("Delay Management", () => {
    it("updates delay with integer value", async () => {
      await wrapper.vm.updateDelay("30");
      expect(wrapper.vm.streamRoute.delay).toBe(30);
    });

    it("handles string to integer conversion for delay", async () => {
      await wrapper.vm.updateDelay("15.5");
      expect(wrapper.vm.streamRoute.delay).toBe(15);
    });
  });
});
