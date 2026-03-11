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
      class="service-graph-edge-side-panel"
      data-test="service-graph-edge-side-panel"
    >
      <!-- Header -->
      <div class="panel-header" data-test="service-graph-edge-side-panel-header">
        <div class="panel-title">
          <h2 class="edge-name" data-test="service-graph-edge-side-panel-route">
            <span class="from-service">{{ selectedEdge?.from }}</span>
            <q-icon name="arrow_forward" size="14px" class="edge-arrow" />
            <span class="to-service">{{ selectedEdge?.to }}</span>
            <span class="health-badge" :class="edgeHealth.status">
              {{ edgeHealth.text }}
            </span>
          </h2>
        </div>
        <div class="panel-header-actions">
          <q-btn
            flat
            dense
            round
            icon="cancel"
            size="sm"
            @click="handleClose"
            data-test="service-graph-edge-side-panel-close-btn"
            class="close-btn"
          />
        </div>
      </div>

      <!-- Content -->
      <div class="panel-content">

        <!-- Metrics Section -->
        <div class="panel-section metrics-section" data-test="service-graph-edge-side-panel-metrics">
          <div class="metric-card metric-card-full" data-test="service-graph-edge-side-panel-request-rate">

            <!-- Traffic Summary: Total | Failed | Error Rate -->
            <div class="traffic-row">
              <div class="traffic-pill total" data-test="service-graph-edge-side-panel-total">
                <q-icon name="swap_horiz" size="13px" />
                <span class="traffic-label">Total</span>
                <span class="traffic-value">{{ formatNumber(selectedEdge?.total_requests ?? 0) }}</span>
                <q-tooltip>Total requests flowing through this connection</q-tooltip>
              </div>
              <div class="traffic-pill failed" data-test="service-graph-edge-side-panel-failed">
                <q-icon name="close" size="13px" />
                <span class="traffic-label">Failed</span>
                <span class="traffic-value">{{ formatNumber(selectedEdge?.failed_requests ?? 0) }}</span>
                <q-tooltip>Number of failed requests on this connection</q-tooltip>
              </div>
              <div
                class="traffic-pill error-rate"
                :class="getErrorRateClass()"
                data-test="service-graph-edge-side-panel-error-rate"
              >
                <q-icon name="error_outline" size="13px" />
                <span class="traffic-label">Error Rate</span>
                <span class="traffic-value">{{ errorRateFormatted }}</span>
                <q-tooltip>Percentage of requests that failed</q-tooltip>
              </div>
            </div>

            <div class="metric-horizontal-divider"></div>

            <!-- Latency baseline comparison table: P50 / P95 / P99 vs baseline -->
            <div class="latency-table">
              <div class="latency-header-row">
                <span class="col-metric"></span>
                <span class="col-current">Current</span>
                <span class="col-baseline">Baseline</span>
                <span class="col-delta">vs Baseline</span>
              </div>

              <!-- P50 -->
              <div
                class="latency-data-row"
                :class="getLatencyClass(p50Latency)"
                data-test="service-graph-edge-side-panel-p50"
              >
                <span class="col-metric"><span class="percentile-badge">P50</span></span>
                <span class="col-current latency-current">{{ p50Latency }}</span>
                <span class="col-baseline latency-baseline">{{ baselineP50 }}</span>
                <span class="col-delta">
                  <span class="delta-badge" :class="getDeltaClass(p50DeltaPct)">
                    <q-icon
                      :name="p50DeltaPct > 2 ? 'arrow_upward' : p50DeltaPct < -2 ? 'arrow_downward' : 'remove'"
                      size="10px"
                    />
                    {{ p50DeltaFormatted }}
                  </span>
                </span>
              </div>

              <!-- P95 -->
              <div
                class="latency-data-row"
                :class="getLatencyClass(p95Latency)"
                data-test="service-graph-edge-side-panel-p95"
              >
                <span class="col-metric"><span class="percentile-badge">P95</span></span>
                <span class="col-current latency-current">{{ p95Latency }}</span>
                <span class="col-baseline latency-baseline">{{ baselineP95 }}</span>
                <span class="col-delta">
                  <span class="delta-badge" :class="getDeltaClass(p95DeltaPct)">
                    <q-icon
                      :name="p95DeltaPct > 2 ? 'arrow_upward' : p95DeltaPct < -2 ? 'arrow_downward' : 'remove'"
                      size="10px"
                    />
                    {{ p95DeltaFormatted }}
                  </span>
                </span>
              </div>

              <!-- P99 -->
              <div
                class="latency-data-row"
                :class="getLatencyClass(p99Latency)"
                data-test="service-graph-edge-side-panel-p99"
              >
                <span class="col-metric"><span class="percentile-badge">P99</span></span>
                <span class="col-current latency-current">{{ p99Latency }}</span>
                <span class="col-baseline latency-baseline">{{ baselineP99 }}</span>
                <span class="col-delta">
                  <span class="delta-badge" :class="getDeltaClass(p99DeltaPct)">
                    <q-icon
                      :name="p99DeltaPct > 2 ? 'arrow_upward' : p99DeltaPct < -2 ? 'arrow_downward' : 'remove'"
                      size="10px"
                    />
                    {{ p99DeltaFormatted }}
                  </span>
                </span>
              </div>
            </div>

          </div>
        </div>

        <!-- Latency Trend Section -->
        <div class="panel-section trend-section" data-test="service-graph-edge-side-panel-trend">
          <div class="section-header">
            <div class="section-title">Latency Trend</div>
            <q-btn
              flat
              dense
              no-caps
              size="xs"
              icon="refresh"
              label="Refresh"
              @click="loadTrend"
              :loading="trendLoading"
              class="refresh-trend-btn"
            />
          </div>

          <!-- Loading -->
          <div v-if="trendLoading" class="trend-state">
            <q-spinner color="primary" size="sm" />
            <span>Loading trend data…</span>
          </div>

          <!-- Error -->
          <div v-else-if="trendError" class="trend-state trend-error">
            <q-icon name="warning" size="16px" />
            <span>{{ trendError }}</span>
          </div>

          <!-- Empty -->
          <div v-else-if="!trendData || !trendDataPoints.length" class="trend-state trend-empty">
            <q-icon name="show_chart" size="24px" class="trend-empty-icon" />
            <span>No trend data available</span>
          </div>

          <!-- Chart — always in DOM when data exists so ref is stable -->
          <div
            ref="trendChartRef"
            class="trend-chart"
            :class="{ 'trend-chart--hidden': trendLoading || trendError || !trendData || !trendDataPoints.length }"
            data-test="service-graph-edge-side-panel-trend-chart"
          ></div>
        </div>

      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  onBeforeUnmount,
  nextTick,
  type PropType,
} from 'vue';
import { useStore } from 'vuex';
import { useQuasar } from 'quasar';
import * as echarts from 'echarts';
import serviceGraphService from '@/services/service_graph';

