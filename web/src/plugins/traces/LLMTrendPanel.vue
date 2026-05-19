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
  <div
    ref="panelRootEl"
    class="card-container llm-trend-panel tw:rounded-lg tw:p-[1rem] tw:flex tw:flex-col"
  >
    <div class="tw:flex tw:items-baseline tw:justify-between tw:mb-[0.25rem]">
      <div>
        <!--
          Use the *primary* text token so titles read clearly against
          the card background in both light and dark modes. The numbered
          `--o2-text-1` var is dimmer in dark mode and was nearly
          invisible against the dark card bg.
        -->
        <div class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
          {{ panel.title }}
        </div>
        <div
          v-if="panel.subtitle"
          class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)] tw:mt-[0.1rem]"
        >
          {{ panel.subtitle }}
        </div>
      </div>
    </div>

    <div
      v-if="loading || !hasLoadedOnce"
      class="llm-panel-skeleton"
      :class="
        store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'
      "
    >
      <template v-if="panel.type === 'table'">
        <div v-for="row in 5" :key="row" class="llm-panel-skeleton__row">
          <SkeletonBox width="70px" height="14px" rounded />
          <SkeletonBox width="90px" height="20px" rounded />
          <SkeletonBox width="180px" height="14px" rounded />
          <SkeletonBox width="110px" height="14px" rounded />
          <SkeletonBox width="60px" height="14px" rounded />
          <SkeletonBox width="50px" height="14px" rounded />
        </div>
      </template>
      <template v-else-if="panel.type === 'horizontal-bar'">
        <div
          v-for="bar in 6"
          :key="bar"
          class="llm-panel-skeleton__hbar"
        >
          <SkeletonBox width="100px" height="12px" rounded />
          <SkeletonBox
            :width="`${20 + ((bar * 53) % 75)}%`"
            height="14px"
            rounded
          />
        </div>
      </template>
      <template v-else-if="panel.type === 'histogram-with-thresholds'">
        <!-- Real bar chart — bar-shaped skeleton is appropriate -->
        <div class="llm-panel-skeleton__chart">
          <SkeletonBox
            v-for="bar in 18"
            :key="bar"
            :width="`${100 / 18}%`"
            :height="`${20 + ((bar * 17) % 70)}%`"
            rounded
          />
        </div>
      </template>
      <template v-else>
        <!-- Line / area chart — SVG silhouette of a wavy area + line. -->
        <div class="llm-panel-skeleton__line">
          <svg
            class="llm-panel-skeleton__line-svg"
            viewBox="0 0 200 80"
            preserveAspectRatio="none"
          >
            <path
              class="llm-panel-skeleton__area-fill"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18 L200,80 L0,80 Z"
            />
            <path
              class="llm-panel-skeleton__line-stroke"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18"
              fill="none"
              stroke-width="2"
            />
          </svg>
        </div>
      </template>
    </div>
    <div
      v-else-if="errorMsg"
      class="llm-trend-empty tw:flex tw:items-center tw:justify-center tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]"
      :class="panel.type === 'table' ? 'llm-trend-empty--table' : ''"
    >
      {{ errorMsg }}
    </div>
    <div
      v-else-if="!hasData"
      class="llm-trend-empty tw:flex tw:items-center tw:justify-center tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]"
      :class="panel.type === 'table' ? 'llm-trend-empty--table' : ''"
    >
      {{ panel.emptyStateText || "No data" }}
    </div>
    <div
      v-show="!loading && !errorMsg && hasData && panel.type !== 'table'"
      class="llm-trend-chart tw:w-full"
    >
      <ChartRenderer
        :data="chartRendererData"
        renderType="canvas"
        height="100%"
      />
    </div>

    <div
      v-if="!loading && !errorMsg && hasData && panel.type === 'table'"
      class="llm-trend-table tw:w-full tw:overflow-auto"
    >
      <table class="tw:w-full tw:text-[0.75rem] tw:border-collapse">
        <thead>
          <tr class="tw:bg-[var(--o2-bg-3)] tw:text-[0.7rem] tw:text-[var(--o2-text-muted)]">
            <th
              v-for="col in panel.columns || []"
              :key="col.label || col.field"
              class="tw:px-[0.75rem] tw:py-[0.5rem] tw:text-left tw:font-semibold"
              :class="col.align === 'right' ? 'tw:text-right!' : ''"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in hits"
            :key="i"
            class="tw:border-t tw:border-[var(--o2-border-color)]"
          >
            <td
              v-for="col in panel.columns || []"
              :key="col.label || col.field"
              class="tw:px-[0.75rem] tw:py-[0.5rem] tw:align-middle"
              :class="col.align === 'right' ? 'tw:text-right!' : ''"
            >
              <template v-if="col.format === 'time'">
                <span class="tw:text-[var(--o2-text-secondary)]">{{ formatTimeCell(row[col.field!]) }}</span>
              </template>
              <template v-else-if="col.format === 'service-chip'">
                <span class="service-chip">
                  <span class="service-chip__dot" :style="{ background: chipColor(row[col.field!]) }" />
                  {{ row[col.field!] }}
                </span>
              </template>
              <template v-else-if="col.format === 'error'">
                <span
                  class="tw:text-[var(--o2-status-error-text)] tw:font-medium"
                >
                  <span class="tw:mr-[0.25rem]">×</span>{{ row[col.field!] }}
                </span>
              </template>
              <template v-else-if="col.format === 'cost'">
                <span class="tw:text-[var(--o2-text-primary)] tw:font-medium">
                  {{ formatCostCell(row) }}
                </span>
              </template>
              <template v-else-if="col.format === 'view-link'">
                <a
                  href="#"
                  class="tw:text-[var(--q-primary)] tw:font-medium tw:no-underline hover:tw:underline"
                  @click.prevent="emit('view-trace', String(row[col.field!] || ''))"
                >
                  View →
                </a>
              </template>
              <template v-else>
                <span class="tw:text-[var(--o2-text-secondary)]">{{ row[col.field!] }}</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type { EChartsOption } from "echarts";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import { useStore } from "vuex";
