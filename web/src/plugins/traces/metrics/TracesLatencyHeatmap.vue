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
    <PanelBar class="w-full justify-between gap-2" data-test="traces-latency-heatmap-title">
      <span class="truncate">{{ t("traces.latencyHeatmap.title") }}</span>
      <LatencyHeatmapColorToggle v-model="colorBy" />
      <ODropdown side="bottom" align="end">
        <template #trigger>
          <OButton
            :aria-label="t('traces.redActions.durationActions')"
            variant="ghost"
            size="icon"
            class="shrink-0"
            data-test="traces-duration-actions-btn"
          >
            <OIcon name="more-vert" size="sm" />
          </OButton>
        </template>
        <ODropdownItem
          data-test="traces-duration-create-alert"
          icon-left="shield-alert-outline"
          @select="emit('create-alert')"
        >
          {{ t("dashboard.panelContainer.exploreCreateAlert") }}
        </ODropdownItem>
        <ODropdownItem
          data-test="traces-duration-add-to-dashboard"
          icon-left="dashboard"
          @select="emit('add-to-dashboard')"
        >
          {{ t("dashboard.panelContainer.exploreAddToDashboard") }}
        </ODropdownItem>
      </ODropdown>
    </PanelBar>
    <div
      class="relative min-h-0 flex-1"
      :aria-busy="refetching ? 'true' : undefined"
      data-test="traces-latency-heatmap-body"
    >
      <LoadingProgress
        :loading="status === 'loading' || refetching"
        :loading-progress-percentage="0"
      />
      <PanelChartPlaceholder
        v-if="status === 'loading'"
        data-test="traces-latency-heatmap-loading"
      />
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
        :data="chartData"
        data-test="traces-latency-heatmap-chart"
        @updated:dataZoom="onDataZoom"
        @painted="chartPainted = true"
      />
      <!-- Drawn over the canvas, not as a markArea: the chart resets its option after every zoom brush. -->
      <!-- The box passes pointer events through so a new brush can start inside it. -->
      <div
        v-if="status === 'ready' && shownBox"
        class="border-accent bg-accent/10 rounded-default pointer-events-none absolute border"
        :style="shownBox.style"
        data-test="traces-latency-heatmap-selection"
      >
        <ODropdown
          :open="popoverOpen"
          side="right"
          align="start"
          content-class="w-[min(18rem,calc(100vw-1.5rem))]"
          @update:open="popoverOpen = $event"
        >
          <template #trigger>
            <OButton
              variant="secondary"
              size="icon-xs-sq"
              icon-left="more-horiz"
              class="pointer-events-auto absolute top-0.5 right-0.5"
              :aria-label="t('traces.latencyHeatmap.selection.reopen')"
              data-test="traces-latency-heatmap-selection-reopen"
            />
          </template>
          <div
            ref="menuBody"
            role="group"
            :aria-label="t('traces.latencyHeatmap.selection.label')"
            data-test="traces-latency-heatmap-selection-menu"
          >
            <div class="flex flex-col gap-0.5 px-3 py-1.5">
              <span
                class="text-text-heading text-sm font-semibold"
                data-test="traces-latency-heatmap-selection-count"
              >
                {{
                  t(
                    "traces.latencyHeatmap.selection.count",
                    { count: shownBox.count.toLocaleString() },
                    shownBox.count,
                  )
                }}
              </span>
              <span
                class="text-text-secondary text-xs"
                data-test="traces-latency-heatmap-selection-range"
              >
                {{ shownBox.range }}
              </span>
            </div>
            <ODropdownSeparator />
            <ODropdownItem
              icon-left="filter-alt"
              shortcut="f"
              data-test="traces-latency-heatmap-selection-filter"
              @select="filterSelection"
            >
              {{ t("traces.latencyHeatmap.selection.filter") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="timeline"
              shortcut="d"
              data-test="traces-latency-heatmap-selection-drill-down"
              @select="drillDown"
            >
              {{ t("traces.latencyHeatmap.selection.drillDown") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="aiEnabled"
              data-test="traces-latency-heatmap-selection-ask-ai"
              @select="askAi"
            >
              <template #icon-left>
                <img :src="aiIconSrc" class="h-4 w-4 shrink-0" alt="" />
              </template>
              {{ t("traces.latencyHeatmap.selection.askAi") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="close"
              shortcut="esc"
              data-test="traces-latency-heatmap-selection-clear"
              @select="clearSelection"
            >
              {{ t("traces.latencyHeatmap.selection.clear") }}
            </ODropdownItem>
          </div>
        </ODropdown>
      </div>
      <!-- The canvas is blank until its first frame, so the loading block stays over it until then. -->
      <PanelChartPlaceholder
        v-if="status === 'ready' && !chartPainted"
        class="absolute inset-0"
        data-test="traces-latency-heatmap-first-frame"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import useTheme from "@/composables/useTheme";
import { useAiIcon } from "@/composables/useAiIcon";
import searchService from "@/services/search";
import PanelBar from "@/components/common/PanelBar.vue";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import PanelChartPlaceholder from "@/components/dashboards/PanelChartPlaceholder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import LatencyHeatmapColorToggle, {
  type LatencyHeatmapColorBy,
} from "./LatencyHeatmapColorToggle.vue";
import { chartColor, chartTextColor, chartAxisLine, dataZoomBrushStyle } from "@/utils/chartTheme";
import { heatmapLargeGridDefaults } from "@/utils/dashboard/heatmapDefaults";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { escapeHtml } from "@/utils/html";
import {
  HEATMAP_ROW_LIMIT,
  boxCells,
  bucketBounds,
  buildHeatmapGrid,
  formatDurationBound,
  selectionFromBox,
  spansInCells,
  type HeatmapBox,
  type HeatmapCellRange,
  type LatencyHeatmapCell,
  type LatencyHeatmapGrid,
  type LatencyHeatmapSelection,
} from "./latencyHeatmap";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

export interface LatencyHeatmapAskAi {
  selection: LatencyHeatmapSelection;
  count: number;
  band: string;
  window: string;
}

export interface LatencyHeatmapRequest {
  sql: string;
  startTime: number;
  endTime: number;
}

// Another stream's grid is never kept under this one, even dimmed.
const props = defineProps<{
  request: LatencyHeatmapRequest | null;
  selection?: LatencyHeatmapSelection | null;
  aiEnabled?: boolean;
  stream?: string;
  /** What the request draws from; a failed refresh keeps the grid only when it was drawn from the same source. */
  source?: string;
}>();

const emit = defineEmits<{
  (e: "select", selection: LatencyHeatmapSelection): void;
  (e: "filter"): void;
  (e: "drill-down"): void;
  (e: "clear"): void;
  (e: "ask-ai", payload: LatencyHeatmapAskAi): void;
  (e: "create-alert"): void;
  (e: "add-to-dashboard"): void;
  (e: "refresh-failed"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { isDark } = useTheme();
const { aiIconSrc } = useAiIcon();

const MINUTE_US = 60 * 1_000_000;
// ECharts canvas sizes are pixel numbers with no CSS cascade, and no chart size tokens exist.
const GRID = { left: 52, right: 8, top: 8, bottom: 22 };
const DAY_US = 24 * 3600 * 1_000_000;

const status = ref<"idle" | "loading" | "ready" | "empty" | "unavailable" | "error">("idle");
const grid = shallowRef<LatencyHeatmapGrid | null>(null);
const colorBy = ref<LatencyHeatmapColorBy>("spans");
// The box the user drew, kept in grid cells; it shows only while the parent holds its selection.
const drawn = shallowRef<{ selection: LatencyHeatmapSelection; cells: HeatmapCellRange } | null>(
  null,
);
const popoverOpen = ref(false);
// Once filtered, the box stands for the staged filter, so only Clear or a reload may erase it.
const filtered = ref(false);
// Kept apart from status so a re-run keeps the drawn grid instead of the loading block.
const refetching = ref(false);
const chartPainted = ref(false);
watch(status, (now) => {
  if (now !== "ready") chartPainted.value = false;
});

let controller: AbortController | null = null;
let shownStream: string | undefined;
let drawnSource: string | undefined;

const isCanceled = (e: any) => e?.name === "CanceledError" || e?.code === "ERR_CANCELED";

async function load(request: LatencyHeatmapRequest | null) {
  controller?.abort();
  controller = null;
  refetching.value = false;
  drawn.value = null;
  popoverOpen.value = false;
  filtered.value = false;
  if (!request) {
    grid.value = null;
    status.value = "idle";
    return;
  }
  const mine = new AbortController();
  controller = mine;
  const requestSource = props.source;
  const sameStream = props.stream === shownStream;
  shownStream = props.stream;
  if (sameStream && (status.value === "ready" || status.value === "empty")) {
    refetching.value = true;
  } else {
    grid.value = null;
    status.value = "loading";
  }
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
      grid.value = null;
      status.value = "empty";
      drawnSource = requestSource;
      return;
    }
    if (!intervalSec) {
      grid.value = null;
      status.value = "unavailable";
      return;
    }
    grid.value = buildHeatmapGrid(hits, intervalSec, request.startTime, request.endTime);
    status.value = grid.value ? "ready" : "empty";
    drawnSource = requestSource;
  } catch (e: any) {
    if (isCanceled(e) || controller !== mine) return;
    // A failed refresh keeps what was drawn at full opacity; the results header reports the failure (ruling 18).
    if (refetching.value && requestSource === drawnSource) {
      emit("refresh-failed");
      return;
    }
    grid.value = null;
    status.value = "error";
  } finally {
    if (controller === mine) refetching.value = false;
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

const cellSeries = (data: LatencyHeatmapCell[]) => ({
  type: "heatmap",
  data,
  // Hundreds of narrow columns: a cell border would cover most of each cell.
  itemStyle: { borderWidth: 0 },
  label: { show: false },
  ...heatmapLargeGridDefaults(data.length),
});

const options = computed(() => {
  void isDark.value; // The resolved token values are cached — re-read on a flip.
  const g = grid.value;
  if (!g) return {};
  const textColor = chartTextColor();
  const byErrors = colorBy.value === "errors";
  return {
    animation: false,
    grid: GRID,
    tooltip: {
      trigger: "item",
      // An overflow-hidden card ancestor clips a tooltip rendered inside the chart.
      appendToBody: true,
      className: "o2-echarts-tooltip",
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderWidth: 0,
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      formatter: (params: any) => {
        const [col, row, , count, errorShare, errorCount] = params.data;
        const share = `${+(errorShare * 100).toFixed(1)}%`;
        return [
          escapeHtml(columnLabels.value[col]),
          escapeHtml(rangeLabel(g.rows[row])),
          escapeHtml(t("traces.latencyHeatmap.tooltipSpans", { count }, count)),
          escapeHtml(
            t("traces.latencyHeatmap.tooltipErrors", { count: errorCount, share }, errorCount),
          ),
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
    visualMap: byErrors
      ? [
          {
            show: false,
            seriesIndex: 0,
            dimension: 4,
            min: 0,
            max: 1,
            inRange: { color: [chartColor("--color-status-error-text")], colorAlpha: [0.2, 1] },
          },
          // ECharts refuses a heatmap series without a visual map, so the neutral series gets a constant one.
          {
            show: false,
            seriesIndex: 1,
            dimension: 5,
            min: 0,
            max: 1,
            inRange: { color: [chartColor("--color-chart-band")] },
          },
        ]
      : {
          show: false,
          dimension: 2,
          min: 0,
          max: 1,
          inRange: { color: [chartColor("--color-latency-p95")], colorAlpha: [0.2, 1] },
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
    series: byErrors
      ? [
          cellSeries(g.cells.filter((c) => c[5] > 0)),
          // Zero-error cells keep the span footprint visible in a neutral grey.
          cellSeries(g.cells.filter((c) => c[5] === 0)),
        ]
      : [cellSeries(g.cells)],
  };
});

const windowText = (startUs: number, endUs: number) => {
  const format = endUs - startUs > DAY_US ? "MM-dd HH:mm" : "HH:mm:ss";
  const at = (us: number) => timestampToTimezoneDate(us / 1000, store.state.timezone, format);
  return `${at(startUs)}–${at(endUs)}`;
};

const bandText = ({ durationLoUs: lo, durationHiUs: hi }: LatencyHeatmapSelection) =>
  hi === null
    ? `≥ ${formatDurationBound(lo)}`
    : lo
      ? `${formatDurationBound(lo)}–${formatDurationBound(hi)}`
      : `< ${formatDurationBound(hi)}`;

const shownBox = computed<{
  style: Record<string, string>;
  count: number;
  range: I18nText;
} | null>(() => {
  const g = grid.value;
  const d = drawn.value;
  const held = props.selection;
  const same =
    !!held &&
    !!d &&
    held.timeStartUs === d.selection.timeStartUs &&
    held.timeEndUs === d.selection.timeEndUs &&
    held.durationLoUs === d.selection.durationLoUs &&
    held.durationHiUs === d.selection.durationHiUs;
  if (!g || !d || !same) return null;
  const { i0, i1, j0, j1 } = d.cells;
  const cols = g.colStartUs.length;
  const rows = g.rows.length;
  const plotW = `(100% - ${GRID.left + GRID.right}px)`;
  const plotH = `(100% - ${GRID.top + GRID.bottom}px)`;
  // Row 0 is the bottom of the y axis, so the box's top edge is its highest row.
  return {
    style: {
      left: `calc(${GRID.left}px + ${plotW} * ${i0 / cols})`,
      width: `calc(${plotW} * ${(i1 - i0 + 1) / cols})`,
      top: `calc(${GRID.top}px + ${plotH} * ${(rows - 1 - j1) / rows})`,
      height: `calc(${plotH} * ${(j1 - j0 + 1) / rows})`,
    },
    count: spansInCells(g, d.cells),
    range: t("traces.latencyHeatmap.selection.range", {
      band: raw(bandText(d.selection)),
      window: raw(windowText(d.selection.timeStartUs, d.selection.timeEndUs)),
    }),
  };
});

// One object per grid, so ChartRenderer's first-frame check is not reset by an unrelated re-render.
const chartData = computed(() => ({ options: options.value }));

const onDataZoom = (box: HeatmapBox) => {
  if (!grid.value) return;
  const selection = selectionFromBox(grid.value, box);
  drawn.value = { selection, cells: boxCells(grid.value, box) };
  popoverOpen.value = true;
  filtered.value = false;
  emit("select", selection);
};

const filterSelection = () => {
  popoverOpen.value = false;
  filtered.value = true;
  emit("filter");
};

// The Drill down page keeps its own copy of the selection, so only the drawn box goes.
const drillDown = () => {
  popoverOpen.value = false;
  if (!filtered.value) drawn.value = null;
  emit("drill-down");
};

const askAi = () => {
  const d = drawn.value;
  const g = grid.value;
  popoverOpen.value = false;
  if (!filtered.value) drawn.value = null;
  if (!d || !g) return;
  emit("ask-ai", {
    selection: d.selection,
    count: spansInCells(g, d.cells),
    band: bandText(d.selection),
    window: windowText(d.selection.timeStartUs, d.selection.timeEndUs),
  });
};

const clearSelection = () => {
  popoverOpen.value = false;
  filtered.value = false;
  drawn.value = null;
  emit("clear");
};

const menuBody = ref<HTMLElement | null>(null);
const MENU_KEYS: Record<string, () => void> = {
  f: filterSelection,
  d: drillDown,
  escape: clearSelection,
};

// On document, not the menu body: the menu content itself holds focus on open, and reka's Escape only closes.
const onMenuKeydown = (event: KeyboardEvent) => {
  const content = menuBody.value?.closest<HTMLElement>('[role="menu"]');
  if (!content || !(event.target instanceof Node) || !content.contains(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const action = MENU_KEYS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  action();
};

watch(popoverOpen, (open) => {
  if (open) document.addEventListener("keydown", onMenuKeydown, true);
  else document.removeEventListener("keydown", onMenuKeydown, true);
});

onBeforeUnmount(() => document.removeEventListener("keydown", onMenuKeydown, true));
</script>
