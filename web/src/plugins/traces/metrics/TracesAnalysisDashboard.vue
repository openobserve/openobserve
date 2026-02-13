<!-- Copyright 2025 OpenObserve Inc.

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
  <q-dialog
    v-model="isOpen"
    position="right"
    full-height
    :maximized="true"
    transition-show="slide-left"
    transition-hide="slide-right"
    @hide="onClose"
  >
    <q-card class="analysis-dashboard-card">
      <!-- Header -->
      <q-card-section class="analysis-header tw-flex tw-items-center tw-justify-between tw-py-3 tw-px-4">
        <div class="tw-flex tw-items-center tw-gap-3 tw-flex-wrap">
          <q-icon name="dashboard" size="md" color="primary" />
          <span class="tw-text-lg tw-font-semibold tw-whitespace-nowrap">
            <template v-if="props.analysisType === 'latency'">{{ t('latencyInsights.title') }}</template>
            <template v-else-if="props.analysisType === 'volume'">{{ t('volumeInsights.title') }}</template>
            <template v-else-if="props.analysisType === 'error'">{{ t('errorInsights.title') }}</template>
          </span>

          <!-- Time Range Display: Inline chips -->
          <div class="tw-flex tw-items-center tw-gap-2 tw-flex-wrap">
            <!-- Baseline Chip -->
            <div class="time-range-chip baseline-chip tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0.5 tw-rounded">
              <span class="tw-font-semibold tw-text-[0.6rem] tw-uppercase tw-tracking-wide tw-opacity-70">Baseline</span>
              <span class="tw-whitespace-nowrap tw-text-[0.7rem]">{{ formatSmartTimestamp(baselineTimeRange.startTime, baselineTimeRange.endTime).start }}</span>
              <span class="tw-opacity-60 tw-text-[0.65rem]">→</span>
              <span class="tw-whitespace-nowrap tw-text-[0.7rem]">{{ formatSmartTimestamp(baselineTimeRange.startTime, baselineTimeRange.endTime).end }}</span>
            </div>

            <!-- Selected Chip -->
            <div v-if="hasSelectedTimeRange" class="time-range-chip selected-chip tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0.5 tw-rounded">
              <span class="tw-font-semibold tw-text-[0.6rem] tw-uppercase tw-tracking-wide">Selected</span>
              <span class="tw-whitespace-nowrap tw-text-[0.7rem]">{{ formatSmartTimestamp(selectedTimeRangeDisplay.startTime, selectedTimeRangeDisplay.endTime).start }}</span>
              <span class="tw-opacity-70 tw-text-[0.65rem]">→</span>
              <span class="tw-whitespace-nowrap tw-text-[0.7rem]">{{ formatSmartTimestamp(selectedTimeRangeDisplay.startTime, selectedTimeRangeDisplay.endTime).end }}</span>
            </div>

            <!-- Additional filter info -->
            <span v-if="filterMetadata" class="tw-opacity-60 tw-text-[0.65rem] tw-ml-1">
              {{ filterMetadata }}
            </span>
          </div>
        </div>

        <div class="tw-flex tw-items-center tw-gap-3">
          <!-- Refresh button (shown when percentile changes on latency tab) -->
          <q-btn
            v-if="showRefreshButton"
            dense
            no-caps
            color="primary"
            icon="refresh"
            :label="t('panel.refresh')"
            @click="refreshAfterPercentileChange"
            data-test="percentile-refresh-button"
          >
            <q-tooltip>{{ t('latencyInsights.refreshTooltip') }}</q-tooltip>
          </q-btn>

          <!-- Dimension selector button -->
          <q-btn
            outline
            dense
            no-caps
            color="primary"
            icon="tune"
            :label="t('latencyInsights.dimensionsButton', { count: selectedDimensions.length })"
            :disable="isCustomSQLMode"
            @click="showDimensionSelector = true"
            data-test="dimension-selector-button"
          >
            <q-tooltip v-if="isCustomSQLMode">{{ t('latencyInsights.customSQLFieldsDisabled') }}</q-tooltip>
            <q-tooltip v-else>{{ t('latencyInsights.dimensionsTooltip') }}</q-tooltip>
          </q-btn>

          <q-btn
            flat
            round
            dense
            icon="close"
            @click="isOpen = false"
            data-test="analysis-dashboard-close"
          />
        </div>
      </q-card-section>

      <!-- Tabs (only shown if multiple analysis types available) -->
      <q-tabs
        v-if="showTabs"
        v-model="activeAnalysisType"
        dense
        inline-label
        class="tw-border-b tw-border-solid tw-border-[var(--o2-border-color)]"
        active-color="primary"
        indicator-color="primary"
        align="left"
      >
        <q-tab
          v-for="tab in availableTabs"
          :key="tab.name"
          :name="tab.name"
          :label="tab.label"
          :icon="tab.icon"
          class="tw-min-h-[3rem]"
        />
      </q-tabs>

      <!-- Dashboard Content -->
      <q-card-section class="analysis-content tw-flex-1 tw-overflow-auto tw-p-0">
        <!-- Loading State -->
        <div
          v-if="loading"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-h-full tw-py-20"
        >
          <q-spinner-hourglass color="primary" size="3.75rem" class="tw-mb-4" />
          <div class="tw-text-base">{{ t('latencyInsights.analyzingDimensions') }}</div>
          <div class="tw-text-xs tw-text-gray-500 tw-mt-2">
            {{ t('latencyInsights.computingDistributions', { count: selectedDimensions.length }) }}
          </div>
        </div>

        <!-- Error State -->
        <div
          v-else-if="error"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-h-full tw-py-20"
        >
          <q-icon name="error_outline" size="3.75rem" color="negative" class="tw-mb-4" />
          <div class="tw-text-base tw-mb-2">{{ t('latencyInsights.failedToLoad') }}</div>
          <div class="tw-text-sm tw-text-gray-500">{{ error }}</div>
          <q-btn
            outline
            color="primary"
            :label="t('latencyInsights.retryButton')"
            class="tw-mt-4"
            @click="loadAnalysis"
          />
        </div>

        <!-- Dashboard -->
        <RenderDashboardCharts
          v-else-if="dashboardData"
          :key="`${activeAnalysisType}-${dashboardRenderKey}`"
          ref="dashboardChartsRef"
          :dashboardData="dashboardData"
          :currentTimeObj="currentTimeObj"
          :viewOnly="true"
          :allowAlertCreation="false"
          searchType="dashboards"
          @variablesData="handleVariablesDataChange"
          @refreshedVariablesDataUpdated="handleVariablesDataChange"
        />
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Dimension Selector Dialog -->
  <q-dialog v-model="showDimensionSelector">
    <q-card class="dimension-selector-dialog">
      <q-card-section class="tw-p-4 tw-border-b">
        <div class="tw-flex tw-items-center tw-justify-between tw-mb-3">
          <div class="tw-text-base tw-font-semibold">{{ t('latencyInsights.selectDimensions') }}</div>
          <q-btn flat round dense icon="close" v-close-popup />
        </div>

        <!-- Search Input -->
        <q-input
          v-model="dimensionSearchText"
          dense
          outlined
          :placeholder="t('search.searchField')"
          clearable
          class="tw-w-full"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
      </q-card-section>

      <q-card-section class="tw-p-0 dimension-list-container">
        <q-list v-if="filteredDimensions.length > 0">
          <q-item
            v-for="dimension in filteredDimensions"
            :key="dimension.value"
            dense
            class="dimension-list-item"
          >
            <q-item-section side>
              <q-checkbox
                :model-value="selectedDimensions.includes(dimension.value)"
                @update:model-value="toggleDimension(dimension.value)"
                color="primary"
                size="xs"
                dense
              />
            </q-item-section>
            <q-item-section>
              <q-item-label class="dimension-label">{{ dimension.label }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>

        <!-- No results message -->
        <div v-else class="tw-p-4 tw-text-center tw-text-gray-500">
          {{ t('search.noResult') }}
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts" setup>
import {
  ref,
  computed,
  watch,
  defineAsyncComponent,
  nextTick,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import {
  useLatencyInsightsAnalysis,
  type LatencyInsightsConfig,
} from "@/composables/useLatencyInsightsAnalysis";
import { useLatencyInsightsDashboard } from "@/composables/useLatencyInsightsDashboard";
import { selectDimensionsFromData, selectTraceDimensions } from "@/composables/useDimensionSelector";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue")
);

interface DurationFilter {
  start: number;
  end: number;
}

interface RateFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
}

