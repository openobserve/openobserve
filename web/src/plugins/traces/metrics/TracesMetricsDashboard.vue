<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="traces-metrics-dashboard tw:w-full">
    <!-- Collapsible Header -->
    <div
      v-if="show"
      class="dashboard-header q-px-sm q-py-xs tw:cursor-pointer tw:hover:bg-[var(--o2-hover-accent)]"
      @click="toggleCollapse"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 cursor-pointer flex-1">
          <q-icon
            name="expand_more"
            size="1.2rem"
            class="collapse-icon"
            :class="{ collapsed: !searchObj.meta.showHistogram }"
          />

          <div class="header-content tw:ml-[0.125rem]">
            <span class="tw:text-[0.85rem] text-bold"
              >Rate, Error and Duration</span
            >
          </div>
        </div>
        <q-btn
          outline
          dense
          no-caps
          color="primary"
          icon="analytics"
          :label="t('volumeInsights.insightsButtonLabel')"
          class="analyze-button tw:h-[2rem]"
          @click="openUnifiedAnalysisDashboard"
          data-test="insights-button"
        >
          <q-tooltip>{{ t("volumeInsights.analyzeTooltipTraces") }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Collapsible Charts Section -->
    <transition name="slide-fade">
      <div v-show="searchObj.meta.showHistogram" class="charts-wrapper">
        <div class="charts-container">
          <RenderDashboardCharts
            v-if="show"
            ref="dashboardChartsRef"
            :viewOnly="true"
            :dashboardData="dashboardData"
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
      v-show="searchObj.meta.showHistogram"
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
      :timeRange="originalTimeRangeBeforeSelection || timeRange"
      :rateFilter="analysisRateFilter"
      :durationFilter="analysisDurationFilter"
      :errorFilter="analysisErrorFilter"
      :baseFilter="filter"
      :streamFields="streamFields"
      :analysisType="defaultAnalysisTab"
      :availableAnalysisTypes="['volume', 'latency', 'error']"
      @close="showAnalysisDashboard = false"
    />
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  defineAsyncComponent,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics.json";
import { deepCopy, formatTimeWithSuffix } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

const TracesMetricsContextMenu = defineAsyncComponent(
  () => import("./TracesMetricsContextMenu.vue"),
);

const TracesAnalysisDashboard = defineAsyncComponent(
  () => import("./TracesAnalysisDashboard.vue"),
);

interface TimeRange {
  startTime: number;
  endTime: number;
}

const props = defineProps<{
  streamName: string;
  timeRange: TimeRange;
  filter?: string;
  show?: boolean;
  streamFields?: any[];
}>();

const emit = defineEmits<{
  (e: "time-range-selected", range: { start: number; end: number }): void;
  (e: "filters-updated", filters: string[]): void;
}>();

const { showErrorNotification } = useNotifications();
const store = useStore();
const { searchObj } = useTraces();
const { t } = useI18n();

const autoRefreshEnabled = ref(false);
const autoRefreshIntervalId = ref<number | null>(null);
const error = ref<string | null>(null);
const dashboardChartsRef = ref<any>(null);
const currentTimeObj = ref({
  __global: {
    start_time: new Date(props.timeRange.startTime),
    end_time: new Date(props.timeRange.endTime),
  },
});

const dashboardData = ref(null);

// Collapse state
const toggleCollapse = () => {
  searchObj.meta.showHistogram = !searchObj.meta.showHistogram;
};

// Unified Analysis Dashboard state
const showAnalysisDashboard = ref(false);
const analysisDurationFilter = ref({ start: 0, end: 0 });
const analysisRateFilter = ref({ start: 0, end: 0 });
const analysisErrorFilter = ref({ start: 0, end: 0 });
const defaultAnalysisTab = ref<"latency" | "volume" | "error">("volume");
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

  // Prefer user-defined schema if available
  if (searchObj.data.stream.userDefinedSchema?.length > 0) {
    return searchObj.data.stream.userDefinedSchema;
  }

  return searchObj.data.stream.selectedStreamFields || [];
});

// Use filters from searchObj
const showErrorOnly = computed({
  get: () => searchObj.meta.showErrorOnly,
  set: (val) => {
    searchObj.meta.showErrorOnly = val;
  },
});
const rangeFilters = computed(() => searchObj.meta.metricsRangeFilters);

// Check if duration filter exists
const hasDurationFilter = computed(() => {
  // Force reactivity by accessing rangeFiltersVersion
  rangeFiltersVersion.value;

  let hasFilter = false;
  rangeFilters.value.forEach((filter) => {
    if (filter.panelTitle === "Duration") {
      // Show analyze button if we have any duration filter (start or end)
      if (filter.start !== null || filter.end !== null) {
        hasFilter = true;
      }
    }
  });
  return hasFilter;
});

