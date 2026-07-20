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
import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import AssociateFunction from "./AssociateFunction.vue";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

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

// ODrawer stub — renders slot content (so the REAL <OForm> mounts inside it and
// the schema runs) plus the footer buttons. The footer Save is wired via
// form-id; tests drive the form's own handleSubmit().
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open", "size", "showClose", "title", "width", "persistent", "formId",
    "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel",
  ],
  emits: ["update:open", "click:secondary", "click:neutral"],
  template: `<div class="o-drawer-stub">
    <slot />
    <button v-if="neutralButtonLabel" data-test="o-drawer-neutral-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    <button v-if="secondaryButtonLabel" data-test="o-drawer-secondary-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    <button v-if="primaryButtonLabel" data-test="o-drawer-primary-btn" type="submit" form="associate-function-form">{{ primaryButtonLabel }}</button>
  </div>`,
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
      open: true,
      functions: ["alpha", "beta", "gamma"],
      associatedFunctions: ["delta"],
      ...props,
    },
  });
}

// Form helpers — selectedFunction/afterFlattening are form-owned now.
const setField = (w, name, val) => w.vm.form.setFieldValue(name, val);
const formVals = (w) => w.vm.form.state.values;
const submitForm = async (w) => {
  await w.vm.form.handleSubmit();
  await flushPromises();
};

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

    it("seeds form afterFlattening as true by default", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(formVals(wrapper).afterFlattening).toBe(true);
    });

    it("initializes loading as false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("seeds form selectedFunction as empty string when no node data", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(formVals(wrapper).selectedFunction).toBe("");
    });

    it("populates filteredFunctions from the functions prop and sorts alphabetically", async () => {
      const wrapper = createWrapper({ functions: ["gamma", "alpha", "beta"] });
      await flushPromises();
      expect(wrapper.vm.filteredFunctions).toEqual(["alpha", "beta", "gamma"]);
    });

    it("clears userSelectedNode on mount", async () => {
      createWrapper();
      await flushPromises();
      expect(mockPipelineObj.userSelectedNode).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  describe("Edit Mode Initialization", () => {
    it("seeds form selectedFunction from currentSelectedNodeData in edit mode", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: {
          data: { name: "alpha", after_flatten: false },
          type: "function",
        },
      });
      await flushPromises();
      expect(formVals(wrapper).selectedFunction).toBe("alpha");
    });

    it("seeds form afterFlattening as false when node data has after_flatten: false", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: {
          data: { name: "beta", after_flatten: false },
        },
      });
      await flushPromises();
      expect(formVals(wrapper).afterFlattening).toBe(false);
    });

    it("defaults form afterFlattening to true when after_flatten is undefined", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: { data: { name: "gamma" } },
      });
      await flushPromises();
      expect(formVals(wrapper).afterFlattening).toBe(true);
    });

    it("shows delete button when isEditNode is true", async () => {
      const wrapper = createWrapper({}, {
        isEditNode: true,
        currentSelectedNodeData: { data: { name: "alpha" } },
      });
      await flushPromises();
      const deleteBtn = wrapper.find('[data-test="o-drawer-neutral-btn"]');
      expect(deleteBtn.exists()).toBe(true);
    });

    it("hides delete button when isEditNode is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const deleteBtn = wrapper.find('[data-test="o-drawer-neutral-btn"]');
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
      expect(wrapper.find('[data-test="o-drawer-secondary-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-drawer-primary-btn"]').exists()).toBe(true);
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
      expect(wrapper.find('[data-test="associate-function-loading-indicator"]').exists()).toBe(true);
    });

    it("hides stream-routing-container when loading is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.loading = true;
      await nextTick();
      expect(wrapper.find('[data-test="associate-function-routing-container"]').exists()).toBe(false);
    });

    it("shows stream-routing-container when loading is false", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="associate-function-routing-container"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Function List Filtering", () => {
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
  // saveFunction via the real OForm (schema-gated: required + uniqueness).
  describe("saveFunction – existing function", () => {
    it("blocks submit and does NOT call addNode when no function is selected (restored required rule)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "selectedFunction", "");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("calls addNode with name and after_flatten when function is valid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "selectedFunction", "alpha");
      setField(wrapper, "afterFlattening", true);
      await submitForm(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith({
        name: "alpha",
        after_flatten: true,
      });
    });

    it("emits cancel:hideform after successful save", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "selectedFunction", "beta");
      await submitForm(wrapper);
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("blocks submit and does NOT call addNode when function is already associated (uniqueness)", async () => {
      const wrapper = createWrapper({ associatedFunctions: ["alpha"] });
      await flushPromises();
      setField(wrapper, "selectedFunction", "alpha");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockAddNode).not.toHaveBeenCalled();
    });

    it("allows a not-yet-associated function even when others are associated", async () => {
      const wrapper = createWrapper({ associatedFunctions: ["alpha"] });
      await flushPromises();
      setField(wrapper, "selectedFunction", "beta");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(mockAddNode).toHaveBeenCalled();
    });

    it("saves with afterFlattening false correctly", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "selectedFunction", "gamma");
      setField(wrapper, "afterFlattening", false);
      await submitForm(wrapper);
      expect(mockAddNode).toHaveBeenCalledWith({
        name: "gamma",
        after_flatten: false,
      });
    });

    it("skips the uniqueness check when isUpdating is true (edit mode)", async () => {
      const wrapper = createWrapper({ associatedFunctions: ["alpha"] }, {
        isEditNode: true,
        currentSelectedNodeData: { data: { name: "alpha" } },
      });
      await flushPromises();
      wrapper.vm.isUpdating = true;
      await nextTick();
      setField(wrapper, "selectedFunction", "alpha");
      await submitForm(wrapper);
      // In updating mode the uniqueness check is bypassed → save succeeds.
      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(mockAddNode).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("onFunctionCreation callback", () => {
    it("selects the newly created function in the form", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.createNewFunction = true;
      await nextTick();
      await wrapper.vm.onFunctionCreation({ name: "newFunc" });
      await flushPromises();
      expect(formVals(wrapper).selectedFunction).toBe("newFunc");
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
    it("afterFlattening value reflects what's set on the form", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(formVals(wrapper).afterFlattening).toBe(true);
      setField(wrapper, "afterFlattening", false);
      expect(formVals(wrapper).afterFlattening).toBe(false);
    });

    it("afterFlattening value is included in addNode payload", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "selectedFunction", "alpha");
      setField(wrapper, "afterFlattening", false);
      await submitForm(wrapper);
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
      setField(wrapper, "selectedFunction", "alpha");
      await flushPromises();
      expect(
        wrapper.find('[data-test="associate-function-definition-section"]').exists(),
      ).toBe(true);
    });

    it("does NOT show function definition card when no function is selected", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="associate-function-definition-section"]').exists()).toBe(false);
    });

    it("does NOT show function definition card when createNewFunction is true", async () => {
      const wrapper = createWrapper({}, {
        functions: {
          alpha: { name: "alpha", function: "def alpha(r): return r" },
        },
      });
      await flushPromises();
      setField(wrapper, "selectedFunction", "alpha");
      wrapper.vm.createNewFunction = true;
      await nextTick();
      expect(wrapper.find('[data-test="associate-function-definition-section"]').exists()).toBe(false);
    });
  });

});
