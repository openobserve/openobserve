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

const { mockRouter } = vi.hoisted(() => ({ mockRouter: { push: vi.fn() } }));
vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ query: {} }),
  onBeforeRouteLeave: () => {},
}));

const {
  triggerSubmit,
  conditionSubmit,
  functionSubmit,
  destinationSubmit,
  functionIsDirty,
  functionDiscard,
  functionSave,
  makeBodyStub,
} = vi.hoisted(() => ({
  triggerSubmit: vi.fn(),
  conditionSubmit: vi.fn(),
  functionSubmit: vi.fn(),
  destinationSubmit: vi.fn(),
  functionIsDirty: vi.fn(() => false),
  functionDiscard: vi.fn(),
  functionSave: vi.fn(),
  makeBodyStub: (name: string, submit: any, extraData: any = {}, extraMethods: any = {}) => ({
    default: {
      name,
      template: `<div class="body-stub" data-test="${name}" />`,
      data: () => ({ ...extraData }),
      methods: { submit, ...extraMethods },
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
  makeBodyStub(
    "WorkflowFunction",
    () => functionSubmit(),
    {},
    {
      isDirty: () => functionIsDirty(),
      discardChanges: () => functionDiscard(),
      saveChanges: () => functionSave(),
    },
  ),
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
      <div class="header-slot"><slot name="header" /></div>
      <button class="btn-primary" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button class="btn-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button class="btn-neutral" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
      <button class="btn-close" @click="$emit('update:open', false)" />
      <button class="btn-open" @click="$emit('update:open', true)" />
      <slot />
      <!-- Rendered LAST so the real footer's markup is assertable without
           shifting any existing first-match selector. -->
      <slot name="footer" />
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

// The delete confirmation is nested INSIDE the NDV (so it stacks above it), and is
// the panel's own state rather than the canvas-level deleteConfirm.
const confirmDialog = (wrapper: any) => wrapper.findComponent({ name: "ConfirmDialog" });

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
      // Scope to the placeholder: the panel's chrome (Steps collapse, prev/next)
      // carries icons of its own, so the FIRST icon on screen is not this one.
      const icon = wrapper.find('[data-test="workflow-ndv-config-placeholder"] .o-icon');
      expect(icon.attributes("data-name")).toBe("help");
    });

    // The known node types own the full three-pane layout and manage their own
    // insets, so the outer padding applies only to a type with no body form.
    it("pads only a non-IO body, and drops padding when expanded", async () => {
      const body = (w: any) => w.find('[data-test="workflow-ndv-body"]');

      stageNode("mystery_node");
      wrapper = mountDrawer();
      expect(body(wrapper).classes()).toContain("p-4");
      wrapper.unmount();

      // The known types own the three-pane layout and manage their own insets.
      stageNode("function");
      wrapper = mountDrawer();
      expect(body(wrapper).classes()).not.toContain("p-4");

      workflowObj.dialog.expand = true;
      await nextTick();
      expect(body(wrapper).classes()).not.toContain("p-4");
    });
  });

  // ONE container for every node, run or not: the NDV dialog. The old per-type side
  // drawer is gone, so a step looks the same whether you are building it or
  // inspecting a run of it.
  describe("container: always the NDV dialog", () => {
    it.each(["condition", "function", "destination", "workflow_trigger"])(
      "uses the NDV dialog for an untested %s (never a side drawer)",
      (nodeType) => {
        stageNode(nodeType, { isEdit: true });
        wrapper = mountDrawer();
        expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
        expect(wrapper.findComponent(ODrawerStub).exists()).toBe(false);
      },
    );

    it("keeps the same container once the node has run data", () => {
      const node = stageNode("condition", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
      expect(wrapper.findComponent(ODrawerStub).exists()).toBe(false);
    });

    // Sized so the dialog centers with margin rather than going edge-to-edge.
    it("is a centered xl dialog at a fixed width, regardless of type or run", () => {
      const node = stageNode("function", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).size).toBe("xl");
      expect(drawerProps(wrapper).width).toBe(95);
    });
  });

  // Input · Config · Output, always — the panel keeps one shape whether or not the
  // node has run, so walking prev/next never changes the layout under the user.
  describe("three-region layout", () => {
    it("shows all three panes before a run (empty, not absent)", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
    });

    it("shows Input · Config · Output once the node has run data", () => {
      // Needs a real upstream step: the Input pane renders records it RECEIVED,
      // so a lone node shows the empty state rather than an editor.
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
      // real input data is rendered (not a placeholder)
      expect(wrapper.find('[data-test="workflow-ndv-input"] .code-editor').exists()).toBe(true);
    });

    // Run Step feeds a per-node test input, so in editor mode the Input pane is ALWAYS
    // an editable editor (seeded with the trigger sample) — even for a deep node that
    // has never run — with a caption marking it as intentional test input.
    it("editor mode shows an editable, seeded test input for a deep node with no run", () => {
      seedGraph();
      openNode("dest", false); // deep node (parent is cond, not the trigger), no run
      wrapper = mountDrawer();
      const input = wrapper.find('[data-test="workflow-ndv-input"]');
      expect(input.find(".code-editor").exists()).toBe(true); // editor, not empty state
      expect(wrapper.find('[data-test="workflow-ndv-input-empty"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-ndv-input-hint"]').exists()).toBe(true);
      // seeded with the trigger's sample event (the base test input), not a bare "[]"
      expect(input.find(".code-editor").text()).not.toBe("[]");
    });

    // The trigger is the one exception: it has no input (its output IS the event),
    // so Config expands into that space and only Config · Output show.
    it("omits the Input pane for the trigger, keeping Config and Output", () => {
      const node = stageNode("workflow_trigger", { isEdit: true });
      seedRun(node.id);
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(false);
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

  // The footer is a real slot now (not container label props): Delete on the left,
  // Prev/Next + Run Step on the right. Config still commits on CLOSE, so there is
  // no Save/Cancel anywhere.
  describe("footer buttons", () => {
    const deleteBtn = (w: any) => w.find('[data-test="workflow-node-delete"]');

    it("never renders a Save or Cancel button", () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).primaryButtonLabel).toBeUndefined();
      expect(drawerProps(wrapper).secondaryButtonLabel).toBeUndefined();
    });

    it("offers Delete for a non-trigger node (add or edit)", () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      expect(deleteBtn(wrapper).exists()).toBe(true);
      expect(deleteBtn(wrapper).text()).toBe(t("workflow.deleteNode"));
    });

    // The function's full-width inline editor owns the panel and carries its own
    // controls, so the whole footer stands down.
    it("hides the footer while the inline editor is expanded", async () => {
      stageNode("function", { isEdit: true });
      wrapper = mountDrawer();
      workflowObj.dialog.expand = true;
      await nextTick();
      expect(deleteBtn(wrapper).exists()).toBe(false);
    });

    it("disables Delete for the read-only trigger", () => {
      stageNode("workflow_trigger", { isEdit: true });
      wrapper = mountDrawer();
      expect(deleteBtn(wrapper).attributes("disabled")).toBeDefined();
    });

    // The inline "Create New Destination" form lives inside the Config pane, and an
    // unfinished one simply saves a dummy node — so the footer stays intact rather
    // than trapping the user in a form with no way out.
    it("keeps Delete available while the destination body creates a new destination", async () => {
      stageNode("destination", { isEdit: true });
      wrapper = mountDrawer();
      expect(deleteBtn(wrapper).attributes("disabled")).toBeUndefined();

      wrapper.findComponent({ name: "WorkflowDestination" }).vm.createNewDestination = true;
      await nextTick();

      expect(deleteBtn(wrapper).exists()).toBe(true);
      expect(deleteBtn(wrapper).attributes("disabled")).toBeUndefined();
    });
  });

  // Prev/Next are footer buttons walking the same tree order as the Steps rail —
  // they replaced the floating per-edge cards, so one control handles fan-out too.
  describe("prev/next navigation", () => {
    const prev = (w: any) => w.find('[data-test="workflow-ndv-prev-step"]');
    const next = (w: any) => w.find('[data-test="workflow-ndv-next-step"]');

    it("offers prev and next for a node with neighbours", () => {
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      expect(prev(wrapper).attributes("disabled")).toBeUndefined();
      expect(next(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("disables prev on the first step", () => {
      seedGraph();
      openNode("trig");
      wrapper = mountDrawer();
      expect(prev(wrapper).attributes("disabled")).toBeDefined();
    });

    it("disables next on the last step", () => {
      seedGraph();
      openNode("dest");
      wrapper = mountDrawer();
      expect(next(wrapper).attributes("disabled")).toBeDefined();
    });

    it("commits the current node's config before navigating (no Save button)", async () => {
      seedGraph();
      openNode("cond");
      conditionSubmit.mockReturnValue({ version: 2, conditions: [{ column: "a" }] });
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await flushPromises();
      expect(workflowObj.currentSelectedNodeID).toBe("dest"); // navigated
      // Navigating is a commit point: the body's submit() ran and its payload was
      // merged into the (now left-behind) node, so the selection isn't dropped.
      expect(conditionSubmit).toHaveBeenCalled();
      const cond = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "cond");
      expect(cond.data.conditions).toEqual([{ column: "a" }]);
    });

    // Layout must not change under the user when they land on a step with no data.
    it("keeps the panes when navigating to a node that did not run", async () => {
      seedGraph();
      openNode("cond"); // a run exists; `dest` received no input
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await flushPromises();
      expect(workflowObj.currentSelectedNodeID).toBe("dest");
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(true);
    });
  });

  // A Function node's editor can hold inline/edited JS not yet saved to the library
  // (raw_fn). Leaving — Prev/Next or close — must prompt Save / Discard / Keep editing
  // (never auto-save, never silently drop edits).
  describe("unsaved-function exit guard (raw_fn)", () => {
    const seedFnGraph = () => {
      workflowObj.currentSelectedWorkflow.nodes = [
        {
          id: "trig",
          type: "input",
          position: { x: 0, y: 0 },
          data: { node_type: "workflow_trigger", trigger_kind: "alert_fired" },
        },
        { id: "fn", type: "default", position: { x: 0, y: 0 }, data: { node_type: "function" } },
        {
          id: "dest",
          type: "output",
          position: { x: 0, y: 0 },
          data: { node_type: "destination" },
        },
      ] as any;
      workflowObj.currentSelectedWorkflow.edges = [
        { id: "e1", source: "trig", target: "fn" },
        { id: "e2", source: "fn", target: "dest" },
      ] as any;
    };
    const unsaved = (w: any) =>
      w
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === t("workflow.node.unsavedFnTitle"));
    const promptOpen = (w: any) => !!unsaved(w)?.props("open");
    const next = (w: any) => w.find('[data-test="workflow-ndv-next-step"]');

    beforeEach(() => functionIsDirty.mockReturnValue(false));

    it("prompts instead of navigating when the editor is dirty", async () => {
      seedFnGraph();
      openNode("fn");
      functionIsDirty.mockReturnValue(true);
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await flushPromises();
      expect(promptOpen(wrapper)).toBe(true);
      expect(workflowObj.currentSelectedNodeID).toBe("fn"); // did NOT navigate
    });

    it("navigates directly when the editor is not dirty (no prompt)", async () => {
      seedFnGraph();
      openNode("fn");
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await flushPromises();
      expect(promptOpen(wrapper)).toBe(false);
      expect(workflowObj.currentSelectedNodeID).toBe("dest");
    });

    it("Discard proceeds with the navigation (and reverts the editor)", async () => {
      seedFnGraph();
      openNode("fn");
      functionIsDirty.mockReturnValue(true);
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await unsaved(wrapper).find(".btn-secondary").trigger("click"); // Discard
      await flushPromises();
      expect(functionDiscard).toHaveBeenCalled();
      expect(workflowObj.currentSelectedNodeID).toBe("dest");
      expect(promptOpen(wrapper)).toBe(false);
    });

    it("Save opens the save flow and stays on the node", async () => {
      seedFnGraph();
      openNode("fn");
      functionIsDirty.mockReturnValue(true);
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await unsaved(wrapper).find(".btn-primary").trigger("click"); // Save
      await flushPromises();
      expect(functionSave).toHaveBeenCalled();
      expect(workflowObj.currentSelectedNodeID).toBe("fn"); // stayed
      expect(promptOpen(wrapper)).toBe(false);
    });

    it("Keep editing closes the prompt and stays", async () => {
      seedFnGraph();
      openNode("fn");
      functionIsDirty.mockReturnValue(true);
      wrapper = mountDrawer();
      await next(wrapper).trigger("click");
      await unsaved(wrapper).find(".btn-neutral").trigger("click"); // Keep editing
      await flushPromises();
      expect(workflowObj.currentSelectedNodeID).toBe("fn");
      expect(promptOpen(wrapper)).toBe(false);
      expect(functionDiscard).not.toHaveBeenCalled();
      expect(functionSave).not.toHaveBeenCalled();
    });

    // Function nodes hide reka's X + block outside/escape (persistent); the custom
    // header X routes through the guard so there's no optimistic close (no flicker).
    it("uses a custom close X + persistent dialog for function nodes", () => {
      seedFnGraph();
      openNode("fn");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-close"]').exists()).toBe(true);
      expect(drawerProps(wrapper).showClose).toBe(false); // reka X hidden
    });

    it("guards the custom close X when dirty (panel stays open)", async () => {
      seedFnGraph();
      openNode("fn");
      functionIsDirty.mockReturnValue(true);
      wrapper = mountDrawer();
      await wrapper.find('[data-test="workflow-ndv-close"]').trigger("click");
      await flushPromises();
      expect(promptOpen(wrapper)).toBe(true);
      expect(workflowObj.dialog.show).toBe(true); // not closed
    });

    it("Discard from a guarded close actually closes the panel", async () => {
      seedFnGraph();
      openNode("fn");
      functionIsDirty.mockReturnValue(true);
      wrapper = mountDrawer();
      await wrapper.find('[data-test="workflow-ndv-close"]').trigger("click");
      await unsaved(wrapper).find(".btn-secondary").trigger("click"); // Discard
      await flushPromises();
      expect(workflowObj.dialog.show).toBe(false); // now closed
    });

    it("closes directly via the custom X when NOT dirty (no prompt)", async () => {
      seedFnGraph();
      openNode("fn");
      wrapper = mountDrawer();
      await wrapper.find('[data-test="workflow-ndv-close"]').trigger("click");
      await flushPromises();
      expect(promptOpen(wrapper)).toBe(false);
      expect(workflowObj.dialog.show).toBe(false);
    });
  });

  // Re-running a step is now "Run Step" in the footer (it executes against the
  // Input pane's records), replacing the old Replay button.
  describe("run step (NDV footer)", () => {
    const runBtn = (w: any) => w.find('[data-test="workflow-node-execute"]');

    it("offers Run Step for a node in the editor", () => {
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      expect(runBtn(wrapper).exists()).toBe(true);
      expect(runBtn(wrapper).text()).toBe(t("workflow.ndv.executeStep"));
    });

    it("offers Run Step even before the node has run", () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      expect(runBtn(wrapper).exists()).toBe(true);
    });
  });

  // Running a single step records only THAT node's output; the next node never ran,
  // so its own recorded input is empty. Its Input then falls back to the parent's
  // recorded output, so a step's result flows straight into the child's Input pane.
  describe("parent output feeds the child Input", () => {
    const inputEditor = (w: any) =>
      w.find('[data-test="workflow-ndv-input"]').findComponent({ name: "CodeQueryEditor" });

    it("seeds a child's Input from its parent's output when the child hasn't run", () => {
      seedGraph();
      workflowObj.testRun.result = {
        outputs: { cond: [{ meta: {}, data: [{ propagated: 1 }] }] },
        inputs: {},
        errors: {},
      } as any;
      openNode("dest", false); // parent = cond; dest itself never ran
      wrapper = mountDrawer();
      expect(inputEditor(wrapper).props("query")).toContain("propagated");
    });

    it("keeps a real empty input (child ran, 0 records) instead of the parent output", () => {
      seedGraph();
      workflowObj.testRun.result = {
        outputs: { cond: [{ meta: {}, data: [{ propagated: 1 }] }] },
        inputs: { dest: [] }, // dest ran and received nothing
        errors: {},
      } as any;
      openNode("dest", false);
      wrapper = mountDrawer();
      expect(inputEditor(wrapper).props("query")).not.toContain("propagated");
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

      await wrapper.find('[data-test="workflow-node-delete"]').trigger("click");

      expect(confirmDialog(wrapper).props("modelValue")).toBe(true);
    });

    it("does nothing when no node is selected", async () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      workflowObj.currentSelectedNodeData = null;
      await nextTick();

      await wrapper.find('[data-test="workflow-node-delete"]').trigger("click");

      expect(confirmDialog(wrapper).props("modelValue")).toBe(false);
    });
  });

  // ── "Edit This Step" (run history → editor) ───────────────────────────────
  // Inspecting a run is read-only, so every verb is disabled and the user is left
  // with nothing to do. This is the one safe action: hand the run id and the node
  // id to the editor. The run itself is only read.
  describe("edit this step", () => {
    const stageHistoryRun = (runId = "run-7") => {
      workflowObj.readOnly = true;
      workflowObj.currentSelectedWorkflow.id = "wf-1";
      workflowObj.testRun.result = {
        errors: {},
        inputs: {},
        ranNodeIds: [],
        blockedNodeIds: [],
        mode: "history",
        runId,
      } as any;
    };

    afterEach(() => {
      workflowObj.readOnly = false;
      workflowObj.testRun.result = null;
    });

    it("offers the action while inspecting a run", async () => {
      stageHistoryRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-node-edit-step"]').exists()).toBe(true);
    });

    it("is absent in a normal editing session", async () => {
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-node-edit-step"]').exists()).toBe(false);
    });

    // A test run writes the same result key WITHOUT `mode`, so it must not be
    // mistaken for history.
    it("is absent when the result came from a test rather than history", async () => {
      workflowObj.readOnly = true;
      workflowObj.testRun.result = {
        errors: {},
        inputs: {},
        ranNodeIds: [],
        blockedNodeIds: [],
      } as any;
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-node-edit-step"]').exists()).toBe(false);
    });

    // Run Step is gated on !canvasReadOnly, so on a historical run it could never
    // be enabled — it is removed rather than shown permanently dead.
    it("removes Run Step while inspecting a run", async () => {
      stageHistoryRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-node-execute"]').exists()).toBe(false);
    });

    it("offers the action on a PASSED step too, not just a failed one", async () => {
      stageHistoryRun();
      workflowObj.testRun.result.errors = {}; // nothing errored
      stageNode("condition", { isEdit: true, id: "cond-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-node-edit-step"]').exists()).toBe(true);
    });

    it("carries the run AND the node to the editor", async () => {
      stageHistoryRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      await wrapper.find('[data-test="workflow-node-edit-step"]').trigger("click");

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflowEditor",
        query: expect.objectContaining({ id: "wf-1", run_id: "run-7", node_id: "fn-1" }),
      });
    });
  });
});
