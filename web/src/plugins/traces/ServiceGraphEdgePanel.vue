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
      class="service-graph-edge-panel"
      data-test="service-graph-edge-panel"
    >
      <!-- Header Section -->
      <div
        class="panel-header"
        data-test="service-graph-edge-panel-header"
      >
        <div class="edge-title" data-test="service-graph-edge-panel-title">
          <span class="source-service">{{ sourceServiceName }}</span>
          <q-icon name="arrow_forward" size="20px" class="arrow-icon" />
          <span class="target-service">{{ targetServiceName }}</span>
        </div>
        <q-btn
          flat
          dense
          round
          icon="cancel"
          size="sm"
          @click="handleClose"
          data-test="service-graph-edge-panel-close-btn"
          class="close-btn"
        />
      </div>

      <!-- Content Scrollable Area -->
      <div class="panel-content">
        <!-- Request Statistics Section -->
        <div
          class="panel-section stats-section"
          data-test="service-graph-edge-panel-stats"
        >
          <div class="section-title">Request Statistics</div>
          <div class="stats-grid">
            <div class="stat-card" data-test="service-graph-edge-panel-total-requests">
              <div class="stat-label">TOTAL REQUESTS</div>
              <div class="stat-value">{{ edgeStats.totalRequests }}</div>
            </div>
            <div class="stat-card" data-test="service-graph-edge-panel-request-rate">
              <div class="stat-label">REQUEST RATE</div>
              <div class="stat-value">{{ edgeStats.requestRate }}</div>
            </div>
            <div class="stat-card" data-test="service-graph-edge-panel-success-rate">
              <div class="stat-label">SUCCESS RATE</div>
              <div class="stat-value success">{{ edgeStats.successRate }}</div>
            </div>
            <div class="stat-card" data-test="service-graph-edge-panel-error-rate">
              <div class="stat-label">ERROR RATE</div>
              <div class="stat-value" :class="{ error: edgeStats.errorRateValue > 5 }">
                {{ edgeStats.errorRate }}
              </div>
            </div>
          </div>
        </div>

        <!-- Latency Distribution Section -->
        <div
          class="panel-section latency-section"
          data-test="service-graph-edge-panel-latency-distribution"
        >
          <div class="section-title">Latency Distribution</div>

          <!-- Chart -->
          <div class="latency-chart-container">
            <CustomChartRenderer
              v-if="latencyDistribution"
              :data="latencyDistribution"
              class="latency-chart"
            />
          </div>
        </div>

        <!-- Latency Trend Section -->
        <div
          class="panel-section trend-section"
          data-test="service-graph-edge-panel-latency-trend"
        >
          <div class="section-title">Latency Trend</div>
          <div class="latency-chart-container">
            <div v-if="trendLoading" class="trend-loading">
              <q-spinner size="sm" />
            </div>
            <CustomChartRenderer
              v-else-if="latencyTrend"
              :data="latencyTrend"
              class="latency-chart"
              data-test="service-graph-edge-panel-trend-chart"
            />
            <div
              v-else
              class="trend-empty"
              data-test="service-graph-edge-panel-trend-empty"
            >
              No trend data available
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
import CustomChartRenderer from '@/components/dashboards/panels/CustomChartRenderer.vue';
import serviceGraphService from '@/services/service_graph';

