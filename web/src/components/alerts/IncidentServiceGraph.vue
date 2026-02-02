<!-- Copyright 2025 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="incident-service-graph" style="height: calc(100vh - 202px); position: relative;">
    <!-- Info Icon Button -->
    <q-btn
      v-if="!loading && graphData && graphData.nodes && graphData.nodes.length > 0"
      round
      flat
      icon="info_outline"
      size="sm"
      class="info-icon-btn"
      :class="isDarkMode ? 'tw-text-gray-400 hover:tw-text-gray-200' : 'tw-text-gray-500 hover:tw-text-gray-700'"
    >
      <q-tooltip
        :delay="200"
        anchor="bottom left"
        self="top right"
        :offset="[10, 10]"
        max-width="300px"
      >
        <div style="padding: 8px; font-size: 12px; line-height: 1.6;">
          <div style="font-weight: 600; margin-bottom: 8px; font-size: 13px;">Graph Legend</div>

          <div style="margin-bottom: 6px;">
            <span style="color: #ef4444;">●</span> Red = Potential Root Cause
          </div>
          <div style="margin-bottom: 6px;">
            <span style="color: #f97316;">●</span> Orange = High Frequency
          </div>
          <div style="margin-bottom: 6px;">
            <span style="color: #3b82f6;">●</span> Blue = Normal
          </div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
            <span style="color: #a78bfa;">→</span> Purple arrows show temporal flow
          </div>
        </div>
      </q-tooltip>
    </q-btn>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="tw-flex tw-items-center tw-justify-center tw-h-full"
      :class="isDarkMode ? 'tw-bg-gray-900/50' : 'tw-bg-white/50'"
    >
      <q-spinner size="lg" color="primary" />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!graphData || !graphData.nodes || graphData.nodes.length === 0"
      class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-h-full"
    >
      <q-icon name="hub" size="48px" :class="isDarkMode ? 'tw-text-gray-600' : 'tw-text-gray-300'" />
      <div class="tw-text-center">
        <div class="tw-text-sm tw-font-medium" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-600'">
          Service Graph Unavailable
        </div>
        <div class="tw-text-xs tw-mt-1" :class="isDarkMode ? 'tw-text-gray-500' : 'tw-text-gray-400'">
          No topology data available for this incident.
        </div>
      </div>
    </div>

    <!-- Graph Canvas using ECharts -->
    <div
      v-if="!loading && graphData && graphData.nodes && graphData.nodes.length > 0"
      style="width: 100%; height: 100%;"
    >
      <ChartRenderer
        ref="chartRendererRef"
        :data="chartData"
        :key="chartKey"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from "d3-force";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { AlertNode } from "@/services/incidents";
import DropzoneBackground from "@/plugins/pipelines/DropzoneBackground.vue";

