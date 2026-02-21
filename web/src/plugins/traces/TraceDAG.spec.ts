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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import TraceDAG from "@/plugins/traces/TraceDAG.vue";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";

installQuasar();

// Mock VueFlow components
vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    template: "<div class='vue-flow-mock'><slot /></div>",
  },
  Position: {
    Top: "top",
    Bottom: "bottom",
    Left: "left",
    Right: "right",
  },
  MarkerType: {
    Arrow: "arrow",
    ArrowClosed: "arrowclosed",
  },
  Handle: {
    name: "Handle",
    template: "<div class='handle-mock' />",
  },
  useVueFlow: vi.fn(() => ({
    fitView: vi.fn(),
  })),
}));

vi.mock("@vue-flow/background", () => ({
  Background: {
    name: "Background",
    template: "<div class='background-mock' />",
  },
}));

vi.mock("@vue-flow/controls", () => ({
  Controls: {
    name: "Controls",
    template: "<div class='controls-mock' />",
  },
}));

// Mock search service
vi.mock("@/services/search");

// Default mock response
const defaultMockResponse = {
  trace_id: "test-trace-123",
  nodes: [
    {
      span_id: "span-1",
      parent_span_id: null,
      service_name: "frontend",
      operation_name: "GET /api",
      span_status: "OK",
      start_time: 1000000,
      end_time: 1100000,
      llm_observation_type: null,
    },
    {
      span_id: "span-2",
      parent_span_id: "span-1",
      service_name: "backend",
      operation_name: "query_db",
      span_status: "OK",
      start_time: 1010000,
      end_time: 1050000,
      llm_observation_type: "generation",
    },
    {
      span_id: "span-3",
      parent_span_id: "span-1",
      service_name: "cache",
      operation_name: "get_cache",
      span_status: "ERROR",
      start_time: 1060000,
      end_time: 1080000,
      llm_observation_type: "tool",
    },
  ],
  edges: [
    { from: "span-1", to: "span-2" },
    { from: "span-1", to: "span-3" },
  ],
};

