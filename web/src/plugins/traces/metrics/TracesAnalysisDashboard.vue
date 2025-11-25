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
  <q-dialog
    v-model="isOpen"
    position="right"
    full-height
    :maximized="false"
    transition-show="slide-left"
    transition-hide="slide-right"
    @hide="onClose"
  >
    <q-card class="analysis-dashboard-card">
      <!-- Header -->
      <q-card-section class="analysis-header tw-flex tw-items-center tw-justify-between tw-py-3 tw-px-4 tw-border-b tw-border-solid tw-border-[var(--o2-border-color)]">
        <div class="tw-flex tw-items-center tw-gap-3">
          <q-icon name="dashboard" size="md" color="primary" />
          <div>
            <div class="tw-text-lg tw-font-semibold">
              <template v-if="props.analysisType === 'latency'">{{ t('latencyInsights.title') }}</template>
              <template v-else-if="props.analysisType === 'volume'">{{ t('volumeInsights.title') }}</template>
              <template v-else-if="props.analysisType === 'error'">Error Insights</template>
            </div>
            <div class="tw-text-xs tw-text-gray-500">
              <span v-if="props.analysisType === 'latency' && durationFilter">
                {{ t('latencyInsights.durationLabel') }} {{ formatTimeWithSuffix(durationFilter.start) }} - {{ formatTimeWithSuffix(durationFilter.end) }}
              </span>
              <span v-else-if="props.analysisType === 'volume' && rateFilter">
                <template v-if="rateFilter.timeStart && rateFilter.timeEnd">
                  {{ t('volumeInsights.timeRangeLabel') }} {{ formatTimestamp(rateFilter.timeStart) }} - {{ formatTimestamp(rateFilter.timeEnd) }}
                </template>
                <template v-else>
                  {{ t('volumeInsights.rateLabel') }} {{ rateFilter.start }} - {{ rateFilter.end }} traces/interval
                </template>
              </span>
              <span v-else-if="props.analysisType === 'error' && errorFilter">
                <template v-if="errorFilter.timeStart && errorFilter.timeEnd">
                  Error Spike Period: {{ formatTimestamp(errorFilter.timeStart) }} - {{ formatTimestamp(errorFilter.timeEnd) }}
                </template>
                <template v-else>
                  Errors >= {{ errorFilter.start }}
                </template>
              </span>
            </div>
          </div>
        </div>

        <div class="tw-flex tw-items-center tw-gap-3">
          <!-- Baseline selector (only for latency analysis) -->
          <template v-if="props.analysisType === 'latency'">
            <div class="tw-flex tw-items-center tw-gap-2">
              <q-icon name="compare_arrows" size="xs" color="primary" />
              <span class="tw-text-sm tw-font-semibold tw-text-gray-700">{{ t('latencyInsights.compareToLabel') }}</span>
            </div>
            <q-select
              v-model="baselineMode"
              :options="baselineModeOptions"
              dense
              outlined
              emit-value
              map-options
              class="tw-w-48"
              data-test="baseline-mode-selector"
            >
              <template v-slot:prepend>
                <q-icon name="schedule" size="xs" />
              </template>
            </q-select>
          </template>

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
          ref="dashboardChartsRef"
          :dashboardData="dashboardData"
          :currentTimeObj="currentTimeObj"
          :viewOnly="false"
          :allowAlertCreation="false"
          searchType="dashboards"
        />
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
  analysisType?: "latency" | "volume" | "error"; // New prop to distinguish analysis type
  streamFields?: any[]; // Stream schema fields for smart dimension selection
  logSamples?: any[]; // Actual log data for sample-based analysis (logs only)
}

const props = withDefaults(defineProps<Props>(), {
  analysisType: "latency",
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

// Baseline mode selection
// For volume analysis: baseline mode is ignored, always uses global datetime control
// For latency analysis: default to "full_range" to compare slow vs fast traces in same period
const baselineMode = ref("full_range");
const baselineModeOptions = computed(() => [
  { label: t("latencyInsights.fullTimeRange"), value: "full_range" },
  { label: t("latencyInsights.beforePeriod"), value: "before" },
  { label: t("latencyInsights.afterPeriod"), value: "after" },
]);

/**
 * Smart dimension selection
 * - For logs: Uses sample-based analysis with schema metadata
 * - For traces: Uses OpenTelemetry semantic conventions
 */
const selectedDimensions = computed(() => {
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
    console.log(`[Analysis] Using sample-based dimension selection for logs (${props.logSamples.length} samples)`);
    return selectDimensionsFromData(props.logSamples, schemaFields, 6);
  }

  // For TRACES: Use OTel conventions
  if (streamType === "traces") {
    console.log("[Analysis] Using OTel-based dimension selection for traces");
    return selectTraceDimensions(schemaFields, 6);
  }

  // Fallback for logs without samples
  console.log("[Analysis] Using schema-based dimension selection (fallback)");
  return selectDimensionsFromData([], schemaFields, 6);
});

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => ({
  __global: {
    // Create Date objects from microsecond timestamps
    // The dashboard loader will convert these to microseconds for the API
    start_time: new Date(baselineTimeRange.value.startTime / 1000),
    end_time: new Date(baselineTimeRange.value.endTime / 1000),
  },
}));

