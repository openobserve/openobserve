<script setup lang="ts">
import type { OCardActionsProps, OCardActionsSlots } from "./OCardActions.types";
import { computed } from "vue";

const props = withDefaults(defineProps<OCardActionsProps>(), {
  align: "right",
});

defineSlots<OCardActionsSlots>();

const alignClass: Record<NonNullable<OCardActionsProps["align"]>, string> = {
  left: "tw:justify-start",
  center: "tw:justify-center",
  right: "tw:justify-end",
  between: "tw:justify-between",
};

const classes = computed(() => [
  "tw:flex tw:flex-row tw:flex-wrap tw:items-center tw:gap-2",
  "tw:flex-none tw:px-4 tw:py-3",
  alignClass[props.align ?? "right"],
]);
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
