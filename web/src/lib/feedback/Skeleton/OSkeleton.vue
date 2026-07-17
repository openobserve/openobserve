<script setup lang="ts">
import type { SkeletonProps } from "./OSkeleton.types";
import { computed } from "vue";

const props = withDefaults(defineProps<SkeletonProps>(), {
  type: "rect",
  animation: "wave",
});

const shapeClasses: Record<NonNullable<SkeletonProps["type"]>, string> = {
  rect: "rounded-md w-full",
  circle: "rounded-full aspect-square",
  text: "rounded-sm w-full h-4",
};

const animationClasses: Record<NonNullable<SkeletonProps["animation"]>, string> = {
  pulse: "animate-pulse",
  wave: "skeleton-wave relative overflow-hidden",
  none: "",
};

const classes = computed(() => [
  "block bg-skeleton-base",
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
/* keep(generated-content): translateX shimmer overlay (::after) + its keyframes.
   A GPU-composited beam physically slides across the flat base — no moving
   background-position — which reads as a natural gloss catch. */
.skeleton-wave::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent        0%,
    transparent       30%,
    var(--color-skeleton-shimmer) 50%,
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