export default defineComponent({
  name: 'ServiceGraphEdgePanel',
  components: {
    CustomChartRenderer,
  },
  props: {
    selectedEdge: {
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
  },
  emits: ['close', 'trend-loaded'],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();

    const trendLoading = ref(false);
    const trendData = ref<any>(null);

    // Computed: Source Service Name
    const sourceServiceName = computed(() => {
      if (!props.selectedEdge) return '';
      const sourceNode = props.graphData.nodes.find(
        (n: any) => n.id === props.selectedEdge.from
      );
      return sourceNode?.label || props.selectedEdge.from;
    });

    // Computed: Target Service Name
    const targetServiceName = computed(() => {
      if (!props.selectedEdge) return '';
      const targetNode = props.graphData.nodes.find(
        (n: any) => n.id === props.selectedEdge.to
      );
      return targetNode?.label || props.selectedEdge.to;
    });

    // Computed: Edge Statistics
    const edgeStats = computed(() => {
      if (!props.selectedEdge) {
        return {
          totalRequests: 'N/A',
          requestRate: 'N/A',
          successRate: 'N/A',
          errorRate: 'N/A',
          errorRateValue: 0,
        };
      }

      const totalRequests = props.selectedEdge.total_requests || 0;
      const failedRequests = props.selectedEdge.failed_requests || 0;
      const successRequests = totalRequests - failedRequests;
      const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
      const successRate = totalRequests > 0 ? (successRequests / totalRequests) * 100 : 100;

      return {
        totalRequests: formatNumber(totalRequests),
        requestRate: formatRequestRate(totalRequests),
        successRate: successRate.toFixed(1) + '%',
        errorRate: errorRate.toFixed(2) + '%',
        errorRateValue: errorRate,
      };
    });

    // Computed: Latency Distribution Chart Data
    const latencyDistribution = computed(() => {
      if (!props.selectedEdge) {
        return null;
      }

      const edge = props.selectedEdge;

      // Get latency values from edge data
      const p50Ns = edge.p50_latency_ns || 0;
      const p95Ns = edge.p95_latency_ns || 0;
      const p99Ns = edge.p99_latency_ns || 0;
      const maxNs = p99Ns; // Use P99 as max

      if (p50Ns === 0 && p95Ns === 0 && p99Ns === 0) {
        return {
          chartType: 'custom_chart',
          title: {
            text: 'No latency data available',
            left: 'center',
            top: 'center',
            textStyle: {
              fontSize: 14,
              fontWeight: 'normal',
              color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B',
            },
          },
        };
      }

      // Convert to milliseconds for display
      const p50Ms = p50Ns / 1000000;
      const p95Ms = p95Ns / 1000000;
      const p99Ms = p99Ns / 1000000;
      const maxMs = maxNs / 1000000;

      // Chart data
      const categories = ['P50', 'P95', 'P99', 'Max'];
      const values = [p50Ms, p95Ms, p99Ms, maxMs];
      const colors = ['#4caf50', '#2196f3', '#ff9800', '#f44336'];

      return {
        chartType: 'custom_chart',
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow',
          },
          backgroundColor: store.state.theme === 'dark' ? '#2B2C2D' : '#ffffff',
          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
          textStyle: {
            color: store.state.theme === 'dark' ? '#DCDCDC' : '#232323',
          },
          formatter: (params: any) => {
            const value = params[0].value;
            return `${params[0].name}: ${value >= 1000 ? (value / 1000).toFixed(2) + 's' : value.toFixed(2) + 'ms'}`;
          },
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          top: '10%',
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: categories,
          axisLabel: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B',
            fontSize: 12,
            fontWeight: 600,
          },
          axisLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
            },
          },
          axisTick: {
            show: false,
          },
        },
        yAxis: {
          type: 'value',
          name: 'Latency (ms)',
          nameTextStyle: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B',
            fontSize: 11,
          },
          axisLabel: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B',
            formatter: (value: number) => {
              if (value >= 1000) return (value / 1000).toFixed(1) + 's';
              return value.toFixed(0);
            },
          },
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          splitLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#3A3A3A' : '#F0F0F0',
            },
          },
        },
        series: [
          {
            type: 'bar',
            data: values.map((value, index) => ({
              value,
              itemStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: colors[index] },
                    { offset: 1, color: colors[index] + 'CC' },
                  ],
                },
                borderRadius: [4, 4, 0, 0],
              },
            })),
            barWidth: '50%',
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowColor: 'rgba(0, 0, 0, 0.3)',
              },
            },
            animationDuration: 800,
            animationEasing: 'cubicOut',
          },
        ],
      };
    });

    // Helper: Format Number
    const formatNumber = (num: number): string => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
      }
      return num.toString();
    };

    // Helper: Format Request Rate
    const formatRequestRate = (requests: number): string => {
      if (requests >= 1000000) {
        return (requests / 1000000).toFixed(1) + 'M req/min';
      }
      if (requests >= 1000) {
        return (requests / 1000).toFixed(1) + 'K req/min';
      }
      return requests + ' req/min';
    };

    // Fetch trend data for the selected edge
    const fetchTrend = async () => {
      if (!props.selectedEdge || !props.visible) return;

      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;

      const clientService = sourceServiceName.value || undefined;
      const serverService = targetServiceName.value || undefined;

      trendLoading.value = true;
      trendData.value = null;
      try {
        const res = await serviceGraphService.getEdgeTrend(orgId, {
          client_service: clientService,
          server_service: serverService,
          start_time: props.timeRange?.startTime,
          end_time: props.timeRange?.endTime,
        });
        trendData.value = res.data;
        // Emit baselines so ServiceGraph can use them for edge coloring
        emit('trend-loaded', {
          from: clientService,
          to: serverService,
          p50_avg: res.data.p50_avg ?? 0,
          p95_avg: res.data.p95_avg ?? 0,
          p99_avg: res.data.p99_avg ?? 0,
        });
      } catch (e) {
        trendData.value = null;
      } finally {
        trendLoading.value = false;
      }
    };

    watch(
      () => [props.selectedEdge, props.visible],
      ([, visible]) => {
        if (visible) fetchTrend();
      },
      { immediate: true },
    );

    // Build ECharts line chart options from trend data
    const latencyTrend = computed(() => {
      if (!trendData.value || !trendData.value.data_points?.length) return null;

      const points = trendData.value.data_points;
      const isDark = store.state.theme === 'dark';
      const axisColor = isDark ? '#B7B7B7' : '#72777B';
      const splitLineColor = isDark ? '#3A3A3A' : '#F0F0F0';
      const bgColor = isDark ? '#2B2C2D' : '#ffffff';
      const borderColor = isDark ? '#444444' : '#E7EAEE';
      const textColor = isDark ? '#DCDCDC' : '#232323';

      // ns → ms conversion
      const toMs = (ns: number) => ns / 1_000_000;

      return {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          backgroundColor: bgColor,
          borderColor,
          textStyle: { color: textColor, fontSize: 12 },
          formatter: (params: any[]) => {
            const ts = new Date(params[0].axisValue / 1000).toLocaleString();
            const lines = params.map((p: any) => {
              const ms = p.value[1];
              const formatted = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(2)}ms`;
              return `${p.marker}${p.seriesName}: ${formatted}`;
            });
            return `${ts}<br/>${lines.join('<br/>')}`;
          },
        },
        legend: {
          data: ['P50', 'P95', 'P99'],
          textStyle: { color: axisColor, fontSize: 11 },
          top: 4,
        },
        grid: { left: '3%', right: '4%', bottom: '3%', top: '30px', containLabel: true },
        xAxis: {
          type: 'time',
          axisLabel: { color: axisColor, fontSize: 11 },
          axisLine: { lineStyle: { color: borderColor } },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          name: 'Latency (ms)',
          nameTextStyle: { color: axisColor, fontSize: 11 },
          axisLabel: {
            color: axisColor,
            formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`,
          },
          splitLine: { lineStyle: { color: splitLineColor } },
        },
        series: [
          {
            name: 'P50',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 5,
            data: points.map((p: any) => [p.timestamp / 1000, toMs(p.p50_latency_ns)]),
            itemStyle: { color: '#4caf50' },
            lineStyle: { color: '#4caf50', width: 2 },
          },
          {
            name: 'P95',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 5,
            data: points.map((p: any) => [p.timestamp / 1000, toMs(p.p95_latency_ns)]),
            itemStyle: { color: '#2196f3' },
            lineStyle: { color: '#2196f3', width: 2 },
          },
          {
            name: 'P99',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 5,
            data: points.map((p: any) => [p.timestamp / 1000, toMs(p.p99_latency_ns)]),
            itemStyle: { color: '#ff9800' },
            lineStyle: { color: '#ff9800', width: 2 },
          },
        ],
      };
    });

    // Handlers
    const handleClose = () => {
      emit('close');
    };

    return {
      sourceServiceName,
      targetServiceName,
      edgeStats,
      latencyDistribution,
      latencyTrend,
      trendLoading,
      handleClose,
    };
  },
});
</script>

