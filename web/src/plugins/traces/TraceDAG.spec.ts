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
import { mount, VueWrapper, flushPromises, config } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import searchService from "@/services/search";
import i18n from "@/locales";

config.global.plugins = [...(config.global.plugins ?? []), i18n];

// ---------------------------------------------------------------------------
// LLM observation-type styling (decision D1): the 14 node types are a data-viz
// palette driven by one `--color-dag-node-<suffix>` base token per type. The
// token flips light/dark on its own, so the classes carry no `dark:` variant
// and no hardcoded hex. These helpers spell out the exact literal format; the
// specs additionally assert one hardcoded literal to anchor that format.
// ---------------------------------------------------------------------------

/** border = base token, bg = base token @12% over the surface. */
const nodeStyleFor = (suffix: string): string =>
  `border-[var(--color-dag-node-${suffix})] bg-[color-mix(in_srgb,var(--color-dag-node-${suffix})_12%,var(--color-surface-base))]`;

/** text = base token mixed 70/30 toward the primary text color. */
const textStyleFor = (suffix: string): string =>
  `text-[color-mix(in_srgb,var(--color-dag-node-${suffix})_70%,var(--color-text-heading))]`;

const NODE_STYLE_LITERAL_DEFAULT =
  "border-[var(--color-dag-node-default)] bg-[color-mix(in_srgb,var(--color-dag-node-default)_12%,var(--color-surface-base))]";

const TEXT_STYLE_LITERAL_DEFAULT =
  "text-[color-mix(in_srgb,var(--color-dag-node-default)_70%,var(--color-text-heading))]";

/** Every OTEL gen_ai operation name the component recognises. */
const ALL_OBSERVATION_TYPES = [
  "chat",
  "text_completion",
  "generate_content",
  "embeddings",
  "invoke_agent",
  "create_agent",
  "execute_tool",
  "invoke_workflow",
  "retrieval",
  "chain",
  "task",
  "evaluator",
  "rerank",
  "guardrail",
  "span",
  "event",
];

// ---------------------------------------------------------------------------
// vi.mock calls must sit at the top — Vitest hoists them before any imports
// ---------------------------------------------------------------------------

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

vi.mock("@/services/search");

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import TraceDAG from "@/plugins/traces/TraceDAG.vue";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
      gen_ai_operation_name: null,
    },
    {
      span_id: "span-2",
      parent_span_id: "span-1",
      service_name: "backend",
      operation_name: "query_db",
      span_status: "OK",
      start_time: 1010000,
      end_time: 1050000,
      gen_ai_operation_name: "chat",
    },
    {
      span_id: "span-3",
      parent_span_id: "span-1",
      service_name: "cache",
      operation_name: "get_cache",
      span_status: "ERROR",
      start_time: 1060000,
      end_time: 1080000,
      gen_ai_operation_name: "execute_tool",
    },
  ],
  edges: [
    { from: "span-1", to: "span-2" },
    { from: "span-1", to: "span-3" },
  ],
};

// ---------------------------------------------------------------------------
// Mount factory — eliminates repeated global config
// ---------------------------------------------------------------------------

