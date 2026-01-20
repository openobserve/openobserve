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
    <!-- Graph Container -->
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
        class="tw-absolute tw-inset-0"
      >
        <ChartRenderer
          ref="chartRendererRef"
          :data="chartData"
          :key="chartKey"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
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
    const chartKey = ref(0);

    const isDarkMode = computed(() => store.state.theme === "dark");

    const loadGraph = async () => {
      loading.value = true;
      try {
        const response = await incidentsService.getServiceGraph(props.orgId, props.incidentId);
        graphData.value = response.data;
        chartKey.value++;
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

      const { nodes, edges } = graphData.value;

      // Convert to ECharts graph format
      const echartsNodes = nodes.map((node, index) => ({
        name: `${node.alert_name}\n${node.service_name}`,
        id: index.toString(),
        symbolSize: getNodeSize(node),
        itemStyle: {
          color: getNodeColor(node, index),
          borderColor: index === 0 ? "#dc2626" : getNodeColor(node, index),
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
            const firstTime = new Date(node.first_fired_at / 1000).toLocaleString();
            const lastTime = node.alert_count > 1 ? new Date(node.last_fired_at / 1000).toLocaleString() : null;

            let html = `<div style="padding: 8px; font-size: 12px;">`;
            html += `<strong style="font-size: 14px;">${node.alert_name}</strong><br/>`;
            html += `Service: <strong>${node.service_name}</strong><br/><br/>`;
            html += `Alert Count: <strong>${node.alert_count}</strong><br/>`;
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
      }));

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

      const options = {
        tooltip: {
          trigger: "item",
          backgroundColor: isDarkMode.value ? "#1f2937" : "#ffffff",
          borderColor: isDarkMode.value ? "#374151" : "#e5e7eb",
          textStyle: {
            color: isDarkMode.value ? "#e5e7eb" : "#374151",
          },
        },
        animationDuration: 1500,
        animationEasingUpdate: "quinticInOut",
        series: [
          {
            type: "graph",
            layout: "force",
            force: {
              repulsion: 300,
              gravity: 0.1,
              edgeLength: 150,
              layoutAnimation: true,
            },
            center: ["50%", "60%"],
            roam: true,
            draggable: true,
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

      return { options, notMerge: true };
    });

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
}
</style>
