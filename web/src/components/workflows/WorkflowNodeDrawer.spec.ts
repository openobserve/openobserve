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

vi.mock("@/plugins/workflows/nodes/WorkflowAlertTrigger.vue", () =>
  makeBodyStub("WorkflowAlertTrigger", () => triggerSubmit()),
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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowNodeDrawer from "./WorkflowNodeDrawer.vue";
import useWorkflowCanvas, {
  workflowObj,
} from "@/plugins/workflows/useWorkflowCanvas";

const t = (k: string, v?: any) => i18n.global.t(k, v ?? {});

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "title",
    "width",
    "size",
    "showClose",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div class="o-drawer" v-bind="$attrs">
      <div class="drawer-title">{{ title }}</div>
      <button class="btn-primary" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button class="btn-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button class="btn-neutral" @click="$emit('click:neutral')">{{ neutralButtonLabel }}</button>
      <button class="btn-close" @click="$emit('update:open', false)" />
      <button class="btn-open" @click="$emit('update:open', true)" />
      <slot />
    </div>
  `,
};

const mountDrawer = () =>
  mount(WorkflowNodeDrawer, {
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        OIcon: { props: ["name", "size"], template: '<i class="o-icon" :data-name="name" />' },
      },
    },
  });

const drawerProps = (wrapper: any) =>
  wrapper.findComponent(ODrawerStub).props() as any;

// Stage a node for the drawer to edit / add, exactly as the canvas would.
const stageNode = (
  nodeType: string,
  opts: { isEdit?: boolean; id?: string; data?: any } = {},
) => {
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
  const { resetWorkflowData } = useWorkflowCanvas();

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
      expect(wrapper.find(".drawer-title").text()).toBe(
        t("workflow.node.condition"),
      );
    });

    it("renders the trigger title", () => {
      stageNode("workflow_trigger");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).title).toBe(
        t("workflow.triggerKind.alertFired.node"),
      );
    });

    it("falls back to the raw dialog name when the node type is unknown", () => {
      stageNode("mystery_node");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).title).toBe("mystery_node");
    });
  });

  describe("body switching", () => {
    it.each([
      ["workflow_trigger", "WorkflowAlertTrigger"],
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

  describe("drawer sizing", () => {
    it("uses width 45 for condition", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).width).toBe(45);
      expect(drawerProps(wrapper).size).toBe("md");
    });

    it("uses width 30 for function", () => {
      stageNode("function");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).width).toBe(30);
    });

    it("uses no width and size lg for destination", () => {
      stageNode("destination");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).width).toBeUndefined();
      expect(drawerProps(wrapper).size).toBe("lg");
    });

    it("uses no width and size md for the trigger", () => {
      stageNode("workflow_trigger");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).width).toBeUndefined();
      expect(drawerProps(wrapper).size).toBe("md");
    });

    it("expands to full width (97) regardless of node type", async () => {
      stageNode("condition");
      wrapper = mountDrawer();
      workflowObj.dialog.expand = true;
      await nextTick();
      expect(drawerProps(wrapper).width).toBe(97);
    });
  });

  describe("footer buttons", () => {
    it("shows Save/Cancel for an editable body", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).primaryButtonLabel).toBe("Save");
      expect(drawerProps(wrapper).secondaryButtonLabel).toBe("Cancel");
    });

    it("hides Save/Cancel/Delete while the drawer is expanded", async () => {
      stageNode("function", { isEdit: true });
      wrapper = mountDrawer();
      workflowObj.dialog.expand = true;
      await nextTick();
      const p = drawerProps(wrapper);
      expect(p.primaryButtonLabel).toBeUndefined();
      expect(p.secondaryButtonLabel).toBeUndefined();
      expect(p.neutralButtonLabel).toBeUndefined();
    });

    it("hides Save/Cancel for the read-only trigger body", () => {
      stageNode("workflow_trigger", { isEdit: true });
      wrapper = mountDrawer();
      const p = drawerProps(wrapper);
      expect(p.primaryButtonLabel).toBeUndefined();
      expect(p.secondaryButtonLabel).toBeUndefined();
    });

    it("never offers Delete for the trigger", () => {
      stageNode("workflow_trigger", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).neutralButtonLabel).toBeUndefined();
    });

    it("offers Delete only when editing an existing non-trigger node", () => {
      stageNode("condition", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).neutralButtonLabel).toBe(
        t("workflow.deleteNode"),
      );
    });

    it("does not offer Delete while adding a new node", () => {
      stageNode("condition");
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).neutralButtonLabel).toBeUndefined();
    });

    it("hides the footer while the destination body is creating a new destination", async () => {
      stageNode("destination", { isEdit: true });
      wrapper = mountDrawer();
      expect(drawerProps(wrapper).primaryButtonLabel).toBe("Save");

      wrapper.findComponent({ name: "WorkflowDestination" }).vm
        .createNewDestination = true;
      await nextTick();

      const p = drawerProps(wrapper);
      expect(p.primaryButtonLabel).toBeUndefined();
      expect(p.secondaryButtonLabel).toBeUndefined();
      expect(p.neutralButtonLabel).toBeUndefined();
    });
  });

  describe("save", () => {
    it("commits the payload returned by the body form (add flow)", async () => {
      const node = stageNode("condition");
      workflowObj.pendingEdge = { source: "src-1", sourceHandle: undefined };
      workflowObj.currentSelectedWorkflow.nodes = [
        { id: "src-1", data: { node_type: "workflow_trigger" } },
      ];
      conditionSubmit.mockReturnValue({ conditions: [{ column: "a" }] });

      wrapper = mountDrawer();
      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(conditionSubmit).toHaveBeenCalled();
      const nodes = workflowObj.currentSelectedWorkflow.nodes;
      expect(nodes).toHaveLength(2);
      expect(nodes[1].id).toBe(node.id);
      expect(nodes[1].data.conditions).toEqual([{ column: "a" }]);
      // auto-wired from the pending edge
      expect(workflowObj.currentSelectedWorkflow.edges).toHaveLength(1);
      expect(workflowObj.dialog.show).toBe(false);
    });

    it("awaits an async body payload (destination picker resolves a promise)", async () => {
      stageNode("destination", { isEdit: true });
      destinationSubmit.mockResolvedValue({ destination_id: "sink-a" });

      wrapper = mountDrawer();
      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(workflowObj.currentSelectedWorkflow.nodes[0].data.destination_id).toBe(
        "sink-a",
      );
      expect(workflowObj.dialog.show).toBe(false);
    });

    it("blocks the save when the body form returns null (invalid)", async () => {
      stageNode("condition", { isEdit: true });
      conditionSubmit.mockReturnValue(null);

      wrapper = mountDrawer();
      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(workflowObj.dialog.show).toBe(true);
      expect(
        workflowObj.currentSelectedWorkflow.nodes[0].data.conditions,
      ).toBeUndefined();
    });

    it("blocks the save when the body form returns undefined", async () => {
      stageNode("function", { isEdit: true });
      functionSubmit.mockReturnValue(undefined);

      wrapper = mountDrawer();
      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(workflowObj.dialog.show).toBe(true);
    });

    it("commits an empty payload for a placeholder (form-less) node type", async () => {
      stageNode("mystery_node", { isEdit: true });
      wrapper = mountDrawer();

      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedWorkflow.nodes[0].data.node_type).toBe(
        "mystery_node",
      );
    });
  });

  describe("cancel / close", () => {
    it("discards the staged node on Cancel", async () => {
      stageNode("condition");
      wrapper = mountDrawer();

      await wrapper.find(".btn-secondary").trigger("click");

      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedNodeData).toBeNull();
      expect(workflowObj.currentSelectedWorkflow.nodes).toHaveLength(0);
    });

    it("closes the drawer when ODrawer emits update:open=false", async () => {
      stageNode("condition");
      wrapper = mountDrawer();

      await wrapper.find(".btn-close").trigger("click");

      expect(workflowObj.dialog.show).toBe(false);
      expect(workflowObj.currentSelectedNodeID).toBe("");
    });

    it("ignores update:open=true", async () => {
      stageNode("condition");
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
