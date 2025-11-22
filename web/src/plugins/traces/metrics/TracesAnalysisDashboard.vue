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
              {{ props.analysisType === 'latency' ? t('latencyInsights.title') : t('volumeInsights.title') }}
            </div>
            <div class="tw-text-xs tw-text-gray-500">
              <span v-if="props.analysisType === 'latency' && durationFilter">
                {{ t('latencyInsights.durationLabel') }} {{ formatTimeWithSuffix(durationFilter.start) }} - {{ formatTimeWithSuffix(durationFilter.end) }}
              </span>
              <span v-else-if="props.analysisType === 'volume' && rateFilter">
                {{ t('volumeInsights.rateLabel') }} {{ rateFilter.start }} - {{ rateFilter.end }} traces/interval
              </span>
            </div>
          </div>
        </div>

        <div class="tw-flex tw-items-center tw-gap-3">
          <!-- Baseline selector -->
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
}

interface TimeRange {
  startTime: number;
  endTime: number;
}

interface Props {
  durationFilter?: DurationFilter;
  rateFilter?: RateFilter;
  timeRange: TimeRange;
  streamName: string;
  baseFilter?: string;
  analysisType?: "latency" | "volume"; // New prop to distinguish analysis type
  streamFields?: any[]; // Stream schema fields for smart dimension selection
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
const baselineMode = ref("full_range");
const baselineModeOptions = computed(() => [
  { label: t("latencyInsights.fullTimeRange"), value: "full_range" },
  { label: t("latencyInsights.beforePeriod"), value: "before" },
  { label: t("latencyInsights.afterPeriod"), value: "after" },
]);

/**
 * Smart dimension selection based on OpenTelemetry semantic conventions
 * Prioritizes low-cardinality, high-coverage attributes that exist in the schema
 */
const selectedDimensions = computed(() => {
  const availableFields = new Set(
    (props.streamFields || []).map((f: any) => f.name || f)
  );

  // Priority-ordered list of good dimensions for trace analysis
  // Excludes high-cardinality fields (user_id, trace_id, span_id, etc.)
  const prioritizedDimensions = [
    // Core OTel attributes (always useful, low cardinality)
    "service_name",        // Primary grouping dimension
    "span_kind",           // INTERNAL, CLIENT, SERVER, PRODUCER, CONSUMER
    "span_status",         // OK, ERROR, UNSET
    "operation_name",      // Operation/endpoint name
    "span_name",           // Alternative to operation_name

    // HTTP attributes (medium cardinality, HTTP-specific)
    "http_method",         // GET, POST, PUT, DELETE, etc.
    "http_status_code",    // 200, 404, 500, etc.
    "http_route",          // /api/users/{id}, etc.
    "http_target",         // Request target

    // Database attributes (DB-specific)
    "db_system",           // postgresql, mysql, mongodb, etc.
    "db_operation",        // SELECT, INSERT, UPDATE, etc.
    "db_name",             // Database name

    // Messaging attributes (messaging-specific)
    "messaging_system",    // kafka, rabbitmq, etc.
    "messaging_operation", // publish, receive, etc.

    // RPC attributes (RPC-specific)
    "rpc_system",          // grpc, thrift, etc.
    "rpc_service",         // Service name
    "rpc_method",          // Method name

    // Infrastructure
    "host_name",           // Host identifier
    "container_name",      // Container name
    "k8s_pod_name",        // Kubernetes pod
    "k8s_namespace_name",  // Kubernetes namespace
  ];

  // Filter to only dimensions that exist in the schema
  const existingDimensions = prioritizedDimensions.filter((dim) =>
    availableFields.has(dim)
  );

  // If schema info not available or no matches, use safe defaults
  if (existingDimensions.length === 0) {
    return [
      "service_name",
      "span_kind",
      "span_status",
      "operation_name",
    ];
  }

  // Return top 8 dimensions to keep dashboard manageable
  return existingDimensions.slice(0, 8);
});

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => ({
  __global: {
    start_time: new Date(baselineTimeRange.value.startTime),
    end_time: new Date(baselineTimeRange.value.endTime),
  },
}));

const baselineTimeRange = computed(() => {
  const selectedDuration = props.timeRange.endTime - props.timeRange.startTime;

  let result;
  switch (baselineMode.value) {
    case "before":
      result = {
        startTime: props.timeRange.startTime - selectedDuration,
        endTime: props.timeRange.startTime,
      };
      break;
    case "after":
      result = {
        startTime: props.timeRange.endTime,
        endTime: props.timeRange.endTime + selectedDuration,
      };
      break;
    case "full_range":
    default:
      result = {
        startTime: props.timeRange.startTime,
        endTime: props.timeRange.endTime,
      };
      break;
  }

  console.log("[Latency Insights] Baseline mode changed:", {
    mode: baselineMode.value,
    selectedDuration: selectedDuration,
    originalRange: {
      start: new Date(props.timeRange.startTime).toISOString(),
      end: new Date(props.timeRange.endTime).toISOString(),
    },
    baselineRange: {
      start: new Date(result.startTime).toISOString(),
      end: new Date(result.endTime).toISOString(),
    },
  });

  return result;
});

const loadAnalysis = async () => {
  try {
    console.log('[Analysis] Selected dimensions for analysis:', selectedDimensions.value);
    console.log('[Analysis] Available stream fields:', props.streamFields?.length || 0);

    // Determine which filter to use based on analysis type
    const filterConfig = props.analysisType === 'latency'
      ? { durationFilter: props.durationFilter, rateFilter: undefined }
      : { durationFilter: undefined, rateFilter: props.rateFilter };

    const config: LatencyInsightsConfig = {
      streamName: props.streamName,
      streamType: "traces",
      orgIdentifier: currentOrgIdentifier.value,
      selectedTimeRange: props.timeRange,
      baselineTimeRange: baselineTimeRange.value,
      ...filterConfig,
      baseFilter: props.baseFilter,
      dimensions: selectedDimensions.value,
      analysisType: props.analysisType,
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
  } catch (err: any) {
    console.error("[Analysis] Error loading analysis:", err);
    showErrorNotification(err.message || "Failed to load analysis");
  }
};

const onClose = () => {
  emit("close");
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
