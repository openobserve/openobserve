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

// The node config drawer: a shell whose body switches on workflowObj.dialog.name.
// We keep the real useWorkflowCanvas (module-level workflowObj is the contract the
// drawer drives) and stub the drawer chrome + the four body forms.

import { vi } from "vitest";

vi.mock("@vue-flow/core", () => ({
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  useVueFlow: () => ({
    screenToFlowCoordinate: vi.fn((p: any) => p),
    onNodesInitialized: vi.fn(),
    updateNode: vi.fn(),
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => `mock-${p}`,
  getUUID: () => "uuid-1",
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const { triggerSubmit, conditionSubmit, functionSubmit, destinationSubmit, makeBodyStub } =
  vi.hoisted(() => ({
    triggerSubmit: vi.fn(),
    conditionSubmit: vi.fn(),
    functionSubmit: vi.fn(),
    destinationSubmit: vi.fn(),
    makeBodyStub: (name: string, submit: any, extraData: any = {}) => ({
      default: {
        name,
        template: `<div class="body-stub" data-test="${name}" />`,
        data: () => ({ ...extraData }),
        methods: { submit },
      },
    }),
  }));

vi.mock("@/plugins/workflows/nodes/WorkflowTrigger.vue", () =>
  makeBodyStub("WorkflowTrigger", () => triggerSubmit()),
);
vi.mock("@/plugins/workflows/nodes/WorkflowCondition.vue", () =>
  makeBodyStub("WorkflowCondition", () => conditionSubmit()),
);
vi.mock("@/plugins/workflows/nodes/WorkflowFunction.vue", () =>
  makeBodyStub("WorkflowFunction", () => functionSubmit()),
);
vi.mock("@/plugins/workflows/nodes/WorkflowDestination.vue", () =>
  makeBodyStub("WorkflowDestination", () => destinationSubmit(), {
    createNewDestination: false,
  }),
);

// CodeQueryEditor pulls a heavy Monaco/useLogs chain at import — mock it so the NDV's
// Input/Output panes render a lightweight stand-in.
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: {
    name: "CodeQueryEditor",
    props: ["query", "language", "readOnly", "editorId", "showAutoComplete"],
    template: '<div class="code-editor">{{ query }}</div>',
  },
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowNodeDrawer from "./WorkflowNodeDrawer.vue";
import useWorkflowCanvas, { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

const t = (k: string, v?: any) => i18n.global.t(k, v ?? {});

// The panel container is either ODrawer (create/edit) or ODialog (tested node). Both
// stubs share the same button/emit surface so the shared tests don't care which.
const makeContainerStub = (name: string, cls: string) => ({
  name,
  props: [
    "open",
    "title",
    "width",
    "size",
    "maxHeight",
    "showClose",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div class="${cls}" v-bind="$attrs">
      <div class="drawer-title">{{ title }}</div>
      <button class="btn-primary" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button class="btn-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button class="btn-neutral" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
      <button class="btn-close" @click="$emit('update:open', false)" />
      <button class="btn-open" @click="$emit('update:open', true)" />
      <slot />
    </div>
  `,
});
const ODrawerStub = makeContainerStub("ODrawer", "o-drawer");
const ODialogStub = makeContainerStub("ODialog", "o-dialog");

const mountDrawer = () =>
  mount(WorkflowNodeDrawer, {
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        ODialog: ODialogStub,
        OIcon: { props: ["name", "size"], template: '<i class="o-icon" :data-name="name" />' },
      },
    },
  });

// Whichever container is currently rendered (drawer for edit, dialog when tested).
const drawerProps = (wrapper: any) => {
  const dlg = wrapper.findComponent(ODialogStub);
  return (dlg.exists() ? dlg : wrapper.findComponent(ODrawerStub)).props() as any;
};

// Seed a Test run so the node has input/output data (unlocks the I/O panes).
const seedRun = (id: string, input: any[] = [{ a: 1 }]) => {
  workflowObj.testRun.result = { inputs: { [id]: input }, errors: {} } as any;
};

// A trigger → condition → destination graph for prev/next navigation tests.
const seedGraph = () => {
  workflowObj.currentSelectedWorkflow.nodes = [
    {
      id: "trig",
      type: "input",
      position: { x: 0, y: 0 },
      data: { node_type: "workflow_trigger", trigger_kind: "alert_fired" },
    },
    { id: "cond", type: "default", position: { x: 0, y: 0 }, data: { node_type: "condition" } },
    { id: "dest", type: "output", position: { x: 0, y: 0 }, data: { node_type: "destination" } },
  ] as any;
  workflowObj.currentSelectedWorkflow.edges = [
    { id: "e1", source: "trig", target: "cond" },
    { id: "e2", source: "cond", target: "dest" },
  ] as any;
};
const openNode = (id: string, withRun = true) => {
  const node = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === id);
  workflowObj.currentSelectedNodeData = node;
  workflowObj.currentSelectedNodeID = id;
  workflowObj.isEditNode = true;
  workflowObj.dialog.name = node.data.node_type;
  workflowObj.dialog.show = true;
  if (withRun) seedRun(id);
};

// Stage a node for the drawer to edit / add, exactly as the canvas would.
const stageNode = (nodeType: string, opts: { isEdit?: boolean; id?: string; data?: any } = {}) => {
  const id = opts.id ?? "n-staged";
  const node = {
    id,
    type: "default",
    position: { x: 0, y: 0 },
    data: { label: id, node_type: nodeType, ...(opts.data || {}) },
  };
  if (opts.isEdit) {
    workflowObj.currentSelectedWorkflow.nodes = [node];
    workflowObj.isEditNode = true;
  } else {
    workflowObj.isEditNode = false;
  }
  workflowObj.currentSelectedNodeData = node;
  workflowObj.currentSelectedNodeID = id;
  workflowObj.dialog.name = nodeType;
  workflowObj.dialog.expand = false;
  workflowObj.dialog.show = true;
  return node;
};

describe("WorkflowNodeDrawer", () => {
  let wrapper: any = null;
  const { resetWorkflowData } = useWorkflowCanvas(t);

  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkflowData();
    workflowObj.deleteConfirm = { show: false, nodeId: "" };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  describe("title", () => {
    it("renders the node meta title for a known node type", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).title).toBe(t("workflow.node.condition"));
      expect(wrapper.find(".drawer-title").text()).toBe(t("workflow.node.condition"));
    });

    it("renders the trigger title", () => {
      stageNode("workflow_trigger");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).title).toBe(t("workflow.triggerKind.alertFired.node"));
    });

    it("falls back to the raw dialog name when the node type is unknown", () => {
      stageNode("mystery_node");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).title).toBe("mystery_node");
    });
  });

  describe("body switching", () => {
    it.each([
      ["workflow_trigger", "WorkflowTrigger"],
      ["condition", "WorkflowCondition"],
      ["function", "WorkflowFunction"],
      ["destination", "WorkflowDestination"],
    ])("renders the %s body form", (nodeType, testId) => {
      stageNode(nodeType);
      wrapper = mountDrawer();
      expect(wrapper.find(`[data-test="${testId}"]`).exists()).toBe(true);
      expect(wrapper.findAll(".body-stub")).toHaveLength(1);
    });

    it("renders the coming-soon placeholder for a type with no form", () => {
      stageNode("mystery_node");
      wrapper = mountDrawer();
      expect(wrapper.find(".body-stub").exists()).toBe(false);
      expect(wrapper.text()).toContain(
        t("workflow.node.configComingSoon", { node: "mystery_node" }),
      );
    });

    it("uses the fallback help icon in the placeholder when there is no meta", () => {
      stageNode("mystery_node");
      wrapper = mountDrawer();
      expect(wrapper.find(".o-icon").attributes("data-name")).toBe("help");
    });

    it("pads the body when not expanded and drops padding when expanded", async () => {
      stageNode("function");
      wrapper = mountDrawer();
      expect(wrapper.find(".p-4").exists()).toBe(true);

      workflowObj.dialog.expand = true;
      await nextTick();
      expect(wrapper.find(".p-4").exists()).toBe(false);
      expect(wrapper.find(".h-full.min-h-0").exists()).toBe(true);
    });
  });

  // Container: the side drawer (per-type width) for create/edit, the full-size NDV
  // dialog once the node has run data.
  describe("container: side drawer vs NDV dialog", () => {
    it("uses the side drawer (width 45) for an untested condition", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(wrapper.findComponent(ODrawerStub).exists()).toBe(true);
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(false);
      expect(drawerProps(wrapper).width).toBe(45);
    });

    it("uses a full-width drawer (97) for the untested function editor", () => {
      stageNode("function");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).width).toBe(97);
    });

    it("uses size lg for the untested destination drawer", () => {
      stageNode("destination");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).size).toBe("lg");
    });

    it("opens the trigger in the NDV when a run exists (it ran too)", () => {
      const node = stageNode("workflow_trigger", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
      expect(wrapper.findComponent(ODrawerStub).exists()).toBe(false);
    });

    it("opens the trigger in the side drawer when there is no run", () => {
      stageNode("workflow_trigger", { isEdit: true });
      wrapper = mountDrawer();
      expect(wrapper.findComponent(ODrawerStub).exists()).toBe(true);
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(false);
    });

    it("opens the full-size NDV dialog once the node has run data", () => {
      const node = stageNode("condition", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
      expect(wrapper.findComponent(ODrawerStub).exists()).toBe(false);
      expect(drawerProps(wrapper).size).toBe("full");
    });
  });

  // Input · Config · Output. Config is always present; the I/O panes appear ONLY when
  // the node has Test-run data — no empty panes before a run.
  describe("three-region layout", () => {
    it("shows only Config before a run (no empty I/O panes)", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(false);
    });

    it("shows Input · Config · Output once the node has run data", () => {
      const node = stageNode("condition", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
      // real input data is rendered (not a placeholder)
      expect(wrapper.find('[data-test="workflow-ndv-input"] .code-editor').exists()).toBe(true);
    });

    it("shows the I/O panes for the trigger too when a run exists", () => {
      const node = stageNode("workflow_trigger", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
    });

    it("collapses to Config only while the inline create editor is expanded", async () => {
      const node = stageNode("function", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);

      workflowObj.dialog.expand = true;
      await nextTick();
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
    });
  });

  // No Save/Cancel any more (config commits on CLOSE). The footer holds only Delete
  // for a non-trigger node; it's hidden while an inline "Create New …" editor is open
  // (expand / bodyCreatingNew) and for the read-only trigger.
  describe("footer buttons", () => {
    it("never renders a Save or Cancel button", () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).primaryButtonLabel).toBeUndefined();
      expect(drawerProps(wrapper).secondaryButtonLabel).toBeUndefined();
    });

    it("offers Delete for a non-trigger node (add or edit)", () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).neutralButtonLabel).toBe(t("workflow.deleteNode"));
    });

    it("hides Delete while the drawer is expanded (inline create)", async () => {
      stageNode("function", { isEdit: true });
      wrapper = mountDrawer();
      workflowObj.dialog.expand = true;
      await nextTick();
      expect(drawerProps(wrapper).neutralButtonLabel).toBeUndefined();
    });

    it("never offers Delete for the read-only trigger", () => {
      stageNode("workflow_trigger", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).neutralButtonLabel).toBeUndefined();
    });

    it("hides Delete while the destination body is creating a new destination", async () => {
      stageNode("destination", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).neutralButtonLabel).toBe(t("workflow.deleteNode"));

      wrapper.findComponent({ name: "WorkflowDestination" }).vm.createNewDestination = true;
      await nextTick();

      expect(drawerProps(wrapper).neutralButtonLabel).toBeUndefined();
    });
  });

  // prev/next edge cards — walk between tested nodes without returning to the canvas.
  describe("prev/next navigation (NDV edge cards)", () => {
    it("shows a prev card (upstream) and a next card (downstream) for a tested node", () => {
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-prev"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-next-dest"]').exists()).toBe(true);
    });

    it("shows one next card per outgoing branch (fan-out)", () => {
      seedGraph();
      workflowObj.currentSelectedWorkflow.nodes.push({
        id: "dest2",
        type: "output",
        position: { x: 0, y: 0 },
        data: { node_type: "destination" },
      } as any);
      workflowObj.currentSelectedWorkflow.edges.push({
        id: "e3",
        source: "cond",
        target: "dest2",
      } as any);
      openNode("cond");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-next-dest"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-next-dest2"]').exists()).toBe(true);
    });

    it("navigates to the neighbor on click WITHOUT running the current node's form", async () => {
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      await wrapper.find('[data-test="workflow-ndv-next-dest"]').trigger("click");
      await flushPromises();
      expect(workflowObj.currentSelectedNodeData.id).toBe("dest");
      // pure navigation — the body's submit() is not called
      expect(conditionSubmit).not.toHaveBeenCalled();
    });

    it("stays in the NDV (empty I/O + nav) when navigating to a node that didn't run", async () => {
      seedGraph();
      openNode("cond"); // a run exists; `dest` received no input (didn't run)
      wrapper = mountDrawer();
      await wrapper.find('[data-test="workflow-ndv-next-dest"]').trigger("click");
      await flushPromises();
      expect(workflowObj.currentSelectedNodeData.id).toBe("dest");
      // NOT dropped to a config-only drawer — the panes + prev nav are still there
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-prev"]').exists()).toBe(true);
    });

    it("hides the cards in the config-only side drawer (no run data)", () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-prev"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-ndv-next-dest"]').exists()).toBe(false);
    });
  });

  // Replay lives in the NDV footer (re-run from this node); the config-only side
  // drawer has no run to replay.
  describe("replay (NDV footer)", () => {
    it("offers Replay in the NDV (tested node)", () => {
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).primaryButtonLabel).toBe(t("workflow.test.stepResult.replay"));
    });

    it("has no Replay in the config-only side drawer (untested)", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).primaryButtonLabel).toBeUndefined();
    });
  });

  // The node is already on the canvas (insert-immediately happens in the composable
  // add flow, not here). Closing the drawer merges the body's payload into it.
  describe("commit on close", () => {
    it("merges the body payload into the node on close", async () => {
      stageNode("condition", { isEdit: true });
      conditionSubmit.mockReturnValue({ version: 2, conditions: [{ column: "a" }] });

      wrapper = mountDrawer();
      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(conditionSubmit).toHaveBeenCalled();
      expect(workflowObj.currentSelectedWorkflow.nodes[0].data.conditions).toEqual([
        { column: "a" },
      ]);
      expect(workflowObj.dialog.show).toBe(false);
    });

    it("awaits an async body payload (destination picker resolves a promise)", async () => {
      stageNode("destination", { isEdit: true });
      destinationSubmit.mockResolvedValue({ destination_id: "sink-a" });

      wrapper = mountDrawer();
      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(workflowObj.currentSelectedWorkflow.nodes[0].data.destination_id).toBe("sink-a");
      expect(workflowObj.dialog.show).toBe(false);
    });

    it("closes without merging when the body returns null (inline create still open)", async () => {
      stageNode("condition", { isEdit: true });
      conditionSubmit.mockReturnValue(null);

      wrapper = mountDrawer();
      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedWorkflow.nodes[0].data.conditions).toBeUndefined();
    });

    it("closes without a body submit for a form-less placeholder node type", async () => {
      stageNode("mystery_node", { isEdit: true });
      wrapper = mountDrawer();

      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedWorkflow.nodes[0].data.node_type).toBe("mystery_node");
    });

    it("does NOT dirty the graph when opened and closed with no change", async () => {
      // Saved data already matches what the body re-asserts on close (same shape it
      // was persisted with), so the change-gated commit is a no-op.
      stageNode("condition", { isEdit: true, data: { version: 2, conditions: [{ column: "a" }] } });
      conditionSubmit.mockReturnValue({ version: 2, conditions: [{ column: "a" }] });
      workflowObj.dirtyFlag = false;

      wrapper = mountDrawer();
      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.dirtyFlag).toBe(false);
    });

    it("keeps the node on the canvas after close (no discard)", async () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();

      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(workflowObj.currentSelectedWorkflow.nodes).toHaveLength(1);
      expect(workflowObj.currentSelectedNodeID).toBe("");
    });

    it("ignores update:open=true", async () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();

      await wrapper.find(".btn-open").trigger("click");

      expect(workflowObj.dialog.show).toBe(true);
      expect(workflowObj.currentSelectedNodeData).not.toBeNull();
    });
  });

  describe("delete", () => {
    it("requests a delete confirmation for the selected node", async () => {
      stageNode("condition", { isEdit: true, id: "n-del" });
      wrapper = mountDrawer();

      await wrapper.find(".btn-neutral").trigger("click");

      expect(workflowObj.deleteConfirm).toEqual({
        show: true,
        nodeId: "n-del",
      });
    });

    it("does nothing when no node is selected", async () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      workflowObj.currentSelectedNodeData = null;
      await nextTick();

      await wrapper.find(".btn-neutral").trigger("click");

      expect(workflowObj.deleteConfirm.show).toBe(false);
    });
  });
});
