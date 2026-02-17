<template>
  <q-card flat class="tw:h-full">
    <q-card-section class="tw:p-[0.375rem] tw:h-full card-container service-graph-container">
      <!-- Top row with search and control buttons -->
      <div class="row items-center q-col-gutter-sm q-mb-md">
        <div class="col-12 col-md-5 tw:flex tw:gap-[0.5rem]">
          <!-- Stream selector - always show, populated once streams are discovered -->
          <q-select
            v-model="streamFilter"
            :options="
              availableStreams.length > 0
                ? [
                    { label: 'All Streams', value: 'all' },
                    ...availableStreams.map((s) => ({ label: s, value: s })),
                  ]
                : [{ label: 'All Streams', value: 'all' }]
            "
            dense
            borderless
            emit-value
            map-options
            class="tw:w-[180px] tw:flex-shrink-0"
            @update:model-value="onStreamFilterChange"
            :disable="availableStreams.length === 0"
          >
            <template #prepend>
              <q-icon name="storage" size="xs" />
            </template>
            <q-tooltip v-if="availableStreams.length === 0">
              No streams detected. Ensure service graph metrics include
              stream_name labels.
            </q-tooltip>
          </q-select>

          <!-- Search input -->
          <q-input
            v-model="searchFilter"
            borderless
            dense
            class="no-border tw:h-[36px]"
            placeholder="Search services..."
            debounce="300"
            @update:model-value="applyFilters"
            clearable
          >
            <template #prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>
        </div>
        <div
          class="col-12 col-md-7 tw:flex tw:justify-end tw:items-center tw:gap-[0.75rem]"
        >
          <!-- 1. Time range selector -->
          <date-time
            ref="dateTimeRef"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="service-graph-date-time-picker"
            class="tw:h-[2rem]"
            @on:date-change="updateTimeRange"
          />

          <!-- 2. Refresh button -->
          <q-btn
            data-test="service-graph-refresh-btn"
            no-caps
            flat
            class="o2-secondary-button"
            @click="loadServiceGraph"
            :loading="loading"
          >
          Refresh
          </q-btn>

          <!-- 3. Graph/Tree view toggle -->
          <div class="app-tabs-container tw:h-[36px]">
            <app-tabs
              data-test="service-graph-view-tabs"
              class="tabs-selection-container"
              :tabs="visualizationTabs"
              v-model:active-tab="visualizationType"
              @update:active-tab="setVisualizationType"
            />
          </div>

          <!-- 4. Layout dropdown -->
          <q-select
            v-model="layoutType"
            :options="layoutOptions"
            dense
            borderless
            class="tw:w-[160px]"
            emit-value
            map-options
            @update:model-value="setLayout"
          />
        </div>
      </div>

      <!-- Graph Visualization -->
      <q-card flat bordered class="graph-card tw:h-[calc(100%-4rem)]">
        <q-card-section class="q-pa-none tw:h-full" style="height: 100%">
          <div class="graph-container tw:h-full tw:bg-[var(--o2-bg)]">
            <div v-if="loading" class="flex flex-center tw:h-full">
              <div class="text-center tw:flex tw:flex-col tw:items-center">
                <q-spinner-hourglass color="primary" size="4em" />
                <div class="text-subtitle1 q-mt-md text-grey-7">
                  Loading service graph...
                </div>
              </div>
            </div>
            <div
              v-else-if="error"
              class="flex flex-center tw:h-full text-center tw:p-[0.675rem]"
            >
              <div>
                <q-icon name="error_outline" size="4em" color="negative" />
                <div class="text-h6 q-mt-md tw:text-[var(--o2-text-primary)]">
                  {{ error }}
                </div>
                <q-btn
                  outline
                  color="primary"
                  label="Retry"
                  @click="loadServiceGraph"
                  class="q-mt-md"
                />
              </div>
            </div>
            <div
              v-else-if="!graphData.nodes.length"
              class="flex flex-center tw:h-full text-center tw:p-[0.675rem]"
            >
              <div>
                <q-icon name="hub" size="5em" color="grey-4" />
                <div class="text-h6 q-mt-md text-grey-7">
                  No Service Graph Data
                </div>
                <div class="text-body2 text-grey-6 q-mt-sm">
                  Try querying a longer duration
                </div>
              </div>
            </div>
            <div v-else class="tw:h-full graph-with-panel-container">
              <ChartRenderer
                ref="chartRendererRef"
                data-test="service-graph-chart"
                :data="chartData"
                :key="chartKey"
                class="tw:h-full"
                @click="handleNodeClick"
              />

              <!-- Service Graph Side Panel -->
              <ServiceGraphSidePanel
                v-if="selectedNode"
                :selected-node="selectedNode"
                :graph-data="graphData"
                :time-range="searchObj.data.datetime"
                :visible="showSidePanel"
                :stream-filter="streamFilter"
                @close="handleCloseSidePanel"
                @view-logs="handleViewLogs"
                @view-traces="handleViewTraces"
              />

              <!-- Service Graph Edge Panel -->
              <ServiceGraphEdgePanel
                v-if="selectedEdge"
                :selected-edge="selectedEdge"
                :graph-data="graphData"
                :time-range="searchObj.data.datetime"
                :visible="showEdgePanel"
                @close="handleCloseEdgePanel"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-card-section>
  </q-card>

  <!-- Enhanced Settings Dialog -->
  <q-dialog v-model="showSettings">
    <q-card style="min-width: 450px">
      <q-card-section>
        <div class="text-h6">Service Graph Settings</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <div class="q-gutter-md">
          <div class="text-caption text-grey-7">
            Stream-based topology - all data persisted to storage
            <q-tooltip
              >Service graph uses stream-only architecture with zero in-memory
              state</q-tooltip
            >
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right">
        <q-btn
          flat
          dense
          no-caps
          label="Close"
          color="primary"
          v-close-popup
          class="o2-secondary-button tw:h-[2rem]"
        />
        <q-btn
          label="Reset"
          @click="resetSettings"
          class="o2-primary-button tw:h-[2rem]"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import serviceGraphService from "@/services/service_graph";
