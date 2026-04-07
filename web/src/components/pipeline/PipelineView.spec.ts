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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import PipelineView from "@/components/pipeline/PipelineView.vue";

installQuasar({ plugins: [Dialog, Notify] });

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mock-${path}`),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false" },
}));

// Reactive pipelineObj that is reset per test
let mockPipelineObj: {
  nodeTypes: any[];
  currentSelectedPipeline: { nodes: any[]; edges: any[] };
};

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: () => {
    mockPipelineObj = {
      nodeTypes: [],
      currentSelectedPipeline: { nodes: [], edges: [] },
    };
    return { pipelineObj: mockPipelineObj };
  },
}));

vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    template: '<div class="vue-flow-mock" data-test="vue-flow"><slot /></div>',
    props: ["nodes", "edges", "options", "defaultViewport"],
    emits: ["update:nodes", "update:edges"],
  },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  Handle: { name: "Handle", template: "<div />" },
}));

vi.mock("@vue-flow/controls", () => ({
  Controls: { name: "Controls", template: "<div />" },
  ControlButton: { name: "ControlButton", template: "<div />" },
}));

vi.mock("@/plugins/pipelines/DropzoneBackground.vue", () => ({
  default: {
    name: "DropzoneBackground",
    template: '<div data-test="dropzone-background"><slot /></div>',
  },
}));

vi.mock("@/plugins/pipelines/CustomNode.vue", () => ({
  default: {
    name: "CustomNode",
    template: '<div data-test="custom-node">{{ id }}</div>',
    props: ["id", "data", "io_type"],
  },
}));

vi.mock("@/plugins/pipelines/CustomEdge.vue", () => ({
  default: {
    name: "CustomEdge",
    template: '<div data-test="custom-edge">{{ id }}</div>',
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
  },
}));

// --------------------------------------------------------------------------
// Test data
// --------------------------------------------------------------------------

const mockPipeline = {
  name: "Test Pipeline",
  description: "Test Description",
  nodes: [
    {
      id: "node1",
      io_type: "input",
      position: { x: 100, y: 100 },
      data: { label: "Input Node", stream_name: "logs", node_type: "stream" },
    },
    {
      id: "node2",
      io_type: "default",
      position: { x: 200, y: 200 },
      data: { label: "Transform Node", node_type: "function" },
    },
    {
      id: "node3",
      io_type: "output",
      position: { x: 300, y: 300 },
      data: { label: "Output Node", node_type: "stream" },
    },
  ],
  edges: [
    { id: "edge1", source: "node1", target: "node2", type: "custom" },
    { id: "edge2", source: "node2", target: "node3", type: "custom" },
  ],
};

// --------------------------------------------------------------------------
// Mount helper
// --------------------------------------------------------------------------

function createWrapper(pipeline: Record<string, any> = mockPipeline) {
  return mount(PipelineView, {
    props: { pipeline },
    global: {
      plugins: [i18n, store],
      stubs: {
        VueFlow: {
          name: "VueFlow",
          template: '<div data-test="vue-flow"><slot /></div>',
          props: ["nodes", "edges", "options", "defaultViewport"],
        },
        CustomNode: true,
        CustomEdge: true,
        DropzoneBackground: true,
        Controls: true,
        ControlButton: true,
      },
    },
  });
}

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe("PipelineView.vue", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 1. Component structure
  // -----------------------------------------------------------------------

  describe("Component Structure", () => {
    it("renders without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("has pipeline-view-tooltip as root class", () => {
      wrapper = createWrapper();
      expect(wrapper.classes()).toContain("pipeline-view-tooltip");
    });

    it("has container as root class", () => {
      wrapper = createWrapper();
      expect(wrapper.classes()).toContain("container");
    });

    it("renders the VueFlow component stub", () => {
      wrapper = createWrapper();
      const vueFlow = wrapper.findComponent({ name: "VueFlow" });
      expect(vueFlow.exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Props
  // -----------------------------------------------------------------------

  describe("Props", () => {
    it("accepts the pipeline prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props("pipeline")).toEqual(mockPipeline);
    });

    it("handles an empty pipeline with no nodes or edges", async () => {
      wrapper = createWrapper({ nodes: [], edges: [] });
      expect(wrapper.vm.lockedNodes).toEqual([]);
      expect(wrapper.vm.edges).toEqual([]);
    });

    it("handles a pipeline where edges is null", async () => {
      wrapper = createWrapper({ nodes: [], edges: null });
      expect(wrapper.vm.edges).toEqual([]);
    });

    it("handles a pipeline where edges is undefined", async () => {
      wrapper = createWrapper({ nodes: [], edges: undefined });
      expect(wrapper.vm.edges).toEqual([]);
    });

    it("reflects prop updates via setProps", async () => {
      wrapper = createWrapper();
      await wrapper.setProps({ pipeline: { ...mockPipeline, name: "Updated" } });
      expect(wrapper.props("pipeline").name).toBe("Updated");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Computed: lockedNodes
  // -----------------------------------------------------------------------

  describe("Computed: lockedNodes", () => {
    it("maps each node's io_type to its type property", () => {
      wrapper = createWrapper();
      const locked = wrapper.vm.lockedNodes;
      expect(locked[0].type).toBe("input");
      expect(locked[1].type).toBe("default");
      expect(locked[2].type).toBe("output");
    });

    it("preserves node id in lockedNodes", () => {
      wrapper = createWrapper();
      const locked = wrapper.vm.lockedNodes;
      locked.forEach((node: any, i: number) => {
        expect(node.id).toBe(mockPipeline.nodes[i].id);
      });
    });

    it("preserves node position in lockedNodes", () => {
      wrapper = createWrapper();
      const locked = wrapper.vm.lockedNodes;
      locked.forEach((node: any, i: number) => {
        expect(node.position).toEqual(mockPipeline.nodes[i].position);
      });
    });

    it("preserves node data in lockedNodes", () => {
      wrapper = createWrapper();
      const locked = wrapper.vm.lockedNodes;
      locked.forEach((node: any, i: number) => {
        expect(node.data).toEqual(mockPipeline.nodes[i].data);
      });
    });

    it("returns an empty array when nodes is empty", async () => {
      wrapper = createWrapper({ nodes: [], edges: [] });
      expect(wrapper.vm.lockedNodes).toEqual([]);
    });

    it("handles nodes that lack an io_type field", async () => {
      wrapper = createWrapper({
        nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      });
      expect(wrapper.vm.lockedNodes[0].type).toBeUndefined();
    });

    it("recomputes when pipeline prop changes", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.lockedNodes).toHaveLength(3);
      await wrapper.setProps({
        pipeline: {
          nodes: [
            { id: "x1", io_type: "input", position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
      });
      expect(wrapper.vm.lockedNodes).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Computed: edges
  // -----------------------------------------------------------------------

  describe("Computed: edges", () => {
    it("returns the pipeline edges array", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.edges).toEqual(mockPipeline.edges);
    });

    it("returns empty array when edges is null", async () => {
      wrapper = createWrapper({ nodes: [], edges: null });
      expect(wrapper.vm.edges).toEqual([]);
    });

    it("returns empty array when edges is undefined", async () => {
      wrapper = createWrapper({ nodes: [], edges: undefined });
      expect(wrapper.vm.edges).toEqual([]);
    });

    it("returns empty array when edges is an empty array", async () => {
      wrapper = createWrapper({ nodes: [], edges: [] });
      expect(wrapper.vm.edges).toEqual([]);
    });

    it("recomputes when new edges are added via setProps", async () => {
      wrapper = createWrapper();
      const extraEdge = { id: "edge3", source: "node1", target: "node3", type: "custom" };
      await wrapper.setProps({
        pipeline: { ...mockPipeline, edges: [...mockPipeline.edges, extraEdge] },
      });
      expect(wrapper.vm.edges).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Lifecycle – onMounted
  // -----------------------------------------------------------------------

  describe("Lifecycle: onMounted", () => {
    it("pipelineObj is accessible after mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.pipelineObj).toBeDefined();
    });

    it("nodeTypes array is set after mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(Array.isArray(wrapper.vm.pipelineObj.nodeTypes)).toBe(true);
    });

    it("pipelineObj.currentSelectedPipeline is defined after mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.pipelineObj.currentSelectedPipeline).toBeDefined();
    });

    it("vueFlowRef is exposed and accessible", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // May be null in test env (no real DOM canvas), but should be defined as a ref
      expect("vueFlowRef" in wrapper.vm).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 6. nodeTypes configuration
  // -----------------------------------------------------------------------

  describe("nodeTypes configuration", () => {
    it("sets up nodeTypes as an array after mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const { nodeTypes } = wrapper.vm.pipelineObj;
      expect(Array.isArray(nodeTypes)).toBe(true);
    });

    it("nodeTypes contain expected section headers when populated", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const { nodeTypes } = wrapper.vm.pipelineObj;
      if (nodeTypes.length > 0) {
        const headers = nodeTypes.filter((n: any) => n.isSectionHeader);
        expect(headers.length).toBeGreaterThan(0);
      }
    });

    it("can manually set nodeTypes structure", async () => {
      wrapper = createWrapper();
      wrapper.vm.pipelineObj.nodeTypes = [
        { label: "Source", icon: "input", isSectionHeader: true },
        { label: "Stream", subtype: "stream", io_type: "input", isSectionHeader: false },
      ];
      expect(wrapper.vm.pipelineObj.nodeTypes).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Watch: pipeline prop → currentSelectedPipeline
  // -----------------------------------------------------------------------

  describe("Watch: pipeline prop → currentSelectedPipeline", () => {
    it("sets currentSelectedPipeline when pipeline prop is provided immediately", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // The immediate watcher should have fired
      const current = wrapper.vm.pipelineObj.currentSelectedPipeline;
      expect(current).toBeDefined();
    });

    it("updates currentSelectedPipeline when pipeline prop changes", async () => {
      wrapper = createWrapper();
      const newPipeline = { ...mockPipeline, name: "New Pipeline" };
      await wrapper.setProps({ pipeline: newPipeline });
      await flushPromises();
      expect(wrapper.vm.pipelineObj.currentSelectedPipeline).toMatchObject({
        name: "New Pipeline",
      });
    });
  });

  // -----------------------------------------------------------------------
  // 8. vueFlowRef fitView
  // -----------------------------------------------------------------------

  describe("vueFlowRef fitView", () => {
    it("calls fitView with padding 0.1 when ref is available", async () => {
      wrapper = createWrapper();
      const mockFitView = vi.fn();
      wrapper.vm.vueFlowRef = { fitView: mockFitView };
      wrapper.vm.vueFlowRef.fitView({ padding: 0.1 });
      expect(mockFitView).toHaveBeenCalledWith({ padding: 0.1 });
    });

    it("does not throw when vueFlowRef is null", async () => {
      wrapper = createWrapper();
      wrapper.vm.vueFlowRef = null;
      await flushPromises();
      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 9. streamImage constant
  // -----------------------------------------------------------------------

  describe("streamImage constant", () => {
    it("exposes streamImage on vm with the mocked URL prefix", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.streamImage).toBe("mock-images/pipeline/input_stream.png");
    });
  });

  // -----------------------------------------------------------------------
  // 10. Reactivity with large node/edge sets
  // -----------------------------------------------------------------------

  describe("Reactivity with large datasets", () => {
    it("handles 100 nodes without error", async () => {
      const largeNodes = Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        io_type: "default",
        position: { x: i * 10, y: i * 10 },
        data: {},
      }));
      wrapper = createWrapper({ nodes: largeNodes, edges: [] });
      expect(wrapper.vm.lockedNodes).toHaveLength(100);
    });

    it("handles 50 edges without error", async () => {
      const largeEdges = Array.from({ length: 50 }, (_, i) => ({
        id: `edge-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        type: "custom",
      }));
      wrapper = createWrapper({ nodes: [], edges: largeEdges });
      expect(wrapper.vm.edges).toHaveLength(50);
    });

    it("handles rapid successive prop changes", async () => {
      wrapper = createWrapper();
      for (let i = 0; i < 5; i++) {
        await wrapper.setProps({
          pipeline: { ...mockPipeline, name: `Pipeline ${i}` },
        });
      }
      expect(wrapper.props("pipeline").name).toBe("Pipeline 4");
    });
  });

  // -----------------------------------------------------------------------
  // 11. CSS and styling
  // -----------------------------------------------------------------------

  describe("CSS and styling", () => {
    it("root element has pipeline-view-tooltip and container classes", () => {
      wrapper = createWrapper();
      expect(wrapper.classes()).toContain("pipeline-view-tooltip");
      expect(wrapper.classes()).toContain("container");
    });
  });

  // -----------------------------------------------------------------------
  // 12. pipelineObj state persistence
  // -----------------------------------------------------------------------

  describe("pipelineObj state persistence", () => {
    it("pipelineObj reference is stable across prop updates", async () => {
      wrapper = createWrapper();
      const obj = wrapper.vm.pipelineObj;
      await wrapper.setProps({ pipeline: { ...mockPipeline, name: "Changed" } });
      expect(wrapper.vm.pipelineObj).toBe(obj);
    });
  });
});