// Check if rate filter exists
const hasRateFilter = computed(() => {
  // Force reactivity by accessing rangeFiltersVersion
  rangeFiltersVersion.value;

  let hasFilter = false;
  rangeFilters.value.forEach((filter) => {
    if (filter.panelTitle === "Rate") {
      // Show volume analyze button if we have any rate filter (start or end)
      if (filter.start !== null || filter.end !== null) {
        hasFilter = true;
      }
    }
  });
  return hasFilter;
});

// Check if error filter exists
const hasErrorFilter = computed(() => {
  // Force reactivity by accessing rangeFiltersVersion
  rangeFiltersVersion.value;

  let hasFilter = false;
  rangeFilters.value.forEach((filter) => {
    if (filter.panelTitle === "Errors") {
      // Show error analyze button if we have any error filter (start or end)
      if (filter.start !== null || filter.end !== null) {
        hasFilter = true;
      }
    }
  });
  return hasFilter;
});

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
        baseFilters.push(
          `duration >= ${rangeFilter.start} and duration <= ${rangeFilter.end}`,
        );
      } else {
        baseFilters.push(
          `duration ${rangeFilter.start ? ">=" : "<="} ${rangeFilter.start || rangeFilter.end}`,
        );
      }
    }
  });

  // Add error filter if showErrorOnly is enabled
  if (showErrorOnly.value) {
    baseFilters.push("span_status = 'ERROR'");
  }

  // Add user-provided filters from query editor
  if (props.filter?.trim().length) {
    baseFilters.push(props.filter.trim());
  }

  return baseFilters;
};

const loadDashboard = async () => {
  try {
    error.value = null;

    currentTimeObj.value = {
      __global: {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      },
    };

    // Convert the dashboard schema and update stream names
    const convertedDashboard = convertDashboardSchemaVersion(deepCopy(metrics));

    const baseFilters: string[] = getBaseFilters();
    convertedDashboard.tabs[0].panels.forEach((panel, index) => {
      // Build WHERE clause based on filters
      let whereClause = "";

      // Special handling for "Errors" panel - always filter by error status
      if (panel.title === "Errors") {
        const errorFilters = ["span_status = 'ERROR'"];
        if (props.filter?.trim().length) {
          errorFilters.push(props.filter.trim());
        }

        if (baseFilters.length) {
          errorFilters.push(...baseFilters);
        }

        whereClause = errorFilters.length
          ? "WHERE " + errorFilters.join(" AND ")
          : "";
      } else {
        // For Rate and Duration panels, apply the combined filters
        whereClause = baseFilters.length
          ? "WHERE " + baseFilters.join(" AND ")
          : "";
      }

      const streamName = searchObj.data.stream.selectedStream.value;

      convertedDashboard.tabs[0].panels[index]["queries"][0].query = panel[
        "queries"
      ][0].query.replace("[STREAM_NAME]", `"${streamName}"`);

      convertedDashboard.tabs[0].panels[index]["queries"][0].query = panel[
        "queries"
      ][0].query.replace("[WHERE_CLAUSE]", whereClause);
    });

    dashboardData.value = convertedDashboard;

    updateLayout();
  } catch (err: any) {
    console.error("Error loading dashboard:", err);
    error.value = err.message || "Failed to load metrics dashboard";
    showErrorNotification(error.value);
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
  data,
  start = null,
  end = null,
  timeStart = null,
  timeEnd = null,
) => {
  const panelId = data?.id;
  const panelTitle = data?.title || "Chart";

  // Support Duration, Rate, and Errors panels
  if (
    panelId &&
    (panelTitle === "Duration" ||
      panelTitle === "Rate" ||
      panelTitle === "Errors")
  ) {
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
    if (rangeFilter.panelTitle === "Duration") {
      // Duration filter: use microseconds values from Y-axis
      if (rangeFilter.start !== null && rangeFilter.end !== null) {
        filters.push(
          `duration >= ${rangeFilter.start} and duration <= ${rangeFilter.end}`,
        );
      } else if (rangeFilter.start !== null) {
        filters.push(`duration >= ${rangeFilter.start}`);
      } else if (rangeFilter.end !== null) {
        filters.push(`duration <= ${rangeFilter.end}`);
      }
    } else if (rangeFilter.panelTitle === "Errors") {
      // Error filter: just add span_status check
      filters.push("span_status = 'ERROR'");
    }
    // Note: Rate filter only affects time range, not query filter
  });

  emit("filters-updated", filters);
};

const onDataZoom = ({
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
      startTime: props.timeRange.startTime,
      endTime: props.timeRange.endTime,
    };

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

    // All panels emit time-range-selected to update global datetime control
    emit("time-range-selected", { start, end });
  }
};

const removeRangeFilter = (panelId: string) => {
  searchObj.meta.metricsRangeFilters.delete(panelId);
  // Increment version to trigger reactivity
  rangeFiltersVersion.value++;

  // Emit updated filters to parent to update Query Editor
  emitFiltersToQueryEditor();
};

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
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

