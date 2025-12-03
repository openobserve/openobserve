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
    :maximized="false"
    transition-show="slide-left"
    transition-hide="slide-right"
    @hide="onClose"
  >
    <q-card class="correlation-dashboard-card">
      <!-- Header -->
      <q-card-section class="correlation-header tw-flex tw-items-center tw-justify-between tw-py-3 tw-px-4 tw-border-b tw-border-solid tw-border-[var(--o2-border-color)]">
        <div class="tw-flex tw-items-center tw-gap-3">
          <q-icon name="link" size="md" color="primary" />
          <div class="tw-flex tw-flex-col tw-gap-0">
            <span class="tw-text-lg tw-font-semibold">
              {{ t('correlation.title', { service: serviceName }) }}
            </span>
            <span class="tw-text-xs tw-opacity-70">
              {{ formatTimeRange(timeRange) }}
            </span>
          </div>
        </div>

        <div class="tw-flex tw-items-center tw-gap-3">
          <!-- Metric stream selector button -->
          <q-btn
            outline
            dense
            no-caps
            color="primary"
            icon="show_chart"
            :label="t('correlation.metricsButton', { count: selectedMetricStreams.length })"
            @click="showMetricSelector = true"
            data-test="metric-selector-button"
          >
            <q-tooltip>{{ t('correlation.metricsTooltip') }}</q-tooltip>
          </q-btn>

          <q-btn
            flat
            round
            dense
            icon="close"
            @click="isOpen = false"
            data-test="correlation-dashboard-close"
          />
        </div>
      </q-card-section>

      <!-- Matched Dimensions Display -->
      <q-card-section class="tw-py-2 tw-px-4 tw-border-b tw-border-solid tw-border-[var(--o2-border-color)]">
        <div class="tw-flex tw-items-center tw-gap-2 tw-flex-wrap">
          <span class="tw-text-xs tw-font-semibold tw-uppercase tw-opacity-70">
            {{ t('correlation.matchedDimensions') }}:
          </span>
          <q-chip
            v-for="(value, key) in matchedDimensions"
            :key="key"
            size="sm"
            dense
            square
            color="positive"
            text-color="white"
          >
            <span class="tw-font-medium">{{ key }}:</span>
            <span class="tw-ml-1">{{ value }}</span>
          </q-chip>
        </div>
      </q-card-section>

      <!-- Dashboard Content -->
      <q-card-section class="correlation-content tw-flex-1 tw-overflow-auto tw-p-0">
        <!-- Loading State -->
        <div
          v-if="loading"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-h-full tw-py-20"
        >
          <q-spinner-hourglass color="primary" size="3.75rem" class="tw-mb-4" />
          <div class="tw-text-base">{{ t('correlation.loading') }}</div>
          <div class="tw-text-xs tw-text-gray-500 tw-mt-2">
            {{ t('correlation.loadingMetrics', { count: selectedMetricStreams.length }) }}
          </div>
        </div>

        <!-- Error State -->
        <div
          v-else-if="error"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-h-full tw-py-20"
        >
          <q-icon name="error_outline" size="3.75rem" color="negative" class="tw-mb-4" />
          <div class="tw-text-base tw-mb-2">{{ t('correlation.failedToLoad') }}</div>
          <div class="tw-text-sm tw-text-gray-500">{{ error }}</div>
          <q-btn
            outline
            color="primary"
            :label="t('correlation.retryButton')"
            class="tw-mt-4"
            @click="loadDashboard"
          />
        </div>

        <!-- Dashboard -->
        <RenderDashboardCharts
          v-else-if="dashboardData"
          :key="dashboardRenderKey"
          :dashboardData="dashboardData"
          :currentTimeObj="currentTimeObj"
          :viewOnly="true"
          :allowAlertCreation="false"
          searchType="dashboards"
        />

        <!-- No Metrics State -->
        <div
          v-else
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-h-full tw-py-20"
        >
          <q-icon name="info_outline" size="3.75rem" color="grey-6" class="tw-mb-4" />
          <div class="tw-text-base">{{ t('correlation.noMetrics') }}</div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Metric Stream Selector Dialog -->
  <q-dialog v-model="showMetricSelector">
    <q-card class="metric-selector-dialog">
      <q-card-section class="tw-p-4 tw-border-b">
        <div class="tw-flex tw-items-center tw-justify-between tw-mb-3">
          <div class="tw-text-base tw-font-semibold">{{ t('correlation.selectMetrics') }}</div>
          <q-btn flat round dense icon="close" v-close-popup />
        </div>

        <!-- Search Input -->
        <q-input
          v-model="metricSearchText"
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

      <q-card-section class="tw-p-0 metric-list-container">
        <q-list v-if="filteredMetricStreams.length > 0">
          <q-item
            v-for="stream in filteredMetricStreams"
            :key="stream.stream_name"
            dense
            class="metric-list-item"
          >
            <q-item-section side>
              <q-checkbox
                :model-value="selectedMetricStreams.some(s => s.stream_name === stream.stream_name)"
                @update:model-value="toggleMetricStream(stream)"
                color="primary"
                size="xs"
                dense
              />
            </q-item-section>
            <q-item-section>
              <q-item-label class="metric-label">{{ stream.stream_name }}</q-item-label>
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
  provide,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import { useMetricsCorrelationDashboard, type MetricsCorrelationConfig } from "@/composables/useMetricsCorrelationDashboard";
