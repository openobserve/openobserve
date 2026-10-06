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
    data-test="traces-latency-heatmap"
    class="border-border-default bg-surface-base rounded-default flex h-full min-h-0 flex-col overflow-hidden border"
  >
    <PanelBar class="w-full" data-test="traces-latency-heatmap-title">
      {{ t("traces.latencyHeatmap.title") }}
    </PanelBar>
    <div class="relative min-h-0 flex-1">
      <div
        v-if="status === 'loading'"
        class="flex h-full items-center justify-center"
        data-test="traces-latency-heatmap-loading"
      >
        <OSpinner size="sm" />
      </div>
      <div
        v-else-if="status === 'error' || status === 'unavailable'"
        class="text-status-error-text flex h-full items-center justify-center px-2 text-center text-sm"
        :data-test="`traces-latency-heatmap-${status}`"
      >
        {{
          status === "error"
            ? t("traces.latencyHeatmap.loadFailed")
            : t("traces.latencyHeatmap.unavailable")
        }}
      </div>
      <OEmptyState
        v-else-if="status === 'empty'"
        size="inline"
        icon="bar-chart"
        :title="t('traces.latencyHeatmap.noData')"
        :backdrop="false"
        data-test="traces-latency-heatmap-no-data"
        class="h-full"
      />
      <!-- ChartRenderer escape hatch (ui-architect "Charts / graphs", fixed-grid case): empty cells kept and index → bucket box mapping, which the heatmap converter cannot do -->
      <ChartRenderer
        v-else-if="status === 'ready'"
        :data="{ options }"
        data-test="traces-latency-heatmap-chart"
        @updated:dataZoom="onDataZoom"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useTheme from "@/composables/useTheme";
import searchService from "@/services/search";
import PanelBar from "@/components/common/PanelBar.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { chartColor, chartTextColor, chartAxisLine, dataZoomBrushStyle } from "@/utils/chartTheme";
import { heatmapLargeGridDefaults } from "@/utils/dashboard/heatmapDefaults";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { escapeHtml } from "@/utils/html";
import {
  HEATMAP_ROW_LIMIT,
  bucketBounds,
  buildHeatmapGrid,
  formatDurationBound,
  selectionFromBox,
  type HeatmapBox,
  type LatencyHeatmapGrid,
  type LatencyHeatmapSelection,
} from "./latencyHeatmap";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

export interface LatencyHeatmapRequest {
  sql: string;
  startTime: number;
  endTime: number;
}

const props = defineProps<{ request: LatencyHeatmapRequest | null }>();

const emit = defineEmits<{
  (e: "select", selection: LatencyHeatmapSelection): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { isDark } = useTheme();

const MINUTE_US = 60 * 1_000_000;
const DAY_US = 24 * 3600 * 1_000_000;

const status = ref<"idle" | "loading" | "ready" | "empty" | "unavailable" | "error">("idle");
const grid = shallowRef<LatencyHeatmapGrid | null>(null);

let controller: AbortController | null = null;

const isCanceled = (e: any) => e?.name === "CanceledError" || e?.code === "ERR_CANCELED";

async function load(request: LatencyHeatmapRequest | null) {
  controller?.abort();
  controller = null;
  grid.value = null;
  if (!request) {
    status.value = "idle";
    return;
  }
  const mine = new AbortController();
  controller = mine;
  status.value = "loading";
  try {
    // Not a TanStack query: search reads are excluded from client caching (ui-architect data-fetching); the server cache still applies.
    const res: any = await searchService.search({
      org_identifier: store.state.selectedOrganization?.identifier,
      query: {
        query: {
          sql: request.sql,
          start_time: request.startTime,
          end_time: request.endTime,
          from: 0,
          size: -1,
        },
      },
      page_type: "traces",
      signal: mine.signal,
    });
    if (controller !== mine) return;
    const hits = res?.data?.hits ?? [];
    const intervalSec = res?.data?.histogram_interval;
    if (hits.length >= HEATMAP_ROW_LIMIT) {
      console.warn("Latency heatmap reached its row limit; the grid may be truncated");
    }
    if (!hits.length) {
      status.value = "empty";
      return;
    }
    if (!intervalSec) {
      status.value = "unavailable";
      return;
    }
    grid.value = buildHeatmapGrid(hits, intervalSec, request.startTime, request.endTime);
    status.value = grid.value ? "ready" : "empty";
  } catch (e: any) {
    if (isCanceled(e) || controller !== mine) return;
    status.value = "error";
  }
}

// A new request object every search, so an identical re-run still refetches.
watch(() => props.request, load, { immediate: true });

onBeforeUnmount(() => {
  controller?.abort();
  controller = null;
});

const columnLabels = computed(() => {
  const g = grid.value;
  if (!g) return [];
  const format =
    g.rangeEndUs - g.rangeStartUs > DAY_US
      ? "MM-dd HH:mm"
      : g.intervalUs >= MINUTE_US
        ? "HH:mm"
        : "HH:mm:ss";
  return g.colStartUs.map((us) => timestampToTimezoneDate(us / 1000, store.state.timezone, format));
});

const rangeLabel = (bucket: number) => {
  const { lo, hi } = bucketBounds(bucket);
  return hi === null
    ? `≥ ${formatDurationBound(lo)}`
    : `${formatDurationBound(lo)} – ${formatDurationBound(hi)}`;
};

const options = computed(() => {
  void isDark.value; // The resolved token values are cached — re-read on a flip.
  const g = grid.value;
  if (!g) return {};
  const textColor = chartTextColor();
  return {
    animation: false,
    // ECharts canvas sizes are pixel numbers with no CSS cascade, and no chart size tokens exist.
    grid: { left: 52, right: 8, top: 8, bottom: 22 },
    tooltip: {
      trigger: "item",
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderWidth: 0,
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      formatter: (params: any) => {
        const [col, row, , count] = params.data;
        return [
          escapeHtml(columnLabels.value[col]),
          escapeHtml(rangeLabel(g.rows[row])),
          escapeHtml(t("traces.latencyHeatmap.tooltipSpans", { count }, count)),
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: columnLabels.value,
      splitArea: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartAxisLine() } },
      axisLabel: { color: textColor, fontSize: 10 },
    },
    yAxis: {
      type: "category",
      data: g.rows.map((k) => formatDurationBound(bucketBounds(k).lo)),
      splitArea: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartAxisLine() } },
      axisLabel: { color: textColor, fontSize: 10 },
    },
    visualMap: {
      show: false,
      dimension: 2,
      min: 0,
      max: 1,
      inRange: { color: [chartColor("--color-latency-p95")], colorAlpha: [0.08, 1] },
    },
    toolbox: {
      show: true,
      showTitle: false,
      tooltip: { show: false },
      itemSize: 0,
      itemGap: 0,
      bottom: "100%",
      feature: {
        dataZoom: { xAxisIndex: 0, yAxisIndex: 0, brushStyle: dataZoomBrushStyle() },
      },
    },
    series: [
      {
        type: "heatmap",
        data: g.cells,
        // Hundreds of narrow columns: a cell border would cover most of each cell.
        itemStyle: { borderWidth: 0 },
        label: { show: false },
        ...heatmapLargeGridDefaults(g.cells.length),
      },
    ],
  };
});

const onDataZoom = (box: HeatmapBox) => {
  if (!grid.value) return;
  emit("select", selectionFromBox(grid.value, box));
};
</script>