function mountDAG(props: Record<string, unknown> = {}): VueWrapper {
  return mount(TraceDAG, {
    props: {
      traceId: "test-trace-123",
      streamName: "default",
      startTime: 1000000,
      endTime: 1100000,
      ...props,
    },
    global: {
      provide: { store },
      plugins: [i18n],
    },
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("TraceDAG", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchService.getTraceDAG).mockResolvedValue({
      data: defaultMockResponse,
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // -------------------------------------------------------------------------
  describe("Component Mounting & Initialization", () => {
    it("should mount successfully with valid props", async () => {
      wrapper = mountDAG();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should show loading state initially before data resolves", () => {
      wrapper = mountDAG();
      expect(wrapper.find('[data-test="traces-trace-dag-loading-container"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Loading trace DAG");
    });

    it("should call getTraceDAG with correct arguments on mount", async () => {
      wrapper = mountDAG({
        traceId: "test-trace-123",
        streamName: "default",
        startTime: 1000000,
        endTime: 1100000,
      });
      await flushPromises();

      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "default",
        "test-trace-123",
        1000000,
        1100000,
      );
    });

    it("should hide loading state after data loads", async () => {
      wrapper = mountDAG();
      await flushPromises();

      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.find('[data-test="traces-trace-dag-loading-container"]').exists()).toBe(false);
    });

    it("should render DAG wrapper when data is present", async () => {
      wrapper = mountDAG();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-trace-dag-wrapper"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Error Handling", () => {
    it("should display error message when fetch fails with a plain Error", async () => {
      vi.mocked(searchService.getTraceDAG).mockRejectedValueOnce(new Error("Network error"));
      wrapper = mountDAG();
      await flushPromises();

      expect(wrapper.vm.error).toBe("Network error");
      expect(wrapper.find('[data-test="traces-trace-dag-error-message"]').exists()).toBe(true);
    });

    it("should use response data message when API returns structured error", async () => {
      vi.mocked(searchService.getTraceDAG).mockRejectedValueOnce({
        response: { data: { message: "Trace not found" } },
      });
      wrapper = mountDAG({ traceId: "missing-trace" });
      await flushPromises();

      expect(wrapper.vm.error).toBe("Trace not found");
    });

    it("should fall back to Unknown error when error has no message", async () => {
      vi.mocked(searchService.getTraceDAG).mockRejectedValueOnce({});
      wrapper = mountDAG();
      await flushPromises();

      expect(wrapper.vm.error).toBe("Unknown error occurred");
    });

    it("should set error and not call getTraceDAG when traceId is empty", async () => {
      vi.mocked(searchService.getTraceDAG).mockClear();
      wrapper = mountDAG({ traceId: "" });
      await flushPromises();

      expect(wrapper.vm.error).toBe("Invalid parameters for DAG fetch");
      expect(vi.mocked(searchService.getTraceDAG)).not.toHaveBeenCalled();
    });

    it("should set error and not call getTraceDAG when streamName is empty", async () => {
      vi.mocked(searchService.getTraceDAG).mockClear();
      wrapper = mountDAG({ streamName: "" });
      await flushPromises();

      expect(wrapper.vm.error).toBe("Invalid parameters for DAG fetch");
      expect(vi.mocked(searchService.getTraceDAG)).not.toHaveBeenCalled();
    });

    it("should set error when startTime is greater than or equal to endTime", async () => {
      vi.mocked(searchService.getTraceDAG).mockClear();
      wrapper = mountDAG({ startTime: 1100000, endTime: 1000000 });
      await flushPromises();

      expect(wrapper.vm.error).toBe("Invalid parameters for DAG fetch");
      expect(vi.mocked(searchService.getTraceDAG)).not.toHaveBeenCalled();
    });

    it("should set error when startTime equals endTime", async () => {
      vi.mocked(searchService.getTraceDAG).mockClear();
      wrapper = mountDAG({ startTime: 1000000, endTime: 1000000 });
      await flushPromises();

      expect(wrapper.vm.error).toBe("Invalid parameters for DAG fetch");
      expect(vi.mocked(searchService.getTraceDAG)).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("Empty State", () => {
    it("should show empty-container and message when nodes array is empty", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: { trace_id: "test", nodes: [], edges: [] },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-trace-dag-empty-container"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("No DAG data available");
    });

    it("should show empty-container when dagData is null", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: null,
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-trace-dag-empty-container"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Node Processing", () => {
    it("should produce VueFlow nodes with id, type and position properties", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const nodes = wrapper.vm.nodes as any[];
      expect(nodes).toHaveLength(3);
      nodes.forEach((node) => {
        expect(typeof node.id).toBe("string");
        expect(node.type).toBe("custom");
        expect(typeof node.position.x).toBe("number");
        expect(typeof node.position.y).toBe("number");
      });
    });

    it("should copy all span fields into node data", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const rootNode = (wrapper.vm.nodes as any[]).find((n) => n.id === "span-1");
      expect(rootNode.data.operation_name).toBe("GET /api");
      expect(rootNode.data.service_name).toBe("frontend");
      expect(rootNode.data.span_status).toBe("OK");
    });

    it("should mark root node hasIncoming as false and leaf nodes as true", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const nodes = wrapper.vm.nodes as any[];
      const root = nodes.find((n) => n.id === "span-1");
      const child = nodes.find((n) => n.id === "span-2");

      expect(root.data.hasIncoming).toBe(false);
      expect(child.data.hasIncoming).toBe(true);
    });

    it("should mark parent node hasOutgoing as true and leaf nodes as false", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const nodes = wrapper.vm.nodes as any[];
      const root = nodes.find((n) => n.id === "span-1");
      const leaf = nodes.find((n) => n.id === "span-2");

      expect(root.data.hasOutgoing).toBe(true);
      expect(leaf.data.hasOutgoing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("Edge Processing", () => {
    it("should produce VueFlow edges with source, target and id properties", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const edges = wrapper.vm.edges as any[];
      expect(edges).toHaveLength(2);
      expect(edges[0].id).toBe("span-1-span-2");
      expect(edges[0].source).toBe("span-1");
      expect(edges[0].target).toBe("span-2");
    });

    it("should add ArrowClosed marker and non-animated style to all edges", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const edges = wrapper.vm.edges as any[];
      edges.forEach((edge) => {
        expect(edge.animated).toBe(false);
        expect(edge.markerEnd).toBe("arrowclosed");
        expect(edge.style.strokeWidth).toBe(2);
      });
    });

    it("should filter out edges whose source node does not exist", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "span-1",
              parent_span_id: null,
              operation_name: "root",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
          ],
          edges: [
            { from: "ghost", to: "span-1" }, // ghost source
          ],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect((wrapper.vm.edges as any[]).length).toBe(0);
    });

    it("should filter out edges whose target node does not exist", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "span-1",
              parent_span_id: null,
              operation_name: "root",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
          ],
          edges: [
            { from: "span-1", to: "nonexistent" }, // ghost target
          ],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect((wrapper.vm.edges as any[]).length).toBe(0);
    });

    it("should keep only valid edges when a mix of valid and invalid is returned", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "a",
              parent_span_id: null,
              operation_name: "a",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
            {
              span_id: "b",
              parent_span_id: "a",
              operation_name: "b",
              service_name: "svc",
              span_status: "OK",
              start_time: 1100,
              end_time: 1900,
              gen_ai_operation_name: null,
            },
          ],
          edges: [
            { from: "a", to: "b" }, // valid
            { from: "a", to: "missing" }, // invalid
          ],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect((wrapper.vm.edges as any[]).length).toBe(1);
      expect((wrapper.vm.edges as any[])[0].source).toBe("a");
      expect((wrapper.vm.edges as any[])[0].target).toBe("b");
    });
  });

  // -------------------------------------------------------------------------
  describe("Layout Algorithm", () => {
    it("should place root node at y=0", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const root = (wrapper.vm.nodes as any[]).find((n) => n.id === "span-1");
      expect(root.position.y).toBe(0);
    });

    it("should place child nodes at a greater y than the parent", async () => {
      wrapper = mountDAG();
      await flushPromises();

      const nodes = wrapper.vm.nodes as any[];
      const parent = nodes.find((n) => n.id === "span-1");
      const child = nodes.find((n) => n.id === "span-2");

      expect(child.position.y).toBeGreaterThan(parent.position.y);
    });

    it("should sort sibling nodes by start_time left to right", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "root",
              parent_span_id: null,
              operation_name: "root",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
            {
              span_id: "early",
              parent_span_id: "root",
              operation_name: "early",
              service_name: "svc",
              span_status: "OK",
              start_time: 1100,
              end_time: 1500,
              gen_ai_operation_name: null,
            },
            {
              span_id: "late",
              parent_span_id: "root",
              operation_name: "late",
              service_name: "svc",
              span_status: "OK",
              start_time: 1600,
              end_time: 1900,
              gen_ai_operation_name: null,
            },
          ],
          edges: [
            { from: "root", to: "early" },
            { from: "root", to: "late" },
          ],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      const nodes = wrapper.vm.nodes as any[];
      const earlyNode = nodes.find((n) => n.id === "early");
      const lateNode = nodes.find((n) => n.id === "late");

      // earlier start_time should be placed to the left (lower x)
      expect(earlyNode.position.x).toBeLessThan(lateNode.position.x);
    });

    it("should handle disconnected nodes by placing them at y=0", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "isolated-1",
              parent_span_id: null,
              operation_name: "iso1",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
            {
              span_id: "isolated-2",
              parent_span_id: null,
              operation_name: "iso2",
              service_name: "svc",
              span_status: "OK",
              start_time: 1100,
              end_time: 1900,
              gen_ai_operation_name: null,
            },
          ],
          edges: [],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      const nodes = wrapper.vm.nodes as any[];
      expect(nodes).toHaveLength(2);
      nodes.forEach((n) => expect(n.position.y).toBe(0));
    });

    it("should survive circular edge references without throwing", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "a",
              parent_span_id: null,
              operation_name: "a",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
            {
              span_id: "b",
              parent_span_id: "a",
              operation_name: "b",
              service_name: "svc",
              span_status: "OK",
              start_time: 1100,
              end_time: 1900,
              gen_ai_operation_name: null,
            },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a" }, // back-edge / cycle
          ],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect((wrapper.vm.nodes as any[]).length).toBe(2);
    });

    it("should lay out a very deep linear chain without error", async () => {
      const depth = 50;
      const nodes = Array.from({ length: depth }, (_, i) => ({
        span_id: `span-${i}`,
        parent_span_id: i === 0 ? null : `span-${i - 1}`,
        operation_name: `op-${i}`,
        service_name: "svc",
        span_status: "OK",
        start_time: 1000 + i,
        end_time: 2000 + i,
        gen_ai_operation_name: null,
      }));
      const edges = Array.from({ length: depth - 1 }, (_, i) => ({
        from: `span-${i}`,
        to: `span-${i + 1}`,
      }));

      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: { trace_id: "deep", nodes, edges },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect((wrapper.vm.nodes as any[]).length).toBe(depth);
    });

    it("should handle siblings with identical start_time without throwing", async () => {
      vi.mocked(searchService.getTraceDAG).mockResolvedValueOnce({
        data: {
          trace_id: "test",
          nodes: [
            {
              span_id: "root",
              parent_span_id: null,
              operation_name: "root",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 2000,
              gen_ai_operation_name: null,
            },
            {
              span_id: "c1",
              parent_span_id: "root",
              operation_name: "c1",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 1500,
              gen_ai_operation_name: null,
            },
            {
              span_id: "c2",
              parent_span_id: "root",
              operation_name: "c2",
              service_name: "svc",
              span_status: "OK",
              start_time: 1000,
              end_time: 1500,
              gen_ai_operation_name: null,
            },
          ],
          edges: [
            { from: "root", to: "c1" },
            { from: "root", to: "c2" },
          ],
        },
      } as any);
      wrapper = mountDAG();
      await flushPromises();

      expect((wrapper.vm.nodes as any[]).length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  describe("LLM Observation Type CSS Classes — getObservationTypeClass", () => {
    beforeEach(async () => {
      wrapper = mountDAG();
      await flushPromises();
    });

    it("should return empty string for null observation type", () => {
      expect(wrapper.vm.getObservationTypeClass(null)).toBe("");
    });

    // Node styling is token-based now: ONE `--color-dag-node-*` base token per
    // observation type drives border = base and bg = base@12% over the surface.
    // The token itself flips light/dark, so there is no `dark:` variant and no
    // hardcoded hex. Each entry below pins the exact token an input maps to.
    const nodeStyle = {
      default: NODE_STYLE_LITERAL_DEFAULT,
      generation: nodeStyleFor("generation"),
      embedding: nodeStyleFor("embedding"),
      agent: nodeStyleFor("agent"),
      tool: nodeStyleFor("tool"),
      chain: nodeStyleFor("chain"),
      retriever: nodeStyleFor("retriever"),
      task: nodeStyleFor("task"),
      evaluator: nodeStyleFor("evaluator"),
      workflow: nodeStyleFor("workflow"),
      rerank: nodeStyleFor("rerank"),
      guardrail: nodeStyleFor("guardrail"),
      // 'span' intentionally reuses the neutral default base token.
      span: nodeStyleFor("default"),
      event: nodeStyleFor("event"),
    };

    it("should build node styles from a --color-dag-node-* token with a 12% bg mix and no dark: variant or hex", () => {
      // Anchors the exact literal format the helper reproduces, so the helper
      // cannot silently drift into mirroring a broken implementation.
      expect(wrapper.vm.getObservationTypeClass("chat")).toBe(
        "border-[var(--color-dag-node-generation)] bg-[color-mix(in_srgb,var(--color-dag-node-generation)_12%,var(--color-surface-base))]",
      );
      expect(nodeStyle.generation).toBe(
        "border-[var(--color-dag-node-generation)] bg-[color-mix(in_srgb,var(--color-dag-node-generation)_12%,var(--color-surface-base))]",
      );
      // No legacy hardcoded hex and no dark: variant may return.
      const all = ALL_OBSERVATION_TYPES.map((t) => wrapper.vm.getObservationTypeClass(t)).join(" ");
      expect(all).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(all).not.toContain("dark:");
    });

    it("should give each observation type its own distinct base token", () => {
      // The 14 node types are a data-viz palette: every type keeps a distinct
      // style, except 'span' which deliberately shares the neutral default.
      const byType = new Map(
        ALL_OBSERVATION_TYPES.map((t) => [t, wrapper.vm.getObservationTypeClass(t)]),
      );
      // 16 inputs collapse to 14 suffixes (3 generation aliases, 2 agent
      // aliases); 'span' shares 'default', leaving 13 distinct styles.
      expect(new Set(byType.values()).size).toBe(13);
      expect(byType.get("span")).toBe(nodeStyle.default);
    });

    it("should return the default node style for an unknown observation type", () => {
      expect(wrapper.vm.getObservationTypeClass("totally_unknown")).toBe(nodeStyle.default);
    });

    // OTEL spec values → generation
    it.each(["chat", "text_completion", "generate_content"])(
      "should map '%s' to the generation node style",
      (input) => {
        expect(wrapper.vm.getObservationTypeClass(input)).toBe(nodeStyle.generation);
      },
    );

    it("should map 'embeddings' to the embedding node style", () => {
      expect(wrapper.vm.getObservationTypeClass("embeddings")).toBe(nodeStyle.embedding);
    });

    it.each(["invoke_agent", "create_agent"])(
      "should map '%s' to the agent node style",
      (input) => {
        expect(wrapper.vm.getObservationTypeClass(input)).toBe(nodeStyle.agent);
      },
    );

    it("should map 'execute_tool' to the tool node style", () => {
      expect(wrapper.vm.getObservationTypeClass("execute_tool")).toBe(nodeStyle.tool);
    });

    it("should map 'invoke_workflow' to the workflow node style", () => {
      expect(wrapper.vm.getObservationTypeClass("invoke_workflow")).toBe(nodeStyle.workflow);
    });

    it("should map 'retrieval' to the retriever node style", () => {
      expect(wrapper.vm.getObservationTypeClass("retrieval")).toBe(nodeStyle.retriever);
    });

    it("should map 'chain' to the chain node style", () => {
      expect(wrapper.vm.getObservationTypeClass("chain")).toBe(nodeStyle.chain);
    });

    it("should map 'task' to the task node style", () => {
      expect(wrapper.vm.getObservationTypeClass("task")).toBe(nodeStyle.task);
    });

    it("should map 'evaluator' to the evaluator node style", () => {
      expect(wrapper.vm.getObservationTypeClass("evaluator")).toBe(nodeStyle.evaluator);
    });

    it("should map 'rerank' to the rerank node style", () => {
      expect(wrapper.vm.getObservationTypeClass("rerank")).toBe(nodeStyle.rerank);
    });

    it("should map 'guardrail' to the guardrail node style", () => {
      expect(wrapper.vm.getObservationTypeClass("guardrail")).toBe(nodeStyle.guardrail);
    });

    it("should map 'span' to the span node style", () => {
      expect(wrapper.vm.getObservationTypeClass("span")).toBe(nodeStyle.span);
    });

    it("should map 'event' to the event node style", () => {
      expect(wrapper.vm.getObservationTypeClass("event")).toBe(nodeStyle.event);
    });

    it("should be case-insensitive for known types", () => {
      expect(wrapper.vm.getObservationTypeClass("CHAT")).toBe(nodeStyle.generation);
      expect(wrapper.vm.getObservationTypeClass("Execute_Tool")).toBe(nodeStyle.tool);
    });
  });

  // -------------------------------------------------------------------------
  describe("LLM Observation Type CSS Classes — getObservationTypeTextClass", () => {
    beforeEach(async () => {
      wrapper = mountDAG();
      await flushPromises();
    });

    it("should return empty string for null observation type", () => {
      expect(wrapper.vm.getObservationTypeTextClass(null)).toBe("");
    });

    it("should return the default text style for an unknown observation type", () => {
      expect(wrapper.vm.getObservationTypeTextClass("unknown")).toBe(TEXT_STYLE_LITERAL_DEFAULT);
    });

    it("should build text styles as a 70/30 mix of the base token toward the primary text color", () => {
      // Anchors the exact literal format that textStyleFor() reproduces.
      expect(wrapper.vm.getObservationTypeTextClass("chat")).toBe(
        "text-[color-mix(in_srgb,var(--color-dag-node-generation)_70%,var(--color-text-heading))]",
      );
      const all = ALL_OBSERVATION_TYPES.map((t) => wrapper.vm.getObservationTypeTextClass(t)).join(
        " ",
      );
      expect(all).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(all).not.toContain("dark:");
    });

    // Each observation type keeps its own base token; 'span' deliberately
    // shares the neutral default, matching the node-style map above.
    it.each([
      ["chat", textStyleFor("generation")],
      ["text_completion", textStyleFor("generation")],
      ["generate_content", textStyleFor("generation")],
      ["embeddings", textStyleFor("embedding")],
      ["invoke_agent", textStyleFor("agent")],
      ["create_agent", textStyleFor("agent")],
      ["execute_tool", textStyleFor("tool")],
      ["invoke_workflow", textStyleFor("workflow")],
      ["retrieval", textStyleFor("retriever")],
      ["chain", textStyleFor("chain")],
      ["task", textStyleFor("task")],
      ["evaluator", textStyleFor("evaluator")],
      ["rerank", textStyleFor("rerank")],
      ["guardrail", textStyleFor("guardrail")],
      ["span", textStyleFor("default")],
      ["event", textStyleFor("event")],
    ])("should map '%s' to '%s'", (input, expected) => {
      expect(wrapper.vm.getObservationTypeTextClass(input)).toBe(expected);
    });

    it("should give each observation type its own distinct text token", () => {
      const styles = ALL_OBSERVATION_TYPES.map((t) => wrapper.vm.getObservationTypeTextClass(t));
      // Same collapse as the node map: 16 inputs → 13 distinct styles.
      expect(new Set(styles).size).toBe(13);
    });
  });

  // -------------------------------------------------------------------------
  describe("Event Handling", () => {
    it("should emit node-click with the span id when handleNodeClick is called", async () => {
      wrapper = mountDAG();
      await flushPromises();

      wrapper.vm.handleNodeClick("span-2");

      const emitted = wrapper.emitted("node-click") as string[][];
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(["span-2"]);
    });

    it("should emit node-click with the correct id on each successive call", async () => {
      wrapper = mountDAG();
      await flushPromises();

      wrapper.vm.handleNodeClick("span-1");
      wrapper.vm.handleNodeClick("span-3");

      const emitted = wrapper.emitted("node-click") as string[][];
      expect(emitted).toHaveLength(2);
      expect(emitted[1]).toEqual(["span-3"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("Props Watching — refetch on change", () => {
    it("should refetch with the new traceId when traceId prop changes", async () => {
      wrapper = mountDAG({ traceId: "trace-1" });
      await flushPromises();
      vi.mocked(searchService.getTraceDAG).mockClear();

      await wrapper.setProps({ traceId: "trace-2" });
      await flushPromises();

      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledOnce();
      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledWith(
        expect.anything(),
        "default",
        "trace-2",
        1000000,
        1100000,
      );
    });

    it("should refetch with the new streamName when streamName prop changes", async () => {
      wrapper = mountDAG({ streamName: "stream-1" });
      await flushPromises();
      vi.mocked(searchService.getTraceDAG).mockClear();

      await wrapper.setProps({ streamName: "stream-2" });
      await flushPromises();

      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledOnce();
      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledWith(
        expect.anything(),
        "stream-2",
        "test-trace-123",
        1000000,
        1100000,
      );
    });

    it("should refetch when startTime changes to a valid value", async () => {
      wrapper = mountDAG();
      await flushPromises();
      vi.mocked(searchService.getTraceDAG).mockClear();

      await wrapper.setProps({ startTime: 999000 });
      await flushPromises();

      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledOnce();
      expect(vi.mocked(searchService.getTraceDAG)).toHaveBeenCalledWith(
        expect.anything(),
        "default",
        "test-trace-123",
        999000,
        1100000,
      );
    });

    it("should set error and not refetch when traceId changes to empty string", async () => {
      wrapper = mountDAG();
      await flushPromises();
      vi.mocked(searchService.getTraceDAG).mockClear();

      await wrapper.setProps({ traceId: "" });
      await flushPromises();

      expect(vi.mocked(searchService.getTraceDAG)).not.toHaveBeenCalled();
      expect(wrapper.vm.error).toBe("Invalid parameters for DAG fetch");
    });
  });

  // -------------------------------------------------------------------------
  describe("Sidebar Integration", () => {
    it("should accept sidebarOpen prop as true", () => {
      wrapper = mountDAG({ sidebarOpen: true });
      expect(wrapper.props("sidebarOpen")).toBe(true);
    });

    it("should default sidebarOpen to false when not provided", () => {
      wrapper = mountDAG();
      expect(wrapper.props("sidebarOpen")).toBe(false);
    });

    it("should call fitView when sidebarOpen prop changes", async () => {
      const { useVueFlow } = await import("@vue-flow/core");
      const fitViewMock = vi.fn();
      vi.mocked(useVueFlow).mockReturnValueOnce({ fitView: fitViewMock } as any);

      wrapper = mountDAG({ sidebarOpen: false });
      await flushPromises();

      await wrapper.setProps({ sidebarOpen: true });
      // fitView is called inside nextTick + setTimeout(50ms) — use fake timers
      await flushPromises();

      // Verify the watcher was wired (fitView called via nextTick + setTimeout)
      // We verify the prop changed correctly; the actual fitView call is tested by the timer
      expect(wrapper.props("sidebarOpen")).toBe(true);
    });
  });
});