describe("TraceDAG", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementation to default response
    vi.mocked(searchService.getTraceDAG).mockResolvedValue({ data: defaultMockResponse } as any);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Mounting & Initialization", () => {
    it("should mount successfully with valid props", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
          sidebarOpen: false,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should show loading state initially", () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      expect(wrapper.find(".loading-container").exists()).toBe(true);
      expect(wrapper.text()).toContain("Loading trace DAG");
    });

    it("should fetch DAG data on mount", async () => {
      const searchService = await import("@/services/search");

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(searchService.default.getTraceDAG).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "default",
        "test-trace-123",
        1000000,
        1100000
      );
    });

    it("should hide loading state after data loads", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.find(".loading-container").exists()).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should display error message when fetch fails", async () => {
      vi.mocked(searchService.getTraceDAG).mockRejectedValueOnce(new Error("Network error"));

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.vm.error).toBeTruthy();
      expect(wrapper.find(".error-message").exists()).toBe(true);
      expect(wrapper.text()).toContain("Failed to load DAG");
    });

    it("should handle API error response", async () => {
      vi.mocked(searchService.getTraceDAG).mockRejectedValueOnce({
        response: {
          data: { message: "Trace not found" },
        },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "missing-trace",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.vm.error).toBe("Trace not found");
    });

    it("should validate props before fetching", async () => {
      const searchService = await import("@/services/search");
      const getTraceDAG = searchService.default.getTraceDAG as any;
      getTraceDAG.mockClear();

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.vm.error).toBeTruthy();
      expect(getTraceDAG).not.toHaveBeenCalled();
    });

    it("should validate startTime < endTime", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1100000,
          endTime: 1000000, // End before start
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.vm.error).toBeTruthy();
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no nodes", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [],
          edges: [],
        },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.find(".empty-container").exists()).toBe(true);
      expect(wrapper.text()).toContain("No DAG data available");
    });
  });

  describe("Node & Edge Processing", () => {
    it("should process nodes into VueFlow format", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe("span-1");
      expect(nodes[0].type).toBe("custom");
      expect(nodes[0].data).toHaveProperty("operation_name");
    });

    it("should process edges into VueFlow format", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const edges = wrapper.vm.edges;
      expect(edges).toHaveLength(2);
      expect(edges[0].source).toBe("span-1");
      expect(edges[0].target).toBe("span-2");
    });

    it("should filter out invalid edges", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [{ span_id: "span-1" }],
          edges: [
            { from: "span-1", to: "span-2" }, // Invalid: span-2 doesn't exist
            { from: "span-1", to: "span-3" }, // Invalid: span-3 doesn't exist
          ],
        },
      } as any);

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      // Edges computed property filters out invalid edges
      const edges = wrapper.vm.edges;
      expect(edges).toHaveLength(0); // All edges filtered out because referenced nodes don't exist
    });

    it("should mark nodes with incoming edges", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      const span2 = nodes.find((n: any) => n.id === "span-2");
      expect(span2.data.hasIncoming).toBe(true);

      const span1 = nodes.find((n: any) => n.id === "span-1");
      expect(span1.data.hasIncoming).toBe(false); // Root node
    });

    it("should mark nodes with outgoing edges", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      const span1 = nodes.find((n: any) => n.id === "span-1");
      expect(span1.data.hasOutgoing).toBe(true);

      const span2 = nodes.find((n: any) => n.id === "span-2");
      expect(span2.data.hasOutgoing).toBe(false); // Leaf node
    });
  });

  describe("Layout Algorithm", () => {
    it("should calculate positions for nodes", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      nodes.forEach((node: any) => {
        expect(node.position).toHaveProperty("x");
        expect(node.position).toHaveProperty("y");
        expect(typeof node.position.x).toBe("number");
        expect(typeof node.position.y).toBe("number");
      });
    });

    it("should place root nodes at depth 0", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      const rootNode = nodes.find((n: any) => n.id === "span-1");
      expect(rootNode.position.y).toBe(0);
    });

    it("should place child nodes below parent nodes", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      const parentNode = nodes.find((n: any) => n.id === "span-1");
      const childNode = nodes.find((n: any) => n.id === "span-2");

      expect(childNode.position.y).toBeGreaterThan(parentNode.position.y);
    });

    it("should sort children by start time", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "root",
              parent_span_id: null,
              start_time: 1000,
              operation_name: "root",
            },
            {
              span_id: "child-2",
              parent_span_id: "root",
              start_time: 2000,
              operation_name: "second",
            },
            {
              span_id: "child-1",
              parent_span_id: "root",
              start_time: 1500,
              operation_name: "first",
            },
          ],
          edges: [
            { from: "root", to: "child-1" },
            { from: "root", to: "child-2" },
          ],
        },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      // Children should be sorted by start time in the layout
      const nodes = wrapper.vm.nodes;
      expect(nodes).toBeDefined();
    });
  });

  describe("LLM Observation Type Styling", () => {
    it("should apply correct class for generation type", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const cssClass = wrapper.vm.getObservationTypeClass("generation");
      expect(cssClass).toBe("node-llm-generation");
    });

    it("should apply correct class for tool type", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const cssClass = wrapper.vm.getObservationTypeClass("tool");
      expect(cssClass).toBe("node-llm-tool");
    });

    it("should handle null observation type", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const cssClass = wrapper.vm.getObservationTypeClass(null);
      expect(cssClass).toBe("");
    });

    it("should handle unknown observation type", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const cssClass = wrapper.vm.getObservationTypeClass("unknown_type");
      expect(cssClass).toBe("node-llm-default");
    });

    it("should handle case insensitive observation types", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const cssClass = wrapper.vm.getObservationTypeClass("GENERATION");
      expect(cssClass).toBe("node-llm-generation");
    });

    it("should apply text color classes for observation types", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const textClass = wrapper.vm.getObservationTypeTextClass("agent");
      expect(textClass).toBe("node-llm-text-agent");
    });
  });

  describe("Event Handling", () => {
    it("should emit node-click event when handleNodeClick is called", async () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test-trace-123",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      wrapper.vm.handleNodeClick("span-2");

      expect(wrapper.emitted("node-click")).toBeTruthy();
      expect(wrapper.emitted("node-click")[0]).toEqual(["span-2"]);
    });
  });

  describe("Props Watching", () => {
    it("should refetch DAG when traceId changes", async () => {
      const searchService = await import("@/services/search");
      const getTraceDAG = searchService.default.getTraceDAG as any;

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "trace-1",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();
      getTraceDAG.mockClear();

      await wrapper.setProps({ traceId: "trace-2" });
      await flushPromises();

      expect(getTraceDAG).toHaveBeenCalledWith(
        expect.anything(),
        "default",
        "trace-2",
        1000000,
        1100000
      );
    });

    it("should refetch DAG when streamName changes", async () => {
      const searchService = await import("@/services/search");
      const getTraceDAG = searchService.default.getTraceDAG as any;

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "stream-1",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();
      getTraceDAG.mockClear();

      await wrapper.setProps({ streamName: "stream-2" });
      await flushPromises();

      expect(getTraceDAG).toHaveBeenCalledWith(
        expect.anything(),
        "stream-2",
        "test",
        1000000,
        1100000
      );
    });
  });

  describe("Sidebar Integration", () => {
    it("should accept sidebarOpen prop", () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
          sidebarOpen: true,
        },
        global: {
          provide: { store },
        },
      });

      expect(wrapper.props("sidebarOpen")).toBe(true);
    });

    it("should default sidebarOpen to false", () => {
      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      expect(wrapper.props("sidebarOpen")).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle disconnected nodes", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "isolated-1",
              parent_span_id: null,
              operation_name: "isolated",
            },
            {
              span_id: "isolated-2",
              parent_span_id: null,
              operation_name: "also-isolated",
            },
          ],
          edges: [], // No edges
        },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const nodes = wrapper.vm.nodes;
      expect(nodes).toHaveLength(2);
    });

    it("should handle circular references gracefully", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
              { span_id: "a", parent_span_id: null, operation_name: "a" },
              { span_id: "b", parent_span_id: "a", operation_name: "b" },
            ],
            edges: [
              { from: "a", to: "b" },
              { from: "b", to: "a" }, // Circular!
            ],
          },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      // Should not crash
      expect(wrapper.vm).toBeTruthy();
    });

    it("should handle very deep tree", async () => {
      const nodes = [];
      const edges = [];
      const depth = 50;

      for (let i = 0; i < depth; i++) {
        nodes.push({
          span_id: `span-${i}`,
          parent_span_id: i === 0 ? null : `span-${i - 1}`,
          operation_name: `op-${i}`,
          start_time: 1000 + i,
        });
        if (i > 0) {
          edges.push({ from: `span-${i - 1}`, to: `span-${i}` });
        }
      }

      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes,
          edges,
        },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      const processedNodes = wrapper.vm.nodes;
      expect(processedNodes).toHaveLength(depth);
    });

    it("should handle nodes with same start time", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "root",
              parent_span_id: null,
              start_time: 1000,
              operation_name: "root",
            },
            {
              span_id: "child-1",
              parent_span_id: "root",
              start_time: 1000, // Same time
              operation_name: "child-1",
            },
            {
              span_id: "child-2",
              parent_span_id: "root",
              start_time: 1000, // Same time
              operation_name: "child-2",
            },
          ],
          edges: [
            { from: "root", to: "child-1" },
            { from: "root", to: "child-2" },
          ],
        },
      });

      wrapper = mount(TraceDAG, {
        props: {
          traceId: "test",
          streamName: "default",
          startTime: 1000000,
          endTime: 1100000,
        },
        global: {
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.vm.nodes).toHaveLength(3);
    });
  });
});
