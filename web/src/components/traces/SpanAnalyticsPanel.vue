<!--
  SpanAnalyticsPanel - Charts and summary (right side of bottom panel)
-->
<template>
  <div class="span-analytics-panel">
    <!-- Duration by Service Chart -->
    <div class="tw:mb-8">
      <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:mb-4">
        Duration by Service
      </div>
      <div class="tw:space-y-2">
        <div
          v-for="service in topServicesByDuration"
          :key="service.service_name"
          class="tw:flex tw:items-center tw:space-x-2"
        >
          <div class="tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:w-24 tw:truncate">
            {{ service.service_name }}
          </div>
          <div class="tw:flex-1 tw:h-5 tw:bg-slate-100 tw:rounded-sm tw:overflow-hidden">
            <div
              class="tw:h-full tw:rounded-sm tw:transition-all"
              :style="{
                width: `${service.percentage}%`,
                backgroundColor: service.color,
              }"
            ></div>
          </div>
          <div class="tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:w-12 tw:text-right tw:font-mono">
            {{ service.percentage.toFixed(0) }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Spans by Service Chart -->
    <div class="tw:mb-8">
      <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:mb-4">
        Spans by Service
      </div>
      <div class="tw:space-y-2">
        <div
          v-for="service in topServicesBySpanCount"
          :key="service.service_name"
          class="tw:flex tw:items-center tw:space-x-2"
        >
          <div class="tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:w-24 tw:truncate">
            {{ service.service_name }}
          </div>
          <div class="tw:flex-1 tw:h-4 tw:bg-slate-100 tw:rounded-sm tw:overflow-hidden">
            <div
              class="tw:h-full tw:rounded-sm tw:transition-all"
              :style="{
                width: `${service.spanPercentage}%`,
                backgroundColor: service.color,
              }"
            ></div>
          </div>
          <div class="tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:w-16 tw:text-right tw:font-mono">
            {{ service.span_count }} spans
          </div>
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div>
      <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:mb-3">
        Summary
      </div>
      <div class="tw:bg-white tw:p-4 tw:rounded-lg tw:border tw:border-[var(--o2-border)] tw:shadow-sm">
        <div class="tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:flex tw:justify-between tw:mb-1">
          <span>Total spans:</span>
          <span class="tw:font-bold tw:text-[var(--o2-text-primary)]">
            {{ traceMetadata?.total_spans || 0 }}
          </span>
        </div>
        <div class="tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:flex tw:justify-between tw:mb-3">
          <span>Unique services:</span>
          <span class="tw:font-bold tw:text-[var(--o2-text-primary)]">
            {{ traceMetadata?.service_count || 0 }}
          </span>
        </div>
        <div class="tw:mt-2 tw:pt-2 tw:border-t tw:border-slate-100 tw:flex tw:items-center tw:text-[10px] tw:text-primary tw:font-bold">
          <q-icon name="info" size="xs" class="tw:mr-1.5" />
          {{ bottleneckMessage }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { type TraceMetadata, type ServiceBreakdown } from '@/types/traces/trace.types';

interface Props {
  traceMetadata: TraceMetadata | null;
  serviceBreakdown: ServiceBreakdown[];
}

const props = defineProps<Props>();

defineEmits<{
  'span-clicked': [spanId: string];
}>();

// Computed properties
const topServicesByDuration = computed(() => {
  if (!props.serviceBreakdown || props.serviceBreakdown.length === 0) return [];

  // Sort by duration and take top 5
  return [...props.serviceBreakdown]
    .sort((a, b) => b.total_duration_ms - a.total_duration_ms)
    .slice(0, 5);
});

const topServicesBySpanCount = computed(() => {
  if (!props.serviceBreakdown || props.serviceBreakdown.length === 0) return [];

  const totalSpans = props.traceMetadata?.total_spans || 1;

  // Sort by span count and take top 5
  return [...props.serviceBreakdown]
    .sort((a, b) => b.span_count - a.span_count)
    .slice(0, 5)
    .map(service => ({
      ...service,
      spanPercentage: (service.span_count / totalSpans) * 100,
    }));
});

const bottleneckMessage = computed(() => {
  if (!props.traceMetadata) return 'Loading...';

  if (props.traceMetadata.has_errors) {
    return `${props.traceMetadata.error_spans} error(s) detected`;
  }

  if (props.traceMetadata.critical_path_percent > 80) {
    return 'Critical path bottleneck detected';
  }

  return 'No critical bottlenecks detected';
});
</script>

<style scoped lang="scss">
.span-analytics-panel {
  // Styles are inline with Tailwind
}
</style>
