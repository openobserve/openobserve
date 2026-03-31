<!-- Copyright 2026 OpenObserve Inc.

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
  <transition name="slide">
    <div
      v-if="visible"
      class="service-graph-side-panel"
      data-test="service-graph-side-panel"
    >
      <!-- Header Section (compact with inline health badge) -->
      <div
        class="panel-header tw:py-[0.375rem] tw:px-[0.625rem]"
        data-test="service-graph-side-panel-header"
      >
        <div class="panel-title">
          <h2
            class="service-name"
            data-test="service-graph-side-panel-service-name"
          >
            {{ selectedNode?.name || selectedNode?.label || selectedNode?.id }}
            <span class="health-badge" :class="serviceHealth.status">
              {{ serviceHealth.text }}
            </span>
          </h2>
        </div>
        <div class="panel-header-actions">
          <q-btn
            unelevated
            no-caps
            dense
            size="sm"
            label="Show telemetry"
            icon="manage_search"
            @click="handleShowTelemetry"
            data-test="service-graph-side-panel-show-telemetry-btn"
            class="telemetry-btn"
            :loading="correlationLoading"
          />
          <q-btn
            flat
            dense
            round
            icon="cancel"
            size="sm"
            @click="handleClose"
            data-test="service-graph-side-panel-close-btn"
            class="close-btn"
          />
        </div>
      </div>

      <!-- Content Scrollable Area -->
      <div class="panel-content">
        <!-- RED Charts Section -->
        <div
          v-if="streamFilter !== 'all' && dashboardData"
          class="panel-section red-charts-section tw:flex tw:mb-0!"
          data-test="service-graph-side-panel-red-charts"
        >
          <div class="charts-wrapper tw:py-0! tw:min-h-[13.5rem] tw:w-full">
            <div class="charts-container tw:w-full">
              <RenderDashboardCharts
                ref="dashboardChartsRef"
                :viewOnly="true"
                :dashboardData="dashboardData || {}"
                :currentTimeObj="currentTimeObj"
                :allowAlertCreation="false"
                searchType="dashboards"
              />
            </div>
          </div>
        </div>

        <q-separator class="tw:mb-[0.675rem]!" />
        <!-- Tabs: Operations / Nodes / Pods -->
        <template v-if="streamFilter !== 'all'">
          <q-tabs
            v-model="activeTab"
            dense
            inline-label
            align="left"
            class="text-bold q-mx-sm tw:mb-[0.375rem]"
            data-test="service-graph-node-panel-tabs"
          >
            <q-tab
              name="operations"
              label="Operations"
              style="text-transform: capitalize"
              data-test="service-graph-node-panel-tab-operations"
            />
            <q-tab
              name="nodes"
              label="Nodes"
              style="text-transform: capitalize"
              data-test="service-graph-node-panel-tab-nodes"
            />
            <q-tab
              name="pods"
              label="Pods"
              style="text-transform: capitalize"
              data-test="service-graph-node-panel-tab-pods"
            />
          </q-tabs>
          <q-tab-panels v-model="activeTab" animated>
            <!-- Operations Tab -->
            <q-tab-panel
              name="operations"
              class="tw:p-0! panel-section tw:mb-0!"
              data-test="service-graph-side-panel-recent-operations"
            >
              <!-- Loading State -->
              <div
                v-if="loadingOperations"
                class="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:text-sm"
                style="color: var(--o2-text-secondary)"
              >
                <q-spinner color="primary" size="sm" />
                <span>Loading operations...</span>
              </div>

              <template v-else>
                <div
                  v-if="recentOperations.length === 0"
                  class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                  style="color: var(--o2-text-secondary)"
                >
                  No operations found
                </div>
                <div
                  v-else
                  class="tw:max-h-[20rem] tw:overflow-hidden"
                  data-test="service-graph-side-panel-operations-table"
                >
                  <TenstackTable
                    :columns="operationsTableColumns"
                    :rows="operationsTableRows"
                    :loading="false"
                    :default-columns="false"
                    :enable-column-reorder="false"
                    :enable-row-expand="false"
                    :enable-text-highlight="false"
                    :enable-status-bar="false"
                    :enable-ai-context-button="false"
                    :row-height="28"
                    @click:data-row="(row: any) => navigateToTraces(row._name)"
                  >
                    <template #cell-errors="{ item }">
                      <span
                        :class="
                          item.errors > 0
                            ? 'tw:text-[var(--q-negative)] tw:font-semibold'
                            : ''
                        "
                        >{{ item.errors }}</span
                      >
                    </template>
                    <template #cell-p99="{ item }">
                      <span
                        :class="
                          item.p99 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p99)]'
                            : ''
                        "
                        >{{ item.p99 }}</span
                      >
                    </template>
                    <template #cell-p95="{ item }">
                      <span
                        :class="
                          item.p95 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p95)]'
                            : ''
                        "
                        >{{ item.p95 }}</span
                      >
                    </template>
                    <template #cell-p75="{ item }">
                      <span
                        :class="
                          item.p75 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p75)]'
                            : ''
                        "
                        >{{ item.p75 }}</span
                      >
                    </template>
                    <template #cell-actions="{ row, active }">
                      <q-btn
                        v-if="active"
                        flat
                        dense
                        icon="search"
                        size="xs"
                        class="tw:ml-1 tw:p-[0.12rem]! tw:rounded! tw:absolute! tw:right-2! tw:text-[var(--o2-text-1)]! tw:bg-[var(--o2-card-bg-solid)]!"
                        data-test="service-graph-side-panel-view-traces-btn"
                        @click.stop="navigateToTraces(row._name)"
                      >
                        <q-tooltip>View in Traces</q-tooltip>
                      </q-btn>
                    </template>
                    <template #empty>
                      <div
                        class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                        style="color: var(--o2-text-secondary)"
                      >
                        No operations found
                      </div>
                    </template>
                  </TenstackTable>
                </div>
              </template>
            </q-tab-panel>

            <!-- Nodes Tab -->
            <q-tab-panel
              name="nodes"
              class="tw:p-0! panel-section"
              data-test="service-graph-side-panel-nodes"
            >
              <div
                v-if="loadingNodes"
                class="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:text-sm"
                style="color: var(--o2-text-secondary)"
              >
                <q-spinner color="primary" size="sm" />
                <span>Loading nodes...</span>
              </div>
              <template v-else>
                <div
                  v-if="recentNodes.length === 0"
                  class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                  style="color: var(--o2-text-secondary)"
                >
                  No node data found
                </div>
                <div
                  v-else
                  class="tw:max-h-[20rem] tw:overflow-hidden"
                  data-test="service-graph-side-panel-nodes-table"
                >
                  <TenstackTable
                    :columns="nodesTableColumns"
                    :rows="nodesTableRows"
                    :loading="false"
                    :default-columns="false"
                    :enable-column-reorder="false"
                    :enable-row-expand="false"
                    :enable-text-highlight="false"
                    :enable-status-bar="false"
                    :enable-ai-context-button="false"
                    :row-height="28"
                  >
                    <template #cell-errors="{ item }">
                      <span
                        :class="
                          item.errors > 0
                            ? 'tw:text-[var(--q-negative)] tw:font-semibold'
                            : ''
                        "
                        >{{ item.errors }}</span
                      >
                    </template>
                    <template #cell-p99="{ item }">
                      <span
                        :class="
                          item.p99 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p99)]'
                            : ''
                        "
                        >{{ item.p99 }}</span
                      >
                    </template>
                    <template #cell-p95="{ item }">
                      <span
                        :class="
                          item.p95 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p95)]'
                            : ''
                        "
                        >{{ item.p95 }}</span
                      >
                    </template>
                    <template #cell-p75="{ item }">
                      <span
                        :class="
                          item.p75 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p75)]'
                            : ''
                        "
                        >{{ item.p75 }}</span
                      >
                    </template>
                    <template #empty>
                      <div
                        class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                        style="color: var(--o2-text-secondary)"
                      >
                        No node data found
                      </div>
                    </template>
                  </TenstackTable>
                </div>
              </template>
            </q-tab-panel>

            <!-- Pods Tab -->
            <q-tab-panel
              name="pods"
              class="tw:p-0! panel-section"
              data-test="service-graph-side-panel-pods"
            >
              <div
                v-if="loadingPods"
                class="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:text-sm"
                style="color: var(--o2-text-secondary)"
              >
                <q-spinner color="primary" size="sm" />
                <span>Loading pods...</span>
              </div>
              <template v-else>
                <div
                  v-if="recentPods.length === 0"
                  class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                  style="color: var(--o2-text-secondary)"
                >
                  No pod data found
                </div>
                <div
                  v-else
                  class="tw:max-h-[20rem] tw:overflow-hidden"
                  data-test="service-graph-side-panel-pods-table"
                >
                  <TenstackTable
                    :columns="podsTableColumns"
                    :rows="podsTableRows"
                    :loading="false"
                    :default-columns="false"
                    :enable-column-reorder="false"
                    :enable-row-expand="false"
                    :enable-text-highlight="false"
                    :enable-status-bar="false"
                    :enable-ai-context-button="false"
                    :row-height="28"
                  >
                    <template #cell-errors="{ item }">
                      <span
                        :class="
                          item.errors > 0
                            ? 'tw:text-[var(--q-negative)] tw:font-semibold'
                            : ''
                        "
                        >{{ item.errors }}</span
                      >
                    </template>
                    <template #cell-p99="{ item }">
                      <span
                        :class="
                          item.p99 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p99)]'
                            : ''
                        "
                        >{{ item.p99 }}</span
                      >
                    </template>
                    <template #cell-p95="{ item }">
                      <span
                        :class="
                          item.p95 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p95)]'
                            : ''
                        "
                        >{{ item.p95 }}</span
                      >
                    </template>
                    <template #cell-p75="{ item }">
                      <span
                        :class="
                          item.p75 !== 'N/A'
                            ? 'tw:text-[var(--o2-latency-p75)]'
                            : ''
                        "
                        >{{ item.p75 }}</span
                      >
                    </template>
                    <template #empty>
                      <div
                        class="tw:text-xs tw:italic tw:py-2 tw:text-center"
                        style="color: var(--o2-text-secondary)"
                      >
                        No pod data found
                      </div>
                    </template>
                  </TenstackTable>
                </div>
              </template>
            </q-tab-panel>
          </q-tab-panels>
        </template>
      </div>
    </div>
  </transition>

  <!-- Telemetry Correlation Dialog (reuses the same component as "show related" on logs page) -->
  <TelemetryCorrelationDashboard
    v-if="showTelemetryDialog && correlationData"
    mode="dialog"
    :service-name="correlationData.serviceName"
    :matched-dimensions="correlationData.matchedDimensions"
    :additional-dimensions="correlationData.additionalDimensions"
    :log-streams="correlationData.logStreams"
    :metric-streams="correlationData.metricStreams"
    :trace-streams="correlationData.traceStreams"
    :time-range="telemetryTimeRange"
    @close="showTelemetryDialog = false"
  />
