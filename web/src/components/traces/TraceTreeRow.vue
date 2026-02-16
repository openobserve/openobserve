<!--
  TraceTreeRow - Individual span row with tree structure and timeline
-->
<template>
  <div
    class="tw:grid tw:grid-cols-12 tw:gap-0 hover:tw:bg-[var(--o2-surface)] tw:py-2 tw:px-6 tw:border-b tw:border-[var(--o2-border)]/50 tw:group tw:cursor-pointer"
    :class="{
      'tw:bg-blue-50/30': isSelected,
    }"
    @click="$emit('span-clicked', span.span_id)"
  >
    <!-- Span / Operation Column -->
    <div class="tw:col-span-4 tw:flex tw:items-center tw:space-x-2 tw:relative" :style="{ paddingLeft: `${span.depth * 24 + 8}px` }">
      <!-- Tree Lines -->
      <template v-if="span.depth > 0">
        <div
          v-for="d in span.depth"
          :key="`line-${d}`"
          class="waterfall-tree-line"
          :style="{ left: `${(d - 1) * 24 - 18}px` }"
        ></div>
        <div
          class="waterfall-tree-branch"
          :style="{ left: `${(span.depth - 1) * 24 - 18}px` }"
        ></div>
      </template>

      <!-- Expand/Collapse Icon -->
      <q-icon
        v-if="span.hasChildren"
        :name="isExpanded ? 'expand_more' : 'chevron_right'"
        size="16px"
        class="tw:text-[var(--o2-text-secondary)] tw:cursor-pointer"
        @click.stop="$emit('toggle-expand', span.span_id)"
      />
      <div v-else class="tw:w-4"></div>

      <!-- Operation Name -->
      <span class="tw:text-xs tw:font-semibold tw:text-[var(--o2-text-primary)] tw:truncate">
        {{ span.operationName }}
      </span>
    </div>

    <!-- Service Column -->
    <div class="tw:col-span-2 tw:flex tw:items-center">
      <div
        class="tw:w-2 tw:h-2 tw:rounded-full tw:mr-2"
        :style="{ backgroundColor: span.color }"
      ></div>
      <span
        class="tw:text-[11px] tw:truncate"
        :class="isSelected ? 'tw:font-bold tw:text-[var(--o2-text-primary)]' : 'tw:text-[var(--o2-text-secondary)]'"
      >
        {{ span.serviceName }}
      </span>
    </div>

    <!-- Duration Column -->
    <div class="tw:col-span-1 tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:flex tw:items-center">
      {{ formatDuration(span.durationMs) }}
    </div>

    <!-- Timeline Column -->
    <div class="tw:col-span-5 tw:flex tw:items-center tw:relative">
      <div class="tw:h-2 tw:rounded-full tw:bg-slate-100 tw:overflow-hidden tw:absolute tw:inset-0">
        <div
          class="tw:h-full tw:rounded-full timeline-bar-shadow"
          :style="{
            backgroundColor: span.color,
            width: `${span.durationPercent}%`,
            marginLeft: `${span.startOffsetPercent}%`,
            opacity: span.hasError ? 0.8 : 1,
          }"
        ></div>
      </div>

      <!-- Error indicator -->
      <q-icon
        v-if="span.hasError"
        name="error"
        size="14px"
        color="negative"
        class="tw:absolute tw:right-0"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type EnrichedSpan } from '@/types/traces/span.types';
import { formatDuration } from '@/composables/traces/useTraceProcessing';

interface Props {
  span: EnrichedSpan;
  isSelected: boolean;
  isExpanded: boolean;
}

defineProps<Props>();

defineEmits<{
  'span-clicked': [spanId: string];
  'toggle-expand': [spanId: string];
}>();
</script>

<style scoped lang="scss">
.waterfall-tree-line {
  position: absolute;
  left: -18px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--o2-border, #E2E8F0);
}

.waterfall-tree-branch {
  position: absolute;
  left: -18px;
  top: 12px;
  width: 14px;
  height: 1px;
  background: var(--o2-border, #E2E8F0);
}

.timeline-bar-shadow {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: opacity 0.2s;
}

.group:hover .timeline-bar-shadow {
  opacity: 0.9 !important;
}
</style>