interface ErrorFilter {
  start: number;
  end: number;
  timeStart?: number;
  timeEnd?: number;
}

interface TimeRange {
  startTime: number;
  endTime: number;
}

interface Props {
  durationFilter?: DurationFilter;
  rateFilter?: RateFilter;
  errorFilter?: ErrorFilter;
  timeRange: TimeRange;
  streamName: string;
  streamType?: string; // logs or traces
  baseFilter?: string;
  analysisType?: "latency" | "volume" | "error"; // Initial/default analysis type
  availableAnalysisTypes?: Array<"latency" | "volume" | "error">; // Which tabs to show
  streamFields?: any[]; // Stream schema fields for smart dimension selection
  logSamples?: any[]; // Actual log data for sample-based analysis (logs only)
}

const props = withDefaults(defineProps<Props>(), {
  analysisType: "latency",
  availableAnalysisTypes: () => ["volume"], // Default to just volume
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { showErrorNotification } = useNotifications();
const store = useStore();
const { t } = useI18n();
const { loading, error, analyzeAllDimensions } = useLatencyInsightsAnalysis();
const { generateDashboard } = useLatencyInsightsDashboard();

const isOpen = ref(true);
const dashboardData = ref<any>(null);
const dashboardChartsRef = ref<any>(null);
const showDimensionSelector = ref(false);
const dashboardRenderKey = ref(0); // Only increment on full reload to avoid re-rendering on panel append
const dimensionSearchText = ref('');

// Percentile change tracking - default to P95
const initialPercentile = ref<string | null>("0.95");
const currentPercentile = ref<string | null>("0.95");
const showRefreshButton = computed(() => {
  return activeAnalysisType.value === 'latency' &&
         initialPercentile.value !== null &&
         currentPercentile.value !== null &&
         initialPercentile.value !== currentPercentile.value;
});

// Detect custom SQL mode
const isCustomSQLMode = computed(() => {
  return props.baseFilter?.trim().toUpperCase().startsWith('SELECT') || false;
});

// Active tab management
const activeAnalysisType = ref<"latency" | "volume" | "error">(props.analysisType);

// Tab configuration
const availableTabs = computed(() => {
  return props.availableAnalysisTypes.map(type => {
    switch (type) {
      case 'volume':
        return { name: 'volume', label: t('volumeInsights.tabLabel'), icon: 'trending_up' };
      case 'latency':
        return { name: 'latency', label: t('latencyInsights.tabLabel'), icon: 'schedule' };
      case 'error':
        return { name: 'error', label: t('errorInsights.tabLabel'), icon: 'error_outline' };
    }
  });
});

// Show tabs only if multiple analysis types available
const showTabs = computed(() => props.availableAnalysisTypes.length > 1);

/**
 * Smart dimension selection
 * - For logs: Uses sample-based analysis with schema metadata
 * - For traces: Uses OpenTelemetry semantic conventions
 */
const getInitialDimensions = () => {
  const streamType = props.streamType || "traces";
  const schemaFields = (props.streamFields || []).map((f: any) => ({
    name: f.name || f,
    type: f.type,
    isIndexed: f.isIndexed || false,
    isFTS: f.ftsKey || false,
    isInteresting: f.isInterestingField || false,
  }));

  // For LOGS: Use sample-based analysis if we have log data
  if (streamType === "logs" && props.logSamples && props.logSamples.length >= 10) {
    return selectDimensionsFromData(props.logSamples, schemaFields, 6);
  }

  // For TRACES: Use OTel conventions
  if (streamType === "traces") {
    return selectTraceDimensions(schemaFields, 6);
  }

  // Fallback for logs without samples
  return selectDimensionsFromData([], schemaFields, 6);
};

// Selected dimensions (user can modify)
const selectedDimensions = ref<string[]>(getInitialDimensions());

// Available dimensions for dropdown (all stream fields)
const availableDimensions = computed(() => {
  return (props.streamFields || [])
    .map((f: any) => ({
      label: f.name || f,
      value: f.name || f,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

// Filter dimensions based on search text
const filteredDimensions = computed(() => {
  if (!dimensionSearchText.value?.trim()) {
    return availableDimensions.value;
  }

  const searchLower = dimensionSearchText.value.toLowerCase();
  return availableDimensions.value.filter(dim =>
    dim.label.toLowerCase().includes(searchLower)
  );
});

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => {
  return {
    __global: {
      start_time: new Date(baselineTimeRange.value.startTime),
      end_time: new Date(baselineTimeRange.value.endTime),
    },
  };
});

// Toggle dimension selection
const toggleDimension = (dimensionValue: string) => {
  const index = selectedDimensions.value.indexOf(dimensionValue);
  if (index > -1) {
    // Remove dimension - create new array to trigger reactivity
    selectedDimensions.value = selectedDimensions.value.filter(d => d !== dimensionValue);
  } else {
    // Add dimension - create new array to trigger reactivity
    selectedDimensions.value = [...selectedDimensions.value, dimensionValue];
  }
};

const baselineTimeRange = computed(() => {
  // Baseline is always the original/global time range (before brush selection)
  return props.timeRange;
});

// Compute selected time range from filters
const selectedTimeRangeDisplay = computed(() => {
  // Check for time-based filter from any RED metrics panel
  if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
    return {
      startTime: props.rateFilter.timeStart,
      endTime: props.rateFilter.timeEnd
    };
  } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
    return {
      startTime: props.durationFilter.timeStart,
      endTime: props.durationFilter.timeEnd
    };
  } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
    return {
      startTime: props.errorFilter.timeStart,
      endTime: props.errorFilter.timeEnd
    };
  }
  return null;
});

// Check if a selected time range exists (brush selection)
const hasSelectedTimeRange = computed(() => {
  return selectedTimeRangeDisplay.value !== null;
});

// Additional filter metadata (duration, rate, or error count)
const filterMetadata = computed(() => {
  if (props.analysisType === 'latency' && props.durationFilter && !props.durationFilter.timeStart) {
    return `${t('latencyInsights.durationLabel')} ${formatTimeWithSuffix(props.durationFilter.start)} - ${formatTimeWithSuffix(props.durationFilter.end)}`;
  } else if (props.analysisType === 'volume' && props.rateFilter && !props.rateFilter.timeStart) {
    return `${t('volumeInsights.rateLabel')} ${props.rateFilter.start} - ${props.rateFilter.end} traces/interval`;
  } else if (props.analysisType === 'error' && props.errorFilter && !props.errorFilter.timeStart) {
    return `${t('errorInsights.errorsGreaterThan')} ${props.errorFilter.start}`;
  }
  return null;
});

const loadAnalysis = async () => {
  try {
    // Determine which filter to use based on active analysis type
    let filterConfig;
    if (activeAnalysisType.value === 'latency') {
      filterConfig = { durationFilter: props.durationFilter, rateFilter: undefined, errorFilter: undefined };
    } else if (activeAnalysisType.value === 'volume') {
      filterConfig = { durationFilter: undefined, rateFilter: props.rateFilter, errorFilter: undefined };
    } else if (activeAnalysisType.value === 'error') {
      filterConfig = { durationFilter: undefined, rateFilter: undefined, errorFilter: props.errorFilter };
    }

    // For volume/error analysis with filter, use the actual selected time range from the brush
    // Otherwise, use the global time range
    let selectedTimeRange = props.timeRange;

    // Check for ANY time-based filter (from any RED metrics panel)
    // Use whichever filter has a time range selection - applies to ALL tabs
    if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.rateFilter.timeStart,
        endTime: props.rateFilter.timeEnd
      };
    } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.durationFilter.timeStart,
        endTime: props.durationFilter.timeEnd
      };
    } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.errorFilter.timeStart,
        endTime: props.errorFilter.timeEnd
      };
    }

    const config: LatencyInsightsConfig = {
      streamName: props.streamName,
      streamType: props.streamType || "traces",
      orgIdentifier: currentOrgIdentifier.value,
      selectedTimeRange,
      baselineTimeRange: baselineTimeRange.value,
      ...filterConfig,
      baseFilter: props.baseFilter,
      dimensions: selectedDimensions.value,
      analysisType: activeAnalysisType.value,
      percentile: currentPercentile.value || undefined,
    };

    // OPTIMIZATION: Skip analyzeAllDimensions() to avoid 20 extra queries
    // Instead, create mock analyses with dimension names only
    // The dashboard UNION queries will fetch the actual data
    const mockAnalyses = selectedDimensions.value.map((dimensionName) => ({
      dimensionName,
      data: [], // Empty - dashboard will fetch via UNION query
      baselinePopulation: 0, // Will be calculated from query results
      selectedPopulation: 0, // Will be calculated from query results
      differenceScore: 0, // Will be calculated from query results
    }));

    // Generate dashboard JSON with UNION queries
    const dashboard = generateDashboard(mockAnalyses, config);

    dashboardData.value = dashboard;
    dashboardRenderKey.value++; // Increment to force re-render on full reload

    // Don't reset percentile values - keep them synchronized with the dashboard
    // The handleVariablesDataChange event will update them if needed
  } catch (err: any) {
    console.error("Error loading analysis:", err);
    showErrorNotification(err.message || t('latencyInsights.failedToLoad'));
  }
};