</template>

<script lang="ts">
import {
  defineComponent,
  computed,
  ref,
  watch,
  defineAsyncComponent,
  type PropType,
} from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import searchService from "@/services/search";
import { correlate as correlateStreams } from "@/services/service_streams";
import { escapeSingleQuotes, deepCopy } from "@/utils/zincutils";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics/metrics.json";

const TelemetryCorrelationDashboard = defineAsyncComponent(
  () => import("@/plugins/correlation/TelemetryCorrelationDashboard.vue"),
);

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TenstackTable = defineAsyncComponent(
  () => import("@/components/TenstackTable.vue"),
);

export default defineComponent({
  name: "ServiceGraphNodeSidePanel",
  components: {
    TelemetryCorrelationDashboard,
    TenstackTable,
    RenderDashboardCharts,
  },
  props: {
    selectedNode: {
      type: Object as PropType<any>,
      required: true,
    },
    graphData: {
      type: Object as PropType<{ nodes: any[]; edges: any[] }>,
      required: true,
    },
    timeRange: {
      type: Object as PropType<{ startTime: number; endTime: number }>,
      required: true,
    },
    visible: {
      type: Boolean,
      required: true,
    },
    streamFilter: {
      type: String,
      required: true,
    },
  },
  emits: ["close", "view-traces"],
  setup(props, { emit }) {
    const store = useStore();
    const $q = useQuasar();

    // RED Charts State
    const dashboardData = ref<any>({});
    const selectedTimeObj = ref({
      start_time: new Date(props.timeRange.startTime),
      end_time: new Date(props.timeRange.endTime),
    });

    const currentTimeObj = ref({
      __global: {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      },
    });

    // Returns the escaped service name value for use in SQL WHERE clauses
    const buildServiceName = (): string => {
      if (!props.selectedNode) return "";
      const name =
        props.selectedNode.name ||
        props.selectedNode.label ||
        props.selectedNode.id;
      return escapeSingleQuotes(name);
    };

    const loadDashboard = () => {
      if (!props.selectedNode || props.streamFilter === "all") {
        dashboardData.value = {};
        return;
      }

      const serviceName = buildServiceName();
      const streamName = props.streamFilter;

      selectedTimeObj.value = {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      };

      currentTimeObj.value = {
        __global: {
          start_time: new Date(props.timeRange.startTime),
          end_time: new Date(props.timeRange.endTime),
        },
      };

      const convertedDashboard = convertDashboardSchemaVersion(
        deepCopy(metrics),
      );
      const serviceFilter = `service_name = '${serviceName}'`;

      convertedDashboard.tabs[0].panels.forEach((panel: any, index) => {
        let whereClause: string;

        if (panel.title === "Errors") {
          whereClause = `WHERE span_status = 'ERROR' AND ${serviceFilter}`;
        } else {
          whereClause = `WHERE ${serviceFilter}`;
        }

        let query = panel.queries[0].query
          .replace("[STREAM_NAME]", `"${streamName}"`)
          .replace("[WHERE_CLAUSE]", whereClause);

        // Use count(*) instead of approx_distinct(trace_id)
        query = query
          .replace(
            /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/gi,
            "count(*) FILTER (WHERE span_status = 'ERROR')",
          )
          .replace(/approx_distinct\(trace_id\)/gi, "count(*)");

        convertedDashboard.tabs[0].panels[index]["queries"][0].query = query;
      });

      dashboardData.value = convertedDashboard;
    };

    // Metrics Correlation State
    const showTelemetryDialog = ref(false);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const correlationData = ref<{
      serviceName: string;
      matchedDimensions: Record<string, string>;
      additionalDimensions: Record<string, string>;
      logStreams: any[];
      metricStreams: any[];
      traceStreams: any[];
    } | null>(null);

    const telemetryTimeRange = computed(() => ({
      startTime: props.timeRange.startTime,
      endTime: props.timeRange.endTime,
    }));

    const fetchCorrelatedStreams = async (force = false) => {
      if (!props.selectedNode) return;
      if (!force && correlationData.value) return;

      correlationLoading.value = true;
      correlationError.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        const serviceName =
          props.selectedNode.name ||
          props.selectedNode.label ||
          props.selectedNode.id;

        // Send service name directly to _correlate
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || "default",
          source_type: "traces",
          available_dimensions: { service: serviceName },
        });

        const data = correlateResponse.data;
        if (!data) {
          correlationError.value = "No correlated streams found.";
          correlationData.value = null;
          return;
        }

        correlationData.value = {
          serviceName: data.service_name,
          matchedDimensions: data.matched_dimensions || {},
          additionalDimensions: data.additional_dimensions || {},
          logStreams: data.related_streams?.logs || [],
          metricStreams: data.related_streams?.metrics || [],
          traceStreams: data.related_streams?.traces || [],
        };
      } catch (err: any) {
        if (err.response?.status === 403) {
          correlationError.value =
            "Service Discovery is an enterprise feature.";
        } else {
          correlationError.value =
            err.message || "Failed to load service streams.";
        }
        correlationData.value = null;
      } finally {
        correlationLoading.value = false;
      }
    };

    // Reset correlation data when node changes
    watch(
      () => props.selectedNode?.id,
      () => {
        correlationData.value = null;
        correlationError.value = null;
      },
    );

    // Reload RED charts when node, time range, stream, or visibility changes
    watch(
      () =>
        [
          props.selectedNode?.id,
          props.timeRange,
          props.streamFilter,
          props.visible,
        ] as const,
      ([, , , visible]) => {
        if (visible && props.selectedNode) {
          loadDashboard();
        } else if (!visible) {
          dashboardData.value = {};
        }
      },
      { immediate: true, deep: true },
    );

    // Active tab state
    const activeTab = ref<"operations" | "nodes" | "pods">("operations");

    // Recent Operations State
    const operationsViewMode = ref<"aggregated" | "spans">("aggregated");
    const recentOperations = ref<any[]>([]);
    const recentSpanData = ref<{ errorSpans: any[]; slowSpans: any[] }>({
      errorSpans: [],
      slowSpans: [],
    });
    const loadingOperations = ref(false);

    // Nodes State
    const recentNodes = ref<any[]>([]);
    const loadingNodes = ref(false);

    // Pods State
    const recentPods = ref<any[]>([]);
    const loadingPods = ref(false);

    // Computed: Service Metrics
    const serviceMetrics = computed(() => {
      if (!props.selectedNode || !props.graphData) {
        return {
          requestRate: "N/A",
          requestRateValue: "N/A",
          totalRequests: 0,
          incomingRequests: 0,
          outgoingRequests: 0,
          errorRate: "N/A",
          p50Latency: "N/A",
          p95Latency: "N/A",
          p99Latency: "N/A",
        };
      }

      // Get total request count - handle both graph view (uses 'value') and tree view (uses 'requests')
      const totalRequests =
        props.selectedNode.value || props.selectedNode.requests || 0;

      // Calculate incoming requests (sum of all edges TO this node)
      const incomingEdges = props.graphData.edges.filter(
        (edge: any) => edge.to === props.selectedNode.id,
      );
      const incomingRequests = incomingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0,
      );

      // Calculate outgoing requests (sum of all edges FROM this node)
      const outgoingEdges = props.graphData.edges.filter(
        (edge: any) => edge.from === props.selectedNode.id,
      );
      const outgoingRequests = outgoingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0,
      );

      // Get errors and calculate error rate
      const errors = props.selectedNode.errors || 0;
      const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

      // Calculate latency percentiles from incoming edges
      let p50Latency = 0;
      let p95Latency = 0;
      let p99Latency = 0;
      if (incomingEdges.length > 0) {
        p50Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p50_latency_ns || 0),
        );
        p95Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p95_latency_ns || 0),
        );
        p99Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p99_latency_ns || 0),
        );
      }

      // Format request rate value without unit
      let requestRateValue = "";
      if (totalRequests >= 1000000) {
        requestRateValue = (totalRequests / 1000000).toFixed(1) + "M";
      } else if (totalRequests >= 1000) {
        requestRateValue = (totalRequests / 1000).toFixed(1) + "K";
      } else {
        requestRateValue = totalRequests.toString();
      }

      return {
        requestRate: formatRequestRate(totalRequests),
        requestRateValue: requestRateValue,
        totalRequests: totalRequests,
        incomingRequests: incomingRequests,
        outgoingRequests: outgoingRequests,
        errorRate: errorRate.toFixed(2) + "%",
        p50Latency:
          incomingEdges.length > 0 ? formatLatency(p50Latency) : "N/A",
        p95Latency:
          incomingEdges.length > 0 ? formatLatency(p95Latency) : "N/A",
        p99Latency:
          incomingEdges.length > 0 ? formatLatency(p99Latency) : "N/A",
      };
    });

    // Computed: Service Health
    const serviceHealth = computed(() => {
      if (!props.selectedNode) {
        return {
          status: "unknown",
          text: "Unknown",
          color: "grey",
          icon: "help",
        };
      }

      // Use node's own error_rate directly
      const errorRate = props.selectedNode.error_rate || 0;

      if (errorRate > 10) {
        return {
          status: "critical",
          text: "Critical",
          color: "negative",
          icon: "error",
        };
      } else if (errorRate > 5) {
        return {
          status: "degraded",
          text: "Degraded",
          color: "warning",
          icon: "warning",
        };
      } else {
        return {
          status: "healthy",
          text: "Healthy",
          color: "positive",
          icon: "check_circle",
        };
      }
    });

    // Computed: Check if "All Streams" is selected
    const isAllStreamsSelected = computed(() => {
      return props.streamFilter === "all";
    });

    // Helper: Format Request Rate (with unit)
    const formatRequestRate = (requests: number): string => {
      if (requests >= 1000000) {
        return (requests / 1000000).toFixed(1) + "M req/min";
      }
      if (requests >= 1000) {
        return (requests / 1000).toFixed(1) + "K req/min";
      }
      return requests + " req/min";
    };

    // Helper: Format Number (without unit)
    const formatNumber = (num: number): string => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + "M";
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + "K";
      }
      return num.toString();
    };

    // Helper: Format Latency
    const formatLatency = (nanoseconds: number): string => {
      if (!nanoseconds || nanoseconds === 0) return "N/A";
      const milliseconds = nanoseconds / 1000000;
      if (milliseconds >= 1000) {
        return (milliseconds / 1000).toFixed(2) + "s";
      }
      return milliseconds.toFixed(0) + "ms";
    };

    // Helper: Format Operation Latency (from microseconds)
    const formatOperationLatency = (microseconds: number): string => {
      if (!microseconds || microseconds === 0) return "N/A";
      if (microseconds < 1000) return `${microseconds.toFixed(0)}μs`;
      const milliseconds = microseconds / 1000;
      if (milliseconds < 1000) return `${milliseconds.toFixed(1)}ms`;
      return `${(milliseconds / 1000).toFixed(2)}s`;
    };

    // Helper: Format Span Timestamp (from nanoseconds)
    const formatSpanTimestamp = (nanoseconds: number): string => {
      const date = new Date(nanoseconds / 1000000);
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    };

    // Computed: Operations table columns
    const operationsTableColumns = computed(() => [
      {
        id: "operation",
        accessorKey: "operation",
        header: "OPERATION",
        size: 220,
        meta: { slot: false },
      },
      {
        id: "requests",
        accessorKey: "requests",
        header: "REQUESTS",
        size: 100,
      },
      {
        id: "errors",
        accessorKey: "errors",
        header: "ERRORS",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p99",
        accessorKey: "p99",
        header: "P99",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p95",
        accessorKey: "p95",
        header: "P95",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p75",
        accessorKey: "p75",
        header: "P75",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p50",
        accessorKey: "p50",
        header: "P50",
        size: 80,
        meta: { slot: true },
      },
    ]);

    // Computed: Operations table rows
    const operationsTableRows = computed(() =>
      recentOperations.value.map((op) => ({
        operation: op.name,
        requests: formatNumber(op.requestCount),
        errors: op.errorCount,
        p99: formatOperationLatency(op.p99Latency),
        p95: formatOperationLatency(op.p95Latency),
        p75: formatOperationLatency(op.p75Latency),
        p50: formatOperationLatency(op.p50Latency),
        _name: op.name,
      })),
    );

    // Fetch aggregated operations (grouped by operation_name with percentiles)
    const fetchAggregatedOperations = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      loadingOperations.value = true;
      recentOperations.value = [];

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const sql = `SELECT operation_name, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE service_name = '${serviceName}' GROUP BY operation_name`;

        const response = await searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: {
            query: {
              sql,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 100,
            },
          },
          page_type: "traces",
        });

        if (response.data && response.data.hits) {
          recentOperations.value = response.data.hits.map((op: any) => ({
            name: op.operation_name || "unknown",
            requestCount: op.request_count || 0,
            errorCount: op.error_count || 0,
            p50Latency: op.p50_latency || 0,
            p75Latency: op.p75_latency || 0,
            p95Latency: op.p95_latency || 0,
            p99Latency: op.p99_latency || 0,
          }));
        }
      } catch (error) {
        console.error("Failed to fetch aggregated operations:", error);
        recentOperations.value = [];
      } finally {
        loadingOperations.value = false;
      }
    };

    // Fetch recent spans (error spans + slowest spans)
    const fetchRecentSpans = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      loadingOperations.value = true;
      recentSpanData.value = { errorSpans: [], slowSpans: [] };

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const org = store.state.selectedOrganization.identifier;
        const timeParams = {
          start_time: props.timeRange.startTime,
          end_time: props.timeRange.endTime,
          from: 0,
        };

        const [errorRes, slowRes] = await Promise.all([
          searchService.search({
            org_identifier: org,
            query: {
              query: {
                sql: `SELECT operation_name, duration, start_time FROM "${streamName}" WHERE service_name = '${serviceName}' AND span_status = 'ERROR' ORDER BY start_time DESC`,
                ...timeParams,
                size: 5,
              },
            },
            page_type: "traces",
          }),
          searchService.search({
            org_identifier: org,
            query: {
              query: {
                sql: `SELECT operation_name, duration FROM "${streamName}" WHERE service_name = '${serviceName}' ORDER BY duration DESC`,
                ...timeParams,
                size: 20,
              },
            },
            page_type: "traces",
          }),
        ]);

        recentSpanData.value = {
          errorSpans: (errorRes.data?.hits || []).map((s: any) => ({
            name: s.operation_name || "unknown",
            duration: s.duration || 0,
            timestampDisplay: s.start_time
              ? formatSpanTimestamp(s.start_time)
              : "",
          })),
          slowSpans: (slowRes.data?.hits || []).map((s: any) => ({
            name: s.operation_name || "unknown",
            duration: s.duration || 0,
          })),
        };
      } catch (error) {
        console.error("Failed to fetch recent spans:", error);
        recentSpanData.value = { errorSpans: [], slowSpans: [] };
      } finally {
        loadingOperations.value = false;
      }
    };

    // Dispatch fetch based on current view mode
    const fetchOperations = () => {
      if (operationsViewMode.value === "aggregated") {
        fetchAggregatedOperations();
      } else {
        fetchRecentSpans();
      }
    };

    // Watch for panel visibility, node, stream filter, and view mode changes
    watch(
      () => [
        props.visible,
        props.selectedNode?.id,
        props.streamFilter,
        operationsViewMode.value,
      ],
      () => {
        if (
          props.visible &&
          props.selectedNode &&
          props.streamFilter !== "all"
        ) {
          fetchOperations();
        }
      },
      { immediate: true },
    );

    // Fetch nodes grouped by service_k8s_node_name
    const fetchNodes = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      loadingNodes.value = true;
      recentNodes.value = [];

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const sql = `SELECT service_k8s_node_name as node_name, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE service_name = '${serviceName}' AND service_k8s_node_name IS NOT NULL GROUP BY service_k8s_node_name ORDER BY request_count DESC`;

        const response = await searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: {
            query: {
              sql,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 100,
            },
          },
          page_type: "traces",
        });

        if (response.data && response.data.hits) {
          recentNodes.value = response.data.hits.map((n: any) => ({
            name: n.node_name || "unknown",
            requestCount: n.request_count || 0,
            errorCount: n.error_count || 0,
            p50Latency: n.p50_latency || 0,
            p75Latency: n.p75_latency || 0,
            p95Latency: n.p95_latency || 0,
            p99Latency: n.p99_latency || 0,
          }));
        }
      } catch (error) {
        console.error("Failed to fetch nodes:", error);
        recentNodes.value = [];
      } finally {
        loadingNodes.value = false;
      }
    };

    // Fetch pods grouped by service_k8s_pod_name
    const fetchPods = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === "all")
        return;

      loadingPods.value = true;
      recentPods.value = [];

      try {
        const serviceName = buildServiceName();
        const streamName = props.streamFilter || "default";
        const sql = `SELECT service_k8s_pod_name as pod_name, count(*) as request_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count, approx_percentile_cont(duration, 0.50) as p50_latency, approx_percentile_cont(duration, 0.75) as p75_latency, approx_percentile_cont(duration, 0.95) as p95_latency, approx_percentile_cont(duration, 0.99) as p99_latency FROM "${streamName}" WHERE service_name = '${serviceName}' AND service_k8s_pod_name IS NOT NULL GROUP BY service_k8s_pod_name ORDER BY request_count DESC`;

        const response = await searchService.search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: {
            query: {
              sql,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 100,
            },
          },
          page_type: "traces",
        });

        if (response.data && response.data.hits) {
          recentPods.value = response.data.hits.map((p: any) => ({
            name: p.pod_name || "unknown",
            requestCount: p.request_count || 0,
            errorCount: p.error_count || 0,
            p50Latency: p.p50_latency || 0,
            p75Latency: p.p75_latency || 0,
            p95Latency: p.p95_latency || 0,
            p99Latency: p.p99_latency || 0,
          }));
        }
      } catch (error) {
        console.error("Failed to fetch pods:", error);
        recentPods.value = [];
      } finally {
        loadingPods.value = false;
      }
    };

    // Computed: Nodes table columns
    const nodesTableColumns = computed(() => [
      {
        id: "node",
        accessorKey: "node",
        header: "NODE",
        size: 220,
        meta: { slot: false },
      },
      {
        id: "requests",
        accessorKey: "requests",
        header: "REQUESTS",
        size: 100,
      },
      {
        id: "errors",
        accessorKey: "errors",
        header: "ERRORS",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p99",
        accessorKey: "p99",
        header: "P99",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p95",
        accessorKey: "p95",
        header: "P95",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p75",
        accessorKey: "p75",
        header: "P75",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p50",
        accessorKey: "p50",
        header: "P50",
        size: 80,
        meta: { slot: true },
      },
    ]);

    // Computed: Nodes table rows
    const nodesTableRows = computed(() =>
      recentNodes.value.map((n) => ({
        node: n.name,
        requests: formatNumber(n.requestCount),
        errors: n.errorCount,
        p99: formatOperationLatency(n.p99Latency),
        p95: formatOperationLatency(n.p95Latency),
        p75: formatOperationLatency(n.p75Latency),
        p50: formatOperationLatency(n.p50Latency),
      })),
    );

    // Computed: Pods table columns
    const podsTableColumns = computed(() => [
      {
        id: "pod",
        accessorKey: "pod",
        header: "POD",
        size: 220,
        meta: { slot: false },
      },
      {
        id: "requests",
        accessorKey: "requests",
        header: "REQUESTS",
        size: 100,
      },
      {
        id: "errors",
        accessorKey: "errors",
        header: "ERRORS",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p99",
        accessorKey: "p99",
        header: "P99",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p95",
        accessorKey: "p95",
        header: "P95",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p75",
        accessorKey: "p75",
        header: "P75",
        size: 80,
        meta: { slot: true },
      },
      {
        id: "p50",
        accessorKey: "p50",
        header: "P50",
        size: 80,
        meta: { slot: true },
      },
    ]);

    // Computed: Pods table rows
    const podsTableRows = computed(() =>
      recentPods.value.map((p) => ({
        pod: p.name,
        requests: formatNumber(p.requestCount),
        errors: p.errorCount,
        p99: formatOperationLatency(p.p99Latency),
        p95: formatOperationLatency(p.p95Latency),
        p75: formatOperationLatency(p.p75Latency),
        p50: formatOperationLatency(p.p50Latency),
      })),
    );

    // Lazy-fetch nodes/pods when their tab is activated
    watch(
      () => [
        props.visible,
        props.selectedNode?.id,
        props.streamFilter,
        activeTab.value,
      ],
      () => {
        if (
          !props.visible ||
          !props.selectedNode ||
          props.streamFilter === "all"
        )
          return;
        if (activeTab.value === "nodes" && !recentNodes.value.length)
          fetchNodes();
        if (activeTab.value === "pods" && !recentPods.value.length) fetchPods();
      },
    );

    // Reset nodes/pods data and go back to operations tab when node or stream changes
    watch(
      () => [props.selectedNode?.id, props.streamFilter],
      () => {
        recentNodes.value = [];
        recentPods.value = [];
        activeTab.value = "operations";
      },
    );

    // Navigate to traces explore page filtered by this service + operation
    const navigateToTraces = (operationName: string) => {
      emit("view-traces", {
        stream: props.streamFilter,
        serviceName:
          props.selectedNode?.name ||
          props.selectedNode?.label ||
          props.selectedNode?.id,
        operationName,
        timeRange: props.timeRange,
      });
    };

    // Handlers
    const handleClose = () => {
      emit("close");
    };

    const handleShowTelemetry = async () => {
      await fetchCorrelatedStreams();
      if (correlationData.value) {
        showTelemetryDialog.value = true;
      } else if (correlationError.value) {
        $q.notify({
          type: "warning",
          message: correlationError.value,
          timeout: 3000,
          position: "bottom",
        });
      }
    };

    // Get color class for error rate card
    const getErrorRateClass = (): string => {
      const errorRateStr = serviceMetrics.value.errorRate;
      if (errorRateStr === "N/A") return "status-unknown";

      const errorRate = parseFloat(errorRateStr);
      if (errorRate < 1) return "status-healthy";
      if (errorRate < 5) return "status-warning";
      return "status-critical";
    };

    // Get color class for latency card
    const getLatencyClass = (latencyStr: string): string => {
      if (latencyStr === "N/A") return "status-unknown";

      // Parse latency value (could be "125ms" or "1.5s")
      let latencyMs = 0;
      if (latencyStr.endsWith("ms")) {
        latencyMs = parseFloat(latencyStr);
      } else if (latencyStr.endsWith("s")) {
        latencyMs = parseFloat(latencyStr) * 1000;
      }

      if (latencyMs < 100) return "status-healthy";
      if (latencyMs < 500) return "status-warning";
      return "status-critical";
    };

    return {
      serviceMetrics,
      serviceHealth,
      isAllStreamsSelected,
      formatNumber,
      getErrorRateClass,
      getLatencyClass,
      handleClose,
      handleShowTelemetry,
      // RED Charts
      dashboardData,
      selectedTimeObj,
      currentTimeObj,
      loadDashboard,
      // Telemetry Correlation
      showTelemetryDialog,
      correlationLoading,
      correlationData,
      telemetryTimeRange,
      // Tabs
      activeTab,
      // Recent Operations
      loadingOperations,
      recentOperations,
      operationsTableColumns,
      operationsTableRows,
      navigateToTraces,
      // Nodes
      loadingNodes,
      recentNodes,
      nodesTableColumns,
      nodesTableRows,
      // Pods
      loadingPods,
      recentPods,
      podsTableColumns,
      podsTableRows,
    };
  },
});
</script>

