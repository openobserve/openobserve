<script setup lang="ts">
import type { OCardSectionProps, OCardSectionSlots } from "./OCardSection.types";
import { computed } from "vue";

const props = withDefaults(defineProps<OCardSectionProps>(), {
  scrollable: false,
  dense: false,
});

defineSlots<OCardSectionSlots>();

const classes = computed(() => {
  const base: string[] = [];

  // Dense is the detail-page rhythm: the header hugs its title and the body
  // picks up directly underneath it, so a column of section panes reads as one
  // page rather than a stack of separately padded cards. The default rhythm is
  // unchanged so no existing card shifts.
  if (props.role === "header") {
    base.push(
      "flex flex-row items-center gap-2",
      "flex-none",
      props.dense ? "px-4 pt-2 pb-1" : "px-4 py-3",
    );
  } else if (props.role === "body") {
    base.push("flex-1 min-h-0", props.dense ? "px-4 pt-0 pb-3" : "p-4");
    if (props.scrollable) {
      base.push("overflow-y-auto");
    }
  } else if (props.role === "footer") {
    base.push("flex-none", props.dense ? "px-4 py-2" : "px-4 py-3");
  }

  return base;
});
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
