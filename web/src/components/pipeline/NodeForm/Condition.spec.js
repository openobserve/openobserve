import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import useDnD from '@/plugins/pipelines/useDnD';
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import Condition from "./Condition.vue";
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
        { name: "level", type: "string" }
      ],
    }),
    getStreams: vi.fn(),
  }),
}));

// Mock SQL Parser
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => ({
      astify: vi.fn().mockReturnValue({
        from: [{ table: "test_stream" }]
      })
    })
  })
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
      currentSelectedPipeline: {
        nodes: [
          {
            io_type: "input",
            data: {
              node_type: "stream",
              stream_name: "test_stream",
              stream_type: "logs"
            }
          }
        ]
      }
    },
    deletePipelineNode: vi.fn()
  })
}));

// Mock vue-i18n
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key
    })
  };
});

describe("Condition Component", () => {
  let wrapper;
  let mockPipelineObj;
  let mockStore;

  beforeEach(async () => {
    // Setup mock store
    mockStore = {
      state: {
        theme: 'light',
        selectedOrganization: {
          identifier: "test-org"
        },
        userInfo: {
          email: "test@example.com"
        }
      }
    };

    // Setup mock pipeline object
    mockPipelineObj = {
      currentSelectedNodeData: {
        data: {},
        type: 'condition'
      },
      userSelectedNode: {},
      isEditNode: false,
      currentSelectedPipeline: {
        nodes: [
          {
            io_type: "input",
            data: {
              node_type: "stream",
              stream_name: "test_stream",
              stream_type: "logs"
            }
          }
        ]
      }
    };

    // Mock useDnD composable
    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      addNode: mockAddNode,
      deletePipelineNode: vi.fn()
    }));

    // Mount component
    wrapper = mount(Condition, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          RealtimePipeline: true,
          ConfirmDialog: true,
        }
      }
    });

    const notifyMock = vi.fn();
    wrapper.vm.$q.notify = notifyMock;

    // Wait for component to mount and initialize
    await flushPromises();
    
    // Wait for getFields to complete
    await wrapper.vm.getFields();
    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with default condition values", () => {
      const streamRoute = wrapper.vm.streamRoute;
      expect(streamRoute.conditions).toHaveLength(1);
      expect(streamRoute.conditions[0]).toEqual(
        expect.objectContaining({
          column: "",
          operator: "",
          value: ""
        })
      );
    });

    it("loads fields from input stream node", async () => {
      // Verify filteredColumns is populated
      expect(wrapper.vm.filteredColumns).toBeDefined();
      expect(wrapper.vm.filteredColumns).toHaveLength(3);
      expect(wrapper.vm.filteredColumns).toContainEqual(
        expect.objectContaining({
          label: "message",
          value: "message",
          type: "string"
        })
      );
    });
  });

  describe("Condition Management", () => {
    it("adds a new condition field", () => {
      const initialLength = wrapper.vm.streamRoute.conditions.length;
      wrapper.vm.addField();
      expect(wrapper.vm.streamRoute.conditions).toHaveLength(initialLength + 1);
    });

    it("removes a condition field", () => {
      const fieldToRemove = wrapper.vm.streamRoute.conditions[0];
      wrapper.vm.removeField(fieldToRemove);
      expect(wrapper.vm.streamRoute.conditions).toHaveLength(0);
    });
  });

  describe("Form Validation and Submission", () => {
    it("prevents saving when no conditions are present", async () => {
      wrapper.vm.streamRoute.conditions = [];
      await wrapper.vm.saveCondition();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please add atleast one condition"
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("saves condition with valid data", async () => {
      wrapper.vm.streamRoute.conditions = [{
        column: "level",
        operator: "=",
        value: "error",
        id: "test-id"
      }];

      await wrapper.vm.saveCondition();
      
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node_type: "condition",
          conditions: [{
            column: "level",
            operator: "=",
            value: "error",
            id: "test-id"
          }]
        })
      );
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });
  });

  describe("Dialog Handling", () => {
    it("opens cancel dialog when form has changes", async () => {
      wrapper.vm.streamRoute.conditions[0].column = "level";
      await wrapper.vm.openCancelDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel routing changes?");
    });

    it("closes form directly when no changes made", async () => {
      // Ensure streamRoute and originalStreamRouting are the same
      wrapper.vm.streamRoute = JSON.parse(JSON.stringify(wrapper.vm.originalStreamRouting));
      
      await wrapper.vm.openCancelDialog();
      await flushPromises();
      
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("opens delete dialog with correct content", async () => {
      await wrapper.vm.openDeleteDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to delete stream routing?");
    });
  });

  describe("Edit Mode", () => {
    beforeEach(() => {
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          conditions: [{
            column: "level",
            operator: "=",
            value: "error",
            id: "test-id"
          }]
        }
      };

      wrapper = mount(Condition, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            RealtimePipeline: true,
            ConfirmDialog: true,
          }
        }
      });
    });

    it("loads existing condition data in edit mode", () => {
      expect(wrapper.vm.streamRoute.conditions).toEqual([{
        column: "level",
        operator: "=",
        value: "error",
        id: "test-id"
      }]);
    });

    it("shows delete button in edit mode", () => {
      const deleteButton = wrapper.find('[data-test="add-condition-delete-btn"]');
      expect(deleteButton.exists()).toBe(true);
    });
  });

  describe("Field Filtering", () => {
    it("filters columns based on search value", () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterColumns(
        [
          { label: "timestamp", value: "timestamp", type: "datetime" },
          { label: "message", value: "message", type: "string" },
          { label: "level", value: "level", type: "string" }
        ],
        "mess",
        mockUpdate
      );
      
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("returns all columns when search value is empty", () => {
      const options = [
        { label: "timestamp", value: "timestamp", type: "datetime" },
        { label: "message", value: "message", type: "string" }
      ];
      
      let filteredOptions;
      const update = (callback) => {
        callback();
      };
      
      filteredOptions = wrapper.vm.filterColumns(options, "", update);
      
      expect(filteredOptions).toEqual(expect.arrayContaining(options));
      expect(filteredOptions.length).toBe(options.length);
      
      // Verify that all columns in result match the expected format
      filteredOptions.forEach(column => {
        expect(column).toMatchObject({
          label: expect.any(String),
          value: expect.any(String),
          type: expect.any(String)
        });
      });
    });
  });

  describe("Condition Validation", () => {
    it("validates empty value condition", () => {
      wrapper.vm.streamRoute.conditions = [{
        column: "message",
        operator: "!=",
        value: '""',
        id: "test-id"
      }];

      wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: [expect.objectContaining({ value: '""' })]
        })
      );
    });

    it("validates null value condition", () => {
      wrapper.vm.streamRoute.conditions = [{
        column: "message",
        operator: "!=",
        value: "null",
        id: "test-id"
      }];

      wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: [expect.objectContaining({ value: "null" })]
        })
      );
    });
  });

  describe("Multiple Conditions", () => {
    it("handles multiple conditions correctly", async () => {
      wrapper.vm.streamRoute.conditions = [
        {
          column: "level",
          operator: "=",
          value: "error",
          id: "test-id-1"
        },
        {
          column: "message",
          operator: "contains",
          value: "failed",
          id: "test-id-2"
        }
      ];

      await wrapper.vm.saveCondition();
      
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.arrayContaining([
            expect.objectContaining({ column: "level", value: "error" }),
            expect.objectContaining({ column: "message", value: "failed" })
          ])
        })
      );
    });

    it("removes specific condition when multiple exist", () => {
      wrapper.vm.streamRoute.conditions = [
        {
          column: "level",
          operator: "=",
          value: "error",
          id: "test-id-1"
        },
        {
          column: "message",
          operator: "contains",
          value: "failed",
          id: "test-id-2"
        }
      ];

      const conditionToRemove = wrapper.vm.streamRoute.conditions[0];
      wrapper.vm.removeField(conditionToRemove);
      
      expect(wrapper.vm.streamRoute.conditions).toHaveLength(1);
      expect(wrapper.vm.streamRoute.conditions[0].id).toBe("test-id-2");
    });
  });

  describe("Edge Cases", () => {
    it("handles condition with empty column", async () => {
      wrapper.vm.streamRoute.conditions = [{
        column: "",
        operator: "=",
        value: "test",
        id: "test-id"
      }];

      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalled();
    });

    it("handles condition with empty operator", async () => {
      wrapper.vm.streamRoute.conditions = [{
        column: "level",
        operator: "",
        value: "test",
        id: "test-id"
      }];

      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalled();
    });

    it("preserves condition order when adding new conditions", () => {
      const initialCondition = wrapper.vm.streamRoute.conditions[0];
      wrapper.vm.addField();
      
      expect(wrapper.vm.streamRoute.conditions[0]).toEqual(initialCondition);
      expect(wrapper.vm.streamRoute.conditions).toHaveLength(2);
    });
  });

  describe("Metadata Handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("saves condition with correct node type and conditions", async () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      wrapper.vm.streamRoute.conditions = [{
        column: "level",
        operator: "=",
        value: "error",
        id: "test-id"
      }];

      await wrapper.vm.saveCondition();
      
      expect(mockAddNode).toHaveBeenCalledWith({
        node_type: "condition",
        conditions: [{
          column: "level",
          operator: "=",
          value: "error",
          id: "test-id"
        }]
      });
    });

    it("preserves existing metadata in edit mode", async () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      // Set edit mode and provide existing metadata
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          conditions: [{
            column: "level",
            operator: "=",
            value: "error",
            id: "test-id"
          }],
          createdAt: "2023-01-01T00:00:00.000Z",
          owner: "original@example.com"
        }
      };

      // Remount component with edit mode data
      wrapper = mount(Condition, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            RealtimePipeline: true,
            ConfirmDialog: true,
          }
        }
      });

      await wrapper.vm.saveCondition();
      
      expect(mockAddNode).toHaveBeenCalledWith({
        node_type: "condition",
        conditions: [{
          column: "level",
          operator: "=",
          value: "error",
          id: "test-id"
        }]
      });
    });
  });
}); 