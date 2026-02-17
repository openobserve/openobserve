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
        class="panel-header"
        data-test="service-graph-side-panel-header"
      >
        <div class="panel-title">
          <h2 class="service-name" data-test="service-graph-side-panel-service-name">
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
        <!-- Metrics Section -->
        <div
          class="panel-section metrics-section"
          data-test="service-graph-side-panel-metrics"
        >

          <!-- Request Rate Card (Full Width - Combined Metrics) -->
          <div class="metric-card metric-card-full" data-test="service-graph-side-panel-request-rate">
            <div class="metric-single-line">
              <div class="metric-total">
                <span class="total-label">Requests:</span>
                <span class="total-value">{{ serviceMetrics.requestRateValue }}</span>
                <span class="total-unit">/min</span>
              </div>
              <div class="metric-divider"></div>
              <div class="metric-inline incoming">
                <q-icon name="arrow_forward" size="12px" />
                <span class="inline-value">{{ formatNumber(serviceMetrics.incomingRequests) }}</span>
                <q-tooltip>Incoming Requests (requests coming into this service)</q-tooltip>
              </div>
              <div class="metric-divider"></div>
              <div class="metric-inline outgoing">
                <span class="inline-value">{{ formatNumber(serviceMetrics.outgoingRequests) }}</span>
                <q-icon name="arrow_forward" size="12px" />
                <q-tooltip>Outgoing Requests (requests going out from this service)</q-tooltip>
              </div>
            </div>

            <!-- Horizontal Divider -->
            <div class="metric-horizontal-divider"></div>

            <!-- Error Rate and Latency Percentiles (Bottom Rows) -->
            <div class="metric-bottom-row">
              <div class="metric-inline-item error-rate-card" :class="getErrorRateClass()" data-test="service-graph-side-panel-error-rate">
                <q-icon name="error_outline" size="14px" />
                <span class="metric-label">Error Rate:</span>
                <span class="metric-value">{{ serviceMetrics.errorRate }}</span>
              </div>
              <div class="metric-row-divider"></div>
              <div class="metric-inline-item latency-card" :class="getLatencyClass(serviceMetrics.p95Latency)" data-test="service-graph-side-panel-p95-latency">
                <q-icon name="speed" size="14px" />
                <span class="metric-label">P95 Latency:</span>
                <span class="metric-value">{{ serviceMetrics.p95Latency }}</span>
              </div>
            </div>
            <div class="metric-horizontal-divider"></div>
            <div class="metric-bottom-row">
              <div class="metric-inline-item latency-card" :class="getLatencyClass(serviceMetrics.p50Latency)" data-test="service-graph-side-panel-p50-latency">
                <q-icon name="speed" size="14px" />
                <span class="metric-label">P50:</span>
                <span class="metric-value">{{ serviceMetrics.p50Latency }}</span>
              </div>
              <div class="metric-row-divider"></div>
              <div class="metric-inline-item latency-card" :class="getLatencyClass(serviceMetrics.p99Latency)" data-test="service-graph-side-panel-p99-latency">
                <q-icon name="speed" size="14px" />
                <span class="metric-label">P99:</span>
                <span class="metric-value">{{ serviceMetrics.p99Latency }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Upstream Services Section -->
        <div
          class="panel-section services-section"
          data-test="service-graph-side-panel-upstream-services"
        >
          <div class="section-title">
            Upstream Services ({{ upstreamServices.length }})
          </div>
          <div v-if="upstreamServices.length === 0" class="empty-state">
            No upstream dependencies
          </div>
          <div v-else class="service-list">
            <div
              v-for="service in upstreamServices"
              :key="service.id"
              class="service-list-item"
              data-test="service-graph-side-panel-upstream-service-item"
            >
              <div class="service-item-name">{{ service.name }}</div>
              <div class="service-item-health" :class="service.healthStatus">
                {{ getHealthText(service.healthStatus) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Downstream Services Section -->
        <div
          class="panel-section services-section"
          data-test="service-graph-side-panel-downstream-services"
        >
          <div class="section-title">
            Downstream Services ({{ downstreamServices.length }})
          </div>
          <div v-if="downstreamServices.length === 0" class="empty-state">
            No downstream services
          </div>
          <div v-else class="service-list">
            <div
              v-for="service in downstreamServices"
              :key="service.id"
              class="service-list-item"
              data-test="service-graph-side-panel-downstream-service-item"
            >
              <div class="service-item-name">{{ service.name }}</div>
              <div class="service-item-health" :class="service.healthStatus">
                {{ getHealthText(service.healthStatus) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Traces Section -->
        <div
          v-if="streamFilter !== 'all'"
          class="panel-section traces-section"
          data-test="service-graph-side-panel-recent-traces"
        >
          <div class="section-title">Recent Traces ({{ recentTraces.length }})</div>

          <!-- Loading State -->
          <div v-if="loadingTraces" class="loading-state">
            <q-spinner color="primary" size="sm" />
            <span>Loading traces...</span>
          </div>

          <!-- Empty State -->
          <div v-else-if="recentTraces.length === 0" class="empty-state">
            No traces found
          </div>

          <!-- Traces List -->
          <div v-else class="traces-list">
            <div
              v-for="trace in recentTraces"
              :key="trace.traceId"
              class="trace-item"
              data-test="service-graph-side-panel-trace-item"
            >
              <div class="trace-header">
                <div class="trace-id-container">
                  <div
                    class="trace-id"
                    @click="handleTraceClick(trace)"
                  >
                    {{ trace.traceIdShort }}
                    <q-tooltip class="bg-dark" anchor="top middle" self="bottom middle">
                      {{ trace.traceId }}
                      <br />
                      <span style="font-size: 10px; opacity: 0.8;">Click to view full trace</span>
                    </q-tooltip>
                  </div>
                  <q-btn
                    flat
                    dense
                    round
                    size="xs"
                    :icon="copiedTraceId === trace.traceId ? 'check' : 'content_copy'"
                    :color="copiedTraceId === trace.traceId ? 'positive' : undefined"
                    class="copy-trace-btn"
                    @click.stop="copyTraceId(trace.traceId)"
                    data-test="service-graph-side-panel-copy-trace-btn"
                  >
                    <q-tooltip class="bg-dark">
                      {{ copiedTraceId === trace.traceId ? 'Copied!' : 'Copy trace ID' }}
                    </q-tooltip>
                  </q-btn>
                </div>
                <div class="trace-status" :class="trace.statusClass">
                  <q-icon :name="trace.statusIcon" size="xs" />
                  {{ trace.status }}
                </div>
              </div>
              <div class="trace-details">
                <div class="trace-duration" :class="trace.durationClass">
                  <q-icon name="schedule" size="xs" />
                  {{ trace.duration }}
                </div>
                <div class="trace-spans">
                  <q-icon name="account_tree" size="xs" />
                  {{ trace.spanCount }} spans
                </div>
                <div class="trace-time">
                  {{ trace.timestamp }}
                </div>
              </div>
            </div>
          </div>
        </div>
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
import { defineComponent, computed, ref, watch, defineAsyncComponent, type PropType } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import searchService from '@/services/search';
import { getGroupedServices, correlate as correlateStreams } from '@/services/service_streams';
import { escapeSingleQuotes } from '@/utils/zincutils';

const TelemetryCorrelationDashboard = defineAsyncComponent(
  () => import('@/plugins/correlation/TelemetryCorrelationDashboard.vue')
);

export default defineComponent({
  name: 'ServiceGraphSidePanel',
  components: {
    TelemetryCorrelationDashboard,
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
  emits: ['close'],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();

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
        const serviceName = props.selectedNode.name
          || props.selectedNode.label
          || props.selectedNode.id;

        // Step 1: Find the service's FQN from _grouped
        const groupedResponse = await getGroupedServices(org);
        const groups = groupedResponse.data?.groups || [];

        let fqn = '';
        for (const group of groups) {
          if (group.services.some((s: any) => s.service_name === serviceName)) {
            fqn = group.fqn;
            break;
          }
        }

        if (!fqn) {
          correlationError.value = 'Service not found in service registry.';
          correlationData.value = null;
          return;
        }

        // Step 2: Send FQN to _correlate — it resolves field names per stream
        const correlateResponse = await correlateStreams(org, {
          source_stream: props.streamFilter || 'default',
          source_type: 'traces',
          available_dimensions: { 'service-fqn': fqn },
        });

        const data = correlateResponse.data;
        if (!data) {
          correlationError.value = 'No correlated streams found.';
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
          correlationError.value = 'Service Discovery is an enterprise feature.';
        } else {
          correlationError.value = err.message || 'Failed to load service streams.';
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
      }
    );

    // Recent Traces State
    const recentTraces = ref<any[]>([]);
    const loadingTraces = ref(false);
    const copiedTraceId = ref<string | null>(null);
    // Computed: Upstream Services
    const upstreamServices = computed(() => {
      if (!props.selectedNode || !props.graphData) return [];

      return props.graphData.edges
        .filter((edge: any) => edge.to === props.selectedNode.id)
        .map((edge: any) => {
          const sourceNode = props.graphData.nodes.find(
            (n: any) => n.id === edge.from
          );
          return {
            id: edge.from,
            name: sourceNode?.label || edge.from,
            errorRate: edge.error_rate || 0,
            requests: edge.total_requests || 0,
            healthStatus: getHealthStatus(edge.error_rate || 0),
          };
        });
    });

    // Computed: Downstream Services
    const downstreamServices = computed(() => {
      if (!props.selectedNode || !props.graphData) return [];

      return props.graphData.edges
        .filter((edge: any) => edge.from === props.selectedNode.id)
        .map((edge: any) => {
          const targetNode = props.graphData.nodes.find(
            (n: any) => n.id === edge.to
          );
          return {
            id: edge.to,
            name: targetNode?.label || edge.to,
            errorRate: edge.error_rate || 0,
            requests: edge.total_requests || 0,
            healthStatus: getHealthStatus(edge.error_rate || 0),
          };
        });
    });

    // Computed: Service Metrics
    const serviceMetrics = computed(() => {
      if (!props.selectedNode || !props.graphData) {
        return {
          requestRate: 'N/A',
          requestRateValue: 'N/A',
          totalRequests: 0,
          incomingRequests: 0,
          outgoingRequests: 0,
          errorRate: 'N/A',
          p50Latency: 'N/A',
          p95Latency: 'N/A',
          p99Latency: 'N/A',
        };
      }

      // Get total request count - handle both graph view (uses 'value') and tree view (uses 'requests')
      const totalRequests = props.selectedNode.value || props.selectedNode.requests || 0;

      // Calculate incoming requests (sum of all edges TO this node)
      const incomingEdges = props.graphData.edges.filter(
        (edge: any) => edge.to === props.selectedNode.id
      );
      const incomingRequests = incomingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0
      );

      // Calculate outgoing requests (sum of all edges FROM this node)
      const outgoingEdges = props.graphData.edges.filter(
        (edge: any) => edge.from === props.selectedNode.id
      );
      const outgoingRequests = outgoingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests || 0),
        0
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
          ...incomingEdges.map((edge: any) => edge.p50_latency_ns || 0)
        );
        p95Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p95_latency_ns || 0)
        );
        p99Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p99_latency_ns || 0)
        );
      }

      // Format request rate value without unit
      let requestRateValue = '';
      if (totalRequests >= 1000000) {
        requestRateValue = (totalRequests / 1000000).toFixed(1) + 'M';
      } else if (totalRequests >= 1000) {
        requestRateValue = (totalRequests / 1000).toFixed(1) + 'K';
      } else {
        requestRateValue = totalRequests.toString();
      }

      return {
        requestRate: formatRequestRate(totalRequests),
        requestRateValue: requestRateValue,
        totalRequests: totalRequests,
        incomingRequests: incomingRequests,
        outgoingRequests: outgoingRequests,
        errorRate: errorRate.toFixed(2) + '%',
        p50Latency: incomingEdges.length > 0 ? formatLatency(p50Latency) : 'N/A',
        p95Latency: incomingEdges.length > 0 ? formatLatency(p95Latency) : 'N/A',
        p99Latency: incomingEdges.length > 0 ? formatLatency(p99Latency) : 'N/A',
      };
    });

    // Computed: Service Health
    const serviceHealth = computed(() => {
      if (!props.selectedNode) {
        return {
          status: 'unknown',
          text: 'Unknown',
          color: 'grey',
          icon: 'help',
        };
      }

      // Use node's own error_rate directly
      const errorRate = props.selectedNode.error_rate || 0;

      if (errorRate > 10) {
        return {
          status: 'critical',
          text: 'Critical',
          color: 'negative',
          icon: 'error',
        };
      } else if (errorRate > 5) {
        return {
          status: 'degraded',
          text: 'Degraded',
          color: 'warning',
          icon: 'warning',
        };
      } else {
        return {
          status: 'healthy',
          text: 'Healthy',
          color: 'positive',
          icon: 'check_circle',
        };
      }
    });

    // Computed: Check if "All Streams" is selected
    const isAllStreamsSelected = computed(() => {
      return props.streamFilter === 'all';
    });

    // Helper: Get Health Status
    const getHealthStatus = (errorRate: number): 'healthy' | 'degraded' | 'critical' => {
      if (errorRate > 10) return 'critical';
      if (errorRate > 5) return 'degraded';
      return 'healthy';
    };

    // Helper: Get Health Color
    const getHealthColor = (status: string): string => {
      switch (status) {
        case 'healthy':
          return 'positive';
        case 'degraded':
          return 'warning';
        case 'critical':
          return 'negative';
        default:
          return 'grey';
      }
    };

    // Helper: Get Health Text
    const getHealthText = (status: string): string => {
      switch (status) {
        case 'healthy':
          return 'Healthy';
        case 'degraded':
          return 'Degraded';
        case 'critical':
          return 'Critical';
        default:
          return 'Unknown';
      }
    };

    // Helper: Format Request Rate (with unit)
    const formatRequestRate = (requests: number): string => {
      if (requests >= 1000000) {
        return (requests / 1000000).toFixed(1) + 'M req/min';
      }
      if (requests >= 1000) {
        return (requests / 1000).toFixed(1) + 'K req/min';
      }
      return requests + ' req/min';
    };

    // Helper: Format Number (without unit)
    const formatNumber = (num: number): string => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
      }
      return num.toString();
    };

    // Helper: Format Latency
    const formatLatency = (nanoseconds: number): string => {
      if (!nanoseconds || nanoseconds === 0) return 'N/A';
      const milliseconds = nanoseconds / 1000000;
      if (milliseconds >= 1000) {
        return (milliseconds / 1000).toFixed(2) + 's';
      }
      return milliseconds.toFixed(0) + 'ms';
    };

    // Helper: Format Trace Duration (from microseconds)
    const formatTraceDuration = (microseconds: number): string => {
      if (!microseconds || microseconds === 0) return '0ms';
      if (microseconds < 1000) return `${microseconds.toFixed(0)}μs`;
      const milliseconds = microseconds / 1000;
      if (milliseconds < 1000) return `${milliseconds.toFixed(1)}ms`;
      return `${(milliseconds / 1000).toFixed(2)}s`;
    };

    // Helper: Format Trace Timestamp (from nanoseconds)
    const formatTraceTimestamp = (nanoseconds: number): string => {
      const date = new Date(nanoseconds / 1000000); // Convert to milliseconds
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    };

    // Helper: Shorten Trace ID for display
    const shortenTraceId = (traceId: string): string => {
      return traceId.substring(0, 8) + '...' + traceId.substring(traceId.length - 4);
    };

    // Build filter for trace query
    const buildTraceFilter = (): string => {
      if (!props.selectedNode) return '';
      const serviceName = props.selectedNode.name || props.selectedNode.label || props.selectedNode.id;
      const escapedServiceName = escapeSingleQuotes(serviceName);
      return `service_name = '${escapedServiceName}'`;
    };

    // Fetch Recent Traces
    const fetchRecentTraces = async () => {
      if (!props.selectedNode || !props.visible || props.streamFilter === 'all') return;

      loadingTraces.value = true;
      recentTraces.value = [];

      try {
        const response = await searchService.get_traces({
          org_identifier: store.state.selectedOrganization.identifier,
          stream_name: props.streamFilter || 'default',
          filter: buildTraceFilter(),
          start_time: props.timeRange.startTime,
          end_time: props.timeRange.endTime,
          from: 0,
          size: 10
        });

        if (response.data && response.data.hits) {
          recentTraces.value = response.data.hits.map((trace: any) => {
            const hasErrors = trace.spans && trace.spans[1] > 0;
            const status = hasErrors ? 'ERROR' : 'OK';
            const duration = trace.duration || 0;

            // Determine if slow based on duration (> 1 second = 1,000,000 microseconds)
            const isSlow = duration > 1000000;

            return {
              traceId: trace.trace_id,
              traceIdShort: shortenTraceId(trace.trace_id),
              duration: formatTraceDuration(duration),
              durationMicroseconds: duration,
              status: status,
              statusClass: hasErrors ? 'status-error' : 'status-ok',
              statusIcon: hasErrors ? 'error' : 'check_circle',
              timestamp: formatTraceTimestamp(trace.start_time),
              spanCount: trace.spans ? trace.spans[0] : 0,
              errorCount: trace.spans ? trace.spans[1] : 0,
              durationClass: isSlow ? 'duration-slow' : '',
              rawTrace: trace
            };
          });
        }
      } catch (error) {
        console.error('Failed to fetch recent traces:', error);
        recentTraces.value = [];
      } finally {
        loadingTraces.value = false;
      }
    };

    // Watch for panel visibility, selected node, and stream filter changes
    watch(
      () => [props.visible, props.selectedNode?.id, props.streamFilter],
      () => {
        if (props.visible && props.selectedNode && props.streamFilter !== 'all') {
          fetchRecentTraces();
        }
      },
      { immediate: true }
    );

    // Handlers
    const handleClose = () => {
      emit('close');
    };

    const handleShowTelemetry = async () => {
      await fetchCorrelatedStreams();
      if (correlationData.value) {
        showTelemetryDialog.value = true;
      } else if (correlationError.value) {
        $q.notify({
          type: 'warning',
          message: correlationError.value,
          timeout: 3000,
          position: 'bottom',
        });
      }
    };

    const handleNavigateToDashboard = () => {
      emit('navigate-to-dashboard');
    };

    const handleTraceClick = (trace: any) => {
      // Navigate to trace detail view
      router.push({
        name: 'traceDetails',
        query: {
          trace_id: trace.traceId,
          stream: props.streamFilter || 'default',
          org_identifier: store.state.selectedOrganization.identifier,
          from: props.timeRange.startTime,
          to: props.timeRange.endTime,
        }
      });
    };

    const copyTraceId = async (traceId: string) => {
      try {
        await navigator.clipboard.writeText(traceId);

        // Set copied state to show checkmark
        copiedTraceId.value = traceId;

        // Show success notification at bottom
        $q.notify({
          type: 'positive',
          message: 'Trace ID copied to clipboard',
          timeout: 2000,
          position: 'bottom',
        });

        // Reset checkmark back to copy icon after 2 seconds
        setTimeout(() => {
          copiedTraceId.value = null;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy trace ID:', error);
        $q.notify({
          type: 'negative',
          message: 'Failed to copy trace ID',
          timeout: 2000,
          position: 'bottom',
        });
      }
    };

    // Get color class for error rate card
    const getErrorRateClass = (): string => {
      const errorRateStr = serviceMetrics.value.errorRate;
      if (errorRateStr === 'N/A') return 'status-unknown';

      const errorRate = parseFloat(errorRateStr);
      if (errorRate < 1) return 'status-healthy';
      if (errorRate < 5) return 'status-warning';
      return 'status-critical';
    };

    // Get color class for latency card
    const getLatencyClass = (latencyStr: string): string => {
      if (latencyStr === 'N/A') return 'status-unknown';

      // Parse latency value (could be "125ms" or "1.5s")
      let latencyMs = 0;
      if (latencyStr.endsWith('ms')) {
        latencyMs = parseFloat(latencyStr);
      } else if (latencyStr.endsWith('s')) {
        latencyMs = parseFloat(latencyStr) * 1000;
      }

      if (latencyMs < 100) return 'status-healthy';
      if (latencyMs < 500) return 'status-warning';
      return 'status-critical';
    };

    return {
      upstreamServices,
      downstreamServices,
      serviceMetrics,
      serviceHealth,
      isAllStreamsSelected,
      getHealthColor,
      getHealthText,
      formatNumber,
      getErrorRateClass,
      getLatencyClass,
      handleClose,
      handleShowTelemetry,
      // Telemetry Correlation
      showTelemetryDialog,
      correlationLoading,
      correlationData,
      telemetryTimeRange,
      // Recent Traces
      recentTraces,
      loadingTraces,
      copiedTraceId,
      handleTraceClick,
      copyTraceId,
    };
  },
});
</script>

