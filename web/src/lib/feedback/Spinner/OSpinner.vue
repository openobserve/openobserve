<script setup lang="ts">
import type { SpinnerProps } from "./OSpinner.types";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = withDefaults(defineProps<SpinnerProps>(), {
  variant: "ring",
  size: "md",
});

// px dimensions per size token
const sizeClasses: Record<NonNullable<SpinnerProps["size"]>, string> = {
  xs: "size-4", // 16px
  sm: "size-5", // 20px
  md: "size-8", // 32px
  lg: "size-12", // 48px
  xl: "size-16", // 64px
};

// Dot sizes are scaled-down from the ring size
const dotSizeClasses: Record<NonNullable<SpinnerProps["size"]>, string> = {
  xs: "size-1",
  sm: "size-1.5",
  md: "size-2",
  lg: "size-3",
  xl: "size-4",
};

const containerClasses = computed(() => [
  "inline-flex items-center justify-center shrink-0",
  sizeClasses[props.size ?? "md"],
]);
</script>

<template>
  <!-- Ring variant -->
  <span
    v-if="variant === 'ring'"
    :class="containerClasses"
    role="status"
    :aria-label="t('components.spinner.loading')"
    aria-live="polite"
  >
    <svg
      class="text-spinner size-full animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <!-- Track -->
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-20" />
      <!-- Spinning arc -->
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        class="text-spinner"
      />
    </svg>
  </span>

  <!-- Dots variant -->
  <span
    v-else
    :class="['inline-flex shrink-0 items-center justify-center gap-1', sizeClasses[size ?? 'md']]"
    role="status"
    :aria-label="t('components.spinner.loading')"
    aria-live="polite"
  >
    <span
      v-for="i in 3"
      :key="i"
      :class="['bg-spinner animate-bounce rounded-full', dotSizeClasses[size ?? 'md']]"
      :style="{ animationDelay: `${(i - 1) * 0.15}s` }"
      aria-hidden="true"
    />
  </span>
</template>
