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
        class="charts-wrapper py-0! min-h-[8.5rem] h-40 overflow-hidden will-change-[transform,opacity]"
      >
        <div
          class="dark:border-[rgba(255,255,255,0.1)] dark:hover:shadow-[0_2px_8px_rgba(255,255,255,0.08)]"
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
            @chart:contextmenu="handleChartContextMenu"
          />
        </div>
      </div>
    </transition>

    <TracesMetricsContextMenu
      v-if="show"
      :visible="contextMenuVisible"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      :value="contextMenuValue"
      :fieldName="contextMenuFieldName"
      @select="handleContextMenuSelect"
      @close="hideContextMenu"
    />

    <!-- Unified Analysis Dashboard with Tabs -->
    <TracesAnalysisDashboard
      v-if="showAnalysisDashboard"
      :streamName="streamName"
      streamType="traces"
      :timeRange="originalTimeRangeBeforeSelection || effectiveTimeRange"
      :rateFilter="analysisRateFilter"
      :durationFilter="analysisDurationFilter"
      :errorFilter="analysisErrorFilter"
      :baseFilter="effectiveFilter"
      :streamFields="streamFields"
      :analysisType="defaultAnalysisTab"
      :availableAnalysisTypes="['volume', 'error', 'duration']"
      @close="showAnalysisDashboard = false"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onBeforeUnmount, computed, defineAsyncComponent, nextTick } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics.json";
import { deepCopy, formatTimeWithSuffix } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { parseSpanKindWhereClause } from "@/utils/traces/constants";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TracesMetricsContextMenu = defineAsyncComponent(
  () => import("./TracesMetricsContextMenu.vue"),
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
}>();

const { showErrorNotification } = useNotifications();
useStore();
const { searchObj, tracesParser } = useTraces();
useI18n();

// Read filter and timeRange directly from the shared composable rather than via props.
// The props go stale during synchronous call chains (e.g., auto_query_enabled
// triggers searchData → getQueryData → getDashboardData → loadDashboard before
// Vue has re-rendered SearchResult and propagated the new prop). Reading from the
// composable — the same object buildSearch() reads — guarantees the latest value.
const effectiveFilter = computed(() => searchObj.data.editorValue);
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

// Unified Analysis Dashboard state
interface AnalysisFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
}
const showAnalysisDashboard = ref(false);
const analysisDurationFilter = ref<AnalysisFilter | undefined>({ start: 0, end: 0 });
const analysisRateFilter = ref<AnalysisFilter | undefined>({ start: 0, end: 0 });
const analysisErrorFilter = ref<AnalysisFilter | undefined>({ start: 0, end: 0 });
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