const baselineTimeRange = computed(() => {
  // For volume and error analysis: baseline is ALWAYS the global datetime control value
  // This represents the overall time range before the user made a brush selection
  if (props.analysisType === 'volume' || props.analysisType === 'error') {
    const result = props.timeRange;

    console.log("[Analysis] Baseline time range (volume/error analysis):", {
      analysisType: props.analysisType,
      note: "Using global datetime control value for baseline",
      globalTimeRange: {
        start: new Date(result.startTime / 1000).toISOString(),
        end: new Date(result.endTime / 1000).toISOString(),
        startMicros: result.startTime,
        endMicros: result.endTime,
      },
    });

    return result;
  }

  // For latency analysis: calculate baseline based on mode
  const selectedTimeRange = props.timeRange;
  const selectedDuration = selectedTimeRange.endTime - selectedTimeRange.startTime;

  let result;
  switch (baselineMode.value) {
    case "before":
      result = {
        startTime: selectedTimeRange.startTime - selectedDuration,
        endTime: selectedTimeRange.startTime,
      };
      break;
    case "after":
      result = {
        startTime: selectedTimeRange.endTime,
        endTime: selectedTimeRange.endTime + selectedDuration,
      };
      break;
    case "full_range":
    default:
      result = {
        startTime: selectedTimeRange.startTime,
        endTime: selectedTimeRange.endTime,
      };
      break;
  }

  console.log("[Analysis] Baseline time range (latency analysis):", {
    mode: baselineMode.value,
    analysisType: props.analysisType,
    selectedDuration: selectedDuration,
    selectedDurationSeconds: `${(selectedDuration / 1000000).toFixed(2)}s`,
    calculatedBaselineRange: {
      start: new Date(result.startTime / 1000).toISOString(),
      end: new Date(result.endTime / 1000).toISOString(),
      startMicros: result.startTime,
      endMicros: result.endTime,
    },
  });

  return result;
});

const loadAnalysis = async () => {
  try {
    console.log('[Analysis] Selected dimensions for analysis:', selectedDimensions.value);
    console.log('[Analysis] Available stream fields:', props.streamFields?.length || 0);

    // Determine which filter to use based on analysis type
    let filterConfig;
    if (props.analysisType === 'latency') {
      filterConfig = { durationFilter: props.durationFilter, rateFilter: undefined, errorFilter: undefined };
    } else if (props.analysisType === 'volume') {
      filterConfig = { durationFilter: undefined, rateFilter: props.rateFilter, errorFilter: undefined };
    } else if (props.analysisType === 'error') {
      filterConfig = { durationFilter: undefined, rateFilter: undefined, errorFilter: props.errorFilter };
    }

    // For volume/error analysis with filter, use the actual selected time range from the brush
    // Otherwise, use the global time range
    let selectedTimeRange = props.timeRange;

    console.log('[Analysis] Rate filter received:', props.rateFilter);
    console.log('[Analysis] Props timeRange:', {
      start: new Date(props.timeRange.startTime / 1000).toISOString(),
      end: new Date(props.timeRange.endTime / 1000).toISOString(),
    });

    if (props.analysisType === 'volume' && props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.rateFilter.timeStart,
        endTime: props.rateFilter.timeEnd
      };
      console.log('[Analysis] Using rate filter time range for selected:', {
        start: new Date(props.rateFilter.timeStart / 1000).toISOString(),
        end: new Date(props.rateFilter.timeEnd / 1000).toISOString(),
      });
    } else if (props.analysisType === 'error' && props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.errorFilter.timeStart,
        endTime: props.errorFilter.timeEnd
      };
    } else {
      console.log('[Analysis] Using global time range for selected (no filter or missing timeStart/timeEnd)');
      console.log('[Analysis] Selected time range equals props.timeRange:', {
        start: new Date(selectedTimeRange.startTime / 1000).toISOString(),
        end: new Date(selectedTimeRange.endTime / 1000).toISOString(),
      });
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
      analysisType: props.analysisType,
    };

    console.log('[Analysis] Dashboard config for query generation:', {
      analysisType: config.analysisType,
      streamName: config.streamName,
      selectedTimeRange: {
        start: new Date(config.selectedTimeRange.startTime / 1000).toISOString(),
        end: new Date(config.selectedTimeRange.endTime / 1000).toISOString(),
        startMicros: config.selectedTimeRange.startTime,
        endMicros: config.selectedTimeRange.endTime,
      },
      baselineTimeRange: {
        start: new Date(config.baselineTimeRange.startTime / 1000).toISOString(),
        end: new Date(config.baselineTimeRange.endTime / 1000).toISOString(),
        startMicros: config.baselineTimeRange.startTime,
        endMicros: config.baselineTimeRange.endTime,
      },
      rateFilter: config.rateFilter,
      durationFilter: config.durationFilter,
      errorFilter: config.errorFilter,
      baseFilter: config.baseFilter,
    });

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
    console.log('[Analysis] Generating dashboard with', mockAnalyses.length, 'dimensions');
    const dashboard = generateDashboard(mockAnalyses, config);
    console.log('[Analysis] Dashboard generated:', {
      title: dashboard.title,
      panelCount: dashboard.tabs[0]?.panels?.length || 0,
      panels: dashboard.tabs[0]?.panels?.map(p => ({ id: p.id, title: p.title })) || []
    });
    dashboardData.value = dashboard;
    console.log('[Analysis] Dashboard data set, should trigger panel rendering');
  } catch (err: any) {
    console.error("[Analysis] Error loading analysis:", err);
    showErrorNotification(err.message || "Failed to load analysis");
  }
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

const formatTimeWithSuffix = (milliseconds: number) => {
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  return `${milliseconds.toFixed(2)}ms`;
};

// Watch dashboard data changes
watch(
  () => dashboardData.value,
  (newVal) => {
    if (newVal) {
      console.log('[Analysis] Dashboard data changed, panels:', newVal.tabs[0]?.panels?.map(p => ({
        id: p.id,
        title: p.title,
        hasQuery: !!p.queries?.[0]?.query
      })));
    }
  },
  { deep: true }
);

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

// Reload when baseline mode changes
watch(
  () => baselineMode.value,
  () => {
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

  .analysis-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: #f5f5f5 !important;
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
}
</style>
