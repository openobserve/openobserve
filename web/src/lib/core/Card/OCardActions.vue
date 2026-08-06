<script setup lang="ts">
import type { OCardActionsProps, OCardActionsSlots } from "./OCardActions.types";
import { computed } from "vue";

const props = withDefaults(defineProps<OCardActionsProps>(), {
  align: "right",
});

defineSlots<OCardActionsSlots>();

const alignClass: Record<NonNullable<OCardActionsProps["align"]>, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
  between: "justify-between",
};

const classes = computed(() => [
  "flex flex-row flex-wrap items-center gap-2",
  "flex-none px-4 py-3",
  alignClass[props.align ?? "right"],
]);
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
