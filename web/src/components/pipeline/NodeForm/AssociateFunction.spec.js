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

// AssociateFunction is now a thin drawer wrapper around the shared FunctionPicker
// (the picker body — select / inline-create / flatten toggle — is covered by
// FunctionPicker.spec.ts). These tests cover the drawer integration: save wiring
// to addNode, delete/cancel dialogs, and create-mode button visibility.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import AssociateFunction from "./AssociateFunction.vue";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();
let mockPipelineObj = {};

vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));

// Controllable FunctionPicker stub — getPayload() returns whatever the test sets.
let mockGetPayload = vi.fn(() => ({ name: "alpha", after_flatten: true }));
const FunctionPickerStub = {
  name: "FunctionPicker",
  template: '<div class="function-picker-stub"></div>',
  props: ["initialName", "initialAfterFlatten", "showFlatten", "isUpdating", "duplicateNames"],
  emits: ["expand", "created"],
  methods: {
    getPayload() {
      return mockGetPayload();
    },
  },
};

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open", "size", "showClose", "title", "width", "persistent",
    "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `<div class="o-drawer-stub">
    <slot />
    <button v-if="neutralButtonLabel" data-test="o-drawer-neutral-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    <button v-if="secondaryButtonLabel" data-test="o-drawer-secondary-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    <button v-if="primaryButtonLabel" data-test="o-drawer-primary-btn" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
  </div>`,
};

function createPipelineObj(overrides = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeData: { data: {}, type: "function" },
    currentSelectedNodeID: "node-abc",
    userSelectedNode: {},
    userClickedNode: {},
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
        ConfirmDialog: true,
        ODrawer: ODrawerStub,
        FunctionPicker: FunctionPickerStub,
      },
    },
    props: {
      functions: ["alpha", "beta", "gamma"],
      associatedFunctions: ["delta"],
      ...props,
    },
  });
}

describe("AssociateFunction Component", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockGetPayload = vi.fn(() => ({ name: "alpha", after_flatten: true }));
  });

  describe("Initialization", () => {
    it("mounts successfully", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the routing section and the FunctionPicker", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-function-node-routing-section"]').exists(),
      ).toBe(true);
      expect(wrapper.findComponent(FunctionPickerStub).exists()).toBe(true);
    });

    it("passes node data + associatedFunctions to FunctionPicker", async () => {
      const wrapper = createWrapper(
        { associatedFunctions: ["delta", "omega"] },
        {
          currentSelectedNodeData: {
            data: { name: "alpha", after_flatten: false },
            type: "function",
          },
        },
      );
      await flushPromises();
      const picker = wrapper.findComponent(FunctionPickerStub);
      expect(picker.props("initialName")).toBe("alpha");
      expect(picker.props("initialAfterFlatten")).toBe(false);
      expect(picker.props("duplicateNames")).toEqual(["delta", "omega"]);
    });

    it("defaults initialAfterFlatten to true when unset", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.findComponent(FunctionPickerStub).props("initialAfterFlatten"),
      ).toBe(true);
    });
  });

  describe("Save", () => {
    it("adds the node with the picker payload and closes on save", async () => {
      mockGetPayload = vi.fn(() => ({ name: "alpha", after_flatten: false }));
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(mockAddNode).toHaveBeenCalledWith({ name: "alpha", after_flatten: false });
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("does nothing when the picker returns null (invalid)", async () => {
      mockGetPayload = vi.fn(() => null);
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(mockAddNode).not.toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
    });
  });

  describe("Create mode (expand)", () => {
    it("hides Save/Cancel and shows a wide drawer while creating inline", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.findComponent(FunctionPickerStub).vm.$emit("expand", true);
      await nextTickFlush(wrapper);
      expect(wrapper.find('[data-test="o-drawer-primary-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="o-drawer-secondary-btn"]').exists()).toBe(false);
    });

    it("re-emits add:function when the picker creates a function", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.findComponent(FunctionPickerStub).vm.$emit("created", { name: "new_fn" });
      expect(wrapper.emitted("add:function")?.[0]).toEqual([{ name: "new_fn" }]);
    });
  });

  describe("Delete", () => {
    it("shows the delete control only in edit mode", async () => {
      const view = createWrapper({}, { isEditNode: false });
      await flushPromises();
      expect(view.find('[data-test="o-drawer-neutral-btn"]').exists()).toBe(false);

      const edit = createWrapper({}, { isEditNode: true });
      await flushPromises();
      expect(edit.find('[data-test="o-drawer-neutral-btn"]').exists()).toBe(true);
    });

    it("deletes the node via the confirm dialog callback", async () => {
      const wrapper = createWrapper({}, { isEditNode: true });
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-neutral-btn"]').trigger("click");
      // invoke the dialog's ok callback directly
      wrapper.vm.dialog.okCallback();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-abc");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("Cancel / close", () => {
    it("emits cancel:hideform when the drawer is closed", async () => {
      vi.useFakeTimers();
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.findComponent(ODrawerStub).vm.$emit("update:open", false);
      vi.runAllTimers();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
      vi.useRealTimers();
    });

    it("opens a discard dialog on cancel", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-secondary-btn"]').trigger("click");
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });
  });
});

// Helper: flush a tick so a reactive emit propagates to the stubbed drawer props.
async function nextTickFlush(wrapper) {
  await wrapper.vm.$nextTick();
  await flushPromises();
}
