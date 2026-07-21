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

// WorkflowView is the read-only mini graph preview rendered inside the list row's
// "view" tooltip. Its whole contract is: derive VueFlow nodes/edges from the raw
// workflow row, and re-fit the view whenever the container resizes.

import { vi } from "vitest";

const { mockFitView } = vi.hoisted(() => ({ mockFitView: vi.fn() }));

// VueFlow stub: records the nodes/edges it receives and exposes fitView (the
// component calls it through a template ref).
vi.mock("@vue-flow/core", () => ({
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges", "minZoom"],
    emits: ["update:nodes", "update:edges", "nodes-initialized"],
    methods: { fitView: (...args: any[]) => mockFitView(...args) },
    // Render the node/edge scoped slots the way VueFlow would, so the preview's
    // slot templates (WorkflowNode / FlowEdge wiring) are actually exercised.
    template: `
      <div class="mock-vue-flow">
        <slot />
        <template v-for="n in nodes" :key="n.id">
          <slot :name="'node-' + n.type" :id="n.id" :data="n.data" />
        </template>
        <template v-for="e in edges" :key="e.id">
          <slot
            name="edge-custom"
            :id="e.id"
            :sourceX="1" :sourceY="2" :targetX="3" :targetY="4"
            :sourcePosition="'bottom'" :targetPosition="'top'"
            :data="e.data" :markerEnd="e.markerEnd" :style="e.style"
          />
        </template>
      </div>
    `,
  },
  useVueFlow: () => ({
    screenToFlowCoordinate: vi.fn(),
    onNodesInitialized: vi.fn(),
    updateNode: vi.fn(),
  }),
}));

vi.mock("@vue-flow/background", () => ({
  Background: {
    name: "Background",
    props: ["size", "gap", "patternColor"],
    template: '<div class="mock-background" />',
  },
}));