// Runtime entries carry timeStart/timeEnd (set below); the useTraces Map generic omits them.
type MetricsRangeFilter = {
  panelTitle: string;
  start: number | null;
  end: number | null;
  timeStart?: number | null;
  timeEnd?: number | null;
};
const rangeFilters = computed(
  () => searchObj.meta.metricsRangeFilters as Map<string, MetricsRangeFilter>,
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

// Context menu state
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuValue = ref(0);
const contextMenuFieldName = ref("");
const contextMenuData = ref<any>(null);

const getBaseFilters = () => {
  let baseFilters = [];
  rangeFilters.value.forEach((rangeFilter) => {
    if (rangeFilter.panelTitle === "Duration") {
      if (rangeFilter.start !== null && rangeFilter.end !== null) {
        baseFilters.push(`duration >= ${rangeFilter.start} and duration <= ${rangeFilter.end}`);
      } else {
        baseFilters.push(
          `duration ${rangeFilter.start ? ">=" : "<="} ${rangeFilter.start || rangeFilter.end}`,
        );
      }
    }
  });

  // Add user-provided filters from query editor, parsing any human-readable
  // duration values (e.g. '1.50ms') back to raw microseconds for SQL,
  // and span_kind labels (e.g. 'Server') back to numeric OTEL keys (e.g. '2').
  if (effectiveFilter.value?.trim().length) {
    const parsed = parseDurationWhereClause(
      effectiveFilter.value.trim(),
      tracesParser.value,
      searchObj.data.stream.selectedStream.value,
    );
    baseFilters.push(
      parseSpanKindWhereClause(
        typeof parsed === "string" ? parsed : effectiveFilter.value.trim(),
        tracesParser.value,
        searchObj.data.stream.selectedStream.value,
      ),
    );
  }

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
    convertedDashboard.tabs[0].panels.forEach(
      (panel: { title?: string; queries: { query: string }[] }, index: number) => {
        // Build WHERE clause based on filters
        let whereClause = "";

        // Special handling for "Errors" panel - always filter by error status
        if (panel.title === "Errors") {
          const errorFilters = ["span_status = 'ERROR'"];
          if (effectiveFilter.value?.trim().length) {
            // Parse human-readable duration values back to raw µs for SQL,
            // and span_kind labels back to numeric OTEL keys.
            const parsedFilter = parseDurationWhereClause(
              effectiveFilter.value.trim(),
              tracesParser.value,
              searchObj.data.stream.selectedStream.value,
            );
            errorFilters.push(
              parseSpanKindWhereClause(
                typeof parsedFilter === "string" ? parsedFilter : effectiveFilter.value.trim(),
                tracesParser.value,
                searchObj.data.stream.selectedStream.value,
              ),
            );
          }

          if (baseFilters.length) {
            errorFilters.push(...baseFilters);
          }

          whereClause = errorFilters.length ? "WHERE " + errorFilters.join(" AND ") : "";
        } else if (panel.title === "Duration" && !isSpansMode) {
          // Traces mode: restrict Duration percentiles to root spans only so that
          // each trace contributes exactly one duration value. Root spans are
          // identified by an absent reference_parent_span_id (NULL or empty string).
          const durationFilters = [...baseFilters];
          if (durationFilters.length) whereClause = "WHERE " + durationFilters.join(" AND ");
        } else {
          // Spans mode Duration, and Rate panel for both modes: apply combined filters
          whereClause = baseFilters.length ? "WHERE " + baseFilters.join(" AND ") : "";
        }

        const streamName = searchObj.data.stream.selectedStream.value;

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
    const message: string = err.message || "Failed to load metrics dashboard";
    error.value = message;
    showErrorNotification(message);
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
    (searchObj.meta.metricsRangeFilters as Map<string, MetricsRangeFilter>).set(panelId, {
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
    if (rangeFilter.panelTitle === "Duration") {
      // Duration filter: format µs values as human-readable strings so they
      // render nicely in the query editor and are decoded by parseDurationWhereClause.
      if (rangeFilter.start !== null && rangeFilter.end !== null) {
        filters.push(
          `duration >= '${formatTimeWithSuffix(rangeFilter.start)}' and duration <= '${formatTimeWithSuffix(rangeFilter.end)}'`,
        );
      } else if (rangeFilter.start !== null) {
        filters.push(`duration >= '${formatTimeWithSuffix(rangeFilter.start)}'`);
      } else if (rangeFilter.end !== null) {
        filters.push(`duration <= '${formatTimeWithSuffix(rangeFilter.end)}'`);
      }
    } else if (rangeFilter.panelTitle === "Errors") {
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
  start1,
  end1,
  data,
}: {
  start: number;
  end: number;
  start1: number;
  end1: number;
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
    } else {
      // For Duration/other panels: use actual Y-axis values (start1, end1)
      // ALSO pass time range so all tabs can use it for comparison
      const timeStartMicros = start * 1000;
      const timeEndMicros = end * 1000;

      createRangeFilter(data, start1, end1, timeStartMicros, timeEndMicros);
    }
  }
};

const handleChartContextMenu = (event: any) => {
  // Extract field name from series name
  // For traces metrics, the panel titles are "Rate", "Errors", "Duration"
  const panelTitle = event.panelTitle || "";
  const seriesName = event.seriesName || "";

  if (panelTitle === "Duration") {
    // Use panel title as field name (Rate, Errors, Duration)
    contextMenuFieldName.value = panelTitle || seriesName || "Value";

    contextMenuVisible.value = true;
    contextMenuPosition.value = { x: event.x, y: event.y };
    contextMenuValue.value = event.value;
    contextMenuData.value = event;
  }
};

const hideContextMenu = () => {
  contextMenuVisible.value = false;
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

    rangeFilters.value.forEach((filter) => {
      if (filter.panelTitle === "Duration") {
        durationStart = filter.start;
        durationEnd = filter.end;
        durationTimeStart = filter.timeStart;
        durationTimeEnd = filter.timeEnd;
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

const handleContextMenuSelect = (selection: {
  condition: string;
  value: number;
  fieldName: string;
}) => {
  createRangeFilter(
    {
      id: contextMenuData.value.panelId,
      title: contextMenuData.value.panelTitle,
    },
    selection.condition === "gte" ? selection.value : null,
    selection.condition === "lte" ? selection.value : null,
  );

  hideContextMenu();
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
