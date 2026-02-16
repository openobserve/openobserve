<!--
  SpanAnalyticsPanel - Charts and summary (right side of bottom panel)
-->
<template>
  <div class="span-analytics-panel">
    <!-- Average Duration Chart -->
    <div class="tw:mb-8">
      <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:mb-4">
        Average duration
      </div>
      <div class="tw:h-24 tw:flex tw:items-end tw:justify-between tw:space-x-1.5">
        <div
          v-for="(bar, index) in mockDurationBars"
          :key="index"
          class="tw:flex-1 tw:rounded-t-sm tw:transition-colors"
          :class="bar.isActive ? 'tw:bg-primary' : 'tw:bg-slate-200 hover:tw:bg-slate-300'"
          :style="{ height: `${bar.height}%` }"
        ></div>
      </div>
      <div class="tw:flex tw:justify-between tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:mt-2 tw:font-medium">
        <span>7:10 AM</span>
        <span>7:20 AM</span>
        <span>7:30 AM</span>
      </div>
    </div>

    <!-- Throughput Chart -->
    <div class="tw:mb-8">
      <div class="tw:text-[10px] tw:font-bold tw:text-[var(--o2-text-secondary)] tw:uppercase tw:mb-4">
        Throughput (RPM)
      </div>
      <div class="tw:flex tw:items-center tw:space-x-4">
        <div class="tw:text-2xl tw:font-bold tw:text-[var(--o2-text-primary)]">
          {{ formatThroughput(throughput) }}
        </div>
        <div class="tw:flex-1 tw:h-10">
          <svg
            class="tw:w-full tw:h-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 30"
          >
            <path
              d="M0,25 Q10,5 20,20 T40,15 T60,25 T80,10 T100,20"
              fill="none"
              stroke="#2563EB"
              stroke-linecap="round"
              stroke-width="2.5"
            />
          </svg>
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

// Mock data for charts
const mockDurationBars = [
  { height: 40, isActive: false },
  { height: 55, isActive: false },
  { height: 45, isActive: false },
  { height: 80, isActive: true },
  { height: 60, isActive: false },
  { height: 50, isActive: false },
  { height: 35, isActive: false },
];

const throughput = computed(() => {
  // Mock throughput - would be calculated from real data
  return 1400;
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

const formatThroughput = (value: number): string => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toString();
};
</script>

<style scoped lang="scss">
.span-analytics-panel {
  // Styles are inline with Tailwind
}
</style>
