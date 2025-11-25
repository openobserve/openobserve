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
              <template v-else-if="props.analysisType === 'error'">{{ t('errorInsights.title') }}</template>
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
                  {{ t('errorInsights.errorSpikePeriod') }} {{ formatTimestamp(errorFilter.timeStart) }} - {{ formatTimestamp(errorFilter.timeEnd) }}
                </template>
                <template v-else>
                  {{ t('errorInsights.errorsGreaterThan') }} {{ errorFilter.start }}
                </template>
              </span>
            </div>
          </div>
        </div>

        <div class="tw-flex tw-items-center tw-gap-3">
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
          :key="`${activeAnalysisType}-${dashboardData.title}`"
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
  // Baseline is always the original/global time range (before brush selection)
  const result = props.timeRange;

  console.log("[Analysis] Baseline time range:", {
    analysisType: props.analysisType,
    note: "Using global datetime control value for baseline",
    baselineRange: {
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
    console.log('='.repeat(80));
    console.log(`[Analysis] ========== LOADING ${activeAnalysisType.value.toUpperCase()} ANALYSIS ==========`);
    console.log('[Analysis] Active analysis type:', activeAnalysisType.value);
    console.log('[Analysis] Selected dimensions for analysis:', selectedDimensions.value);
    console.log('[Analysis] Available stream fields:', props.streamFields?.length || 0);
    console.log('[Analysis] Stream type:', props.streamType);
    console.log('[Analysis] Stream name:', props.streamName);

    // Determine which filter to use based on active analysis type
    let filterConfig;
    if (activeAnalysisType.value === 'latency') {
      console.log('[Analysis] Using LATENCY filter:', props.durationFilter);
      filterConfig = { durationFilter: props.durationFilter, rateFilter: undefined, errorFilter: undefined };
    } else if (activeAnalysisType.value === 'volume') {
      console.log('[Analysis] Using VOLUME/RATE filter:', props.rateFilter);
      filterConfig = { durationFilter: undefined, rateFilter: props.rateFilter, errorFilter: undefined };
    } else if (activeAnalysisType.value === 'error') {
      console.log('[Analysis] Using ERROR filter:', props.errorFilter);
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

    // Check for ANY time-based filter (from any RED metrics panel)
    // Use whichever filter has a time range selection - applies to ALL tabs
    if (props.rateFilter?.timeStart && props.rateFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.rateFilter.timeStart,
        endTime: props.rateFilter.timeEnd
      };
      console.log('[Analysis] ✅ Using RATE filter time range for selected (applies to all tabs):', {
        start: new Date(props.rateFilter.timeStart / 1000).toISOString(),
        end: new Date(props.rateFilter.timeEnd / 1000).toISOString(),
      });
    } else if (props.durationFilter?.timeStart && props.durationFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.durationFilter.timeStart,
        endTime: props.durationFilter.timeEnd
      };
      console.log('[Analysis] ✅ Using DURATION filter time range for selected (applies to all tabs):', {
        start: new Date(props.durationFilter.timeStart / 1000).toISOString(),
        end: new Date(props.durationFilter.timeEnd / 1000).toISOString(),
      });
    } else if (props.errorFilter?.timeStart && props.errorFilter?.timeEnd) {
      selectedTimeRange = {
        startTime: props.errorFilter.timeStart,
        endTime: props.errorFilter.timeEnd
      };
      console.log('[Analysis] ✅ Using ERROR filter time range for selected (applies to all tabs):', {
        start: new Date(props.errorFilter.timeStart / 1000).toISOString(),
        end: new Date(props.errorFilter.timeEnd / 1000).toISOString(),
      });
    } else {
      console.log('[Analysis] ⚠️ No time-based filter found on any panel, using global time range for selected (baseline and selected will be the same)');
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
      analysisType: activeAnalysisType.value,
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
    console.log('[Analysis] Mock analyses:', mockAnalyses.map(a => a.dimensionName));

    const dashboard = generateDashboard(mockAnalyses, config);

    console.log('[Analysis] Dashboard generated successfully!');
    console.log('[Analysis] Dashboard title:', dashboard.title);
    console.log('[Analysis] Panel count:', dashboard.tabs[0]?.panels?.length || 0);
    console.log('[Analysis] Panels:', dashboard.tabs[0]?.panels?.map(p => ({
      id: p.id,
      title: p.title,
      hasQuery: !!p.queries?.[0]?.query,
      queryLength: p.queries?.[0]?.query?.length || 0
    })) || []);

    // Log first query as sample
    if (dashboard.tabs[0]?.panels?.[0]?.queries?.[0]?.query) {
      console.log('[Analysis] Sample query (first panel):', dashboard.tabs[0].panels[0].queries[0].query.substring(0, 300) + '...');
    }

    dashboardData.value = dashboard;
    console.log('[Analysis] Dashboard data set to reactive ref, panels should now render');
    console.log('[Analysis] Current dashboardData panels count:', dashboardData.value?.tabs?.[0]?.panels?.length || 0);
    console.log('='.repeat(80));
  } catch (err: any) {
    console.error("[Analysis] ❌ ERROR loading analysis:", err);
    console.error("[Analysis] Error stack:", err.stack);
    showErrorNotification(err.message || t('latencyInsights.failedToLoad'));
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

// Reload when active analysis type (tab) changes
watch(
  () => activeAnalysisType.value,
  (newTab, oldTab) => {
    console.log(`[Analysis] 🔄 TAB CHANGED: ${oldTab} → ${newTab}`);
    console.log('[Analysis] Modal open:', isOpen.value);
    console.log('[Analysis] Currently loading:', loading.value);

    if (isOpen.value && !loading.value) {
      console.log(`[Analysis] ✅ Reloading analysis for ${newTab} tab`);
      loadAnalysis();
    } else if (loading.value) {
      console.log('[Analysis] ⏳ Skipping reload - already loading');
    } else if (!isOpen.value) {
      console.log('[Analysis] ⏸️ Skipping reload - modal not open');
    }
  }
);

// Watch for changes in baseline mode
watch(
  () => baselineMode.value,
  (newMode, oldMode) => {
    console.log(`[Analysis] 🔄 Baseline mode changed: ${oldMode} → ${newMode}`);
    if (isOpen.value && !loading.value) {
      console.log(`[Analysis] ✅ Reloading analysis with new baseline mode: ${newMode}`);
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
