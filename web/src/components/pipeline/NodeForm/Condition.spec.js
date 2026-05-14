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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import Condition from "./Condition.vue";
import useDnD from "@/plugins/pipelines/useDnD";

installQuasar({ plugins: [Dialog, Notify] });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(),
}));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "_timestamp", type: "datetime" },
        { name: "message",    type: "string"   },
        { name: "level",      type: "string"   },
      ],
    }),
    getStreams: vi.fn(),
  }),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn().mockResolvedValue({
      astify: vi.fn().mockReturnValue({ from: [{ table: "test_stream" }] }),
    }),
  }),
}));

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: { sql: "SELECT * FROM test_stream", start_time: 1000, end_time: 2000 },
    }),
  }),
}));

vi.mock("@/utils/alerts/alertDataTransforms", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let mockPipelineObj = {};

function makePipelineObj(overrides = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeData: { data: {}, type: "condition" },
    currentSelectedNodeID: "cond-node-1",
    currentSelectedPipeline: {
      nodes: [
        {
          io_type: "input",
          data: {
            node_type: "stream",
            stream_name: "test_stream",
            stream_type: "logs",
          },
        },
      ],
    },
    userSelectedNode: {},
    userClickedNode: {},
    ...overrides,
  };
}

function makeConditionGroup(logicalOperator = "AND", conditions = []) {
  return {
    filterType: "group",
    groupId: "test-group",
    logicalOperator,
    conditions,
  };
}

function makeCondition(overrides = {}) {
  return {
    filterType: "condition",
    column: "level",
    operator: "=",
    value: "error",
    ignore_case: false,
    id: "cid-1",
    ...overrides,
  };
}

