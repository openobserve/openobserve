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

// Condition is now a thin drawer wrapper around the shared ConditionBuilder
// (the FilterGroup body + V0/V1/V2 conversion + validation live in, and are
// tested by, ConditionBuilder.spec.ts). These tests cover the drawer
// integration: field fetch → picker, save → addNode, cancel/delete dialogs.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import Condition from "./Condition.vue";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();
let mockPipelineObj = {};

vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));

const mockGetStream = vi.fn().mockResolvedValue({
  schema: [
    { name: "_timestamp", type: "datetime" },
    { name: "level", type: "string" },
  ],
});
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: mockGetStream, getStreams: vi.fn() }),
}));
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn().mockResolvedValue({
      astify: vi.fn().mockReturnValue({ from: [{ table: "test_stream" }] }),
    }),
  }),
}));

// Controllable ConditionBuilder stub.
let mockCondPayload = () => ({ version: 2, conditions: [{ column: "level", operator: "=" }] });
const ConditionBuilderStub = {
  name: "ConditionBuilder",
  template: '<div class="condition-builder-stub"><slot name="guidelines" /></div>',
  props: ["fields", "initialConditions", "module", "allowCustomColumns", "normalizeOperators"],
  data() {
    return { conditionGroup: { filterType: "group", conditions: [] } };
  },
  methods: {
    getPayload() {
      return mockCondPayload();
    },
  },
};

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open", "size", "showClose", "title", "width", "persistent",
    "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel",
    "secondaryButtonVariant", "neutralButtonVariant",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div class="o-drawer-stub">
      <slot />
      <slot name="header-right" />
      <button v-if="secondaryButtonLabel" data-test="o-drawer-secondary-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button v-if="primaryButtonLabel"   data-test="o-drawer-primary-btn"   @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button v-if="neutralButtonLabel"   data-test="o-drawer-neutral-btn"   @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    </div>
  `,
};

function makePipelineObj(overrides = {}) {
  return {
    isEditNode: false,
    currentSelectedNodeData: { data: {}, type: "condition" },
    currentSelectedNodeID: "cond-node-1",
    currentSelectedPipeline: {
      nodes: [
        {
          io_type: "input",
          data: { node_type: "stream", stream_name: "test_stream", stream_type: "logs" },
        },
      ],
    },
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

  return mount(Condition, {
    global: {
      plugins: [i18n, store],
      stubs: {
        ConfirmDialog: true,
        ODrawer: ODrawerStub,
        ConditionBuilder: ConditionBuilderStub,
      },
    },
  });
}

describe("Condition Component", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockCondPayload = () => ({ version: 2, conditions: [{ column: "level", operator: "=" }] });
  });

  describe("Initialization", () => {
    it("mounts and renders the drawer + ConditionBuilder", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="add-condition-section"]').exists()).toBe(true);
      expect(wrapper.findComponent(ConditionBuilderStub).exists()).toBe(true);
    });

    it("passes saved conditions to the builder in edit mode + normalizeOperators", async () => {
      const wrapper = createWrapper({
        isEditNode: true,
        currentSelectedNodeData: {
          data: { conditions: { filterType: "group", conditions: [] } },
          type: "condition",
        },
      });
      await flushPromises();
      const b = wrapper.findComponent(ConditionBuilderStub);
      expect(b.props("initialConditions")).toEqual({ filterType: "group", conditions: [] });
      expect(b.props("normalizeOperators")).toBe(true);
    });

    it("passes null initialConditions when not editing", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.findComponent(ConditionBuilderStub).props("initialConditions")).toBeNull();
    });
  });

  describe("Save", () => {
    it("adds a condition node with the builder payload + node_type", async () => {
      mockCondPayload = () => ({ version: 2, conditions: [{ column: "level", operator: "=" }] });
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(mockAddNode).toHaveBeenCalledWith({
        node_type: "condition",
        version: 2,
        conditions: [{ column: "level", operator: "=" }],
      });
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("does nothing when the builder returns null", async () => {
      mockCondPayload = () => null;
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-primary-btn"]').trigger("click");
      expect(mockAddNode).not.toHaveBeenCalled();
      expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
    });
  });

  describe("Cancel", () => {
    it("closes without a dialog when the rule is unchanged", async () => {
      vi.useFakeTimers();
      const wrapper = createWrapper();
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-secondary-btn"]').trigger("click");
      expect(wrapper.vm.dialog.show).toBe(false);
      vi.runAllTimers();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
      vi.useRealTimers();
    });

    it("shows a discard dialog when the rule changed", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // mutate the builder's group so it differs from the mount snapshot
      wrapper.findComponent(ConditionBuilderStub).vm.conditionGroup = {
        filterType: "group",
        conditions: [{ column: "x", operator: "=" }],
      };
      await wrapper.find('[data-test="o-drawer-secondary-btn"]').trigger("click");
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });
  });

  describe("Delete", () => {
    it("shows the delete control only in edit mode", async () => {
      const view = createWrapper({ isEditNode: false });
      await flushPromises();
      expect(view.find('[data-test="o-drawer-neutral-btn"]').exists()).toBe(false);

      const edit = createWrapper({ isEditNode: true });
      await flushPromises();
      expect(edit.find('[data-test="o-drawer-neutral-btn"]').exists()).toBe(true);
    });

    it("deletes the node via the confirm dialog callback", async () => {
      const wrapper = createWrapper({ isEditNode: true });
      await flushPromises();
      await wrapper.find('[data-test="o-drawer-neutral-btn"]').trigger("click");
      wrapper.vm.dialog.okCallback();
      expect(mockDeletePipelineNode).toHaveBeenCalledWith("cond-node-1");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });
});
