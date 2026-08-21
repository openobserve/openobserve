<script setup lang="ts">
import { computed } from "vue";
import type { StatusDotProps } from "./OStatusDot.types";

const props = withDefaults(defineProps<StatusDotProps>(), {
  size: "sm",
  dataTest: "status-dot",
});

const stateClasses: Record<StatusDotProps["state"], string> = {
  pending: "bg-status-neutral-text",
  active: "bg-status-info-text motion-safe:animate-pulse",
  success: "bg-status-success-text",
  warning: "bg-status-warning-text",
  error: "bg-status-error-text",
};

const sizeClasses: Record<NonNullable<StatusDotProps["size"]>, string> = {
  sm: "size-2",
  md: "size-2.5",
};

const classes = computed(() => [
  "inline-block shrink-0 rounded-full",
  stateClasses[props.state],
  sizeClasses[props.size],
]);
</script>

<template>
  <span role="img" :aria-label="label" :class="classes" :data-test="dataTest" />
</template>
