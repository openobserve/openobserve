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

    <Teleport v-if="showAnalysisDashboard" defer to="#traces-drill-down-page">
      <TracesAnalysisDashboard
        full-page
        :streamName="streamName"
        streamType="traces"
        :timeRange="originalTimeRangeBeforeSelection || effectiveTimeRange"
        :rateFilter="analysisRateFilter"
        :durationFilter="analysisDurationFilter"
        :errorFilter="analysisErrorFilter"
        :baseFilter="parsedEffectiveFilter"
        :baselineFilter="analysisBaselineFilter"
        :streamFields="streamFields"
        :analysisType="defaultAnalysisTab"
        :availableAnalysisTypes="['volume', 'error', 'duration']"
        @close="showAnalysisDashboard = false"
      />
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  defineAsyncComponent,
  nextTick,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics.json";
import { deepCopy } from "@/utils/zincutils";
import type { MetricsRangeFilter } from "@/ts/interfaces/traces/trace.types";
import TracesLatencyHeatmap, { type LatencyHeatmapRequest } from "./TracesLatencyHeatmap.vue";
import {
  buildLatencyHeatmapSql,
  composeFilter,
  durationBand,
  instantToPickerMs,
  type LatencyHeatmapSelection,
} from "./latencyHeatmap";
import useTraces from "@/composables/useTraces";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { parseSpanKindWhereClause } from "@/utils/traces/constants";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TracesAnalysisDashboard = defineAsyncComponent(() => import("./TracesAnalysisDashboard.vue"));

export interface TimeRange {
  startTime: number;
  endTime: number;
}

const props = defineProps<{
  streamName: string;
  show?: boolean;
  streamFields?: any[];
}>();

const emit = defineEmits<{
  (e: "time-range-selected", range: { start: number; end: number }): void;
  (e: "filters-updated", filters: string[]): void;
  (e: "editor-filter-set", text: string): void;
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
const parsedEffectiveFilter = computed(() => parseEffectiveFilter());

const effectiveTimeRange = computed<TimeRange>(() => ({
  startTime: searchObj.data.datetime.startTime,
  endTime: searchObj.data.datetime.endTime,
}));

const autoRefreshIntervalId = ref<number | null>(null);
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

// Unified Analysis Dashboard state
interface AnalysisFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
}
const showAnalysisDashboard = ref(false);
// The analysis is a snapshot of the search that opened it, so a new search closes it.
watch(
  () => searchObj.loading,
  (loading, wasLoading) => {
    if (loading && !wasLoading) showAnalysisDashboard.value = false;
  },
);
const analysisDurationFilter = ref<AnalysisFilter | undefined>({ start: 0, end: 0 });
const analysisRateFilter = ref<AnalysisFilter | undefined>({ start: 0, end: 0 });
const analysisErrorFilter = ref<AnalysisFilter | undefined>({ start: 0, end: 0 });
const analysisBaselineFilter = ref<string | undefined>(undefined);
const defaultAnalysisTab = ref<"duration" | "volume" | "error">("volume");
// Store the original time range before selection for baseline comparison
const originalTimeRangeBeforeSelection = ref<TimeRange | null>(null);

// Reactivity trigger for Map changes (Vue 3 doesn't track Map.set() automatically)
const rangeFiltersVersion = ref(0);

// Stream fields for dimension selector
// Priority: props > userDefinedSchema > selectedStreamFields
const streamFields = computed(() => {
  if (props.streamFields) {
    return props.streamFields;
  }

  // Prefer user-defined schema if available.
  // Set dynamically on shared stream state; not part of useTraces defaults.
  const userDefinedSchema = searchObj.data.stream.userDefinedSchema;
  if (userDefinedSchema?.length > 0) {
    return userDefinedSchema;
  }

  return searchObj.data.stream.selectedStreamFields || [];
});

const rangeFilters = computed<Map<string, MetricsRangeFilter>>(
  () => searchObj.meta.metricsRangeFilters,
);