const handleVariablesDataChange = (variablesData: any) => {
  if (activeAnalysisType.value !== 'latency') {
    return;
  }

  // Extract percentile from the values array
  const percentileVar = variablesData?.values?.find((v: any) => v.name === 'percentile');
  const percentileValue = percentileVar?.value;


  if (percentileValue !== undefined) {
    // Set initial percentile on first load
    if (initialPercentile.value === null) {
      initialPercentile.value = percentileValue;
    }
    currentPercentile.value = percentileValue;
  }
};

const refreshAfterPercentileChange = () => {
  // Update initial percentile to current to hide refresh button
  initialPercentile.value = currentPercentile.value;
  // Reload the analysis with new percentile
  loadAnalysis();
};

const onClose = () => {
  emit("close");
};

// Helper functions for formatting
const formatTimestamp = (microseconds: number) => {
  const date = new Date(microseconds / 1000);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const formatFullTimestamp = (microseconds: number) => {
  const date = new Date(microseconds / 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const formatCompactTimestamp = (microseconds: number) => {
  const date = new Date(microseconds / 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  // Format as MM/DD HH:MM:SS (more compact)
  return `${month}/${day} ${hours}:${minutes}:${seconds}`;
};

// Smart timestamp formatter - shows date only once if same day
const formatSmartTimestamp = (startMicroseconds: number, endMicroseconds: number) => {
  const startDate = new Date(startMicroseconds / 1000);
  const endDate = new Date(endMicroseconds / 1000);

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  const formatDate = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}/${day}`;
  };

  const isSameDay = startDate.toDateString() === endDate.toDateString();

  if (isSameDay) {
    // Same day: show "MM/DD HH:MM:SS" for start, only "HH:MM:SS" for end
    return {
      start: `${formatDate(startDate)} ${formatTime(startDate)}`,
      end: formatTime(endDate)
    };
  } else {
    // Different days: show both full timestamps
    return {
      start: `${formatDate(startDate)} ${formatTime(startDate)}`,
      end: `${formatDate(endDate)} ${formatTime(endDate)}`
    };
  }
};

const formatTimeWithSuffix = (milliseconds: number) => {
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  return `${milliseconds.toFixed(2)}ms`;
};

// Load analysis when modal opens
watch(
  () => isOpen.value,
  (newVal) => {
    if (newVal) {
      loadAnalysis();
    }
  },
  { immediate: true }
);

// Add new dimension panels without re-rendering existing ones
const addDimensionPanels = async (addedDimensions: string[]) => {
  if (!dashboardData.value || !dashboardData.value.tabs?.[0]?.panels) {
    loadAnalysis();
    return;
  }

  try {
    // Get current config from existing dashboard setup
    const currentPanels = dashboardData.value.tabs[0].panels;
    const existingCount = currentPanels.length;


    // Build config (reuse logic from loadAnalysis)
    let filterConfig: any = {};
    if (activeAnalysisType.value === 'latency') {
      filterConfig = { durationFilter: props.durationFilter, rateFilter: undefined, errorFilter: undefined };
    } else if (activeAnalysisType.value === 'volume') {
      filterConfig = { durationFilter: undefined, rateFilter: props.rateFilter, errorFilter: undefined };
    } else if (activeAnalysisType.value === 'error') {
      filterConfig = { durationFilter: undefined, rateFilter: undefined, errorFilter: props.errorFilter };
    }

    let selectedTimeRange = props.timeRange;
    if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
      selectedTimeRange = { startTime: props.rateFilter.timeStart, endTime: props.rateFilter.timeEnd };
    } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
      selectedTimeRange = { startTime: props.durationFilter.timeStart, endTime: props.durationFilter.timeEnd };
    } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
      selectedTimeRange = { startTime: props.errorFilter.timeStart, endTime: props.errorFilter.timeEnd };
    }

    const config: LatencyInsightsConfig = {
      streamName: props.streamName,
      streamType: props.streamType || "traces",
      orgIdentifier: currentOrgIdentifier.value,
      selectedTimeRange,
      baselineTimeRange: baselineTimeRange.value,
      ...filterConfig,
      baseFilter: props.baseFilter,
      dimensions: addedDimensions,
      analysisType: activeAnalysisType.value,
    };

    // Generate mock analyses for new dimensions only
    const mockAnalyses = addedDimensions.map((dimensionName) => ({
      dimensionName,
      data: [],
      baselinePopulation: 0,
      selectedPopulation: 0,
      differenceScore: 0,
    }));

    // Generate new panels using the same logic as generateDashboard
    const newPanels = generateDashboard(mockAnalyses, config).tabs[0].panels;

    // Update layout positions for new panels to appear after existing ones
    const timestamp = Date.now();
    newPanels.forEach((panel, index) => {
      const absoluteIndex = existingCount + index;
      // Use a completely unique ID that includes timestamp to avoid any collision
      const uniqueId = `${panel.layout.i}_${timestamp}_${absoluteIndex}`;
      panel.layout = {
        x: (absoluteIndex % 3) * 64,
        y: Math.floor(absoluteIndex / 3) * 16,
        w: 64,
        h: 16,
        i: uniqueId,
      };
      // Also update the panel ID to match
      panel.id = `${panel.id}_${timestamp}`;
    });


    // Create a new dashboard object to ensure Vue detects the change
    // We need to increment the render key to force grid re-layout, but this will cause re-queries
    // Unfortunately, without modifying RenderDashboardCharts to cache panel data, we can't avoid this
    const updatedDashboard = {
      ...dashboardData.value,
      tabs: [
        {
          ...dashboardData.value.tabs[0],
          panels: [...currentPanels, ...newPanels],
        },
        ...dashboardData.value.tabs.slice(1),
      ],
    };

    dashboardData.value = updatedDashboard;

    // DON'T increment dashboardRenderKey - let Vue's reactivity handle it
    // Since each panel has a unique ID (item.id + timestamp), Vue will only render the new panel

    // Wait for DOM to update, then refresh GridStack to position new panels
    await nextTick();
    if (dashboardChartsRef.value?.refreshGridStack) {
      await dashboardChartsRef.value.refreshGridStack();
    }

  } catch (err: any) {
    console.error('Error adding dimension panels:', err);
    loadAnalysis();
  }
};

// Reload when selected dimensions change
watch(
  selectedDimensions,
  (newDimensions, oldDimensions) => {

    // Skip if this is the initial load (already handled by isOpen watcher)
    if (!oldDimensions || oldDimensions.length === 0) {
      return;
    }

    // Check if dimensions actually changed
    const changed = newDimensions.length !== oldDimensions.length ||
      newDimensions.some((d, i) => d !== oldDimensions[i]);

    if (!changed) {
      return;
    }

    const addedDimensions = newDimensions.filter(d => !oldDimensions.includes(d));
    const removedDimensions = oldDimensions.filter(d => !newDimensions.includes(d));


    if (isOpen.value && newDimensions.length > 0) {
      if (removedDimensions.length > 0) {
        // If dimensions were removed, we need to regenerate to remove panels
        dashboardData.value = null;
        nextTick(() => {
          loadAnalysis();
        });
      } else if (addedDimensions.length > 0) {
        // If only added, append new panels without regenerating existing ones
        addDimensionPanels(addedDimensions);
      }
    } 
  },
  { deep: true }
);

// Reload when active analysis type (tab) changes
watch(
  () => activeAnalysisType.value,
  (newTab, oldTab) => {

    if (isOpen.value && !loading.value) {
      loadAnalysis();
    } 
  }
);

// Watch for changes in props
watch(
  () => [props.durationFilter, props.rateFilter, props.timeRange, props.streamName, props.analysisType],
  () => {
    if (isOpen.value) {
      loadAnalysis();
    }
  },
  { deep: true }
);
</script>

<style lang="scss" scoped>
.analysis-dashboard-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 90vw;
  max-width: 87.5rem;
  background: #ffffff !important;

  .analysis-header {
    flex-shrink: 0;
    background: #ffffff !important;
    z-index: 1;
  }

  // Time range chips styling - matching chart colors
  .time-range-chip {
    font-size: 0.7rem;
    line-height: 1.2;
    transition: all 0.2s ease;

    &.baseline-chip {
      // Red background matching baseline in charts
      background: rgba(239, 68, 68, 0.12);
      color: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    &.selected-chip {
      // Orange background matching selected in charts
      background: rgba(251, 146, 60, 0.15);
      color: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(251, 146, 60, 0.4);
      font-weight: 500;
    }
  }

  .analysis-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: #f5f5f5 !important;
  }
}

// Dimension selector dialog
.dimension-selector-dialog {
  min-width: 25rem;
  max-width: 31.25rem;
}

.dimension-list-container {
  max-height: 25rem;
  overflow-y: auto;

  .dimension-list-item {
    padding: 0.5rem 1rem;
    border-bottom: 0.0625rem solid var(--q-border-color, #e0e0e0);

    &:hover {
      background-color: var(--q-hover-color, rgba(0, 0, 0, 0.04));
    }

    .dimension-label {
      font-size: 0.875rem;
      line-height: 1.25rem;
    }
  }
}

// Dark mode support for dimension selector
body.body--dark {
  .dimension-list-item {
    border-bottom-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }
}

// Dark mode support
body.body--dark {
  .analysis-dashboard-card {
    background: #1e1e1e !important;

    .analysis-header {
      background: #1e1e1e !important;
    }

    .analysis-content {
      background: #2a2a2a !important;
    }
  }

  .dimension-sidebar {
    background: #202223 !important;
  }

  .dimension-list-item {
    border-bottom-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }

  // Time range chips dark mode - matching chart colors
  .time-range-chip {
    &.baseline-chip {
      // Red background for baseline
      background: rgba(239, 68, 68, 0.2);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(239, 68, 68, 0.4);
    }

    &.selected-chip {
      // Orange background for selected
      background: rgba(251, 146, 60, 0.25);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(251, 146, 60, 0.5);
    }
  }
}
</style>