import {
  type LLMPanelDef,
  renderPanelSql,
  pickInterval,
} from "./config/llmInsightsPanels";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";
import {
  intervalToMs,
  formatCompact,
  formatLatencyMs,
  formatTimeCell,
  formatCostCell,
  chipColor,
  formatTimeLabel,
} from "./llmTrendPanel.utils";

interface Props {
  panel: LLMPanelDef;
  streamName: string;
  startTime: number;
  endTime: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "view-trace", traceId: string): void;
}>();

const store = useStore();
const { executeQuery } = useLLMStreamQuery();

const loading = ref(false);
const errorMsg = ref<string | null>(null);
const hits = ref<any[]>([]);
const thresholdRow = ref<Record<string, number> | null>(null);

// Viewport-based lazy loading — mirrors the dashboards' usePanelDataLoader.
// We only fire the SQL query once the panel is in (or near) the viewport.
// When inputs change while the panel is offscreen, we mark `needsReload` and
// run the query the next time the panel becomes visible.
const panelRootEl = ref<HTMLElement | null>(null);
const isVisible = ref(false);
const needsReload = ref(true);
const hasLoadedOnce = ref(false);
let intersectionObserver: IntersectionObserver | null = null;

const SERIES_PALETTE = [
  "#0ea5e9", // sky
  "#a855f7", // purple
  "#f97316", // orange
  "#10b981", // emerald
  "#ec4899", // pink
  "#eab308", // amber
  "#6366f1", // indigo
  "#14b8a6", // teal
];

const hasData = computed(() => {
  if (props.panel.gapFill === "zero" && props.panel.type === "stacked-area") {
    return true; // always render a flat-zero line when empty
  }
  return hits.value.length > 0;
});