<style scoped lang="scss">
.service-graph-edge-panel {
  position: absolute;
  right: 0;
  top: 0;
  width: 420px;
  height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: #1a1f2e; // Match node panel background
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  animation: slideIn 0.3s ease-out;
}

// Light mode support
.body--light .service-graph-edge-panel {
  background: #ffffff;
  color: #333333;
  border-left: 1px solid #e0e0e0;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
}

// Slide animation keyframes
@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

// Slide animation for Vue transition
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

// Header
.panel-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.25rem; // Reduced from 1.5rem 1.75rem
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #0f1419;
  flex-shrink: 0;
  position: relative;

  .edge-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 1.125rem; // Reduced from 1.25rem
    font-weight: 600;
    color: #e8eaed;
    letter-spacing: -0.01em;

    .source-service,
    .target-service {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .arrow-icon {
      flex-shrink: 0;
      color: rgba(255, 255, 255, 0.5);
    }
  }

  .connection-type {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.6);
    padding: 0.25rem 0.625rem;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    display: inline-block;
    width: fit-content;
  }

  .close-btn {
    position: absolute;
    top: 1rem; // Adjusted from 1.5rem to match new padding
    right: 1.25rem; // Adjusted from 1.75rem to match new padding
  }
}

.body--light .panel-header {
  border-bottom: 1px solid #e0e0e0;
  background: #f5f5f5;

  .edge-title {
    color: #202124;

    .arrow-icon {
      color: rgba(0, 0, 0, 0.5);
    }
  }

  .connection-type {
    color: rgba(0, 0, 0, 0.6);
    background: rgba(0, 0, 0, 0.06);
  }

}

