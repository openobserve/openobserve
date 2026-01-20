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
  <div class="incident-service-graph tw-flex tw-flex-col tw-h-full">
    <!-- Header with controls -->
    <div
      class="tw-flex tw-items-center tw-justify-between tw-px-3 tw-py-2 tw-border-b tw-flex-shrink-0"
      :class="isDarkMode ? 'tw-border-gray-700' : 'tw-border-gray-200'"
    >
      <div class="tw-flex tw-items-center tw-gap-2">
        <q-select
          v-model="layout"
          :options="layoutOptions"
          dense
          outlined
          emit-value
          map-options
          class="tw-w-36"
          :dark="isDarkMode"
          @update:model-value="onLayoutChange"
        />
        <q-btn
          flat
          dense
          round
          icon="refresh"
          @click="loadGraph"
          :loading="loading"
        >
          <q-tooltip>Refresh graph</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Stats Banner -->
    <div
      v-if="graphData"
      class="tw-flex tw-gap-4 tw-px-3 tw-py-2 tw-border-b tw-flex-shrink-0"
      :class="isDarkMode ? 'tw-bg-gray-800/50 tw-border-gray-700' : 'tw-bg-gray-50 tw-border-gray-200'"
    >
      <div class="tw-flex tw-items-center tw-gap-1.5">
        <q-icon name="hub" size="16px" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-500'" />
        <span class="tw-text-xs" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-600'">Services:</span>
        <span class="tw-text-xs tw-font-semibold" :class="isDarkMode ? 'tw-text-gray-200' : 'tw-text-gray-800'">
          {{ graphData.stats.total_services }}
        </span>
      </div>
      <div class="tw-flex tw-items-center tw-gap-1.5">
        <q-icon name="notifications" size="16px" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-500'" />
        <span class="tw-text-xs" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-600'">Total Alerts:</span>
        <span class="tw-text-xs tw-font-semibold" :class="isDarkMode ? 'tw-text-gray-200' : 'tw-text-gray-800'">
          {{ graphData.stats.total_alerts }}
        </span>
      </div>
      <div v-if="graphData.root_cause_service" class="tw-flex tw-items-center tw-gap-1.5">
        <q-icon name="gps_fixed" size="16px" class="tw-text-red-500" />
        <span class="tw-text-xs" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-600'">Root Cause:</span>
        <span class="tw-text-xs tw-font-semibold tw-text-red-500">
          {{ graphData.root_cause_service }}
        </span>
      </div>
    </div>

    <!-- Graph Container -->
    <div class="tw-flex-1 tw-relative tw-overflow-hidden">
      <!-- Loading State -->
      <div
        v-if="loading"
        class="tw-absolute tw-inset-0 tw-flex tw-items-center tw-justify-center"
        :class="isDarkMode ? 'tw-bg-gray-900/50' : 'tw-bg-white/50'"
      >
        <q-spinner size="lg" color="primary" />
      </div>

      <!-- Empty State -->
      <div
        v-else-if="!graphData || graphData.nodes.length === 0"
        class="tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-3"
      >
        <q-icon name="hub" size="48px" :class="isDarkMode ? 'tw-text-gray-600' : 'tw-text-gray-300'" />
        <div class="tw-text-center">
          <div class="tw-text-sm tw-font-medium" :class="isDarkMode ? 'tw-text-gray-400' : 'tw-text-gray-600'">
            Service Graph Unavailable
          </div>
          <div class="tw-text-xs tw-mt-1" :class="isDarkMode ? 'tw-text-gray-500' : 'tw-text-gray-400'">
            Topology data is being generated in the background.
          </div>
        </div>
        <q-btn
          outline
          color="primary"
          size="sm"
          no-caps
          @click="loadGraph"
          :loading="loading"
        >
          Refresh to Check Again
        </q-btn>
      </div>

      <!-- Graph Canvas using ECharts -->
      <div
        v-if="!loading && graphData && graphData.nodes.length > 0"
        style="width: 100%; height: calc(100vh - 150px)"
      >
        <ChartRenderer
          ref="chartRendererRef"
          :data="chartData"
          :key="chartKey"
          class="tw-h-full"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from "d3-force";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import incidentsService, { IncidentServiceGraph, AlertNode } from "@/services/incidents";

