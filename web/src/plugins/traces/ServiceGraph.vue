<template>
    <q-card flat class="tw:h-full">
      <q-card-section class="tw:p-[0.375rem] tw:h-full card-container">
        <!-- Top row with search and control buttons -->
        <div class="row items-center q-col-gutter-sm q-mb-md">
          <div class="col-12 col-md-5 tw:flex tw:gap-[0.5rem]">
            <!-- Stream selector - always show, populated once streams are discovered -->
            <q-select
              v-model="streamFilter"
              :options="availableStreams.length > 0
                ? [{ label: 'All Streams', value: 'all' }, ...availableStreams.map(s => ({ label: s, value: s }))]
                : [{ label: 'All Streams', value: 'all' }]"
              dense
              outlined
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
                No streams detected. Ensure service graph metrics include stream_name labels.
              </q-tooltip>
            </q-select>

            <!-- Search input -->
            <q-input
              v-model="searchFilter"
              borderless
              dense
              class="no-border tw:h-[36px] tw:flex-grow"
              placeholder="Search services..."
              debounce="300"
              @update:model-value="applyFilters"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
          </div>
          <div class="col-12 col-md-7 tw:flex tw:justify-end tw:items-center tw:gap-[0.75rem]">
            <!-- 1. Refresh button -->
            <q-btn
              data-test="service-graph-refresh-btn"
              no-caps
              flat
              dense
              icon="refresh"
              class="tw:border tw:border-solid tw:border-[var(--o2-border-color)] q-px-sm element-box-shadow hover:tw:bg-[var(--o2-hover-accent)]"
              @click="loadServiceGraph"
              :loading="loading"
            >
              <q-tooltip>Refresh Service Graph</q-tooltip>
            </q-btn>

            <!-- 2. Graph/Tree view toggle buttons -->
            <q-btn-toggle
              v-model="visualizationType"
              toggle-color="primary"
              :options="[
                { label: 'Graph View', value: 'graph', icon: 'hub' },
                { label: 'Tree View', value: 'tree', icon: 'account_tree' }
              ]"
              dense
              no-caps
              @update:model-value="setVisualizationType"
            />

            <!-- 3. Layout dropdown -->
            <q-select
              v-model="layoutType"
              :options="layoutOptions"
              dense
              filled
              class="tw:w-[160px]"
              emit-value
              map-options
              @update:model-value="setLayout"
            />
          </div>
        </div>

        <!-- Graph Visualization -->
        <q-card flat bordered class="graph-card tw:h-[calc(100%-4rem)]">
          <q-card-section class="q-pa-none tw:h-full" style="height: 100%;">
            <div
              class="graph-container tw:h-full tw:bg-[var(--o2-bg)]"
            >
              <div v-if="loading" class="flex flex-center tw:h-full">
                <div class="text-center tw:flex tw:flex-col tw:items-center">
                  <q-spinner-hourglass color="primary" size="4em" />
                  <div class="text-subtitle1 q-mt-md text-grey-7">Loading service graph...</div>
                </div>
              </div>
              <div
                v-else-if="error"
                class="flex flex-center tw:h-full text-center tw:p-[0.675rem]"
              >
                <div>
                  <q-icon name="error_outline" size="4em" color="negative" />
                  <div class="text-h6 q-mt-md tw:text-[var(--o2-text-primary)]">{{ error }}</div>
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
                  <div class="text-h6 q-mt-md text-grey-7">No Service Graph Data</div>
                  <div class="text-h6 text-grey-7 q-mt-lg q-mb-md" style="font-size: 1.1rem">Possible causes:</div>
                  <div class="text-body1 text-grey-6" style="max-width: 800px; font-size: 0.95rem">
                    <div class="q-pa-md q-mb-md" style="background: rgba(var(--q-primary-rgb), 0.05); border-radius: 6px">
                      <div class="text-weight-medium q-mb-sm" style="font-size: 1rem">Service graph is disabled</div>
                      <div>Enable the feature by setting environment variable:</div>
                      <code class="q-mt-xs" style="background: rgba(var(--q-primary-rgb), 0.1); padding: 4px 10px; border-radius: 4px; font-size: 0.9rem; color: var(--q-primary); font-weight: 600">O2_SERVICE_GRAPH_ENABLED=true</code>
                    </div>

                    <div class="q-pa-md q-mb-md" style="background: rgba(var(--q-primary-rgb), 0.05); border-radius: 6px">
                      <div class="text-weight-medium q-mb-sm" style="font-size: 1rem">Query time range is too small</div>
                      <div>The daemon queries traces within a time window. If your traces are older, increase the window:</div>
                      <code class="q-mt-xs" style="background: rgba(var(--q-primary-rgb), 0.1); padding: 4px 10px; border-radius: 4px; font-size: 0.9rem; color: var(--q-primary); font-weight: 600">O2_SERVICE_GRAPH_QUERY_TIME_RANGE_MINUTES=120</code>
                      <div class="text-caption q-mt-sm" style="color: #666; font-size: 0.85rem">(Default: 60 minutes)</div>
                    </div>

                    <div class="q-pa-md q-mb-md" style="background: rgba(var(--q-primary-rgb), 0.05); border-radius: 6px">
                      <div class="text-weight-medium q-mb-sm" style="font-size: 1rem">Only INTERNAL spans detected</div>
                      <div>Your traces have <code style="background: rgba(var(--q-primary-rgb), 0.1); padding: 3px 7px; border-radius: 3px; font-size: 0.9rem; color: var(--q-primary); font-weight: 600">span_kind=1</code> (INTERNAL operations within a service).</div>
                      <div class="q-mt-sm">To create service-to-service edges, send traces with:</div>
                      <ul class="q-pl-md q-mt-sm q-mb-sm" style="line-height: 1.6">
                        <li><strong>CLIENT spans</strong> (<code style="background: rgba(var(--q-primary-rgb), 0.1); color: var(--q-primary); font-weight: 600">span_kind=3</code>) with <code style="background: rgba(var(--q-primary-rgb), 0.1); color: var(--q-primary); font-weight: 600">peer.service</code> attribute, or</li>
                        <li><strong>SERVER spans</strong> (<code style="background: rgba(var(--q-primary-rgb), 0.1); color: var(--q-primary); font-weight: 600">span_kind=2</code>) receiving requests from other services</li>
                      </ul>
                      <div class="text-caption q-mt-sm" style="color: #666; font-size: 0.85rem">
                        Note: INTERNAL spans can be excluded by setting <code style="background: rgba(var(--q-primary-rgb), 0.1); color: var(--q-primary); font-weight: 600">O2_SERVICE_GRAPH_EXCLUDE_INTERNAL_SPANS=true</code>
                      </div>
                    </div>
                  </div>
                  <q-btn
                    outline
                    color="primary"
                    label="Refresh"
                    icon="refresh"
                    @click="loadServiceGraph"
                    class="q-mt-lg"
                  />
                </div>
              </div>
              <div v-else class="tw:h-full">
                <ChartRenderer
                  ref="chartRendererRef"
                  data-test="service-graph-chart"
                  :data="chartData"
                  :key="chartKey"
                  class="tw:h-full"
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
              <q-tooltip>Service graph uses stream-only architecture with zero in-memory state</q-tooltip>
            </div>
          </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn flat dense no-caps label="Close" color="primary" v-close-popup class="o2-secondary-button tw:h-[2rem]" />
          <q-btn label="Reset" @click="resetSettings" class="o2-primary-button tw:h-[2rem]" />
        </q-card-actions>
      </q-card>
    </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed } from "vue";