<style scoped lang="scss">
.service-graph-side-panel {
  position: absolute;
  right: 0;
  top: 0;
  min-width: 600px;
  width: 60%;
  height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: #1a1f2e;
  border-left: 1px solid #2d3548;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

// Light mode support
.body--light .service-graph-side-panel {
  background: #ffffff;
  border-left: 1px solid #e0e0e0;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

// Slide animation
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.slide-enter-to,
.slide-leave-from {
  transform: translateX(0);
}

// Header (compact with inline health badge)
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #2d3548;
  background: #1a1f2e;
  flex-shrink: 0;

  .panel-title {
    flex: 1;

    .service-name {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      line-height: 1.2; // Reduce line height for compactness
      color: #e4e7eb;
      letter-spacing: normal;
      display: flex;
      align-items: center;
      gap: 10px;

      .health-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px; // Reduced from 6px
        padding: 2px 8px; // Reduced from 4px 10px for more compact badge
        border-radius: 10px; // Slightly reduced from 12px
        font-size: 11px; // Reduced from 12px
        font-weight: 600;
        line-height: 1;

        // Add dot indicator
        &::before {
          content: "●";
          font-size: 10px; // Reduced from 12px
        }

        &.healthy {
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
        }

        &.degraded {
          background: rgba(251, 191, 36, 0.15);
          color: #fbbf24;
        }

        &.critical {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        &.warning {
          background: rgba(249, 115, 22, 0.15);
          color: #f97316;
        }
      }
    }
  }

  .panel-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .telemetry-btn {
    background: linear-gradient(135deg, #3b82f6, #6366f1) !important;
    color: #fff !important;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
    transition: all 0.2s;

    &:hover {
      filter: brightness(1.1);
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }
  }

  .close-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }
}

.body--light .panel-header {
  border-bottom: 1px solid #e0e0e0;
  background: #f5f5f5;

  .panel-title {
    .service-name {
      color: #202124;
      line-height: 1.2;

      .health-badge {
        &.healthy {
          background: rgba(16, 185, 129, 0.08);
          color: #059669;
        }

        &.degraded {
          background: rgba(251, 191, 36, 0.08);
          color: #d97706;
        }

        &.critical {
          background: rgba(239, 68, 68, 0.08);
          color: #dc2626;
        }

        &.warning {
          background: rgba(249, 115, 22, 0.08);
          color: #ea580c;
        }
      }
    }
  }
}

// Actions Section (moved to content area)
.actions-section {
  display: flex;
  gap: 8px;
  padding: 0;
  margin-bottom: 8px;
  flex-wrap: wrap;

  .action-btn {
    width: 35%;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid #2d3548;
    color: #e4e7eb;
    background: #242938;
    transition: all 0.2s;

    &:hover {
      background: #1a1f2e;
      border-color: #3b82f6;
      transform: translateY(-1px);
    }
  }
}

.view-traces-btn {
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  border-radius: 4px;
  padding: 0px 12px;
  min-width: 90px;
  transition:
    box-shadow 0.3s ease,
    opacity 0.2s ease;
  background: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%);

  &:hover {
    opacity: 0.8;
    box-shadow: 0 0 7px
      color-mix(in srgb, var(--o2-primary-btn-bg), transparent 10%);
  }
}

