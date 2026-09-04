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

// ExternalDestination is CHROME ONLY: drawer + Save/Cancel/Delete + addNode.
// The body (destination list, select, inline create, validation) is the SHARED
// DestinationPicker — its behaviour is covered in
// components/flow/forms/DestinationPicker.spec.ts, which the workflow
// Destination node exercises through the same component. Here we only assert
// this drawer's own responsibilities, driving the picker through a stub.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import ExternalDestination from "./ExternalDestination.vue";

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));
import useDnD from "@/plugins/pipelines/useDnD";

// Drawer stub: renders the body slot + the three footer buttons, each only when
// its label is defined (that is how the component hides the footer while the
// picker's inline create form is open).
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "size",
    "showClose",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "neutralButtonVariant",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div class="o-drawer-stub">
      <div class="o-drawer-title">{{ title }}</div>
      <slot />
      <button v-if="secondaryButtonLabel" data-test="cancel-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button v-if="primaryButtonLabel" data-test="save-btn" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button v-if="neutralButtonLabel" data-test="delete-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    </div>
  `,
};

// Picker stub: submit() resolves whatever the test queues, so we can drive the
// valid / invalid save paths without the real form.
let pickerPayload: any = { org_id: "org-x", destination_name: "dest1" };
const DestinationPickerStub = {
  name: "DestinationPicker",
  props: ["initialName"],
  emits: ["expand"],
  template: '<div class="destination-picker-stub" @click="$emit(\'expand\', true)" />',
  methods: {
    submit: () => Promise.resolve(pickerPayload),
  },
};

function createWrapper(pipelineObjOverrides: Record<string, any> = {}) {
  const mockPipelineObj = {
    currentSelectedNodeData: { data: {}, type: "destination" },
    currentSelectedNodeID: "node-123",
    isEditNode: false,
    ...pipelineObjOverrides,
  };

  vi.mocked(useDnD).mockImplementation(
    () =>
      ({
        pipelineObj: mockPipelineObj,
        addNode: mockAddNode,
        deletePipelineNode: mockDeletePipelineNode,
      }) as any,
  );

  return mount(ExternalDestination, {
    props: { open: true },
    global: {
      plugins: [i18n, store],
      stubs: {
        ConfirmDialog: true,
        ODrawer: ODrawerStub,
        DestinationPicker: DestinationPickerStub,
      },
    },
  });
}

describe("ExternalDestination.vue (drawer chrome)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickerPayload = { org_id: "org-x", destination_name: "dest1" };
  });

  it("mounts and renders the shared DestinationPicker as its body", () => {
    const wrapper = createWrapper();
    expect(wrapper.find(".destination-picker-stub").exists()).toBe(true);
    expect(wrapper.find(".o-drawer-title").text()).toContain("External Destination");
  });

  it("seeds the picker with the saved destination when editing", () => {
    const wrapper = createWrapper({
      currentSelectedNodeData: { data: { destination_name: "dest2" } },
    });
    expect(wrapper.findComponent({ name: "DestinationPicker" }).props("initialName")).toBe("dest2");
  });

  // ── Save ────────────────────────────────────────────────────────────────
  it("adds the node with the correct payload on save", async () => {
    const wrapper = createWrapper();
    await wrapper.find('[data-test="save-btn"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({
        destination_name: "dest1",
        node_type: "remote_stream",
        io_type: "output",
        org_id: store.state.selectedOrganization.identifier,
      }),
    );
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });

  it("does NOT add a node when the picker blocks the save (invalid)", async () => {
    pickerPayload = null; // schema rejected it; the picker shows the error inline
    const wrapper = createWrapper();
    await wrapper.find('[data-test="save-btn"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAddNode).not.toHaveBeenCalled();
    expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
  });

  // ── Footer visibility ───────────────────────────────────────────────────
  it("hides the footer while the picker's inline create form is open", async () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="save-btn"]').exists()).toBe(true);

    // the picker stub emits expand(true) on click
    await wrapper.find(".destination-picker-stub").trigger("click");

    expect(wrapper.find('[data-test="save-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cancel-btn"]').exists()).toBe(false);
  });

  it("shows the delete button only when editing a node", () => {
    expect(createWrapper({ isEditNode: false }).find('[data-test="delete-btn"]').exists()).toBe(
      false,
    );
    expect(createWrapper({ isEditNode: true }).find('[data-test="delete-btn"]').exists()).toBe(
      true,
    );
  });

  // ── Cancel / delete ─────────────────────────────────────────────────────
  it("emits cancel:hideform on cancel", async () => {
    const wrapper = createWrapper();
    await wrapper.find('[data-test="cancel-btn"]').trigger("click");
    expect(wrapper.emitted("cancel:hideform")).toHaveLength(1);
  });

  it("opens the delete confirmation with the expected copy", async () => {
    const wrapper = createWrapper({ isEditNode: true });
    await wrapper.find('[data-test="delete-btn"]').trigger("click");
    const dialog = (wrapper.vm as any).dialog;
    expect(dialog.show).toBe(true);
    expect(dialog.title).toBe("Delete Node");
    expect(typeof dialog.okCallback).toBe("function");
  });

  it("deletes the node and closes when the deletion is confirmed", () => {
    const wrapper = createWrapper({ isEditNode: true });
    (wrapper.vm as any).deleteRoute();
    expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-123");
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });
});
