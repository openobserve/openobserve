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