.body--light .actions-section .action-btn {
  border-color: #e0e0e0;
  color: #333;
  background: #f9f9f9;

  &:hover {
    background: #ffffff;
    border-color: #3b82f6;
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: #0f1419;
  padding: 0.625rem;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: #1a1f2e;
  }

  &::-webkit-scrollbar-thumb {
    background: #242938;
    border-radius: 4px;

    &:hover {
      background: #2d3548;
    }
  }
}

.body--light .panel-content {
  background: #ffffff;

  &::-webkit-scrollbar-track {
    background: #f8f9fa;
  }

  &::-webkit-scrollbar-thumb {
    background: #e0e0e0;

    &:hover {
      background: #d0d0d0;
    }
  }
}

.operation-row {
  transition: background 0.15s ease;

  &:hover {
    background: rgba(99, 102, 241, 0.1);

    .operation-link-icon {
      opacity: 1 !important;
    }
  }

  .operation-link-icon {
    opacity: 0;
    color: var(--o2-text-secondary);
    transition: opacity 0.15s ease;
  }
}

.body--light .operation-row:hover {
  background: rgba(99, 102, 241, 0.07);
}

.panel-section {
  padding: 0;
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .section-header-actions {
    display: flex;
    gap: 6px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: #e4e7eb;
  }
}

