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
          FilterGroup: true,
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

    it("initializes with default condition group", () => {
      const conditionGroup = wrapper.vm.conditionGroup;
      expect(conditionGroup).toBeDefined();
      expect(conditionGroup.groupId).toBeDefined();
      expect(conditionGroup.label).toBe("and");
      expect(conditionGroup.items).toBeDefined();
      expect(Array.isArray(conditionGroup.items)).toBe(true);
    });

    it.skip("loads fields from input stream node", async () => {
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
    it("updates condition group when conditions are modified", () => {
      const initialGroupId = wrapper.vm.conditionGroup.groupId;
      const updatedGroup = {
        groupId: initialGroupId,
        label: "and",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      wrapper.vm.updateGroup(updatedGroup);
      expect(wrapper.vm.conditionGroup.items).toHaveLength(1);
      expect(wrapper.vm.conditionGroup.items[0].column).toBe("level");
    });

    it("removes condition group by id", () => {
      // Create nested structure
      const parentGroup = wrapper.vm.conditionGroup;
      const childGroupId = "child-group-id";
      parentGroup.items = [
        {
          groupId: childGroupId,
          label: "or",
          items: []
        }
      ];

      wrapper.vm.removeConditionGroup(childGroupId);
      expect(wrapper.vm.conditionGroup.items).toHaveLength(0);
    });
  });

  describe("Form Validation and Submission", () => {
    it("prevents saving when no conditions are present", async () => {
      // Empty group with no items
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: []
      };

      await wrapper.vm.saveCondition();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please add at least one condition"
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("saves condition with valid data", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node_type: "condition",
          condition: {
            and: [
              {
                column: "level",
                operator: "=",
                value: "error",
                ignore_case: false
              }
            ]
          }
        })
      );
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });
  });

  describe("Dialog Handling", () => {
    it("opens cancel dialog when form has changes", async () => {
      // Modify the condition group
      wrapper.vm.conditionGroup.items = [
        {
          column: "level",
          operator: "=",
          value: "error",
          ignore_case: false,
          id: "test-id"
        }
      ];

      await wrapper.vm.openCancelDialog();

      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });

    it("closes form directly when no changes made", async () => {
      // Ensure conditionGroup matches originalConditionGroup
      wrapper.vm.conditionGroup = JSON.parse(JSON.stringify(wrapper.vm.originalConditionGroup));

      await wrapper.vm.openCancelDialog();
      await flushPromises();

      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("opens delete dialog with correct content", async () => {
      await wrapper.vm.openDeleteDialog();

      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
    });
  });

  describe("Edit Mode", () => {
    beforeEach(async () => {
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          condition: {
            and: [
              {
                column: "level",
                operator: "=",
                value: "error",
                ignore_case: false
              }
            ]
          }
        }
      };

      wrapper = mount(Condition, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            FilterGroup: true,
            ConfirmDialog: true,
          }
        }
      });

      await flushPromises();
    });

    it("loads existing condition data in edit mode", () => {
      expect(wrapper.vm.conditionGroup).toBeDefined();
      expect(wrapper.vm.conditionGroup.label).toBe("and");
      expect(wrapper.vm.conditionGroup.items).toHaveLength(1);
      expect(wrapper.vm.conditionGroup.items[0]).toEqual(
        expect.objectContaining({
          column: "level",
          operator: "=",
          value: "error"
        })
      );
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
    it("validates empty value condition", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "message",
            operator: "!=",
            value: '""',
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: expect.objectContaining({
            and: expect.arrayContaining([
              expect.objectContaining({ value: '""' })
            ])
          })
        })
      );
    });

    it("validates null value condition", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "message",
            operator: "!=",
            value: "null",
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: expect.objectContaining({
            and: expect.arrayContaining([
              expect.objectContaining({ value: "null" })
            ])
          })
        })
      );
    });
  });

  describe("Multiple Conditions", () => {
    it("handles multiple conditions correctly", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            column: "message",
            operator: "contains",
            value: "failed",
            ignore_case: false,
            id: "test-id-2"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            and: expect.arrayContaining([
              expect.objectContaining({ column: "level", value: "error" }),
              expect.objectContaining({ column: "message", value: "failed" })
            ])
          }
        })
      );
    });

    it("handles OR conditions with nested groups", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "or",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            column: "level",
            operator: "=",
            value: "critical",
            ignore_case: false,
            id: "test-id-2"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            or: expect.arrayContaining([
              expect.objectContaining({ column: "level", value: "error" }),
              expect.objectContaining({ column: "level", value: "critical" })
            ])
          }
        })
      );
    });
  });

  describe("Edge Cases", () => {
    it("prevents saving condition with empty column", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "",
            operator: "=",
            value: "test",
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please add at least one condition"
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("prevents saving condition with empty operator", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "level",
            operator: "",
            value: "test",
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please add at least one condition"
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("preserves nested group structure", () => {
      const nestedGroup = {
        groupId: "nested-group",
        label: "or",
        items: [
          {
            column: "status",
            operator: "=",
            value: "active",
            ignore_case: false,
            id: "nested-id"
          }
        ]
      };

      wrapper.vm.conditionGroup.items = [nestedGroup];

      expect(wrapper.vm.conditionGroup.items[0].groupId).toBe("nested-group");
      expect(wrapper.vm.conditionGroup.items[0].label).toBe("or");
    });
  });

  describe("Complex Nested Conditions with OR/AND", () => {
    it("handles complex nested AND within OR", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "root-group",
        label: "or",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            groupId: "nested-and-group",
            label: "and",
            items: [
              {
                column: "status",
                operator: "=",
                value: "failed",
                ignore_case: false,
                id: "test-id-2"
              },
              {
                column: "retry_count",
                operator: ">",
                value: "3",
                ignore_case: false,
                id: "test-id-3"
              }
            ]
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            or: [
              expect.objectContaining({ column: "level", value: "error" }),
              {
                and: [
                  expect.objectContaining({ column: "status", value: "failed" }),
                  expect.objectContaining({ column: "retry_count", value: "3" })
                ]
              }
            ]
          }
        })
      );
    });

    it("handles complex nested OR within AND", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "root-group",
        label: "and",
        items: [
          {
            column: "app_name",
            operator: "=",
            value: "myapp",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            groupId: "nested-or-group",
            label: "or",
            items: [
              {
                column: "level",
                operator: "=",
                value: "error",
                ignore_case: false,
                id: "test-id-2"
              },
              {
                column: "level",
                operator: "=",
                value: "critical",
                ignore_case: false,
                id: "test-id-3"
              }
            ]
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            and: [
              expect.objectContaining({ column: "app_name", value: "myapp" }),
              {
                or: [
                  expect.objectContaining({ column: "level", value: "error" }),
                  expect.objectContaining({ column: "level", value: "critical" })
                ]
              }
            ]
          }
        })
      );
    });

    it("handles triple-nested conditions", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "root-group",
        label: "and",
        items: [
          {
            column: "env",
            operator: "=",
            value: "production",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            groupId: "level-1-group",
            label: "or",
            items: [
              {
                column: "severity",
                operator: "=",
                value: "high",
                ignore_case: false,
                id: "test-id-2"
              },
              {
                groupId: "level-2-group",
                label: "and",
                items: [
                  {
                    column: "user_type",
                    operator: "=",
                    value: "premium",
                    ignore_case: false,
                    id: "test-id-3"
                  },
                  {
                    column: "error_count",
                    operator: ">",
                    value: "10",
                    ignore_case: false,
                    id: "test-id-4"
                  }
                ]
              }
            ]
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            and: [
              expect.objectContaining({ column: "env", value: "production" }),
              {
                or: [
                  expect.objectContaining({ column: "severity", value: "high" }),
                  {
                    and: [
                      expect.objectContaining({ column: "user_type", value: "premium" }),
                      expect.objectContaining({ column: "error_count", value: "10" })
                    ]
                  }
                ]
              }
            ]
          }
        })
      );
    });

    it("correctly updates nested groups", () => {
      const rootGroup = {
        groupId: "root-group",
        label: "and",
        items: [
          {
            column: "field1",
            operator: "=",
            value: "value1",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            groupId: "nested-group",
            label: "or",
            items: [
              {
                column: "field2",
                operator: "=",
                value: "value2",
                ignore_case: false,
                id: "test-id-2"
              }
            ]
          }
        ]
      };

      wrapper.vm.conditionGroup = rootGroup;

      // Update nested group
      const updatedNestedGroup = {
        groupId: "nested-group",
        label: "or",
        items: [
          {
            column: "field2",
            operator: "=",
            value: "value2",
            ignore_case: false,
            id: "test-id-2"
          },
          {
            column: "field3",
            operator: "=",
            value: "value3",
            ignore_case: false,
            id: "test-id-3"
          }
        ]
      };

      wrapper.vm.updateGroup(updatedNestedGroup);

      expect(wrapper.vm.conditionGroup.items[1].items).toHaveLength(2);
      expect(wrapper.vm.conditionGroup.items[1].items[1].column).toBe("field3");
    });

    it("handles case sensitivity correctly in OR conditions", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "or",
        items: [
          {
            column: "message",
            operator: "Contains",
            value: "Error",
            ignore_case: true,
            id: "test-id-1"
          },
          {
            column: "message",
            operator: "Contains",
            value: "CRITICAL",
            ignore_case: false,
            id: "test-id-2"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            or: [
              expect.objectContaining({
                column: "message",
                value: "Error",
                ignore_case: true
              }),
              expect.objectContaining({
                column: "message",
                value: "CRITICAL",
                ignore_case: false
              })
            ]
          }
        })
      );
    });
  });

  describe("OR Operator Edge Cases", () => {
    it("handles single condition in OR group", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "or",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id-1"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: {
            or: [
              expect.objectContaining({ column: "level", value: "error" })
            ]
          }
        })
      );
    });

    it("validates OR group with nested empty group", async () => {
      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "or",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id-1"
          },
          {
            groupId: "empty-nested-group",
            label: "and",
            items: []
          }
        ]
      };

      await wrapper.vm.saveCondition();

      // Should still save because there's at least one valid condition
      expect(mockAddNode).toHaveBeenCalled();
    });

    it("removes deeply nested group correctly", () => {
      wrapper.vm.conditionGroup = {
        groupId: "root-group",
        label: "and",
        items: [
          {
            groupId: "level-1-group",
            label: "or",
            items: [
              {
                groupId: "level-2-group",
                label: "and",
                items: [
                  {
                    column: "test",
                    operator: "=",
                    value: "value",
                    ignore_case: false,
                    id: "test-id"
                  }
                ]
              }
            ]
          }
        ]
      };

      wrapper.vm.removeConditionGroup("level-2-group");

      // After removing level-2-group, level-1-group should also be removed (empty)
      expect(wrapper.vm.conditionGroup.items).toHaveLength(0);
    });
  });

  describe("Backward Compatibility", () => {
    it("loads old format conditions correctly", async () => {
      // Simulate old format being converted
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          condition: {
            and: [
              {
                column: "status",
                operator: "=",
                value: "active",
                ignore_case: false
              }
            ]
          }
        }
      };

      wrapper = mount(Condition, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            FilterGroup: true,
            ConfirmDialog: true,
          }
        }
      });

      await flushPromises();

      expect(wrapper.vm.conditionGroup.label).toBe("and");
      expect(wrapper.vm.conditionGroup.items).toHaveLength(1);
      expect(wrapper.vm.conditionGroup.items[0].column).toBe("status");
    });
  });

  describe("Metadata Handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("saves condition with correct node type and condition structure", async () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      wrapper.vm.conditionGroup = {
        groupId: "test-group",
        label: "and",
        items: [
          {
            column: "level",
            operator: "=",
            value: "error",
            ignore_case: false,
            id: "test-id"
          }
        ]
      };

      await wrapper.vm.saveCondition();

      expect(mockAddNode).toHaveBeenCalledWith({
        node_type: "condition",
        condition: {
          and: [
            {
              column: "level",
              operator: "=",
              value: "error",
              ignore_case: false
            }
          ]
        }
      });
    });

    it("preserves existing condition structure in edit mode", async () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      // Set edit mode and provide existing condition
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          condition: {
            or: [
              {
                column: "level",
                operator: "=",
                value: "error",
                ignore_case: false
              },
              {
                column: "level",
                operator: "=",
                value: "critical",
                ignore_case: false
              }
            ]
          }
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
            FilterGroup: true,
            ConfirmDialog: true,
          }
        }
      });

      await flushPromises();

      // Verify the condition group was loaded correctly
      expect(wrapper.vm.conditionGroup.label).toBe("or");
      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
    });
  });
});