const openAnalysisDashboard = () => {
  // Get the current duration range from existing filters
  let durationStart = null;
  let durationEnd = null;

  rangeFilters.value.forEach((filter) => {
    if (filter.panelTitle === "Duration") {
      durationStart = filter.start;
      durationEnd = filter.end;
    }
  });

  // Set the duration filter for analysis
  analysisDurationFilter.value = {
    start: durationStart || 0,
    end: durationEnd || Number.MAX_SAFE_INTEGER,
  };

  showAnalysisDashboard.value = true;
};

const openVolumeAnalysisDashboard = () => {
  // Get the current rate range from existing filters
  let rateStart = null;
  let rateEnd = null;
  let timeStart = null;
  let timeEnd = null;

  rangeFilters.value.forEach((filter) => {
    if (filter.panelTitle === "Rate") {
      rateStart = filter.start;
      rateEnd = filter.end;
      timeStart = filter.timeStart;
      timeEnd = filter.timeEnd;
    }
  });

  // Set the rate filter for analysis
  analysisRateFilter.value = {
    start: rateStart || 0,
    end: rateEnd || Number.MAX_SAFE_INTEGER,
    timeStart: timeStart || undefined,
    timeEnd: timeEnd || undefined,
  };

  showVolumeAnalysisDashboard.value = true;
};

const openErrorAnalysisDashboard = () => {
  // Get the current error range from existing filters
  let errorStart = null;
  let errorEnd = null;
  let timeStart = null;
  let timeEnd = null;

  rangeFilters.value.forEach((filter) => {
    if (filter.panelTitle === "Errors") {
      errorStart = filter.start;
      errorEnd = filter.end;
      timeStart = filter.timeStart;
      timeEnd = filter.timeEnd;
    }
  });

  // Set the error filter for analysis
  analysisErrorFilter.value = {
    start: errorStart || 0,
    end: errorEnd || Number.MAX_SAFE_INTEGER,
    timeStart: timeStart || undefined,
    timeEnd: timeEnd || undefined,
  };

  showErrorAnalysisDashboard.value = true;
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
        latestFilterType = "latency";
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

const toggleAutoRefresh = () => {
  autoRefreshEnabled.value = !autoRefreshEnabled.value;

  if (autoRefreshEnabled.value) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
};

const startAutoRefresh = () => {
  if (autoRefreshIntervalId.value !== null) {
    stopAutoRefresh();
  }

  autoRefreshIntervalId.value = window.setInterval(() => {
    refreshDashboard();
  }, 30000); // 30 seconds
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
});
</script>

<style lang="scss" scoped>
.traces-metrics-dashboard {
  overflow: hidden;

  :deep(.card-container) {
    box-shadow: none;

    :first-child {
      padding: 0 0.0625rem !important;
    }
  }
}

// Dashboard header
.dashboard-header {
  border-bottom: 1px solid var(--o2-border-color);
  user-select: none;
  transition: background 0.2s ease;

  .header-clickable {
    padding: 4px 0;
    border-radius: 4px;
    transition: background 0.2s ease;

    &:hover {
      background: rgba(25, 118, 210, 0.06);
    }

    &:active {
      background: rgba(25, 118, 210, 0.1);
    }
  }

  .collapse-icon {
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    transform-origin: center;
    color: #6b7280;

    &.collapsed {
      transform: rotate(-90deg);
    }
  }

  .header-content {
    .text-subtitle2 {
      font-size: 13px;
      line-height: 1.2;
      user-select: none;
      transition: color 0.2s ease;
    }
  }

  .analyze-button {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0 0.75rem;
    transition: all 0.2s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
  }
}

// Slide fade transition
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(-10px);
  max-height: 0;
}

.slide-fade-enter-to {
  opacity: 1;
  transform: translateY(0);
  max-height: 500px;
}

.slide-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 500px;
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
  max-height: 0;
}

// Charts wrapper
.charts-wrapper {
  padding: 0.25rem;
  overflow: hidden;
  will-change: transform, opacity;
}

// Dark mode support
body.body--dark {
  .dashboard-header {
    .header-clickable {
      &:hover {
        background: rgba(25, 118, 210, 0.12);
      }

      &:active {
        background: rgba(25, 118, 210, 0.18);
      }
    }

    .collapse-icon {
      color: #9ca3af;
    }

    .header-content .text-subtitle2 {
      color: #e5e7eb;
    }

    .insights-button {
      background: linear-gradient(135deg, #2b6cb0 0%, #2c5282 100%);

      &:hover {
        background: linear-gradient(135deg, #2c5282 0%, #1e3a5f 100%);
      }
    }
  }

  .charts-container {
    border-color: rgba(255, 255, 255, 0.1);

    &:hover {
      box-shadow: 0 2px 8px rgba(255, 255, 255, 0.08);
    }
  }
}
</style>
