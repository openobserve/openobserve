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
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    dimensions: ref({ width: 1000, height: 600 }),
  };
  return {
    __state: state,
    VueFlow: {
      name: "VueFlow",
      props: ["nodes", "edges", "defaultViewport", "minZoom", "maxZoom"],
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
      "insertable",
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
  };
  return {
    default: () => api,
    // Named exports the canvas imports directly (undo history + tidy).
    workflowHistory: reactive({ past: <any[]>[], future: <any[]>[] }),
    pushWorkflowHistory: vi.fn(),
    undoWorkflow: vi.fn(),
    redoWorkflow: vi.fn(),
    tidyWorkflowLayout: vi.fn(),
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

  describe("Option C reveal timing + keep-alive (300ms delay)", () => {
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

    it("holds the node's + for the full 300ms after leaving, then hides", async () => {
      oneNode();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("node-mouse-enter", { node: { id: "n1" } });
      await nextTick();
      expect(count(wrapper)).toBe(1);

      flow(wrapper).vm.$emit("node-mouse-leave");
      vi.advanceTimersByTime(299);
      await nextTick();
      expect(count(wrapper)).toBe(1); // still up just before the delay elapses

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(count(wrapper)).toBe(0); // hidden at 300ms
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
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(count(wrapper)).toBe(1); // still visible — never hid
    });

    it("holds the edge + for 300ms after the edge line is left, then hides", async () => {
      twoNodesOneEdge();
      wrapper = mountCanvas();
      flow(wrapper).vm.$emit("edge-mouse-enter", { edge: { id: "e1" } });
      await nextTick();
      expect(insertable(wrapper)).toBe(true);

      flow(wrapper).vm.$emit("edge-mouse-leave");
      vi.advanceTimersByTime(299);
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
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(insertable(wrapper)).toBe(true); // frozen while on the chip

      wrapper.findComponent({ name: "FlowEdge" }).vm.$emit("insert-leave"); // off the +
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(insertable(wrapper)).toBe(false); // released → hides
    });
  });
});