export default defineComponent({
  name: 'ServiceGraphEdgeSidePanel',
  props: {
    selectedEdge: {
      type: Object as PropType<{
        from: string;
        to: string;
        total_requests: number;
        failed_requests: number;
        error_rate: number;
        p50_latency_ns: number;
        p95_latency_ns: number;
        p99_latency_ns: number;
        baseline_p50_latency_ns?: number;
        baseline_p95_latency_ns?: number;
        baseline_p99_latency_ns?: number;
      } | null>,
      default: null,
    },
    visible: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const store = useStore();
    const $q = useQuasar();

    const trendChartRef = ref<HTMLElement | null>(null);
    const trendLoading = ref(false);
    const trendError = ref<string | null>(null);
    const trendData = ref<any>(null);
    let chartInstance: echarts.ECharts | null = null;
    let chartResizeObserver: ResizeObserver | null = null;

    // ── Formatters ──────────────────────────────────────────────────────────

    const formatNumber = (num: number): string => {
      if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
      if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
      return num.toString();
    };

    const formatLatencyNs = (ns: number): string => {
      if (!ns || ns === 0) return 'N/A';
      const ms = ns / 1_000_000;
      if (ms >= 1_000) return (ms / 1_000).toFixed(2) + 's';
      return ms.toFixed(0) + 'ms';
    };

    // ── Computed metrics ────────────────────────────────────────────────────

    const errorRateFormatted = computed(() => {
      const rate = props.selectedEdge?.error_rate ?? 0;
      return rate.toFixed(2) + '%';
    });

    const p50Latency = computed(() =>
      formatLatencyNs(props.selectedEdge?.p50_latency_ns ?? 0)
    );
    const p95Latency = computed(() =>
      formatLatencyNs(props.selectedEdge?.p95_latency_ns ?? 0)
    );
    const p99Latency = computed(() =>
      formatLatencyNs(props.selectedEdge?.p99_latency_ns ?? 0)
    );

    // ── Baseline latency computeds ───────────────────────────────────────────

    const baselineP50 = computed(() =>
      formatLatencyNs(props.selectedEdge?.baseline_p50_latency_ns ?? 0)
    );
    const baselineP95 = computed(() =>
      formatLatencyNs(props.selectedEdge?.baseline_p95_latency_ns ?? 0)
    );
    const baselineP99 = computed(() =>
      formatLatencyNs(props.selectedEdge?.baseline_p99_latency_ns ?? 0)
    );

    // Delta %: positive = regression (latency went up), negative = improvement
    const calcDeltaPct = (current: number, baseline: number): number => {
      if (!baseline || baseline === 0) return 0;
      return ((current - baseline) / baseline) * 100;
    };

    const p50DeltaPct = computed(() =>
      calcDeltaPct(
        props.selectedEdge?.p50_latency_ns ?? 0,
        props.selectedEdge?.baseline_p50_latency_ns ?? 0
      )
    );
    const p95DeltaPct = computed(() =>
      calcDeltaPct(
        props.selectedEdge?.p95_latency_ns ?? 0,
        props.selectedEdge?.baseline_p95_latency_ns ?? 0
      )
    );
    const p99DeltaPct = computed(() =>
      calcDeltaPct(
        props.selectedEdge?.p99_latency_ns ?? 0,
        props.selectedEdge?.baseline_p99_latency_ns ?? 0
      )
    );

    const formatDelta = (pct: number): string => {
      if (!props.selectedEdge?.baseline_p50_latency_ns) return 'N/A';
      if (Math.abs(pct) < 0.5) return '±0%';
      const sign = pct > 0 ? '+' : '';
      return `${sign}${pct.toFixed(1)}%`;
    };

    const p50DeltaFormatted = computed(() => formatDelta(p50DeltaPct.value));
    const p95DeltaFormatted = computed(() => formatDelta(p95DeltaPct.value));
    const p99DeltaFormatted = computed(() => formatDelta(p99DeltaPct.value));

    // delta-improved: latency went down (good), delta-critical: went up a lot (bad)
    const getDeltaClass = (pct: number): string => {
      if (Math.abs(pct) < 2) return 'delta-neutral';
      if (pct <= -5) return 'delta-improved';
      if (pct < 0) return 'delta-improved-slight';
      if (pct < 20) return 'delta-warning';
      return 'delta-critical';
    };

    const trendDataPoints = computed<any[]>(
      () => trendData.value?.data_points ?? []
    );

    // ── Health badge ────────────────────────────────────────────────────────

    const edgeHealth = computed(() => {
      const rate = props.selectedEdge?.error_rate ?? 0;
      if (rate > 10) return { status: 'critical', text: 'Critical' };
      if (rate > 5) return { status: 'degraded', text: 'Degraded' };
      return { status: 'healthy', text: 'Healthy' };
    });

    // ── CSS class helpers ───────────────────────────────────────────────────

    const getErrorRateClass = (): string => {
      const rate = props.selectedEdge?.error_rate ?? 0;
      if (rate < 1) return 'status-healthy';
      if (rate < 5) return 'status-warning';
      return 'status-critical';
    };

    const getLatencyClass = (latencyStr: string): string => {
      if (latencyStr === 'N/A') return 'status-unknown';
      let ms = 0;
      if (latencyStr.endsWith('ms')) {
        ms = parseFloat(latencyStr);
      } else if (latencyStr.endsWith('s')) {
        ms = parseFloat(latencyStr) * 1000;
      }
      if (ms < 100) return 'status-healthy';
      if (ms < 500) return 'status-warning';
      return 'status-critical';
    };

    // ── ECharts trend chart ─────────────────────────────────────────────────

    const disposeChart = () => {
      chartResizeObserver?.disconnect();
      chartResizeObserver = null;
      if (chartInstance) {
        chartInstance.dispose();
        chartInstance = null;
      }
    };

    const buildChartOptions = (points: any[]) => {
      const isDark = $q.dark.isActive;
      const toMs = (ns: number) => ns / 1_000_000;
      const fmtMs = (ms: number) =>
        ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

      const timestamps = points.map((p) => {
        const ts = p.timestamp;
        const ms = ts > 1e12 ? ts / 1_000_000 : ts * 1_000;
        return new Date(ms).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });
      });

      const p50 = points.map((p) => toMs(p.p50_latency_ns ?? 0));
      const p95 = points.map((p) => toMs(p.p95_latency_ns ?? 0));
      const p99 = points.map((p) => toMs(p.p99_latency_ns ?? 0));

      const textColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)';
      const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';

      return {
        backgroundColor: 'transparent',
        animation: true,
        grid: { left: 52, right: 16, top: 12, bottom: 36 },
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
            lineStyle: { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' },
          },
          backgroundColor: isDark ? 'rgba(22,22,26,0.92)' : 'rgba(255,255,255,0.96)',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)',
          textStyle: { color: isDark ? '#e4e7eb' : '#202124', fontSize: 11 },
          formatter: (params: any[]) => {
            const label = params[0]?.axisValue ?? '';
            const rows = params
              .map(
                (p: any) =>
                  `<div style="display:flex;justify-content:space-between;gap:16px;">
                    <span style="color:${p.color}">${p.seriesName}</span>
                    <span style="font-weight:600">${fmtMs(p.value)}</span>
                  </div>`
              )
              .join('');
            return `<div style="font-size:11px;min-width:120px">
              <div style="margin-bottom:4px;opacity:0.6">${label}</div>
              ${rows}
            </div>`;
          },
        },
        legend: {
          bottom: 0,
          left: 'center',
          textStyle: { color: textColor, fontSize: 11 },
          itemWidth: 12,
          itemHeight: 4,
          icon: 'roundRect',
        },
        xAxis: {
          type: 'category',
          data: timestamps,
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: {
            color: textColor,
            fontSize: 10,
            interval: Math.max(0, Math.floor(timestamps.length / 4) - 1),
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: textColor,
            fontSize: 10,
            formatter: fmtMs,
          },
          splitLine: { lineStyle: { color: gridColor } },
        },
        series: [
          {
            name: 'P50',
            type: 'line',
            data: p50,
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#10b981', width: 2 },
            itemStyle: { color: '#10b981' },
            areaStyle: { color: 'rgba(16,185,129,0.08)' },
          },
          {
            name: 'P95',
            type: 'line',
            data: p95,
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#f59e0b', width: 2 },
            itemStyle: { color: '#f59e0b' },
            areaStyle: { color: 'rgba(245,158,11,0.08)' },
          },
          {
            name: 'P99',
            type: 'line',
            data: p99,
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#ef4444', width: 2 },
            itemStyle: { color: '#ef4444' },
            areaStyle: { color: 'rgba(239,68,68,0.08)' },
          },
        ],
      };
    };

    const renderChart = () => {
      if (!trendChartRef.value) return;
      const points = trendDataPoints.value;
      if (!points.length) return;

      if (!chartInstance) {
        chartInstance = echarts.init(trendChartRef.value, undefined, {
          renderer: 'canvas',
          devicePixelRatio: window.devicePixelRatio || 1,
        });
        // Keep chart sized to its flex container as the panel height changes
        chartResizeObserver = new ResizeObserver(() => {
          chartInstance?.resize();
        });
        chartResizeObserver.observe(trendChartRef.value);
      }
      chartInstance.setOption(buildChartOptions(points), { notMerge: true });
    };

    // ── Fetch trend data ────────────────────────────────────────────────────

    const loadTrend = async () => {
      if (!props.selectedEdge) return;
      const { from, to } = props.selectedEdge;
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;

      trendLoading.value = true;
      trendError.value = null;
      trendData.value = null;
      disposeChart();

      try {
        const res = await serviceGraphService.getEdgeHistory(orgId, {
          client_service: from,
          server_service: to,
        });
        trendData.value = res.data;
      } catch {
        trendError.value = 'Failed to load trend data.';
      } finally {
        // Set loading false first — Vue will re-render and make the chart div visible
        trendLoading.value = false;
      }
    };

    // ── Watchers ────────────────────────────────────────────────────────────

    // Trigger load when edge or visibility changes
    watch(
      () => [props.selectedEdge?.from, props.selectedEdge?.to, props.visible] as const,
      ([, , visible]) => {
        if (visible && props.selectedEdge) {
          loadTrend();
        } else if (!visible) {
          disposeChart();
          trendData.value = null;
          trendError.value = null;
        }
      },
      { immediate: true }
    );

    // After trendLoading goes false and trendData is set, render the chart.
    // The chart div becomes visible only after loading=false, so we must wait
    // for the next DOM tick before initializing ECharts.
    watch(trendLoading, async (isLoading) => {
      if (!isLoading && trendData.value && trendDataPoints.value.length) {
        await nextTick();
        renderChart();
      }
    });

    // Re-render when dark mode toggles
    watch(
      () => $q.dark.isActive,
      async () => {
        if (!trendLoading.value && trendDataPoints.value.length) {
          await nextTick();
          if (chartInstance) {
            chartInstance.setOption(buildChartOptions(trendDataPoints.value), { notMerge: true });
          } else {
            renderChart();
          }
        }
      }
    );

    onBeforeUnmount(() => {
      disposeChart();
    });

    const handleClose = () => emit('close');

    return {
      trendChartRef,
      trendLoading,
      trendError,
      trendData,
      trendDataPoints,
      edgeHealth,
      errorRateFormatted,
      p50Latency,
      p95Latency,
      p99Latency,
      baselineP50,
      baselineP95,
      baselineP99,
      p50DeltaPct,
      p95DeltaPct,
      p99DeltaPct,
      p50DeltaFormatted,
      p95DeltaFormatted,
      p99DeltaFormatted,
      getDeltaClass,
      getErrorRateClass,
      getLatencyClass,
      formatNumber,
      formatLatencyNs,
      loadTrend,
      handleClose,
    };
  },
});
</script>

