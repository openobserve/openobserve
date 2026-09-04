<script setup lang="ts">
import type { TimelineProps, TimelineSlots } from "./OTimeline.types";

defineOptions({ inheritAttrs: false });
defineProps<TimelineProps>();
defineSlots<TimelineSlots>();
</script>

<template>
  <ol class="o-timeline relative m-0 list-none p-0" v-bind="$attrs">
    <slot />
  </ol>
</template>

<style scoped>
/* keep(complex-state): :last-child structural rule hiding the connector line that
   OTimelineItem renders inside the final item (child DOM → :deep). */
.o-timeline > li:last-child :deep(.timeline-connector) {
  display: none;
}
</style>