// Check if ANY RED panel has a time-based brush selection
// This controls the visibility of the "Analyze Dimensions" button
// - Button shows ONLY when user has made a brush selection on Rate, Duration, or Errors panel
// - Button hides when no selection exists (baseline = selected, no point in analysis)
// - When button is clicked, analysis dashboard opens with comparison mode
const hasAnyBrushSelection = computed(() => {
  // Force reactivity by accessing rangeFiltersVersion
  rangeFiltersVersion.value;

  let hasSelection = false;
  rangeFilters.value.forEach((filter) => {
    // Check if any RED panel has a time range selection
    if (
      (filter.panelTitle === "Duration" ||
        filter.panelTitle === "Rate" ||
        filter.panelTitle === "Errors") &&
      filter.timeStart !== null &&
      filter.timeEnd !== null
    ) {
      hasSelection = true;
    }
  });

  return hasSelection;
});

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

    heatmapRequest.value = {
      sql: buildLatencyHeatmapSql(streamName, baseFilters),
      startTime: effectiveTimeRange.value.startTime,
      endTime: effectiveTimeRange.value.endTime,
    };
    convertedDashboard.tabs[0].panels.forEach(
      (panel: { title?: string; queries: { query: string }[] }, index: number) => {
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
          .replace("[WHERE_CLAUSE]", () => whereClause);

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

const createRangeFilter = (
  data: { id?: string; title?: string } | undefined,
  start: number | null = null,
  end: number | null = null,
  timeStart: number | null = null,
  timeEnd: number | null = null,
) => {
  const panelId = data?.id;
  const panelTitle = data?.title || "Chart";

  // Support Duration, Rate, and Errors panels
  if (panelId && (panelTitle === "Duration" || panelTitle === "Rate" || panelTitle === "Errors")) {
    searchObj.meta.metricsRangeFilters.set(panelId, {
      panelTitle,
      start: start ? Math.floor(start) : null,
      end: end ? Math.floor(end) : null,
      timeStart: timeStart ? Math.floor(timeStart) : null,
      timeEnd: timeEnd ? Math.floor(timeEnd) : null,
    });
    // Increment version to trigger reactivity
    rangeFiltersVersion.value++;

    // Emit filters to parent to update Query Editor
    emitFiltersToQueryEditor();
  }
};

// Build filter strings from current range filters and emit to parent
const emitFiltersToQueryEditor = () => {
  const filters: string[] = [];

  searchObj.meta.metricsRangeFilters.forEach((rangeFilter) => {
    if (rangeFilter.panelTitle === "Errors") {
      // Error filter: just add span_status check
      filters.push("span_status = 'ERROR'");
    }
    // Note: Rate filter only affects time range, not query filter
  });

  emit("filters-updated", filters);
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
  if (start && end) {
    const panelTitle = data?.title;

    // Store the original time range BEFORE selection for volume analysis baseline
    // This must be done before emit() which triggers the parent to update the datetime control
    originalTimeRangeBeforeSelection.value = {
      startTime: effectiveTimeRange.value.startTime,
      endTime: effectiveTimeRange.value.endTime,
    };

    searchObj.meta.metricsRangeFilters.clear();

    // All panels emit time-range-selected to update global datetime control
    emit("time-range-selected", { start, end });

    await nextTick();

    // For Rate and Errors panels: use placeholder values to indicate time-based selection
    // Volume/Error analysis will use the time range, not Y-axis values
    if (panelTitle === "Rate" || panelTitle === "Errors") {
      // Convert milliseconds to microseconds for OpenObserve timestamp format
      const timeStartMicros = start * 1000;
      const timeEndMicros = end * 1000;

      // Use -1 as placeholder to indicate time-based zoom (not Y-axis value zoom)
      // Pass actual time range as timeStart/timeEnd for volume/error analysis
      createRangeFilter(data, -1, -1, timeStartMicros, timeEndMicros);
    }
  }
};

const onHeatmapSelect = async (selection: LatencyHeatmapSelection) => {
  const { timeStartUs, timeEndUs, durationLoUs: lo, durationHiUs: hi } = selection;
  // A refinement box keeps the pre-box baseline; re-snapshotting would bake the first band into it.
  const current = [...rangeFilters.value.values()].find((f) => f.panelTitle === "Duration");
  const baselineFilter = current?.baselineFilter ?? searchObj.data.editorValue ?? "";

  if (!current || !originalTimeRangeBeforeSelection.value) {
    originalTimeRangeBeforeSelection.value = {
      startTime: effectiveTimeRange.value.startTime,
      endTime: effectiveTimeRange.value.endTime,
    };
  }
  searchObj.meta.metricsRangeFilters.clear();

  emit("time-range-selected", {
    start: instantToPickerMs(timeStartUs / 1000, store.state.timezone),
    end: instantToPickerMs(timeEndUs / 1000, store.state.timezone),
  });

  await nextTick();

  // Set directly, not via createRangeFilter: its filters-updated would add a second live-mode search.
  searchObj.meta.metricsRangeFilters.set(LATENCY_HEATMAP_PANEL_ID, {
    panelTitle: "Duration",
    start: lo || null,
    end: hi,
    timeStart: timeStartUs,
    timeEnd: timeEndUs,
    appliedStart: searchObj.data.datetime.startTime,
    appliedEnd: searchObj.data.datetime.endTime,
    baselineFilter,
    stream: searchObj.data.stream.selectedStream.value,
    searchMode: searchObj.meta.searchMode,
  });
  rangeFiltersVersion.value++;
  emit("editor-filter-set", composeFilter(baselineFilter, durationBand(lo, hi)));
};

// Unified function to open analysis dashboard with all filters populated
const openUnifiedAnalysisDashboard = () => {
  // Check if there are any brush selections
  const hasBrushSelection = hasAnyBrushSelection.value;

  if (!hasBrushSelection) {
    // Baseline-only analysis (no brush selection)
    // Set all filters to undefined to perform analysis only on baseline time range
    analysisDurationFilter.value = undefined;
    analysisRateFilter.value = undefined;
    analysisErrorFilter.value = undefined;
    analysisBaselineFilter.value = undefined;

    // Default to volume tab when no brush selection
    defaultAnalysisTab.value = "volume";
  } else {
    // Brush selection exists - compare baseline vs selected time range
    // Populate all filter types from range filters
    let durationStart = null,
      durationEnd = null,
      durationTimeStart = null,
      durationTimeEnd = null;
    let rateStart = null,
      rateEnd = null,
      rateTimeStart = null,
      rateTimeEnd = null;
    let errorStart = null,
      errorEnd = null,
      errorTimeStart = null,
      errorTimeEnd = null;
    let latestFilterType = null;
    let baselineFilter: string | undefined;

    rangeFilters.value.forEach((filter) => {
      if (filter.panelTitle === "Duration") {
        durationStart = filter.start;
        durationEnd = filter.end;
        // The picker applies the box to the second, so Selected must use what it applied.
        durationTimeStart = filter.appliedStart ?? filter.timeStart;
        durationTimeEnd = filter.appliedEnd ?? filter.timeEnd;
        baselineFilter = filter.baselineFilter;
        latestFilterType = "duration";
      } else if (filter.panelTitle === "Rate") {
        rateStart = filter.start;
        rateEnd = filter.end;
        rateTimeStart = filter.timeStart;
        rateTimeEnd = filter.timeEnd;
        latestFilterType = "volume";
      } else if (filter.panelTitle === "Errors") {
        errorStart = filter.start;
        errorEnd = filter.end;
        errorTimeStart = filter.timeStart;
        errorTimeEnd = filter.timeEnd;
        latestFilterType = "error";
      }
    });

    analysisBaselineFilter.value =
      baselineFilter === undefined ? undefined : decodeFilter(baselineFilter);

    // Set all filters
    analysisDurationFilter.value = {
      start: durationStart || 0,
      end: durationEnd || Number.MAX_SAFE_INTEGER,
      timeStart: durationTimeStart || undefined,
      timeEnd: durationTimeEnd || undefined,
    };

    analysisRateFilter.value = {
      start: rateStart || 0,
      end: rateEnd || Number.MAX_SAFE_INTEGER,
      timeStart: rateTimeStart || undefined,
      timeEnd: rateTimeEnd || undefined,
    };

    analysisErrorFilter.value = {
      start: errorStart || 0,
      end: errorEnd || Number.MAX_SAFE_INTEGER,
      timeStart: errorTimeStart || undefined,
      timeEnd: errorTimeEnd || undefined,
    };

    // Set default tab based on most recent selection, or volume if no selection
    defaultAnalysisTab.value = latestFilterType || "volume";
  }

  showAnalysisDashboard.value = true;
};

const clearOriginalTimeRange = () => {
  originalTimeRangeBeforeSelection.value = null;
};

const stopAutoRefresh = () => {
  if (autoRefreshIntervalId.value !== null) {
    clearInterval(autoRefreshIntervalId.value);
    autoRefreshIntervalId.value = null;
  }
};

onMounted(() => {
  loadDashboard();
});

onBeforeUnmount(() => {
  stopAutoRefresh();
});

defineExpose({
  refresh: refreshDashboard,
  resetZoom: () => {
    // Dashboard handles zoom reset through toolbar
  },
  loadDashboard,
  getBaseFilters,
  rangeFiltersVersion,
  openUnifiedAnalysisDashboard,
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