import type { StreamInfo } from "@/services/service_streams";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue")
);

interface TimeRange {
  startTime: number;
  endTime: number;
}

interface Props {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  metricStreams: StreamInfo[];
  timeRange: TimeRange;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { showErrorNotification } = useNotifications();
const store = useStore();
const { t } = useI18n();
const { generateDashboard } = useMetricsCorrelationDashboard();

// Provide selectedTabId for RenderDashboardCharts to use
// The generated dashboard has tabId: "metrics"
const selectedTabId = ref("metrics");
provide("selectedTabId", selectedTabId);

const isOpen = ref(true);
const loading = ref(false);
const error = ref<string | null>(null);
const dashboardData = ref<any>(null);
const dashboardRenderKey = ref(0);
const showMetricSelector = ref(false);
const metricSearchText = ref("");

// Selected metric streams (default to first 6)
const selectedMetricStreams = ref<StreamInfo[]>(
  props.metricStreams.slice(0, 6)
);

// Filter metric streams based on search text
const filteredMetricStreams = computed(() => {
  if (!metricSearchText.value?.trim()) {
    return props.metricStreams;
  }

  const searchLower = metricSearchText.value.toLowerCase();
  return props.metricStreams.filter(stream =>
    stream.stream_name.toLowerCase().includes(searchLower)
  );
});

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => {
  // props.timeRange is in microseconds (16 digits), just like TracesAnalysisDashboard
  // Date constructor expects milliseconds, so we create Date objects with microseconds
  // (which will be invalid dates, but that's ok - TracesAnalysisDashboard does the same)
  const timeObj = {
    __global: {
      start_time: new Date(props.timeRange.startTime),
      end_time: new Date(props.timeRange.endTime),
    },
  };

  console.log("[TelemetryCorrelationDashboard] currentTimeObj computed:", {
    "startTime (microseconds)": props.timeRange.startTime,
    "endTime (microseconds)": props.timeRange.endTime,
    "startTime digits": props.timeRange.startTime.toString().length,
    "endTime digits": props.timeRange.endTime.toString().length,
    startTimeDate: timeObj.__global.start_time,
    endTimeDate: timeObj.__global.end_time,
    "start_time.getTime()": timeObj.__global.start_time.getTime(),
    "end_time.getTime()": timeObj.__global.end_time.getTime(),
  });

  return timeObj;
});

// Toggle metric stream selection
const toggleMetricStream = (stream: StreamInfo) => {
  const index = selectedMetricStreams.value.findIndex(
    s => s.stream_name === stream.stream_name
  );

  if (index > -1) {
    // Remove stream
    selectedMetricStreams.value = selectedMetricStreams.value.filter(
      s => s.stream_name !== stream.stream_name
    );
  } else {
    // Add stream
    selectedMetricStreams.value = [...selectedMetricStreams.value, stream];
  }
};

