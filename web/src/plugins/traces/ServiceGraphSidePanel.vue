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

      <!-- Content Scrollable Area -->
      <div class="panel-content">
        <!-- Action Buttons Section -->
        <div class="panel-section actions-section">
          <q-btn
          v-if="false"
            outline
            no-caps
            size="sm"
            label="📋 View Logs"
            @click="handleViewLogs"
            data-test="service-graph-side-panel-view-logs-btn"
            class="action-btn"
            :disable="true"
          >
            <q-tooltip>
              View Logs is currently disabled
            </q-tooltip>
          </q-btn>
          <q-btn
            outline
            no-caps
            size="sm"
            label="🔍 View Traces"
            @click="handleViewTraces"
            data-test="service-graph-side-panel-view-traces-btn"
            class="action-btn"
            :disable="isAllStreamsSelected"
          >
            <q-tooltip v-if="isAllStreamsSelected">
              Please select a specific stream to view traces
            </q-tooltip>
          </q-btn>
        </div>

        <!-- Metrics Section -->
        <div
          class="panel-section metrics-section"
          data-test="service-graph-side-panel-metrics"
        >
          <div class="section-title">Metrics</div>

          <!-- Request Rate Card (Full Width) -->
          <div class="metric-card metric-card-full" data-test="service-graph-side-panel-request-rate">
            <div class="metric-header">
              <span class="metric-label">Total Requests:</span>
              <span class="metric-value-large">
                {{ serviceMetrics.requestRateValue }}
                <span class="metric-unit">req/min</span>
              </span>
            </div>
            <div class="metric-breakdown">
              <div class="breakdown-item breakdown-incoming">
                <div class="breakdown-icon-wrapper incoming">
                  <q-icon name="arrow_downward" size="16px" />
                </div>
                <div class="breakdown-content">
                  <span class="breakdown-label">Incoming</span>
                  <span class="breakdown-value">{{ formatNumber(serviceMetrics.incomingRequests) }}</span>
                </div>
              </div>
              <div class="breakdown-item breakdown-outgoing">
                <div class="breakdown-icon-wrapper outgoing">
                  <q-icon name="arrow_upward" size="16px" />
                </div>
                <div class="breakdown-content">
                  <span class="breakdown-label">Outgoing</span>
                  <span class="breakdown-value">{{ formatNumber(serviceMetrics.outgoingRequests) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Error Rate and P95 Latency (Two Columns) -->
          <div class="metrics-grid-bottom">
            <div class="metric-card" data-test="service-graph-side-panel-error-rate">
              <div class="metric-label">Error Rate</div>
              <div class="metric-value">{{ serviceMetrics.errorRate }}</div>
            </div>
            <div class="metric-card" data-test="service-graph-side-panel-p95-latency">
              <div class="metric-label">P95 Latency</div>
              <div class="metric-value">{{ serviceMetrics.p95Latency }}</div>
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
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, type PropType } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import searchService from '@/services/search';
import { escapeSingleQuotes } from '@/utils/zincutils';

export default defineComponent({
  name: 'ServiceGraphSidePanel',
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
  emits: ['close', 'view-logs', 'view-traces'],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();

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
          p95Latency: 'N/A',
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

      // Calculate P95 latency from incoming edges
      let p95Latency = 0;
      if (incomingEdges.length > 0) {
        p95Latency = Math.max(
          ...incomingEdges.map((edge: any) => edge.p95_latency_ns || 0)
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
        p95Latency: incomingEdges.length > 0 ? formatLatency(p95Latency) : 'N/A',
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

    const handleViewLogs = () => {
      emit('view-logs');
    };

    const handleViewTraces = () => {
      emit('view-traces');
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

    return {
      upstreamServices,
      downstreamServices,
      serviceMetrics,
      serviceHealth,
      isAllStreamsSelected,
      getHealthColor,
      getHealthText,
      formatNumber,
      handleClose,
      handleViewLogs,
      handleViewTraces,
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
  padding: 16px 20px;
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
  margin-bottom: 20px;
  flex-wrap: wrap;

  .action-btn {
    flex: 1;
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
  padding: 20px; 

  
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
  margin-bottom: 24px; 

  &:last-child {
    margin-bottom: 0;
  }

  .section-title {
    font-size: 14px; 
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    margin-bottom: 12px; 
    color: #e4e7eb; 
  }
}

.body--light .panel-section .section-title {
  color: #202124;
}


.metrics-section {
  // Full-width card for total requests
  .metric-card-full {
    padding: 20px;
    border-radius: 12px;
    background: linear-gradient(135deg, #242938 0%, #1f2937 100%);
    border: 1px solid #374151;
    margin-bottom: 16px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    &:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.4);
    }

    .metric-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 6px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.02));
      border: 1px solid rgba(99, 102, 241, 0.15);
    }

    .metric-label {
      font-size: 13px;
      font-weight: 600;
      color: #a5b4fc;
    }

    .metric-value-large {
      font-size: 20px;
      font-weight: 800;
      color: #e0e7ff;
      letter-spacing: -0.02em;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);

      .metric-unit {
        font-size: 12px;
        font-weight: 500;
        color: #a5b4fc;
        margin-left: 4px;
      }
    }

    .metric-breakdown {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid #2d3548;

      .breakdown-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: all 0.2s ease;

        &:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.1);
          transform: translateY(-1px);
        }

        .breakdown-icon-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          flex-shrink: 0;
          transition: all 0.2s ease;

          &.incoming {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05));
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.2);
          }

          &.outgoing {
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05));
            color: #3b82f6;
            border: 1px solid rgba(59, 130, 246, 0.2);
          }
        }

        .breakdown-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;

          .breakdown-label {
            font-size: 10px;
            font-weight: 600;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .breakdown-value {
            font-size: 18px;
            font-weight: 700;
            color: #e4e7eb;
            letter-spacing: -0.01em;
          }
        }

        &.breakdown-incoming:hover .breakdown-icon-wrapper.incoming {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(16, 185, 129, 0.1));
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.3);
        }

        &.breakdown-outgoing:hover .breakdown-icon-wrapper.outgoing {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(59, 130, 246, 0.1));
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.3);
        }
      }
    }
  }

  // Bottom grid for error rate and p95 latency
  .metrics-grid-bottom {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    .metric-card {
      padding: 12px;
      border-radius: 8px;
      text-align: center;
      background: #242938;
      border: 1px solid #2d3548;
      transition: all 0.2s ease;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
      }

      .metric-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: none;
        letter-spacing: 0;
        margin-bottom: 6px;
        color: #9ca3af;
      }

      .metric-value {
        font-size: 20px;
        font-weight: 700;
        color: #e4e7eb;
        letter-spacing: -0.01em;
        white-space: nowrap;

        &.green { color: #10b981; }
        &.yellow { color: #fbbf24; }
        &.orange { color: #f97316; }
        &.red { color: #ef4444; }

        .metric-unit {
          font-size: 11px;
          font-weight: 500;
          color: #9ca3af;
          margin-left: 4px;
        }
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
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .metric-header {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.03));
      border-color: rgba(99, 102, 241, 0.2);

      .metric-label {
        color: #6366f1;
      }

      .metric-value-large {
        color: #4338ca;

        .metric-unit {
          color: #6366f1;
        }
      }
    }

    .metric-breakdown {
      border-top-color: #e0e0e0;

      .breakdown-item {
        background: rgba(0, 0, 0, 0.02);
        border-color: rgba(0, 0, 0, 0.08);

        &:hover {
          background: rgba(0, 0, 0, 0.04);
          border-color: rgba(0, 0, 0, 0.12);
        }

        .breakdown-icon-wrapper {
          &.incoming {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.04));
            color: #059669;
            border-color: rgba(16, 185, 129, 0.25);
          }

          &.outgoing {
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.04));
            color: #2563eb;
            border-color: rgba(59, 130, 246, 0.25);
          }
        }

        .breakdown-content {
          .breakdown-label {
            color: rgba(0, 0, 0, 0.6);
          }

          .breakdown-value {
            color: #202124;
          }
        }

        &.breakdown-incoming:hover .breakdown-icon-wrapper.incoming {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.08));
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
        }

        &.breakdown-outgoing:hover .breakdown-icon-wrapper.outgoing {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.08));
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.25);
        }
      }
    }
  }

  .metrics-grid-bottom .metric-card {
    background: #ffffff;
    border-color: #e0e0e0;

    &:hover {
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    .metric-label {
      color: rgba(0, 0, 0, 0.6);
    }

    .metric-value {
      color: #202124;

      &.green { color: #059669; }
      &.yellow { color: #d97706; }
      &.orange { color: #ea580c; }
      &.red { color: #dc2626; }

      .metric-unit {
        color: rgba(0, 0, 0, 0.6);
      }
    }
  }
}


.services-section {
  .service-list {
    display: flex;
    flex-direction: column;
    gap: 8px; 

    .service-list-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px; 
      border-radius: 6px;
      background: #242938; 
      border: 1px solid #2d3548; 
      transition: all 0.2s ease;
      cursor: pointer;

      &:hover {
        background: #1a1f2e; 
        border-color: #3b82f6; 
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
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        flex-shrink: 0;

        &::before {
          content: '●';
          font-size: 12px;
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
  .service-list .service-list-item {
    background: #ffffff;
    border-color: #e0e0e0;

    &:hover {
      background: #f8f9fa;
      border-color: #3b82f6;
    }

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
