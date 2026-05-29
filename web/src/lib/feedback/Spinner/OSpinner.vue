<script setup lang="ts">
import type { SpinnerProps } from "./OSpinner.types";
import { computed } from "vue";

const props = withDefaults(defineProps<SpinnerProps>(), {
  variant: "ring",
  size: "md",
});

// px dimensions per size token
const sizeClasses: Record<NonNullable<SpinnerProps["size"]>, string> = {
  xs: "tw:size-4",   // 16px
  sm: "tw:size-5",   // 20px
  md: "tw:size-8",   // 32px
  lg: "tw:size-12",  // 48px
  xl: "tw:size-16",  // 64px
};

// Dot sizes are scaled-down from the ring size
const dotSizeClasses: Record<NonNullable<SpinnerProps["size"]>, string> = {
  xs: "tw:size-1",
  sm: "tw:size-1.5",
  md: "tw:size-2",
  lg: "tw:size-3",
  xl: "tw:size-4",
};

const containerClasses = computed(() => [
  "tw:inline-flex tw:items-center tw:justify-center tw:shrink-0",
  sizeClasses[props.size ?? "md"],
]);
</script>

<template>
  <!-- Ring variant -->
  <span
    v-if="variant === 'ring'"
    :class="containerClasses"
    role="status"
    aria-label="Loading"
    aria-live="polite"
  >
    <svg
      class="tw:animate-spin tw:size-full tw:text-spinner"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <!-- Track -->
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="3"
        class="tw:opacity-20"
      />
      <!-- Spinning arc -->
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        class="tw:text-spinner"
      />
    </svg>
  </span>

  <!-- Dots variant -->
  <span
    v-else
    :class="[
      'tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:shrink-0',
      sizeClasses[size ?? 'md'],
    ]"
    role="status"
    aria-label="Loading"
    aria-live="polite"
  >
    <span
      v-for="i in 3"
      :key="i"
      :class="[
        'tw:rounded-full tw:bg-spinner tw:animate-bounce',
        dotSizeClasses[size ?? 'md'],
      ]"
      :style="{ animationDelay: `${(i - 1) * 0.15}s` }"
      aria-hidden="true"
    />
  </span>
</template>
