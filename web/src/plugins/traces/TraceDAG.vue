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
      <div class="q-mt-md text-grey-7">Loading trace DAG...</div>
    </div>

    <div v-else-if="error" class="error-message q-pa-md">
      <q-banner class="bg-negative text-white">
        <template #avatar>
          <q-icon name="error" color="white" />
        </template>
        Failed to load DAG: {{ error }}
      </q-banner>
    </div>

    <div v-else-if="!dagData || !dagData.nodes || dagData.nodes.length === 0" class="flex items-center justify-center column q-pa-xl empty-container">
      <q-icon name="info" size="48px" color="grey-5" />
      <div class="q-mt-md text-grey-7">No DAG data available</div>
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
          <Handle type="target" :position="Position.Top" class="dag-handle" />
          <div
            class="custom-node"
            :class="{
              'node-error': data.span_status === 'ERROR',
              'node-ok': data.span_status === 'OK'
            }"
            @click="handleNodeClick(data.span_id)"
          >
            <div class="node-operation">{{ data.operation_name }}</div>
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
          <Handle type="source" :position="Position.Bottom" class="dag-handle" />
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
import http from "@/services/http";

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
    const isLoading = ref(true);
    const error = ref<string | null>(null);
    const dagData = ref<DAGResponse | null>(null);

    // Get VueFlow instance for fitView functionality
    const { fitView } = useVueFlow();

    // Top-down tree layout algorithm
    const calculateLayout = (nodesData: SpanNode[], edgesData: SpanEdge[]) => {
      const nodeWidth = 140;
      const nodeHeight = 28;
      const horizontalGap = 16;
      const verticalGap = 36;

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

    const nodes = computed(() => {
      if (!dagData.value || !dagData.value.nodes) return [];

      const positions = calculateLayout(dagData.value.nodes, dagData.value.edges || []);

      return dagData.value.nodes.map((node) => ({
        id: node.span_id,
        type: "custom",
        position: positions.get(node.span_id) || { x: 0, y: 0 },
        data: node,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      }));
    });

    const edges = computed(() => {
      if (!dagData.value) return [];

      return dagData.value.edges.map((edge) => ({
        id: `${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: "default",
        animated: false,
        markerEnd: MarkerType.ArrowClosed,
        style: {
          strokeWidth: 1,
          stroke: "#888",
        },
      }));
    });

    const fetchDAG = async () => {
      try {
        isLoading.value = true;
        error.value = null;

        const org = store.state.selectedOrganization.identifier;
        const url = `/api/${org}/${props.streamName}/traces/${props.traceId}/dag?start_time=${props.startTime}&end_time=${props.endTime}`;

        const response = await http().get(url);
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
      isLoading,
      error,
      dagData,
      nodes,
      edges,
      Position,
      handleNodeClick,
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
      padding: 4px 8px;
      border-radius: 4px;
      background: white;
      border: 1.5px solid #1976d2;
      min-width: 60px;
      max-width: 140px;
      min-height: 22px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      transition: all 0.15s ease;
      cursor: pointer;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      &:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transform: scale(1.02);
      }

      &.node-error {
        border-color: #c62828;
        background: #ffebee;
      }

      &.node-ok {
        border-color: #2e7d32;
      }
    }

    .node-operation {
      font-size: 12px;
      color: #1976d2;
      font-weight: 500;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 124px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dag-handle {
      width: 5px;
      height: 5px;
      background: #1976d2;
      border: 1px solid white;
      border-radius: 50%;
    }

    .error-chip {
      font-size: 9px;
      height: 12px;
      margin-top: 1px;
    }
  }
}

.error-message {
  padding: 20px;
}

body.dark {
  .trace-dag-flow {
    background-color: #1e1e1e;

    .vue-flow__node-custom {
      .custom-node {
        background: #2a2a2a;
        border-color: #64b5f6;
        color: #e0e0e0;
        border-width: 1.5px;
        max-width: 140px;

        &.node-error {
          border-color: #ef5350;
          background: #3a1a1a;
        }

        &.node-ok {
          border-color: #66bb6a;
        }
      }

      .node-operation {
        color: #90caf9;
        font-size: 12px;
        max-width: 124px;
      }
    }
  }
}
</style>
