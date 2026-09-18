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

// WorkflowCanvas is the VueFlow wrapper (fork of PipelineFlow). VueFlow, its
// background/controls plugins and the two rendered children are mocked (same
// mock shape as PipelineFlow.spec.ts), so these tests cover what the CANVAS
// owns: the VueFlow config, the event wiring into useWorkflowCanvas, the node /
// edge slot templates, the empty-state hint and the one-shot trigger centering.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";

// --- @vue-flow/core ---------------------------------------------------------
// `__state` exposes the captured onNodesInitialized callback + the viewport
// stubs so the centering effect can be driven from the tests.
vi.mock("@vue-flow/core", async () => {
  const { ref } = await import("vue");
  const state: any = {
    nodesInitializedCb: null,
    setViewport: vi.fn(),
    findNode: vi.fn(),
    fitView: vi.fn(),
    setCenter: vi.fn(),
    removeEdges: vi.fn(),
    getSelectedEdges: ref([]),
    getSelectedNodes: ref([]),
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    dimensions: ref({ width: 1000, height: 600 }),
  };
  return {
    __state: state,
    VueFlow: {
      name: "VueFlow",
      props: ["nodes", "edges", "defaultViewport", "minZoom", "maxZoom", "deleteKeyCode"],
      emits: [
        "update:nodes",
        "update:edges",
        "drop",
        "dragover",
        "connect",
        "node-change",
        "nodes-change",
        "edges-change",
        "node-mouse-enter",
        "node-mouse-leave",
        "edge-mouse-enter",
        "edge-mouse-leave",
      ],
      data() {
        return {
          nodeSlotProps: { id: "n1", data: { node_type: "condition" } },
          edgeSlotProps: {
            id: "e1",
            sourceX: 1,
            sourceY: 2,
            targetX: 3,
            targetY: 4,
            sourcePosition: "bottom",
            targetPosition: "top",
            data: { foo: "bar" },
            markerEnd: "url(#arrow)",
            style: { stroke: "grey" },
            selected: true,
          },
        };
      },
      template: `
        <div class="mock-vue-flow">
          <slot />
          <slot name="node-input" v-bind="nodeSlotProps" />
          <slot name="node-output" v-bind="nodeSlotProps" />
          <slot name="node-default" v-bind="nodeSlotProps" />
          <slot name="edge-custom" v-bind="edgeSlotProps" />
        </div>
      `,
    },
    // The empty-canvas start node renders the shared FlowNodeCard, which
    // imports Handle + Position from this module.
    Handle: {
      name: "Handle",
      props: ["id", "type", "position"],
      template: "<div class='mock-handle' />",
    },
    Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
    useVueFlow: () => ({
      onNodesInitialized: (cb: any) => {
        state.nodesInitializedCb = cb;
      },
      setViewport: state.setViewport,
      findNode: state.findNode,
      fitView: state.fitView,
      setCenter: state.setCenter,
      getSelectedEdges: state.getSelectedEdges,
      getSelectedNodes: state.getSelectedNodes,
      removeEdges: state.removeEdges,
      viewport: state.viewport,
      dimensions: state.dimensions,
    }),
  };
});

vi.mock("@vue-flow/background", () => ({
  Background: {
    name: "Background",
    props: ["size", "gap", "patternColor"],
    template: '<div class="mock-background" />',
  },
}));

vi.mock("@vue-flow/controls", () => ({
  Controls: {
    name: "Controls",
    props: ["showInteractive", "position"],
    template: '<div class="mock-controls" />',
  },
}));

vi.mock("@/plugins/workflows/WorkflowNode.vue", () => ({
  default: {
    name: "WorkflowNode",
    props: ["id", "data"],
    template: '<div class="mock-workflow-node" />',
  },
}));

vi.mock("@/components/flow/FlowEdge.vue", () => ({
  default: {
    name: "FlowEdge",
    props: [
      "id",
      "sourceX",
      "sourceY",
      "targetX",
      "targetY",
      "sourcePosition",
      "targetPosition",
      "data",
      "markerEnd",
      "style",
      "selected",
      "insertable",
      "label",
    ],
    template: '<div class="mock-flow-edge" />',
  },
}));