import { useStore } from "vuex";
import serviceGraphService from "@/services/service_graph";
import AppTabs from "@/components/common/AppTabs.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { convertServiceGraphToTree, convertServiceGraphToNetwork } from "@/utils/traces/convertTraceData";

export default defineComponent({
  name: "ServiceGraph",
  components: {
    AppTabs,
    ChartRenderer,
  },
  setup() {
    const store = useStore();

    const loading = ref(false);
    const error = ref<string | null>(null);
    const showSettings = ref(false);
    const lastUpdated = ref("");

    // Persist visualization type in localStorage
    const storedVisualizationType = localStorage.getItem('serviceGraph_visualizationType');
    const visualizationType = ref<"tree" | "graph">(
      (storedVisualizationType as "tree" | "graph") || "graph"
    );

    // Initialize layout type based on visualization type
    const storedLayoutType = localStorage.getItem('serviceGraph_layoutType');
    let defaultLayoutType = "force";
    if (visualizationType.value === "tree") {
      defaultLayoutType = "horizontal";
    }
    const layoutType = ref(storedLayoutType || defaultLayoutType);
    const chartRendererRef = ref<any>(null);

    const searchFilter = ref("");
    const connectionTypeFilter = ref("all");

    // Stream filter
    const storedStreamFilter = localStorage.getItem('serviceGraph_streamFilter');
    const streamFilter = ref(storedStreamFilter || "all");
    const availableStreams = ref<string[]>([]);

    // Connection type tabs configuration
    const connectionTypeTabs = [
      { label: 'All', value: 'all' },
      { label: 'Standard', value: 'standard' },
      { label: 'Database', value: 'database' },
      { label: 'Messaging', value: 'messaging' },
      { label: 'Virtual', value: 'virtual' },
    ];

    const graphData = ref<any>({
      nodes: [],
      edges: [],
      availableStreams: [],
    });

    const filteredGraphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const stats = ref<any>(null);

    // Store node positions for graph view to prevent re-layout on updates
    const graphNodePositions = ref<Map<string, { x: number; y: number }>>(new Map());

    // Key to control chart recreation - only change when layout/visualization type changes
    const chartKey = ref(0);

    // Track last chart options to prevent unnecessary recreation for graph view
    const lastChartOptions = ref<any>(null);

    // Layout options based on visualization type
    const layoutOptions = computed(() => {
      if (visualizationType.value === "tree") {
        return [
          { label: 'Horizontal', value: 'horizontal' },
          { label: 'Vertical', value: 'vertical' },
          { label: 'Radial', value: 'radial' }
        ];
      } else {
        return [
          { label: 'Force Directed', value: 'force' },
          { label: 'Circular', value: 'circular' }
        ];
      }
    });

    const chartData = computed(() => {
      if (!filteredGraphData.value.nodes.length) {
        return { options: {}, notMerge: true };
      }

      // Disabled caching to ensure fresh edges with __original property
      // Position stability maintained through graphNodePositions passed to conversion
      // if (visualizationType.value === "graph" && lastChartOptions.value && chartKey.value === lastChartOptions.value.key) {
      //   console.log('[ServiceGraph] Reusing cached chart options, chartKey:', chartKey.value);
      //   return {
      //     options: lastChartOptions.value.data.options,
      //     notMerge: false,
      //     lazyUpdate: true
      //   };
      // }

      console.log('[ServiceGraph] Generating new chart options, chartKey:', chartKey.value, 'visualizationType:', visualizationType.value);
      const newOptions = visualizationType.value === "tree"
        ? convertServiceGraphToTree(filteredGraphData.value, layoutType.value)
        : convertServiceGraphToNetwork(
            filteredGraphData.value,
            layoutType.value,
            graphNodePositions.value
          );

      // Cache the options with the current key for graph view
      if (visualizationType.value === "graph") {
        lastChartOptions.value = {
          key: chartKey.value,
          data: newOptions
        };
      }

      return {
        ...newOptions,
        notMerge: visualizationType.value === "graph" ? false : true // Merge for graph, replace for tree
      };
    });

    const loadServiceGraph = async () => {
      loading.value = true;
      error.value = null;

      try {
        const orgId = store.state.selectedOrganization.identifier;

        if (!orgId) {
          throw new Error("No organization selected");
        }

        // If a specific stream is selected but we don't have available streams yet,
        // first fetch all streams to populate the dropdown
        if (availableStreams.value.length === 0 && streamFilter.value !== "all") {
          console.log('[ServiceGraph] Fetching all streams first to populate dropdown');
          const allStreamsResponse = await serviceGraphService.getCurrentTopology(orgId, undefined);
          if (allStreamsResponse.data.availableStreams && allStreamsResponse.data.availableStreams.length > 0) {
            availableStreams.value = allStreamsResponse.data.availableStreams;
          }
        }

        // Stream-only implementation - no store stats needed
        // Use JSON topology endpoint
        const response = await serviceGraphService.getCurrentTopology(
          orgId,
          streamFilter.value && streamFilter.value !== "all" ? streamFilter.value : undefined
        );

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
            const hasValidEndpoints = edge.from && edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to);
            if (!hasValidEndpoints) {
              console.warn('[ServiceGraph] Skipping edge with invalid endpoints:', edge);
            }
            return hasValidEndpoints;
          })
          .map((edge: any) => ({
            id: `${edge.from}->${edge.to}`,
            from: edge.from,
            to: edge.to,
            connection_type: edge.connection_type || "standard",
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
          availableStreams: rawData.availableStreams || [],
        };

        // Update availableStreams ref for the stream selector dropdown
        // IMPORTANT: Only update availableStreams when fetching "all" streams to maintain complete list
        if (streamFilter.value === "all") {
          // Use availableStreams from API, or fallback to extracting from edges
          if (rawData.availableStreams && rawData.availableStreams.length > 0) {
            availableStreams.value = rawData.availableStreams;
          } else {
            // Fallback: extract stream names from edge stream_name property if API didn't provide them
            const streamSet = new Set<string>();
            edges.forEach((edge: any) => {
              // If edges have stream_name property, collect them
              if (edge.stream_name) {
                streamSet.add(edge.stream_name);
              }
            });
            availableStreams.value = Array.from(streamSet).sort();
          }
        }

        console.log('[ServiceGraph] Loaded topology:', graphData.value);
        console.log('[ServiceGraph] Available streams:', availableStreams.value);
        console.log('[ServiceGraph] Active stream filter:', streamFilter.value);

        // Calculate stats
        const totalRequests = graphData.value.edges.reduce((sum: number, e: any) => sum + e.total_requests, 0);
        const totalErrors = graphData.value.edges.reduce((sum: number, e: any) => sum + e.failed_requests, 0);

        stats.value = {
          services: graphData.value.nodes.length,
          connections: graphData.value.edges.length,
          totalRequests,
          totalErrors,
          errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        };

        lastUpdated.value = new Date().toLocaleTimeString();

        // Apply filters and render
        applyFilters();
      } catch (err: any) {
        console.error("Failed to load service graph:", err);

        // Provide detailed error messages based on error type
        if (err.message === "Request timeout") {
          error.value = "Request timed out. The service graph may be processing large amounts of data. Please try again.";
        } else if (err.response?.status === 404) {
          error.value = "Service Graph API endpoint not found. Ensure you're running enterprise version of OpenObserve.";
        } else if (err.response?.status === 403) {
          error.value = "Access denied. You may not have permission to view the service graph for this organization.";
        } else if (err.response?.status === 500) {
          error.value = "Server error occurred. Check server logs for details.";
        } else if (err.message === "Network Error" || !navigator.onLine) {
          error.value = "Network error. Please check your internet connection.";
        } else {
          error.value = err.response?.data?.message || err.message || "Failed to load service graph data. Please check server logs.";
        }
      } finally {
        loading.value = false;
      }
    };

    const parsePrometheusMetrics = (metricsText: string) => {
      const nodes = new Map<string, any>();
      const edges: any[] = [];
      const availableStreams = new Set<string>();

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

        // Track available stream names for the stream selector
        if (labels.stream_name) {
          availableStreams.add(labels.stream_name);
        }

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
              connection_type: labels.connection_type || "standard",
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
              connection_type: labels.connection_type || "standard",
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
        availableStreams: Array.from(availableStreams).sort(),
      };
    };

    const onStreamFilterChange = (stream: string) => {
      streamFilter.value = stream;
      localStorage.setItem('serviceGraph_streamFilter', stream);

      // Reload service graph with new stream filter
      loadServiceGraph();
    };

    const applyFilters = () => {
      let nodes = [...graphData.value.nodes];
      let edges = [...graphData.value.edges];

      // Filter by search
      if (searchFilter.value) {
        const search = searchFilter.value.toLowerCase();
        const matchingNodeIds = new Set(
          nodes.filter(n => n.label.toLowerCase().includes(search)).map(n => n.id)
        );

        edges = edges.filter(e =>
          matchingNodeIds.has(e.from) || matchingNodeIds.has(e.to)
        );

        const usedNodeIds = new Set([...edges.map(e => e.from), ...edges.map(e => e.to)]);
        nodes = nodes.filter(n => usedNodeIds.has(n.id));
      }

      // Filter by connection type
      if (connectionTypeFilter.value !== "all") {
        edges = edges.filter(e => e.connection_type === connectionTypeFilter.value);

        const usedNodeIds = new Set([...edges.map(e => e.from), ...edges.map(e => e.to)]);
        nodes = nodes.filter(n => usedNodeIds.has(n.id));
      }

      filteredGraphData.value = { nodes, edges };
    };

    const setLayout = (type: string) => {
      layoutType.value = type;
      // Persist layout type to localStorage
      localStorage.setItem('serviceGraph_layoutType', type);
      // Force chart recreation when layout changes
      chartKey.value++;
    };

    const setVisualizationType = (type: "tree" | "graph") => {
      visualizationType.value = type;
      // Persist visualization type to localStorage
      localStorage.setItem('serviceGraph_visualizationType', type);
      // Set default layout for each visualization type
      if (type === "tree") {
        layoutType.value = "horizontal";
      } else {
        layoutType.value = "force";
        // Clear cached positions when switching to graph view to allow fresh layout
        graphNodePositions.value = new Map();
      }
      // Force chart recreation when visualization type changes
      chartKey.value++;
    };

    const formatNumber = (num: number) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
      if (num >= 1000) return (num / 1000).toFixed(1) + "K";
      return num.toString();
    };

    onMounted(() => {
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
      connectionTypeFilter,
      connectionTypeTabs,
      visualizationType,
      layoutType,
      layoutOptions,
      chartData,
      chartKey,
      chartRendererRef,
      loadServiceGraph,
      formatNumber,
      applyFilters,
      onStreamFilterChange,
      setLayout,
      setVisualizationType,
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

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}
</style>
