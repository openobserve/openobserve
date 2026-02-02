<template>
  <div v-if="show" class="correlation-panel">
    <div class="correlation-header">
      <div class="header-content">
        <q-icon name="link" size="sm" />
        <span class="header-title">Related Telemetry</span>
      </div>
      <q-btn
        icon="close"
        flat
        dense
        round
        size="sm"
        @click="$emit('close')"
      />
    </div>

    <div class="correlation-body">
      <!-- Loading State -->
      <div v-if="loading" class="correlation-loading">
        <q-spinner color="primary" size="md" />
        <span class="loading-text">Finding related data...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="correlation-error">
        <q-icon name="error_outline" color="negative" size="md" />
        <span class="error-text">{{ error }}</span>
      </div>

      <!-- No Correlation Available -->
      <div v-else-if="!correlationResult" class="correlation-empty">
        <q-icon name="info_outline" color="grey-6" size="md" />
        <span class="empty-text">No related telemetry found</span>
      </div>

      <!-- Correlation Results -->
      <div v-else class="correlation-results">
        <!-- Service Info -->
        <div class="service-info">
          <div class="service-name">
            <q-icon name="cloud" size="xs" />
            {{ correlationResult.service.service_name }}
          </div>

          <!-- Matched Dimensions (used for correlation) -->
          <div
            v-if="correlationResult.correlationData?.matched_dimensions &&
                  Object.keys(correlationResult.correlationData.matched_dimensions).length > 0"
            class="dimension-section"
          >
            <div class="dimension-section-header">
              <q-icon name="link" size="xs" color="positive" />
              <span class="dimension-section-title">Matched Dimensions</span>
              <q-tooltip>These stable dimensions were used to find related telemetry</q-tooltip>
            </div>
            <div class="service-dimensions">
              <q-chip
                v-for="(value, key) in correlationResult.correlationData.matched_dimensions"
                :key="`matched-${key}`"
                size="sm"
                dense
                square
                color="positive"
                text-color="white"
              >
                <span class="dimension-key">{{ key }}:</span>
                <span class="dimension-value">{{ value }}</span>
              </q-chip>
            </div>
          </div>

          <!-- Additional Dimensions (available for filtering) -->
          <div
            v-if="correlationResult.correlationData?.additional_dimensions &&
                  Object.keys(correlationResult.correlationData.additional_dimensions).length > 0"
            class="dimension-section"
          >
            <div class="dimension-section-header">
              <q-icon name="tune" size="xs" color="grey-7" />
              <span class="dimension-section-title">Additional Filters Available</span>
              <q-tooltip>These additional dimensions can be used for more specific filtering</q-tooltip>
            </div>
            <div class="service-dimensions">
              <q-chip
                v-for="(value, key) in correlationResult.correlationData.additional_dimensions"
                :key="`additional-${key}`"
                size="sm"
                dense
                square
                outline
                color="grey-7"
              >
                <span class="dimension-key">{{ key }}:</span>
                <span class="dimension-value">{{ value }}</span>
              </q-chip>
            </div>
          </div>

          <!-- Fallback: show all dimensions if correlationData not available -->
          <div
            v-if="!correlationResult.correlationData"
            class="service-dimensions"
          >
            <q-chip
              v-for="(value, key) in correlationResult.service.dimensions"
              :key="key"
              size="sm"
              dense
              square
            >
              <span class="dimension-key">{{ key }}:</span>
              <span class="dimension-value">{{ value }}</span>
            </q-chip>
          </div>
        </div>

        <q-separator />

        <!-- Correlation Queries -->
        <div class="correlation-queries">
          <!-- Traces -->
          <div
            v-if="traceQueries.length > 0"
            class="query-section"
          >
            <div class="section-header">
              <q-icon name="timeline" color="primary" />
              <span class="section-title">Traces ({{ traceQueries.length }})</span>
            </div>
            <div class="query-items">
              <div
                v-for="(query, idx) in traceQueries"
                :key="`trace-${idx}`"
                class="query-item"
              >
                <div class="query-stream">{{ query.stream }}</div>
                <q-btn
                  label="View"
                  size="sm"
                  color="primary"
                  outline
                  dense
                  @click="navigateToQuery(query, 'traces')"
                />
              </div>
            </div>
          </div>

          <!-- Metrics -->
          <div
            v-if="metricQueries.length > 0"
            class="query-section"
          >
            <div class="section-header">
              <q-icon name="show_chart" color="secondary" />
              <span class="section-title">Metrics ({{ metricQueries.length }})</span>
            </div>
            <div class="query-items">
              <div
                v-for="(query, idx) in metricQueries"
                :key="`metric-${idx}`"
                class="query-item"
              >
                <div class="query-stream">{{ query.stream }}</div>
                <q-btn
                  label="View"
                  size="sm"
                  color="secondary"
                  outline
                  dense
                  @click="navigateToQuery(query, 'metrics')"
                />
              </div>
            </div>
          </div>

          <!-- Logs -->
          <div
            v-if="logQueries.length > 0"
            class="query-section"
          >
            <div class="section-header">
              <q-icon name="article" color="accent" />
              <span class="section-title">Logs ({{ logQueries.length }})</span>
            </div>
            <div class="query-items">
              <div
                v-for="(query, idx) in logQueries"
                :key="`log-${idx}`"
                class="query-item"
              >
                <div class="query-stream">{{ query.stream }}</div>
                <q-btn
                  label="View"
                  size="sm"
                  color="accent"
                  outline
                  dense
                  @click="navigateToQuery(query, 'logs')"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import type { TelemetryContext, CorrelationQuery } from "@/utils/telemetryCorrelation";
