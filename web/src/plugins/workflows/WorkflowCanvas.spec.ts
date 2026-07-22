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
    useVueFlow: () => ({
      onNodesInitialized: (cb: any) => {
        state.nodesInitializedCb = cb;
      },
      setViewport: state.setViewport,
      findNode: state.findNode,
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
    }),
    onNodeChange: vi.fn(),
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
  };
  return { default: () => api };
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
    it("uses a 0.9 default zoom and the 0.2 - 4 zoom bounds", () => {
      wrapper = mountCanvas();
      expect(flow(wrapper).props("defaultViewport")).toEqual({ zoom: 0.9 });
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

  describe("empty-state hint", () => {
    it("shows the hint when the canvas has no nodes", () => {
      wrapper = mountCanvas();
      const hint = wrapper.find('[data-test="workflow-flow-empty-text"]');
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toBe("Add A Trigger To Start Building Your Workflow");
    });

    it("hides the hint once a node exists", async () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      wrapper = mountCanvas();
      await nextTick();
      expect(wrapper.find('[data-test="workflow-flow-empty-text"]').exists()).toBe(false);
    });

    it("re-shows the hint when the last node is removed", async () => {
      wfObj.currentSelectedWorkflow.nodes = [triggerNode()];
      wrapper = mountCanvas();
      await nextTick();
      wfObj.currentSelectedWorkflow.nodes = [];
      await nextTick();
      expect(wrapper.find('[data-test="workflow-flow-empty-text"]').exists()).toBe(true);
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
});