const loadDashboard = async () => {
  try {
    loading.value = true;
    error.value = null;

    console.log("[TelemetryCorrelationDashboard] loadDashboard started");
    console.log("[TelemetryCorrelationDashboard] Props:", {
      serviceName: props.serviceName,
      matchedDimensions: props.matchedDimensions,
      metricStreams: props.metricStreams.length,
      metricStreamsDetail: props.metricStreams,
      timeRange: props.timeRange,
    });

    // Validate that we have metric streams
    if (selectedMetricStreams.value.length === 0) {
      error.value = "No metric streams selected";
      console.error("[TelemetryCorrelationDashboard] No metric streams to display");
      return;
    }

    const config: MetricsCorrelationConfig = {
      serviceName: props.serviceName,
      matchedDimensions: props.matchedDimensions,
      metricStreams: selectedMetricStreams.value,
      orgIdentifier: currentOrgIdentifier.value,
      timeRange: props.timeRange,
    };

    console.log("[TelemetryCorrelationDashboard] Config:", config);
    console.log("[TelemetryCorrelationDashboard] Selected metric streams:", selectedMetricStreams.value.length);
    console.log("[TelemetryCorrelationDashboard] Selected metric streams detail:", JSON.stringify(selectedMetricStreams.value, null, 2));

    // Generate dashboard JSON
    const dashboard = generateDashboard(selectedMetricStreams.value, config);

    console.log("[TelemetryCorrelationDashboard] Generated dashboard:", {
      title: dashboard.title,
      tabs: dashboard.tabs.length,
      panels: dashboard.tabs[0]?.panels?.length,
      firstPanel: dashboard.tabs[0]?.panels?.[0],
    });

    console.log("[TelemetryCorrelationDashboard] FULL DASHBOARD JSON:");
    console.log(JSON.stringify(dashboard, null, 2));

    dashboardData.value = dashboard;
    dashboardRenderKey.value++;

    console.log("[TelemetryCorrelationDashboard] Dashboard data set, renderKey:", dashboardRenderKey.value);
  } catch (err: any) {
    console.error("[TelemetryCorrelationDashboard] Error loading correlation dashboard:", err);
    error.value = err.message || t('correlation.failedToLoad');
    showErrorNotification(error.value);
  } finally {
    loading.value = false;
  }
};

const onClose = () => {
  emit("close");
};

// Helper function to format time range
const formatTimeRange = (range: TimeRange) => {
  // range.startTime and range.endTime are already in milliseconds
  const startDate = new Date(range.startTime);
  const endDate = new Date(range.endTime);

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  // Calculate duration in milliseconds, then convert to minutes
  const durationMs = range.endTime - range.startTime;
  const durationMinutes = Math.round(durationMs / 60000);

  return `${formatTime(startDate)} - ${formatTime(endDate)} (${durationMinutes} min)`;
};

// Load dashboard when modal opens
watch(
  () => isOpen.value,
  (newVal) => {
    if (newVal) {
      loadDashboard();
    }
  },
  { immediate: true }
);

// Reload when selected metric streams change
watch(
  selectedMetricStreams,
  (newStreams, oldStreams) => {
    // Skip if this is the initial load
    if (!oldStreams || oldStreams.length === 0) {
      return;
    }

    // Check if streams actually changed
    const changed = newStreams.length !== oldStreams.length ||
      newStreams.some((s, i) => s.stream_name !== oldStreams[i]?.stream_name);

    if (changed && isOpen.value && newStreams.length > 0) {
      loadDashboard();
    }
  },
  { deep: true }
);
</script>

<style lang="scss" scoped>
.correlation-dashboard-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 90vw;
  max-width: 87.5rem;
  background: #ffffff !important;

  .correlation-header {
    flex-shrink: 0;
    background: #ffffff !important;
    z-index: 1;
  }

  .correlation-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: #f5f5f5 !important;
  }
}

// Metric selector dialog
.metric-selector-dialog {
  min-width: 25rem;
  max-width: 31.25rem;
}

.metric-list-container {
  max-height: 25rem;
  overflow-y: auto;

  .metric-list-item {
    padding: 0.5rem 1rem;
    border-bottom: 0.0625rem solid var(--q-border-color, #e0e0e0);

    &:hover {
      background-color: var(--q-hover-color, rgba(0, 0, 0, 0.04));
    }

    .metric-label {
      font-size: 0.875rem;
      line-height: 1.25rem;
      font-family: monospace;
    }
  }
}

// Dark mode support
body.body--dark {
  .correlation-dashboard-card {
    background: #1e1e1e !important;

    .correlation-header {
      background: #1e1e1e !important;
    }

    .correlation-content {
      background: #2a2a2a !important;
    }
  }

  .metric-list-item {
    border-bottom-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }
}
</style>
