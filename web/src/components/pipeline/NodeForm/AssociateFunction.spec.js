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
import AssociateFunction from "./AssociateFunction.vue";
import useDnD from "@/plugins/pipelines/useDnD";

installQuasar({ plugins: [Dialog, Notify] });

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

let mockPipelineObj = {};

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn(() => ""),
  };
});

// ODrawer stub — renders slot content so inner elements are accessible in tests.
const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "size", "showClose", "title", "width", "persistent"],
  emits: ["update:open"],
  template: '<div class="o-drawer-stub"><slot /></div>',
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function createPipelineObj(overrides = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeData: {
      data: {},
      type: "function",
    },
    currentSelectedNodeID: "node-abc",
    userSelectedNode: {},
    userClickedNode: {},
    functions: {
      alpha: { name: "alpha", function: 'def alpha(row):\n  return row' },
      beta:  { name: "beta",  function: 'def beta(row):\n  return row' },
      gamma: { name: "gamma", function: 'def gamma(row):\n  return row' },
    },
    ...overrides,
  };
}

function createWrapper(props = {}, pipelineObjOverrides = {}) {
  mockPipelineObj = createPipelineObj(pipelineObjOverrides);

  vi.mocked(useDnD).mockImplementation(() => ({
    pipelineObj: mockPipelineObj,
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
  }));

  return mount(AssociateFunction, {
    global: {
      plugins: [i18n, store],
      stubs: {
        AddFunction: {
          name: "AddFunction",
          template: '<div class="add-function-stub"></div>',
          props: ["isUpdated", "heightOffset"],
          emits: ["update:list", "cancel:hideform"],
        },
        ConfirmDialog: true,
        ODrawer: ODrawerStub,
      },
    },
    props: {
      functions: ["alpha", "beta", "gamma"],
      associatedFunctions: ["delta"],
      ...props,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AssociateFunction Component", () => {
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

    it("renders the outer section element with data-test attribute", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-function-node-routing-section"]').exists()
      ).toBe(true);
    });

    it("initializes createNewFunction as false by default", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.createNewFunction).toBe(false);
    });

    it("initializes afterFlattening as true by default", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.afterFlattening).toBe(true);
    });

    it("initializes loading as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("initializes selectedFunction as empty string when no node data", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.selectedFunction).toBe("");
    });

    it("initializes functionExists as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.functionExists).toBe(false);
    });

    it("populates filteredFunctions from the functions prop and sorts alphabetically", async () => {
      const wrapper = createWrapper({ functions: ["gamma", "alpha", "beta"] });
      await flushPromises();
      expect(wrapper.vm.filteredFunctions).toEqual(["alpha", "beta", "gamma"]);
    });

    it("clears userSelectedNode on mount", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(mockPipelineObj.userSelectedNode).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  describe("Edit Mode Initialization", () => {
    it("reads selectedFunction from currentSelectedNodeData in edit mode", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: {
          data: { name: "alpha", after_flatten: false },
          type: "function",
        },
      });
      await flushPromises();
      expect(wrapper.vm.selectedFunction).toBe("alpha");
    });

    it("reads afterFlattening as false when node data has after_flatten: false", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: {
          data: { name: "beta", after_flatten: false },
        },
      });
      await flushPromises();
      expect(wrapper.vm.afterFlattening).toBe(false);
    });

    it("defaults afterFlattening to true when after_flatten is undefined", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: { data: { name: "gamma" } },
      });
      await flushPromises();
      expect(wrapper.vm.afterFlattening).toBe(true);
    });

    it("shows delete button when isEditNode is true", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: { data: { name: "alpha" } },
      });
      await flushPromises();
      const deleteBtn = wrapper.find('[data-test="associate-function-delete-btn"]');
      expect(deleteBtn.exists()).toBe(true);
    });

    it("hides delete button when isEditNode is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const deleteBtn = wrapper.find('[data-test="associate-function-delete-btn"]');
      expect(deleteBtn.exists()).toBe(false);
    });

    it("emits cancel:hideform when the header close icon button is clicked", async () => {
      vi.useFakeTimers();
      const wrapper = createWrapper();
      await flushPromises();
      // The close button is inside ODrawer's header — simulate via update:open event
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
      drawer.vm.$emit("update:open", false);
      vi.advanceTimersByTime(400);
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  describe("UI Rendering", () => {
    it("shows the function select input when createNewFunction is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="associate-function-select-function-input"]').exists()
      ).toBe(true);
    });

    it("shows after-flattening toggle when createNewFunction is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="associate-function-after-flattening-toggle"]').exists()
      ).toBe(true);
    });

    it("shows cancel and save buttons when createNewFunction is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="associate-function-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="associate-function-save-btn"]').exists()).toBe(true);
    });

    it("hides select input and flattening toggle when createNewFunction is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      expect(
        wrapper.find('[data-test="associate-function-select-function-input"]').exists()
      ).toBe(false);
      expect(
        wrapper.find('[data-test="associate-function-after-flattening-toggle"]').exists()
      ).toBe(false);
    });

    it("shows AddFunction stub when createNewFunction is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      expect(wrapper.find(".pipeline-add-function").exists()).toBe(true);
    });

    it("shows spinner when loading is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.loading = true;
      await nextTick();
      expect(wrapper.find(".q-spinner").exists()).toBe(true);
    });

    it("hides stream-routing-container when loading is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.loading = true;
      await nextTick();
      expect(wrapper.find(".stream-routing-container").exists()).toBe(false);
    });

    it("shows stream-routing-container when loading is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find(".stream-routing-container").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("computedStyleForFunction", () => {
    it("returns width+height 100% when createNewFunction is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.computedStyleForFunction).toEqual({
        width: "100%",
        height: "100%",
      });
    });

    it("returns only width 100% when createNewFunction is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      expect(wrapper.vm.computedStyleForFunction).toEqual({ width: "100%" });
    });
  });

  // -------------------------------------------------------------------------
  describe("Function List Filtering", () => {
    it("filterFunctions calls update callback", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const mockUpdate = vi.fn();
      wrapper.vm.filterFunctions("alpha", mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("filterFunctions narrows results by search string", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const mockUpdate = vi.fn((cb) => cb());
      wrapper.vm.filterFunctions("alpha", mockUpdate);
      expect(wrapper.vm.filteredFunctions).toEqual(["alpha"]);
    });

    it("filterFunctions is case-insensitive", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const mockUpdate = vi.fn((cb) => cb());
      wrapper.vm.filterFunctions("ALPHA", mockUpdate);
      expect(wrapper.vm.filteredFunctions).toContain("alpha");
    });

    it("filterFunctions returns all sorted functions when search is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const mockUpdate = vi.fn((cb) => cb());
      wrapper.vm.filterFunctions("", mockUpdate);
      expect(wrapper.vm.filteredFunctions).toEqual(["alpha", "beta", "gamma"]);
    });

    it("updates filteredFunctions reactively when functions prop changes", async () => {
      const wrapper = createWrapper({ functions: ["z", "a"] });
      await flushPromises();
      expect(wrapper.vm.filteredFunctions).toEqual(["a", "z"]);
      await wrapper.setProps({ functions: ["z", "a", "m"] });
      await flushPromises();
      expect(wrapper.vm.filteredFunctions).toEqual(["a", "m", "z"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("saveFunction – existing function", () => {
    it("calls addNode with name and after_flatten when function is valid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      wrapper.vm.afterFlattening = true;
      await wrapper.vm.saveFunction();
      expect(mockAddNode).toHaveBeenCalledWith({
        name: "alpha",
        after_flatten: true,
      });
    });

    it("emits cancel:hideform after successful save", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.selectedFunction = "beta";
      await wrapper.vm.saveFunction();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("sets functionExists and does NOT call addNode when function is already associated", async () => {
      const wrapper = createWrapper({ associatedFunctions: ["alpha"] });
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      await wrapper.vm.saveFunction();
      expect(wrapper.vm.functionExists).toBe(true);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("resets functionExists to false at the start of each save", async () => {
      const wrapper = createWrapper({ associatedFunctions: ["alpha"] });
      await flushPromises();
      wrapper.vm.functionExists = true;
      wrapper.vm.selectedFunction = "beta";
      await wrapper.vm.saveFunction();
      // beta is not already associated so save succeeds and functionExists stays false
      expect(wrapper.vm.functionExists).toBe(false);
    });

    it("saves with afterFlattening false correctly", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.selectedFunction = "gamma";
      wrapper.vm.afterFlattening = false;
      await wrapper.vm.saveFunction();
      expect(mockAddNode).toHaveBeenCalledWith({
        name: "gamma",
        after_flatten: false,
      });
    });

    it("skips duplicate-check when isUpdating is true (edit mode)", async () => {
      const wrapper = createWrapper({ associatedFunctions: ["alpha"] }, {
        isEditNode: true,
        currentSelectedNodeData: { data: { name: "alpha" } },
      });
      await flushPromises();
      wrapper.vm.isUpdating = true;
      wrapper.vm.selectedFunction = "alpha";
      await wrapper.vm.saveFunction();
      // In updating mode duplicate check is bypassed
      expect(wrapper.vm.functionExists).toBe(false);
      expect(mockAddNode).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("saveFunction – create new function mode", () => {
    it("shows notify when createNewFunction is true but function name is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      // Provide a fake addFunctionRef with empty name
      wrapper.vm.addFunctionRef = {
        formData: { name: "", function: "" },
      };
      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;
      await wrapper.vm.saveFunction();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Function Name is required",
          color: "negative",
        })
      );
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("does NOT show notify when createNewFunction is true and function name is set", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      wrapper.vm.addFunctionRef = {
        formData: { name: "newFunc", function: "def newFunc(r): return r" },
      };
      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;
      await wrapper.vm.saveFunction();
      expect(notifyMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("onFunctionCreation callback", () => {
    it("sets selectedFunction to the newly created function name", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      await wrapper.vm.onFunctionCreation({ name: "newFunc" });
      await flushPromises();
      expect(wrapper.vm.selectedFunction).toBe("newFunc");
    });

    it("sets createNewFunction back to false after function creation", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      await wrapper.vm.onFunctionCreation({ name: "newFunc" });
      expect(wrapper.vm.createNewFunction).toBe(false);
    });

    it("emits add:function event with the new function data", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const functionData = { name: "newFunc", function: "def f(r): return r" };
      await wrapper.vm.onFunctionCreation(functionData);
      expect(wrapper.emitted("add:function")).toBeTruthy();
      expect(wrapper.emitted("add:function")[0][0]).toEqual(functionData);
    });
  });

  // -------------------------------------------------------------------------
  describe("cancelFunctionCreation", () => {
    it("emits cancel:hideform when cancelFunctionCreation is called", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.cancelFunctionCreation();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("openCancelDialog", () => {
    it("shows the confirm dialog with correct title and message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      await wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe(
        "Are you sure you want to cancel changes?"
      );
    });

    it("dialog okCallback emits cancel:hideform", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      await wrapper.vm.openCancelDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("resets userClickedNode and userSelectedNode on openCancelDialog", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      mockPipelineObj.userClickedNode = { id: "x" };
      mockPipelineObj.userSelectedNode = { id: "y" };
      wrapper.vm.selectedFunction = "alpha";
      await wrapper.vm.openCancelDialog();
      expect(mockPipelineObj.userClickedNode).toEqual({});
      expect(mockPipelineObj.userSelectedNode).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  describe("openDeleteDialog", () => {
    it("shows the confirm dialog with Delete Node title", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
    });

    it("sets the correct delete message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.openDeleteDialog();
      expect(wrapper.vm.dialog.message).toBe(
        "Are you sure you want to delete function association?"
      );
    });

    it("dialog okCallback calls deleteFunction which calls deletePipelineNode", async () => {
      const wrapper = createWrapper({}, { currentSelectedNodeID: "node-abc" });
      await flushPromises();
      await wrapper.vm.openDeleteDialog();
      wrapper.vm.dialog.okCallback();
      await nextTick();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-abc");
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
  describe("After Flattening Toggle", () => {
    it("toggling the after-flattening toggle changes afterFlattening state", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.afterFlattening).toBe(true);
      await wrapper
        .find('[data-test="associate-function-after-flattening-toggle"]')
        .trigger("click");
      expect(wrapper.vm.afterFlattening).toBe(false);
    });

    it("afterFlattening value is included in addNode payload", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      wrapper.vm.afterFlattening = false;
      await wrapper.vm.saveFunction();
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ after_flatten: false })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("Function Definition Display", () => {
    it("shows function definition card when a valid function is selected", async () => {
      const wrapper = createWrapper({}, {
        functions: {
          alpha: { name: "alpha", function: "def alpha(r): return r" },
        },
      });
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      await nextTick();
      expect(wrapper.find(".function-definition-section").exists()).toBe(true);
    });

    it("does NOT show function definition card when no function is selected", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find(".function-definition-section").exists()).toBe(false);
    });

    it("does NOT show function definition card when createNewFunction is true", async () => {
      const wrapper = createWrapper({}, {
        functions: {
          alpha: { name: "alpha", function: "def alpha(r): return r" },
        },
      });
      await flushPromises();
      wrapper.vm.selectedFunction = "alpha";
      wrapper.vm.createNewFunction = true;
      await nextTick();
      expect(wrapper.find(".function-definition-section").exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("saveUpdatedLink helper", () => {
    it("updates nodeLink with from/to values", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.saveUpdatedLink({ from: "nodeA", to: "nodeB" });
      expect(wrapper.vm.nodeLink).toEqual({ from: "nodeA", to: "nodeB" });
    });
  });
});
