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

// The editor shell: toolbar + docked palette + canvas + drawers. It owns
// create-vs-edit bootstrap, validation, payload serialization, save, Test and the
// run-history wiring. The canvas / node forms / drawers are stubbed — the real
// useWorkflowCanvas singleton (workflowObj) is kept, since that IS the contract.

import { vi } from "vitest";

const { mockRouter, mockToast, uuidState } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    currentRoute: { value: { query: {} as Record<string, any> } },
  },
  mockToast: vi.fn(),
  uuidState: { n: 0 },
}));

vi.mock("vue-router", () => ({ useRouter: () => mockRouter }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => `mock-${p}`,
  getUUID: () => `uuid-${++uuidState.n}`,
}));

vi.mock("@vue-flow/core", () => ({
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  useVueFlow: () => ({
    screenToFlowCoordinate: vi.fn((p: any) => p),
    onNodesInitialized: vi.fn(),
    updateNode: vi.fn(),
  }),
}));

vi.mock("@/services/workflows", () => ({
  default: {
    listWorkflows: vi.fn(),
    createWorkflow: vi.fn(),
    updateWorkflow: vi.fn(),
    getWorkflowRun: vi.fn(),
    testWorkflow: vi.fn(),
  },
}));

const { stub } = vi.hoisted(() => ({
  stub: (name: string, opts: any = {}) => ({
    default: { name, template: `<div data-test="${name}" />`, ...opts },
  }),
}));

vi.mock("@/plugins/workflows/WorkflowCanvas.vue", () => stub("WorkflowCanvas"));
vi.mock("./WorkflowNodeDrawer.vue", () => stub("WorkflowNodeDrawer"));
vi.mock("./WorkflowTestDialog.vue", () => stub("WorkflowTestDialog"));
vi.mock("./WorkflowStepResultDrawer.vue", () => stub("WorkflowStepResultDrawer"));
vi.mock("./WorkflowLinkAlertsDialog.vue", () =>
  stub("WorkflowLinkAlertsDialog", {
    props: ["workflowId", "workflowName"],
    emits: ["linked", "close"],
  }),
);
vi.mock("@/components/flow/StepPickerDialog.vue", () =>
  stub("StepPickerDialog", {
    props: ["items", "title", "searchPlaceholder", "noMatchText", "testPrefix"],
    emits: ["pick", "close"],
  }),
);
vi.mock("@/components/flow/NodePalette.vue", () =>
  stub("NodePalette", {
    props: ["items", "title", "testPrefix", "onDragStart", "onItemClick"],
  }),
);

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowEditor from "./WorkflowEditor.vue";
import workflowService from "@/services/workflows";
import useWorkflowCanvas, {
  workflowObj,
  hydrateWorkflow,
} from "@/plugins/workflows/useWorkflowCanvas";

const t = (k: string, v?: any) => i18n.global.t(k, v ?? {});
const listWorkflows = workflowService.listWorkflows as any;
const createWorkflow = workflowService.createWorkflow as any;
const updateWorkflow = workflowService.updateWorkflow as any;
const getWorkflowRun = workflowService.getWorkflowRun as any;

const { resetWorkflowData } = useWorkflowCanvas();

// ── stubs ────────────────────────────────────────────────────────────────────

const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message", "okLabel"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: '<div class="confirm-dialog" :data-title="title" :data-open="String(modelValue)" />',
};