.body--light .panel-section .section-title {
  color: #202124;
}

.metrics-section {
  // Full-width card for total requests (single line)
  .metric-card-full {
    padding: 10px 12px;
    border-radius: 8px;
    background: linear-gradient(135deg, #242938 0%, #1f2937 100%);
    border: 1px solid #374151;
    margin-bottom: 12px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    &:hover {
      transform: translateY(-2px);
      box-shadow:
        0 6px 12px rgba(0, 0, 0, 0.2),
        0 0 0 1px rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.4);
    }

    .metric-single-line {
      display: flex;
      align-items: center;
      gap: 12px;

      .metric-total {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 6px;
        background: linear-gradient(
          135deg,
          rgba(99, 102, 241, 0.08),
          rgba(99, 102, 241, 0.02)
        );
        border: 1px solid rgba(99, 102, 241, 0.15);

        .total-label {
          font-size: 12px;
          font-weight: 600;
          color: #a5b4fc;
        }

        .total-value {
          font-size: 16px;
          font-weight: 800;
          color: #e0e7ff;
          letter-spacing: -0.02em;
        }

        .total-unit {
          font-size: 10px;
          font-weight: 500;
          color: #a5b4fc;
        }
      }

      .metric-divider {
        width: 1px;
        height: 20px;
        background: #374151;
      }

      .metric-inline {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s ease;
        flex: 1;

        &.incoming {
          color: #a5b4fc;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.1),
            rgba(99, 102, 241, 0.02)
          );
          border: 1px solid rgba(99, 102, 241, 0.15);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.15),
              rgba(99, 102, 241, 0.05)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.2);
          }
        }

        &.outgoing {
          color: #a5b4fc;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.1),
            rgba(99, 102, 241, 0.02)
          );
          border: 1px solid rgba(99, 102, 241, 0.15);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.15),
              rgba(99, 102, 241, 0.05)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.2);
          }
        }

        .inline-value {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
      }
    }

    // Horizontal divider between top and bottom rows
    .metric-horizontal-divider {
      width: 100%;
      height: 1px;
      background: #374151;
      margin: 10px 0 8px 0;
    }

    // Bottom row for error rate and p95 latency
    .metric-bottom-row {
      display: flex;
      align-items: center;
      gap: 8px;

      .metric-inline-item {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-radius: 4px;
        transition: all 0.2s ease;

        // Status-based styling
        &.status-healthy {
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.08),
            rgba(16, 185, 129, 0.02)
          );
          border: 1px solid rgba(16, 185, 129, 0.15);

          .q-icon {
            color: #10b981;
          }

          .metric-value {
            color: #10b981;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(16, 185, 129, 0.12),
              rgba(16, 185, 129, 0.04)
            );
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.15);
          }
        }

        &.status-warning {
          background: linear-gradient(
            135deg,
            rgba(251, 191, 36, 0.08),
            rgba(251, 191, 36, 0.02)
          );
          border: 1px solid rgba(251, 191, 36, 0.15);

          .q-icon {
            color: #fbbf24;
          }

          .metric-value {
            color: #fbbf24;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(251, 191, 36, 0.12),
              rgba(251, 191, 36, 0.04)
            );
            box-shadow: 0 0 6px rgba(251, 191, 36, 0.15);
          }
        }

        &.status-critical {
          background: linear-gradient(
            135deg,
            rgba(239, 68, 68, 0.08),
            rgba(239, 68, 68, 0.02)
          );
          border: 1px solid rgba(239, 68, 68, 0.15);

          .q-icon {
            color: #ef4444;
          }

          .metric-value {
            color: #ef4444;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(239, 68, 68, 0.12),
              rgba(239, 68, 68, 0.04)
            );
            box-shadow: 0 0 6px rgba(239, 68, 68, 0.15);
          }
        }

        &.status-unknown {
          background: linear-gradient(
            135deg,
            rgba(107, 114, 128, 0.08),
            rgba(107, 114, 128, 0.02)
          );
          border: 1px solid rgba(107, 114, 128, 0.15);

          .q-icon {
            color: #6b7280;
          }

          .metric-value {
            color: #9ca3af;
          }
        }

        .metric-label {
          font-size: 11px;
          font-weight: 600;
          color: #9ca3af;
          white-space: nowrap;
        }

        .metric-value {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
      }

      .metric-row-divider {
        width: 1px;
        height: 20px;
        background: #374151;
      }
    }
  }
}