<style scoped lang="scss">
.service-graph-edge-side-panel {
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
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

// ── Slide transition ─────────────────────────────────────────────────────
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-enter-from,
.slide-leave-to { transform: translateX(100%); }
.slide-enter-to,
.slide-leave-from { transform: translateX(0); }

// ── Header ────────────────────────────────────────────────────────────────
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
    min-width: 0;
  }

  .edge-name {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    line-height: 1.2;
    color: #e4e7eb;
    letter-spacing: normal;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;

    .from-service {
      color: #60a5fa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .edge-arrow {
      color: rgba(255,255,255,0.35);
      flex-shrink: 0;
    }

    .to-service {
      color: #a78bfa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .health-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      flex-shrink: 0;

      &::before {
        content: '●';
        font-size: 10px;
      }

      &.healthy  { background: rgba(16,185,129,0.15); color: #10b981; }
      &.degraded { background: rgba(251,191,36,0.15);  color: #fbbf24; }
      &.critical { background: rgba(239,68,68,0.15);   color: #ef4444; }
    }
  }

  .panel-header-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;

    .close-btn {
      width: 24px;
      height: 24px;
    }
  }
}

.body--light .panel-header {
  border-bottom: 1px solid #e0e0e0;
  background: #f5f5f5;

  .edge-name {
    color: #202124;

    .from-service { color: #1d4ed8; }
    .to-service   { color: #6d28d9; }
    .edge-arrow   { color: rgba(0,0,0,0.3); }

    .health-badge {
      &.healthy  { background: rgba(16,185,129,0.08); color: #059669; }
      &.degraded { background: rgba(251,191,36,0.08); color: #d97706; }
      &.critical { background: rgba(239,68,68,0.08);  color: #dc2626; }
    }
  }
}

// ── Scrollable content ────────────────────────────────────────────────────
.panel-content {
  flex: 1;
  min-height: 0;                 // essential: allows flex child to shrink below content
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  background: #0f1419;
  padding: 0 12px 12px;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: #1a1f2e; }
  &::-webkit-scrollbar-thumb {
    background: #242938;
    border-radius: 3px;
    &:hover { background: #2d3548; }
  }
}

.body--light .panel-content {
  background: #ffffff;
  &::-webkit-scrollbar-track { background: #f8f9fa; }
  &::-webkit-scrollbar-thumb {
    background: #e0e0e0;
    &:hover { background: #d0d0d0; }
  }
}

// ── Sections ──────────────────────────────────────────────────────────────
.panel-section {
  padding: 0;
  margin-top: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #e4e7eb;
  margin-bottom: 8px;
}

.body--light .section-title { color: #202124; }

.refresh-trend-btn {
  font-size: 11px;
  color: #9ca3af;
  margin-bottom: 8px;
}

// ── Metric card ───────────────────────────────────────────────────────────
.metrics-section {
  .metric-card-full {
    padding: 10px 12px;
    border-radius: 8px;
    background: linear-gradient(135deg, #242938 0%, #1f2937 100%);
    border: 1px solid #374151;
    margin-bottom: 12px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    &:hover {
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.4);
    }

    .metric-horizontal-divider {
      width: 100%;
      height: 1px;
      background: #374151;
      margin: 10px 0 8px 0;
    }

    // ── Traffic Summary row ──────────────────────────────────────────────
    .traffic-row {
      display: flex;
      gap: 6px;

      .traffic-pill {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 7px 6px 6px;
        border-radius: 6px;
        border: 1px solid transparent;
        transition: all 0.2s ease;
        cursor: default;

        .q-icon { opacity: 0.8; }

        .traffic-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          line-height: 1;
          opacity: 0.65;
        }

        .traffic-value {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1;
        }

        &.total {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.02));
          border-color: rgba(99, 102, 241, 0.2);
          color: #a5b4fc;
          .traffic-value { color: #c7d2fe; }
          &:hover { box-shadow: 0 0 8px rgba(99, 102, 241, 0.2); }
        }

        &.failed {
          background: linear-gradient(135deg, rgba(107, 114, 128, 0.1), rgba(107, 114, 128, 0.02));
          border-color: rgba(107, 114, 128, 0.2);
          color: #9ca3af;
          .traffic-value { color: #d1d5db; }
        }

        // error-rate pill inherits status-* class
        &.error-rate {
          &.status-healthy {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02));
            border-color: rgba(16, 185, 129, 0.2);
            color: #6ee7b7;
            .traffic-value { color: #10b981; }
            &:hover { box-shadow: 0 0 8px rgba(16, 185, 129, 0.2); }
          }
          &.status-warning {
            background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(251, 191, 36, 0.02));
            border-color: rgba(251, 191, 36, 0.2);
            color: #fde68a;
            .traffic-value { color: #fbbf24; }
            &:hover { box-shadow: 0 0 8px rgba(251, 191, 36, 0.2); }
          }
          &.status-critical {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02));
            border-color: rgba(239, 68, 68, 0.2);
            color: #fca5a5;
            .traffic-value { color: #ef4444; }
            &:hover { box-shadow: 0 0 8px rgba(239, 68, 68, 0.2); }
          }
        }
      }
    }

    // ── Latency baseline comparison table ───────────────────────────────
    .latency-table {
      .latency-header-row {
        display: grid;
        grid-template-columns: 44px 1fr 1fr 1fr;
        gap: 4px;
        padding: 2px 6px 4px;
        span {
          font-size: 9px;
          font-weight: 700;
          color: #4b5563;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .col-current, .col-baseline, .col-delta { text-align: right; }
      }

      .latency-data-row {
        display: grid;
        grid-template-columns: 44px 1fr 1fr 1fr;
        gap: 4px;
        padding: 6px 6px;
        border-radius: 5px;
        margin-bottom: 3px;
        align-items: center;
        border: 1px solid transparent;
        transition: all 0.2s ease;

        &:last-child { margin-bottom: 0; }

        &.status-healthy {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.01));
          border-color: rgba(16, 185, 129, 0.12);
          .latency-current { color: #10b981; }
          &:hover { background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02)); }
        }
        &.status-warning {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(251, 191, 36, 0.01));
          border-color: rgba(251, 191, 36, 0.12);
          .latency-current { color: #fbbf24; }
          &:hover { background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(251, 191, 36, 0.02)); }
        }
        &.status-critical {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), rgba(239, 68, 68, 0.01));
          border-color: rgba(239, 68, 68, 0.12);
          .latency-current { color: #ef4444; }
          &:hover { background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02)); }
        }
        &.status-unknown {
          background: rgba(107, 114, 128, 0.04);
          border-color: rgba(107, 114, 128, 0.1);
          .latency-current { color: #9ca3af; }
        }

        .col-current, .col-baseline, .col-delta { text-align: right; }

        .percentile-badge {
          font-size: 11px;
          font-weight: 700;
          color: #9ca3af;
          background: rgba(107, 114, 128, 0.14);
          padding: 2px 6px;
          border-radius: 3px;
          letter-spacing: 0.03em;
        }

        .latency-current {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }

        .latency-baseline {
          font-size: 11px;
          font-weight: 500;
          color: #4b5563;
        }

        .delta-badge {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 2px;
          padding: 2px 5px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: -0.01em;

          &.delta-improved {
            background: rgba(16, 185, 129, 0.14);
            color: #10b981;
          }
          &.delta-improved-slight {
            background: rgba(16, 185, 129, 0.08);
            color: #34d399;
          }
          &.delta-neutral {
            background: rgba(107, 114, 128, 0.12);
            color: #6b7280;
          }
          &.delta-warning {
            background: rgba(251, 191, 36, 0.14);
            color: #fbbf24;
          }
          &.delta-critical {
            background: rgba(239, 68, 68, 0.14);
            color: #ef4444;
          }
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
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .metric-horizontal-divider { background: #e5e7eb; }

    .traffic-row {
      .traffic-pill {
        &.total {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(99, 102, 241, 0.01));
          border-color: rgba(99, 102, 241, 0.2);
          color: #6366f1;
          .traffic-value { color: #4338ca; }
        }
        &.failed {
          background: linear-gradient(135deg, rgba(107, 114, 128, 0.06), rgba(107, 114, 128, 0.01));
          border-color: rgba(107, 114, 128, 0.15);
          color: #6b7280;
          .traffic-value { color: #374151; }
        }
        &.error-rate {
          &.status-healthy {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.01));
            border-color: rgba(16, 185, 129, 0.2);
            color: #059669;
            .traffic-value { color: #047857; }
          }
          &.status-warning {
            background: linear-gradient(135deg, rgba(217, 119, 6, 0.06), rgba(217, 119, 6, 0.01));
            border-color: rgba(217, 119, 6, 0.2);
            color: #d97706;
            .traffic-value { color: #b45309; }
          }
          &.status-critical {
            background: linear-gradient(135deg, rgba(220, 38, 38, 0.06), rgba(220, 38, 38, 0.01));
            border-color: rgba(220, 38, 38, 0.2);
            color: #dc2626;
            .traffic-value { color: #b91c1c; }
          }
        }
      }
    }

    .latency-table {
      .latency-header-row span { color: #9ca3af; }

      .latency-data-row {
        &.status-healthy {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(16, 185, 129, 0.01));
          border-color: rgba(16, 185, 129, 0.15);
          .latency-current { color: #059669; }
        }
        &.status-warning {
          background: linear-gradient(135deg, rgba(217, 119, 6, 0.04), rgba(217, 119, 6, 0.01));
          border-color: rgba(217, 119, 6, 0.15);
          .latency-current { color: #d97706; }
        }
        &.status-critical {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.04), rgba(220, 38, 38, 0.01));
          border-color: rgba(220, 38, 38, 0.15);
          .latency-current { color: #dc2626; }
        }

        .percentile-badge {
          background: rgba(107, 114, 128, 0.1);
          color: #6b7280;
        }

        .latency-baseline { color: #9ca3af; }

        .delta-badge {
          &.delta-improved { background: rgba(16, 185, 129, 0.1); color: #059669; }
          &.delta-improved-slight { background: rgba(16, 185, 129, 0.06); color: #10b981; }
          &.delta-neutral { background: rgba(107, 114, 128, 0.08); color: #6b7280; }
          &.delta-warning { background: rgba(217, 119, 6, 0.1); color: #d97706; }
          &.delta-critical { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
        }
      }
    }
  }
}

// ── Trend chart ───────────────────────────────────────────────────────────
.trend-section {
  flex: 1;                       // fill all remaining vertical space
  min-height: 0;
  display: flex;
  flex-direction: column;

  .section-header { flex-shrink: 0; }

  .trend-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    padding: 24px;
    font-size: 13px;
    color: rgba(255,255,255,0.4);
    border-radius: 8px;
    border: 1px dashed rgba(255,255,255,0.1);

    .trend-empty-icon { opacity: 0.3; margin-bottom: 4px; }
  }

  .trend-error { color: #f87171; border-color: rgba(239,68,68,0.2); }

  // The chart div is always in the DOM so the ref is stable.
  // flex: 1 makes it fill remaining height inside .trend-section.
  .trend-chart {
    flex: 1;
    min-height: 180px;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);

    &.trend-chart--hidden {
      display: none;
    }
  }
}

.body--light .trend-section {
  .trend-state {
    color: rgba(0,0,0,0.4);
    border-color: rgba(0,0,0,0.1);
  }
  .trend-chart {
    border-color: rgba(0,0,0,0.08);
    background: rgba(0,0,0,0.02);
  }
}
</style>

<style lang="scss">
.body--dark .service-graph-edge-side-panel {
  background: #1a1f2e;
  color: #e4e7eb;
  border-left: 1px solid rgba(255,255,255,0.08);
}

.body--light .service-graph-edge-side-panel {
  background: #ffffff;
  color: #333333;
  border-left: 1px solid #e0e0e0;
}
</style>