function formatBucketTs(epochMicros: number): string {
  const d = new Date(epochMicros / 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function loadPanel() {
  if (!props.streamName || !props.startTime || !props.endTime) return;
  // Defer until the panel is on screen — when it becomes visible the
  // isVisible watcher will trigger a load.
  if (!isVisible.value) {
    needsReload.value = true;
    return;
  }
  needsReload.value = false;
  loading.value = true;
  errorMsg.value = null;
  hits.value = [];
  thresholdRow.value = null;

  const interval = pickInterval(props.endTime - props.startTime);
  const ctx = {
    stream: props.streamName,
    startTime: props.startTime,
    endTime: props.endTime,
    interval,
  };

  try {
    const sql = renderPanelSql(props.panel.query.sql, ctx);
    const tasks: Promise<any>[] = [executeQuery(sql, props.startTime, props.endTime)];

    if (props.panel.thresholdsQuery?.sql) {
      tasks.push(
        executeQuery(
          renderPanelSql(props.panel.thresholdsQuery.sql, ctx),
          props.startTime,
          props.endTime,
        ),
      );
    }

    const [main, thresh] = await Promise.all(tasks);
    hits.value = main as any[];
    if (thresh && Array.isArray(thresh) && thresh.length > 0) {
      thresholdRow.value = thresh[0];
    }
  } catch (e: any) {
    errorMsg.value = e?.message || "Failed to load panel";
    console.error(`[LLM panel ${props.panel.id}] fetch error`, e);
  } finally {
    loading.value = false;
    hasLoadedOnce.value = true;
  }
}

function buildStackedAreaOption(): EChartsOption {
  const { timeField, seriesField, valueField } = props.panel.query;
  if (!timeField) return {};

  const tsSet = new Set<string>();
  const seriesMap = new Map<string, Map<string, number>>();

  const fallbackLabel = props.panel.query.seriesLabel || "value";

  // Gap-fill: when the result is empty AND the panel opts in, synthesise a
  // 2-point flat-zero series so the chart shows "0 over time" rather than
  // "No data" (matches Datadog/Grafana behaviour for absence-is-good metrics).
  // The synthetic points are aligned to the histogram bucket boundary so the
  // x-axis labels match what other panels show for the same time range.
  let processedHits = hits.value;
  if (
    processedHits.length === 0 &&
    props.panel.gapFill === "zero" &&
    valueField
  ) {
    const intervalMs = intervalToMs(
      pickInterval(props.endTime - props.startTime),
    );
    const startMs = props.startTime / 1000;
    const endMs = props.endTime / 1000;
    const alignedStart = Math.floor(startMs / intervalMs) * intervalMs;
    const alignedEnd = Math.floor(endMs / intervalMs) * intervalMs;
    processedHits = [
      { [timeField]: formatBucketTs(alignedStart * 1000), [valueField]: 0 },
      { [timeField]: formatBucketTs(alignedEnd * 1000), [valueField]: 0 },
    ];
  }

  for (const row of processedHits) {
    const ts = String(row[timeField]);
    tsSet.add(ts);
    const seriesKey = seriesField
      ? String(row[seriesField] ?? "unknown")
      : fallbackLabel;

    let value: number;
    if (valueField) {
      value = Number(row[valueField]) || 0;
    } else {
      value = 0;
    }

    if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, new Map());
    seriesMap.get(seriesKey)!.set(ts, value);
  }

  const xAxisData = Array.from(tsSet).sort();
  const seriesNames = Array.from(seriesMap.keys()).sort((a, b) => {
    const sumA = Array.from(seriesMap.get(a)!.values()).reduce((s, v) => s + v, 0);
    const sumB = Array.from(seriesMap.get(b)!.values()).reduce((s, v) => s + v, 0);
    return sumB - sumA;
  });

  const series: any[] = seriesNames.map((name, idx) => {
    const data = xAxisData.map((ts) => seriesMap.get(name)!.get(ts) ?? 0);
    const color =
      !seriesField && props.panel.color
        ? props.panel.color
        : SERIES_PALETTE[idx % SERIES_PALETTE.length];
    return {
      name,
      type: "line",
      stack: "total",
      smooth: 0.25,
      symbol: "none",
      areaStyle: { color, opacity: 0.6 },
      lineStyle: { width: 1, color },
      itemStyle: { color },
      data,
    };
  });

  const isCost = props.panel.query.valueFormat === "cost";

  return {
    grid: { top: 24, right: 16, bottom: 36, left: 48, containLabel: false },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: any) =>
        isCost ? `$${Number(v).toFixed(2)}` : Number(v).toLocaleString(),
    },
    // Axis/legend colors and splitLine colors deliberately omitted —
    // ChartRenderer initialises echarts with the theme name ("dark" /
    // "light") so echarts' built-in theme paints these in a readable
    // shade for whichever theme is active. Overriding with hex values
    // here would defeat that adaptive behaviour.
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 11 },
    },
    xAxis: {
      type: "category",
      data: xAxisData,
      axisLabel: {
        fontSize: 10,
        formatter: (val: string) => formatTimeLabel(val),
      },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 10,
        formatter: (v: number) =>
          isCost ? `$${formatCompact(v)}` : formatCompact(v),
      },
      splitLine: { lineStyle: { type: "dashed" } },
    },
    series,
  };
}

