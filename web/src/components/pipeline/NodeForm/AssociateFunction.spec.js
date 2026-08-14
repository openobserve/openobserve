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

// AssociateFunction.vue is CHROME ONLY: the drawer + Save/Cancel/Delete +
// addNode. The body (function list, select, after-flatten, the inline
// AddFunction editor, and the zod schema for required / already-associated) is
// the SHARED FunctionPicker — covered in
// components/flow/forms/FunctionPicker.spec.ts, which the workflow Function node
// exercises through the very same component. Here we drive the picker via a stub
// and assert only this drawer's own responsibilities.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import AssociateFunction from "./AssociateFunction.vue";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));

// Picker stub: submit() resolves whatever the test queues; clicking it emits
// expand(true) to simulate opening the inline function editor.
let pickerPayload = { name: "fn-a", after_flatten: true };
const FunctionPickerStub = {
  name: "FunctionPicker",
  props: [
    "initialName",
    "initialAfterFlatten",
    "isUpdating",
    "duplicateNames",
    "showFlatten",
    "sampleEvents",
  ],
  emits: ["expand", "created"],
  template: '<div class="function-picker-stub" @click="$emit(\'expand\', true)" />',
  methods: {
    submit: () => Promise.resolve(pickerPayload),
  },
};

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "title",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "neutralButtonVariant",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div class="o-drawer-stub" :data-width="width">
      <slot />
      <button v-if="primaryButtonLabel" data-test="save-btn" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button v-if="secondaryButtonLabel" data-test="cancel-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button v-if="neutralButtonLabel" data-test="delete-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    </div>
  `,
};

function createWrapper(pipelineObjOverrides = {}, props = {}) {
  const mockPipelineObj = {
    currentSelectedNodeData: { data: {}, type: "function" },
    currentSelectedNodeID: "node-123",
    userClickedNode: {},
    userSelectedNode: { id: "x" },
    isEditNode: false,
    ...pipelineObjOverrides,
  };

  vi.mocked(useDnD).mockImplementation(() => ({
    pipelineObj: mockPipelineObj,
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
  }));

  return mount(AssociateFunction, {
    props: { open: true, functions: [], associatedFunctions: [], ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        ConfirmDialog: true,
        ODrawer: ODrawerStub,
        FunctionPicker: FunctionPickerStub,
      },
    },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AssociateFunction.vue (drawer chrome)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickerPayload = { name: "fn-a", after_flatten: true };
  });

  it("mounts and renders the shared FunctionPicker as its body", () => {
    const wrapper = createWrapper();
    expect(wrapper.find(".function-picker-stub").exists()).toBe(true);
  });

  it("seeds the picker from the saved node when editing", () => {
    const wrapper = createWrapper({
      isEditNode: true,
      currentSelectedNodeData: { data: { name: "fn-b", after_flatten: false } },
    });
    const picker = wrapper.findComponent({ name: "FunctionPicker" });
    expect(picker.props("initialName")).toBe("fn-b");
    expect(picker.props("initialAfterFlatten")).toBe(false);
    // Editing a NODE must NOT bind `is-updating` — that flag means "editing an
    // existing FUNCTION" and locks the select + disables the create-new name
    // field. A node edit still has to let you re-point at a different function.
    expect(picker.props("isUpdating")).toBeFalsy();
  });

  it("passes the already-associated names to the picker for uniqueness", () => {
    const wrapper = createWrapper({}, { associatedFunctions: ["fn-a", "fn-b"] });
    expect(wrapper.findComponent({ name: "FunctionPicker" }).props("duplicateNames")).toEqual([
      "fn-a",
      "fn-b",
    ]);
  });

  // ── Save ────────────────────────────────────────────────────────────────
  it("adds the node with the correct payload on save", async () => {
    const wrapper = createWrapper();
    await wrapper.find('[data-test="save-btn"]').trigger("click");
    await tick();

    expect(mockAddNode).toHaveBeenCalledWith({
      name: "fn-a",
      after_flatten: true,
    });
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });

  it("does NOT add a node when the picker blocks the save (invalid/duplicate)", async () => {
    pickerPayload = null; // schema rejected it; the picker shows the error inline
    const wrapper = createWrapper();
    await wrapper.find('[data-test="save-btn"]').trigger("click");
    await tick();

    expect(mockAddNode).not.toHaveBeenCalled();
    expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
  });

  // ── Inline editor (expand) ──────────────────────────────────────────────
  it("widens the drawer and hides the footer while the inline editor is open", async () => {
    const wrapper = createWrapper();
    expect(wrapper.find(".o-drawer-stub").attributes("data-width")).toBe("30");
    expect(wrapper.find('[data-test="save-btn"]').exists()).toBe(true);

    await wrapper.find(".function-picker-stub").trigger("click"); // expand(true)

    expect(wrapper.find(".o-drawer-stub").attributes("data-width")).toBe("97");
    expect(wrapper.find('[data-test="save-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cancel-btn"]').exists()).toBe(false);
  });

  it("re-emits add:function when the picker creates one", async () => {
    const wrapper = createWrapper();
    wrapper.findComponent({ name: "FunctionPicker" }).vm.$emit("created", { name: "new-fn" });
    await tick();
    expect(wrapper.emitted("add:function")[0]).toEqual([{ name: "new-fn" }]);
  });

  // ── Buttons / cancel / delete ───────────────────────────────────────────
  it("shows delete only when editing a node", () => {
    expect(createWrapper({ isEditNode: false }).find('[data-test="delete-btn"]').exists()).toBe(
      false,
    );
    expect(createWrapper({ isEditNode: true }).find('[data-test="delete-btn"]').exists()).toBe(
      true,
    );
  });

  it("prompts to discard on cancel", async () => {
    const wrapper = createWrapper();
    await wrapper.find('[data-test="cancel-btn"]').trigger("click");
    expect(wrapper.vm.dialog.show).toBe(true);
    expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    expect(wrapper.vm.pipelineObj.userSelectedNode).toEqual({});
  });

  it("opens the delete confirmation with the expected copy", async () => {
    const wrapper = createWrapper({ isEditNode: true });
    await wrapper.find('[data-test="delete-btn"]').trigger("click");
    expect(wrapper.vm.dialog.show).toBe(true);
    expect(wrapper.vm.dialog.title).toBe("Delete Node");
    expect(typeof wrapper.vm.dialog.okCallback).toBe("function");
  });

  it("deletes the node when the deletion is confirmed", () => {
    const wrapper = createWrapper({ isEditNode: true });
    wrapper.vm.deleteFunction();
    expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-123");
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });
});
