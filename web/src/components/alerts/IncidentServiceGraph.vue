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
        style="width: 100%; height: calc(100vh - 150px)"
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
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import incidentsService, { IncidentServiceGraph, IncidentServiceNode } from "@/services/incidents";

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

    const getNodeColor = (node: IncidentServiceNode): string => {
      if (node.is_root_cause) {
        return "#ef4444"; // red-500
      }
      if (node.alert_count > 5) {
        return "#f97316"; // orange-500
      }
      return "#3b82f6"; // blue-500
    };

    const getNodeSize = (node: IncidentServiceNode): number => {
      const size = 30 + node.alert_count * 5;
      return Math.min(size, 100); // Cap at 100 to prevent oversized nodes
    };

    const chartData = computed(() => {
      if (!graphData.value || graphData.value.nodes.length === 0) {
        return { options: {}, notMerge: true };
      }

      const { nodes, edges } = graphData.value;

      // Convert to ECharts graph format
      const echartsNodes = nodes.map((node) => ({
        name: node.service_name,
        symbolSize: getNodeSize(node),
        itemStyle: {
          color: getNodeColor(node),
          borderColor: node.is_primary ? "#a855f7" : getNodeColor(node),
          borderWidth: node.is_primary ? 4 : 2,
        },
        label: {
          show: true,
          position: "bottom",
          distance: 5,
          fontSize: 11,
          color: isDarkMode.value ? "#e5e7eb" : "#374151",
        },
        tooltip: {
          formatter: () => {
            let html = `<div style="padding: 8px; font-size: 12px;">`;
            html += `<strong style="font-size: 14px;">${node.service_name}</strong><br/><br/>`;
            html += `Alerts: <strong>${node.alert_count}</strong><br/>`;
            if (node.is_root_cause) {
              html += `<span style="color: #ef4444;">Suspected Root Cause</span><br/>`;
            }
            if (node.is_primary) {
              html += `<span style="color: #a855f7;">Primary Service</span><br/>`;
            }
            html += `</div>`;
            return html;
          },
        },
      }));

      const echartsEdges = edges.map((edge) => ({
        source: edge.from,
        target: edge.to,
        lineStyle: {
          color: isDarkMode.value ? "#6b7280" : "#9ca3af",
          width: 2,
          curveness: 0.2,
        },
        symbol: ["none", "arrow"],
        symbolSize: [0, 10],
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
