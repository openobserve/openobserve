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
  <div data-test="traces-metrics-dashboard" class="traces-metrics-dashboard w-full overflow-hidden">
    <!-- Charts Section -->
    <transition name="slide-fade">
      <div
        v-if="show"
        class="charts-wrapper dashboard-strip flex h-auto min-h-[8.5rem] flex-col overflow-hidden py-0! will-change-[transform,opacity] md:h-40 md:flex-row"
      >
        <div
          class="h-40 min-w-0 md:h-auto md:flex-2 dark:border-[rgba(255,255,255,0.1)] dark:hover:shadow-sm"
        >
          <RenderDashboardCharts
            v-if="show"
            ref="dashboardChartsRef"
            :viewOnly="true"
            :frame="false"
            :dashboardData="dashboardData || {}"
            :currentTimeObj="currentTimeObj"
            :allowAlertCreation="false"
            searchType="dashboards"
            @updated:dataZoom="onDataZoom"
          />
        </div>
        <div class="h-40 min-w-0 px-1 py-0.5 md:h-auto md:flex-1">
          <TracesLatencyHeatmap :request="heatmapRequest" @select="onHeatmapSelect" />
        </div>
      </div>
    </transition>

    <Teleport v-if="showComparison" defer to="#traces-drill-down-page">
      <TracesComparison
        :selection="comparisonSelection"
        :streamName="streamName"
        @close="showComparison = false"
        @apply-filter="onComparisonApply"
      />
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import { ref, shallowRef, onMounted, computed, defineAsyncComponent, nextTick, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics.json";
import { deepCopy } from "@/utils/zincutils";
import type { MetricsRangeFilter } from "@/ts/interfaces/traces/trace.types";
import TracesLatencyHeatmap, { type LatencyHeatmapRequest } from "./TracesLatencyHeatmap.vue";
import type { ComparisonSelection } from "./traceComparison";
import {
  buildLatencyHeatmapSql,
  chartInterval,
  composeFilter,
  instantToPickerMs,
  isRangeSelectionCurrent,
  selectionTerm,
  type LatencyHeatmapSelection,
} from "./latencyHeatmap";
import useTraces from "@/composables/useTraces";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { parseSpanKindWhereClause } from "@/utils/traces/constants";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TracesComparison = defineAsyncComponent(() => import("./TracesComparison.vue"));

export interface TimeRange {
  startTime: number;
  endTime: number;
}

defineProps<{
  streamName: string;
  show?: boolean;
  streamFields?: any[];
}>();

const emit = defineEmits<{
  (e: "time-range-selected", range: { start: number; end: number }): void;
  (e: "editor-filter-set", text: string): void;
  (e: "editor-filter-run", text: string): void;
}>();

const LATENCY_HEATMAP_PANEL_ID = "traces_latency_heatmap";

const { showErrorNotification } = useNotifications();
const store = useStore();
const { searchObj, tracesParser } = useTraces();
const { t } = useI18nTyped();

// Read filter and timeRange directly from the shared composable rather than via props.
// The props go stale during synchronous call chains (e.g., auto_query_enabled
// triggers searchData → getQueryData → getDashboardData → loadDashboard before
// Vue has re-rendered SearchResult and propagated the new prop). Reading from the
// composable — the same object buildSearch() reads — guarantees the latest value.
const effectiveFilter = computed(() => searchObj.data.editorValue);

// Query editor text may contain human-readable duration/span_kind literals
// (e.g. duration <= '1.64s') for display; decode them back to raw SQL values
// (microseconds, numeric OTEL keys) before use in any generated query.
const decodeFilter = (text: string | undefined): string => {
  const trimmed = text?.trim();
  if (!trimmed) return "";
  const parsed = parseDurationWhereClause(
    trimmed,
    tracesParser.value,
    searchObj.data.stream.selectedStream.value,
  );
  return parseSpanKindWhereClause(
    typeof parsed === "string" ? parsed : trimmed,
    tracesParser.value,
    searchObj.data.stream.selectedStream.value,
  );
};
const parseEffectiveFilter = (): string => decodeFilter(effectiveFilter.value);

const effectiveTimeRange = computed<TimeRange>(() => ({
  startTime: searchObj.data.datetime.startTime,
  endTime: searchObj.data.datetime.endTime,
}));

const error = ref<string | null>(null);
const dashboardChartsRef = ref<any>(null);
const currentTimeObj = ref({
  __global: {
    start_time: new Date(effectiveTimeRange.value.startTime),
    end_time: new Date(effectiveTimeRange.value.endTime),
  },
});

const dashboardData = ref(null);
const heatmapRequest = ref<LatencyHeatmapRequest | null>(null);

const showComparison = ref(false);
// The comparison is a snapshot of the search that opened it, so a new search closes it.
watch(
  () => searchObj.loading,
  (loading, wasLoading) => {
    if (loading && !wasLoading) showComparison.value = false;
  },
);
const comparisonSelection = shallowRef<ComparisonSelection | null>(null);
let comparisonEntry: MetricsRangeFilter | null = null;
// The range the charts were last loaded for, which a selection's baseline describes.
let chartsRange: TimeRange | null = null;
// Store the original time range before selection for baseline comparison
const originalTimeRangeBeforeSelection = ref<TimeRange | null>(null);

// Reactivity trigger for Map changes (Vue 3 doesn't track Map.set() automatically)
const rangeFiltersVersion = ref(0);

const rangeFilters = computed<Map<string, MetricsRangeFilter>>(
  () => searchObj.meta.metricsRangeFilters,
);

const getBaseFilters = () => {
  let baseFilters = [];
  rangeFilters.value.forEach((rangeFilter) => {
    if (rangeFilter.panelTitle === "Duration") {
      const bounds: string[] = [];
      if (rangeFilter.start !== null) bounds.push(`duration >= ${rangeFilter.start}`);
      if (rangeFilter.end !== null) bounds.push(`duration < ${rangeFilter.end}`);
      if (bounds.length) baseFilters.push(bounds.join(" and "));
    }
  });

  const parsedFilter = parseEffectiveFilter();
  if (parsedFilter) baseFilters.push(parsedFilter);

  return baseFilters;
};

const loadDashboard = async () => {
  try {
    error.value = null;

    currentTimeObj.value = {
      __global: {
        start_time: new Date(effectiveTimeRange.value.startTime),
        end_time: new Date(effectiveTimeRange.value.endTime),
      },
    };

    // Convert the dashboard schema and update stream names
    const convertedDashboard = convertDashboardSchemaVersion(deepCopy(metrics));

    const isSpansMode = searchObj.meta.searchMode === "spans";
    const baseFilters: string[] = getBaseFilters();
    const streamName = searchObj.data.stream.selectedStream.value;
    const interval = chartInterval(
      effectiveTimeRange.value.startTime,
      effectiveTimeRange.value.endTime,
    );

    heatmapRequest.value = {
      sql: buildLatencyHeatmapSql(streamName, baseFilters, interval.sql),
      startTime: effectiveTimeRange.value.startTime,
      endTime: effectiveTimeRange.value.endTime,
    };
    chartsRange = { ...effectiveTimeRange.value };
    convertedDashboard.tabs[0].panels.forEach(
      (
        panel: { title?: string; config: Record<string, unknown>; queries: { query: string }[] },
        index: number,
      ) => {
        // Build WHERE clause based on filters
        let whereClause = "";

        // Special handling for "Errors" panel - always filter by error status
        if (panel.title === "Errors") {
          const errorFilters = ["span_status = 'ERROR'"];
          const parsedFilter = parseEffectiveFilter();
          if (parsedFilter) errorFilters.push(parsedFilter);

          if (baseFilters.length) {
            errorFilters.push(...baseFilters);
          }

          whereClause = errorFilters.length ? "WHERE " + errorFilters.join(" AND ") : "";
        } else {
          whereClause = baseFilters.length ? "WHERE " + baseFilters.join(" AND ") : "";
        }

        // Build the final query: substitute placeholders then apply mode transforms
        let query = panel["queries"][0].query
          .replace("[STREAM_NAME]", () => `"${streamName}"`)
          .replace("[WHERE_CLAUSE]", () => whereClause)
          .replace("[INTERVAL]", interval.sql)
          // The range clips the first and last buckets, so their per-second value dips, as their heatmap columns thin.
          .replace("[INTERVAL_SECONDS]", String(interval.seconds));

        if (panel.title === "Rate") {
          panel.config.unit_custom = isSpansMode
            ? t("traces.metrics.perSecond.spans")
            : t("traces.metrics.perSecond.traces");
        }

        // Spans mode: replace trace-level distinct counts with span-level counts
        // in the Rate and Errors panels.
        if (isSpansMode && (panel.title === "Rate" || panel.title === "Errors")) {
          query = query
            .replace(
              /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/gi,
              "count(*) FILTER (WHERE span_status = 'ERROR')",
            )
            .replace(/approx_distinct\(trace_id\)/gi, "count(*)");
        }

        convertedDashboard.tabs[0].panels[index]["queries"][0].query = query;
      },
    );

    dashboardData.value = convertedDashboard;

    updateLayout();
  } catch (err: any) {
    console.error("Error loading dashboard:", err);
    const message: string = err.message || t("traces.failedToLoadMetricsDashboard");
    error.value = message;
    showErrorNotification(raw(message));
  }
};

const updateLayout = async () => {
  window.dispatchEvent(new Event("resize"));
};

const refreshDashboard = () => {
  if (dashboardChartsRef.value) {
    dashboardChartsRef?.value?.forceRefreshPanel();
  }
};

const onDataZoom = async ({
  start,
  end,
  data,
}: {
  start: number;
  end: number;
  data: any; // contains panel schema with data.id as panel id
}) => {
  if (!start || !end) return;
  const panelTitle = data?.title;
  if (panelTitle !== "Rate" && panelTitle !== "Errors") return;
  // Line charts plot zoned wall-clock times, so a brush value is already what the picker expects.
  await applySelection(panelTitle, data?.id ?? panelTitle, { start, end }, null, null, null, null);
};

const onHeatmapSelect = async (selection: LatencyHeatmapSelection) => {
  const { timeStartUs, timeEndUs, durationLoUs: lo, durationHiUs: hi } = selection;
  // The picker keeps whole seconds; rounding outwards keeps a mid-second clamped edge from emptying the range.
  const pickerRange = {
    start: instantToPickerMs(Math.floor(timeStartUs / 1_000_000) * 1000, store.state.timezone),
    end: instantToPickerMs(Math.ceil(timeEndUs / 1_000_000) * 1000, store.state.timezone),
  };
  await applySelection(
    "Duration",
    LATENCY_HEATMAP_PANEL_ID,
    pickerRange,
    timeStartUs,
    timeEndUs,
    lo || null,
    hi,
  );
};

// One path for a heatmap box and a Rate or Errors brush; brushes pass null times and take what the picker applied.
const applySelection = async (
  panelTitle: "Duration" | "Errors" | "Rate",
  key: string,
  pickerRange: { start: number; end: number },
  timeStartUs: number | null,
  timeEndUs: number | null,
  lo: number | null,
  hi: number | null,
) => {
  // A same-kind selection refines the current one and keeps its baseline; any other starts from the editor as shown.
  const existing = [...rangeFilters.value.values()].find((f) => f.panelTitle === panelTitle);
  const current =
    existing &&
    isRangeSelectionCurrent(existing, {
      startTime: searchObj.data.datetime.startTime,
      endTime: searchObj.data.datetime.endTime,
      stream: searchObj.data.stream.selectedStream.value,
      searchMode: searchObj.meta.searchMode,
      editorText: searchObj.data.editorValue ?? "",
    })
      ? existing
      : undefined;
  const baselineFilter = current?.baselineFilter ?? searchObj.data.editorValue ?? "";

  if (!current || !originalTimeRangeBeforeSelection.value) {
    // The charts show the last search's range; in manual mode the picker may already hold an unsearched box.
    originalTimeRangeBeforeSelection.value = { ...(chartsRange ?? effectiveTimeRange.value) };
  }
  searchObj.meta.metricsRangeFilters.clear();

  emit("time-range-selected", pickerRange);

  await nextTick();

  const entry: MetricsRangeFilter = {
    panelTitle,
    start: lo,
    end: hi,
    timeStart: timeStartUs ?? searchObj.data.datetime.startTime,
    timeEnd: timeEndUs ?? searchObj.data.datetime.endTime,
    appliedStart: searchObj.data.datetime.startTime,
    appliedEnd: searchObj.data.datetime.endTime,
    baselineFilter,
    stream: searchObj.data.stream.selectedStream.value,
    searchMode: searchObj.meta.searchMode,
  };
  searchObj.meta.metricsRangeFilters.set(key, entry);
  rangeFiltersVersion.value++;
  emit("editor-filter-set", composeFilter(baselineFilter, selectionTerm(entry)));
};

const COMPARISON_KINDS: Record<string, ComparisonSelection["kind"]> = {
  Duration: "duration",
  Errors: "errors",
  Rate: "rate",
};

// Opens on the selection the table shows; a stale or missing one opens the no-selection state.
const openComparison = () => {
  const entry = [...rangeFilters.value.values()][0];
  const range = originalTimeRangeBeforeSelection.value ?? effectiveTimeRange.value;
  const current =
    entry &&
    isRangeSelectionCurrent(entry, {
      startTime: searchObj.data.datetime.startTime,
      endTime: searchObj.data.datetime.endTime,
      stream: searchObj.data.stream.selectedStream.value,
      searchMode: searchObj.meta.searchMode,
      editorText: searchObj.data.editorValue ?? "",
    });
  comparisonEntry = current ? entry : null;
  comparisonSelection.value =
    current && COMPARISON_KINDS[entry.panelTitle]
      ? {
          kind: COMPARISON_KINDS[entry.panelTitle],
          windowStartUs: entry.appliedStart,
          windowEndUs: entry.appliedEnd,
          rangeStartUs: range.startTime,
          rangeEndUs: range.endTime,
          durationLoUs: entry.start,
          durationHiUs: entry.end,
          filter: decodeFilter(entry.baselineFilter),
        }
      : null;
  showComparison.value = true;
};

const onComparisonApply = async (term: string) => {
  const entry = comparisonEntry;
  const range = originalTimeRangeBeforeSelection.value ?? effectiveTimeRange.value;
  // R holds instants, not chart wall-clock values, so it converts like a heatmap box.
  emit("time-range-selected", {
    start: instantToPickerMs(Math.floor(range.startTime / 1_000_000) * 1000, store.state.timezone),
    end: instantToPickerMs(Math.ceil(range.endTime / 1_000_000) * 1000, store.state.timezone),
  });
  searchObj.meta.metricsRangeFilters.clear();
  clearOriginalTimeRange();
  rangeFiltersVersion.value++;
  // The picker updates the search range in a watcher; searching before the tick would use the selection's window.
  await nextTick();
  emit("editor-filter-run", composeFilter(entry?.baselineFilter ?? "", term));
};

const clearOriginalTimeRange = () => {
  originalTimeRangeBeforeSelection.value = null;
};

onMounted(() => {
  loadDashboard();
});

defineExpose({
  refresh: refreshDashboard,
  resetZoom: () => {
    // Dashboard handles zoom reset through toolbar
  },
  loadDashboard,
  getBaseFilters,
  rangeFiltersVersion,
  openComparison,
  clearOriginalTimeRange,
});
</script>

<style scoped>
/* keep(lib-override:render-dashboard-charts): RenderDashboardCharts renders its
   own DOM (reached via :deep). Tighten the side padding AND collapse the top
   padding/margin it adds for full dashboards (container pt-2 + inner .displayDiv
   mt-2 = 1rem). In this compact traces view the charts live in a fixed h-40
   (10rem) overflow-hidden wrapper, so that extra 1rem pushes the plot past the
   clip line and cuts off the x-axis. Zeroing it restores the main-branch fit. */
.charts-wrapper :deep(.render-dashboard-charts-container) {
  padding-left: 0.2rem;
  padding-right: 0.2rem;
  padding-top: 0;
}

.charts-wrapper :deep(.displayDiv) {
  margin-top: 0;
}

/* keep(complex-state): slide-fade-* drive the <transition name="slide-fade">
   reveal (enter/leave phases) — Tailwind can't express transition-group state. */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(-0.625rem);
  max-height: 0;
}

.slide-fade-enter-to {
  opacity: 1;
  transform: translateY(0);
  max-height: 31.25rem;
}

.slide-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 31.25rem;
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-0.625rem);
  max-height: 0;
}
</style>
