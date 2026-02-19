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
  <div class="trace-dag-container">
    <div v-if="isLoading" class="flex items-center justify-center column q-pa-xl loading-container">
      <q-spinner color="primary" size="50px" />
      <div class="q-mt-md text-grey-7">
        {{ t("traces.dag.loading") }} DAG...
      </div>
    </div>

    <div v-else-if="error" class="error-message q-pa-md">
      <q-banner class="bg-negative text-white">
        <template #avatar>
          <q-icon name="error" color="white" />
        </template>
        {{ t("traces.dag.loadFailed") }} DAG : {{ error }}
      </q-banner>
    </div>

    <div v-else-if="!dagData || !dagData.nodes || dagData.nodes.length === 0" class="flex items-center justify-center column q-pa-xl empty-container">
      <q-icon name="info" size="48px" color="grey-5" />
      <div class="q-mt-md text-grey-7">{{ t("traces.dag.noData") }}</div>
    </div>

    <div v-else class="dag-wrapper">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :default-viewport="{ zoom: 0.8, x: 0, y: 30 }"
        :min-zoom="0.2"
        :max-zoom="3"
        fit-view-on-init
        :fit-view-options="{ padding: 0.3, minZoom: 0.3, maxZoom: 0.7 }"
        class="trace-dag-flow"
      >
        <Background pattern-color="#aaa" :gap="16" />
        <Controls />

        <template #node-custom="{ data }">
          <Handle v-if="data.hasIncoming" type="target" :position="Position.Top" class="dag-handle" />
          <div
            class="custom-node"
            :class="[
              getObservationTypeClass(data.llm_observation_type),
              {
                'node-error': data.span_status === 'ERROR',
                'node-ok': data.span_status === 'OK' && !data.llm_observation_type,
              }
            ]"
            @click="handleNodeClick(data.span_id)"
          >
            <div class="node-operation" :class="getObservationTypeTextClass(data.llm_observation_type)">{{ data.operation_name }}</div>
            <q-chip
              v-if="data.span_status === 'ERROR'"
              dense
              size="xs"
              color="negative"
              text-color="white"
              class="error-chip"
            >
              ERR
            </q-chip>
          </div>
          <Handle v-if="data.hasOutgoing" type="source" :position="Position.Bottom" class="dag-handle" />
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

interface SpanNode {
  span_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  span_status: string;
  start_time: number;
  end_time: number;
  llm_observation_type: string | null;
}

interface SpanEdge {
  from: string;
  to: string;
}

