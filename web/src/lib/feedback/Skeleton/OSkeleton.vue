<script setup lang="ts">
import type { SkeletonProps } from "./OSkeleton.types";
import { computed, useAttrs } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = withDefaults(defineProps<SkeletonProps>(), {
  type: "rect",
  animation: "wave",
});

const attrs = useAttrs();

/* The caller's `class`, flattened. Vue hands `class` through as a string, an
   array, or an object depending on how it was bound. */
const callerClass = computed(() => {
  const c = attrs.class as unknown;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((x) => typeof x === "string").join(" ");
  if (c && typeof c === "object")
    return Object.entries(c)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(" ");
  return "";
});

/* Tailwind resolves same-property conflicts by CSS source order, NOT by the
   order classes appear on the element. So a baked-in `w-full` beats a caller's
   `w-3/4` / `w-3.5` / `flex-1` every time, and the caller silently gets a
   full-width block. That made every sized OSkeleton render full-bleed and is why
   a rival SkeletonBox primitive (with real width/height props) grew alongside it.
   Rather than ship a class-merge dependency, stand the default down whenever the
   caller expresses the same axis themselves. */
const setsWidth = computed(() =>
  /(?:^|\s)-?(?:w-|size-|flex-1|flex-auto|grow|basis-)/.test(callerClass.value),
);
const setsHeight = computed(() => /(?:^|\s)-?(?:h-|size-)/.test(callerClass.value));

const shapeClasses = computed<string[]>(() => {
  switch (props.type ?? "rect") {
    case "circle":
      // aspect-square derives height from width; never impose either axis.
      return ["rounded-full", "aspect-square"];
    case "text":
      return [
        "rounded-default",
        ...(setsWidth.value ? [] : ["w-full"]),
        ...(setsHeight.value ? [] : ["h-4"]),
      ];
    default:
      return ["rounded-default", ...(setsWidth.value ? [] : ["w-full"])];
  }
});

const animationClasses: Record<NonNullable<SkeletonProps["animation"]>, string> = {
  pulse: "animate-pulse",
  wave: "skeleton-wave relative overflow-hidden",
  none: "",
};

const classes = computed(() => [
  "block bg-skeleton-base",
  ...shapeClasses.value,
  animationClasses[props.animation ?? "pulse"],
]);
</script>

<template>
  <span
    :class="classes"
    role="status"
    :aria-label="t('components.skeleton.loading')"
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
    transparent 0%,
    transparent 30%,
    var(--color-skeleton-shimmer) 50%,
    transparent 70%,
    transparent 100%
  );
  animation: skeleton-shimmer 1.8s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
</style>