import type { CorrelationResult } from "@/utils/telemetryCorrelation";

interface Props {
  show: boolean;
  context: TelemetryContext | null;
  sourceType: "logs" | "traces" | "metrics";
  timeWindowMinutes?: number;
  currentStream?: string;
}

const props = withDefaults(defineProps<Props>(), {
  timeWindowMinutes: 5,
  currentStream: undefined,
});

const emit = defineEmits<{
  close: [];
}>();

const router = useRouter();
const store = useStore();
const { findRelatedTelemetry, error: correlationError, isLoadingServices } = useServiceCorrelation();

const loading = ref(false);
const correlationResult = ref<CorrelationResult | null>(null);
const error = computed(() => correlationError.value);

// Computed query groups
const traceQueries = computed(() =>
  correlationResult.value?.queries.filter((q) => q.type === "traces") || []
);
const metricQueries = computed(() =>
  correlationResult.value?.queries.filter((q) => q.type === "metrics") || []
);
const logQueries = computed(() =>
  correlationResult.value?.queries.filter((q) => q.type === "logs") || []
);

// Watch for context changes and trigger correlation
watch(
  () => [props.show, props.context],
  async ([show, context]) => {
    if (!show || !context) {
      correlationResult.value = null;
      return;
    }

    loading.value = true;
    try {
      const result = await findRelatedTelemetry(
        context,
        props.sourceType,
        props.timeWindowMinutes,
        props.currentStream
      );
      correlationResult.value = result;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

/**
 * Navigate to the appropriate view with the correlation query
 */
function navigateToQuery(query: CorrelationQuery, type: "logs" | "traces" | "metrics") {
  const org = store.state.selectedOrganization.identifier;

  // Build route based on type
  let routeName = "";
  if (type === "logs") {
    routeName = "logs";
  } else if (type === "traces") {
    routeName = "traces";
  } else if (type === "metrics") {
    routeName = "metrics";
  }

  // Navigate with query parameters
  router.push({
    name: routeName,
    query: {
      org,
      stream: query.stream,
      sql_mode: "true",
      query: btoa(query.sql), // Base64 encode the SQL
      from: query.timeRange.start.toString(),
      to: query.timeRange.end.toString(),
    },
  });

  // Close the panel after navigation
  emit("close");
}
</script>

<style scoped lang="scss">
.correlation-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--q-background);
  border-left: 1px solid var(--q-border-color);
}

.correlation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--q-border-color);
  background: var(--q-header-bg);

  .header-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-title {
    font-weight: 600;
    font-size: 14px;
  }
}

.correlation-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.correlation-loading,
.correlation-error,
.correlation-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
}

.loading-text,
.error-text,
.empty-text {
  font-size: 13px;
  color: var(--q-text-secondary);
}

.error-text {
  color: var(--q-negative);
}

.correlation-results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.service-info {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .service-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 14px;
  }

  .dimension-section {
    display: flex;
    flex-direction: column;
    gap: 6px;

    .dimension-section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--q-text-secondary);
      letter-spacing: 0.5px;

      .dimension-section-title {
        cursor: help;
      }
    }
  }

  .service-dimensions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    .dimension-key {
      font-weight: 500;
      margin-right: 4px;
    }

    .dimension-value {
      opacity: 0.9;
    }
  }
}

.correlation-queries {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.query-section {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 13px;
  }

  .query-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 24px;
  }

  .query-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--q-item-bg);
    border-radius: 4px;
    border: 1px solid var(--q-border-color);

    &:hover {
      background: var(--q-item-hover-bg);
    }

    .query-stream {
      font-size: 12px;
      font-family: monospace;
      color: var(--q-text-secondary);
    }
  }
}
</style>