export default defineComponent({
  name: "IncidentServiceGraph",
  components: {
    ChartRenderer,
  },
  props: {
    orgId: {
      type: String,
      required: true,
    },
    incidentId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const $q = useQuasar();

    const loading = ref(false);
    const graphData = ref<IncidentServiceGraph | null>(null);
    const chartRendererRef = ref<any>(null);
    const layout = ref("force");
    const chartKey = ref(0);
    const nodePositions = ref<Map<string, { x: number; y: number }>>(new Map());

    const layoutOptions = [
      { label: "Force Directed", value: "force" },
      { label: "Circular", value: "circular" },
    ];

    const isDarkMode = computed(() => store.state.theme === "dark");

    // D3-Force simulation to compute stable node positions
    const computeForceLayout = (nodes: any[], edges: any[], width = 800, height = 600) => {
      const nodesCopy = nodes.map(n => ({ ...n }));
      const edgesCopy = edges.map(e => ({
        source: e.source,
        target: e.target,
        ...e,
      }));

      const simulation = forceSimulation(nodesCopy)
        .force('charge', forceManyBody().strength(-200).distanceMax(1200)) // Minimal repulsion for very tight clustering
        .force('link', forceLink(edgesCopy)
          .id((d: any) => d.id)
          .distance(100) // Reduced from 250 to 100 for much closer nodes
          .strength(0.8) // Increased from 0.6 to pull nodes together more
          .iterations(3)
        )
        .force('center', forceCenter(width / 2, height / 2).strength(0.1)) // Increased from 0.05 for stronger centering
        .force('x', forceX(width / 2).strength(0.15)) // Increased for tighter clustering
        .force('y', forceY(height / 2).strength(0.15)) // Increased for tighter clustering
        .force('collision', forceCollide()
          .radius((d: any) => (d.symbolSize || 60) / 2 + 30) // Reduced padding from 80 to 30
          .strength(1.0)
          .iterations(2)
        )
        .velocityDecay(0.35)
        .stop();

      // Run simulation for 5000 iterations to stabilize
      for (let i = 0; i < 5000; i++) {
        simulation.tick();
      }

      return simulation.nodes().map(n => ({ ...n }));
    };

    const loadGraph = async () => {
      loading.value = true;
      try {
        const response = await incidentsService.getServiceGraph(props.orgId, props.incidentId);
        graphData.value = response.data;
        // Don't increment chartKey to preserve node positions
      } catch (error: any) {
        console.error("Failed to load service graph:", error);

        // Handle different error cases
        if (error?.response?.status === 403) {
          // Enterprise feature not available
          $q.notify({
            type: "warning",
            message: "Service Graph is an enterprise feature",
          });
        } else if (error?.response?.status !== 404) {
          $q.notify({
            type: "negative",
            message: "Failed to load service graph",
          });
        }
        // For 404, just show empty state (topology not yet available)
      } finally {
        loading.value = false;
      }
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
      const size = 30 + node.alert_count * 5;
      return Math.min(size, 100); // Cap at 100 to prevent oversized nodes
    };

    const chartData = computed(() => {
      if (!graphData.value || graphData.value.nodes.length === 0) {
        return { options: {}, notMerge: true };
      }

      const { nodes, edges, incident_service, root_cause_service } = graphData.value;

      // Prepare nodes for D3-force simulation
      const preparedNodes = nodes.map((node, index) => ({
        name: `${node.alert_name}\n${node.service_name}`,
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

      // Compute force-directed layout positions using D3 with smaller area for tighter clustering
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
        // Compute new positions and cache them
        positionedNodes = computeForceLayout(preparedNodes, preparedEdges, 300, 300);
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

      const echartsEdges = edges.map((edge) => ({
        source: edge.from_node_index.toString(),
        target: edge.to_node_index.toString(),
        lineStyle: {
          color: edge.edge_type === "temporal"
            ? (isDarkMode.value ? "#a78bfa" : "#8b5cf6") // purple for temporal
            : (isDarkMode.value ? "#6b7280" : "#9ca3af"), // gray for service dependency
          width: edge.edge_type === "temporal" ? 3 : 2,
          curveness: 0.2,
          type: edge.edge_type === "temporal" ? "dashed" : "solid",
        },
        symbol: ["none", "arrow"],
        symbolSize: [0, 10],
        label: {
          show: true,
          formatter: edge.edge_type === "temporal" ? "time →" : "",
          fontSize: 10,
          color: isDarkMode.value ? "#a78bfa" : "#8b5cf6",
        },
      }));

      const layoutConfig = layout.value === "circular"
        ? {
            type: "circular",
            circular: {
              rotateLabel: true,
            },
          }
        : {
            type: "force",
            force: {
              repulsion: 300,
              gravity: 0.1,
              edgeLength: 150,
              layoutAnimation: true,
            },
          };

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

    const onLayoutChange = () => {
      chartKey.value++;
    };

    // Watch for incident changes
    watch(
      () => props.incidentId,
      () => {
        loadGraph();
      }
    );

    onMounted(() => {
      loadGraph();
    });

    return {
      loading,
      graphData,
      chartRendererRef,
      layout,
      layoutOptions,
      chartData,
      chartKey,
      isDarkMode,
      loadGraph,
      onLayoutChange,
    };
  },
});
</script>

<style scoped>
.incident-service-graph {
  min-height: 400px;
}
</style>
