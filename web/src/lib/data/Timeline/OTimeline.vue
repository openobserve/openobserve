<script setup lang="ts">
import type { TimelineProps, TimelineSlots } from "./OTimeline.types";

defineOptions({ inheritAttrs: false });
defineProps<TimelineProps>();
defineSlots<TimelineSlots>();
</script>

<template>
  <ol
    class="tw:relative tw:list-none tw:m-0 tw:p-0"
    v-bind="$attrs"
  >
    <slot />
  </ol>
</template>

<style scoped>
/*
 * Hide the connecting line for the last OTimelineItem.
 * :deep() pierces the component boundary so the selector reaches
 * the .timeline-connector div rendered inside OTimelineItem.
 */
:deep(li:last-child .timeline-connector) {
  display: none;
}
</style>
