<template>
    <q-card flat class="tw-h-full">
      <q-card-section class="tw-p-[0.375rem] tw-h-full card-container">
        <div class="row items-center justify-between q-mb-md">
          <div class="col">
            <div class="text-h5 text-bold">Service Graph</div>
            <div class="text-subtitle2 text-grey-7">
              Visualize service dependencies and communication patterns from distributed traces
            </div>
          </div>
          <div class="col-auto row q-gutter-sm">
            <q-btn
              data-test="service-graph-refresh-btn"
              no-caps
              flat
              dense
              icon="refresh"
              class="tw-border tw-border-solid tw-border-[var(--o2-border-color)] q-px-sm element-box-shadow hover:tw-bg-[var(--o2-hover-accent)]"
              @click="loadServiceGraph"
              :loading="loading"
            >
              <q-tooltip>Refresh Service Graph</q-tooltip>
            </q-btn>
            <q-btn-dropdown
              data-test="service-graph-layout-dropdown"
              size="12px"
              icon="tune"
              label="Layout"
              class="saved-views-dropdown btn-function el-border hover:tw-bg-[var(--o2-hover-accent)]"
              @click="() => {}"
            >
              <q-list>
                <q-item clickable v-close-popup @click="setLayout('hierarchical')">
                  <q-item-section>
                    <q-item-label>Hierarchical</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="setLayout('force')">
                  <q-item-section>
                    <q-item-label>Force-Directed</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="setLayout('circular')">
                  <q-item-section>
                    <q-item-label>Circular</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
            <q-btn
              data-test="service-graph-settings-btn"
              class="q-mr-xs download-logs-btn q-px-sm element-box-shadow el-border hover:tw-bg-[var(--o2-hover-accent)]"
              size="xs"
              icon="settings"
              @click="showSettings = true"
            >
              <q-tooltip>Settings</q-tooltip>
            </q-btn>
          </div>
        </div>

        <!-- Enhanced Stats Bar -->
        <div class="row q-col-gutter-md q-mb-md">
          <div class="col-12 col-md-2">
            <q-card flat bordered class="stat-card">
              <q-card-section class="!tw-p-[0.375rem]">
                <div class="row items-center">
                  <q-icon name="hub" size="1.5rem" color="primary" class="q-mr-sm" />
                  <div>
                    <div class="text-caption text-grey-7">Services</div>
                    <div class="tw-text-[1.25rem] text-bold">{{ stats?.services || 0 }}</div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>
          <div class="col-12 col-md-2">
            <q-card flat bordered class="stat-card">
              <q-card-section class="tw-p-[0.375rem]">
                <div class="row items-center">
                  <q-icon name="share" size="1.5rem" color="blue" class="q-mr-sm" />
                  <div>
                    <div class="text-caption text-grey-7">Connections</div>
                    <div class="tw-text-[1.25rem] text-bold">{{ stats?.connections || 0 }}</div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>
          <div class="col-12 col-md-3">
            <q-card flat bordered class="stat-card">
              <q-card-section class="tw-p-[0.375rem]">
                <div class="row items-center">
                  <q-icon name="speed" size="1.5rem" color="orange" class="q-mr-sm" />
                  <div>
                    <div class="text-caption text-grey-7">Total Requests</div>
                    <div class="tw-text-[1.25rem] text-bold">{{ formatNumber(stats?.totalRequests || 0) }}</div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>
          <div class="col-12 col-md-3">
            <q-card flat bordered class="stat-card">
              <q-card-section class="tw-p-[0.375rem]">
                <div class="row items-center">
                  <q-icon name="error_outline" size="1.5rem" :color="stats?.errorRate > 5 ? 'negative' : 'grey-5'" class="q-mr-sm" />
                  <div>
                    <div class="text-caption text-grey-7">Error Rate</div>
                    <div class="tw-text-[1.25rem] text-bold" :class="stats?.errorRate > 5 ? 'text-negative' : ''">
                      {{ stats?.errorRate?.toFixed(2) || 0 }}%
                    </div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>
          <div class="col-12 col-md-2">
            <q-card flat bordered class="stat-card">
              <q-card-section class="tw-p-[0.375rem]">
                <div class="row items-center">
                  <q-icon name="check_circle" size="1.5rem" :color="storeStats?.enabled ? 'positive' : 'grey'" class="q-mr-sm" />
                  <div>
                    <div class="text-caption text-grey-7">Status</div>
                    <div class="tw-text-[1.25rem] text-bold">
                      {{ storeStats?.enabled ? 'Active' : 'Inactive' }}
                    </div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>

        <!-- Filters -->
        <div class="row q-col-gutter-sm q-mb-md">
          <div class="col-12 col-md-4">
            <q-input
              v-model="searchFilter"
              borderless
              dense
              class="no-border tw-h-[36px]"
              placeholder="Search services..."
              debounce="300"
              @update:model-value="applyFilters"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
          </div>
          <div class="col-12 col-md-8">
            <div class="app-tabs-container tw-h-[36px] tw-w-fit">
              <app-tabs
                class="tabs-selection-container"
                :tabs="connectionTypeTabs"
                :activeTab="connectionTypeFilter"
                @update:activeTab="connectionTypeFilter = $event; applyFilters()"
              />
            </div>
          </div>
        </div>

        <!-- Graph Visualization -->
        <q-card flat bordered class="graph-card  tw-h-[calc(100%-15.25rem)]">
          <q-card-section class="q-pa-none tw-h-full" style="height: 100%;">
            <div
              ref="graphContainer"
              class="graph-container tw-h-full tw-bg-[var(--o2-bg)]"
            >
              <div v-if="true" class="flex flex-center tw-h-full">
                <div class="text-center tw-flex tw-flex-col tw-items-center">
                  <q-spinner-hourglass color="primary" size="4em" />
                  <div class="text-subtitle1 q-mt-md text-grey-7">Loading service graph...</div>
                </div>
              </div>
              <div
                v-else-if="error"
                class="flex flex-center tw-h-full text-center tw-p-[0.675rem]"
              >
                <div>
                  <q-icon name="error_outline" size="4em" color="negative" />
                  <div class="text-h6 q-mt-md tw-text-[var(--o2-text-primary)]">{{ error }}</div>
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
                class="flex flex-center tw-h-full text-center tw-p-[0.675rem]"
              >
                <div>
                  <q-icon name="hub" size="5em" color="grey-4" />
                  <div class="text-h6 q-mt-md text-grey-7">No Service Graph Data</div>
                  <div class="text-body2 text-grey-6 q-mt-sm" style="max-width: 500px">
                    Send distributed traces with client and server spans to see the service graph.
                    Make sure <code>ZO_SGRAPH_ENABLED=true</code> is set.
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
              <div v-else style="position: relative; width: 100%; height: 100%;">
                <div id="graph-network"></div>
                <!-- Node Details Panel (shown on node click) -->
                <q-card
                  v-if="selectedNode"
                  class="node-details-card"
                  flat
                  bordered
                >
                  <q-card-section class="tw-p-[0.675rem]">
                    <div class="row items-center justify-between q-mb-sm">
                      <div class="text-h6">{{ selectedNode.label }}</div>
                      <q-btn
                        flat
                        dense
                        round
                        icon="close"
                        size="sm"
                        @click="selectedNode = null"
                      />
                    </div>
                    <q-separator class="q-mb-sm" />
                    <div class="text-caption text-grey-7 q-mb-xs">Connections</div>
                    <div class="q-mb-sm">
                      <div><strong>Incoming:</strong> {{ getIncomingConnections(selectedNode.id).length }}</div>
                      <div><strong>Outgoing:</strong> {{ getOutgoingConnections(selectedNode.id).length }}</div>
                    </div>
                    <div class="text-caption text-grey-7 q-mb-xs">Traffic</div>
                    <div>
                      <div><strong>Requests:</strong> {{ formatNumber(getNodeRequests(selectedNode.id)) }}</div>
                      <div><strong>Errors:</strong> {{ getNodeErrors(selectedNode.id) }}</div>
                    </div>
                  </q-card-section>
                </q-card>
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Enhanced Legend -->
        <div class="row items-center tw-mt-[0.5rem]">
          <div class="col-auto text-subtitle2 text-grey-7 q-mr-md">
            Connection Types:
          </div>
          <div class="col">
            <div class="row q-col-gutter-sm">
              <div class="col-auto">
                <q-chip dense square color="blue" text-color="white" icon="sync_alt" class="tw-px-[0.6rem] !tw-py-[0.8rem]">
                  Standard
                </q-chip>
              </div>
              <div class="col-auto">
                <q-chip dense square color="purple" text-color="white" icon="message" class="tw-px-[0.6rem] !tw-py-[0.8rem]">
                  Messaging
                </q-chip>
              </div>
              <div class="col-auto">
                <q-chip dense square color="orange" text-color="white" icon="storage" class="tw-px-[0.6rem] !tw-py-[0.8rem]">
                  Database
                </q-chip>
              </div>
              <div class="col-auto">
                <q-chip dense square color="grey" text-color="white" icon="cloud" class="tw-px-[0.6rem] !tw-py-[0.8rem]">
                  Virtual/External
                </q-chip>
              </div>
            </div>
          </div>
          <div class="col-auto text-caption text-grey-6">
            Last updated: {{ lastUpdated }}
          </div>
        </div>
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
            <q-input
              v-model.number="graphHeight"
              type="number"
              label="Graph Height (px)"
              :min="400"
              :max="1200"
              borderless
              dense
              class="o2-input showLabelOnTop"
            />
            <q-toggle
              v-model="autoRefresh"
              label="Auto-refresh (every 30 seconds)"
              @update:model-value="toggleAutoRefresh"
            />
            <q-toggle
              v-model="showLabels"
              label="Show edge labels"
              @update:model-value="renderGraph"
            />
            <q-toggle
              v-model="enablePhysics"
              label="Enable physics simulation"
              @update:model-value="updatePhysics"
            />
            <div class="text-caption text-grey-7 q-mt-md">
              Store Size: {{ storeStats?.store_size || 0 }} edges
              <q-tooltip>Number of pending span pairs waiting to be matched</q-tooltip>
            </div>
          </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn flat dense no-caps label="Close" color="primary" v-close-popup class="o2-secondary-button tw-h-[2rem]" />
          <q-btn label="Reset" @click="resetSettings" class="o2-primary-button tw-h-[2rem]" />  
        </q-card-actions>
      </q-card>
    </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import serviceGraphService from "@/services/service_graph";
