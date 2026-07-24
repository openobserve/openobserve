<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="h-full min-h-125 w-full">
    <div
      v-if="isLoading"
      data-test="traces-trace-dag-loading-container"
      class="flex h-125 flex-col items-center justify-center p-6"
    >
      <OSpinner size="lg" />
      <div class="text-text-secondary mt-3 text-sm">{{ t("traces.loadingTraceDag") }}</div>
    </div>

    <div v-else-if="error" data-test="traces-trace-dag-error-message" class="p-3">
      <OBanner
        variant="error"
        icon="error"
        :content="t('traces.traceDAG.failedToLoad', { error })"
      />
    </div>

    <div
      v-else-if="!dagData || !dagData.nodes || dagData.nodes.length === 0"
      data-test="traces-trace-dag-empty-container"
      class="flex h-125 flex-col items-center justify-center p-6"
    >
      <OIcon name="info" style="width: 48px; height: 48px" />
      <div class="text-text-muted mt-3">{{ t("traces.traceDAG.noData") }}</div>
    </div>

    <div
      v-else
      data-test="traces-trace-dag-wrapper"
      class="border-border-default rounded-default relative h-full min-h-150 w-full border"
    >
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :default-viewport="{ zoom: 0.8, x: 0, y: 30 }"
        :min-zoom="0.2"
        :max-zoom="3"
        fit-view-on-init
        :fit-view-options="{ padding: 0.3, minZoom: 0.3, maxZoom: 0.7 }"
        class="trace-dag-flow bg-surface-panel! h-full w-full"
      >
        <Background pattern-color="#aaa" :gap="16" />
        <Controls />

        <template #node-custom="{ data }">
          <Handle
            v-if="data.hasIncoming"
            type="target"
            :position="Position.Top"
            class="bg-info border-surface-base h-2 w-2 rounded-full border-2 shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
          />
          <div
            class="rounded-default bg-surface-base border-info flex min-h-7 max-w-45 min-w-20 cursor-pointer flex-col items-center justify-center border-2 p-[6px_12px] text-center shadow-[0_2px_6px_rgba(0,0,0,0.1)] transition-all duration-200 hover:[transform:translateY(-2px)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
            :class="[
              {
                'border-status-negative! bg-status-error-bg!': data.span_status === 'ERROR',
                'border-status-positive!': data.span_status === 'OK' && !data.gen_ai_operation_name,
              },
              getObservationTypeClass(data.gen_ai_operation_name),
            ]"
            @click="handleNodeClick(data.span_id)"
          >
            <div
              class="text-compact text-info max-w-40 overflow-hidden leading-[1.3] font-semibold break-words text-ellipsis whitespace-nowrap"
              :class="getObservationTypeTextClass(data.gen_ai_operation_name)"
            >
              {{ data.operation_name }}
            </div>
            <OTag
              v-if="data.span_status === 'ERROR'"
              type="spanStatus"
              :value="data.span_status"
              label="ERR"
              class="text-3xs mt-0.5 h-3.5 px-1"
            />
          </div>
          <Handle
            v-if="data.hasOutgoing"
            type="source"
            :position="Position.Bottom"
            class="bg-info border-surface-base h-2 w-2 rounded-full border-2 shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
          />
        </template>
      </VueFlow>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, nextTick } from "vue";
