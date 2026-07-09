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

// ExternalDestination is now a thin drawer wrapper around the shared
// DestinationPicker (the picker body — list / create / select — is covered by
// DestinationPicker.spec.ts). These tests cover the drawer integration: save
// wiring to addNode, delete/cancel, and create-mode button visibility.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import ExternalDestination from "./ExternalDestination.vue";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();
let mockPipelineObj: any = {};

vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));

// Controllable DestinationPicker stub.
let mockGetPayload = vi.fn(() => ({ org_id: "test-org", destination_name: "sink-1" }));
const DestinationPickerStub = {
  name: "DestinationPicker",
  template: '<div class="destination-picker-stub"></div>',
  props: ["initialName"],
  emits: ["expand"],
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
    "neutralButtonVariant",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `<div class="o-drawer-stub">
    <slot />
    <button v-if="neutralButtonLabel" data-test="o-drawer-neutral-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    <button v-if="secondaryButtonLabel" data-test="o-drawer-secondary-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    <button v-if="primaryButtonLabel" data-test="o-drawer-primary-btn" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
  </div>`,
};

function makePipelineObj(overrides = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeData: { data: {}, type: "remote_stream" },
    currentSelectedNodeID: "dest-node-1",
    userSelectedNode: {},
    userClickedNode: {},
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

  return mount(ExternalDestination, {
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

describe("ExternalDestination Component", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockGetPayload = vi.fn(() => ({ org_id: "test-org", destination_name: "sink-1" }));
  });

  describe("Initialization", () => {
    it("mounts and renders the DestinationPicker", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.findComponent(DestinationPickerStub).exists()).toBe(true);
    });

    it("passes the saved destination name to the picker", async () => {
      const wrapper = createWrapper({
        currentSelectedNodeData: {
          data: { destination_name: "existing-sink" },
          type: "remote_stream",
        },
      });
      await flushPromises();
      expect(wrapper.findComponent(DestinationPickerStub).props("initialName")).toBe(
        "existing-sink",
      );
    });
  });

  describe("Save", () => {
    it("adds a remote_stream node with the picker payload", async () => {
      mockGetPayload = vi.fn(() => ({ org_id: "org-x", destination_name: "sink-9" }));
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(mockAddNode).toHaveBeenCalledWith({
        destination_name: "sink-9",
        node_type: "remote_stream",
        io_type: "output",
        org_id: "org-x",
      });
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("does nothing when the picker returns null", async () => {
      mockGetPayload = vi.fn(() => null);
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(mockAddNode).not.toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
    });
  });

  describe("Create mode", () => {
    it("hides Save/Cancel while creating inline", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      wrapper.findComponent(DestinationPickerStub).vm.$emit("expand", true);
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="o-drawer-primary-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="o-drawer-secondary-btn"]').exists()).toBe(false);
    });
  });

  describe("Delete", () => {
    it("shows delete only in edit mode and deletes via the dialog callback", async () => {
      const view = createWrapper({ isEditNode: false });
      await flushPromises();
      expect(view.find('[data-test="o-drawer-neutral-btn"]').exists()).toBe(false);

      const wrapper = createWrapper({ isEditNode: true });
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-neutral-btn"]').trigger("click");
      wrapper.vm.dialog.okCallback();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("dest-node-1");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("Cancel", () => {
    it("emits cancel:hideform on cancel", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-secondary-btn"]').trigger("click");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });
});
