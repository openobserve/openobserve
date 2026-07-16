import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import useDnD from '@/plugins/pipelines/useDnD';
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import Query from "./Query.vue";
import searchService from "@/services/search";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

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

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: {
        sql: "SELECT * FROM logs",
        start_time: 1_000_000_000,
        end_time: 2_000_000_000,
      },
      aggs: {},
    }),
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

  beforeEach(() => {
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

    // Mount component — Query OWNS the real <OForm>; ScheduledPipeline is stubbed.
    wrapper = mount(Query, {
      global: {
        plugins: [i18n, store],
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
      await nextTick();
      expect(wrapper.vm.streamRoute.stream_type).toBe("metrics");
    });

    it("updates query type and clears SQL when switching to promql", async () => {
      wrapper.vm.form.setFieldValue("query_condition.sql", "SELECT * FROM logs");
      await nextTick();
      await wrapper.vm.updateQueryType("promql");
      await nextTick();
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
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      wrapper.vm.form.setFieldValue("query_condition.sql", "SELECT * FROM logs");
      await nextTick();

      // Call validate and wait for next tick
      await wrapper.vm.validateSqlQuery();
      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify the final state
      expect(wrapper.vm.isValidSqlQuery).toBe(false);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      const { toast } = await import("@/lib/feedback/Toast/useToast");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        message: `Invalid SQL Query: ${errorMessage}`
      }));
    });

    it("skips validation for promql query type", async () => {
      wrapper.vm.form.setFieldValue("query_condition.type", "promql");
      await nextTick();
      await wrapper.vm.validateSqlQuery();

      expect(wrapper.vm.isValidSqlQuery).toBe(true);
      expect(wrapper.vm.validatingSqlQuery).toBe(false);
      expect(searchService.search).not.toHaveBeenCalled();
    });
  });

  describe("Dialog Handling", () => {
    it("opens cancel dialog when form has changes", async () => {
      wrapper.vm.form.setFieldValue("name", "modified");
      await nextTick();
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
    // Submission is schema-gated through the OWNED form (the old
    // scheduledPipelineRef.validateInputs() gate is gone).
    it("saves query data with valid inputs", async () => {
      searchService.search.mockResolvedValueOnce({ hits: [] });

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(mockAddNode).toHaveBeenCalled();
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("does not save when schema validation fails (period < 1)", async () => {
      wrapper.vm.form.setFieldValue("trigger_condition.period", 0);
      await nextTick();

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
      expect(wrapper.emitted()["cancel:hideform"]).toBeFalsy();
    });
  });

  describe("Delay Management", () => {
    it("updates delay with integer value", async () => {
      await wrapper.vm.updateDelay("30");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBe(30);
    });

    it("handles string to integer conversion for delay", async () => {
      await wrapper.vm.updateDelay("15.5");
      await nextTick();
      expect(wrapper.vm.streamRoute.delay).toBe(15);
    });
  });
});
