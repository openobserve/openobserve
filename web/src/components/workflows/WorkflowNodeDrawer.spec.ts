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
  branchSubmit,
  functionSubmit,
  destinationSubmit,
  functionIsDirty,
  functionDiscard,
  functionSave,
  makeBodyStub,
} = vi.hoisted(() => ({
  triggerSubmit: vi.fn(),
  conditionSubmit: vi.fn(),
  branchSubmit: vi.fn(),
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
vi.mock("@/plugins/workflows/nodes/WorkflowBranch.vue", () =>
  makeBodyStub("WorkflowBranch", () => branchSubmit()),
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
import useWorkflowCanvas, {
  workflowObj,
  setNodeEditedInput,
  clearNodeEditedInput,
} from "@/plugins/workflows/useWorkflowCanvas";
import workflowService from "@/services/workflows";

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
      ["branch", "WorkflowBranch"],
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

    // Branch is an IO node like the rest: it gets the Input/Output panes and owns
    // its own insets, so the fallback padding must NOT apply to it.
    it("treats branch as an IO node (three-pane layout, no fallback padding)", () => {
      stageNode("branch");
      wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-ndv-body"]').classes()).not.toContain("p-4");
      expect(wrapper.find('[data-test="WorkflowBranch"]').exists()).toBe(true);
    });

    // The whole point of the config body: closing the panel commits { cases,
    // else_handle } onto the node, which is what makes the Branch publishable.
    it("commits the branch body's { cases, else_handle } payload onto the node", async () => {
      const node = stageNode("branch", { isEdit: true });
      const cases = [
        {
          handle: "case-0",
          label: "high",
          conditions: { version: 2, conditions: { filterType: "group" } },
        },
        { handle: "case-1", conditions: { version: 2, conditions: { filterType: "group" } } },
      ];
      branchSubmit.mockReturnValue({ cases, else_handle: "else" });
      wrapper = mountDrawer();

      await wrapper.find(".btn-close").trigger("click");
      await flushPromises();

      expect(branchSubmit).toHaveBeenCalled();
      const saved = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === node.id);
      expect(saved.data.cases).toEqual(cases);
      expect(saved.data.else_handle).toBe("else");
    });
  });

  // ONE container for every node, run or not: the NDV dialog. The old per-type side
  // drawer is gone, so a step looks the same whether you are building it or
  // inspecting a run of it.
  describe("container: always the NDV dialog", () => {
    it.each(["condition", "branch", "function", "destination", "workflow_trigger"])(
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

  // ── A run that stored NO per-node data at all ─────────────────────────────
  // Distinct from "this node was added after the run": there the graph really has
  // changed, here the run simply has nothing stored (predates persistence, or the
  // 30-day sweep removed it). Saying "not included in this run" about EVERY node
  // of a Success run states something false about the graph.
  describe("a run with no stored step data", () => {
    const stageEmptyRun = (runId = "run-empty") => {
      workflowObj.readOnly = true;
      workflowObj.currentSelectedWorkflow.id = "wf-1";
      workflowObj.testRun.result = {
        errors: {},
        inputs: {},
        outputs: {},
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

    it("does not claim the step is missing from the graph", async () => {
      stageEmptyRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-not-in-run"]').exists()).toBe(false);
    });

    it("says the run stored no step data", async () => {
      stageEmptyRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-no-run-data"]').exists()).toBe(true);
    });

    it("still flags a node genuinely absent from a run that DID store data", async () => {
      stageEmptyRun();
      workflowObj.testRun.result.inputs = { "other-node": [{ a: 1 }] };
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-not-in-run"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-no-run-data"]').exists()).toBe(false);
    });
  });

  // ── Config is a property of the WORKFLOW, not of the run ──────────────────
  // "Why didn't this branch fire?" is answered by the un-taken node's CONFIG, so
  // hiding it on a step the run skipped removes the one thing worth looking at.
  // Only Input/Output legitimately depend on execution.
  describe("config visibility on a step the run skipped", () => {
    const stageRunWithout = (id: string) => {
      workflowObj.readOnly = true;
      workflowObj.currentSelectedWorkflow.id = "wf-1";
      workflowObj.testRun.result = {
        errors: {},
        inputs: { "other-node": [{ a: 1 }] },
        outputs: {},
        ranNodeIds: ["other-node"],
        blockedNodeIds: [],
        mode: "history",
        runId: "run-9",
      } as any;
      stageNode("destination", { isEdit: true, id });
    };

    afterEach(() => {
      workflowObj.readOnly = false;
      workflowObj.testRun.result = null;
    });

    it("shows the Config pane for a destination that was not on the taken branch", async () => {
      stageRunWithout("dest-untaken");
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
    });

    it("keeps the not-in-run notice, which is true of Input/Output only", async () => {
      stageRunWithout("dest-untaken");
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-not-in-run"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-input"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-ndv-output"]').exists()).toBe(false);
    });

    // The same holds for a run that stored no per-node data at all.
    it("shows the Config pane when the run stored no step data", async () => {
      workflowObj.readOnly = true;
      workflowObj.currentSelectedWorkflow.id = "wf-1";
      workflowObj.testRun.result = {
        errors: {},
        inputs: {},
        outputs: {},
        ranNodeIds: [],
        blockedNodeIds: [],
        mode: "history",
        runId: "run-empty",
      } as any;
      stageNode("condition", { isEdit: true, id: "cond-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-config"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-ndv-no-run-data"]').exists()).toBe(true);
    });
  });

  // ── No input-validation error on a read-only run ──────────────────────────
  // A recorded per-node input is a single record OBJECT, and the user is not
  // entering anything, so the editable-input array validator must not run here.
  describe("input validation on a read-only run", () => {
    afterEach(() => {
      workflowObj.readOnly = false;
      workflowObj.testRun.result = null;
      clearNodeEditedInput("cond");
    });

    // The pane shows the run's recorded record (a single OBJECT), while the array
    // validator runs against the editable buffer — a leftover per-node test edit that
    // outlives the editing session. Nothing is being entered here, so it must be mute.
    it("does not flag a recorded object input as invalid JSON", async () => {
      seedGraph();
      openNode("cond");
      setNodeEditedInput("cond", JSON.stringify({ meta: { alert_count: 50 }, data: [] }));
      workflowObj.testRun.result = {
        errors: {},
        inputs: { cond: [{ meta: { alert_count: 50 }, data: [] }] },
        outputs: {},
        ranNodeIds: ["trig", "cond"],
        blockedNodeIds: [],
        mode: "history",
        runId: "run-3",
      } as any;
      workflowObj.readOnly = true;
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-input-invalid"]').exists()).toBe(false);
    });

    // The editable path is unchanged: bad JSON in the EDITOR still reports.
    it("still flags genuinely invalid JSON while editing", async () => {
      seedGraph();
      openNode("cond");
      wrapper = mountDrawer();
      await nextTick();
      const editor = wrapper.find('[data-test="workflow-ndv-input"] .code-editor');
      await editor.trigger("update:query", "{not json");
      (wrapper.vm as any).onEditInput?.("{not json");
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-input-invalid"]').exists()).toBe(true);
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

  // A trigger delivers ONE event, so wrapping a single record in a JSON array made
  // the Input pane read as a batch and pushed every field a level deeper. The pane
  // shows the bare object; the backend contract (`inputs: [...]`) is unchanged.
  describe("single-record test input reads as an object, not a 1-element array", () => {
    const inputEditor = (w: any) =>
      w.find('[data-test="workflow-ndv-input"]').findComponent({ name: "CodeQueryEditor" });

    it("seeds a lone record as a bare object", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      const shown = inputEditor(wrapper).props("query").trim();
      expect(shown.startsWith("{")).toBe(true);
      expect(shown.startsWith("[")).toBe(false);
    });

    it("still submits an ARRAY to the backend when Run Step executes", async () => {
      (workflowService as any).testWorkflow = vi
        .fn()
        .mockResolvedValue({ data: { outputs: {}, errors: {} } });
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      await inputEditor(wrapper).vm.$emit("update:query", '{"only":"one"}');
      await nextTick();
      await wrapper.find('[data-test="workflow-node-execute"]').trigger("click");
      await flushPromises();

      const sent = (workflowService as any).testWorkflow.mock.calls[0][0].inputs;
      expect(Array.isArray(sent)).toBe(true);
      expect(sent).toEqual([{ only: "one" }]);
    });

    it("keeps Run Step enabled for a bare object (not flagged invalid JSON)", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      await inputEditor(wrapper).vm.$emit("update:query", '{"only":"one"}');
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-input-invalid"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="workflow-node-execute"]').attributes("disabled"),
      ).toBeFalsy();
    });

    // A pasted multi-record batch is still a legitimate payload — it must survive.
    it("leaves a genuine multi-record array alone and submits it whole", async () => {
      (workflowService as any).testWorkflow = vi
        .fn()
        .mockResolvedValue({ data: { outputs: {}, errors: {} } });
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      await inputEditor(wrapper).vm.$emit("update:query", '[{"a":1},{"b":2}]');
      await nextTick();
      await wrapper.find('[data-test="workflow-node-execute"]').trigger("click");
      await flushPromises();

      const sent = (workflowService as any).testWorkflow.mock.calls[0][0].inputs;
      expect(sent).toEqual([{ a: 1 }, { b: 2 }]);
    });
  });

  // A hand-edited test input belongs to the NODE, not to the drawer instance.
  // Walking to another step and back must return the user's edit, because re-typing a
  // payload after every prev/next is the single biggest cost of the NDV's test loop.
  // Today `editableInput` is a plain ref re-seeded by a watch on [nodeId, testRun.result],
  // so any edit is silently discarded the moment the node changes.
  describe("per-node edited test input persists across node switches", () => {
    const inputEditor = (w: any) =>
      w.find('[data-test="workflow-ndv-input"]').findComponent({ name: "CodeQueryEditor" });

    // Type into the Input pane exactly as the user does (CodeQueryEditor emits update:query).
    const typeInput = async (w: any, text: string) => {
      await inputEditor(w).vm.$emit("update:query", text);
      await nextTick();
    };

    it("restores a node's edited input after switching away and back", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      await typeInput(wrapper, '[{"edited":"cond"}]');
      expect(inputEditor(wrapper).props("query")).toContain("edited");

      // Walk to the next step, then back — the same drawer instance, node id changes.
      openNode("dest", false);
      await nextTick();
      openNode("cond", false);
      await nextTick();

      expect(inputEditor(wrapper).props("query")).toContain('"edited": "cond"');
    });

    it("keeps each node's edit separate rather than sharing one buffer", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();
      await typeInput(wrapper, '[{"who":"cond"}]');

      openNode("dest", false);
      await nextTick();
      await typeInput(wrapper, '[{"who":"dest"}]');
      expect(inputEditor(wrapper).props("query")).toContain("dest");
      expect(inputEditor(wrapper).props("query")).not.toContain("cond");

      openNode("cond", false);
      await nextTick();
      expect(inputEditor(wrapper).props("query")).toContain("cond");
      expect(inputEditor(wrapper).props("query")).not.toContain("dest");
    });

    it("survives closing and reopening the drawer on the same node", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();
      await typeInput(wrapper, '[{"kept":true}]');

      wrapper.unmount();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      expect(inputEditor(wrapper).props("query")).toContain("kept");
    });

    // The ONLY sanctioned way back to the sample: an explicit reset control.
    it("offers a reset-to-sample control that discards the edit and re-seeds", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();
      await typeInput(wrapper, '[{"edited":"cond"}]');

      const reset = wrapper.find('[data-test="workflow-ndv-input-reset"]');
      expect(reset.exists()).toBe(true);

      await reset.trigger("click");
      await nextTick();

      const query = inputEditor(wrapper).props("query");
      expect(query).not.toContain("edited");
      // back to the trigger sample seed, not an empty editor
      expect(query).toContain("alert_name");
    });

    it("clears the stored edit for that node only, leaving siblings intact", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();
      await typeInput(wrapper, '[{"who":"cond"}]');
      openNode("dest", false);
      await nextTick();
      await typeInput(wrapper, '[{"who":"dest"}]');

      await wrapper.find('[data-test="workflow-ndv-input-reset"]').trigger("click");
      await nextTick();
      expect(inputEditor(wrapper).props("query")).not.toContain("dest");

      openNode("cond", false);
      await nextTick();
      expect(inputEditor(wrapper).props("query")).toContain("cond");
    });
  });

  // The payload is a genuine BATCH array (backend sends vec![final_data]), but
  // the NDV dumping the whole array is why authors reach for `row[0]`. Display one
  // event at a time with an "n of N" pager. Wire format unchanged.
  describe("NDV renders one event at a time", () => {
    const inputEditor = (w: any) =>
      w.find('[data-test="workflow-ndv-input"]').findComponent({ name: "CodeQueryEditor" });
    const outputEditor = (w: any) =>
      w.find('[data-test="workflow-ndv-output"]').findComponent({ name: "CodeQueryEditor" });

    const threeEvents = [
      { meta: { alert_name: "first" }, data: [{ n: 1 }] },
      { meta: { alert_name: "second" }, data: [{ n: 2 }] },
      { meta: { alert_name: "third" }, data: [{ n: 3 }] },
    ];

    it("shows only the first event in the Output pane, not the whole array", () => {
      seedGraph();
      workflowObj.testRun.result = {
        inputs: {},
        outputs: { cond: threeEvents },
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      const query = outputEditor(wrapper).props("query");
      expect(query).toContain("first");
      expect(query).not.toContain("second");
      // the rendered JSON is an object, not a top-level array
      expect(JSON.parse(query)).not.toBeInstanceOf(Array);
    });

    it("shows an n-of-N pager on the Output pane for a multi-event batch", () => {
      seedGraph();
      workflowObj.testRun.result = {
        inputs: {},
        outputs: { cond: threeEvents },
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      const pager = wrapper.find('[data-test="workflow-ndv-output-pager"]');
      expect(pager.exists()).toBe(true);
      expect(pager.text()).toMatch(/1\D+3/);
    });

    it("steps to the next event in the Output pane", async () => {
      seedGraph();
      workflowObj.testRun.result = {
        inputs: {},
        outputs: { cond: threeEvents },
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      await wrapper.find('[data-test="workflow-ndv-output-next"]').trigger("click");
      await nextTick();

      const query = outputEditor(wrapper).props("query");
      expect(query).toContain("second");
      expect(query).not.toContain("first");
      expect(wrapper.find('[data-test="workflow-ndv-output-pager"]').text()).toMatch(/2\D+3/);
    });

    // Forward-only paging forces a full wrap to see the event before the current one.
    it("steps to the previous event in the Output pane", async () => {
      seedGraph();
      workflowObj.testRun.result = {
        inputs: {},
        outputs: { cond: threeEvents },
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      await wrapper.find('[data-test="workflow-ndv-output-next"]').trigger("click");
      await nextTick();
      await wrapper.find('[data-test="workflow-ndv-output-prev"]').trigger("click");
      await nextTick();

      const query = outputEditor(wrapper).props("query");
      expect(query).toContain("first");
      expect(wrapper.find('[data-test="workflow-ndv-output-pager"]').text()).toMatch(/1\D+3/);
    });

    it("wraps backwards from the first Output event to the last", async () => {
      seedGraph();
      workflowObj.testRun.result = {
        inputs: {},
        outputs: { cond: threeEvents },
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      await wrapper.find('[data-test="workflow-ndv-output-prev"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-output-pager"]').text()).toMatch(/3\D+3/);
    });

    it("steps to the previous event in the read-only Input pane", async () => {
      seedGraph();
      workflowObj.readOnly = true;
      workflowObj.testRun.result = {
        inputs: { cond: threeEvents },
        outputs: {},
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      await wrapper.find('[data-test="workflow-ndv-input-prev"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-input-pager"]').text()).toMatch(/3\D+3/);
      expect(inputEditor(wrapper).props("query")).toContain("third");
    });

    // Paging is gated on READ-ONLY, not on "a run exists" — in the editor a recorded run
    // IS the editable Run Step input, and parsedInput rejects a non-array.
    it("pages the Input pane on the read-only Runs canvas", () => {
      seedGraph();
      workflowObj.readOnly = true;
      workflowObj.testRun.result = {
        inputs: { cond: threeEvents },
        outputs: {},
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      const query = inputEditor(wrapper).props("query");
      expect(query).toContain("first");
      expect(query).not.toContain("third");
      expect(wrapper.find('[data-test="workflow-ndv-input-pager"]').exists()).toBe(true);
    });

    // A single-event batch is the overwhelmingly common case — a "1 of 1" pager there
    // is chrome for nothing.
    it("hides the pager for a single-event batch but still unwraps it", () => {
      seedGraph();
      workflowObj.testRun.result = {
        inputs: {},
        outputs: { cond: [threeEvents[0]] },
        errors: {},
      } as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      expect(wrapper.find('[data-test="workflow-ndv-output-pager"]').exists()).toBe(false);
      expect(JSON.parse(outputEditor(wrapper).props("query"))).not.toBeInstanceOf(Array);
    });

    // The invariant that keeps Run Step working: with no recorded run the Input pane is
    // the EDITABLE payload, never paged. A lone event shows unwrapped (parsedInput
    // re-wraps it for the backend), so only a real batch stays an array.
    it("shows the editable Run Step input unpaged, unwrapping a lone event", () => {
      seedGraph();
      workflowObj.testRun.result = null as any;
      openNode("cond", false);
      wrapper = mountDrawer();

      const query = inputEditor(wrapper).props("query");
      expect(JSON.parse(query)).not.toBeInstanceOf(Array);
      expect(wrapper.find('[data-test="workflow-ndv-input-pager"]').exists()).toBe(false);
    });

    // A payload stored before the unwrap existed replays through reprettyJson, which
    // bypasses the seed — so the array came back for anyone with a saved edit.
    it("unwraps a lone event restored from a previously stored edit", () => {
      seedGraph();
      workflowObj.testRun.result = null as any;
      setNodeEditedInput("cond", JSON.stringify([{ meta: { alert_count: 7 } }]));
      openNode("cond", false);
      wrapper = mountDrawer();

      expect(JSON.parse(inputEditor(wrapper).props("query"))).not.toBeInstanceOf(Array);
    });
  });

  // ── Steps rail: telling sibling steps of the SAME type apart ─────────────────
  // A Branch fans out into several Destinations, so the rail renders N rows whose
  // type title is identical ("Destination"). The canvas card and the Test "Run From"
  // dropdown already disambiguate these with nodeConfigDetail; the rail did not, so
  // four arms read as four copies of one step.
  describe("steps rail labels for same-type siblings", () => {
    const seedBranchArms = () => {
      workflowObj.currentSelectedWorkflow.nodes = [
        { id: "trig", position: { x: 0, y: 0 }, data: { node_type: "workflow_trigger" } },
        { id: "split", position: { x: 0, y: 0 }, data: { node_type: "branch" } },
        {
          id: "d1",
          position: { x: 0, y: 0 },
          data: { node_type: "destination", destination_id: "pagerduty" },
        },
        {
          id: "d2",
          position: { x: 0, y: 0 },
          data: { node_type: "destination", destination_id: "slack" },
        },
      ] as any;
      workflowObj.currentSelectedWorkflow.edges = [
        { id: "e1", source: "trig", target: "split" },
        { id: "e2", source: "split", target: "d1" },
        { id: "e3", source: "split", target: "d2" },
      ] as any;
    };

    const railText = (wrapper: any, id: string) =>
      wrapper.find(`[data-test="workflow-ndv-step-${id}"]`).text();

    it("distinguishes two Destination arms by their destination name", async () => {
      seedBranchArms();
      openNode("d1");
      wrapper = mountDrawer();
      await nextTick();

      expect(railText(wrapper, "d1")).toContain("pagerduty");
      expect(railText(wrapper, "d2")).toContain("slack");
    });

    it("keeps a user-set custom label instead of the destination name", async () => {
      seedBranchArms();
      const d1 = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "d1");
      d1.meta = { label: "Page The Oncall" };
      openNode("d1");
      wrapper = mountDrawer();
      await nextTick();

      expect(railText(wrapper, "d1")).toContain("Page The Oncall");
    });

    it("leaves a step with no configured detail on its plain type title", async () => {
      seedBranchArms();
      const d2 = workflowObj.currentSelectedWorkflow.nodes.find((n: any) => n.id === "d2");
      d2.data.destination_id = "";
      openNode("d1");
      wrapper = mountDrawer();
      await nextTick();

      expect(railText(wrapper, "d2")).toContain(t("workflow.node.destination"));
    });
  });

  // ── The run chip identifies a run the way every other surface does ───────────
  // A raw KSUID ("Run · 3IiNQZ77pQQBFs52FdLKEFS22Sm") is backend jargon; the runs
  // table and the run switcher both label a run by its start TIMESTAMP. The id stays
  // on the chip's title attribute for support.
  describe("run chip in the header", () => {
    const stageLoadedRun = (runId = "run-9", startTime = 1_788_255_420_000_000) => {
      workflowObj.readOnly = true;
      workflowObj.currentSelectedWorkflow.id = "wf-1";
      workflowObj.runsHistory.list = [
        { run_id: runId, start_time: startTime, end_time: startTime + 1000 },
      ] as any;
      workflowObj.testRun.result = {
        errors: {},
        inputs: { "fn-1": [{ a: 1 }] },
        outputs: {},
        ranNodeIds: ["fn-1"],
        blockedNodeIds: [],
        mode: "history",
        runId,
      } as any;
    };

    afterEach(() => {
      workflowObj.readOnly = false;
      workflowObj.testRun.result = null;
      workflowObj.runsHistory.list = [] as any;
    });

    it("does not print the raw run id as the chip's visible text", async () => {
      stageLoadedRun("3IiNQZ77pQQBFs52FdLKEFS22Sm");
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      const chip = wrapper.find('[data-test="workflow-ndv-run-label"]');
      expect(chip.exists()).toBe(true);
      expect(chip.text()).not.toContain("3IiNQZ77pQQBFs52FdLKEFS22Sm");
    });

    it("labels the run by its start time", async () => {
      stageLoadedRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      const chip = wrapper.find('[data-test="workflow-ndv-run-label"]');
      expect(chip.findComponent({ name: "OTimeCell" }).exists()).toBe(true);
    });

    // Opening a run without visiting the Runs page first leaves runsHistory empty, so
    // the timestamp cannot resolve and the chip degrades to a bare "Run · —".
    it("fetches the runs list so the chip can name a directly-opened run", async () => {
      workflowObj.readOnly = true;
      workflowObj.currentSelectedWorkflow.id = "wf-1";
      workflowObj.runsHistory.list = [] as any;
      workflowObj.testRun.result = {
        errors: {},
        inputs: { "fn-1": [{ a: 1 }] },
        outputs: {},
        ranNodeIds: ["fn-1"],
        blockedNodeIds: [],
        mode: "history",
        runId: "run-9",
      } as any;
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await flushPromises();

      // The list arrives after the drawer mounts; the chip must pick it up.
      workflowObj.runsHistory.list = [
        { run_id: "run-9", start_time: 1_788_255_420_000_000, end_time: 1_788_255_421_000_000 },
      ] as any;
      await nextTick();

      const cell = wrapper
        .find('[data-test="workflow-ndv-run-label"]')
        .findComponent({ name: "OTimeCell" });
      expect(cell.props("value")).toBe(1_788_255_420_000_000);
    });

    // The read-only config gave no reason for being read-only: a past run is a
    // record of what HAPPENED, and the way out is the editor.
    it("says why the config is read-only while a past run is loaded", async () => {
      stageLoadedRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      const note = wrapper.find('[data-test="workflow-ndv-readonly-note"]');
      expect(note.exists()).toBe(true);
      expect(note.text()).toContain(t("workflow.ndv.readOnlyRun"));
    });

    it("offers the way out of history mode from inside that note", async () => {
      stageLoadedRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      await wrapper.find('[data-test="workflow-ndv-readonly-note-edit"]').trigger("click");

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflowEditor",
        query: expect.objectContaining({ id: "wf-1", run_id: "run-9", node_id: "fn-1" }),
      });
    });

    it("shows no such note in a normal editing session", async () => {
      seedGraph();
      openNode("cond", false);
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-readonly-note"]').exists()).toBe(false);
    });

    // A bare history icon beside the chip never said it CHANGED runs. The chip
    // already names the run, so the chip itself is the control.
    it("makes the run chip itself the switcher trigger", async () => {
      stageLoadedRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      const chip = wrapper.find('[data-test="workflow-ndv-run-switcher"]');
      expect(chip.exists()).toBe(true);
      expect(chip.find('[data-test="workflow-ndv-run-label"]').exists()).toBe(true);
      expect(chip.findComponent({ name: "OTimeCell" }).exists()).toBe(true);
    });

    it("shows a caret so the chip reads as a menu, not a static label", async () => {
      stageLoadedRun();
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      const icons = wrapper
        .find('[data-test="workflow-ndv-run-switcher"]')
        .findAll(".o-icon")
        .map((i: any) => i.attributes("data-name"));
      expect(icons).toContain("chevron-down");
    });

    it("keeps the run id in the tooltip for support", async () => {
      stageLoadedRun("3IiNQZ77pQQBFs52FdLKEFS22Sm");
      stageNode("function", { isEdit: true, id: "fn-1" });
      wrapper = mountDrawer();
      await nextTick();

      expect(wrapper.find('[data-test="workflow-ndv-run-switcher"]').attributes("title")).toContain(
        "3IiNQZ77pQQBFs52FdLKEFS22Sm",
      );
    });
  });
});

// ── Retry from this step (from_node) ─────────────────────────────────────────
// The backend's retry takes an optional from_node, replaying the run from one
// step downward. That pairs with the NDV, where the user is already looking at
// the step that failed. Gated exactly like the run-level retry: a Test or Retry
// run has no stored input, so the step offers nothing rather than a dead button.
describe("WorkflowNodeDrawer — retry from this step", () => {
  const RETRY = '[data-test="workflow-node-retry-from"]';
  let wrapper: any;

  const stageRetryableRun = (runId = "run-9", eventType = "AlertFired") => {
    workflowObj.readOnly = true;
    workflowObj.currentSelectedWorkflow.id = "wf-1";
    workflowObj.runsHistory = {
      list: [{ run_id: runId, error: "boom", event_type: eventType }],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    } as any;
    workflowObj.testRun.result = {
      errors: {},
      inputs: {},
      ranNodeIds: [],
      blockedNodeIds: [],
      mode: "history",
      runId,
    } as any;
  };

  beforeEach(() => {
    (workflowService as any).retryWorkflow = vi.fn().mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    workflowObj.readOnly = false;
    workflowObj.testRun.result = null;
    wrapper?.unmount?.();
  });

  it("offers retry-from-here on a step of a replayable run", async () => {
    stageRetryableRun();
    stageNode("function", { isEdit: true, id: "fn-1" });
    wrapper = mountDrawer();
    await nextTick();
    expect(wrapper.find(RETRY).exists()).toBe(true);
  });

  it("does NOT offer it on a TEST run — no stored input to replay from", async () => {
    stageRetryableRun("run-9", "Test");
    stageNode("function", { isEdit: true, id: "fn-1" });
    wrapper = mountDrawer();
    await nextTick();
    expect(wrapper.find(RETRY).exists()).toBe(false);
  });

  it("does NOT offer it on a RETRY run", async () => {
    stageRetryableRun("run-9", "Retry");
    stageNode("function", { isEdit: true, id: "fn-1" });
    wrapper = mountDrawer();
    await nextTick();
    expect(wrapper.find(RETRY).exists()).toBe(false);
  });

  it("is absent in a normal editing session (no run loaded)", async () => {
    stageNode("function", { isEdit: true, id: "fn-1" });
    wrapper = mountDrawer();
    await nextTick();
    expect(wrapper.find(RETRY).exists()).toBe(false);
  });

  it("sends this node as from_node so the replay starts here", async () => {
    stageRetryableRun();
    stageNode("function", { isEdit: true, id: "fn-1" });
    wrapper = mountDrawer();
    await nextTick();
    await wrapper.find(RETRY).trigger("click");
    await flushPromises();
    expect((workflowService as any).retryWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: "run-9", from_node: "fn-1" }),
    );
  });
});
