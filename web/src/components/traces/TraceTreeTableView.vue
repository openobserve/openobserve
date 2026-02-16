<!--
  TraceTreeTableView - Timeline and Span Tree View
  Displays spans in a hierarchical tree with timeline bars
-->
<template>
  <div class="trace-tree-table-view">
    <!-- Timeline Header -->
    <div class="timeline-header tw:flex tw:border-b tw:border-[var(--o2-border)] tw:p-4">
      <div class="tw:flex-1 tw:flex tw:gap-4">
        <div class="tw:w-[50px]"></div>
        <div class="tw:w-[200px] tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">
          Service
        </div>
        <div class="tw:flex-1 tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">
          Operation
        </div>
        <div class="tw:w-[100px] tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)] tw:text-right">
          Duration
        </div>
      </div>
      <div class="tw:flex-1 tw:ml-4 tw:text-sm tw:font-semibold tw:text-[var(--o2-text-primary)]">
        Timeline
      </div>
    </div>

    <!-- Span Rows -->
    <div class="span-rows tw:overflow-auto tw:max-h-[calc(100vh-300px)]">
      <div
        v-for="span in flattenedSpans"
        :key="span.span_id"
        class="span-row tw:flex tw:items-center tw:p-2 tw:border-b tw:border-[var(--o2-border)] hover:tw:bg-[var(--o2-trace-hover)] tw:cursor-pointer"
        :class="{ 'tw:bg-[var(--o2-trace-selected)]': span.span_id === selectedSpanId }"
        @click="selectSpan(span.span_id)"
      >
        <!-- Left: Span Info -->
        <div class="tw:flex-1 tw:flex tw:gap-4 tw:items-center">
          <!-- Expand/Collapse Icon -->
          <div class="tw:w-[50px] tw:flex tw:items-center" :style="{ paddingLeft: `${span.depth * 20}px` }">
            <q-btn
              v-if="span.hasChildren"
              flat
              dense
              round
              size="xs"
              :icon="isExpanded(span.span_id) ? 'expand_more' : 'chevron_right'"
              @click.stop="toggleSpan(span.span_id)"
              class="tw:text-[var(--o2-text-secondary)]"
            />
          </div>

          <!-- Service -->
          <div class="tw:w-[200px] tw:flex tw:items-center tw:gap-2">
            <div
              class="tw:w-3 tw:h-3 tw:rounded-full"
              :style="{ backgroundColor: span.color }"
            ></div>
            <span class="tw:text-sm tw:truncate">{{ span.serviceName }}</span>
          </div>

          <!-- Operation -->
          <div class="tw:flex-1 tw:flex tw:items-center tw:gap-2">
            <q-icon :name="span.kindIcon" size="14px" class="tw:text-[var(--o2-text-secondary)]" />
            <span class="tw:text-sm tw:truncate">{{ span.operationName }}</span>
            <q-icon
              v-if="span.hasError"
              name="error"
              size="14px"
              color="negative"
              class="tw:ml-auto"
            />
          </div>

          <!-- Duration -->
          <div class="tw:w-[100px] tw:text-sm tw:text-right tw:font-mono">
            {{ formatDuration(span.durationMs) }}
          </div>
        </div>

        <!-- Right: Timeline Bar -->
        <div class="tw:flex-1 tw:ml-4 tw:relative tw:h-6">
          <div
            class="timeline-bar tw:absolute tw:h-4 tw:rounded tw:transition-all"
            :style="{
              left: `${span.startOffsetPercent}%`,
              width: `${span.durationPercent}%`,
              backgroundColor: span.color,
              opacity: span.hasError ? 0.8 : 0.6,
            }"
            :title="`${span.serviceName} - ${formatDuration(span.durationMs)}`"
          ></div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="flattenedSpans.length === 0"
      class="tw:flex tw:items-center tw:justify-center tw:h-64 tw:text-[var(--o2-text-secondary)]"
    >
      No spans to display
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { type EnrichedSpan } from '@/types/traces/span.types';
import { type TraceMetadata } from '@/types/traces/trace.types';
import { formatDuration } from '@/composables/traces/useTraceProcessing';

// Props
interface Props {
  spans: EnrichedSpan[];
  traceMetadata: TraceMetadata | null;
  selectedSpanId: string | null;
  expandedSpanIds: Set<string>;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  spanSelected: [spanId: string];
  spanToggled: [spanId: string];
}>();

// Computed
const flattenedSpans = computed(() => {
  const result: EnrichedSpan[] = [];

  const traverse = (span: EnrichedSpan) => {
    result.push(span);
    if (isExpanded(span.span_id) && span.children.length > 0) {
      span.children.forEach(traverse);
    }
  };

  props.spans.forEach(traverse);
  return result;
});

// Methods
const isExpanded = (spanId: string): boolean => {
  return props.expandedSpanIds.has(spanId);
};

const selectSpan = (spanId: string) => {
  emit('spanSelected', spanId);
};

const toggleSpan = (spanId: string) => {
  emit('spanToggled', spanId);
};
</script>

<style scoped lang="scss">
.trace-tree-table-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.span-row {
  transition: background-color 0.2s;

  &:hover {
    .timeline-bar {
      opacity: 0.9 !important;
    }
  }
}

.timeline-bar {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

  &:hover {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }
}
</style>
