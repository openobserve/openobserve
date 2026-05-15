<script setup lang="ts">
import type { ProgressBarProps, ProgressBarSlots } from "./OProgressBar.types";
import { computed } from "vue";

const props = withDefaults(defineProps<ProgressBarProps>(), {
  variant: "default",
  size: "sm",
});

defineSlots<ProgressBarSlots>();

// Clamp value to [0, 1]
const clampedValue = computed(() => Math.min(1, Math.max(0, props.value)));
const percentage = computed(() => `${clampedValue.value * 100}%`);

const sizeClasses: Record<NonNullable<ProgressBarProps["size"]>, string> = {
  xs: "tw:h-1",    // 4px
  sm: "tw:h-2",    // 8px
  md: "tw:h-3",    // 12px
  lg: "tw:h-5",    // 20px
};

const variantFillClasses: Record<NonNullable<ProgressBarProps["variant"]>, string> = {
  default: "tw:bg-progress-bar-default",
  warning: "tw:bg-progress-bar-warning",
  danger:  "tw:bg-progress-bar-danger",
};

const trackClasses = computed(() => [
  "tw:relative tw:w-full tw:rounded-full tw:overflow-hidden tw:bg-progress-bar-track",
  sizeClasses[props.size ?? "sm"],
]);

const fillClasses = computed(() => [
  "tw:h-full tw:rounded-full tw:transition-[width] tw:duration-300 tw:ease-out",
  "tw:flex tw:items-center tw:justify-center tw:overflow-hidden",
  variantFillClasses[props.variant ?? "default"],
]);
</script>

<template>
  <div
    :class="trackClasses"
    role="progressbar"
    :aria-valuenow="Math.round(clampedValue * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div
      :class="fillClasses"
      :style="{ width: percentage }"
    >
      <span
        v-if="$slots.default"
        class="tw:text-progress-bar-label tw:text-xs tw:font-semibold tw:leading-none tw:select-none"
      >
        <slot />
      </span>
    </div>
  </div>
</template>
