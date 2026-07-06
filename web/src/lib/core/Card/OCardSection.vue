<script setup lang="ts">
import type { OCardSectionProps, OCardSectionSlots } from "./OCardSection.types";
import { computed } from "vue";

const props = withDefaults(defineProps<OCardSectionProps>(), {
  scrollable: false,
});

defineSlots<OCardSectionSlots>();

const classes = computed(() => {
  const base: string[] = [];

  if (props.role === "header") {
    base.push(
      "flex flex-row items-center gap-2",
      "flex-none",
      "px-4 py-3",
    );
  } else if (props.role === "body") {
    base.push("flex-1 min-h-0", "p-4");
    if (props.scrollable) {
      base.push("overflow-y-auto");
    }
  } else if (props.role === "footer") {
    base.push("flex-none", "px-4 py-3");
  }

  return base;
});
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
