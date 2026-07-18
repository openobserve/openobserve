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
      class="service-graph-edge-side-panel absolute right-0 top-0 w-[420px] h-full z-[100] flex flex-col bg-[#1a1f2e] border-l border-[#2d3548] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.5)] overflow-hidden animate-[slideIn_0.3s_ease-out]"
      data-test="service-graph-edge-side-panel"
    >
      <!-- Header -->
      <div
        class="panel-header flex items-center justify-between py-3 px-4 border-b border-[#2d3548] bg-[#1a1f2e] shrink-0"
        data-test="service-graph-edge-side-panel-header"
      >
        <div class="panel-title flex-1 min-w-0">
          <h2
            class="edge-name text-[15px] font-semibold m-0 leading-[1.2] text-[#e4e7eb] tracking-normal flex items-center gap-2 flex-wrap"
            data-test="service-graph-edge-side-panel-route"
          >
            <span class="from-service text-[#60a5fa] overflow-hidden text-ellipsis whitespace-nowrap">{{ selectedEdge?.from }}</span>
            <OIcon name="arrow-forward" size="xs" class="edge-arrow text-[rgba(255,255,255,0.35)] shrink-0" />
            <span class="to-service text-[#a78bfa] overflow-hidden text-ellipsis whitespace-nowrap">{{ selectedEdge?.to }}</span>
            <OTag type="serviceStatus" :value="edgeHealth.status">{{ edgeHealth.text }}</OTag>
          </h2>
        </div>
        <div class="panel-header-actions flex items-center shrink-0">
          <OButton
            variant="ghost"
            size="icon"
            @click="handleClose"
            data-test="service-graph-edge-side-panel-close-btn"
          >
            <OIcon name="close" size="xs" />
          </OButton>
        </div>
      </div>

      <!-- Content -->
      <div
        class="panel-content flex-1 min-h-0 flex flex-col overflow-x-hidden bg-[#0f1419] px-3 pb-3"
      >

        <!-- Metrics Section -->
        <div class="panel-section metrics-section p-0 mt-3" data-test="service-graph-edge-side-panel-metrics">
          <div class="metric-card metric-card-full" data-test="service-graph-edge-side-panel-request-rate">

            <!-- Traffic Summary: Total | Failed | Error Rate -->
            <div class="traffic-row">
              <div class="traffic-pill total" data-test="service-graph-edge-side-panel-total">
                <OIcon name="swap-horiz" size="xs" />
                <span class="traffic-label">{{ t('traces.serviceGraphEdgeSidePanel.total') }}</span>
                <span class="traffic-value">{{ formatNumber(selectedEdge?.total_requests ?? 0) }}</span>
                <OTooltip :content="t('traces.serviceGraphEdgeSidePanel.totalTooltip')" />
              </div>
              <div class="traffic-pill failed" data-test="service-graph-edge-side-panel-failed">
                <OIcon name="close" size="xs" />
                <span class="traffic-label">{{ t('traces.serviceGraphEdgeSidePanel.failed') }}</span>
                <span class="traffic-value">{{ formatNumber(selectedEdge?.failed_requests ?? 0) }}</span>
                <OTooltip :content="t('traces.serviceGraphEdgeSidePanel.failedTooltip')" />
              </div>
              <div
                class="traffic-pill error-rate"
                :class="getErrorRateClass()"
                data-test="service-graph-edge-side-panel-error-rate"
              >
                <OIcon name="error-outline" size="xs" />
                <span class="traffic-label">{{ t('traces.serviceGraphEdgeSidePanel.errorRate') }}</span>
                <span class="traffic-value">{{ errorRateFormatted }}</span>
                <OTooltip :content="t('traces.serviceGraphEdgeSidePanel.errorRateTooltip')" />
              </div>
            </div>

            <div class="metric-horizontal-divider"></div>

            <!-- Latency baseline comparison table: P50 / P95 / P99 vs baseline -->
            <div class="latency-table">
              <div class="latency-header-row">
                <span class="col-metric"></span>
                <span class="col-current">{{ t('traces.serviceGraphEdgeSidePanel.current') }}</span>
                <span class="col-baseline">{{ t('traces.serviceGraphEdgeSidePanel.baseline') }}</span>
                <span class="col-delta">{{ t('traces.serviceGraphEdgeSidePanel.vsBaseline') }}</span>
              </div>

              <!-- P50 -->
              <div
                class="latency-data-row"
                :class="getLatencyClass(p50Latency)"
                data-test="service-graph-edge-side-panel-p50"
              >
                <span class="col-metric"><OTag type="percentileTag" value="p50" /></span>
                <span class="col-current latency-current">{{ p50Latency }}</span>
                <span class="col-baseline latency-baseline">{{ baselineP50 }}</span>
                <span class="col-delta">
                  <OTag type="deltaTrend" :value="getDeltaTrend(p50DeltaPct)">
                    <template #icon>
                      <OIcon
                        :name="p50DeltaPct > 2 ? 'arrow-upward' : p50DeltaPct < -2 ? 'arrow-downward' : 'remove'"
                        size="xs"
                      />
                    </template>
                    {{ p50DeltaFormatted }}
                  </OTag>
                </span>
              </div>

              <!-- P95 -->
              <div
                class="latency-data-row"
                :class="getLatencyClass(p95Latency)"
                data-test="service-graph-edge-side-panel-p95"
              >
                <span class="col-metric"><OTag type="percentileTag" value="p95" /></span>
                <span class="col-current latency-current">{{ p95Latency }}</span>
                <span class="col-baseline latency-baseline">{{ baselineP95 }}</span>
                <span class="col-delta">
                  <OTag type="deltaTrend" :value="getDeltaTrend(p95DeltaPct)">
                    <template #icon>
                      <OIcon
                        :name="p95DeltaPct > 2 ? 'arrow-upward' : p95DeltaPct < -2 ? 'arrow-downward' : 'remove'"
                        size="xs"
                      />
                    </template>
                    {{ p95DeltaFormatted }}
                  </OTag>
                </span>
              </div>

              <!-- P99 -->
              <div
                class="latency-data-row"
                :class="getLatencyClass(p99Latency)"
                data-test="service-graph-edge-side-panel-p99"
              >
                <span class="col-metric"><OTag type="percentileTag" value="p99" /></span>
                <span class="col-current latency-current">{{ p99Latency }}</span>
                <span class="col-baseline latency-baseline">{{ baselineP99 }}</span>
                <span class="col-delta">
                  <OTag type="deltaTrend" :value="getDeltaTrend(p99DeltaPct)">
                    <template #icon>
                      <OIcon
                        :name="p99DeltaPct > 2 ? 'arrow-upward' : p99DeltaPct < -2 ? 'arrow-downward' : 'remove'"
                        size="xs"
                      />
                    </template>
                    {{ p99DeltaFormatted }}
                  </OTag>
                </span>
              </div>
            </div>

          </div>
        </div>

        <!-- RED Chart Section -->
        <div class="panel-section trend-section p-0 mt-3 flex-1 min-h-0 flex flex-col" data-test="service-graph-edge-side-panel-trend">
          <div class="section-header flex items-center justify-between mb-2 shrink-0">
            <!-- R·E·D Tab switcher -->
            <OToggleGroup
              :model-value="activeTab"
              @update:model-value="switchTab($event as ChartTab)"
              data-test="service-graph-edge-chart-tabs"
              size="xs"
            >
              <OToggleGroupItem
                v-for="tab in chartTabs"
                :key="tab.key"
                :value="tab.key"
                :data-test="`service-graph-edge-chart-tab-${tab.key}`"
              >
                {{ tab.label }}
              </OToggleGroupItem>
            </OToggleGroup>
            <span class="shrink-0">
              <OButton
                variant="ghost-muted"
                size="xs"
                @click="loadTrend"
                :loading="trendLoading"
              >
                <template #icon-left>
                  <OIcon name="refresh" size="xs" />
                </template>
                {{ t('traces.serviceGraphEdgeSidePanel.refresh') }}
              </OButton>
            </span>
          </div>

          <!-- Loading -->
          <div v-if="trendLoading" class="trend-state">
            <OSpinner size="xs" />
            <span>{{ t('traces.serviceGraphEdgeSidePanel.loadingData') }}</span>
          </div>

          <!-- Error -->
          <div v-else-if="trendError" class="trend-state trend-error">
            <OIcon name="warning" size="sm" />
            <span>{{ trendError }}</span>
          </div>

          <!-- Empty -->
          <div v-else-if="!trendData || !trendDataPoints.length" class="trend-state trend-empty">
            <OIcon name="show-chart" size="md" class="trend-empty-icon" />
            <span>{{ t('traces.serviceGraphEdgeSidePanel.noDataAvailable') }}</span>
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
import { useI18n } from "vue-i18n";
import * as echarts from 'echarts';
import serviceGraphService from '@/services/service_graph';
import OButton from '@/lib/core/Button/OButton.vue';
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";

