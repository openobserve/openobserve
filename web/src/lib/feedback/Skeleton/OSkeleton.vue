<script setup lang="ts">
import type { SkeletonProps } from "./OSkeleton.types";
import { computed } from "vue";

const props = withDefaults(defineProps<SkeletonProps>(), {
  type: "rect",
  animation: "pulse",
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
  Wave animation is not built into Tailwind — define it here via CSS.
  Uses background-position trick: a highlight gradient shifts left→right.
*/
.tw\:skeleton-wave {
  background: linear-gradient(
    90deg,
    var(--color-skeleton-base) 25%,
    var(--color-skeleton-highlight) 50%,
    var(--color-skeleton-base) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-wave 1.4s ease-in-out infinite;
}

@keyframes skeleton-wave {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
