<template>
  <q-card flat class="tw:h-full">
    <q-card-section class="tw:p-[0.375rem] tw:h-full card-container service-graph-container">
      <!-- Top row with search and control buttons -->
      <div class="row items-center q-col-gutter-sm q-mb-md">
        <div class="col-12 col-md-5 tw:flex tw:gap-[0.5rem]">
          <!-- Stream selector - synced from traces page, no "All Streams" -->
          <q-select
            v-model="streamFilter"
            :options="
              availableStreams.length > 0
                ? availableStreams.map((s) => ({ label: s, value: s }))
                : []
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

          <!-- 4. Layout dropdown (only meaningful for tree view) -->
          <q-select
            v-model="layoutType"
            :options="layoutOptions"
            dense
            borderless
            class="tw:w-[160px]"
            emit-value
            map-options
            @update:model-value="setLayout"
            :disable="visualizationType === 'graph'"
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
                render-type="svg"
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
import { defineComponent, ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from "vue";
import * as echarts from "echarts";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import serviceGraphService from "@/services/service_graph";
import AppTabs from "@/components/common/AppTabs.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import DateTime from "@/components/DateTime.vue";
import ServiceGraphSidePanel from "./ServiceGraphSidePanel.vue";
import {
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
} from "@/utils/traces/convertTraceData";
import {
  formatNumber,
  formatLatency,
  pointToBezierDistance,
  generateNodeTooltipContent,
  generateEdgeTooltipContent,
  findIncomingEdgeForNode,
  calculateRootNodeMetrics,
} from "@/utils/traces/treeTooltipHelpers";
import useStreams from "@/composables/useStreams";
import useTraces from "@/composables/useTraces";


export default defineComponent({
  name: "ServiceGraph",
  components: {
    AppTabs,
    ChartRenderer,
    DateTime,
    ServiceGraphSidePanel,
  },
  emits: [],
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

    // Map of "from->to" -> { p50_avg, p95_avg, p99_avg } — populated on edge hover
    const edgeBaselines = ref<Map<string, { p50_avg: number; p95_avg: number; p99_avg: number }>>(new Map());

    // Persist visualization type in localStorage
    const storedVisualizationType = localStorage.getItem(
      "serviceGraph_visualizationType",
    );
    const visualizationType = ref<"tree" | "graph">(
      (storedVisualizationType as "tree" | "graph") || "tree",
    );

    // Visualization tabs configuration
    const visualizationTabs = [
      { label: "Tree View", value: "tree" },
      { label: "Graph View", value: "graph" },
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

    // Stream filter — synced from traces page selected stream
    const tracesStream = searchObj.data.stream?.selectedStream?.value || '';
    const storedStreamFilter = localStorage.getItem(
      "serviceGraph_streamFilter",
    );
    const streamFilter = ref(tracesStream || storedStreamFilter || "default");
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
        ];
      } else {
        return [
          { label: "Force Directed", value: "force" },
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
      // BUT only if no filters are active and no new baselines have arrived
      if (visualizationType.value === "graph" &&
          lastChartOptions.value &&
          chartKey.value === lastChartOptions.value.key &&
          edgeBaselines.value.size === (lastChartOptions.value.baselineCount ?? 0) &&
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
              $q.dark.isActive,
              edgeBaselines.value,
            )
          : convertServiceGraphToNetwork(
              filteredGraphData.value,
              layoutType.value,
              new Map(), // Empty position cache to allow free movement
              $q.dark.isActive, // Pass dark mode state
              undefined, // Don't pass selected node - we'll use dispatchAction instead
              edgeBaselines.value,
            );

      // Cache the options for graph view
      // BUT only if no filters are active (to avoid caching filtered states)
      if (visualizationType.value === "graph" && !hasActiveFilters) {
        lastChartOptions.value = {
          key: chartKey.value,
          data: newOptions,
          baselineCount: edgeBaselines.value.size,
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

    // --- Tree edge tooltip: show node tooltip when hovering edge lines ---
    let edgeTooltipCleanup: (() => void) | null = null;
    let pendingTooltipSetup: ReturnType<typeof setTimeout> | null = null;

    // Shared across ALL setupTreeEdgeTooltips invocations so multiple registrations
    // (due to chart re-renders) share one debounce timer and one in-flight guard.
    const edgeTrendCache = new Map<string, any>();
    const fetchingEdges = new Set<string>();
    let sharedTrendFetchTimer: ReturnType<typeof setTimeout> | null = null;
    let sharedCurrentHoverEdgeKey: string | null = null;
    let sharedTooltipChart: any = null;

    const setupTreeEdgeTooltips = (chart: any) => {
      const zr = chart.getZr();
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      // Custom tooltip element — node tooltips use innerHTML, edge tooltips use an ECharts mini chart
      const tooltipEl = document.createElement('div');
      const isDarkInit = $q.dark.isActive;
      tooltipEl.style.cssText = `
        position: absolute; pointer-events: none; z-index: 9999;
        background: ${isDarkInit ? 'rgba(22, 22, 26, 0.90)' : 'rgba(255, 255, 255, 0.88)'};
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid ${isDarkInit ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'};
        border-radius: 14px;
        display: none;
        box-shadow: 0 12px 40px rgba(0,0,0,${isDarkInit ? '0.5' : '0.14'}), 0 1px 0 rgba(255,255,255,${isDarkInit ? '0.04' : '0'}) inset;
        overflow: hidden;
      `;
      const chartDom = chart.getDom();
      if (!chartDom.style.position || chartDom.style.position === 'static') {
        chartDom.style.position = 'relative';
      }
      chartDom.appendChild(tooltipEl);

      // Keep tooltip open when user hovers over it (for button interaction)
      tooltipEl.addEventListener('mouseenter', () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      });
      tooltipEl.addEventListener('mouseleave', () => {
        if (!hideTimer) {
          hideTimer = setTimeout(() => {
            hideTimer = null;
            activeKey = null;
            hideTooltip();
          }, 150);
        }
      });

      // "Show trend" button click — load history on demand
      tooltipEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-show-trend]') as HTMLElement | null;
        if (!btn) return;
        loadAndShowTrend(btn.dataset.parent ?? '', btn.dataset.child ?? '');
      });

      const getOrgId = () => store.state.selectedOrganization?.identifier ?? '';
      // Last known mouse position — used to reposition after async chart render
      let lastMouseX = 0, lastMouseY = 0;

      // Grid geometry constants — must match the grid config passed to ECharts
      const CHART_W = 280, CHART_H = 160;
      // right: 38 leaves room for P99/P95/P50 labels outside the plot area
      const GRID = { left: 42, right: 38, top: 10, bottom: 22 };

      const buildSparkOptions = (trendData: any) => {
        const points = trendData?.data_points ?? [];
        const isDark = $q.dark.isActive;
        const toMs = (ns: number) => ns / 1_000_000;
        const last = points.length - 1;
        const sf = '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';

        // Use purple-blue-teal gradient to avoid red=danger, green=good semantic confusion
        const COLORS = { p99: '#8B5CF6', p95: '#3B82F6', p50: '#06B6D4' };

        const hexArea = (hex: string, alpha: number) => {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return {
            type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `rgba(${r},${g},${b},${alpha})` },
              { offset: 1, color: `rgba(${r},${g},${b},0)` },
            ],
          };
        };

        // Latency formatter for y-axis labels and hover tooltip
        const fmtMs = (ms: number) =>
          ms >= 1000 ? `${(ms / 1000).toFixed(2)}s`
          : ms >= 1   ? `${Math.round(ms)}ms`
          : `${(ms * 1000).toFixed(0)}μs`;

        // Explicit y-range so manual label math matches ECharts exactly
        const allY = points.flatMap((p: any) => [
          toMs(p.p99_latency_ns), toMs(p.p95_latency_ns), toMs(p.p50_latency_ns),
        ]);
        const rawMin = allY.length ? Math.min(...allY) : 0;
        const rawMax = allY.length ? Math.max(...allY) : 1;
        const pad = (rawMax - rawMin) * 0.18 || rawMax * 0.18 || 1;
        const yMin = Math.max(0, rawMin - pad);
        const yMax = rawMax + pad;

        // Right-side identity labels aligned to the LAST data point of each series
        const plotH = CHART_H - GRID.top - GRID.bottom;
        const yToPixel = (val: number) => GRID.top + plotH * (1 - (val - yMin) / (yMax - yMin));
        const labelX = CHART_W - GRID.right + 6; // just past the right edge of the plot area

        const rightLabels = points.length
          ? [
              { name: 'P99', val: toMs(points[last].p99_latency_ns), color: COLORS.p99 },
              { name: 'P95', val: toMs(points[last].p95_latency_ns), color: COLORS.p95 },
              { name: 'P50', val: toMs(points[last].p50_latency_ns), color: COLORS.p50 },
            ].map(({ name, val, color }) => ({
              type: 'text',
              x: labelX,
              y: yToPixel(val),
              style: { text: name, fill: color, fontSize: 10, fontWeight: 700, fontFamily: sf, textBaseline: 'middle' },
              z: 10,
            }))
          : [];

        // Corner time labels
        const first = points[0];
        const ageMs = first ? Date.now() - Math.round(first.timestamp / 1000) : 0;
        const ageH = ageMs / 3_600_000;
        const startLabel =
          ageH >= 23.5 ? '24h ago'
          : ageH >= 1  ? `${Math.round(ageH)}h ago`
          : `${Math.round(ageMs / 60_000)}m ago`;
        const cornerColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.52)';
        const cornerLabels = [
          { type: 'text', left: GRID.left, bottom: 3, style: { text: startLabel, fill: cornerColor, fontSize: 9, fontFamily: sf } },
          { type: 'text', right: GRID.right, bottom: 3, style: { text: 'now →', fill: cornerColor, fontSize: 9, fontFamily: sf } },
        ];

        const makeSeries = (name: string, color: string, getter: (p: any) => number) => ({
          name, type: 'line', smooth: 0.5,
          data: points.map((p: any, i: number) => ({
            value: [Math.round(p.timestamp / 1000), toMs(getter(p))],
            symbol: i === last ? 'circle' : 'none',
            symbolSize: i === last ? 6 : 0,
          })),
          lineStyle: { color, width: 1.5, cap: 'round' },
          itemStyle: { color },
          areaStyle: { color: hexArea(color, 0.15), origin: 'auto' },
          label: { show: false },
        });

        return {
          backgroundColor: 'transparent',
          animation: false,
          grid: { left: GRID.left, right: GRID.right, top: GRID.top, bottom: GRID.bottom },
          tooltip: {
            show: true,
            trigger: 'axis',
            axisPointer: {
              type: 'line',
              lineStyle: { color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)', type: 'dashed', width: 1 },
            },
            backgroundColor: isDark ? 'rgba(28,28,32,0.95)' : 'rgba(255,255,255,0.96)',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
            borderRadius: 8,
            padding: [6, 10],
            textStyle: { color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)', fontSize: 11, fontFamily: sf },
            formatter: (params: any[]) => {
              const t = new Date(params[0].value[0]);
              const ts = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
              const lines = params.map((p: any) =>
                `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${p.color};margin-right:5px;vertical-align:middle"></span>${p.seriesName}: <b>${fmtMs(p.value[1])}</b>`
              );
              return `<div style="font-size:10px;opacity:0.55;margin-bottom:3px">${ts}</div>${lines.join('<br>')}`;
            },
          },
          xAxis: {
            type: 'time',
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { show: false }, axisLabel: { show: false },
          },
          yAxis: {
            type: 'value',
            min: yMin, max: yMax,
            axisLine: { show: false }, axisTick: { show: false },
            axisLabel: {
              show: true,
              inside: false,
              color: isDark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.52)',
              fontSize: 9,
              fontFamily: sf,
              margin: 4,
              formatter: fmtMs,
            },
            splitNumber: 3,
            splitLine: {
              show: true,
              lineStyle: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', width: 1 },
            },
          },
          graphic: [...rightLabels, ...cornerLabels],
          series: [
            makeSeries('P99', COLORS.p99, (p) => p.p99_latency_ns),
            makeSeries('P95', COLORS.p95, (p) => p.p95_latency_ns),
            makeSeries('P50', COLORS.p50, (p) => p.p50_latency_ns),
          ],
          _yMin: yMin,
          _yMax: yMax,
        } as any;
      };

      const renderTrendChart = (trendData: any) => {
        tooltipEl.style.padding = '0';
        tooltipEl.style.width = `${CHART_W}px`;
        tooltipEl.style.height = `${CHART_H}px`;
        // Allow pointer events so ECharts can receive hover for its built-in tooltip
        tooltipEl.style.pointerEvents = 'auto';

        if (!sharedTooltipChart) {
          tooltipEl.innerHTML = '';
          sharedTooltipChart = echarts.init(tooltipEl, undefined, { renderer: 'canvas', width: CHART_W, height: CHART_H, devicePixelRatio: window.devicePixelRatio || 1 });
        }

        const opts = buildSparkOptions(trendData);
        delete opts._yMin;
        delete opts._yMax;
        sharedTooltipChart.setOption(opts, true);
      };

      const showLoadingTooltip = () => {
        if (sharedTooltipChart) { sharedTooltipChart.dispose(); sharedTooltipChart = null; }
        tooltipEl.style.pointerEvents = 'none'; // loading state doesn't need hover
        tooltipEl.style.width = `${CHART_W}px`;
        tooltipEl.style.height = `${CHART_H}px`;
        tooltipEl.style.padding = '0';
        const loaderColor = $q.dark.isActive ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
        tooltipEl.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;letter-spacing:0.02em;color:${loaderColor};font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;">Loading…</div>`;
      };

      // Cached edge data: bezier shapes + parent/child names
      let edgesGroupEl: any = null;
      let bezierEdges: Array<{
        shape: any;
        childName: string;
        parentName: string;
      }> = [];
      let nodePositions: Array<{ idx: number; x: number; y: number; name: string }> = [];

      // Robust child access — handles children(), _children, or childAt/childCount
      const getChildren = (group: any): any[] => {
        if (typeof group.children === 'function') return group.children();
        if (Array.isArray(group._children)) return group._children;
        const count = typeof group.childCount === 'function' ? group.childCount() : 0;
        const result: any[] = [];
        for (let i = 0; i < count; i++) {
          const c = group.childAt?.(i);
          if (c) result.push(c);
        }
        return result;
      };

      // Check if a group contains bezier-curve children
      const hasBezierChildren = (group: any): boolean => {
        const kids = getChildren(group);
        return kids.some((c: any) => c.type === 'bezier-curve');
      };

      // Recursively search for a group containing bezier-curve elements
      const findBezierGroup = (el: any, depth = 0): any => {
        if (!el || depth > 6) return null;
        if (el.type === 'group' && hasBezierChildren(el)) return el;
        for (const child of getChildren(el)) {
          const found = findBezierGroup(child, depth + 1);
          if (found) return found;
        }
        return null;
      };

      // Build into local vars, then atomic-swap so onMouseMove never sees partial state
      const buildEdgeData = () => {
        const newBezierEdges: typeof bezierEdges = [];
        const newNodePositions: typeof nodePositions = [];
        let newEdgesGroupEl: any = null;

        try {
          const series = chart.getModel()?.getSeriesByIndex(0);
          if (!series) return;
          const data = series.getData();
          const count = data.count();

          // Collect node layout positions + names
          for (let i = 0; i < count; i++) {
            const layout = data.getItemLayout(i);
            if (layout) {
              newNodePositions.push({ idx: i, x: layout.x, y: layout.y, name: data.getName(i) });
            }
          }

          // Find first node with a graphic element (node 0 may be invisible virtual root)
          let firstNodeEl = null;
          for (let i = 0; i < count; i++) {
            firstNodeEl = data.getItemGraphicEl(i);
            if (firstNodeEl) break;
          }
          if (!firstNodeEl) return;

          // Walk up from node, search siblings at each level for bezier-curve group
          let current = firstNodeEl;
          while (current?.parent && !newEdgesGroupEl) {
            const parent = current.parent;
            for (const sibling of getChildren(parent)) {
              if (sibling === current) continue;
              if (sibling.type === 'group' && hasBezierChildren(sibling)) {
                newEdgesGroupEl = sibling;
                break;
              }
            }
            current = parent;
          }

          // Fallback: recursive search from ZRender root
          if (!newEdgesGroupEl) {
            const zrStorage = zr.storage;
            const roots = zrStorage?.getRoots?.() || zrStorage?._roots || [];
            for (const root of roots) {
              newEdgesGroupEl = findBezierGroup(root);
              if (newEdgesGroupEl) break;
            }
          }

          if (!newEdgesGroupEl) return;

          // Collect bezier shapes + match endpoints to node names
          for (const bezier of getChildren(newEdgesGroupEl)) {
            if (bezier.type !== 'bezier-curve' || !bezier.shape) continue;
            const { x1, y1, x2, y2 } = bezier.shape;

            let parentName = '';
            let pDist = Infinity;
            let childName = '';
            let cDist = Infinity;
            for (const np of newNodePositions) {
              const dp = Math.hypot(np.x - x1, np.y - y1);
              if (dp < pDist) { pDist = dp; parentName = np.name; }
              const dc = Math.hypot(np.x - x2, np.y - y2);
              if (dc < cDist) { cDist = dc; childName = np.name; }
            }
            newBezierEdges.push({ shape: { ...bezier.shape }, childName, parentName });
          }
        } catch {
          return; // Keep previous good data on error
        }

        // Only swap if we got valid data — never clear good data with empty
        if (newEdgesGroupEl && newBezierEdges.length > 0) {
          edgesGroupEl = newEdgesGroupEl;
          bezierEdges = newBezierEdges;
          nodePositions = newNodePositions;
        }
      };

      // Debounce: only rebuild 200ms after the last `finished` event
      // (avoids rebuilding during animation frames where shapes are intermediate)
      let buildTimer: ReturnType<typeof setTimeout> | null = null;
      const debouncedBuild = () => {
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(buildEdgeData, 200);
      };
      chart.on('finished', debouncedBuild);
      // Also try immediately (works if chart already rendered)
      buildEdgeData();

      // Use imported helper functions for testability

      // Position and show the tooltip at mouse coords
      const positionTooltip = (mouseX: number, mouseY: number) => {
        const cw = chartDom.clientWidth;
        const ch = chartDom.clientHeight;
        let left = mouseX + 15;
        let top = mouseY + 15;
        tooltipEl.style.display = 'block';
        if (left + tooltipEl.offsetWidth > cw) left = mouseX - tooltipEl.offsetWidth - 10;
        if (top + tooltipEl.offsetHeight > ch) top = mouseY - tooltipEl.offsetHeight - 10;
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
      };

      const resetToTextTooltip = () => {
        if (sharedTooltipChart) { sharedTooltipChart.dispose(); sharedTooltipChart = null; }
        tooltipEl.style.pointerEvents = 'none'; // node tooltips don't need hover
        tooltipEl.style.width = '';
        tooltipEl.style.height = '';
        tooltipEl.style.padding = '9px 13px';
        tooltipEl.style.fontSize = '12px';
        tooltipEl.style.lineHeight = '1.5';
        tooltipEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
        tooltipEl.style.letterSpacing = '0.01em';
        tooltipEl.style.whiteSpace = 'nowrap';
        tooltipEl.style.color = $q.dark.isActive ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
      };

      const showNodeTooltip = (mouseX: number, mouseY: number, nodeName: string) => {
        resetToTextTooltip();
        const edges = graphData.value?.edges || [];

        // Find incoming edge for this node (direction-aware, matches tree label)
        const incomingBezier = bezierEdges.find(b => b.childName === nodeName);
        if (incomingBezier) {
          const edge = findIncomingEdgeForNode(nodeName, incomingBezier.parentName, edges);
          if (edge) {
            const total = edge.total_requests || 0;
            const failed = edge.failed_requests || 0;
            const errRate = edge.error_rate ?? (total > 0 ? (failed / total) * 100 : 0);
            tooltipEl.innerHTML = generateNodeTooltipContent(nodeName, total, failed, errRate);
            positionTooltip(mouseX, mouseY);
            return;
          }
        }

        // Root node or no incoming edge: sum outgoing edges
        const metrics = calculateRootNodeMetrics(nodeName, edges);
        if (metrics.requests > 0) {
          tooltipEl.innerHTML = generateNodeTooltipContent(
            nodeName,
            metrics.requests,
            metrics.errors,
            metrics.errorRate
          );
          positionTooltip(mouseX, mouseY);
          return;
        }

        // Fallback: use node aggregate
        const nodes = graphData.value?.nodes || [];
        const node = nodes.find((n: any) => (n.label || n.id) === nodeName);
        if (!node) { tooltipEl.style.display = 'none'; return; }

        const requests = node.requests || 0;
        const errors = node.errors || 0;
        const errRate = node.error_rate ?? (requests > 0 ? (errors / requests) * 100 : 0);
        tooltipEl.innerHTML = generateNodeTooltipContent(nodeName, requests, errors, errRate);
        positionTooltip(mouseX, mouseY);
      };

      const showStatsTooltip = (mouseX: number, mouseY: number, parentName: string, childName: string) => {
        const edges = graphData.value?.edges || [];
        const edge = findIncomingEdgeForNode(childName, parentName, edges);
        if (!edge) { tooltipEl.style.display = 'none'; return; }

        resetToTextTooltip();
        // edge tooltip needs pointer-events:auto for the button to be clickable
        tooltipEl.style.pointerEvents = 'auto';

        const total = edge.total_requests || 0;
        const failed = edge.failed_requests || 0;
        const errRate = edge.error_rate ?? (total > 0 ? (failed / total) * 100 : 0);
        const statsHtml = generateEdgeTooltipContent(total, failed, errRate, edge.p50_latency_ns, edge.p95_latency_ns, edge.p99_latency_ns);
        const isDark = $q.dark.isActive;
        const btnStyle = [
          'margin-top:6px;padding-top:6px;border-top:1px solid',
          isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
        ].join(' ');
        const btnElStyle = [
          'cursor:pointer;background:transparent;border:1px solid',
          isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
          ';border-radius:5px;padding:2px 8px;font-size:10px;font-family:inherit;',
          'color:', isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)',
          ';letter-spacing:0.02em;',
        ].join('');

        tooltipEl.innerHTML = `
          ${statsHtml}
          <div style="${btnStyle}">
            <button data-show-trend data-parent="${parentName}" data-child="${childName}" style="${btnElStyle}">
              Show trend ↗
            </button>
          </div>`;
        positionTooltip(mouseX, mouseY);
      };

      const loadAndShowTrend = async (parentName: string, childName: string) => {
        const edgeKey = `${parentName}->${childName}`;
        sharedCurrentHoverEdgeKey = edgeKey;

        if (edgeTrendCache.has(edgeKey)) {
          renderTrendChart(edgeTrendCache.get(edgeKey));
          positionTooltip(lastMouseX, lastMouseY);
          return;
        }
        if (fetchingEdges.has(edgeKey)) return;

        showLoadingTooltip();
        positionTooltip(lastMouseX, lastMouseY);
        fetchingEdges.add(edgeKey);
        try {
          const orgId = getOrgId();
          if (!orgId) return;
          const res = await serviceGraphService.getEdgeHistory(orgId, {
            client_service: parentName,
            server_service: childName,
          });
          const data = res.data;
          edgeTrendCache.set(edgeKey, data);
          edgeBaselines.value.set(edgeKey, {
            p50_avg: data.p50_avg ?? 0,
            p95_avg: data.p95_avg ?? 0,
            p99_avg: data.p99_avg ?? 0,
          });
          edgeBaselines.value = new Map(edgeBaselines.value);
          if (sharedCurrentHoverEdgeKey === edgeKey) {
            renderTrendChart(data);
            positionTooltip(lastMouseX, lastMouseY);
          }
        } catch {
          // On error revert to stats view
          if (sharedCurrentHoverEdgeKey === edgeKey) {
            showStatsTooltip(lastMouseX, lastMouseY, parentName, childName);
          }
        } finally {
          fetchingEdges.delete(edgeKey);
        }
      };

      const showEdgeTooltip = (mouseX: number, mouseY: number, parentName: string, childName: string) => {
        const edgeKey = `${parentName}->${childName}`;
        sharedCurrentHoverEdgeKey = edgeKey;
        lastMouseX = mouseX;
        lastMouseY = mouseY;
        // Always show stats first on hover. User explicitly clicks "Show 24h trend"
        // to see the chart. loadAndShowTrend uses cache when available (no re-fetch).
        showStatsTooltip(mouseX, mouseY, parentName, childName);
      };

      const hideTooltip = () => {
        tooltipEl.style.display = 'none';
        tooltipEl.style.pointerEvents = 'none';
        sharedCurrentHoverEdgeKey = null;
        if (sharedTrendFetchTimer) { clearTimeout(sharedTrendFetchTimer); sharedTrendFetchTimer = null; }
      };

      let activeKey: string | null = null; // tracks current tooltip target
      const HIT_PIXELS = 12; // edge hit area in screen pixels

      const onMouseMove = (e: any) => {
        if (!edgesGroupEl || bezierEdges.length === 0) return;
        if (!edgesGroupEl.transformCoordToLocal) return;

        // Convert mouse pixel coords → edges group local coords
        const [mx, my] = edgesGroupEl.transformCoordToLocal(e.offsetX, e.offsetY);

        // Compute pixel-to-layout scale so hit area is consistent across zoom levels
        const [ox] = edgesGroupEl.transformCoordToLocal(0, 0);
        const [ox1] = edgesGroupEl.transformCoordToLocal(1, 0);
        const pxToLayout = Math.abs(ox1 - ox) || 1;
        const hitThreshold = HIT_PIXELS * pxToLayout;
        const nodeRadius = 42 * pxToLayout; // half of max symbolSize=80 + small margin

        // Check if mouse is near a node center
        let nearestNode: typeof nodePositions[0] | null = null;
        let nearestNodeDist = Infinity;
        for (const np of nodePositions) {
          const d = Math.hypot(np.x - mx, np.y - my);
          if (d < nodeRadius && d < nearestNodeDist) {
            nearestNodeDist = d;
            nearestNode = np;
          }
        }

        if (nearestNode) {
          // Show node tooltip
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          const key = `node:${nearestNode.name}`;
          activeKey = key;
          showNodeTooltip(e.offsetX, e.offsetY, nearestNode.name);
          return;
        }

        // Find nearest bezier edge
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < bezierEdges.length; i++) {
          const d = pointToBezierDistance(mx, my, bezierEdges[i].shape);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }

        if (bestIdx >= 0 && bestDist < hitThreshold) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          const edge = bezierEdges[bestIdx];
          const key = `edge:${edge.parentName}->${edge.childName}`;
          activeKey = key;
          showEdgeTooltip(e.offsetX, e.offsetY, edge.parentName, edge.childName);
        } else if (activeKey) {
          if (!hideTimer) {
            hideTimer = setTimeout(() => {
              activeKey = null;
              hideTooltip();
              hideTimer = null;
            }, 100);
          }
        }
      };

      const onGlobalOut = () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        activeKey = null;
        hideTooltip();
      };

      zr.on('mousemove', onMouseMove);
      zr.on('globalout', onGlobalOut);

      // Graph mode: ECharts fires mouseover/mouseout for graph series edges.
      // These share the same showEdgeTooltip/hideTooltip as tree mode.
      const onEChartsEdgeMouseover = (params: any) => {
        if (params.dataType !== 'edge') return;
        const parentName = params.data?.source ?? '';
        const childName = params.data?.target ?? '';
        if (!parentName || !childName) return;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        const mouseX = params.event?.offsetX ?? params.event?.zrX ?? 0;
        const mouseY = params.event?.offsetY ?? params.event?.zrY ?? 0;
        const key = `edge:${parentName}->${childName}`;
        activeKey = key;
        showEdgeTooltip(mouseX, mouseY, parentName, childName);
      };

      const onEChartsEdgeMouseout = (params: any) => {
        if (params.dataType !== 'edge') return;
        if (!hideTimer) {
          hideTimer = setTimeout(() => {
            hideTimer = null;
            activeKey = null;
            hideTooltip();
          }, 100);
        }
      };

      chart.on('mouseover', onEChartsEdgeMouseover);
      chart.on('mouseout', onEChartsEdgeMouseout);

      return () => {
        zr.off('mousemove', onMouseMove);
        zr.off('globalout', onGlobalOut);
        chart.off('mouseover', onEChartsEdgeMouseover);
        chart.off('mouseout', onEChartsEdgeMouseout);
        chart.off('finished', debouncedBuild);
        if (buildTimer) clearTimeout(buildTimer);
        if (hideTimer) clearTimeout(hideTimer);
        if (sharedTrendFetchTimer) { clearTimeout(sharedTrendFetchTimer); sharedTrendFetchTimer = null; }
        if (sharedTooltipChart) { sharedTooltipChart.dispose(); sharedTooltipChart = null; }
        tooltipEl.remove();
      };
    };

    // Set up edge tooltips whenever chart is (re)created for tree view
    watch(
      chartKey,
      async () => {
        // Clean up previous handlers
        if (edgeTooltipCleanup) {
          edgeTooltipCleanup();
          edgeTooltipCleanup = null;
        }
        // Cancel any pending setup to avoid duplicates
        if (pendingTooltipSetup) {
          clearTimeout(pendingTooltipSetup);
          pendingTooltipSetup = null;
        }
        await nextTick();
        pendingTooltipSetup = setTimeout(() => {
          pendingTooltipSetup = null;
          const chart = chartRendererRef.value?.chart;
          if (chart) {
            edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
          }
        }, 300);
      },
      { flush: 'post' }
    );

    // Watch for data loading completion to set up tooltips on initial load
    // This handles the case where chartKey changes before the chart is rendered
    watch(
      () => loading.value,
      async (isLoading, wasLoading) => {
        // Only trigger when loading changes from true to false (data just loaded)
        if (wasLoading && !isLoading) {
          // Clean up previous handlers first
          if (edgeTooltipCleanup) {
            edgeTooltipCleanup();
            edgeTooltipCleanup = null;
          }
          // Cancel any pending setup to avoid duplicates
          if (pendingTooltipSetup) {
            clearTimeout(pendingTooltipSetup);
            pendingTooltipSetup = null;
          }

          await nextTick();
          // Longer delay to ensure chart is fully rendered with new data
          pendingTooltipSetup = setTimeout(() => {
            pendingTooltipSetup = null;
            const chart = chartRendererRef.value?.chart;
            if (chart) {
              edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
            }
          }, 500);
        }
      }
    );

    // When visualization type changes (tree↔graph), the chart component is reused
    // but the series type swaps via setOption. Re-register tooltip handlers so both
    // ZRender (tree) and ECharts edge events (graph) work correctly after the swap.
    watch(
      () => visualizationType.value,
      async () => {
        if (edgeTooltipCleanup) {
          edgeTooltipCleanup();
          edgeTooltipCleanup = null;
        }
        // Cancel any pending setup to avoid duplicates
        if (pendingTooltipSetup) {
          clearTimeout(pendingTooltipSetup);
          pendingTooltipSetup = null;
        }
        await nextTick();
        pendingTooltipSetup = setTimeout(() => {
          pendingTooltipSetup = null;
          const chart = chartRendererRef.value?.chart;
          if (chart) {
            edgeTooltipCleanup = setupTreeEdgeTooltips(chart);
          }
        }, 300);
      }
    );

    onBeforeUnmount(() => {
      // Clear any pending tooltip setup
      if (pendingTooltipSetup) {
        clearTimeout(pendingTooltipSetup);
        pendingTooltipSetup = null;
      }
      if (edgeTooltipCleanup) {
        edgeTooltipCleanup();
        edgeTooltipCleanup = null;
      }
    });

    const loadServiceGraph = async () => {
      loading.value = true;
      error.value = null;

      // Clear cache to force chart regeneration with fresh data
      lastChartOptions.value = null;
      chartKey.value++;
      // Invalidate edge history cache so trends are re-fetched on next button click
      edgeTrendCache.clear();

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
      localStorage.setItem("serviceGraph_visualizationType", type);
      if (type === "tree") {
        layoutType.value = "horizontal";
      } else {
        layoutType.value = "force";
      }
      // Bust the options cache so chartData recomputes for the new series type,
      // but do NOT increment chartKey — that destroys the component and replays
      // the full expand animation. setOption with notMerge:true handles the swap.
      lastChartOptions.value = null;
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
        // Edge clicks in graph view: no action (tooltip handles it on hover)
      }
      // Check if it's a node click (for graph visualization)
      else if (params.dataType === 'node' && params.data) {
        // Check if clicking the same node - if so, close the panel
        if (selectedNode.value && selectedNode.value.id === params.data.id) {
          showSidePanel.value = false;
          selectedNode.value = null;
        } else {
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