import AppTabs from "@/components/common/AppTabs.vue";

export default defineComponent({
  name: "ServiceGraph",
  components: {
    AppTabs,
  },
  setup() {
    const store = useStore();

    const loading = ref(false);
    const error = ref<string | null>(null);
    const graphContainer = ref<HTMLElement | null>(null);
    const showSettings = ref(false);
    const graphHeight = ref(650);
    const autoRefresh = ref(true);
    const showLabels = ref(true);
    const enablePhysics = ref(false);  // Disabled by default for stable graph
    const lastUpdated = ref("");
    const layoutType = ref("force");

    const searchFilter = ref("");
    const connectionTypeFilter = ref("all");
    const selectedNode = ref<any>(null);

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
    });

    const filteredGraphData = ref<any>({
      nodes: [],
      edges: [],
    });

    const stats = ref<any>(null);
    const storeStats = ref<any>(null);

    let networkInstance: any = null;
    let refreshInterval: any = null;

    const loadServiceGraph = async () => {
      loading.value = true;
      error.value = null;

      try {
        const orgId = store.state.selectedOrganization.identifier;

        if (!orgId) {
          throw new Error("No organization selected");
        }

        // Load store stats with timeout
        const statsResponse: any = await Promise.race([
          serviceGraphService.getStats(orgId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Request timeout")), 30000)
          )
        ]);
        storeStats.value = statsResponse.data;

        if (!storeStats.value?.enabled) {
          error.value = "Service Graph is not enabled. Set ZO_SGRAPH_ENABLED=true";
          loading.value = false;
          return;
        }

        // Load metrics and parse
        const metricsResponse = await serviceGraphService.getMetrics(orgId);
        const parsedData = parsePrometheusMetrics(metricsResponse.data);

        graphData.value = parsedData;

        // Calculate stats
        const totalRequests = parsedData.edges.reduce((sum: number, e: any) => sum + e.total_requests, 0);
        const totalErrors = parsedData.edges.reduce((sum: number, e: any) => sum + e.failed_requests, 0);

        stats.value = {
          services: parsedData.nodes.length,
          connections: parsedData.edges.length,
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
          error.value = "Service Graph API endpoint not found. Ensure you're running a version that supports Service Graph.";
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
      };
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

      if (nodes.length > 0) {
        setTimeout(() => renderGraph(), 100);
      }
    };

    const setLayout = (type: string) => {
      layoutType.value = type;
      renderGraph();
    };

    const renderGraph = () => {
      if (!graphContainer.value || !(window as any).vis) {
        console.warn("Graph container or vis.js not available");
        return;
      }

      const container = document.getElementById("graph-network");
      if (!container) return;

      // Calculate error rates for each node
      const nodeErrorRates = new Map<string, { total: number; errors: number }>();
      filteredGraphData.value.edges.forEach((edge: any) => {
        const calcRate = (nodeId: string) => {
          const current = nodeErrorRates.get(nodeId) || { total: 0, errors: 0 };
          nodeErrorRates.set(nodeId, {
            total: current.total + edge.total_requests,
            errors: current.errors + edge.failed_requests,
          });
        };
        calcRate(edge.from);
        calcRate(edge.to);
      });

      // Prepare nodes for vis.js with Tempo-style arc borders
      const nodes = filteredGraphData.value.nodes.map((node: any) => {
        const errorData = nodeErrorRates.get(node.id);
        const errorRate = errorData && errorData.total > 0
          ? (errorData.errors / errorData.total) * 100
          : 0;

        // Calculate border color based on error rate
        let borderColor = "#4CAF50"; // Green for no/low errors
        if (errorRate > 0 && errorRate <= 1) {
          borderColor = "#8BC34A"; // Light green
        } else if (errorRate > 1 && errorRate <= 5) {
          borderColor = "#FFC107"; // Yellow
        } else if (errorRate > 5 && errorRate <= 10) {
          borderColor = "#FF9800"; // Orange
        } else if (errorRate > 10) {
          borderColor = "#F44336"; // Red
        }

        return {
          id: node.id,
          label: node.label,
          title: `${node.label}\nRequests: ${formatNumber(errorData?.total || 0)}\nErrors: ${errorData?.errors || 0}\nError Rate: ${errorRate.toFixed(2)}%`,
          color: {
            background: node.is_virtual ? "#ECEFF1" : "#E3F2FD",
            border: borderColor,
            highlight: {
              background: node.is_virtual ? "#CFD8DC" : "#BBDEFB",
              border: borderColor,
            },
          },
          shape: "circle",
          size: 40,
          margin: 15,
          font: {
            size: 13,
            color: "#263238",
            face: "Arial",
            bold: true,
          },
          borderWidth: 4,
          borderWidthSelected: 6,
          shadow: {
            enabled: true,
            color: "rgba(0,0,0,0.2)",
            size: 8,
            x: 2,
            y: 2,
          },
        };
      });

      // Prepare edges for vis.js
      const edges = filteredGraphData.value.edges.map((edge: any) => {
        const errorRate =
          edge.total_requests > 0
            ? (edge.failed_requests / edge.total_requests) * 100
            : 0;

        const color = getConnectionTypeColor(edge.connection_type);
        const width = Math.max(2, Math.min(10, Math.log10(edge.total_requests + 1) * 2));

        const hasErrors = errorRate > 0;
        const label = showLabels.value
          ? `${formatNumber(edge.total_requests)}${hasErrors ? '\n' + errorRate.toFixed(1) + '% err' : ''}`
          : '';

        return {
          from: edge.from,
          to: edge.to,
          label,
          arrows: { to: { enabled: true, scaleFactor: 0.8 } },
          color: {
            color,
            highlight: color,
            opacity: errorRate > 5 ? 0.5 : 1.0,
          },
          width,
          font: { size: 11, align: "middle", background: "white" },
          smooth: { type: "curvedCW", roundness: 0.2 },
          dashes: errorRate > 10,
        };
      });

      const data = { nodes, edges };

      let layoutOptions: any = {};

      if (layoutType.value === "hierarchical") {
        layoutOptions = {
          hierarchical: {
            enabled: true,
            direction: "UD",
            sortMethod: "directed",
            levelSeparation: 150,
            nodeSpacing: 150,
          },
        };
      } else if (layoutType.value === "circular") {
        layoutOptions = {
          hierarchical: false,
        };
      } else {
        layoutOptions = {
          improvedLayout: true,
          hierarchical: { enabled: false },
        };
      }

      const options = {
        layout: layoutOptions,
        physics: {
          enabled: enablePhysics.value,
          stabilization: {
            enabled: true,
            iterations: 400,
            updateInterval: 20,
          },
          barnesHut: {
            gravitationalConstant: -15000, // Much stronger repulsion for sparse layout
            centralGravity: 0.1, // Less central pull
            springLength: 400, // Longer springs = more spacing
            springConstant: 0.01, // Weaker springs
            damping: 0.7,
            avoidOverlap: 1,
          },
          solver: 'barnesHut',
          minVelocity: 0.75,
        },
        interaction: {
          hover: true,
          tooltipDelay: 200,
          navigationButtons: true,
          keyboard: true,
          zoomView: true,
          dragView: true,
        },
        nodes: {
          borderWidth: 5,
          borderWidthSelected: 7,
        },
        edges: {
          smooth: {
            enabled: true,
            type: "curvedCW",
            roundness: 0.2,
          },
        },
        configure: {
          enabled: false,
        },
      };

      if (networkInstance) {
        networkInstance.destroy();
      }

      networkInstance = new (window as any).vis.Network(container, data, options);

      // Stabilize then disable physics for static display
      if (!enablePhysics.value) {
        networkInstance.once("stabilizationIterationsDone", () => {
          networkInstance.setOptions({ physics: false });
        });
      }

      // Add click handler
      networkInstance.on("click", (params: any) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const node = filteredGraphData.value.nodes.find((n: any) => n.id === nodeId);
          selectedNode.value = node;
        } else {
          selectedNode.value = null;
        }
      });

      // Circular layout implementation
      if (layoutType.value === "circular") {
        const positions: any = {};
        const nodeCount = nodes.length;
        const radius = Math.max(250, nodeCount * 30);

        nodes.forEach((node: any, i: number) => {
          const angle = (i / nodeCount) * 2 * Math.PI;
          positions[node.id] = {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
          };
        });

        networkInstance.setOptions({ physics: { enabled: false } });
        setTimeout(() => {
          networkInstance.setPositions(positions);
          networkInstance.fit();
        }, 100);
      }
    };

    const getConnectionTypeColor = (type: string) => {
      switch (type) {
        case "messaging":
          return "#9C27B0"; // Purple
        case "database":
          return "#FF9800"; // Orange
        case "virtual":
          return "#9E9E9E"; // Grey
        default:
          return "#2196F3"; // Blue
      }
    };

    const getIncomingConnections = (nodeId: string) => {
      return filteredGraphData.value.edges.filter((e: any) => e.to === nodeId);
    };

    const getOutgoingConnections = (nodeId: string) => {
      return filteredGraphData.value.edges.filter((e: any) => e.from === nodeId);
    };

    const getNodeRequests = (nodeId: string) => {
      const incoming = getIncomingConnections(nodeId);
      const outgoing = getOutgoingConnections(nodeId);
      return [...incoming, ...outgoing].reduce((sum, e) => sum + e.total_requests, 0);
    };

    const getNodeErrors = (nodeId: string) => {
      const incoming = getIncomingConnections(nodeId);
      const outgoing = getOutgoingConnections(nodeId);
      return [...incoming, ...outgoing].reduce((sum, e) => sum + e.failed_requests, 0);
    };

    const formatNumber = (num: number) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
      if (num >= 1000) return (num / 1000).toFixed(1) + "K";
      return num.toString();
    };

    const toggleAutoRefresh = (enabled: boolean) => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }

      if (enabled) {
        refreshInterval = setInterval(loadServiceGraph, 30000);
      }
    };

    const updatePhysics = () => {
      if (networkInstance) {
        networkInstance.setOptions({
          physics: { enabled: enablePhysics.value },
        });
      }
    };

    const resetSettings = () => {
      graphHeight.value = 650;
      autoRefresh.value = true;
      showLabels.value = true;
      enablePhysics.value = false;
      layoutType.value = "force";
      toggleAutoRefresh(true);
      renderGraph();
    };

    onMounted(() => {
      // Load vis.js library
      const script = document.createElement("script");
      script.src = "https://unpkg.com/vis-network@9.1.6/dist/vis-network.min.js";
      script.onload = () => {
        loadServiceGraph();

        // Auto-refresh every 30 seconds
        if (autoRefresh.value) {
          refreshInterval = setInterval(loadServiceGraph, 30000);
        }
      };
      document.head.appendChild(script);

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/vis-network@9.1.6/dist/dist/vis-network.min.css";
      document.head.appendChild(link);
    });

    onBeforeUnmount(() => {
      if (networkInstance) {
        networkInstance.destroy();
      }
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    });

    return {
      loading,
      error,
      graphContainer,
      graphData,
      filteredGraphData,
      stats,
      storeStats,
      showSettings,
      graphHeight,
      autoRefresh,
      showLabels,
      enablePhysics,
      lastUpdated,
      searchFilter,
      connectionTypeFilter,
      connectionTypeTabs,
      selectedNode,
      loadServiceGraph,
      formatNumber,
      applyFilters,
      setLayout,
      toggleAutoRefresh,
      updatePhysics,
      resetSettings,
      getIncomingConnections,
      getOutgoingConnections,
      getNodeRequests,
      getNodeErrors,
      renderGraph,
    };
  },
});
</script>

<style scoped lang="scss">
.service-graph-container {
  height: 100%;
  padding: 16px;
}

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

#graph-network {
  width: 100%;
  height: 100%;
  background: linear-gradient(to bottom, #ffffff 0%, #f9f9f9 100%);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.node-details-card {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 280px;
  background: white;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  z-index: 1000;
}

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}
</style>
