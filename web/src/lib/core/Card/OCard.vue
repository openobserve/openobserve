<script setup lang="ts">
import { computed } from "vue";

import type { OCardProps, OCardSlots } from "./OCard.types";

const props = withDefaults(defineProps<OCardProps>(), { variant: "panel" });
defineSlots<OCardSlots>();

const classes = computed(() => [
  "text-card-text flex flex-col",
  // A surface takes the 12px tier; the filled panel keeps the 4px it shipped
  // with, so no existing screen shifts under it.
  props.variant === "outlined"
    ? "card-container rounded-surface bg-surface-base border-border-default border"
    : "bg-card-bg rounded-default",
]);
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
