<template>
  <div v-if="show" class="flex flex-col h-full bg-(--q-background) border-l border-(--q-border-color)">
    <div class="correlation-header flex items-center justify-between py-3 px-4 border-b border-(--q-border-color) bg-(--q-header-bg)">
      <div class="header-content flex items-center gap-2">
        <OIcon name="link" size="sm" />
        <span class="header-title font-semibold text-sm">Related Telemetry</span>
      </div>
      <OButton
        variant="ghost"
        size="icon"
        icon-left="close"
        @click="$emit('close')"
      />
    </div>

    <div class="correlation-body flex-1 overflow-y-auto p-4">
      <!-- Loading State -->
      <div v-if="loading" class="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
        <OSpinner size="sm" />
        <span class="text-[13px] text-(--q-text-secondary)">Finding related data...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
        <OIcon name="error-outline" size="md" />
        <span class="text-[13px] text-(--q-negative)">{{ error }}</span>
      </div>

      <!-- No Correlation Available -->
      <div v-else-if="!correlationResult" class="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
        <OIcon name="info-outline" size="md" />
        <span class="text-[13px] text-(--q-text-secondary)">No related telemetry found</span>
      </div>

      <!-- Correlation Results -->
      <div v-else class="correlation-results flex flex-col gap-4">
        <!-- Service Info -->
        <div class="service-info flex flex-col gap-3">
          <div class="service-name flex items-center gap-[6px] font-semibold text-sm">
            <OIcon name="cloud" size="xs" />
            {{ correlationResult.service.service_name }}
          </div>

          <!-- Matched Dimensions (used for correlation) -->
          <div
            v-if="correlationResult.correlationData?.matched_dimensions &&
                  Object.keys(correlationResult.correlationData.matched_dimensions).length > 0"
            class="dimension-section flex flex-col gap-[6px]"
          >
            <div class="dimension-section-header flex items-center gap-[6px] text-[11px] font-semibold uppercase text-[var(--q-text-secondary)] [letter-spacing:0.5px]">
              <OIcon name="link" size="xs" />
              <span class="dimension-section-title cursor-help">Matched Dimensions</span>
              <OTooltip content="These stable dimensions were used to find related telemetry" />
            </div>
            <div class="service-dimensions flex flex-wrap gap-[6px]">
              <ODimensionChip
                v-for="(value, key) in correlationResult.correlationData.matched_dimensions"
                :key="`matched-${key}`"
                :dim-key="String(key)"
                :value="value"
              />
            </div>
          </div>

          <!-- Additional Dimensions (available for filtering) -->
          <div
            v-if="correlationResult.correlationData?.additional_dimensions &&
                  Object.keys(correlationResult.correlationData.additional_dimensions).length > 0"
            class="dimension-section flex flex-col gap-[6px]"
          >
            <div class="dimension-section-header flex items-center gap-[6px] text-[11px] font-semibold uppercase text-[var(--q-text-secondary)] [letter-spacing:0.5px]">
              <OIcon name="tune" size="xs" />
              <span class="dimension-section-title cursor-help">Additional Filters Available</span>
              <OTooltip content="These additional dimensions can be used for more specific filtering" />
            </div>
            <div class="service-dimensions flex flex-wrap gap-[6px]">
              <ODimensionChip
                v-for="(value, key) in correlationResult.correlationData.additional_dimensions"
                :key="`additional-${key}`"
                :dim-key="String(key)"
                :value="value"
              />
            </div>
          </div>

          <!-- Fallback: show all dimensions if correlationData not available -->
          <div
            v-if="!correlationResult.correlationData"
            class="service-dimensions flex flex-wrap gap-[6px]"
          >
            <ODimensionChip
                v-for="(value, key) in correlationResult.service.dimensions"
                :key="key"
                :dim-key="String(key)"
                :value="value"
              />
          </div>
        </div>

        <OSeparator />

        <!-- Correlation Queries -->
        <div class="correlation-queries flex flex-col gap-4">
          <!-- Traces -->
          <div
            v-if="traceQueries.length > 0"
            class="query-section flex flex-col gap-2"
          >
            <div class="section-header flex items-center gap-[6px] font-semibold text-[13px]">
              <OIcon name="timeline" size="sm" />
              <span class="section-title">Traces ({{ traceQueries.length }})</span>
            </div>
            <div class="query-items flex flex-col gap-[6px] pl-6">
              <div
                v-for="(query, idx) in traceQueries"
                :key="`trace-${idx}`"
                class="query-item flex items-center justify-between py-2 px-3 bg-[var(--q-item-bg)] rounded border border-[var(--q-border-color)]"
              >
                <div class="query-stream text-xs [font-family:monospace] text-[var(--q-text-secondary)]">{{ query.stream }}</div>
                <OButton
                  variant="outline"
                  size="sm"
                  @click="navigateToQuery(query, 'traces')"
                >View</OButton>
              </div>
            </div>
          </div>

          <!-- Metrics -->
          <div
            v-if="metricQueries.length > 0"
            class="query-section flex flex-col gap-2"
          >
            <div class="section-header flex items-center gap-[6px] font-semibold text-[13px]">
              <OIcon name="show-chart" size="sm" />
              <span class="section-title">Metrics ({{ metricQueries.length }})</span>
            </div>
            <div class="query-items flex flex-col gap-[6px] pl-6">
              <div
                v-for="(query, idx) in metricQueries"
                :key="`metric-${idx}`"
                class="query-item flex items-center justify-between py-2 px-3 bg-[var(--q-item-bg)] rounded border border-[var(--q-border-color)]"
              >
                <div class="query-stream text-xs [font-family:monospace] text-[var(--q-text-secondary)]">{{ query.stream }}</div>
                <OButton
                  variant="outline"
                  size="sm"
                  @click="navigateToQuery(query, 'metrics')"
                >View</OButton>
              </div>
            </div>
          </div>

          <!-- Logs -->
          <div
            v-if="logQueries.length > 0"
            class="query-section flex flex-col gap-2"
          >
            <div class="section-header flex items-center gap-[6px] font-semibold text-[13px]">
              <OIcon name="article" size="sm" />
              <span class="section-title">Logs ({{ logQueries.length }})</span>
            </div>
            <div class="query-items flex flex-col gap-[6px] pl-6">
              <div
                v-for="(query, idx) in logQueries"
                :key="`log-${idx}`"
                class="query-item flex items-center justify-between py-2 px-3 bg-[var(--q-item-bg)] rounded border border-[var(--q-border-color)]"
              >
                <div class="query-stream text-xs [font-family:monospace] text-[var(--q-text-secondary)]">{{ query.stream }}</div>
                <OButton
                  variant="outline"
                  size="sm"
                  @click="navigateToQuery(query, 'logs')"
                >View</OButton>
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
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import type { TelemetryContext, CorrelationQuery } from "@/utils/telemetryCorrelation";
import type { CorrelationResult } from "@/utils/telemetryCorrelation";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

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

<style>
.query-section .query-item:hover {
  background: var(--q-item-hover-bg);
}
</style>