// Content
.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: #0f1419;
  padding: 1rem 1.25rem; // Reduced from 1.5rem 1.75rem

  // Custom scrollbar
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;

    &:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  }
}

.body--light .panel-content {
  background: #ffffff;

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15);

    &:hover {
      background: rgba(0, 0, 0, 0.25);
    }
  }
}

// Panel Sections
.panel-section {
  padding: 0;
  margin-bottom: 1.25rem; // Reduced from 1.75rem

  &:last-child {
    margin-bottom: 0;
  }

  .section-title {
    font-size: 0.8125rem; // Slightly reduced from 0.875rem
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    margin-bottom: 0.75rem; // Reduced from 1rem
    color: rgba(255, 255, 255, 0.9);
  }
}

.body--light .panel-section .section-title {
  color: rgba(0, 0, 0, 0.87);
}

// Actions Section
.actions-section {
  display: flex;
  gap: 0.5rem;
  padding: 0;
  margin-bottom: 1.5rem;

  .action-btn {
    flex: 1;
    justify-content: center;
    padding: 0.625rem 0.875rem;
    font-weight: 500;
    font-size: 0.875rem;
    transition: all 0.2s ease;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.7);

    &:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.2);
      color: rgba(255, 255, 255, 0.9);
    }
  }
}

.body--light .actions-section .action-btn {
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: rgba(0, 0, 0, 0.7);

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgba(0, 0, 0, 0.9);
  }
}

// Statistics Section
.stats-section {
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;

    .stat-card {
      padding: 1.25rem 1rem;
      border-radius: 6px;
      text-align: center;
      background: #252b3d;
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.2s ease;

      &:hover {
        background: #2a3145;
        border-color: rgba(255, 255, 255, 0.12);
      }

      .stat-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
      }

      .stat-value {
        font-size: 1.25rem;
        font-weight: 600;
        color: #e8eaed;
        letter-spacing: -0.01em;

        &.success {
          color: #4caf50;
        }

        &.error {
          color: #f44336;
        }
      }
    }
  }
}

