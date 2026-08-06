<script setup lang="ts">
import type { ProgressBarProps, ProgressBarSlots } from "./OProgressBar.types";
import { computed } from "vue";

const props = withDefaults(defineProps<ProgressBarProps>(), {
  start: 0,
  variant: "default",
  size: "sm",
});

defineSlots<ProgressBarSlots>();

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Clamp value to [0, 1]
const clampedValue = computed(() => clamp01(props.value));
const clampedStart = computed(() => clamp01(props.start));

/**
 * Width of the fill, never negative.
 *
 * `start` past `value` is a caller bug rather than a state to render, and a
 * negative width would silently paint the whole track in some browsers.
 */
const span = computed(() => Math.max(0, clampedValue.value - clampedStart.value));

const percentage = computed(() => `${span.value * 100}%`);
const offset = computed(() => `${clampedStart.value * 100}%`);

const sizeClasses: Record<NonNullable<ProgressBarProps["size"]>, string> = {
  xs: "h-1", // 4px
  sm: "h-2", // 8px
  md: "h-3", // 12px
  lg: "h-5", // 20px
};

const variantFillClasses: Record<NonNullable<ProgressBarProps["variant"]>, string> = {
  default: "bg-progress-bar-default",
  warning: "bg-progress-bar-warning",
  danger: "bg-progress-bar-danger",
};

const trackClasses = computed(() => [
  "relative w-full rounded-full overflow-hidden bg-progress-bar-track",
  sizeClasses[props.size ?? "sm"],
]);

const fillClasses = computed(() => [
  "h-full rounded-full transition-[width] duration-300 ease-out",
  "flex items-center justify-center overflow-hidden",
  variantFillClasses[props.variant ?? "default"],
]);
</script>

<template>
  <div
    :class="trackClasses"
    role="progressbar"
    :aria-valuenow="Math.round(span * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div :class="fillClasses" :style="{ marginInlineStart: offset, width: percentage }">
      <span
        v-if="$slots.default"
        class="text-progress-bar-label text-xs leading-none font-semibold select-none"
      >
        <slot />
      </span>
    </div>
  </div>
</template>
