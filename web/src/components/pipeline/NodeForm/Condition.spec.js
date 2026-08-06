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

// Condition.vue is CHROME ONLY: the drawer + Save/Cancel/Delete + addNode + the
// pipeline stream-field loading. The condition tree itself (FilterGroup, the
// V0/V1 -> V2 conversion, the zod schema and its validation matrix) is the
// SHARED ConditionBuilder — covered in
// components/flow/forms/ConditionBuilder.spec.ts, which the workflow Condition
// node exercises through the very same component. Here we drive the builder via
// a stub and assert only this drawer's own responsibilities.

import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, it, expect, vi, beforeEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import Condition from "./Condition.vue";
import useDnD from "@/plugins/pipelines/useDnD";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [{ name: "level", type: "Utf8" }],
      settings: {},
    }),
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
  }),
}));

// Builder stub: submit() resolves whatever the test queues, and conditionGroup
// backs the drawer's discard-changes comparison.
let builderPayload = null;
// reactive so the stub's computed re-evaluates when a test mutates it
const builderGroup = ref({ filterType: "group", conditions: [] });

const ConditionBuilderStub = {
  name: "ConditionBuilder",
  props: ["fields", "initialConditions", "module", "allowCustomColumns", "normalizeOperators"],
  template: '<div class="condition-builder-stub"><slot name="guidelines" /></div>',
  computed: {
    conditionGroup: () => builderGroup.value,
  },
  methods: {
    submit: () => Promise.resolve(builderPayload),
  },
};

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "title",
    "width",
    "showClose",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "neutralButtonVariant",
    "secondaryButtonVariant",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div class="o-drawer-stub">
      <slot />
      <button v-if="primaryButtonLabel" data-test="save-btn" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button v-if="secondaryButtonLabel" data-test="cancel-btn" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button v-if="neutralButtonLabel" data-test="delete-btn" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
    </div>
  `,
};

function createWrapper(pipelineObjOverrides = {}) {
  const mockPipelineObj = {
    currentSelectedNodeData: { data: {}, type: "condition" },
    currentSelectedNodeID: "node-123",
    currentSelectedPipeline: { nodes: [] },
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

  return mount(Condition, {
    props: { open: true },
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

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Condition.vue (drawer chrome)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    builderGroup.value = { filterType: "group", conditions: [] };
    builderPayload = {
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [{ column: "level", operator: "=", value: "error" }],
      },
    };
  });

  it("mounts and renders the shared ConditionBuilder as its body", () => {
    const wrapper = createWrapper();
    expect(wrapper.find(".condition-builder-stub").exists()).toBe(true);
  });

  it("hands the saved rule to the builder when editing", () => {
    const saved = { filterType: "group", conditions: [] };
    const wrapper = createWrapper({
      isEditNode: true,
      currentSelectedNodeData: { data: { conditions: saved } },
    });
    expect(wrapper.findComponent({ name: "ConditionBuilder" }).props("initialConditions")).toEqual(
      saved,
    );
  });

  it("renders the pipeline guidelines into the builder's slot", () => {
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain("If conditions are not met");
  });

  // ── Save ────────────────────────────────────────────────────────────────
  it("adds the node with the correct payload on save", async () => {
    const wrapper = createWrapper();
    await wrapper.find('[data-test="save-btn"]').trigger("click");
    await tick();

    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_type: "condition",
        version: 2,
        conditions: builderPayload.conditions,
      }),
    );
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });

  it("does NOT add a node when the builder blocks the save (invalid rule)", async () => {
    builderPayload = null; // schema rejected it; the builder shows the error inline
    const wrapper = createWrapper();
    await wrapper.find('[data-test="save-btn"]').trigger("click");
    await tick();

    expect(mockAddNode).not.toHaveBeenCalled();
    expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
  });

  // ── Buttons ─────────────────────────────────────────────────────────────
  it("always renders save and cancel", () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="save-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cancel-btn"]').exists()).toBe(true);
  });

  it("shows delete only when editing a node", () => {
    expect(createWrapper({ isEditNode: false }).find('[data-test="delete-btn"]').exists()).toBe(
      false,
    );
    expect(createWrapper({ isEditNode: true }).find('[data-test="delete-btn"]').exists()).toBe(
      true,
    );
  });

  // ── Cancel (discard-changes prompt) ─────────────────────────────────────
  it("closes straight away when the rule is unchanged", async () => {
    const wrapper = createWrapper();
    await tick(); // let the mount snapshot settle
    await wrapper.find('[data-test="cancel-btn"]').trigger("click");
    expect(wrapper.vm.dialog.show).toBe(false);
  });

  it("prompts to discard when the rule was edited", async () => {
    const wrapper = createWrapper();
    await tick();
    builderGroup.value = { filterType: "group", conditions: [{ column: "changed" }] };
    await wrapper.find('[data-test="cancel-btn"]').trigger("click");
    expect(wrapper.vm.dialog.show).toBe(true);
    expect(wrapper.vm.dialog.title).toBe("Discard Changes");
  });

  it("clears the selected/clicked node when closing", () => {
    const wrapper = createWrapper();
    wrapper.vm.closeDialog();
    expect(wrapper.vm.pipelineObj.userSelectedNode).toEqual({});
    expect(wrapper.vm.pipelineObj.userClickedNode).toEqual({});
  });

  // ── Delete ──────────────────────────────────────────────────────────────
  it("opens the delete confirmation with the expected copy", async () => {
    const wrapper = createWrapper({ isEditNode: true });
    await wrapper.find('[data-test="delete-btn"]').trigger("click");
    expect(wrapper.vm.dialog.show).toBe(true);
    expect(wrapper.vm.dialog.title).toBe("Delete Node");
    expect(typeof wrapper.vm.dialog.okCallback).toBe("function");
  });

  it("deletes the node when the deletion is confirmed", () => {
    const wrapper = createWrapper({ isEditNode: true });
    wrapper.vm.deleteRoute();
    expect(mockDeletePipelineNode).toHaveBeenCalledWith("node-123");
  });
});