// --- useWorkflowCanvas ------------------------------------------------------
// A singleton api object so the spec can both seed `workflowObj` and assert the
// VueFlow event wiring.
vi.mock("@/plugins/workflows/useWorkflowCanvas", async () => {
  const { reactive } = await import("vue");
  const api = {
    workflowObj: reactive({
      currentSelectedWorkflow: { nodes: <any[]>[], edges: <any[]>[] },
      // testRun is read by the fit-view watch / onNodesInitialized (T4).
      testRun: { result: <any>null, resultDrawer: { show: false, nodeId: "" } },
      readOnly: false,
      showNodePalette: false,
    }),
    onNodeChange: vi.fn(),
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onNodeDragStart: vi.fn(),
    onNodeDragStop: vi.fn(),
    onConnect: vi.fn(),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    openTriggerPicker: vi.fn(),
    openActionPicker: vi.fn(),
    openStepPicker: vi.fn(),
    openInsertPicker: vi.fn(),
    requestDeleteNode: vi.fn(),
  };
  return {
    default: () => api,
    // Named exports the canvas imports directly (undo history + tidy).
    workflowHistory: reactive({ past: <any[]>[], future: <any[]>[] }),
    pushWorkflowHistory: vi.fn(),
    undoWorkflow: vi.fn(),
    redoWorkflow: vi.fn(),
    tidyWorkflowLayout: vi.fn(),
    // The canvas asks this for each edge's Branch-arm label; only "e1" is rendered.
    edgeBranchLabel: (edgeId: string) => (edgeId === "e1" ? "Severe (>=1000)" : ""),
    // A Branch's arms drive one append `+` each, so the canvas resolves its stable
    // handle ids through the real helper's contract.
    NEW_BRANCH_PATH_HANDLE: "__new_path__",
    branchHandles: (node: any) => {
      if (node?.data?.node_type !== "branch") return [];
      const cases = node?.data?.cases;
      if (!Array.isArray(cases) || !cases.length) return [];
      return [...cases.map((c: any, i: number) => c?.handle || `case-${i}`), "else"];
    },
    // The canvas asks for a node's io_type to decide which leaves can offer an
    // "append step" point — a terminal (output) node cannot. Only ioType is read.
    nodeMeta: (nodeType: string) => {
      if (nodeType === "destination") return { ioType: "output" };
      if (nodeType === "workflow_trigger") return { ioType: "input" };
      return { ioType: "default" };
    },
  };
});

import * as vueFlowCore from "@vue-flow/core";
import useWorkflowCanvas from "@/plugins/workflows/useWorkflowCanvas";
import WorkflowCanvas from "@/plugins/workflows/WorkflowCanvas.vue";

const vf: any = (vueFlowCore as any).__state;
const api: any = (useWorkflowCanvas as any)();
const wfObj = api.workflowObj;

const triggerNode = (x = 100, y = 40) => ({
  id: "t1",
  position: { x, y },
  data: { node_type: "workflow_trigger" },
});

const mountCanvas = () => mount(WorkflowCanvas as any, { global: { plugins: [i18n] } });

const flow = (wrapper: any) => wrapper.findComponent({ name: "VueFlow" });