.body--light .stats-section .stats-grid .stat-card {
  background: #ffffff;
  border-color: #e0e0e0;

  &:hover {
    background: #f8f9fa;
    border-color: #d0d0d0;
  }

  .stat-label {
    color: rgba(0, 0, 0, 0.6);
  }

  .stat-value {
    color: #202124;

    &.success {
      color: #2e7d32;
    }

    &.error {
      color: #c62828;
    }
  }
}

// Latency Distribution Section
.latency-section {
  .latency-chart-container {
    padding: 0.5rem;
    border-radius: 8px;
    background: #252b3d;
    border: 1px solid rgba(255, 255, 255, 0.08);
    min-height: 140px;
  }

  .latency-chart {
    width: 100%;
    height: 140px;
  }
}

.body--light .latency-section {
  .latency-chart-container {
    background: #ffffff;
    border-color: #e0e0e0;
  }
}

// Latency Trend Section
.trend-section {
  .latency-chart-container {
    padding: 0.5rem;
    border-radius: 8px;
    background: #252b3d;
    border: 1px solid rgba(255, 255, 255, 0.08);
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .latency-chart {
    width: 100%;
    height: 180px;
  }

  .trend-loading,
  .trend-empty {
    color: #B7B7B7;
    font-size: 13px;
    text-align: center;
    padding: 1rem;
  }
}

.body--light .trend-section {
  .latency-chart-container {
    background: #ffffff;
    border-color: #e0e0e0;
  }

  .trend-loading,
  .trend-empty {
    color: #72777B;
  }
}

// Traces Section
.traces-section {
  .traces-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    .trace-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem 1.125rem;
      border-radius: 6px;
      background: #252b3d;
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.2s ease;
      cursor: pointer;

      &:hover {
        background: #2a3145;
        border-color: rgba(255, 255, 255, 0.12);
      }

      .trace-id {
        font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
        font-size: 0.8rem;
        color: #5e9cff;
        font-weight: 500;
      }

      .trace-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.75rem;

        .trace-duration {
          font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .trace-status {
          padding: 0.25rem 0.625rem;
          border-radius: 4px;
          text-transform: uppercase;
          font-weight: 600;

          &.status-success {
            color: #4caf50;
            background: rgba(76, 175, 80, 0.15);
          }

          &.status-error {
            color: #f44336;
            background: rgba(244, 67, 54, 0.15);
          }

          &.status-warning {
            color: #ff9800;
            background: rgba(255, 152, 0, 0.15);
          }
        }

        .trace-time {
          color: rgba(255, 255, 255, 0.5);
          margin-left: auto;
        }
      }
    }
  }
}

.body--light .traces-section .traces-list .trace-item {
  background: #ffffff;
  border-color: #e0e0e0;

  &:hover {
    background: #f8f9fa;
    border-color: #d0d0d0;
  }

  .trace-id {
    color: #1a73e8;
  }

  .trace-info {
    .trace-duration {
      color: rgba(0, 0, 0, 0.7);
    }

    .trace-status {
      &.status-success {
        color: #2e7d32;
        background: rgba(76, 175, 80, 0.1);
      }

      &.status-error {
        color: #c62828;
        background: rgba(244, 67, 54, 0.1);
      }

      &.status-warning {
        color: #f57c00;
        background: rgba(255, 152, 0, 0.1);
      }
    }

    .trace-time {
      color: rgba(0, 0, 0, 0.5);
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

  .loading-text {
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
</style>

<style lang="scss">
// Dark mode - match node panel background
.body--dark {
  .service-graph-edge-panel {
    background: #1a1f2e;  // Match node panel background
    color: #e4e7eb;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }
}

// Light mode
.body--light {
  .service-graph-edge-panel {
    background: #ffffff;
    color: #333333;
    border-left: 1px solid #e0e0e0;
  }
}
</style>