const globalStubs = {
  ConfirmDialog: ConfirmDialogStub,
  OPageHeader: {
    name: "OPageHeader",
    props: ["title", "back"],
    template:
      '<div class="app-page-header" :data-title="title">' +
      '<button class="header-back" @click="back && back.onClick()" />' +
      '<slot name="title-trail" /><slot name="actions" /></div>',
  },
  OButton: {
    name: "OButton",
    props: ["variant", "size", "loading", "disabled"],
    emits: ["click"],
    template:
      '<button class="o-button" v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
  OInput: {
    name: "OInput",
    props: ["modelValue", "placeholder", "error"],
    emits: ["update:modelValue"],
    template:
      '<input class="o-input" v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
};

const mountEditor = () =>
  mount(WorkflowEditor, {
    global: { plugins: [i18n, store], stubs: globalStubs },
  });

// ── helpers ──────────────────────────────────────────────────────────────────

const wf = () => workflowObj.currentSelectedWorkflow;

// The editor no longer pre-places a trigger — the canvas starts empty and the
// start node opens the trigger picker. Tests that need an existing trigger to
// build on place one directly, which is what committing the picker produces.
const placeTrigger = (id = "t1") => {
  wf().nodes = [
    {
      id,
      type: "input",
      position: { x: 320, y: 80 },
      data: {
        label: id,
        node_type: "workflow_trigger",
        trigger_kind: "alert_fired",
        alert_ids: [],
      },
    },
  ];
  return id;
};
const dialogByTitle = (w: any, title: string) =>
  w
    .findAllComponents(ConfirmDialogStub)
    .find((d: any) => d.props("title") === title)!;
const saveTestDialog = (w: any) => dialogByTitle(w, t("workflow.test.saveToTestTitle"));
const deleteDialog = (w: any) => dialogByTitle(w, t("workflow.deleteNodeTitle"));
const palette = (w: any) => w.findComponent({ name: "NodePalette" });

// The rail starts COLLAPSED and `resetWorkflowData()` (run on editor mount)
// re-closes it, so it must be opened AFTER bootstrapping — same as the user
// clicking the toggle in the canvas control stack.
const openRail = async (w: any) => {
  workflowObj.showNodePalette = true;
  await nextTick();
  return w;
};
const linkDialog = (w: any) => w.findComponent({ name: "WorkflowLinkAlertsDialog" });

const clickSave = async (w: any) => {
  await w.find('[data-test="workflow-editor-save"]').trigger("click");
  await flushPromises();
};

// A saved, valid graph: trigger -> destination.
const savedGraph = (overrides: any = {}) => ({
  id: "wf-1",
  name: "my workflow",
  description: "desc",
  enabled: true,
  created_at: 111,
  updated_at: 222,
  nodes: [
    {
      id: "t1",
      io_type: "input",
      position: { x: 320, y: 80 },
      data: { label: "t1", node_type: "workflow_trigger", alert_ids: ["a1"] },
      meta: { trigger_kind: "alert_fired" },
    },
    {
      id: "d1",
      io_type: "output",
      position: { x: 320, y: 240 },
      data: { label: "d1", node_type: "destination", destination_id: "sink" },
    },
  ],
  edges: [{ id: "e1", source: "t1", target: "d1" }],
  ...overrides,
});

describe("WorkflowEditor", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidState.n = 0;
    resetWorkflowData();
    mockRouter.currentRoute.value = { query: {} };
    listWorkflows.mockResolvedValue({ data: [] });
    createWorkflow.mockResolvedValue({ data: { id: "new-id" } });
    updateWorkflow.mockResolvedValue({ data: {} });
    getWorkflowRun.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    resetWorkflowData();
  });

  // ── create bootstrap ───────────────────────────────────────────────────────

  describe("create mode", () => {
    it("starts on an EMPTY canvas (the start node opens the trigger picker)", async () => {
      wrapper = mountEditor();
      await flushPromises();

      expect(wf().nodes).toHaveLength(0);
      expect(workflowObj.isEditWorkflow).toBe(false);
      // Nothing is staged, so no drawer pops open on arrival.
      expect(workflowObj.dialog.show).toBe(false);
    });

    it("adds the picked trigger to the canvas and opens its panel", async () => {
      wrapper = mountEditor();
      await flushPromises();

      workflowObj.stepPicker = {
        show: true,
        source: "",
        handle: "out",
        mode: "trigger",
        position: { x: 100, y: 40 },
        anchor: { x: 10, y: 10 },
      };
      await nextTick();
      wrapper
        .findComponent({ name: "StepPickerDialog" })
        .vm.$emit("pick", { key: "workflow_trigger", trigger_kind: "alert_fired" });
      await nextTick();

      // Committed straight onto the canvas — the trigger panel is read-only and
      // has no Save, so a staged node could never be committed.
      expect(wf().nodes).toHaveLength(1);
      expect(wf().nodes[0]).toMatchObject({
        type: "input",
        position: { x: 100, y: 40 },
        data: { node_type: "workflow_trigger", trigger_kind: "alert_fired", alert_ids: [] },
      });
      // ...and its panel opens in EDIT mode, so closing it keeps the node.
      expect(workflowObj.isEditNode).toBe(true);
      expect(workflowObj.dialog.show).toBe(true);
      expect(workflowObj.stepPicker.show).toBe(false);
    });

    it("never auto-opens the config drawer, even with a ?trigger query", async () => {
      // The list used to pass ?trigger=alert_fired on every create, which
      // staged a trigger and popped its drawer before the user chose anything.
      mockRouter.currentRoute.value = { query: { trigger: "alert_fired" } };
      wrapper = mountEditor();
      await flushPromises();
      expect(wf().nodes).toHaveLength(0);
      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedNodeData).toBeNull();
    });

    it("does not fetch anything on create", async () => {
      wrapper = mountEditor();
      await flushPromises();
      expect(listWorkflows).not.toHaveBeenCalled();
    });

    it("renders the editable name and description inputs", async () => {
      wrapper = mountEditor();
      await flushPromises();
      expect(wrapper.find('[data-test="workflow-editor-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-editor-description"]').exists()).toBe(true);
    });

    it("hides the History action for an unsaved workflow", async () => {
      wrapper = mountEditor();
      await flushPromises();
      expect(wrapper.find('[data-test="workflow-editor-history"]').exists()).toBe(false);
    });

    it("binds the name input and clears the name error as the user types", async () => {
      wrapper = mountEditor();
      await flushPromises();
      workflowObj.nameError = true;

      await wrapper.find('[data-test="workflow-editor-name"]').setValue("wf-a");

      expect(wf().name).toBe("wf-a");
      expect(workflowObj.nameError).toBe(false);
    });

    it("binds the description input", async () => {
      wrapper = mountEditor();
      await flushPromises();
      await wrapper.find('[data-test="workflow-editor-description"]').setValue("d");
      expect(wf().description).toBe("d");
    });
  });

  // ── edit bootstrap ─────────────────────────────────────────────────────────

  describe("edit mode", () => {
    it("skips the fetch when the row was already hydrated from the list", async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(listWorkflows).not.toHaveBeenCalled();
      expect(wf().name).toBe("my workflow");
    });

    it("cold-loads the workflow via the list endpoint on a deep link", async () => {
      listWorkflows.mockResolvedValue({ data: [savedGraph()] });
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(listWorkflows).toHaveBeenCalledWith("default");
      expect(workflowObj.isEditWorkflow).toBe(true);
      expect(wf().name).toBe("my workflow");
      // hydrate derives the VueFlow render template from node_type
      expect(wf().nodes.map((n: any) => n.type)).toEqual(["input", "output"]);
    });

    it("accepts a { list: [...] } envelope from the list endpoint", async () => {
      listWorkflows.mockResolvedValue({ data: { list: [savedGraph()] } });
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(wf().id).toBe("wf-1");
    });

    it("toasts when the id is not in the list", async () => {
      listWorkflows.mockResolvedValue({ data: [savedGraph({ id: "other" })] });
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.loadError"),
        variant: "error",
      });
    });

    it("toasts when the list response has no body", async () => {
      listWorkflows.mockResolvedValue({});
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.loadError"),
        variant: "error",
      });
    });

    it("toasts when the list endpoint fails", async () => {
      listWorkflows.mockRejectedValue(new Error("boom"));
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.loadError"),
        variant: "error",
      });
    });

    it("shows the workflow name as the header title and hides the name input", async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(wrapper.find(".app-page-header").attributes("data-title")).toBe(
        "my workflow",
      );
      expect(wrapper.find('[data-test="workflow-editor-name"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-editor-history"]').exists()).toBe(true);
    });

    it("falls back to the module title when the saved workflow has no name", async () => {
      hydrateWorkflow(savedGraph({ name: "" }));
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };

      wrapper = mountEditor();
      await flushPromises();

      expect(wrapper.find(".app-page-header").attributes("data-title")).toBe(
        t("workflow.header"),
      );
    });
  });

  // ── palette ────────────────────────────────────────────────────────────────

  describe("node palette", () => {
    it("groups the addable node types under Transform / Destination headers", async () => {
      wrapper = mountEditor();
      await flushPromises();
      await openRail(wrapper);

      const items = palette(wrapper).props("items") as any[];
      expect(items.map((i) => i.label)).toEqual([
        t("workflow.node.sectionTransform"),
        t("workflow.node.condition"),
        t("workflow.node.function"),
        t("workflow.node.sectionDestination"),
        t("workflow.node.sendToDestination"),
      ]);
      expect(items[0].isSectionHeader).toBe(true);
      expect(items[3].isSectionHeader).toBe(true);
      expect(items[1]).toMatchObject({ subtype: "condition", io_type: "default" });
      expect(items[4]).toMatchObject({ subtype: "destination", io_type: "output" });
      // node glyphs reuse the pipeline images
      expect(items[1].icon.startsWith("img:")).toBe(true);
    });

    it("appends a node to the end of the chain on palette click", async () => {
      wrapper = mountEditor();
      await flushPromises();
      await openRail(wrapper);
      const triggerId = placeTrigger();

      palette(wrapper).props("onItemClick")({ subtype: "condition" });
      await nextTick();

      expect(workflowObj.dialog.name).toBe("condition");
      expect(workflowObj.dialog.show).toBe(true);
      expect(workflowObj.pendingEdge).toEqual({
        source: triggerId,
        sourceHandle: undefined,
      });
    });

    it("records the dragged node type on palette drag start", async () => {
      wrapper = mountEditor();
      await flushPromises();
      await openRail(wrapper);

      const event: any = { dataTransfer: { setData: vi.fn(), effectAllowed: "" } };
      palette(wrapper).props("onDragStart")(event, { subtype: "function" });

      expect(event.dataTransfer.setData).toHaveBeenCalledWith(
        "application/vueflow",
        "function",
      );
      expect(workflowObj.draggedNodeType).toBe("function");
    });
  });

  // ── step picker ────────────────────────────────────────────────────────────

  describe("step picker", () => {
    it("is hidden until the hover-+ opens it", async () => {
      wrapper = mountEditor();
      await flushPromises();
      expect(wrapper.findComponent({ name: "StepPickerDialog" }).exists()).toBe(false);
    });

    it("lists every addable step type", async () => {
      wrapper = mountEditor();
      await flushPromises();
      const src = placeTrigger();
      workflowObj.stepPicker = { show: true, source: src, handle: "out", mode: "next", position: null, anchor: null };
      await nextTick();

      const items = wrapper.findComponent({ name: "StepPickerDialog" }).props("items") as any[];
      expect(items.map((i) => i.key)).toEqual(["condition", "function", "destination"]);
      expect(items[0].title).toBe(t("workflow.node.condition"));
      expect(items[0].description).toBe(t("workflow.node.conditionDesc"));
      // action-category steps get the success tint, logic ones the warning tint
      expect(items[2].iconTint).toContain("badge-success-soft");
      expect(items[0].iconTint).toContain("badge-warning-soft");
    });

    it("stages the picked step after the source node and closes the picker", async () => {
      wrapper = mountEditor();
      await flushPromises();
      const triggerId = placeTrigger();
      workflowObj.stepPicker = { show: true, source: triggerId, handle: "out", mode: "next", position: null, anchor: null };
      await nextTick();

      wrapper.findComponent({ name: "StepPickerDialog" }).vm.$emit("pick", { key: "function" });
      await nextTick();

      expect(workflowObj.stepPicker.show).toBe(false);
      expect(workflowObj.dialog.name).toBe("function");
      expect(workflowObj.pendingEdge).toEqual({
        source: triggerId,
        sourceHandle: undefined,
      });
    });

    it("closes the picker on close", async () => {
      wrapper = mountEditor();
      await flushPromises();
      workflowObj.stepPicker = { show: true, source: "x", handle: "out", mode: "next", position: null, anchor: null };
      await nextTick();

      wrapper.findComponent({ name: "StepPickerDialog" }).vm.$emit("close");
      await nextTick();

      expect(workflowObj.stepPicker).toEqual({ show: false, source: "", handle: "out", mode: "next", position: null, anchor: null });
    });
  });

  // ── validation ─────────────────────────────────────────────────────────────

  describe("save validation", () => {
    it("blocks the save and flags the name when it is blank", async () => {
      wrapper = mountEditor();
      await flushPromises();

      await clickSave(wrapper);

      expect(workflowObj.nameError).toBe(true);
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.nameRequired"),
        variant: "warning",
      });
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("treats a whitespace-only name as blank", async () => {
      wrapper = mountEditor();
      await flushPromises();
      wf().name = "   ";

      await clickSave(wrapper);

      expect(workflowObj.nameError).toBe(true);
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("requires a trigger node", async () => {
      wrapper = mountEditor();
      await flushPromises();
      wf().name = "wf";
      wf().nodes = [
        { id: "c1", type: "default", position: { x: 0, y: 0 }, data: { node_type: "condition" } },
        { id: "d1", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
      ];

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.triggerRequired"),
        variant: "warning",
      });
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("requires at least one step after the trigger", async () => {
      wrapper = mountEditor();
      await flushPromises();
      placeTrigger();
      wf().name = "wf";

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.addStepRequired"),
        variant: "warning",
      });
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("blocks the save when a node is left unconnected", async () => {
      wrapper = mountEditor();
      await flushPromises();
      placeTrigger();
      wf().name = "wf";
      wf().nodes = [
        ...wf().nodes,
        { id: "orphan", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
      ];

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.connectAllNodes"),
        variant: "warning",
      });
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("treats a missing name as blank", async () => {
      wrapper = mountEditor();
      await flushPromises();
      wf().name = undefined;

      await clickSave(wrapper);

      expect(workflowObj.nameError).toBe(true);
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("treats a workflow with no nodes array as having no trigger", async () => {
      wrapper = mountEditor();
      await flushPromises();
      wf().name = "wf";
      wf().nodes = undefined;

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.triggerRequired"),
        variant: "warning",
      });
    });

    it("treats a workflow with no edges array as fully unconnected", async () => {
      wrapper = mountEditor();
      await flushPromises();
      placeTrigger();
      wf().name = "wf";
      wf().nodes = [
        ...wf().nodes,
        { id: "d1", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
      ];
      wf().edges = undefined;

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.connectAllNodes"),
        variant: "warning",
      });
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("passes validation once every non-trigger node has an incoming edge", async () => {
      wrapper = mountEditor();
      await flushPromises();
      const triggerId = placeTrigger();
      wf().name = "wf";
      wf().nodes = [
        ...wf().nodes,
        { id: "d1", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
      ];
      wf().edges = [{ id: "e1", source: triggerId, target: "d1" }];

      await clickSave(wrapper);

      expect(createWorkflow).toHaveBeenCalled();
    });
  });

  // ── serialization + create ─────────────────────────────────────────────────

  describe("create (save)", () => {
    const seedValidCreate = () => {
      const triggerId = placeTrigger();
      wf().name = "  my workflow  ";
      wf().description = "desc";
      wf().nodes = [
        {
          ...wf().nodes[0],
          // VueFlow runtime state that must NOT be serialized
          dimensions: { width: 10, height: 10 },
          computedPosition: { x: 1, y: 1 },
          selected: true,
          dragging: false,
        },
        {
          id: "d1",
          type: "output",
          position: { x: 5, y: 6 },
          style: { width: "200px" },
          meta: { custom: "keep" },
          data: { label: "d1", node_type: "destination", destination_id: "sink" },
          handleBounds: {},
        },
      ];
      wf().edges = [{ id: "e1", source: triggerId, target: "d1" }];
      return triggerId;
    };

    it("posts a fully-populated payload with serialized nodes", async () => {
      wrapper = mountEditor();
      await flushPromises();
      const triggerId = seedValidCreate();

      await clickSave(wrapper);

      expect(createWorkflow).toHaveBeenCalledTimes(1);
      const { org_identifier, data } = createWorkflow.mock.calls[0][0];
      expect(org_identifier).toBe("default");
      expect(data).toMatchObject({
        id: "",
        org_id: "",
        name: "my workflow", // trimmed
        description: "desc",
        enabled: true,
        created_at: 0,
        updated_at: 0,
        created_by: "",
      });
      expect(data.edges).toEqual([{ id: "e1", source: triggerId, target: "d1" }]);

      const [trigger, destination] = data.nodes;
      // trigger: io_type from the VueFlow type, kind carried in meta
      expect(trigger).toEqual({
        id: triggerId,
        io_type: "input",
        position: { x: 320, y: 80 },
        data: {
          label: triggerId,
          node_type: "workflow_trigger",
          trigger_kind: "alert_fired",
          alert_ids: [],
        },
        meta: { trigger_kind: "alert_fired" },
      });
      // runtime-only VueFlow fields are dropped
      expect(trigger).not.toHaveProperty("dimensions");
      expect(trigger).not.toHaveProperty("selected");
      expect(trigger).not.toHaveProperty("computedPosition");

      // destination: keeps its own meta + style, no injected trigger_kind
      expect(destination).toEqual({
        id: "d1",
        io_type: "output",
        position: { x: 5, y: 6 },
        data: { label: "d1", node_type: "destination", destination_id: "sink" },
        meta: { custom: "keep" },
        style: { width: "200px" },
      });
    });

    it("defaults io_type, position and the trigger kind when they are missing", async () => {
      wrapper = mountEditor();
      await flushPromises();
      const triggerId = placeTrigger();
      wf().name = "wf";
      wf().nodes = [
        // no `type`, no `position`, no trigger_kind
        { id: triggerId, data: { node_type: "workflow_trigger" } },
        { id: "d1", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
      ];
      wf().edges = [{ id: "e1", source: triggerId, target: "d1" }];

      await clickSave(wrapper);

      const node = createWorkflow.mock.calls[0][0].data.nodes[0];
      expect(node.io_type).toBe("default");
      expect(node.position).toEqual({ x: 0, y: 0 });
      expect(node.meta).toEqual({ trigger_kind: "alert_fired" });
    });

    it("serializes a node that carries no data or meta at all", async () => {
      wrapper = mountEditor();
      await flushPromises();
      const triggerId = placeTrigger();
      wf().name = "wf";
      wf().nodes = [...wf().nodes, { id: "bare" }];
      wf().edges = [{ id: "e1", source: triggerId, target: "bare" }];

      await clickSave(wrapper);

      const bare = createWorkflow.mock.calls[0][0].data.nodes[1];
      expect(bare).toEqual({
        id: "bare",
        io_type: "default",
        position: { x: 0, y: 0 },
        data: {},
      });
      expect(bare).not.toHaveProperty("meta");
      expect(bare).not.toHaveProperty("style");
    });

    it("defaults enabled to true when the workflow has no enabled flag", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();
      wf().enabled = undefined;

      await clickSave(wrapper);

      expect(createWorkflow.mock.calls[0][0].data.enabled).toBe(true);
    });

    it("captures the new id, flips to edit mode, toasts and emits saved", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();

      await clickSave(wrapper);

      expect(wf().id).toBe("new-id");
      expect(workflowObj.isEditWorkflow).toBe(true);
      expect(workflowObj.dirtyFlag).toBe(false);
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.createSuccess"),
        variant: "success",
      });
      expect(wrapper.emitted("saved")).toHaveLength(1);
    });

    it("offers to link alerts after a create instead of navigating away", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();

      await clickSave(wrapper);

      expect(linkDialog(wrapper).exists()).toBe(true);
      // NOTE: current behaviour — only the PAYLOAD name is trimmed, the in-memory
      // name (and so the prompt's title) keeps the raw user input.
      expect(linkDialog(wrapper).props()).toMatchObject({
        workflowId: "new-id",
        workflowName: "  my workflow  ",
      });
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it("skips the link-alerts prompt for a non-alert trigger and navigates away", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();
      // Swap the trigger kind to one that doesn't associate with alerts.
      wf().nodes[0].data.trigger_kind = "incident_event";

      await clickSave(wrapper);

      expect(linkDialog(wrapper).exists()).toBe(false);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
    });

    it("returns to the list once the alerts are linked", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();
      await clickSave(wrapper);

      linkDialog(wrapper).vm.$emit("linked");
      await nextTick();

      expect(linkDialog(wrapper).exists()).toBe(false);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
    });

    it("returns to the list when the link prompt is dismissed", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();
      await clickSave(wrapper);

      linkDialog(wrapper).vm.$emit("close");
      await nextTick();

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
    });

    it("navigates straight back when the create response carries no id", async () => {
      createWorkflow.mockResolvedValue({ data: {} });
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();

      await clickSave(wrapper);

      expect(wf().id).toBe("");
      expect(linkDialog(wrapper).exists()).toBe(false);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
    });

    it("ignores a second Save click while the first is in flight", async () => {
      let resolve: any;
      createWorkflow.mockReturnValue(new Promise((r) => (resolve = r)));
      wrapper = mountEditor();
      await flushPromises();
      seedValidCreate();

      wrapper.find('[data-test="workflow-editor-save"]').trigger("click");
      await nextTick();
      wrapper.find('[data-test="workflow-editor-save"]').trigger("click");
      await nextTick();

      expect(createWorkflow).toHaveBeenCalledTimes(1);

      resolve({ data: { id: "new-id" } });
      await flushPromises();
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe("update (save)", () => {
    const openSaved = async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };
      wrapper = mountEditor();
      await flushPromises();
    };

    it("PUTs the workflow, toasts and returns to the list", async () => {
      await openSaved();

      await clickSave(wrapper);

      expect(updateWorkflow).toHaveBeenCalledTimes(1);
      const call = updateWorkflow.mock.calls[0][0];
      expect(call.org_identifier).toBe("default");
      expect(call.id).toBe("wf-1");
      expect(call.data).toMatchObject({
        id: "wf-1",
        name: "my workflow",
        created_at: 111,
        updated_at: 222,
      });
      expect(createWorkflow).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.updateSuccess"),
        variant: "success",
      });
      expect(wrapper.emitted("saved")).toHaveLength(1);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
      // no link-alerts prompt on update
      expect(linkDialog(wrapper).exists()).toBe(false);
    });

    it("keeps enabled=false from the saved workflow", async () => {
      hydrateWorkflow(savedGraph({ enabled: false }));
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };
      wrapper = mountEditor();
      await flushPromises();

      await clickSave(wrapper);

      expect(updateWorkflow.mock.calls[0][0].data.enabled).toBe(false);
    });

    it("surfaces the API error message and stays on the page", async () => {
      await openSaved();
      updateWorkflow.mockRejectedValue({
        response: { data: { message: "server said no" } },
      });

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: "server said no",
        variant: "error",
      });
      expect(wrapper.emitted("saved")).toBeUndefined();
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it("falls back to the generic save error message", async () => {
      await openSaved();
      updateWorkflow.mockRejectedValue(new Error("network"));

      await clickSave(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.saveError"),
        variant: "error",
      });
    });

    it("re-enables the Save button after a failure", async () => {
      await openSaved();
      updateWorkflow.mockRejectedValue(new Error("network"));

      await clickSave(wrapper);

      expect(
        wrapper.find('[data-test="workflow-editor-save"]').attributes("disabled"),
      ).toBeUndefined();
    });
  });

  // ── cancel / back ──────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("resets the shared state and returns to the list", async () => {
      wrapper = mountEditor();
      await flushPromises();
      wf().name = "dirty";

      await wrapper.find('[data-test="workflow-editor-cancel"]').trigger("click");

      expect(wf().name).toBe("");
      expect(wf().nodes).toEqual([]);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
    });

    it("returns to the list from the header back chevron", async () => {
      wrapper = mountEditor();
      await flushPromises();

      await wrapper.find(".header-back").trigger("click");

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflows",
        query: { org_identifier: "default" },
      });
    });

    it("resets the shared state on unmount", async () => {
      wrapper = mountEditor();
      await flushPromises();
      placeTrigger();
      expect(wf().nodes).toHaveLength(1);

      wrapper.unmount();
      wrapper = null;

      expect(wf().nodes).toEqual([]);
      expect(workflowObj.dialog.show).toBe(false);
    });
  });

  // ── test ───────────────────────────────────────────────────────────────────

  describe("test", () => {
    const clickTest = async (w: any) => {
      await w.find('[data-test="workflow-editor-test"]').trigger("click");
      await flushPromises();
    };

    it("prompts to save first when the workflow has never been saved", async () => {
      wrapper = mountEditor();
      await flushPromises();

      await clickTest(wrapper);

      expect(saveTestDialog(wrapper).props("modelValue")).toBe(true);
      expect(workflowObj.testRun.show).toBe(false);
      expect(wrapper.find('[data-test="WorkflowTestDialog"]').exists()).toBe(false);
    });

    it("prompts to save first when there are unsaved edits", async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };
      wrapper = mountEditor();
      await flushPromises();
      workflowObj.dirtyFlag = true;

      await clickTest(wrapper);

      expect(saveTestDialog(wrapper).props("modelValue")).toBe(true);
      expect(workflowObj.testRun.show).toBe(false);
    });

    it("opens the Test dialog directly for a clean saved workflow", async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };
      wrapper = mountEditor();
      await flushPromises();

      await clickTest(wrapper);

      expect(workflowObj.testRun.show).toBe(true);
      expect(wrapper.find('[data-test="WorkflowTestDialog"]').exists()).toBe(true);
      expect(saveTestDialog(wrapper).props("modelValue")).toBe(false);
    });

    it("saves then opens the Test dialog on Save & Test", async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };
      wrapper = mountEditor();
      await flushPromises();
      workflowObj.dirtyFlag = true;
      await clickTest(wrapper);

      saveTestDialog(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(updateWorkflow).toHaveBeenCalledTimes(1);
      expect(workflowObj.testRun.show).toBe(true);
      expect(saveTestDialog(wrapper).props("modelValue")).toBe(false);
    });

    it("does not open the Test dialog when the Save & Test save fails", async () => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query: { id: "wf-1" } };
      updateWorkflow.mockRejectedValue(new Error("nope"));
      wrapper = mountEditor();
      await flushPromises();
      workflowObj.dirtyFlag = true;
      await clickTest(wrapper);

      saveTestDialog(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(workflowObj.testRun.show).toBe(false);
    });

    it("dismisses the Save & Test prompt on cancel", async () => {
      wrapper = mountEditor();
      await flushPromises();
      await clickTest(wrapper);

      saveTestDialog(wrapper).vm.$emit("update:cancel");
      await nextTick();

      expect(saveTestDialog(wrapper).props("modelValue")).toBe(false);
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it("dismisses the Save & Test prompt when the dialog closes itself (v-model)", async () => {
      wrapper = mountEditor();
      await flushPromises();
      await clickTest(wrapper);

      saveTestDialog(wrapper).vm.$emit("update:modelValue", false);
      await nextTick();

      expect(saveTestDialog(wrapper).props("modelValue")).toBe(false);
    });

    it("renders the per-step result drawer when a node's badge opens it", async () => {
      wrapper = mountEditor();
      await flushPromises();
      expect(wrapper.find('[data-test="WorkflowStepResultDrawer"]').exists()).toBe(false);

      workflowObj.testRun.resultDrawer = { show: true, nodeId: "n1" };
      await nextTick();

      expect(wrapper.find('[data-test="WorkflowStepResultDrawer"]').exists()).toBe(true);
    });
  });

  // ── history ────────────────────────────────────────────────────────────────
  // The editor no longer inspects runs inline — the History button navigates to
  // the dedicated read-only Runs view (a separate surface).

  describe("run history", () => {
    const openSaved = async (query: Record<string, any> = { id: "wf-1" }) => {
      hydrateWorkflow(savedGraph());
      mockRouter.currentRoute.value = { query };
      wrapper = mountEditor();
      await flushPromises();
    };

    it("navigates to the Runs view from the toolbar History button", async () => {
      await openSaved();

      await wrapper.find('[data-test="workflow-editor-history"]').trigger("click");

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflowRuns",
        query: {
          id: "wf-1",
          name: "my workflow",
          org_identifier: "default",
        },
      });
    });

    it("does not load a run on mount even when deep-linked with ?run_id", async () => {
      await openSaved({ id: "wf-1", run_id: "run-7" });
      // Run inspection lives entirely in the Runs view now.
      expect(getWorkflowRun).not.toHaveBeenCalled();
    });
  });

  // ── theme ──────────────────────────────────────────────────────────────────

  describe("theme", () => {
    // The canvas inset used to be `:class="theme === 'dark' ? '' : 'bg-gray-100'"`.
    // That class was DEAD: Tailwind emitted a rule pointing at a "gray"-spelled
    // custom property, but this repo only defines the "grey"-spelled ones (with
    // an "e"), so the light-mode grey never actually rendered — and these tests
    // passed anyway, because they only checked that the class ATTRIBUTE was
    // present. It is now a single token utility with no theme branch, so the
    // surface follows the theme through the token instead of a JS conditional.
    it("uses a token-backed surface on the canvas inset, in BOTH themes", async () => {
      for (const theme of ["light", "dark"]) {
        store.state.theme = theme;
        wrapper = mountEditor();
        await flushPromises();
        expect(
          wrapper.find("#workflow-workspace .bg-surface-subtle").exists(),
        ).toBe(true);
        // No theme-conditional class survives.
        expect(
          wrapper.find("#workflow-workspace .bg-gray-100").exists(),
        ).toBe(false);
        wrapper.unmount();
      }
      store.state.theme = "dark";
    });
  });

  // ── node delete confirm ────────────────────────────────────────────────────

  describe("node delete confirmation", () => {
    const seedTwoNodes = () => {
      const triggerId = placeTrigger();
      wf().nodes = [
        ...wf().nodes,
        { id: "d1", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
      ];
      wf().edges = [{ id: "e1", source: triggerId, target: "d1" }];
    };

    it("deletes the node (and its edges) on confirm", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedTwoNodes();
      workflowObj.deleteConfirm = { show: true, nodeId: "d1" };
      await nextTick();

      expect(deleteDialog(wrapper).props("modelValue")).toBe(true);
      deleteDialog(wrapper).vm.$emit("update:ok");
      await nextTick();

      expect(wf().nodes.map((n: any) => n.id)).not.toContain("d1");
      expect(wf().edges).toEqual([]);
      expect(workflowObj.deleteConfirm).toEqual({ show: false, nodeId: "" });
    });

    it("closes the confirm when the dialog dismisses itself (v-model)", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedTwoNodes();
      workflowObj.deleteConfirm = { show: true, nodeId: "d1" };
      await nextTick();

      deleteDialog(wrapper).vm.$emit("update:modelValue", false);
      await nextTick();

      expect(workflowObj.deleteConfirm.show).toBe(false);
      expect(wf().nodes).toHaveLength(2);
    });

    it("keeps the node on cancel", async () => {
      wrapper = mountEditor();
      await flushPromises();
      seedTwoNodes();
      workflowObj.deleteConfirm = { show: true, nodeId: "d1" };
      await nextTick();

      deleteDialog(wrapper).vm.$emit("update:cancel");
      await nextTick();

      expect(wf().nodes).toHaveLength(2);
      expect(workflowObj.deleteConfirm).toEqual({ show: false, nodeId: "" });
    });
  });
});
