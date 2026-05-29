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
      "tw:flex tw:flex-row tw:items-center tw:gap-2",
      "tw:flex-none",
      "tw:px-4 tw:py-3",
    );
  } else if (props.role === "body") {
    base.push("tw:flex-1 tw:min-h-0", "tw:p-4");
    if (props.scrollable) {
      base.push("tw:overflow-y-auto");
    }
  } else if (props.role === "footer") {
    base.push("tw:flex-none", "tw:px-4 tw:py-3");
  }

  return base;
});
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