vi.mock("@/plugins/workflows/WorkflowNode.vue", () => ({
  default: {
    name: "WorkflowNode",
    props: ["id", "data"],
    template: '<div class="mock-node" :data-id="id" />',
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
      "isInView",
    ],
    template: '<div class="mock-edge" :data-id="id" />',
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => `mock-${p}`,
  getUUID: () => "uuid-1",
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowView from "./WorkflowView.vue";

// jsdom has no ResizeObserver — capture the callback so we can fire a resize.
let roCallback: (() => void) | null = null;
const roObserve = vi.fn();
const roDisconnect = vi.fn();
class MockResizeObserver {
  constructor(cb: () => void) {
    roCallback = cb;
  }
  observe = roObserve;
  disconnect = roDisconnect;
  unobserve = vi.fn();
}
(globalThis as any).ResizeObserver = MockResizeObserver;

const mountView = (workflow: any) =>
  mount(WorkflowView, {
    props: { workflow },
    global: { plugins: [i18n, store] },
  });

const vueFlow = (wrapper: any) => wrapper.findComponent({ name: "VueFlow" });

const graph = {
  nodes: [
    {
      id: "t1",
      position: { x: 0, y: 0 },
      data: { node_type: "workflow_trigger", label: "t1" },
    },
    {
      id: "c1",
      position: { x: 0, y: 160 },
      data: { node_type: "condition", label: "c1" },
    },
    {
      id: "d1",
      position: { x: 0, y: 320 },
      data: { node_type: "destination", label: "d1" },
    },
  ],
  edges: [
    { id: "e1", source: "t1", target: "c1" },
    { id: "e2", source: "c1", target: "d1" },
  ],
};

describe("WorkflowView", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    roCallback = null;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  describe("rendering", () => {
    it("renders the preview container and the flow canvas", () => {
      wrapper = mountView(graph);
      expect(wrapper.find(".workflow-view-tooltip").exists()).toBe(true);
      expect(vueFlow(wrapper).exists()).toBe(true);
      expect(wrapper.find(".mock-background").exists()).toBe(true);
    });
  });

  describe("node derivation", () => {
    it("derives the VueFlow render template from node_type", () => {
      wrapper = mountView(graph);
      const nodes = vueFlow(wrapper).props("nodes");
      expect(nodes.map((n: any) => n.type)).toEqual([
        "input",
        "default",
        "output",
      ]);
    });

    it("preserves the original node fields", () => {
      wrapper = mountView(graph);
      const nodes = vueFlow(wrapper).props("nodes");
      expect(nodes[0].id).toBe("t1");
      expect(nodes[0].position).toEqual({ x: 0, y: 0 });
      expect(nodes[0].data.node_type).toBe("workflow_trigger");
    });

    it("falls back to the persisted io_type for an unknown node_type", () => {
      wrapper = mountView({
        nodes: [{ id: "x", io_type: "output", data: { node_type: "mystery" } }],
        edges: [],
      });
      expect(vueFlow(wrapper).props("nodes")[0].type).toBe("output");
    });

    it("falls back to 'default' when there is neither meta nor io_type", () => {
      wrapper = mountView({ nodes: [{ id: "x", data: {} }], edges: [] });
      expect(vueFlow(wrapper).props("nodes")[0].type).toBe("default");
    });

    it("handles a node with no data at all", () => {
      wrapper = mountView({ nodes: [{ id: "x" }], edges: [] });
      expect(vueFlow(wrapper).props("nodes")[0].type).toBe("default");
    });

    it("renders no nodes for a workflow without a nodes array", () => {
      wrapper = mountView({});
      expect(vueFlow(wrapper).props("nodes")).toEqual([]);
    });

    it("renders no nodes when the workflow prop is null", () => {
      wrapper = mountView(null);
      expect(vueFlow(wrapper).props("nodes")).toEqual([]);
      expect(vueFlow(wrapper).props("edges")).toEqual([]);
    });
  });

  describe("edge derivation", () => {
    it("styles every edge as an animated custom edge with an arrow marker", () => {
      wrapper = mountView(graph);
      const edges = vueFlow(wrapper).props("edges");
      expect(edges).toHaveLength(2);
      for (const e of edges) {
        expect(e.type).toBe("custom");
        expect(e.animated).toBe(true);
        expect(e.style).toEqual({ strokeWidth: 2 });
        expect(e.markerEnd).toEqual({
          type: "arrowclosed",
          width: 20,
          height: 20,
        });
      }
      expect(edges.map((e: any) => e.id)).toEqual(["e1", "e2"]);
      expect(edges[0].source).toBe("t1");
      expect(edges[0].target).toBe("c1");
    });

    it("renders no edges for a workflow without an edges array", () => {
      wrapper = mountView({ nodes: [] });
      expect(vueFlow(wrapper).props("edges")).toEqual([]);
    });
  });

  describe("slot rendering", () => {
    it("renders a WorkflowNode for every node template (input / default / output)", () => {
      wrapper = mountView(graph);
      const nodes = wrapper.findAllComponents({ name: "WorkflowNode" });
      expect(nodes).toHaveLength(3);
      expect(nodes.map((n: any) => n.props("id"))).toEqual(["t1", "c1", "d1"]);
      expect(nodes[0].props("data").node_type).toBe("workflow_trigger");
    });

    it("renders a FlowEdge for every edge, always in view", () => {
      wrapper = mountView(graph);
      const edges = wrapper.findAllComponents({ name: "FlowEdge" });
      expect(edges).toHaveLength(2);
      expect(edges[0].props()).toMatchObject({
        id: "e1",
        sourceX: 1,
        sourceY: 2,
        targetX: 3,
        targetY: 4,
        sourcePosition: "bottom",
        targetPosition: "top",
        isInView: true,
        markerEnd: { type: "arrowclosed", width: 20, height: 20 },
      });
    });
  });

  describe("fit-to-view", () => {
    it("fits the view once the nodes are initialized", async () => {
      wrapper = mountView(graph);
      expect(mockFitView).not.toHaveBeenCalled();

      vueFlow(wrapper).vm.$emit("nodes-initialized");
      await nextTick();
      await nextTick();

      expect(mockFitView).toHaveBeenCalledWith({ padding: 0.25 });
    });

    it("observes the container and re-fits on resize", async () => {
      wrapper = mountView(graph);
      expect(roObserve).toHaveBeenCalledTimes(1);
      expect(roObserve.mock.calls[0][0]).toBe(
        wrapper.find(".workflow-view-tooltip").element,
      );

      roCallback?.();
      await nextTick();
      await nextTick();

      expect(mockFitView).toHaveBeenCalledWith({ padding: 0.25 });
    });

    it("disconnects the ResizeObserver on unmount", () => {
      wrapper = mountView(graph);
      wrapper.unmount();
      wrapper = null;
      expect(roDisconnect).toHaveBeenCalledTimes(1);
    });
  });
});