function buildHistogramThresholdOption(): EChartsOption {
  const { valueField } = props.panel.query;
  if (!valueField) return {};

  // Read raw durations (microseconds) and bucket client-side so the bucket
  // width adapts to the data range. The right-edge of the chart is clipped
  // to p99 (with a 20% pad) to keep outliers from squashing the visible bars.
  const valuesMs = hits.value
    .map((r) => Number(r[valueField]) / 1000)
    .filter((v) => isFinite(v) && v >= 0);

  if (valuesMs.length === 0) return {};

  const dataMin = Math.min(...valuesMs);
  const dataMax = Math.max(...valuesMs);
  const p99 = thresholdRow.value
    ? Number(thresholdRow.value.p99_ms)
    : dataMax;

  const upper = Math.max(
    isFinite(p99) && p99 > 0 ? p99 * 1.2 : dataMax,
    dataMax * 0.05, // fallback for sub-microsecond data
    1,
  );
  const lower = Math.max(0, Math.min(dataMin, 0));

  const BUCKET_COUNT = 30;
  const range = Math.max(upper - lower, 1);
  const bucketWidth = range / BUCKET_COUNT;

  const counts = new Array(BUCKET_COUNT).fill(0);
  const xCenters = new Array(BUCKET_COUNT)
    .fill(0)
    .map((_, i) => lower + bucketWidth * (i + 0.5));

  for (const v of valuesMs) {
    if (v > upper) {
      counts[BUCKET_COUNT - 1] += 1; // clamp outliers into the last bin
      continue;
    }
    let idx = Math.floor((v - lower) / bucketWidth);
    if (idx < 0) idx = 0;
    if (idx >= BUCKET_COUNT) idx = BUCKET_COUNT - 1;
    counts[idx] += 1;
  }

  // Use a category axis so bars have a sensible width regardless of how
  // narrow the data range is. Threshold lines snap to the nearest bucket.
  const bucketLabels = xCenters.map((c) => formatLatencyMs(c));

  function bucketIndexFor(ms: number): number {
    const idx = Math.round((ms - lower) / bucketWidth - 0.5);
    if (idx < 0) return 0;
    if (idx >= BUCKET_COUNT) return BUCKET_COUNT - 1;
    return idx;
  }

  const markLineData: any[] = [];
  if (props.panel.thresholds && thresholdRow.value) {
    for (const t of props.panel.thresholds) {
      const v = Number(thresholdRow.value[t.field]);
      if (!isFinite(v)) continue;
      markLineData.push({
        xAxis: bucketIndexFor(v),
        lineStyle: { color: t.color, type: "dashed", width: 1.5 },
        label: {
          formatter: `${t.label}  ${formatLatencyMs(v)}`,
          color: "#fff",
          backgroundColor: t.color,
          padding: [2, 6],
          borderRadius: 3,
          fontSize: 10,
          position: "insideEndTop",
        },
      });
    }
  }

  return {
    grid: { top: 24, right: 16, bottom: 28, left: 48, containLabel: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const idx = p.dataIndex;
        const lo = lower + bucketWidth * idx;
        const hi = lo + bucketWidth;
        const count = Number(p.data) || 0;
        return `${formatLatencyMs(lo)} – ${formatLatencyMs(hi)} — ${count.toLocaleString()} calls`;
      },
    },
    // Axis colors omitted — let echarts theme handle dark/light.
    xAxis: {
      type: "category",
      data: bucketLabels,
      axisLabel: {
        fontSize: 10,
        interval: "auto",
        hideOverlap: true,
      },
      axisTick: { show: false },
      splitLine: { show: false },
      boundaryGap: true,
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 10,
        formatter: (v: number) => formatCompact(v),
      },
      splitLine: { lineStyle: { type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: counts,
        itemStyle: { color: "#a78bfa", borderRadius: [2, 2, 0, 0] },
        barCategoryGap: "10%",
        markLine: {
          symbol: "none",
          silent: true,
          animation: false,
          data: markLineData,
        },
      },
    ],
  };
}

function buildHorizontalBarOption(): EChartsOption {
  const { seriesField, valueField } = props.panel.query;
  if (!seriesField || !valueField) return {};

  const sorted = [...hits.value].sort(
    (a, b) => Number(b[valueField]) - Number(a[valueField]),
  );
  const limited = props.panel.limit
    ? sorted.slice(0, props.panel.limit)
    : sorted;

  const categories = limited.map((row) => String(row[seriesField] ?? "unknown"));
  const values = limited.map((row) => Number(row[valueField]) || 0);
  const color = props.panel.color || "#3b82f6";

  return {
    grid: { top: 16, right: 56, bottom: 16, left: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v: any) => Number(v).toLocaleString(),
    },
    // Axis colors omitted — let echarts theme handle dark/light.
    xAxis: {
      type: "value",
      axisLabel: {
        fontSize: 10,
        formatter: (v: number) => formatCompact(v),
      },
      splitLine: { lineStyle: { type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: categories,
      inverse: true,
      axisLabel: { fontSize: 11 },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: values,
        itemStyle: { color, borderRadius: [0, 3, 3, 0] },
        barCategoryGap: "30%",
        label: {
          show: true,
          position: "right",
          fontSize: 11,
          formatter: (p: any) => formatCompact(Number(p.value)),
        },
      },
    ],
  };
}