import { VueFlow, Position, MarkerType, Handle, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";

// VueFlow CSS imports
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

export interface SpanNode {
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  span_status: string;
  start_time: number;
  end_time: number;
  gen_ai_operation_name: string | null;
}

export interface SpanEdge {
  from: string;
  to: string;
}

export interface DAGResponse {
  trace_id: string;
  nodes: SpanNode[];
  edges: SpanEdge[];
}

export default defineComponent({
  name: "TraceDAG",
  components: {
    VueFlow,
    Background,
    Controls,
    Handle,
    OSpinner,
    OIcon,
    OTag,
    OBanner,
  },
  props: {
    traceId: {
      type: String,
      required: true,
    },
    streamName: {
      type: String,
      required: true,
    },
    startTime: {
      type: Number,
      required: true,
    },
    endTime: {
      type: Number,
      required: true,
    },
    sidebarOpen: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["node-click"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const isLoading = ref(true);
    const error = ref<string | null>(null);
    const dagData = ref<DAGResponse | null>(null);

    // Get VueFlow instance for fitView functionality
    const { fitView } = useVueFlow();

    // Top-down tree layout algorithm
    const calculateLayout = (nodesData: SpanNode[], edgesData: SpanEdge[]) => {
      const nodeWidth = 180;
      const nodeHeight = 32;
      const horizontalGap = 32;
      const verticalGap = 48;

      // Build adjacency list and find root nodes
      const children: Map<string, string[]> = new Map();
      const hasParent: Set<string> = new Set();
      const nodeMap: Map<string, SpanNode> = new Map();

      nodesData.forEach((node) => {
        nodeMap.set(node.span_id, node);
        children.set(node.span_id, []);
      });

      edgesData.forEach((edge) => {
        const parentChildren = children.get(edge.from) || [];
        parentChildren.push(edge.to);
        children.set(edge.from, parentChildren);
        hasParent.add(edge.to);
      });

      // Sort children by start_time for proper preorder traversal ordering
      children.forEach((childIds) => {
        childIds.sort((a, b) => {
          const nodeA = nodeMap.get(a);
          const nodeB = nodeMap.get(b);
          return (nodeA?.start_time || 0) - (nodeB?.start_time || 0);
        });
      });

      // Find root nodes (nodes without parents) and sort by start_time
      const roots = nodesData
        .filter((node) => !hasParent.has(node.span_id))
        .sort((a, b) => (a.start_time || 0) - (b.start_time || 0));

      // Assign levels using BFS
      const levels: Map<string, number> = new Map();
      const queue: { id: string; level: number }[] = roots.map((r) => ({
        id: r.span_id,
        level: 0,
      }));

      while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        if (levels.has(id)) continue;
        levels.set(id, level);

        const childNodes = children.get(id) || [];
        childNodes.forEach((childId) => {
          if (!levels.has(childId)) {
            queue.push({ id: childId, level: level + 1 });
          }
        });
      }

      // Handle disconnected nodes
      nodesData.forEach((node) => {
        if (!levels.has(node.span_id)) {
          levels.set(node.span_id, 0);
        }
      });

      // Group nodes by level
      const levelGroups: Map<number, string[]> = new Map();
      levels.forEach((level, id) => {
        const group = levelGroups.get(level) || [];
        group.push(id);
        levelGroups.set(level, group);
      });

      // Calculate subtree widths for better positioning
      const subtreeWidth: Map<string, number> = new Map();

      const calculateSubtreeWidth = (nodeId: string): number => {
        const childNodes = children.get(nodeId) || [];
        if (childNodes.length === 0) {
          subtreeWidth.set(nodeId, nodeWidth);
          return nodeWidth;
        }

        let totalWidth = 0;
        childNodes.forEach((childId) => {
          totalWidth += calculateSubtreeWidth(childId);
        });
        totalWidth += (childNodes.length - 1) * horizontalGap;

        const width = Math.max(nodeWidth, totalWidth);
        subtreeWidth.set(nodeId, width);
        return width;
      };

      // Calculate subtree widths starting from roots
      roots.forEach((root) => calculateSubtreeWidth(root.span_id));

      // Calculate positions using tree layout
      const positions: Map<string, { x: number; y: number }> = new Map();

      const positionNode = (nodeId: string, x: number, y: number) => {
        positions.set(nodeId, { x, y });

        const childNodes = children.get(nodeId) || [];
        if (childNodes.length === 0) return;

        // Calculate total width of children
        let totalChildWidth = 0;
        childNodes.forEach((childId) => {
          totalChildWidth += subtreeWidth.get(childId) || nodeWidth;
        });
        totalChildWidth += (childNodes.length - 1) * horizontalGap;

        // Position children centered under parent
        let childX = x - totalChildWidth / 2 + (subtreeWidth.get(childNodes[0]) || nodeWidth) / 2;
        const childY = y + nodeHeight + verticalGap;

        childNodes.forEach((childId, index) => {
          const childWidth = subtreeWidth.get(childId) || nodeWidth;
          if (index > 0) {
            const prevChildWidth = subtreeWidth.get(childNodes[index - 1]) || nodeWidth;
            childX += prevChildWidth / 2 + horizontalGap + childWidth / 2;
          }
          positionNode(childId, childX, childY);
        });
      };

      // Position all trees starting from roots
      let rootX = 0;
      roots.forEach((root, index) => {
        const rootWidth = subtreeWidth.get(root.span_id) || nodeWidth;
        if (index > 0) {
          const prevRootWidth = subtreeWidth.get(roots[index - 1].span_id) || nodeWidth;
          rootX += prevRootWidth / 2 + horizontalGap * 2 + rootWidth / 2;
        }
        positionNode(root.span_id, rootX, 0);
      });

      // Center the entire tree
      const allX = Array.from(positions.values()).map((p) => p.x);
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const offsetX = -(minX + maxX) / 2;

      positions.forEach((pos, id) => {
        positions.set(id, { x: pos.x + offsetX, y: pos.y });
      });

      return positions;
    };

    // Filter valid edges first (must be computed before nodes)
    const validEdges = computed(() => {
      if (!dagData.value || !dagData.value.nodes) return [];

      // Create a set of valid node IDs
      const validNodeIds = new Set(dagData.value.nodes.map((n) => n.span_id));

      // Filter out edges that reference non-existent nodes
      return dagData.value.edges.filter((edge) => {
        const isValid = validNodeIds.has(edge.from) && validNodeIds.has(edge.to);
        if (!isValid) {
          console.warn(`[TraceDAG] Skipping invalid edge: ${edge.from} → ${edge.to}`);
        }
        return isValid;
      });
    });

    const nodes = computed(() => {
      if (!dagData.value || !dagData.value.nodes) return [];

      // Calculate layout using only valid edges
      const positions = calculateLayout(dagData.value.nodes, validEdges.value);

      // Determine which nodes have incoming/outgoing edges
      const nodesWithIncoming = new Set(validEdges.value.map((e) => e.to));
      const nodesWithOutgoing = new Set(validEdges.value.map((e) => e.from));

      return dagData.value.nodes.map((node) => ({
        id: node.span_id,
        type: "custom",
        position: positions.get(node.span_id) || { x: 0, y: 0 },
        data: {
          ...node,
          hasIncoming: nodesWithIncoming.has(node.span_id),
          hasOutgoing: nodesWithOutgoing.has(node.span_id),
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      }));
    });

    const edges = computed(() => {
      if (!dagData.value) return [];

      return validEdges.value.map((edge) => ({
        id: `${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: "default",
        animated: false,
        markerEnd: MarkerType.ArrowClosed,
        style: {
          strokeWidth: 2,
          stroke: "#94a3b8",
        },
      }));
    });

    const fetchDAG = async () => {
      try {
        isLoading.value = true;
        error.value = null;

        const org = store.state.selectedOrganization.identifier;
        const response = await searchService.getTraceDAG(
          org,
          props.streamName,
          props.traceId,
          props.startTime,
          props.endTime,
        );
        dagData.value = response.data;
      } catch (err: any) {
        console.error("[TraceDAG] Failed to fetch DAG:", err);
        error.value =
          err.response?.data?.message || err.message || t("traces.traceDAG.unknownError");
      } finally {
        isLoading.value = false;
      }
    };

    // Watch for prop changes and refetch
    watch(
      () => [props.traceId, props.streamName, props.startTime, props.endTime] as const,
      ([traceId, streamName, startTime, endTime]) => {
        // Validate all props before fetching
        if (
          !traceId ||
          !streamName ||
          startTime == null ||
          endTime == null ||
          typeof startTime !== "number" ||
          typeof endTime !== "number" ||
          startTime >= endTime
        ) {
          error.value = t("traces.traceDAG.invalidParameters");
          isLoading.value = false;
          return;
        }

        fetchDAG();
      },
      { immediate: true },
    );

    const handleNodeClick = (spanId: string) => {
      emit("node-click", spanId);
    };

    // Map OTEL gen_ai.operation.name spec values to DAG CSS class suffixes.
    // Well-known spec values: chat, text_completion, generate_content, embeddings,
    //   invoke_agent, create_agent, execute_tool, invoke_workflow, retrieval
    // Custom values (no OTEL eq.): chain, task, evaluator, rerank, guardrail, span, event
    const specToCssSuffix: Record<string, string> = {
      chat: "generation",
      text_completion: "generation",
      generate_content: "generation",
      embeddings: "embedding",
      invoke_agent: "agent",
      create_agent: "agent",
      execute_tool: "tool",
      invoke_workflow: "workflow",
      retrieval: "retriever",
      chain: "chain",
      task: "task",
      evaluator: "evaluator",
      rerank: "rerank",
      guardrail: "guardrail",
      span: "span",
      event: "event",
    };

    // Node border+bg derived from ONE base token per type: border = base,
    // bg = base@12% over the surface. The base flips light/dark (see dark.css),
    // so no dark: variant is needed. Full literal classes so Tailwind compiles them.
    const llmNodeStyles: Record<string, string> = {
      generation:
        "border-[var(--color-dag-node-generation)] bg-[color-mix(in_srgb,var(--color-dag-node-generation)_12%,var(--color-surface-base))]",
      embedding:
        "border-[var(--color-dag-node-embedding)] bg-[color-mix(in_srgb,var(--color-dag-node-embedding)_12%,var(--color-surface-base))]",
      agent:
        "border-[var(--color-dag-node-agent)] bg-[color-mix(in_srgb,var(--color-dag-node-agent)_12%,var(--color-surface-base))]",
      tool: "border-[var(--color-dag-node-tool)] bg-[color-mix(in_srgb,var(--color-dag-node-tool)_12%,var(--color-surface-base))]",
      chain:
        "border-[var(--color-dag-node-chain)] bg-[color-mix(in_srgb,var(--color-dag-node-chain)_12%,var(--color-surface-base))]",
      retriever:
        "border-[var(--color-dag-node-retriever)] bg-[color-mix(in_srgb,var(--color-dag-node-retriever)_12%,var(--color-surface-base))]",
      task: "border-[var(--color-dag-node-task)] bg-[color-mix(in_srgb,var(--color-dag-node-task)_12%,var(--color-surface-base))]",
      evaluator:
        "border-[var(--color-dag-node-evaluator)] bg-[color-mix(in_srgb,var(--color-dag-node-evaluator)_12%,var(--color-surface-base))]",
      workflow:
        "border-[var(--color-dag-node-workflow)] bg-[color-mix(in_srgb,var(--color-dag-node-workflow)_12%,var(--color-surface-base))]",
      rerank:
        "border-[var(--color-dag-node-rerank)] bg-[color-mix(in_srgb,var(--color-dag-node-rerank)_12%,var(--color-surface-base))]",
      guardrail:
        "border-[var(--color-dag-node-guardrail)] bg-[color-mix(in_srgb,var(--color-dag-node-guardrail)_12%,var(--color-surface-base))]",
      span: "border-[var(--color-dag-node-default)] bg-[color-mix(in_srgb,var(--color-dag-node-default)_12%,var(--color-surface-base))]",
      event:
        "border-[var(--color-dag-node-event)] bg-[color-mix(in_srgb,var(--color-dag-node-event)_12%,var(--color-surface-base))]",
      default:
        "border-[var(--color-dag-node-default)] bg-[color-mix(in_srgb,var(--color-dag-node-default)_12%,var(--color-surface-base))]",
    };

    // Text = base mixed 70/30 toward the primary text color, which flips light/dark,
    // so text darkens in light mode and lightens in dark mode from the one base.
    const llmTextStyles: Record<string, string> = {
      generation:
        "text-[color-mix(in_srgb,var(--color-dag-node-generation)_70%,var(--color-text-heading))]",
      embedding:
        "text-[color-mix(in_srgb,var(--color-dag-node-embedding)_70%,var(--color-text-heading))]",
      agent: "text-[color-mix(in_srgb,var(--color-dag-node-agent)_70%,var(--color-text-heading))]",
      tool: "text-[color-mix(in_srgb,var(--color-dag-node-tool)_70%,var(--color-text-heading))]",
      chain: "text-[color-mix(in_srgb,var(--color-dag-node-chain)_70%,var(--color-text-heading))]",
      retriever:
        "text-[color-mix(in_srgb,var(--color-dag-node-retriever)_70%,var(--color-text-heading))]",
      task: "text-[color-mix(in_srgb,var(--color-dag-node-task)_70%,var(--color-text-heading))]",
      evaluator:
        "text-[color-mix(in_srgb,var(--color-dag-node-evaluator)_70%,var(--color-text-heading))]",
      workflow:
        "text-[color-mix(in_srgb,var(--color-dag-node-workflow)_70%,var(--color-text-heading))]",
      rerank:
        "text-[color-mix(in_srgb,var(--color-dag-node-rerank)_70%,var(--color-text-heading))]",
      guardrail:
        "text-[color-mix(in_srgb,var(--color-dag-node-guardrail)_70%,var(--color-text-heading))]",
      span: "text-[color-mix(in_srgb,var(--color-dag-node-default)_70%,var(--color-text-heading))]",
      event: "text-[color-mix(in_srgb,var(--color-dag-node-event)_70%,var(--color-text-heading))]",
      default:
        "text-[color-mix(in_srgb,var(--color-dag-node-default)_70%,var(--color-text-heading))]",
    };

    const getObservationTypeClass = (type: string | null): string => {
      if (!type) return "";
      const cssSuffix = specToCssSuffix[type.toLowerCase()];
      return llmNodeStyles[cssSuffix] || llmNodeStyles.default;
    };

    const getObservationTypeTextClass = (type: string | null): string => {
      if (!type) return "";
      const cssSuffix = specToCssSuffix[type.toLowerCase()];
      return llmTextStyles[cssSuffix] || llmTextStyles.default;
    };

    // Watch for sidebar state changes and re-center the DAG
    watch(
      () => props.sidebarOpen,
      () => {
        // When sidebar state changes, wait for DOM to update then fit the view
        nextTick(() => {
          // Small delay to allow container resize to complete
          setTimeout(() => {
            fitView({ padding: 0.3, duration: 300 });
          }, 50);
        });
      },
    );

    return {
      t,
      isLoading,
      error,
      dagData,
      nodes,
      edges,
      Position,
      handleNodeClick,
      getObservationTypeClass,
      getObservationTypeTextClass,
    };
  },
});
</script>

<style scoped>
/* keep: lib-override:vue-flow — the library's background layer paints its own
   surface over the canvas, so it has to be repainted here. The token flips
   light/dark on its own, which retires the `.dark`-only twin this replaced. */
.trace-dag-flow :deep(.vue-flow__background) {
  background-color: var(--color-surface-panel) !important;
}
</style>
