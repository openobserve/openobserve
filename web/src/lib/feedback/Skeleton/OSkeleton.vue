<script setup lang="ts">
import type { SkeletonProps } from "./OSkeleton.types";
import { computed } from "vue";

const props = withDefaults(defineProps<SkeletonProps>(), {
  type: "rect",
  animation: "wave",
});

const shapeClasses: Record<NonNullable<SkeletonProps["type"]>, string> = {
  rect: "tw:rounded-md tw:w-full",
  circle: "tw:rounded-full tw:aspect-square",
  text: "tw:rounded tw:w-full tw:h-4",
};

const animationClasses: Record<NonNullable<SkeletonProps["animation"]>, string> = {
  pulse: "tw:animate-pulse",
  wave: "tw:skeleton-wave",
  none: "",
};

const classes = computed(() => [
  "tw:block tw:bg-skeleton-base",
  shapeClasses[props.type ?? "rect"],
  animationClasses[props.animation ?? "pulse"],
]);
</script>

<template>
  <span
    :class="classes"
    role="status"
    aria-label="Loading"
    aria-live="polite"
    aria-busy="true"
  />
</template>

<style scoped>
/*
  translateX shimmer — fundamentally more natural than background-position.

  Why this feels better:
  • The base is a flat solid colour (tw:bg-skeleton-base). No moving gradient.
  • A ::after overlay physically slides across with translateX. This is
    GPU-composited (no layout cost) and maps 1:1 to visual motion.
  • ease-in-out on translateX mimics how light actually reflects off a surface —
    it eases in and out naturally. (ease-in-out was wrong for background-position
    but is correct here.)
  • The shimmer beam is a 105° tilted gradient — a slight diagonal makes it
    read as a gloss catch, not a mechanical wipe.
*/
.tw\:skeleton-wave {
  position: relative;
  overflow: hidden;
}

.tw\:skeleton-wave::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent        0%,
    transparent       30%,
    var(--color-skeleton-shimmer, rgba(255, 255, 255, 0.8)) 50%,
    transparent       70%,
    transparent      100%
  );
  animation: skeleton-shimmer 1.8s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