interface DAGResponse {
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
      children.forEach((childIds, parentId) => {
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
      const allX = Array.from(positions.values()).map(p => p.x);
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
      const validNodeIds = new Set(dagData.value.nodes.map(n => n.span_id));

      // Filter out edges that reference non-existent nodes
      return dagData.value.edges.filter(edge => {
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
      const nodesWithIncoming = new Set(validEdges.value.map(e => e.to));
      const nodesWithOutgoing = new Set(validEdges.value.map(e => e.from));

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
        error.value = err.response?.data?.message || err.message || "Unknown error occurred";
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
          typeof startTime !== 'number' ||
          typeof endTime !== 'number' ||
          startTime >= endTime
        ) {
          error.value = "Invalid parameters for DAG fetch";
          isLoading.value = false;
          return;
        }

        fetchDAG();
      },
      { immediate: true }
    );

    const handleNodeClick = (spanId: string) => {
      emit("node-click", spanId);
    };

    // Known LLM observation types (from ObservationType enum)
    const knownObservationTypes = new Set([
      'generation', 'span', 'tool', 'agent', 'chain', 'retriever',
      'task', 'evaluator', 'workflow', 'embedding', 'rerank', 'guardrail', 'event',
    ]);

    const getObservationTypeClass = (type: string | null): string => {
      if (!type) return '';
      const key = type.toLowerCase();
      if (knownObservationTypes.has(key)) return `node-llm-${key}`;
      return 'node-llm-default';
    };

    const getObservationTypeTextClass = (type: string | null): string => {
      if (!type) return '';
      const key = type.toLowerCase();
      if (knownObservationTypes.has(key)) return `node-llm-text-${key}`;
      return 'node-llm-text-default';
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
      }
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

<style lang="scss">
.trace-dag-container {
  width: 100%;
  height: 100%;
  min-height: 500px;
}

.loading-container,
.empty-container {
  height: 500px;
}

.dag-wrapper {
  width: 100%;
  height: 100%;
  min-height: 600px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  position: relative;
}

.trace-dag-flow {
  width: 100%;
  height: 100%;
  background-color: #fafafa;

  .vue-flow__node-custom {
    .custom-node {
      padding: 6px 12px;
      border-radius: 6px;
      background: white;
      border: 2px solid #1976d2;
      min-width: 80px;
      max-width: 180px;
      min-height: 28px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
      transition: all 0.2s ease;
      cursor: pointer;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transform: translateY(-2px);
      }

      &.node-error {
        border-color: #c62828;
        background: #ffebee;
      }

      &.node-ok {
        border-color: #2e7d32;
      }

      // LLM observation type node colors (consistent with llmUtils getObservationTypeColor)
      &.node-llm-generation { border-color: #4caf50; background: #e8f5e9; }  // green
      &.node-llm-embedding  { border-color: #2196f3; background: #e3f2fd; }  // blue
      &.node-llm-agent      { border-color: #9c27b0; background: #f3e5f5; }  // purple
      &.node-llm-tool       { border-color: #ff9800; background: #fff3e0; }  // orange
      &.node-llm-chain      { border-color: #3f51b5; background: #e8eaf6; }  // indigo
      &.node-llm-retriever  { border-color: #00bcd4; background: #e0f7fa; }  // cyan
      &.node-llm-task       { border-color: #009688; background: #e0f2f1; }  // teal
      &.node-llm-evaluator  { border-color: #e91e63; background: #fce4ec; }  // pink
      &.node-llm-workflow   { border-color: #673ab7; background: #ede7f6; }  // deep-purple
      &.node-llm-rerank     { border-color: #03a9f4; background: #e1f5fe; }  // light-blue
      &.node-llm-guardrail  { border-color: #f44336; background: #ffebee; }  // red
      &.node-llm-span       { border-color: #9e9e9e; background: #f5f5f5; }  // grey
      &.node-llm-event      { border-color: #ffc107; background: #fff8e1; }  // amber
      &.node-llm-default    { border-color: #9e9e9e; background: #fafafa; }
    }

    .node-operation {
      font-size: 13px;
      color: #1976d2;
      font-weight: 600;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 160px;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      &.node-llm-text-generation { color: #388e3c; }  // green-dark
      &.node-llm-text-embedding  { color: #1976d2; }  // blue-dark
      &.node-llm-text-agent      { color: #7b1fa2; }  // purple-dark
      &.node-llm-text-tool       { color: #e65100; }  // orange-dark
      &.node-llm-text-chain      { color: #283593; }  // indigo-dark
      &.node-llm-text-retriever  { color: #00838f; }  // cyan-dark
      &.node-llm-text-task       { color: #00796b; }  // teal-dark
      &.node-llm-text-evaluator  { color: #c2185b; }  // pink-dark
      &.node-llm-text-workflow   { color: #4527a0; }  // deep-purple-dark
      &.node-llm-text-rerank     { color: #0277bd; }  // light-blue-dark
      &.node-llm-text-guardrail  { color: #c62828; }  // red-dark
      &.node-llm-text-span       { color: #616161; }  // grey-dark
      &.node-llm-text-event      { color: #f57f17; }  // amber-dark
      &.node-llm-text-default    { color: #757575; }
    }

    .dag-handle {
      width: 8px;
      height: 8px;
      background: #1976d2;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    .error-chip {
      font-size: 10px;
      height: 14px;
      margin-top: 2px;
      padding: 0 4px;
    }
  }
}

.error-message {
  padding: 20px;
}

.body--dark {
  .dag-wrapper {
    border-color: #444;
  }

  .trace-dag-flow {
    background-color: #1e1e1e !important;

    .vue-flow__background {
      background-color: #1e1e1e !important;
    }

    .vue-flow__node-custom {
      .custom-node {
        background: #2a2a2a;
        border-color: #64b5f6;
        color: #e0e0e0;
        border-width: 2px;
        max-width: 180px;

        &.node-error {
          border-color: #ef5350;
          background: #3a1a1a;
        }

        &.node-ok {
          border-color: #66bb6a;
        }

        // LLM observation type dark mode colors (consistent with llmUtils)
        &.node-llm-generation { border-color: #66bb6a; background: #1a2e1a; }  // green
        &.node-llm-embedding  { border-color: #64b5f6; background: #1a2a3a; }  // blue
        &.node-llm-agent      { border-color: #ce93d8; background: #2a1a2e; }  // purple
        &.node-llm-tool       { border-color: #ffb74d; background: #2e2218; }  // orange
        &.node-llm-chain      { border-color: #7986cb; background: #1a1a2e; }  // indigo
        &.node-llm-retriever  { border-color: #4dd0e1; background: #1a2a2e; }  // cyan
        &.node-llm-task       { border-color: #4db6ac; background: #1a2e2a; }  // teal
        &.node-llm-evaluator  { border-color: #f48fb1; background: #2e1a22; }  // pink
        &.node-llm-workflow   { border-color: #b39ddb; background: #221a2e; }  // deep-purple
        &.node-llm-rerank     { border-color: #4fc3f7; background: #1a2a3a; }  // light-blue
        &.node-llm-guardrail  { border-color: #ef5350; background: #2e1a1a; }  // red
        &.node-llm-span       { border-color: #9e9e9e; background: #262626; }  // grey
        &.node-llm-event      { border-color: #ffd54f; background: #2e2a18; }  // amber
        &.node-llm-default    { border-color: #9e9e9e; background: #262626; }
      }

      .node-operation {
        color: #90caf9;
        font-size: 13px;
        max-width: 160px;

        &.node-llm-text-generation { color: #81c784; }  // green-light
        &.node-llm-text-embedding  { color: #90caf9; }  // blue-light
        &.node-llm-text-agent      { color: #ce93d8; }  // purple-light
        &.node-llm-text-tool       { color: #ffcc80; }  // orange-light
        &.node-llm-text-chain      { color: #9fa8da; }  // indigo-light
        &.node-llm-text-retriever  { color: #80deea; }  // cyan-light
        &.node-llm-text-task       { color: #80cbc4; }  // teal-light
        &.node-llm-text-evaluator  { color: #f48fb1; }  // pink-light
        &.node-llm-text-workflow   { color: #b39ddb; }  // deep-purple-light
        &.node-llm-text-rerank     { color: #81d4fa; }  // light-blue-light
        &.node-llm-text-guardrail  { color: #ef9a9a; }  // red-light
        &.node-llm-text-span       { color: #bdbdbd; }  // grey-light
        &.node-llm-text-event      { color: #ffe082; }  // amber-light
        &.node-llm-text-default    { color: #bdbdbd; }
      }
    }
  }
}
</style>