const chartOption = computed<EChartsOption>(() => {
  let base: EChartsOption = {};
  if (props.panel.type === "stacked-area") base = buildStackedAreaOption();
  else if (props.panel.type === "histogram-with-thresholds")
    base = buildHistogramThresholdOption();
  else if (props.panel.type === "horizontal-bar")
    base = buildHorizontalBarOption();
  // Force transparent so the echarts built-in "dark" theme doesn't paint a
  // navy background over our card. Card bg comes from .card-container.
  return { backgroundColor: "transparent", ...base };
});

// ChartRenderer expects: { options, notMerge?, lazyUpdate?, extras? }
// `extras.panelId` participates in the cross-chart hovered-series sync.
const chartRendererData = computed(() => ({
  options: chartOption.value,
  notMerge: true,
  extras: { panelId: props.panel.id },
}));

watch(
  () => [props.streamName, props.startTime, props.endTime, props.panel.id],
  () => {
    needsReload.value = true;
    loadPanel();
  },
);

watch(isVisible, (visible) => {
  if (visible && needsReload.value) {
    loadPanel();
  }
});

onMounted(() => {
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      isVisible.value = entries[0].isIntersecting;
    },
    { root: null, rootMargin: "200px", threshold: 0 },
  );
  // Defer one tick so the element has been laid out — same workaround as
  // usePanelDataLoader for popups/drawers.
  setTimeout(() => {
    if (panelRootEl.value) intersectionObserver?.observe(panelRootEl.value);
  }, 0);
});

onUnmounted(() => {
  intersectionObserver?.disconnect();
  intersectionObserver = null;
});
</script>

<style lang="scss" scoped>
.llm-trend-chart {
  height: 220px;
  width: 100%;
}

/* Empty / error states match the chart height so cards stay aligned in the
   2-col grid even when one panel has no data. Table panels span both
   columns so they get their own (shorter) empty-state height. */
.llm-trend-empty {
  height: 220px;
  width: 100%;

  &--table {
    height: 140px;
  }
}

.llm-trend-table {
  margin-top: 0.5rem;

  table {
    th,
    td {
      white-space: nowrap;
    }
    td {
      color: var(--o2-text-primary);
    }
    tbody tr:hover {
      background: var(--o2-bg-3);
    }
  }
}

.service-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--o2-bg-3);
  font-size: 0.7rem;

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }
}

/* Per-panel skeleton — same pattern as LLMInsightsSkeleton.vue / HomeViewSkeleton.vue */
.llm-panel-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;

  &__chart {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    height: 220px;
  }

  &__line {
    position: relative;
    height: 220px;
    overflow: hidden;
  }

  &__line-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  &__hbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0;
  }
}

:deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.15),
    transparent
  );
  background-size: 200% 100%;
  animation: llm-panel-skel-wave 1.5s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.dark-tile-content :deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0.04)
  );
  background-size: 200% 100%;
}

.light-tile-content :deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04),
    rgba(0, 0, 0, 0.1),
    rgba(0, 0, 0, 0.04)
  );
  background-size: 200% 100%;
}

@keyframes llm-panel-skel-wave {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* Line/area chart skeleton — SVG fill colors per theme */
.llm-panel-skeleton__area-fill {
  fill: rgba(0, 0, 0, 0.08);
  animation: llm-line-pulse 1.6s ease-in-out infinite;
}
.llm-panel-skeleton__line-stroke {
  stroke: rgba(0, 0, 0, 0.18);
  animation: llm-line-pulse 1.6s ease-in-out infinite;
}

.dark-tile-content .llm-panel-skeleton__area-fill {
  fill: rgba(255, 255, 255, 0.08);
}
.dark-tile-content .llm-panel-skeleton__line-stroke {
  stroke: rgba(255, 255, 255, 0.22);
}

@keyframes llm-line-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
</style>