<style scoped lang="scss">
.service-graph-side-panel {
  position: absolute;
  right: 0;
  top: 0;
  width: 420px; 
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
  padding: 12px 16px;
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
          content: '●';
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
  transition: box-shadow 0.3s ease, opacity 0.2s ease;
  background: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%);

  &:hover {
    opacity: 0.8;
    box-shadow: 0 0 7px color-mix(in srgb, var(--o2-primary-btn-bg), transparent 10%);
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
  padding: 0px 12px 8px 12px; 

  
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
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(99, 102, 241, 0.3);
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
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.02));
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
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.02));
          border: 1px solid rgba(99, 102, 241, 0.15);

          &:hover {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(99, 102, 241, 0.05));
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.2);
          }
        }

        &.outgoing {
          color: #a5b4fc;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.02));
          border: 1px solid rgba(99, 102, 241, 0.15);

          &:hover {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(99, 102, 241, 0.05));
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
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.02));
          border: 1px solid rgba(16, 185, 129, 0.15);

          .q-icon {
            color: #10b981;
          }

          .metric-value {
            color: #10b981;
          }

          &:hover {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.04));
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.15);
          }
        }

        &.status-warning {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.08), rgba(251, 191, 36, 0.02));
          border: 1px solid rgba(251, 191, 36, 0.15);

          .q-icon {
            color: #fbbf24;
          }

          .metric-value {
            color: #fbbf24;
          }

          &:hover {
            background: linear-gradient(135deg, rgba(251, 191, 36, 0.12), rgba(251, 191, 36, 0.04));
            box-shadow: 0 0 6px rgba(251, 191, 36, 0.15);
          }
        }

        &.status-critical {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.02));
          border: 1px solid rgba(239, 68, 68, 0.15);

          .q-icon {
            color: #ef4444;
          }

          .metric-value {
            color: #ef4444;
          }

          &:hover {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.04));
            box-shadow: 0 0 6px rgba(239, 68, 68, 0.15);
          }
        }

        &.status-unknown {
          background: linear-gradient(135deg, rgba(107, 114, 128, 0.08), rgba(107, 114, 128, 0.02));
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
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .metric-single-line {
      .metric-total {
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.03));
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
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.02));
          border-color: rgba(99, 102, 241, 0.2);

          &:hover {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.04));
            box-shadow: 0 0 8px rgba(99, 102, 241, 0.15);
          }
        }

        &.outgoing {
          color: #6366f1;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.02));
          border-color: rgba(99, 102, 241, 0.2);

          &:hover {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.04));
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
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.01));
          border-color: rgba(16, 185, 129, 0.2);

          .q-icon {
            color: #059669;
          }

          .metric-value {
            color: #059669;
          }

          &:hover {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.03));
            box-shadow: 0 0 6px rgba(16, 185, 129, 0.12);
          }
        }

        &.status-warning {
          background: linear-gradient(135deg, rgba(217, 119, 6, 0.06), rgba(217, 119, 6, 0.01));
          border-color: rgba(217, 119, 6, 0.2);

          .q-icon {
            color: #d97706;
          }

          .metric-value {
            color: #d97706;
          }

          &:hover {
            background: linear-gradient(135deg, rgba(217, 119, 6, 0.1), rgba(217, 119, 6, 0.03));
            box-shadow: 0 0 6px rgba(217, 119, 6, 0.12);
          }
        }

        &.status-critical {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.06), rgba(220, 38, 38, 0.01));
          border-color: rgba(220, 38, 38, 0.2);

          .q-icon {
            color: #dc2626;
          }

          .metric-value {
            color: #dc2626;
          }

          &:hover {
            background: linear-gradient(135deg, rgba(220, 38, 38, 0.1), rgba(220, 38, 38, 0.03));
            box-shadow: 0 0 6px rgba(220, 38, 38, 0.12);
          }
        }

        &.status-unknown {
          background: linear-gradient(135deg, rgba(107, 114, 128, 0.06), rgba(107, 114, 128, 0.01));
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


.services-section {
  .section-title {
    margin-bottom: 8px;
  }

  .service-list {
    display: flex;
    flex-direction: column;
    padding: 4px 12px;
    border-radius: 6px;
    background: linear-gradient(135deg, #242938 0%, #1f2937 100%);
    border: 1px solid #374151;
    gap: 0;
    max-height: 200px;
    overflow-y: auto;

    &::-webkit-scrollbar {
      width: 4px;
    }

    &::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;

      &:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    }

    .service-list-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #2d3548;

      &:last-child {
        border-bottom: none;
      }

      .service-item-name {
        font-size: 13px;
        font-weight: 500;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #e4e7eb;
      }

      .service-item-health {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        flex-shrink: 0;

        &::before {
          content: '●';
          font-size: 10px;
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

  .empty-state {
    text-align: left;
    padding: 0;
    color: #9ca3af;
    font-size: 13px;
    font-style: normal;
  }
}

.body--light .services-section {
  .service-list {
    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
    border-color: #d1d5db;

    &::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.05);
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.2);

      &:hover {
        background: rgba(0, 0, 0, 0.3);
      }
    }

    .service-list-item {
      border-color: #e5e7eb;

      .service-item-name {
        color: #202124;
      }

      .service-item-health {
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

  .empty-state {
    color: rgba(0, 0, 0, 0.5);
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

// Recent Traces Section
.traces-section {
  .traces-list {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .trace-item {
      padding: 12px;
      border-radius: 6px;
      background: #242938;
      border: 1px solid #2d3548;
      transition: all 0.2s ease;
      cursor: pointer;

      &:hover {
        background: #1a1f2e;
        border-color: #3b82f6;
        transform: translateX(-2px);
      }

      .trace-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;

        .trace-id-container {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
          margin-right: 8px;
          overflow: hidden;

          .trace-id {
            font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
            font-size: 12px;
            font-weight: 600;
            color: #3b82f6;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
            transition: color 0.2s ease;

            &:hover {
              color: #60a5fa;
            }
          }

          .copy-trace-btn {
            flex-shrink: 0;
            color: #9ca3af;
            transition: all 0.2s ease;
            opacity: 0;

            &:hover {
              color: #3b82f6;
              background: rgba(59, 130, 246, 0.1);
            }

            // Always show if it's the checkmark (copied state)
            &.q-btn--unelevated.text-positive {
              opacity: 1;
            }
          }

          &:hover .copy-trace-btn {
            opacity: 1;
          }
        }

        .trace-status {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 10px;

          &.status-ok {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
          }

          &.status-error {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
          }
        }
      }

      .trace-details {
        display: flex;
        gap: 12px;
        font-size: 11px;
        color: #9ca3af;

        > div {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .trace-duration {
          font-weight: 600;
          color: #e4e7eb;

          &.duration-slow {
            color: #f97316;
          }
        }

        .trace-spans {
          color: #9ca3af;
        }

        .trace-time {
          margin-left: auto;
          color: #9ca3af;
        }
      }
    }
  }
}

.body--light .traces-section {
  .traces-list {
    .trace-item {
      background: #ffffff;
      border-color: #e0e0e0;

      &:hover {
        background: #f5f5f5;
        border-color: #3b82f6;
      }

      .trace-header {
        .trace-id-container {
          .trace-id {
            color: #1976d2;

            &:hover {
              color: #42a5f5;
            }
          }

          .copy-trace-btn {
            color: rgba(0, 0, 0, 0.6);

            &:hover {
              color: #1976d2;
              background: rgba(25, 118, 210, 0.08);
            }
          }
        }

        .trace-status {
          &.status-ok {
            background: rgba(46, 125, 50, 0.1);
            color: #2e7d32;
          }

          &.status-error {
            background: rgba(211, 47, 47, 0.1);
            color: #d32f2f;
          }
        }
      }

      .trace-details {
        color: rgba(0, 0, 0, 0.6);

        .trace-duration {
          color: #202124;

          &.duration-slow {
            color: #e65100;
          }
        }
      }
    }
  }
}
</style>

<style lang="scss">
// Dark mode - consistent background
.body--dark {
  .service-graph-side-panel {
    background: #1a1f2e;  // Consistent panel background
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