describe("WorkflowCanvas", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vf.nodesInitializedCb = null;
    vf.viewport.value = { x: 0, y: 0, zoom: 1 };
    vf.dimensions.value = { width: 1000, height: 600 };
    vf.findNode.mockReset();
    wfObj.currentSelectedWorkflow = { nodes: [], edges: [] };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  describe("mounting + composition", () => {
    it("mounts and renders the VueFlow surface", () => {
      wrapper = mountCanvas();
      expect(wrapper.exists()).toBe(true);
      expect(flow(wrapper).exists()).toBe(true);
    });

    it("renders the dotted grid Background with the expected pattern", () => {
      wrapper = mountCanvas();
      const bg = wrapper.findComponent({ name: "Background" });
      expect(bg.exists()).toBe(true);
      expect(bg.props("size")).toBe(2);
      expect(bg.props("gap")).toBe(22);
      // No `pattern-color`: the dot colour is token-driven from flow-canvas.css
      // (`.vue-flow__background circle { fill: var(--color-grey-400) }`). The
      // library sets `fill` as an SVG PRESENTATION ATTRIBUTE, where var() does
      // not resolve, so a hex prop here could never follow the theme. Pinned so
      // a hardcoded colour does not creep back in.
      expect(bg.props("patternColor")).toBeUndefined();
    });

    it("renders the zoom Controls top-left without the interactive toggle", () => {
      wrapper = mountCanvas();
      const controls = wrapper.findComponent({ name: "Controls" });
      expect(controls.exists()).toBe(true);
      expect(controls.props("showInteractive")).toBe(false);
      expect(controls.props("position")).toBe("top-left");
    });

    it("carries the o2vf_node class (shared pipeline node styling)", () => {
      wrapper = mountCanvas();
      expect(flow(wrapper).classes()).toContain("o2vf_node");
      expect(flow(wrapper).classes()).toContain("workflow-flow");
    });

    it("exposes the vueFlowRef", () => {
      wrapper = mountCanvas();
      expect(wrapper.vm.vueFlowRef).toBeDefined();
    });
  });

  describe("VueFlow config", () => {
    it("uses a 0.8 default zoom and the 0.2 - 4 zoom bounds", () => {
      wrapper = mountCanvas();
      expect(flow(wrapper).props("defaultViewport")).toEqual({ zoom: 0.8 });
      expect(flow(wrapper).props("minZoom")).toBe(0.2);
      expect(flow(wrapper).props("maxZoom")).toBe(4);
    });

    it("binds the shared workflowObj nodes/edges to VueFlow", async () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      wfObj.currentSelectedWorkflow.edges = [{ id: "e1", source: "t1", target: "c1" }];
      wrapper = mountCanvas();
      await nextTick();
      expect(flow(wrapper).props("nodes")).toHaveLength(1);
      expect(flow(wrapper).props("edges")).toHaveLength(1);
    });

    it("writes back through v-model:nodes / v-model:edges", async () => {
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("update:nodes", [triggerNode()]);
      flow(wrapper).vm.$emit("update:edges", [{ id: "e9" }]);
      await nextTick();
      expect(wfObj.currentSelectedWorkflow.nodes).toHaveLength(1);
      expect(wfObj.currentSelectedWorkflow.edges[0].id).toBe("e9");
    });
  });

  describe("event wiring into useWorkflowCanvas", () => {
    it.each([
      ["node-change", "onNodeChange"],
      ["nodes-change", "onNodesChange"],
      ["edges-change", "onEdgesChange"],
      ["connect", "onConnect"],
      ["drop", "onDrop"],
      ["dragover", "onDragOver"],
    ])("VueFlow @%s -> %s", (event, handler) => {
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit(event, { payload: 1 });
      expect(api[handler]).toHaveBeenCalledTimes(1);
      expect(api[handler]).toHaveBeenCalledWith({ payload: 1 });
    });
  });

  describe("node templates", () => {
    it("renders a WorkflowNode for the input / output / default templates", () => {
      wrapper = mountCanvas();
      const nodes = wrapper.findAllComponents({ name: "WorkflowNode" });
      expect(nodes).toHaveLength(3);
    });

    it("passes the slot id + data straight through to WorkflowNode (no io_type prop)", () => {
      wrapper = mountCanvas();
      const node = wrapper.findComponent({ name: "WorkflowNode" });
      expect(node.props("id")).toBe("n1");
      expect(node.props("data")).toEqual({ node_type: "condition" });
      expect(node.props()).not.toHaveProperty("io_type");
    });
  });

  describe("edge template", () => {
    it("renders the shared FlowEdge for the custom edge type", () => {
      wrapper = mountCanvas();
      expect(wrapper.findComponent({ name: "FlowEdge" }).exists()).toBe(true);
    });

    it("maps every VueFlow edge prop onto FlowEdge", () => {
      wrapper = mountCanvas();
      const edge = wrapper.findComponent({ name: "FlowEdge" });
      expect(edge.props()).toMatchObject({
        id: "e1",
        sourceX: 1,
        sourceY: 2,
        targetX: 3,
        targetY: 4,
        sourcePosition: "bottom",
        targetPosition: "top",
        data: { foo: "bar" },
        markerEnd: "url(#arrow)",
        style: { stroke: "grey" },
      });
    });

    it("passes the resolved Branch-arm label onto FlowEdge", () => {
      wrapper = mountCanvas();
      expect(wrapper.findComponent({ name: "FlowEdge" }).props("label")).toBe("Severe (>=1000)");
    });

    // Without this the click-selected edge looks identical to every other edge,
    // so users conclude edges cannot be selected or deleted at all.
    it("passes VueFlow's selected flag onto FlowEdge so selection is visible", () => {
      wrapper = mountCanvas();
      expect(wrapper.findComponent({ name: "FlowEdge" }).props("selected")).toBe(true);
    });
  });

  // Two DIFFERENT start surfaces, and which one shows is the contract:
  //   • empty canvas          → the two-slot SCAFFOLD (Trigger + Action)
  //   • trigger missing, but
  //     steps already placed  → the single "Choose a Trigger" card
  describe("empty-canvas start node", () => {
    const startNode = (w: any) => w.find('[data-test="workflow-flow-start-node"]');
    const scaffold = (w: any) => w.find('[data-test="workflow-flow-start-scaffold"]');

    it("shows the two-slot scaffold when the canvas has no nodes", () => {
      wrapper = mountCanvas();
      expect(scaffold(wrapper).exists()).toBe(true);
      // Both slots are offered up front, so the trigger isn't a dead end.
      expect(wrapper.find('[data-test="workflow-flow-start-trigger"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="workflow-flow-start-action"]').exists()).toBe(true);
      // The single "trigger missing" card belongs to the non-empty case only.
      expect(startNode(wrapper).exists()).toBe(false);
    });

    it("hides the start node once a node exists", async () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      wrapper = mountCanvas();
      await nextTick();
      expect(startNode(wrapper).exists()).toBe(false);
      expect(scaffold(wrapper).exists()).toBe(false);
    });

    // The scaffold has no node to hang off, so it is SCREEN-anchored (centred in the
    // pane, below the top edge) — not pinned to flow origin, which sits at the pane's
    // top-left corner under the default viewport and puts the cards half off-screen.
    it("centres the scaffold in the pane, below the top edge", () => {
      vf.viewport.value = { x: 0, y: 0, zoom: 1 };
      wrapper = mountCanvas();
      const style = scaffold(wrapper).attributes("style") || "";
      // pane is 1000 wide in the mock → centre is 500px
      expect(style).toContain("--wf-ox: 500px");
      expect(style).toMatch(/--wf-oy:\s*(?!0px)\d/);
    });

    it("keeps the scaffold screen-anchored when the canvas is panned", () => {
      vf.viewport.value = { x: 240, y: -180, zoom: 1 };
      wrapper = mountCanvas();
      const style = scaffold(wrapper).attributes("style") || "";
      // panning the flow must not drag the scaffold off-centre
      expect(style).toContain("--wf-ox: 500px");
    });

    it("re-shows the scaffold when the last node is removed", async () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      wrapper = mountCanvas();
      await nextTick();
      wfObj.currentSelectedWorkflow.nodes = [];
      await nextTick();
      expect(scaffold(wrapper).exists()).toBe(true);
    });

    it("re-shows the start node when the trigger is deleted mid-graph (steps remain)", async () => {
      // Deleting the trigger while other steps are still on the canvas must
      // bring back the picker — the workflow has no trigger, not an empty canvas.
      wfObj.currentSelectedWorkflow.nodes = [
        triggerNode(),
        { id: "c1", position: { x: 0, y: 0 }, data: { node_type: "condition" } },
      ];
      wrapper = mountCanvas();
      await nextTick();
      expect(startNode(wrapper).exists()).toBe(false);
      // drop only the trigger, keep the condition step
      wfObj.currentSelectedWorkflow.nodes = [
        { id: "c1", position: { x: 0, y: 0 }, data: { node_type: "condition" } },
      ];
      await nextTick();
      expect(startNode(wrapper).exists()).toBe(true);
    });

    it("is hidden on the read-only Runs canvas", async () => {
      wfObj.readOnly = true;
      wrapper = mountCanvas();
      await nextTick();
      expect(startNode(wrapper).exists()).toBe(false);
      wfObj.readOnly = false;
    });
  });

  describe("one-shot trigger centering (onNodesInitialized)", () => {
    it("registers an onNodesInitialized callback", () => {
      wrapper = mountCanvas();
      expect(typeof vf.nodesInitializedCb).toBe("function");
    });

    it("centers the trigger horizontally, keeping its y and zoom", () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode(100, 40)];
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
      vf.viewport.value = { x: 0, y: -30, zoom: 1 };
      wrapper = mountCanvas();

      vf.nodesInitializedCb();

      // paneW/2 - (x + nodeW/2) * zoom = 500 - 200 = 300
      expect(vf.setViewport).toHaveBeenCalledWith({ x: 300, y: -30, zoom: 1 });
      expect(vf.findNode).toHaveBeenCalledWith("t1");
    });

    it("scales the centering by the current zoom", () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode(100, 40)];
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
      vf.viewport.value = { x: 0, y: 0, zoom: 0.5 };
      wrapper = mountCanvas();

      vf.nodesInitializedCb();

      // 500 - (100 + 100) * 0.5 = 400
      expect(vf.setViewport).toHaveBeenCalledWith({ x: 400, y: 0, zoom: 0.5 });
    });

    it("runs only once per editor mount", () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
      wrapper = mountCanvas();

      vf.nodesInitializedCb();
      vf.nodesInitializedCb();

      expect(vf.setViewport).toHaveBeenCalledTimes(1);
    });

    it("does nothing when there is no trigger node", () => {
      wfObj.currentSelectedWorkflow.nodes = [
        { id: "c1", position: { x: 0, y: 0 }, data: { node_type: "condition" } },
      ];
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
      wrapper = mountCanvas();

      vf.nodesInitializedCb();

      expect(vf.setViewport).not.toHaveBeenCalled();
    });

    it("does nothing when the canvas has no nodes at all", () => {
      wrapper = mountCanvas();
      vf.nodesInitializedCb();
      expect(vf.setViewport).not.toHaveBeenCalled();
    });

    it("retries later when the node has no measured width yet", () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      vf.findNode.mockReturnValue(undefined);
      wrapper = mountCanvas();

      vf.nodesInitializedCb();
      expect(vf.setViewport).not.toHaveBeenCalled();

      // dimensions become available on the next init -> it centers then
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
      vf.nodesInitializedCb();
      expect(vf.setViewport).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the pane has no width yet", () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
      vf.dimensions.value = { width: 0, height: 0 };
      wrapper = mountCanvas();

      vf.nodesInitializedCb();

      expect(vf.setViewport).not.toHaveBeenCalled();
    });

    it("treats a zero-width node as not-measured", () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      vf.findNode.mockReturnValue({ dimensions: { width: 0 } });
      wrapper = mountCanvas();

      vf.nodesInitializedCb();

      expect(vf.setViewport).not.toHaveBeenCalled();
    });
  });

  // Append `+` (option A): straight-down for every non-terminal node, but a node
  // whose centre slot is taken by a child reveals it on HOVER only; a leaf and a
  // free-centre (fanned-out) node keep it persistent.
  describe("append + (Option C: nothing at rest, node hover reveals)", () => {
    beforeEach(() => vf.findNode.mockReturnValue({ dimensions: { width: 200 } }));
    const count = (w: any) => w.findAll('[data-test="workflow-flow-append-add"]').length;

    it("shows no append + at rest and reveals only the hovered node's", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          { id: "c1", position: { x: 100, y: 240 }, data: { node_type: "condition" } },
        ],
        edges: [{ id: "e1", source: "t1", target: "c1" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      expect(count(wrapper)).toBe(0); // quiet at rest — even the leaf c1

      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "c1" } });
      await nextTick();
      expect(count(wrapper)).toBe(1); // only the hovered node's +

      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "t1" } });
      await nextTick();
      expect(count(wrapper)).toBe(1); // still just one — the newly hovered node
    });

    it("never offers a + on a terminal (output) node", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          { id: "d1", position: { x: 100, y: 240 }, data: { node_type: "destination" } },
        ],
        edges: [{ id: "e1", source: "t1", target: "d1" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "d1" } });
      await nextTick();
      expect(count(wrapper)).toBe(0); // d1 is terminal → never a +
    });
  });

  // P0 — a Branch's append `+` used to open the step picker with the literal
  // handle "out", so every step added from it produced an edge with NO
  // source_handle and the workflow failed its own path validation.
  describe("append + on a Branch: one per arm, each carrying its own handle", () => {
    beforeEach(() => vf.findNode.mockReturnValue({ dimensions: { width: 200 } }));
    const points = (w: any) => w.findAll('[data-test="workflow-flow-append-add"]');
    const branchWorkflow = () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          {
            id: "b1",
            position: { x: 100, y: 240 },
            data: {
              node_type: "branch",
              cases: [{ handle: "case-0" }, { handle: "case-1" }],
            },
          },
        ],
        edges: [{ id: "e1", source: "t1", target: "b1" }],
      };
    };

    it("reveals one append + per declared arm (3 paths → 3 points)", async () => {
      branchWorkflow();
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      expect(points(wrapper)).toHaveLength(3);
    });

    it('opens the step picker with THAT arm\'s handle, never "out"', async () => {
      branchWorkflow();
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      const buttons = wrapper.findAllComponents({ name: "FlowAddButton" });
      await buttons[0].vm.$emit("click", { clientX: 1, clientY: 2 });
      await buttons[2].vm.$emit("click", { clientX: 1, clientY: 2 });
      const calls = api.openStepPicker.mock.calls;
      expect(calls[0][0]).toBe("b1");
      expect(calls[0][1]).toBe("case-0");
      expect(calls[1][1]).toBe("else");
    });

    it("gives each arm's + a distinct horizontal offset so they do not stack", async () => {
      branchWorkflow();
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      const lefts = points(wrapper).map((p: any) => p.attributes("style"));
      expect(new Set(lefts).size).toBe(3);
    });

    it("a deleted middle path keeps stable handles on the + points", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          {
            id: "b1",
            position: { x: 100, y: 240 },
            data: {
              node_type: "branch",
              cases: [{ handle: "case-0" }, { handle: "case-2" }],
            },
          },
        ],
        edges: [{ id: "e1", source: "t1", target: "b1" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      const buttons = wrapper.findAllComponents({ name: "FlowAddButton" });
      await buttons[1].vm.$emit("click", { clientX: 1, clientY: 2 });
      expect(api.openStepPicker.mock.calls[0][1]).toBe("case-2");
    });

    // The arm `+` hangs directly under its handle, so its connector graphic would
    // otherwise swallow the mousedown that STARTS a wiring drag — the affordance
    // for adding a step must never block the gesture for connecting one.
    it("lets pointer events through the + connector so the handle under it stays draggable", async () => {
      branchWorkflow();
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      const pt = wrapper.find('[data-test="workflow-flow-append-add"]');
      expect(pt.classes()).toContain("pointer-events-none");
      // ...but the button inside it must still be clickable.
      const btn = wrapper.findComponent({ name: "FlowAddButton" });
      expect(btn.classes()).toContain("pointer-events-auto");
    });

    // A wired arm already leads somewhere; re-offering its `+` made a fully wired
    // 3-arm Branch sprout 3 MORE arrows on hover — the reported "always three".
    it("omits the + for an arm that is already wired", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          {
            id: "b1",
            position: { x: 100, y: 240 },
            data: {
              node_type: "branch",
              cases: [{ handle: "case-0" }, { handle: "case-1" }],
            },
          },
          { id: "d1", position: { x: 0, y: 440 }, data: { node_type: "destination" } },
        ],
        edges: [
          { id: "e1", source: "t1", target: "b1" },
          { id: "e2", source: "b1", target: "d1", sourceHandle: "case-0" },
        ],
      };
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      const pts = points(wrapper);
      expect(pts).toHaveLength(2);
      // Each + must sit ON its own arm's handle (case-1 is the middle of three, so the
      // node centre), not spread as if the unwired arms were the only ones.
      expect(pts[0].attributes("style")).toContain("--wf-ox: 200px");
      const buttons = wrapper.findAllComponents({ name: "FlowAddButton" });
      await buttons[0].vm.$emit("click", { clientX: 1, clientY: 2 });
      expect(api.openStepPicker.mock.calls[0][1]).toBe("case-1");
    });

    it("still offers a + for a new path when every arm is wired", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          {
            id: "b1",
            position: { x: 100, y: 240 },
            data: {
              node_type: "branch",
              cases: [{ handle: "case-0" }, { handle: "case-1" }],
            },
          },
          { id: "d1", position: { x: 0, y: 440 }, data: { node_type: "destination" } },
          { id: "d2", position: { x: 200, y: 440 }, data: { node_type: "destination" } },
          { id: "d3", position: { x: 400, y: 440 }, data: { node_type: "destination" } },
        ],
        edges: [
          { id: "e1", source: "t1", target: "b1" },
          { id: "e2", source: "b1", target: "d1", sourceHandle: "case-0" },
          { id: "e3", source: "b1", target: "d2", sourceHandle: "case-1" },
          { id: "e4", source: "b1", target: "d3", sourceHandle: "else" },
        ],
      };
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      // Every other node type keeps its + when wired; a Branch losing its only canvas
      // affordance made a further path unreachable without opening the drawer.
      const pts = points(wrapper);
      expect(pts).toHaveLength(1);
      // Not the node centre — that is the middle arm's edge and its own mid-edge +.
      expect(pts[0].attributes("style")).not.toContain("--wf-ox: 200px");
    });

    // A case-less Branch declares no handles at all now, so its + must MINT a
    // path — an "out" + here would wire a handle-less edge the backend rejects.
    it("a case-less branch offers one + that mints a path instead of legacy arms", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          { id: "b1", position: { x: 100, y: 240 }, data: { node_type: "branch" } },
        ],
        edges: [{ id: "e1", source: "t1", target: "b1" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "b1" } });
      await nextTick();
      const pts = points(wrapper);
      expect(pts).toHaveLength(1);
      const buttons = wrapper.findAllComponents({ name: "FlowAddButton" });
      await buttons[0].vm.$emit("click", { clientX: 1, clientY: 2 });
      expect(api.openStepPicker.mock.calls[0][1]).toBe("__new_path__");
    });

    it('a NON-branch node still gets exactly one + carrying "out"', async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "t1", position: { x: 100, y: 40 }, data: { node_type: "workflow_trigger" } },
          { id: "c1", position: { x: 100, y: 240 }, data: { node_type: "condition" } },
        ],
        edges: [{ id: "e1", source: "t1", target: "c1" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "c1" } });
      await nextTick();
      expect(points(wrapper)).toHaveLength(1);
      const button = wrapper.findComponent({ name: "FlowAddButton" });
      await button.vm.$emit("click", { clientX: 1, clientY: 2 });
      expect(api.openStepPicker.mock.calls[0][1]).toBe("out");
    });
  });

  describe("edge insert + (Option C: revealed by endpoint-node hover)", () => {
    beforeEach(() => vf.findNode.mockReturnValue({ dimensions: { width: 200 } }));
    const insertable = (w: any) => w.findComponent({ name: "FlowEdge" }).props("insertable");

    it("hides the mid-edge + until an endpoint node is hovered", async () => {
      // The mocked VueFlow renders edge-custom for edge id "e1"; wire e1 to n1→n2.
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "n1", position: { x: 100, y: 40 }, data: { node_type: "condition" } },
          { id: "n2", position: { x: 100, y: 240 }, data: { node_type: "condition" } },
        ],
        edges: [{ id: "e1", source: "n1", target: "n2" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      expect(insertable(wrapper)).toBe(false); // quiet at rest

      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n1" } });
      await nextTick();
      expect(insertable(wrapper)).toBe(true); // source hovered → revealed

      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n2" } });
      await nextTick();
      expect(insertable(wrapper)).toBe(true); // target hovered → still revealed
    });

    it("reveals the mid-edge + when the edge line itself is hovered", async () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "n1", position: { x: 100, y: 40 }, data: { node_type: "condition" } },
          { id: "n2", position: { x: 100, y: 240 }, data: { node_type: "condition" } },
        ],
        edges: [{ id: "e1", source: "n1", target: "n2" }],
      };
      wrapper = mountCanvas();
      await nextTick();
      expect(insertable(wrapper)).toBe(false); // no node hovered

      flow(wrapper).vm.$emit("edge-mouse-enter", { edge: { id: "e1" } });
      await nextTick();
      expect(insertable(wrapper)).toBe(true); // edge line hovered → revealed
    });
  });

  describe("Option C reveal timing + keep-alive (15s delay)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vf.findNode.mockReturnValue({ dimensions: { width: 200 } });
    });
    afterEach(() => vi.useRealTimers());

    const count = (w: any) => w.findAll('[data-test="workflow-flow-append-add"]').length;
    const insertable = (w: any) => w.findComponent({ name: "FlowEdge" }).props("insertable");
    const oneNode = () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [{ id: "n1", position: { x: 100, y: 40 }, data: { node_type: "condition" } }],
        edges: [],
      };
    };
    const twoNodesOneEdge = () => {
      wfObj.currentSelectedWorkflow = {
        nodes: [
          { id: "n1", position: { x: 100, y: 40 }, data: { node_type: "condition" } },
          { id: "n2", position: { x: 100, y: 240 }, data: { node_type: "condition" } },
        ],
        edges: [{ id: "e1", source: "n1", target: "n2" }],
      };
    };

    // The long delay only covers travel to the `+`; moving to another node must swap
    // the reveal at once rather than leaving two nodes lit for 15s.
    it("drops the previous node's + as soon as another node is hovered", async () => {
      twoNodesOneEdge();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n1" } });
      await nextTick();
      expect(count(wrapper)).toBe(1);

      flow(wrapper).vm.$emit("node-mouse-leave");
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n2" } });
      await nextTick();
      const pts = wrapper.findAll('[data-test="workflow-flow-append-add"]');
      expect(pts).toHaveLength(1);
      expect(pts[0].attributes("style")).toContain("--wf-oy: 294px");
    });

    it("holds the node's + for the full delay after leaving, then hides", async () => {
      oneNode();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n1" } });
      await nextTick();
      expect(count(wrapper)).toBe(1);

      flow(wrapper).vm.$emit("node-mouse-leave");
      vi.advanceTimersByTime(14999);
      await nextTick();
      expect(count(wrapper)).toBe(1); // still up just before the delay elapses

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(count(wrapper)).toBe(0); // hidden once the delay elapses
    });

    it("cancels the node hide when the cursor lands on the append +", async () => {
      oneNode();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n1" } });
      await nextTick();

      flow(wrapper).vm.$emit("node-mouse-leave"); // hide scheduled
      vi.advanceTimersByTime(100);
      // Cursor reaches the + chip mid-travel — its mouseenter freezes the timer.
      await wrapper.find('[data-test="workflow-flow-append-add"]').trigger("mouseenter");
      vi.advanceTimersByTime(15000);
      await nextTick();
      expect(count(wrapper)).toBe(1); // still visible — never hid
    });

    it("holds the edge + for the full delay after the edge line is left, then hides", async () => {
      twoNodesOneEdge();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("edge-mouse-enter", { edge: { id: "e1" } });
      await nextTick();
      expect(insertable(wrapper)).toBe(true);

      flow(wrapper).vm.$emit("edge-mouse-leave");
      vi.advanceTimersByTime(14999);
      await nextTick();
      expect(insertable(wrapper)).toBe(true);

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(insertable(wrapper)).toBe(false);
    });

    it("keeps the edge + alive when the cursor moves onto it (insert-enter)", async () => {
      twoNodesOneEdge();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("edge-mouse-enter", { edge: { id: "e1" } });
      await nextTick();

      flow(wrapper).vm.$emit("edge-mouse-leave"); // hide scheduled
      vi.advanceTimersByTime(100);
      wrapper.findComponent({ name: "FlowEdge" }).vm.$emit("insert-enter"); // onto the +
      vi.advanceTimersByTime(15000);
      await nextTick();
      expect(insertable(wrapper)).toBe(true); // frozen while on the chip

      wrapper.findComponent({ name: "FlowEdge" }).vm.$emit("insert-leave"); // off the +
      vi.advanceTimersByTime(15000);
      await nextTick();
      expect(insertable(wrapper)).toBe(false); // released → hides
    });
  });

  // Keyboard delete must funnel through the SAME confirm flow as the trash button:
  // VueFlow's default delete-key handling removes selected elements directly, which
  // silently destroyed a just-configured node (still selected after its drawer closed).
  describe("keyboard node delete goes through the confirm flow", () => {
    const keydown = (key: string) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));

    beforeEach(() => {
      vf.getSelectedEdges.value = [];
      vf.getSelectedNodes.value = [];
      wfObj.readOnly = false;
    });

    it("🔑 disables VueFlow's built-in delete keys (delete-key-code null)", () => {
      wrapper = mountCanvas();
      expect(flow(wrapper).props("deleteKeyCode")).toBeNull();
    });

    it("🔑 Backspace on a selected node asks for confirmation instead of deleting", () => {
      wrapper = mountCanvas();
      vf.getSelectedNodes.value = [{ id: "n1" }];
      keydown("Backspace");
      expect(api.requestDeleteNode).toHaveBeenCalledWith("n1");
      expect(vf.removeEdges).not.toHaveBeenCalled();
    });

    it("Delete triggers the same confirm; a selected edge still wins (direct removal)", () => {
      wrapper = mountCanvas();
      vf.getSelectedEdges.value = [{ id: "e1" }];
      vf.getSelectedNodes.value = [{ id: "n1" }];
      keydown("Delete");
      expect(vf.removeEdges).toHaveBeenCalledWith(["e1"]);
      expect(api.requestDeleteNode).not.toHaveBeenCalled();
    });

    it("is inert on the read-only Runs canvas", () => {
      wrapper = mountCanvas();
      wfObj.readOnly = true;
      vf.getSelectedNodes.value = [{ id: "n1" }];
      keydown("Backspace");
      expect(api.requestDeleteNode).not.toHaveBeenCalled();
    });
  });
});