import AppTabs from "@/components/common/AppTabs.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import DateTime from "@/components/DateTime.vue";
import ServiceGraphSidePanel from "./ServiceGraphSidePanel.vue";
import ServiceGraphEdgePanel from "./ServiceGraphEdgePanel.vue";
import {
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
} from "@/utils/traces/convertTraceData";
import useStreams from "@/composables/useStreams";
import useTraces from "@/composables/useTraces";
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";

export default defineComponent({
  name: "ServiceGraph",
  components: {
    AppTabs,
    ChartRenderer,
    DateTime,
    ServiceGraphSidePanel,
    ServiceGraphEdgePanel,
  },
  emits: ['view-traces'],
  setup(props, { emit }) {
    const store = useStore();
    const $q = useQuasar();
    const router = useRouter();
    const { getStreams } = useStreams();
    const { searchObj } = useTraces();

    const loading = ref(false);
    const error = ref<string | null>(null);
    const showSettings = ref(false);
    const lastUpdated = ref("");

    // Side panel state
    const selectedNode = ref<any>(null);
    const showSidePanel = ref(false);

    // Edge panel state
    const selectedEdge = ref<any>(null);
    const showEdgePanel = ref(false);

    // Persist visualization type in localStorage
    const storedVisualizationType = localStorage.getItem(
      "serviceGraph_visualizationType",
    );
    const visualizationType = ref<"tree" | "graph">(
      (storedVisualizationType as "tree" | "graph") || "graph",
    );

    // Visualization tabs configuration
    const visualizationTabs = [
      { label: "Graph View", value: "graph" },
      { label: "Tree View", value: "tree" },
    ];

    // Initialize layout type based on visualization type
    const storedLayoutType = localStorage.getItem("serviceGraph_layoutType");
    let defaultLayoutType = "force";
    if (visualizationType.value === "tree") {
      defaultLayoutType = "horizontal";
    }
    const layoutType = ref(storedLayoutType || defaultLayoutType);
    const chartRendererRef = ref<any>(null);

    const searchFilter = ref("");

    // Stream filter
    const storedStreamFilter = localStorage.getItem(
      "serviceGraph_streamFilter",
    );
    const streamFilter = ref(storedStreamFilter || "all");
    const availableStreams = ref<string[]>([]);

    const graphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const filteredGraphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const stats = ref<any>(null);

    // Use shared datetime from searchObj instead of local timeRange
    // searchObj.data.datetime is managed by useTraces composable and shared across tabs

    const dateTimeRef = ref<any>(null);


    // Key to control chart recreation - only change when layout/visualization type changes
    const chartKey = ref(0);

    // Track last chart options to prevent unnecessary recreation for graph view
    const lastChartOptions = ref<any>(null);

    // Layout options based on visualization type
    const layoutOptions = computed(() => {
      if (visualizationType.value === "tree") {
        return [
          { label: "Horizontal", value: "horizontal" },
          { label: "Vertical", value: "vertical" },
          { label: "Radial", value: "radial" },
        ];
      } else {
        return [
          { label: "Force Directed", value: "force" },
          { label: "Circular", value: "circular" },
        ];
      }
    });

    const chartData = computed(() => {
      if (!filteredGraphData.value.nodes.length) {
        return { options: {}, notMerge: true };
      }

      // Don't use cache if filters are active (search filter)
      const hasActiveFilters = searchFilter.value?.trim();

      // Use cached options if chartKey hasn't changed (prevents double rendering)
      // BUT only if no filters are active
      if (visualizationType.value === "graph" &&
          lastChartOptions.value &&
          chartKey.value === lastChartOptions.value.key &&
          !hasActiveFilters) {
        return {
          options: lastChartOptions.value.data.options,
          notMerge: false,
          lazyUpdate: true,
          silent: true,
        };
      }

      const newOptions =
        visualizationType.value === "tree"
          ? convertServiceGraphToTree(
              filteredGraphData.value,
              layoutType.value,
              $q.dark.isActive // Pass dark mode state
            )
          : convertServiceGraphToNetwork(
              filteredGraphData.value,
              layoutType.value,
              new Map(), // Empty position cache to allow free movement
              $q.dark.isActive, // Pass dark mode state
              undefined, // Don't pass selected node - we'll use dispatchAction instead
            );

      // Cache the options for graph view
      // BUT only if no filters are active (to avoid caching filtered states)
      if (visualizationType.value === "graph" && !hasActiveFilters) {
        lastChartOptions.value = {
          key: chartKey.value,
          data: newOptions,
        };
      } else if (hasActiveFilters) {
        // Clear cache when filtering to ensure fresh render on filter removal
        lastChartOptions.value = null;
      }

      return {
        ...newOptions,
        notMerge: visualizationType.value === "graph" ? false : true, // Merge for graph, replace for tree
        lazyUpdate: true, // Prevent viewport reset when only styles change
        silent: true, // Disable animations during update to prevent position jumps
      };
    });

    // Use ECharts select action to persistently highlight selected node
    watch(
      () => selectedNode.value?.id,
      async (newId, oldId) => {
        await nextTick();

        if (!chartRendererRef.value?.chart) {
          return;
        }

        const chart = chartRendererRef.value.chart;

        // Unselect the old node (if any)
        if (oldId) {
          chart.dispatchAction({
            type: 'unselect',
            seriesIndex: 0,
            name: oldId,
          });
        }

        // Select the new node (if any)
        if (newId) {
          chart.dispatchAction({
            type: 'select',
            seriesIndex: 0,
            name: newId,
          });
        }
      },
      { flush: 'post' }
    );

    // Watch for theme changes and re-apply selection
    watch(
      () => store.state.theme,
      async () => {
        // Increment chartKey to force regeneration with new theme colors
        chartKey.value++;

        // Save the current selected node ID (in case it changes during the delay)
        const nodeIdToReselect = selectedNode.value?.id;

        // Use setTimeout to wait for chart to be fully regenerated after theme change
        setTimeout(() => {
          if (!chartRendererRef.value?.chart || !nodeIdToReselect) {
            return;
          }

          const chart = chartRendererRef.value.chart;

          // Re-apply node selection
          chart.dispatchAction({
            type: 'select',
            seriesIndex: 0,
            name: nodeIdToReselect,
          });
        }, 500); // 500ms delay to ensure chart has fully regenerated
      }
    );

    // Watch for stream filter changes and restore chart viewport
    watch(
      () => streamFilter.value,
      async () => {
        // Wait for chart to update with new data
        await nextTick();
        setTimeout(() => {
          if (!chartRendererRef.value?.chart) {
            return;
          }

          const chart = chartRendererRef.value.chart;

          // Restore chart to default zoom/pan to fit all content
          chart.dispatchAction({
            type: 'restore',
          });
        }, 500); // Longer delay to ensure chart has recalculated positions
      }
    );

    const loadServiceGraph = async () => {
      loading.value = true;
      error.value = null;

      // Clear cache to force chart regeneration with fresh data
      lastChartOptions.value = null;
      chartKey.value++;

      try {
        const orgId = store.state.selectedOrganization.identifier;

        if (!orgId) {
          throw new Error("No organization selected");
        }

        // If a specific stream is selected but we don't have available streams yet,
        // first fetch all streams to populate the dropdown
        if (
          availableStreams.value.length === 0 &&
          streamFilter.value !== "all"
        ) {
          const allStreamsResponse =
            await serviceGraphService.getCurrentTopology(orgId, {
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            });
          if (
            allStreamsResponse.data.availableStreams &&
            allStreamsResponse.data.availableStreams.length > 0
          ) {
            availableStreams.value = allStreamsResponse.data.availableStreams;
          }
        }

        // Stream-only implementation - no store stats needed
        // Use JSON topology endpoint with time range
        const response = await serviceGraphService.getCurrentTopology(orgId, {
          streamName:
            streamFilter.value && streamFilter.value !== "all"
              ? streamFilter.value
              : undefined,
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
        });

        // Convert API response to expected format
        const rawData = response.data;

        // Ensure nodes have all required fields
        const nodes = (rawData.nodes || []).map((node: any) => ({
          id: node.id,
          label: node.label || node.id,
          requests: node.requests || 0,
          errors: node.errors || 0,
          error_rate: node.error_rate || 0,
          is_virtual: node.is_virtual || false,
        }));

        // Ensure edges have all required fields and valid node references
        const nodeIds = new Set(nodes.map((n: any) => n.id));
        const edges = (rawData.edges || [])
          .filter((edge: any) => {
            // Filter out edges with missing endpoints
            const hasValidEndpoints =
              edge.from &&
              edge.to &&
              nodeIds.has(edge.from) &&
              nodeIds.has(edge.to);
            if (!hasValidEndpoints) {
              console.warn(
                "[ServiceGraph] Skipping edge with invalid endpoints:",
                edge,
              );
            }
            return hasValidEndpoints;
          })
          .map((edge: any) => ({
            id: `${edge.from}->${edge.to}`,
            from: edge.from,
            to: edge.to,
            total_requests: edge.total_requests || 0,
            failed_requests: edge.failed_requests || 0,
            error_rate: edge.error_rate || 0,
            p50_latency_ns: edge.p50_latency_ns || 0,
            p95_latency_ns: edge.p95_latency_ns || 0,
            p99_latency_ns: edge.p99_latency_ns || 0,
          }));

        graphData.value = {
          nodes,
          edges,
        };

        // Calculate stats
        const totalRequests = graphData.value.edges.reduce(
          (sum: number, e: any) => sum + e.total_requests,
          0,
        );
        const totalErrors = graphData.value.edges.reduce(
          (sum: number, e: any) => sum + e.failed_requests,
          0,
        );

        stats.value = {
          services: graphData.value.nodes.length,
          connections: graphData.value.edges.length,
          totalRequests,
          totalErrors,
          errorRate:
            totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        };

        lastUpdated.value = new Date().toLocaleTimeString();

        // Apply filters and render
        applyFilters();
      } catch (err: any) {
        console.error("Failed to load service graph:", err);

        // Provide detailed error messages based on error type
        if (err.message === "Request timeout") {
          error.value =
            "Request timed out. The service graph may be processing large amounts of data. Please try again.";
        } else if (err.response?.status === 404) {
          error.value =
            "Service Graph API endpoint not found. Ensure you're running enterprise version of OpenObserve.";
        } else if (err.response?.status === 403) {
          error.value =
            "Access denied. You may not have permission to view the service graph for this organization.";
        } else if (err.response?.status === 500) {
          error.value = "Server error occurred. Check server logs for details.";
        } else if (err.message === "Network Error" || !navigator.onLine) {
          error.value = "Network error. Please check your internet connection.";
        } else {
          error.value =
            err.response?.data?.message ||
            err.message ||
            "Failed to load service graph data. Please check server logs.";
        }
      } finally {
        loading.value = false;
      }
    };

    const parsePrometheusMetrics = (metricsText: string) => {
      const nodes = new Map<string, any>();
      const edges: any[] = [];

      const lines = metricsText.split("\n");

      for (const line of lines) {
        if (line.startsWith("#") || !line.trim()) continue;

        // Parse metric line: metric_name{labels} value
        const match = line.match(/^(\w+)\{([^}]+)\}\s+([\d.eE+-]+)/);
        if (!match) continue;

        const [, metricName, labelsStr, value] = match;
        const labels: any = {};

        // Parse labels
        const labelMatches = Array.from(labelsStr.matchAll(/(\w+)="([^"]+)"/g));
        for (const [, key, val] of labelMatches) {
          labels[key] = val;
        }

        if (!labels.client || !labels.server) continue;

        // Add nodes
        if (!nodes.has(labels.client)) {
          nodes.set(labels.client, {
            id: labels.client,
            label: labels.client,
            is_virtual: labels.client === "unknown",
          });
        }
        if (!nodes.has(labels.server)) {
          nodes.set(labels.server, {
            id: labels.server,
            label: labels.server,
            is_virtual: labels.server.includes("unknown"),
          });
        }

        // Add edge data
        if (metricName === "traces_service_graph_request_total") {
          const edgeId = `${labels.client}->${labels.server}`;
          let edge = edges.find((e) => e.id === edgeId);

          if (!edge) {
            edge = {
              id: edgeId,
              from: labels.client,
              to: labels.server,
              total_requests: 0,
              failed_requests: 0,
            };
            edges.push(edge);
          }

          edge.total_requests = parseFloat(value);
        }

        if (metricName === "traces_service_graph_request_failed_total") {
          const edgeId = `${labels.client}->${labels.server}`;
          let edge = edges.find((e) => e.id === edgeId);

          // Create edge if it doesn't exist yet (failed_total may come before request_total)
          if (!edge) {
            edge = {
              id: edgeId,
              from: labels.client,
              to: labels.server,
              total_requests: 0,
              failed_requests: 0,
            };
            edges.push(edge);
          }

          edge.failed_requests = parseFloat(value);
        }
      }

      return {
        nodes: Array.from(nodes.values()),
        edges,
      };
    };

    const onStreamFilterChange = (stream: string) => {
      streamFilter.value = stream;
      localStorage.setItem("serviceGraph_streamFilter", stream);

      // Reload service graph with new stream filter
      loadServiceGraph();
    };

    const applyFilters = () => {
      let nodes = [...graphData.value.nodes];
      let edges = [...graphData.value.edges];

      // Filter by search
      const trimmedSearch = searchFilter.value?.trim();
      if (trimmedSearch) {
        const search = trimmedSearch.toLowerCase();
        const matchingNodeIds = new Set(
          nodes
            .filter((n) => n.label.toLowerCase().includes(search))
            .map((n) => n.id),
        );

        edges = edges.filter(
          (e) => matchingNodeIds.has(e.from) || matchingNodeIds.has(e.to),
        );

        const usedNodeIds = new Set([
          ...edges.map((e) => e.from),
          ...edges.map((e) => e.to),
        ]);
        nodes = nodes.filter((n) => usedNodeIds.has(n.id));
      }

      filteredGraphData.value = { nodes, edges };
    };

    const setLayout = (type: string) => {
      layoutType.value = type;
      // Persist layout type to localStorage
      localStorage.setItem("serviceGraph_layoutType", type);
      // Force chart recreation when layout changes
      chartKey.value++;
    };

    const setVisualizationType = (type: "tree" | "graph") => {
      visualizationType.value = type;
      // Persist visualization type to localStorage
      localStorage.setItem("serviceGraph_visualizationType", type);
      // Set default layout for each visualization type
      if (type === "tree") {
        layoutType.value = "horizontal";
      } else {
        layoutType.value = "force";
      }
      // Force chart recreation when visualization type changes
      chartKey.value++;
    };

    const formatNumber = (num: number) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
      if (num >= 1000) return (num / 1000).toFixed(1) + "K";
      return num.toString();
    };

    const updateTimeRange = (value: any) => {
      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod:
          value.relativeTimePeriod || searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
      };
      // Reload service graph with new time range
      loadServiceGraph();
    };

    // Load trace streams using the same method as the Traces search page
    const loadTraceStreams = async () => {
      try {
        const res = await getStreams("traces", false, false);
        if (res?.list?.length > 0) {
          availableStreams.value = res.list.map((stream: any) => stream.name);
        }
      } catch (e) {
        console.error("Error loading trace streams:", e);
      }
    };

    // Settings handler
    const resetSettings = () => {
      // Reset to default settings if needed
      showSettings.value = false;
    };

    // Side Panel Handlers
    const handleNodeClick = (params: any) => {
      // Check if it's an edge click (for graph visualization)
      if (params.dataType === 'edge' && params.data) {
        // Close node panel when opening edge panel
        showSidePanel.value = false;
        selectedNode.value = null;

        // Find the full edge data from graphData
        const edgeData = graphData.value.edges.find(
          (e: any) => e.from === params.data.source && e.to === params.data.target
        );
        if (edgeData) {
          selectedEdge.value = edgeData;
          showEdgePanel.value = true;
        } else {
          console.warn('[ServiceGraph] Could not find edge data for:', params.data.source, '->', params.data.target);
        }
      }
      // Check if it's a node click (for graph visualization)
      else if (params.dataType === 'node' && params.data) {
        // Check if clicking the same node - if so, close the panel
        if (selectedNode.value && selectedNode.value.id === params.data.id) {
          showSidePanel.value = false;
          selectedNode.value = null;
        } else {
          // Close edge panel when opening node panel
          showEdgePanel.value = false;
          selectedEdge.value = null;

          selectedNode.value = params.data;
          showSidePanel.value = true;
        }
      }
      // For tree visualization, check if it's a tree node
      else if (params.componentType === 'series' && params.data && params.data.name) {
        // Find the actual node data from graphData
        const nodeData = graphData.value.nodes.find(
          (n: any) => n.label === params.data.name || n.id === params.data.name
        );

        if (nodeData) {
          // Check if clicking the same node - if so, close the panel
          if (selectedNode.value && selectedNode.value.id === nodeData.id) {
            showSidePanel.value = false;
            selectedNode.value = null;
          } else {
            // Close edge panel when opening node panel
            showEdgePanel.value = false;
            selectedEdge.value = null;

            selectedNode.value = nodeData;
            showSidePanel.value = true;
          }
        } else {
          console.warn('[ServiceGraph] Could not find node data for:', params.data.name);
        }
      } else {
        console.log('[ServiceGraph] Click not on a node or edge, ignoring');
      }
    };

    const handleCloseSidePanel = () => {
      showSidePanel.value = false;
      // Don't clear selectedNode immediately to allow smooth close animation
      setTimeout(() => {
        selectedNode.value = null;
      }, 300);
    };

    const handleViewLogs = () => {
      if (!selectedNode.value) return;

      const serviceName = selectedNode.value.name || selectedNode.value.label || selectedNode.value.id;
      const escapedServiceName = escapeSingleQuotes(serviceName);
      const escapedStream = escapeSingleQuotes(streamFilter.value);
      const sql = `SELECT * FROM "${escapedStream}" WHERE service_name = '${escapedServiceName}' ORDER BY _timestamp DESC`;
      const query = b64EncodeUnicode(sql);

      const queryObject = {
        stream_type: "logs",
        stream: streamFilter.value,
        from: searchObj.data.datetime.startTime,
        to: searchObj.data.datetime.endTime,
        refresh: 0,
        sql_mode: "true",
        query,
        defined_schemas: "user_defined_schema",
        org_identifier: store.state.selectedOrganization.identifier,
        quick_mode: "false",
        show_histogram: "true",
        type: "service_graph_view_logs",
      };

      router.push({
        path: "/logs",
        query: queryObject,
      });
    };

    const handleViewTraces = () => {
      if (!selectedNode.value) return;

      const serviceName = selectedNode.value.name || selectedNode.value.label || selectedNode.value.id;

      // Emit event to parent to switch tab and apply query
      // Parent will handle tab switching and query application
      emit('view-traces', {
        stream: streamFilter.value,
        serviceName: serviceName,
        timeRange: {
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
        },
      });
    };

    // Edge Panel Handlers
    const handleCloseEdgePanel = () => {
      showEdgePanel.value = false;
      // Don't clear selectedEdge immediately to allow smooth close animation
      setTimeout(() => {
        selectedEdge.value = null;
      }, 300);
    };

    onMounted(async () => {
      await loadTraceStreams();
      loadServiceGraph();
    });

    return {
      loading,
      error,
      graphData,
      filteredGraphData,
      stats,
      showSettings,
      lastUpdated,
      searchFilter,
      streamFilter,
      availableStreams,
      visualizationType,
      visualizationTabs,
      layoutType,
      layoutOptions,
      chartData,
      chartKey,
      chartRendererRef,
      searchObj,
      dateTimeRef,
      loadServiceGraph,
      formatNumber,
      applyFilters,
      onStreamFilterChange,
      setLayout,
      setVisualizationType,
      updateTimeRange,
      resetSettings,
      // Side panel
      selectedNode,
      showSidePanel,
      handleNodeClick,
      handleCloseSidePanel,
      handleViewLogs,
      handleViewTraces,
      // Edge panel
      selectedEdge,
      showEdgePanel,
      handleCloseEdgePanel,
    };
  },
});
</script>

<style scoped lang="scss">
.stat-card {
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.graph-card {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.graph-container {
  position: relative;
  width: 100%;
  border-radius: 4px;
  overflow: hidden;
}

.service-graph-container {
  position: relative;
  overflow: hidden;
  background: #0f1419 !important;
}

.body--light .service-graph-container {
  background: #ffffff !important; // White background for light mode
}

.graph-with-panel-container {
  position: relative;
  overflow: visible;
}

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "Courier New", monospace;
  font-size: 0.9em;
}
</style>