export default defineComponent({
  name: "IncidentServiceGraph",
  components: {
    ChartRenderer,
    DropzoneBackground,
  },
  props: {
    topologyContext: {
      type: Object as () => { nodes: AlertNode[]; edges: any[] } | null,
      required: false,
      default: null,
    },
  },
  setup(props) {
    const store = useStore();

    const loading = ref(false);
    const chartRendererRef = ref<any>(null);
    const chartKey = ref(0);
    const nodePositions = ref<Map<string, { x: number; y: number }>>(new Map());

    const isDarkMode = computed(() => store.state.theme === "dark");

    // Use topology_context directly from props
    const graphData = computed(() => props.topologyContext);

    // D3-Force simulation to compute stable node positions with left-to-right layout
    const computeForceLayout = (nodes: any[], edges: any[], width = 800, height = 600) => {
      const nodesCopy = nodes.map(n => ({ ...n }));
      const edgesCopy = edges.map(e => ({
        source: e.source,
        target: e.target,
        ...e,
      }));

      // Calculate depth/level for each node (for left-to-right positioning)
      const nodeDepth = new Map<string, number>();
      nodesCopy.forEach(n => nodeDepth.set(n.id, 0));

      // Build adjacency list from temporal edges to determine hierarchy
      const temporalEdges = edgesCopy.filter(e => e.originalEdge?.edge_type === 'temporal');
      const visited = new Set<string>();

      // BFS to calculate depth
      const queue: Array<{ id: string; depth: number }> = [];

      // Find root nodes (nodes with no incoming temporal edges)
      const hasIncoming = new Set(temporalEdges.map(e => typeof e.target === 'string' ? e.target : e.target.id));
      nodesCopy.forEach(n => {
        if (!hasIncoming.has(n.id)) {
          queue.push({ id: n.id, depth: 0 });
        }
      });

      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        nodeDepth.set(id, depth);

        // Find outgoing temporal edges
        temporalEdges.forEach(edge => {
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          if (sourceId === id) {
            queue.push({ id: targetId, depth: depth + 1 });
          }
        });
      }

      const simulation = forceSimulation(nodesCopy)
        .force('charge', forceManyBody().strength(-400).distanceMax(1200))
        .force('link', forceLink(edgesCopy)
          .id((d: any) => d.id)
          .distance(180)
          .strength(0.5)
          .iterations(2)
        )
        .force('x', forceX((d: any) => {
          // Position nodes left-to-right based on their depth, starting from extreme left
          const depth = nodeDepth.get(d.id) || 0;
          const maxDepth = Math.max(...Array.from(nodeDepth.values()));
          const leftMargin = 80; // Left margin to prevent nodes from touching the edge
          const rightMargin = 80; // Right margin
          const availableWidth = width - leftMargin - rightMargin;
          const spacing = maxDepth > 0 ? availableWidth / maxDepth : 0;
          return leftMargin + spacing * depth;
        }).strength(1.5)) // Strong horizontal positioning
        .force('y', forceY((d: any) => {
          // Stronger vertical centering for root nodes (depth 0)
          const depth = nodeDepth.get(d.id) || 0;
          return height / 2;
        }).strength((d: any) => {
          // Stronger centering for root nodes
          const depth = nodeDepth.get(d.id) || 0;
          return depth === 0 ? 0.8 : 0.1; // Much stronger centering for root nodes
        }))
        .force('collision', forceCollide()
          .radius((d: any) => (d.symbolSize || 60) / 2 + 50)
          .strength(1.0)
          .iterations(3)
        )
        .velocityDecay(0.4)
        .stop();

      // Run simulation for 5000 iterations to stabilize
      for (let i = 0; i < 5000; i++) {
        simulation.tick();
      }

      return simulation.nodes().map(n => ({ ...n }));
    };

    // No longer need to load graph via API - data comes from props
    const loadGraph = () => {
      // Increment chartKey to force re-render if topology_context changes
      chartKey.value++;
    };

    const getNodeColor = (node: AlertNode, index: number): string => {
      // First node (chronologically first alert) is highlighted as potential root cause
      if (index === 0) {
        return "#ef4444"; // red-500 - first alert
      }
      if (node.alert_count > 5) {
        return "#f97316"; // orange-500 - high frequency
      }
      return "#3b82f6"; // blue-500 - normal
    };

    const getNodeSize = (node: AlertNode): number => {
      return 60; // Fixed size for all nodes
    };

    const chartData = computed(() => {
      if (!graphData.value || !graphData.value.nodes || graphData.value.nodes.length === 0) {
        return { options: {}, notMerge: true };
      }

      const { nodes, edges } = graphData.value;

      // Prepare nodes for D3-force simulation
      const preparedNodes = nodes.map((node, index) => ({
        name: node.alert_name, // Show only alert name for cleaner labels
        id: index.toString(),
        symbolSize: getNodeSize(node),
        originalNode: node,
        originalIndex: index,
      }));

      // Prepare edges for D3-force simulation
      const preparedEdges = edges.map((edge) => ({
        source: edge.from_node_index.toString(),
        target: edge.to_node_index.toString(),
        originalEdge: edge,
      }));

      // Compute force-directed layout positions using D3 with left-to-right layout
      // Only compute if we don't have cached positions for these nodes
      let positionedNodes;
      const hasAllPositions = preparedNodes.every(n => nodePositions.value.has(n.id));

      if (hasAllPositions) {
        // Use cached positions
        positionedNodes = preparedNodes.map(n => ({
          ...n,
          x: nodePositions.value.get(n.id)!.x,
          y: nodePositions.value.get(n.id)!.y,
        }));
      } else {
        // Compute new positions and cache them with wider canvas for left-to-right layout
        positionedNodes = computeForceLayout(preparedNodes, preparedEdges, 1200, 400);
        positionedNodes.forEach((node: any) => {
          nodePositions.value.set(node.id, { x: node.x, y: node.y });
        });
      }

      // Convert to ECharts graph format with computed fixed positions
      const echartsNodes = positionedNodes.map((node: any) => {
        const originalNode = node.originalNode;
        const index = node.originalIndex;

        return {
          name: node.name,
          id: node.id,
          x: node.x,
          y: node.y,
          fixed: true, // Lock position so ECharts doesn't re-layout
          symbolSize: node.symbolSize,
          itemStyle: {
            color: getNodeColor(originalNode, index),
            borderColor: index === 0 ? "#dc2626" : getNodeColor(originalNode, index),
            borderWidth: index === 0 ? 4 : 2,
          },
          label: {
            show: true,
            position: "bottom",
            distance: 5,
            fontSize: 11,
            color: isDarkMode.value ? "#e5e7eb" : "#374151",
            formatter: `{b}`,
            backgroundColor: isDarkMode.value ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
            borderRadius: 4,
            padding: [4, 8],
            shadowColor: "rgba(0, 0, 0, 0.3)",
            shadowBlur: 4,
          },
          tooltip: {
            formatter: () => {
              const firstTime = new Date(originalNode.first_fired_at / 1000).toLocaleString();
              const lastTime = originalNode.alert_count > 1 ? new Date(originalNode.last_fired_at / 1000).toLocaleString() : null;

              let html = `<div style="padding: 8px; font-size: 12px;">`;
              html += `<strong style="font-size: 14px;">${originalNode.alert_name}</strong><br/>`;
              html += `Service: <strong>${originalNode.service_name}</strong><br/><br/>`;
              html += `Alert Count: <strong>${originalNode.alert_count}</strong><br/>`;
              html += `First Fired: ${firstTime}<br/>`;
              if (lastTime) {
                html += `Last Fired: ${lastTime}<br/>`;
              }
              if (index === 0) {
                html += `<br/><span style="color: #ef4444;">⚠ First Alert (Potential Root Cause)</span>`;
              }
              html += `</div>`;
              return html;
            },
          },
        };
      });

      const echartsEdges = edges.map((edge) => {
        const sourceNode = nodes[edge.from_node_index];
        const targetNode = nodes[edge.to_node_index];

        return {
          source: edge.from_node_index.toString(),
          target: edge.to_node_index.toString(),
          lineStyle: {
            color: edge.edge_type === "temporal"
              ? (isDarkMode.value ? "#a78bfa" : "#8b5cf6") // purple for temporal
              : (isDarkMode.value ? "#6b7280" : "#9ca3af"), // gray for service dependency
            width: edge.edge_type === "temporal" ? 3 : 2,
            curveness: 0.2,
            type: "solid",
          },
          symbol: ["none", "arrow"],
          symbolSize: [0, 10],
          label: {
            show: false, // Hide edge labels for cleaner visualization
          },
          tooltip: {
            formatter: () => {
              let html = `<div style="padding: 8px; font-size: 12px; text-align: center;">`;
              html += `<strong>${sourceNode.alert_name}</strong> <span style="color: #a78bfa;">→</span> <strong>${targetNode.alert_name}</strong><br/><br/>`;

              if (edge.edge_type === "temporal") {
                const sourceTime = new Date(sourceNode.first_fired_at / 1000);
                const targetTime = new Date(targetNode.first_fired_at / 1000);
                const timeDiff = Math.abs(targetTime.getTime() - sourceTime.getTime());

                // Format time difference
                const seconds = Math.floor(timeDiff / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                let timeStr = "";
                if (days > 0) timeStr = `${days}d ${hours % 24}h`;
                else if (hours > 0) timeStr = `${hours}h ${minutes % 60}m`;
                else if (minutes > 0) timeStr = `${minutes}m ${seconds % 60}s`;
                else timeStr = `${seconds}s`;

                html += `<span style="color: #a78bfa;">⏱ Time difference: <strong>${timeStr}</strong></span><br/>`;
                html += `From: ${sourceTime.toLocaleString()}<br/>`;
                html += `To: ${targetTime.toLocaleString()}<br/>`;
                html += `<br/><span style="color: #a78bfa;">Temporal correlation</span>`;
              } else {
                html += `<span style="color: #9ca3af;">Service dependency</span>`;
              }

              html += `</div>`;
              return html;
            },
          },
        };
      });

      const options = {
        tooltip: {
          trigger: "item",
          backgroundColor: isDarkMode.value ? "#1f2937" : "#ffffff",
          borderColor: isDarkMode.value ? "#374151" : "#e5e7eb",
          textStyle: {
            color: isDarkMode.value ? "#e5e7eb" : "#374151",
          },
        },
        animation: false, // Disable animation since we have pre-computed positions
        series: [
          {
            type: "graph",
            layout: "none", // Use none since we pre-computed positions with D3
            roam: true,
            draggable: true,
            focusNodeAdjacency: true,
            scaleLimit: {
              min: 0.4,
              max: 3,
            },
            data: echartsNodes,
            links: echartsEdges,
            emphasis: {
              focus: "adjacency",
              lineStyle: {
                width: 4,
              },
            },
            lineStyle: {
              opacity: 0.7,
            },
          },
        ],
      };

      return { options, notMerge: !hasAllPositions }; // Merge when using cached positions
    });

    // Watch for topology_context changes
    watch(
      () => props.topologyContext,
      () => {
        // Clear cached positions when topology changes
        nodePositions.value.clear();
        loadGraph();
      },
      { deep: true }
    );

    return {
      loading,
      graphData,
      chartRendererRef,
      chartData,
      chartKey,
      isDarkMode,
      loadGraph,
    };
  },
});
</script>

<style scoped>
.incident-service-graph {
  min-height: 400px;
  display: flex;
  flex-direction: column;
  margin: 12px;
  padding: 20px;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.info-icon-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  transition: all 0.2s ease;
}

.info-icon-btn:hover {
  transform: scale(1.1);
}

/* Light mode */
.incident-service-graph {
  background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
  border: 1px solid #e5e7eb;
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.08),
    0 1px 2px 0 rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.incident-service-graph:hover {
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

/* Dark mode */
.body--dark .incident-service-graph {
  background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  border: 1px solid #374151;
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.3),
    0 1px 2px 0 rgba(0, 0, 0, 0.2),
    inset 0 0 0 1px rgba(75, 85, 99, 0.3);
}

.body--dark .incident-service-graph:hover {
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.4),
    0 2px 4px -1px rgba(0, 0, 0, 0.3),
    inset 0 0 0 1px rgba(75, 85, 99, 0.3);
}
</style>