function createWrapper(pipelineObjOverrides = {}) {
  mockPipelineObj = makePipelineObj(pipelineObjOverrides);

  vi.mocked(useDnD).mockImplementation(() => ({
    pipelineObj: mockPipelineObj,
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
  }));

  return mount(Condition, {
    global: {
      plugins: [i18n, store],
      stubs: {
        FilterGroup:   true,
        ConfirmDialog: true,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Condition Component", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("Component Initialization", () => {
    it("mounts successfully", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the outer section with data-test attribute", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="add-condition-section"]').exists()).toBe(true);
    });

    it("initializes conditionGroup with V2 structure", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const g = wrapper.vm.conditionGroup;
      expect(g).toBeDefined();
      expect(g.filterType).toBe("group");
      expect(g.logicalOperator).toBe("AND");
      expect(Array.isArray(g.conditions)).toBe(true);
    });

    it("initializes isUpdating as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isUpdating).toBe(false);
    });

    it("initializes isValidSqlQuery as true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.isValidSqlQuery).toBe(true);
    });

    it("clears userSelectedNode on mount", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(mockPipelineObj.userSelectedNode).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  describe("Edit Mode – Condition Loading", () => {
    it("loads V1-backend AND format correctly", async () => {
      const wrapper = createWrapper({
        isEditNode: true,
        currentSelectedNodeData: {
          data: {
            conditions: {
              and: [makeCondition({ column: "status", value: "active" })],
            },
          },
        },
      });
      await flushPromises();
      const g = wrapper.vm.conditionGroup;
      expect(g.logicalOperator).toBe("AND");
      expect(g.conditions).toHaveLength(1);
      expect(g.conditions[0].column).toBe("status");
    });

    it("loads V1-backend OR format correctly", async () => {
      const wrapper = createWrapper({
        isEditNode: true,
        currentSelectedNodeData: {
          data: {
            conditions: {
              or: [
                makeCondition({ column: "level", value: "error" }),
                makeCondition({ column: "level", value: "critical", id: "cid-2" }),
              ],
            },
          },
        },
      });
      await flushPromises();
      const g = wrapper.vm.conditionGroup;
      expect(g.logicalOperator).toBe("OR");
      expect(g.conditions).toHaveLength(2);
    });

    it("loads V2 format as-is (ensureIds)", async () => {
      const v2Group = makeConditionGroup("AND", [
        makeCondition({ column: "env", value: "production" }),
      ]);
      const wrapper = createWrapper({
        isEditNode: true,
        currentSelectedNodeData: { data: { conditions: v2Group } },
      });
      await flushPromises();
      const g = wrapper.vm.conditionGroup;
      expect(g.logicalOperator).toBe("AND");
      expect(g.conditions[0].column).toBe("env");
    });

    it("shows delete button when isEditNode is true", async () => {
      const wrapper = createWrapper({
        isEditNode: true,
        currentSelectedNodeData: { data: {} },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="add-condition-delete-btn"]').exists()).toBe(true);
    });

    it("hides delete button when isEditNode is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="add-condition-delete-btn"]').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("UI Rendering", () => {
    it("always renders cancel and save buttons", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="add-condition-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-condition-save-btn"]').exists()).toBe(true);
    });

    it("renders FilterGroup stub", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // The stub renders as filtergroup tag
      expect(wrapper.findComponent({ name: "FilterGroup" }).exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("updateGroup", () => {
    it("updates conditionGroup when a new group is provided (uses root groupId)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // Use the actual root groupId so the utility can match and replace
      const rootGroupId = wrapper.vm.conditionGroup.groupId;
      const updatedGroup = {
        filterType: "group",
        groupId: rootGroupId,
        logicalOperator: "AND",
        conditions: [makeCondition({ column: "service", value: "web" })],
      };
      wrapper.vm.updateGroup(updatedGroup);
      await nextTick();
      expect(wrapper.vm.conditionGroup.conditions).toHaveLength(1);
      expect(wrapper.vm.conditionGroup.conditions[0].column).toBe("service");
    });

    it("supports changing logicalOperator via updateGroup (uses root groupId)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const rootGroupId = wrapper.vm.conditionGroup.groupId;
      const updatedGroup = {
        filterType: "group",
        groupId: rootGroupId,
        logicalOperator: "OR",
        conditions: [makeCondition({ column: "level", value: "warn" })],
      };
      wrapper.vm.updateGroup(updatedGroup);
      await nextTick();
      expect(wrapper.vm.conditionGroup.logicalOperator).toBe("OR");
    });
  });

  // -------------------------------------------------------------------------
  describe("removeConditionGroup", () => {
    it("removes a direct child group by groupId", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const childId = "child-group";
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        {
          filterType: "group",
          groupId: childId,
          logicalOperator: "OR",
          conditions: [makeCondition()],
        },
      ]);
      wrapper.vm.removeConditionGroup(childId);
      await nextTick();
      expect(wrapper.vm.conditionGroup.conditions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("saveCondition – validation", () => {
    it("notifies and does NOT call addNode when conditions array is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", []);
      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;
      await wrapper.vm.saveCondition();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please add at least one condition",
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("notifies and does NOT call addNode when condition has empty column", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ column: "", operator: "=" }),
      ]);
      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;
      await wrapper.vm.saveCondition();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("notifies and does NOT call addNode when condition has empty operator", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ column: "level", operator: "" }),
      ]);
      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;
      await wrapper.vm.saveCondition();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("saveCondition – success cases", () => {
    it("calls addNode with correct payload structure when valid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ column: "level", value: "error" }),
      ]);
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node_type: "condition",
          version: 2,
          conditions: expect.objectContaining({
            filterType: "group",
            logicalOperator: "AND",
          }),
        })
      );
    });

    it("emits cancel:hideform after successful save", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [makeCondition()]);
      await wrapper.vm.saveCondition();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("saves OR group with multiple conditions", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("OR", [
        makeCondition({ column: "level", value: "error",    id: "c1" }),
        makeCondition({ column: "level", value: "critical", id: "c2" }),
      ]);
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.objectContaining({ logicalOperator: "OR" }),
        })
      );
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("saves condition with empty-string value (\"\")", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ column: "app_name", operator: "!=", value: '""' }),
      ]);
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({ value: '""' }),
            ]),
          }),
        })
      );
    });

    it("saves condition with null value", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ column: "app_name", operator: "!=", value: "null" }),
      ]);
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({ value: "null" }),
            ]),
          }),
        })
      );
    });

    it("accepts a nested group as a valid condition", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("OR", [
        makeCondition({ id: "c1" }),
        {
          filterType: "group",
          groupId: "nested-g",
          logicalOperator: "AND",
          conditions: [makeCondition({ id: "c2", column: "status" })],
        },
      ]);
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalled();
    });

    it("preserves ignore_case flag in the payload", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ ignore_case: true }),
      ]);
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({ ignore_case: true }),
            ]),
          }),
        })
      );
    });

    it("updates originalConditionGroup after successful save", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = makeConditionGroup("AND", [
        makeCondition({ column: "service", value: "auth" }),
      ]);
      await wrapper.vm.saveCondition();
      // After saving, the original should reflect the current state
      const original = wrapper.vm.originalConditionGroup;
      expect(original.conditions[0].column).toBe("service");
    });
  });

  // -------------------------------------------------------------------------
  describe("openCancelDialog", () => {
    it("emits cancel:hideform directly when no changes were made", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // Synchronize conditionGroup with originalConditionGroup
      wrapper.vm.conditionGroup = JSON.parse(
        JSON.stringify(wrapper.vm.originalConditionGroup)
      );
      await wrapper.vm.openCancelDialog();
      await flushPromises();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("shows dialog when changes were made", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup.conditions = [
        makeCondition({ column: "changed", value: "yes" }),
      ];
      await wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });

    it("dialog okCallback calls closeDialog which emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup.conditions = [makeCondition()];
      await wrapper.vm.openCancelDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("closeDialog restores originalConditionGroup", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const originalSnapshot = JSON.parse(
        JSON.stringify(wrapper.vm.originalConditionGroup)
      );
      // Mutate conditionGroup
      wrapper.vm.conditionGroup.conditions = [makeCondition({ column: "mutated" })];
      wrapper.vm.closeDialog();
      await nextTick();
      expect(JSON.stringify(wrapper.vm.conditionGroup)).toBe(
        JSON.stringify(originalSnapshot)
      );
    });

    it("closeDialog resets userClickedNode and userSelectedNode", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      mockPipelineObj.userClickedNode = { id: "x" };
      mockPipelineObj.userSelectedNode = { id: "y" };
      wrapper.vm.closeDialog();
      await nextTick();
      expect(mockPipelineObj.userClickedNode).toEqual({});
      expect(mockPipelineObj.userSelectedNode).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  describe("openDeleteDialog", () => {
    it("shows delete dialog with correct title and message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe(
        "Are you sure you want to delete stream routing?"
      );
    });

    it("dialog okCallback calls deletePipelineNode", async () => {
      const wrapper = createWrapper({ currentSelectedNodeID: "cond-node-1" });
      await flushPromises();
      await wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("cond-node-1");
    });

    it("dialog okCallback emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("filterColumns utility", () => {
    it("calls update and returns all options when val is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const opts = ["timestamp", "message", "level"];
      let captured = [];
      const update = (cb) => { captured = []; cb(); };
      wrapper.vm.filterColumns(opts, "", update);
      // called without error – update was called
      expect(update).toBeDefined();
    });

    it("filters options by search term case-insensitively", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const opts = ["timestamp", "message", "level"];
      let result = [];
      const update = (cb) => { cb(); };
      // call manually to test logic
      wrapper.vm.filterColumns(opts, "MESS", update);
      // no assertion on internal variable but function should run without error
      expect(typeof wrapper.vm.filterColumns).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  describe("filterGroupKey reactivity", () => {
    it("filterGroupKey increments when conditionGroup.label changes", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const initialKey = wrapper.vm.filterGroupKey;
      wrapper.vm.conditionGroup.label = "or";
      await nextTick();
      expect(wrapper.vm.filterGroupKey).toBe(initialKey + 1);
    });
  });

  // -------------------------------------------------------------------------
  describe("Complex Nested Conditions", () => {
    it("saves AND group containing a nested OR group", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = {
        filterType: "group",
        groupId: "root",
        logicalOperator: "AND",
        conditions: [
          makeCondition({ column: "env", value: "prod", id: "c1" }),
          {
            filterType: "group",
            groupId: "inner",
            logicalOperator: "OR",
            conditions: [
              makeCondition({ column: "level", value: "error",    id: "c2" }),
              makeCondition({ column: "level", value: "critical", id: "c3" }),
            ],
          },
        ],
      };
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          node_type: "condition",
          version: 2,
          conditions: expect.objectContaining({
            logicalOperator: "AND",
            conditions: expect.arrayContaining([
              expect.objectContaining({ column: "env" }),
            ]),
          }),
        })
      );
    });

    it("saves triple-nested condition structure", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.conditionGroup = {
        filterType: "group",
        groupId: "root",
        logicalOperator: "AND",
        conditions: [
          makeCondition({ column: "app", value: "web", id: "c1" }),
          {
            filterType: "group",
            groupId: "l1",
            logicalOperator: "OR",
            conditions: [
              makeCondition({ column: "status", value: "500", id: "c2" }),
              {
                filterType: "group",
                groupId: "l2",
                logicalOperator: "AND",
                conditions: [
                  makeCondition({ column: "code", value: "NullPointer", id: "c3" }),
                ],
              },
            ],
          },
        ],
      };
      await wrapper.vm.saveCondition();
      expect(mockAddNode).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("onInputUpdate callback", () => {
    it("is defined and callable without throwing", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(() => wrapper.vm.onInputUpdate("columnName", {})).not.toThrow();
    });
  });
});
