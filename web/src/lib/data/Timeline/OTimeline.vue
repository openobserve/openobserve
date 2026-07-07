<script setup lang="ts">
import type { TimelineProps, TimelineSlots } from "./OTimeline.types";

defineOptions({ inheritAttrs: false });
defineProps<TimelineProps>();
defineSlots<TimelineSlots>();
</script>

<template>
  <ol
    class="relative list-none m-0 p-0"
    v-bind="$attrs"
  >
    <slot />
  </ol>
</template>

<style>
/*
 * Hide the connecting line for the last OTimelineItem.
 * Targets the .timeline-connector div rendered inside OTimelineItem.
 */
li:last-child .timeline-connector {
  display: none;
}
</style>