.body--light .metrics-section {
  .metric-card-full {
    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
    border-color: #d1d5db;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    &:hover {
      box-shadow:
        0 6px 12px rgba(0, 0, 0, 0.08),
        0 0 0 1px rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .metric-single-line {
      .metric-total {
        background: linear-gradient(
          135deg,
          rgba(99, 102, 241, 0.08),
          rgba(99, 102, 241, 0.03)
        );
        border-color: rgba(99, 102, 241, 0.2);

        .total-label {
          color: #6366f1;
        }

        .total-value {
          color: #4338ca;
        }

        .total-unit {
          color: #6366f1;
        }
      }

      .metric-divider {
        background: #d1d5db;
      }

      .metric-inline {
        &.incoming {
          color: #6366f1;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.08),
            rgba(99, 102, 241, 0.02)
          );
          border-color: rgba(99, 102, 241, 0.2);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.12),
              rgba(99, 102, 241, 0.04)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.15);
          }
        }

        &.outgoing {
          color: #6366f1;
          background: linear-gradient(
            135deg,
            rgba(99, 102, 241, 0.08),
            rgba(99, 102, 241, 0.02)
          );
          border-color: rgba(99, 102, 241, 0.2);

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(99, 102, 241, 0.12),
              rgba(99, 102, 241, 0.04)
            );
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.15);
          }
        }
      }
    }

    .metric-horizontal-divider {
      background: #d1d5db;
    }

    .metric-bottom-row {
      .metric-inline-item {
        &.status-healthy {
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.06),
            rgba(16, 185, 129, 0.01)
          );
          border-color: rgba(16, 185, 129, 0.2);

          .q-icon {
            color: #059669;
          }

          .metric-value {
            color: #059669;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(16, 185, 129, 0.1),
              rgba(16, 185, 129, 0.03)
            );
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.12);
          }
        }

        &.status-warning {
          background: linear-gradient(
            135deg,
            rgba(217, 119, 6, 0.06),
            rgba(217, 119, 6, 0.01)
          );
          border-color: rgba(217, 119, 6, 0.2);

          .q-icon {
            color: #d97706;
          }

          .metric-value {
            color: #d97706;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(217, 119, 6, 0.1),
              rgba(217, 119, 6, 0.03)
            );
            box-shadow: 0 0 6px rgba(217, 119, 6, 0.12);
          }
        }

        &.status-critical {
          background: linear-gradient(
            135deg,
            rgba(220, 38, 38, 0.06),
            rgba(220, 38, 38, 0.01)
          );
          border-color: rgba(220, 38, 38, 0.2);

          .q-icon {
            color: #dc2626;
          }

          .metric-value {
            color: #dc2626;
          }

          &:hover {
            background: linear-gradient(
              135deg,
              rgba(220, 38, 38, 0.1),
              rgba(220, 38, 38, 0.03)
            );
            box-shadow: 0 0 6px rgba(220, 38, 38, 0.12);
          }
        }

        &.status-unknown {
          background: linear-gradient(
            135deg,
            rgba(107, 114, 128, 0.06),
            rgba(107, 114, 128, 0.01)
          );
          border-color: rgba(107, 114, 128, 0.2);

          .q-icon {
            color: #6b7280;
          }

          .metric-value {
            color: #6b7280;
          }
        }

        .metric-label {
          color: rgba(0, 0, 0, 0.6);
        }
      }

      .metric-row-divider {
        background: #d1d5db;
      }
    }
  }
}

// Empty/Loading/Error States
.empty-state,
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.5rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.875rem;

  .loading-text,
  .error-text {
    margin-top: 0.75rem;
    font-weight: 400;
  }
}

.body--light {
  .empty-state,
  .loading-state,
  .error-state {
    color: rgba(0, 0, 0, 0.5);
  }
}

.error-state {
  color: #f44336;
  font-weight: 500;
}

.body--light .error-state {
  color: #c62828;
}

.error-state {
  color: var(--q-negative);
}

.red-charts-section {
  :deep(.card-container) {
    box-shadow: none;

    :first-child {
      padding: 0 0.0625rem !important;
    }
  }
}
</style>

<style lang="scss">
// Dark mode - consistent background
.body--dark {
  .service-graph-side-panel {
    background: #1a1f2e; // Consistent panel background
    color: #e4e7eb;
    border-left: 1px solid rgba(255, 255, 255, 0.08);

    .metric-card {
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

// Light mode
.body--light {
  .service-graph-side-panel {
    background: #ffffff;
    color: #333333;
    border-left: 1px solid #e0e0e0;

    .metric-card {
      background: #f9f9f9;
    }
  }
}
</style>