type ChartTab = 'rate' | 'errors' | 'duration';

export default defineComponent({
  name: 'ServiceGraphEdgeSidePanel',
  components: { OButton, OToggleGroup, OToggleGroupItem, OSpinner, OTooltip,
    OIcon, OTag,
},
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
    const { t } = useI18n();

    const trendChartRef = ref<HTMLElement | null>(null);
    const trendLoading = ref(false);
    const trendError = ref<string | null>(null);
    const trendData = ref<any>(null);
    let chartInstance: echarts.ECharts | null = null;
    let chartResizeObserver: ResizeObserver | null = null;

    // ── RED tab state ────────────────────────────────────────────────────────

    const chartTabs: { key: ChartTab; label: string }[] = [
      { key: 'rate',     label: t('traces.serviceGraphEdgeSidePanel.rate')     },
      { key: 'errors',   label: t('traces.serviceGraphEdgeSidePanel.errors')   },
      { key: 'duration', label: t('traces.serviceGraphEdgeSidePanel.duration') },
    ];
    const activeTab = ref<ChartTab>('rate');

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
      if (ms < 10) return ms.toFixed(2) + 'ms';
      if (ms < 100) return ms.toFixed(1) + 'ms';
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

    const getDeltaTrend = (pct: number): string => {
      if (Math.abs(pct) < 2) return 'neutral';
      if (pct <= -5) return 'improved';
      if (pct < 0) return 'slight';
      if (pct < 20) return 'warning';
      return 'critical';
    };

    const trendDataPoints = computed<any[]>(
      () => trendData.value?.data_points ?? []
    );

    // ── Health badge ────────────────────────────────────────────────────────

    const edgeHealth = computed(() => {
      const rate = props.selectedEdge?.error_rate ?? 0;
      if (rate > 10) return { status: 'critical', text: t('traces.serviceGraphEdgeSidePanel.critical') };
      if (rate > 5) return { status: 'degraded', text: t('traces.serviceGraphEdgeSidePanel.degraded') };
      return { status: 'healthy', text: t('traces.serviceGraphEdgeSidePanel.healthy') };
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

    // ── ECharts chart builders ──────────────────────────────────────────────

    const disposeChart = () => {
      chartResizeObserver?.disconnect();
      chartResizeObserver = null;
      if (chartInstance) {
        chartInstance.dispose();
        chartInstance = null;
      }
    };

    /** Shared base: timestamps, colors, grid, tooltip base, legend, xAxis */
    const getSharedBase = (points: any[]) => {
      const isDark = store.state.theme === 'dark';
      const textColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)';
      const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      const tooltipBg = isDark ? 'rgba(22,22,26,0.92)' : 'rgba(255,255,255,0.96)';
      const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
      const tooltipText = isDark ? '#e4e7eb' : '#202124';

      // Timestamps are in microseconds (1.77e15). Current time:
      //   nanoseconds  ~1.77e18  → threshold > 1e16 → divide by 1_000_000
      //   microseconds ~1.77e15  → threshold > 1e13 → divide by 1_000
      //   milliseconds ~1.77e12  → threshold > 1e10 → use as-is
      //   seconds      ~1.77e9   → multiply by 1_000
      const toMs = (ts: number) =>
        ts > 1e16 ? ts / 1_000_000   // nanoseconds
        : ts > 1e13 ? ts / 1_000     // microseconds (actual format)
        : ts > 1e10 ? ts             // milliseconds
        : ts * 1_000;                // seconds

      const xAxisLabels = points.map((p) => {
        const d = new Date(toMs(p.timestamp));
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      });
      const tooltipLabels = points.map((p) => {
        const d = new Date(toMs(p.timestamp));
        const date = d.toLocaleDateString('en-CA');
        const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        return `${date} ${time}`;
      });
      const xInterval = Math.max(0, Math.floor(xAxisLabels.length / 3) - 1);

      return {
        isDark, textColor, gridColor, tooltipBg, tooltipBorder, tooltipText,
        xAxisLabels, tooltipLabels, xInterval,
        xAxis: {
          type: 'category',
          data: xAxisLabels,
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textColor, fontSize: 10, interval: xInterval },
          splitLine: { show: false },
        },
        legend: {
          bottom: 0,
          left: 'center',
          textStyle: { color: textColor, fontSize: 11 },
          itemWidth: 12,
          itemHeight: 4,
          icon: 'roundRect',
        },
        baseTooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
            lineStyle: { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' },
          },
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          textStyle: { color: tooltipText, fontSize: 11 },
        },
      };
    };

    /** Rate tab: total_requests over time — line chart matching traces page */
    const buildRateOptions = (points: any[]) => {
      const b = getSharedBase(points);
      const data = points.map((p) => p.total_requests ?? 0);
      const lineColor = '#5470c6';

      return {
        backgroundColor: 'transparent',
        animation: true,
        grid: { left: 44, right: 16, top: 12, bottom: 36 },
        tooltip: {
          ...b.baseTooltip,
          formatter: (params: any[]) => {
            const idx = params[0]?.dataIndex ?? 0;
            const label = b.tooltipLabels[idx] ?? params[0]?.axisValue ?? '';
            const val = params[0]?.value ?? 0;
            return `<div style="font-size:11px;min-width:160px">
              <div style="margin-bottom:4px;opacity:0.6">${label}</div>
              <span style="color:${lineColor}">● </span><span style="font-weight:600">: ${formatNumber(val)}</span>
            </div>`;
          },
        },
        xAxis: b.xAxis,
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: b.textColor,
            fontSize: 10,
            formatter: (v: number) => formatNumber(v),
          },
          splitLine: { lineStyle: { color: b.gridColor } },
        },
        series: [
          {
            name: 'Rate',
            type: 'line',
            data,
            smooth: true,
            symbol: 'none',
            lineStyle: { color: lineColor, width: 1.5 },
            itemStyle: { color: lineColor },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(84,112,198,0.3)' },
                { offset: 1, color: 'rgba(84,112,198,0.02)' },
              ]),
            },
          },
        ],
      };
    };

    /** Errors tab: failed_requests bar chart matching traces page style */
    const buildErrorsOptions = (points: any[]) => {
      const b = getSharedBase(points);
      const failed = points.map((p) => p.failed_requests ?? 0);
      const barColor = '#f44336';

      return {
        backgroundColor: 'transparent',
        animation: true,
        grid: { left: 44, right: 16, top: 12, bottom: 36 },
        tooltip: {
          ...b.baseTooltip,
          formatter: (params: any[]) => {
            const idx = params[0]?.dataIndex ?? 0;
            const label = b.tooltipLabels[idx] ?? params[0]?.axisValue ?? '';
            const val = params[0]?.value ?? 0;
            return `<div style="font-size:11px;min-width:160px">
              <div style="margin-bottom:4px;opacity:0.6">${label}</div>
              <span style="color:${barColor}">● </span><span style="font-weight:600">: ${formatNumber(val)}</span>
            </div>`;
          },
        },
        xAxis: b.xAxis,
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: b.textColor,
            fontSize: 10,
            formatter: (v: number) => formatNumber(v),
          },
          splitLine: { lineStyle: { color: b.gridColor } },
        },
        series: [
          {
            name: 'Errors',
            type: 'bar',
            data: failed,
            barMaxWidth: 8,
            itemStyle: { color: barColor },
          },
        ],
      };
    };

    /** Duration tab: P50/P95/P99 lines matching traces page colors & series names */
    const buildDurationOptions = (points: any[]) => {
      const b = getSharedBase(points);
      const toMs = (ns: number) => ns / 1_000_000;
      const fmtMs = (ms: number) => {
        if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)}m`;
        if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
        return `${ms.toFixed(2)}ms`;
      };

      const p50 = points.map((p) => toMs(p.p50_latency_ns ?? 0));
      const p95 = points.map((p) => toMs(p.p95_latency_ns ?? 0));
      const p99 = points.map((p) => toMs(p.p99_latency_ns ?? 0));

      const makeSeries = (name: string, data: number[], color: string) => ({
        name,
        type: 'line',
        data,
        smooth: true,
        symbol: 'none',
        lineStyle: { color, width: 1.5 },
        itemStyle: { color },
      });

      return {
        backgroundColor: 'transparent',
        animation: true,
        grid: { left: 52, right: 16, top: 12, bottom: 36 },
        tooltip: {
          ...b.baseTooltip,
          formatter: (params: any[]) => {
            const idx = params[0]?.dataIndex ?? 0;
            const label = b.tooltipLabels[idx] ?? params[0]?.axisValue ?? '';
            const rows = params.map((p: any) =>
              `<div style="display:flex;justify-content:space-between;gap:16px;">
                <span style="color:${p.color}">● ${p.seriesName}</span>
                <span style="font-weight:600">: ${fmtMs(p.value)}</span>
              </div>`
            ).join('');
            return `<div style="font-size:11px;min-width:160px">
              <div style="margin-bottom:4px;opacity:0.6">${label}</div>
              ${rows}
            </div>`;
          },
        },
        legend: b.legend,
        xAxis: b.xAxis,
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: b.textColor, fontSize: 10, formatter: fmtMs },
          splitLine: { lineStyle: { color: b.gridColor } },
        },
        series: [
          makeSeries('p99',         p99, '#f44336'),
          makeSeries('p95',         p95, '#ff9800'),
          makeSeries('p50 (Median)', p50, '#4caf50'),
        ],
      };
    };

    /** Dispatch to the correct builder based on active tab */
    const buildChartOptions = (points: any[]) => {
      if (activeTab.value === 'rate') return buildRateOptions(points);
      if (activeTab.value === 'errors') return buildErrorsOptions(points);
      return buildDurationOptions(points);
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
        trendError.value = t('traces.serviceGraphEdgeSidePanel.failedToLoadTrend');
      } finally {
        trendLoading.value = false;
      }
    };

    // Switch tab and re-render immediately if data is already loaded
    const switchTab = async (tab: ChartTab) => {
      activeTab.value = tab;
      if (!trendLoading.value && trendDataPoints.value.length && chartInstance) {
        await nextTick();
        chartInstance.setOption(buildChartOptions(trendDataPoints.value), { notMerge: true });
      }
    };

    // ── Watchers ────────────────────────────────────────────────────────────

    watch(
      () => [props.selectedEdge?.from, props.selectedEdge?.to, props.visible] as const,
      ([ , visible]) => {
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

    // Render once data arrives (chart div becomes visible after loading=false)
    watch(trendLoading, async (isLoading) => {
      if (!isLoading && trendData.value && trendDataPoints.value.length) {
        await nextTick();
        renderChart();
      }
    });

    // Re-render when dark mode toggles
    watch(
      () => store.state.theme === 'dark',
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
      t,
      trendChartRef,
      trendLoading,
      trendError,
      trendData,
      trendDataPoints,
      chartTabs,
      activeTab,
      switchTab,
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
      getDeltaTrend,
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

<style>
@keyframes slideIn {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-enter-from,
.slide-leave-to { transform: translateX(100%); }
.slide-enter-to,
.slide-leave-from { transform: translateX(0); }

/* Header descendant selectors */
.panel-header .panel-title {
  flex: 1;
  min-width: 0;
}

.panel-header .edge-name .health-badge::before {
  content: '●';
  font-size: 10px;
}

.panel-header .edge-name .health-badge.healthy  { background: rgba(16,185,129,0.15); color: #10b981; }
.panel-header .edge-name .health-badge.degraded { background: rgba(251,191,36,0.15);  color: #fbbf24; }
.panel-header .edge-name .health-badge.critical { background: rgba(239,68,68,0.15);   color: #ef4444; }

.body--light .panel-header {
  border-bottom: 1px solid var(--o2-border);
  background: #f5f5f5;
}

.body--light .panel-header .edge-name {
  color: #202124;
}

.body--light .panel-header .edge-name .from-service { color: #1d4ed8; }
.body--light .panel-header .edge-name .to-service   { color: #6d28d9; }
.body--light .panel-header .edge-name .edge-arrow   { color: rgba(0,0,0,0.3); }

.body--light .panel-header .edge-name .health-badge.healthy  { background: rgba(16,185,129,0.08); color: #059669; }
.body--light .panel-header .edge-name .health-badge.degraded { background: rgba(251,191,36,0.08); color: #d97706; }
.body--light .panel-header .edge-name .health-badge.critical { background: rgba(239,68,68,0.08);  color: #dc2626; }

/* Scrollbar pseudo-elements */
.panel-content::-webkit-scrollbar { width: 6px; }
.panel-content::-webkit-scrollbar-track { background: #1a1f2e; }
.panel-content::-webkit-scrollbar-thumb {
  background: #242938;
  border-radius: 3px;
}
.panel-content::-webkit-scrollbar-thumb:hover { background: #2d3548; }

.body--light .panel-content {
  background: #ffffff;
}
.body--light .panel-content::-webkit-scrollbar-track { background: #f8f9fa; }
.body--light .panel-content::-webkit-scrollbar-thumb { background: var(--o2-border); }
.body--light .panel-content::-webkit-scrollbar-thumb:hover { background: #d0d0d0; }

/* Metric card — descendant selectors */
.metrics-section .metric-card-full {
  padding: 10px 12px;
  border-radius: 8px;
  background: linear-gradient(135deg, #242938 0%, #1f2937 100%);
  border: 1px solid #374151;
  margin-bottom: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.metrics-section .metric-card-full:hover {
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(99, 102, 241, 0.3);
  border-color: rgba(99, 102, 241, 0.4);
}

.metrics-section .metric-card-full .metric-horizontal-divider {
  width: 100%;
  height: 1px;
  background: #374151;
  margin: 10px 0 8px 0;
}

/* Traffic Summary row */
.metrics-section .metric-card-full .traffic-row {
  display: flex;
  gap: 6px;
}

.metrics-section .metric-card-full .traffic-row .traffic-pill {
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
}

.metrics-section .metric-card-full .traffic-row .traffic-pill .traffic-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1;
  opacity: 0.65;
}

.metrics-section .metric-card-full .traffic-row .traffic-pill .traffic-value {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
}

.metrics-section .metric-card-full .traffic-row .traffic-pill.total {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.02));
  border-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}
.metrics-section .metric-card-full .traffic-row .traffic-pill.total .traffic-value { color: #c7d2fe; }
.metrics-section .metric-card-full .traffic-row .traffic-pill.total:hover { box-shadow: 0 0 8px rgba(99, 102, 241, 0.2); }

.metrics-section .metric-card-full .traffic-row .traffic-pill.failed {
  background: linear-gradient(135deg, rgba(107, 114, 128, 0.1), rgba(107, 114, 128, 0.02));
  border-color: rgba(107, 114, 128, 0.2);
  color: #9ca3af;
}
.metrics-section .metric-card-full .traffic-row .traffic-pill.failed .traffic-value { color: #d1d5db; }

.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-healthy {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02));
  border-color: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}
.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-healthy .traffic-value { color: #10b981; }
.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-healthy:hover { box-shadow: 0 0 8px rgba(16, 185, 129, 0.2); }

.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-warning {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(251, 191, 36, 0.02));
  border-color: rgba(251, 191, 36, 0.2);
  color: #fde68a;
}
.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-warning .traffic-value { color: #fbbf24; }
.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-warning:hover { box-shadow: 0 0 8px rgba(251, 191, 36, 0.2); }

.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-critical {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02));
  border-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-critical .traffic-value { color: #ef4444; }
.metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-critical:hover { box-shadow: 0 0 8px rgba(239, 68, 68, 0.2); }

/* Latency baseline comparison table */
.metrics-section .metric-card-full .latency-table .latency-header-row {
  display: grid;
  grid-template-columns: 44px 1fr 1fr 1fr;
  gap: 4px;
  padding: 2px 6px 4px;
}

.metrics-section .metric-card-full .latency-table .latency-header-row span {
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  letter-spacing: 0.04em;
}

.metrics-section .metric-card-full .latency-table .latency-header-row .col-current,
.metrics-section .metric-card-full .latency-table .latency-header-row .col-baseline,
.metrics-section .metric-card-full .latency-table .latency-header-row .col-delta { text-align: right; }

.metrics-section .metric-card-full .latency-table .latency-data-row {
  display: grid;
  grid-template-columns: 44px 1fr 1fr 1fr;
  gap: 4px;
  padding: 6px 6px;
  border-radius: 5px;
  margin-bottom: 3px;
  align-items: center;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.metrics-section .metric-card-full .latency-table .latency-data-row:last-child { margin-bottom: 0; }

.metrics-section .metric-card-full .latency-table .latency-data-row.status-healthy {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.01));
  border-color: rgba(16, 185, 129, 0.12);
}
.metrics-section .metric-card-full .latency-table .latency-data-row.status-healthy .latency-current { color: #10b981; }
.metrics-section .metric-card-full .latency-table .latency-data-row.status-healthy:hover { background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02)); }

.metrics-section .metric-card-full .latency-table .latency-data-row.status-warning {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(251, 191, 36, 0.01));
  border-color: rgba(251, 191, 36, 0.12);
}
.metrics-section .metric-card-full .latency-table .latency-data-row.status-warning .latency-current { color: #fbbf24; }
.metrics-section .metric-card-full .latency-table .latency-data-row.status-warning:hover { background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(251, 191, 36, 0.02)); }

.metrics-section .metric-card-full .latency-table .latency-data-row.status-critical {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), rgba(239, 68, 68, 0.01));
  border-color: rgba(239, 68, 68, 0.12);
}
.metrics-section .metric-card-full .latency-table .latency-data-row.status-critical .latency-current { color: #ef4444; }
.metrics-section .metric-card-full .latency-table .latency-data-row.status-critical:hover { background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02)); }

.metrics-section .metric-card-full .latency-table .latency-data-row.status-unknown {
  background: rgba(107, 114, 128, 0.04);
  border-color: rgba(107, 114, 128, 0.1);
}
.metrics-section .metric-card-full .latency-table .latency-data-row.status-unknown .latency-current { color: #9ca3af; }

.metrics-section .metric-card-full .latency-table .latency-data-row .col-current,
.metrics-section .metric-card-full .latency-table .latency-data-row .col-baseline,
.metrics-section .metric-card-full .latency-table .latency-data-row .col-delta { text-align: right; }

.metrics-section .metric-card-full .latency-table .latency-data-row .percentile-badge {
  font-size: 11px;
  font-weight: 700;
  color: #9ca3af;
  background: rgba(107, 114, 128, 0.14);
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.03em;
}

.metrics-section .metric-card-full .latency-table .latency-data-row .latency-current {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.metrics-section .metric-card-full .latency-table .latency-data-row .latency-baseline {
  font-size: 11px;
  font-weight: 500;
  color: #9ca3af;
}

.metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-improved       { background: rgba(16, 185, 129, 0.14); color: #10b981; }
.metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-improved-slight { background: rgba(16, 185, 129, 0.08); color: #34d399; }
.metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-neutral        { background: rgba(107, 114, 128, 0.12); color: #6b7280; }
.metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-warning        { background: rgba(251, 191, 36, 0.14);  color: #fbbf24; }
.metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-critical       { background: rgba(239, 68, 68, 0.14);   color: #ef4444; }

/* Light mode metric card */
.body--light .metrics-section .metric-card-full {
  background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
  border-color: #d1d5db;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.body--light .metrics-section .metric-card-full:hover {
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.3);
}

.body--light .metrics-section .metric-card-full .metric-horizontal-divider { background: #e5e7eb; }

.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.total {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(99, 102, 241, 0.01));
  border-color: rgba(99, 102, 241, 0.2);
  color: #6366f1;
}
.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.total .traffic-value { color: #4338ca; }

.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.failed {
  background: linear-gradient(135deg, rgba(107, 114, 128, 0.06), rgba(107, 114, 128, 0.01));
  border-color: rgba(107, 114, 128, 0.15);
  color: #6b7280;
}
.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.failed .traffic-value { color: #374151; }

.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-healthy {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(16, 185, 129, 0.01));
  border-color: rgba(16, 185, 129, 0.2);
  color: #059669;
}
.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-healthy .traffic-value { color: #047857; }

.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-warning {
  background: linear-gradient(135deg, rgba(217, 119, 6, 0.06), rgba(217, 119, 6, 0.01));
  border-color: rgba(217, 119, 6, 0.2);
  color: #d97706;
}
.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-warning .traffic-value { color: #b45309; }

.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-critical {
  background: linear-gradient(135deg, rgba(220, 38, 38, 0.06), rgba(220, 38, 38, 0.01));
  border-color: rgba(220, 38, 38, 0.2);
  color: #dc2626;
}
.body--light .metrics-section .metric-card-full .traffic-row .traffic-pill.error-rate.status-critical .traffic-value { color: #b91c1c; }

.body--light .metrics-section .metric-card-full .latency-table .latency-header-row span { color: #9ca3af; }

.body--light .metrics-section .metric-card-full .latency-table .latency-data-row.status-healthy {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(16, 185, 129, 0.01));
  border-color: rgba(16, 185, 129, 0.15);
}
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row.status-healthy .latency-current { color: #059669; }

.body--light .metrics-section .metric-card-full .latency-table .latency-data-row.status-warning {
  background: linear-gradient(135deg, rgba(217, 119, 6, 0.04), rgba(217, 119, 6, 0.01));
  border-color: rgba(217, 119, 6, 0.15);
}
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row.status-warning .latency-current { color: #d97706; }

.body--light .metrics-section .metric-card-full .latency-table .latency-data-row.status-critical {
  background: linear-gradient(135deg, rgba(220, 38, 38, 0.04), rgba(220, 38, 38, 0.01));
  border-color: rgba(220, 38, 38, 0.15);
}
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row.status-critical .latency-current { color: #dc2626; }

.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .percentile-badge { background: rgba(107, 114, 128, 0.1); color: #6b7280; }
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .latency-baseline { color: #6b7280; }

.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-improved       { background: rgba(16, 185, 129, 0.1);  color: #059669; }
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-improved-slight { background: rgba(16, 185, 129, 0.06); color: #10b981; }
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-neutral        { background: rgba(107, 114, 128, 0.08); color: #6b7280; }
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-warning        { background: rgba(217, 119, 6, 0.1);    color: #d97706; }
.body--light .metrics-section .metric-card-full .latency-table .latency-data-row .delta-badge.delta-critical       { background: rgba(220, 38, 38, 0.1);    color: #dc2626; }

/* Trend chart — descendant selectors */
.trend-section .section-header { flex-shrink: 0; }

.trend-section .trend-state {
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
}

.trend-section .trend-state .trend-empty-icon { opacity: 0.3; margin-bottom: 4px; }

.trend-section .trend-error { color: #f87171; border-color: rgba(239,68,68,0.2); }

.trend-section .trend-chart {
  flex: 1;
  min-height: 180px;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
}

.trend-section .trend-chart.trend-chart--hidden { display: none; }

.body--light .trend-section .trend-state {
  color: rgba(0,0,0,0.4);
  border-color: rgba(0,0,0,0.1);
}
.body--light .trend-section .trend-chart {
  border-color: rgba(0,0,0,0.08);
  background: rgba(0,0,0,0.02);
}

.body--dark .service-graph-edge-side-panel {
  background: #1a1f2e;
  color: #e4e7eb;
  border-left: 1px solid rgba(255,255,255,0.08);
}

.body--light .service-graph-edge-side-panel {
  background: #ffffff;
  color: #333333;
  border-left: 1px solid var(--o2-border);
}
</style>
