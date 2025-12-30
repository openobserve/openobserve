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
  <div class="traces-metrics-dashboard tw:w-full tw:pt-2 tw:px-1">
    <!-- Filters Section -->
    <div
      v-if="show"
      class="filters-section tw:flex tw:items-center tw:gap-2 tw:px-1 tw:flex-wrap"
    >
      <span class="filters-label tw:text-sm tw:font-semibold">Filters:</span>
      <!-- Error Only Toggle -->
      <div
        class="tw:flex tw:items-center tw:justify-center tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:rounded-[0.375rem]"
      >
        <q-toggle
          v-model="showErrorOnly"
          class="o2-toggle-button-xs tw:flex tw:items-center tw:justify-center"
          size="xs"
          flat
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-xs-dark'
              : 'o2-toggle-button-xs-light'
          "
          data-test="error-only-toggle"
        />
        <q-icon name="error" size="1.1rem"
class="tw:mx-1 tw:text-red-500" />
        <q-tooltip>Show Error Only</q-tooltip>
      </div>

      <!-- Range Filter Chips -->
      <div
        v-for="[panelId, filter] in rangeFilters"
        :key="panelId"
        class="filter-chip tw:h-[2rem] tw:px-[0.375rem]"
        data-test="range-filter-chip"
      >
        <span class="chip-label"
          >{{ filter.panelTitle }}
          <span v-if="filter.panelTitle === 'Rate' || filter.panelTitle === 'Errors'">
            : {{ t('latencyInsights.timeRangeSelected') }}
          </span>
          <span v-if="filter.panelTitle === 'Duration'">
            <span v-if="filter.start !== null && filter.end !== null">
              {{ formatTimeWithSuffix(filter.start) }} -
              {{ formatTimeWithSuffix(filter.end) }}
            </span>
            <span v-else-if="filter.start !== null">
              >= {{ formatTimeWithSuffix(filter.start) }}
            </span>
            <span v-else-if="filter.end !== null">
              <= {{ formatTimeWithSuffix(filter.end) }}
            </span>
            <span v-if="filter.timeStart && filter.timeEnd">
              | {{ t('latencyInsights.timeRangeSelected') }}
            </span>
          </span>
        </span>
        <q-icon
          name="close"
          size="0.87rem"
          class="chip-close-icon"
          @click="removeRangeFilter(panelId)"
        />
      </div>

      <!-- Unified Analyze Dimensions Button (only shown when brush selection exists) -->
      <q-btn
        v-if="hasAnyBrushSelection"
        outline
        dense
        no-caps
        color="primary"
        icon="analytics"
        :label="t('latencyInsights.analyzeButtonLabel')"
        class="analyze-button tw:h-[2rem]"
        @click="openUnifiedAnalysisDashboard"
        data-test="analyze-dimensions-button"
      >
        <q-tooltip>{{ t('latencyInsights.analyzeTooltip') }}</q-tooltip>
      </q-btn>
    </div>

    <!-- Charts Section -->
    <div
      class="charts-container tw:pt-[0.25rem]!"
      v-show="searchObj.meta.showHistogram"
    >
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
  watch,
  triggerRef,
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
      ][0].query.replace(
        "[STREAM_NAME]",
        `"${streamName}"`,
      );

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


const createRangeFilter = (data, start = null, end = null, timeStart = null, timeEnd = null) => {
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
  }
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
  // Populate all filter types from range filters
  let durationStart = null, durationEnd = null, durationTimeStart = null, durationTimeEnd = null;
  let rateStart = null, rateEnd = null, rateTimeStart = null, rateTimeEnd = null;
  let errorStart = null, errorEnd = null, errorTimeStart = null, errorTimeEnd = null;
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
// Filters label
.filters-label {
  color: #333;
  user-select: none;
}

// Filter chip styles
.filter-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--o2-theme-color);

  .chip-label {
    user-select: none;
  }

  .chip-close-icon {
    cursor: pointer;
    transition: color 0.2s;

    &:hover {
      color: #0d447a;
    }
  }
}

// Analyze button
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

.traces-metrics-dashboard {
  :deep(.card-container) {
    box-shadow: none;

    :first-child {
      padding: 0 0.0625rem !important;
    }
  }
}

// Dark mode support
body.body--dark {
  .traces-metrics-dashboard {
    background: var(--q-dark);
  }

  .filters-label {
    color: #e0e0e0;
  }

  .filter-chip {
    border-color: var(--o2-border-color);
    color: var(--o2-card-text);

    .chip-close-icon:hover {
      color: #ffffff;
    }
  }
}
</style>
