<script setup lang="ts">
import type { ProgressBarProps, ProgressBarSlots } from "./OProgressBar.types";
import { computed, useAttrs } from "vue";

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
  success: "bg-progress-bar-success",
  warning: "bg-progress-bar-warning",
  danger: "bg-progress-bar-danger",
};

/**
 * `w-full` is a DEFAULT, not a fixed property of the track.
 *
 * It used to be baked into the class list unconditionally, which silently beat
 * every consumer that asked for a narrower bar: Vue merges the consumer's
 * `class` into this same attribute, both are plain utilities of equal
 * specificity, so CSS source order decided and `w-full` won. `class="w-12"` on
 * the DBM coverage line measured 1378px instead of 48px and swallowed the
 * sentence beside it; `class="w-18"` on DbmLoadCell had the same problem.
 *
 * Checking `$attrs.class` for a width utility lets a consumer opt out while
 * every existing call site — which passes no width — keeps stretching as
 * before. Matches `w-`, `size-` and the arbitrary-value forms (`w-[12rem]`).
 */
const attrs = useAttrs();
const hasWidthOverride = computed(() =>
  /(^|\s)(w-|size-|min-w-|max-w-)/.test(String(attrs.class ?? "")),
);

const trackClasses = computed(() => [
  "relative rounded-full overflow-hidden bg-progress-bar-track",
  hasWidthOverride.value ? "" : "w-full",
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
