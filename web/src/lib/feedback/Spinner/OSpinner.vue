<script setup lang="ts">
import type { SpinnerProps, SpinnerSize } from "./OSpinner.types";
import { useI18nTyped } from "@/types/i18n";
import { LOADER_REVEAL } from "@/lib/styles/motion";

const { t } = useI18nTyped();

withDefaults(defineProps<SpinnerProps>(), {
  size: "md",
  instant: false,
});

// o2-motion-keep: a spinner frozen by reduced motion reads as a hung page.
// The reveal and the spin are both animations, so they sit on two elements.
const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "size-3",
  md: "size-4",
  lg: "size-5",
};
</script>

<template>
  <span
    :class="['inline-flex shrink-0', SIZE_CLASSES[size], instant ? '' : LOADER_REVEAL]"
    role="status"
    :aria-label="t('components.spinner.loading')"
    aria-live="polite"
  >
    <span
      class="border-border-default border-t-spinner o2-motion-keep inline-block size-full animate-spin rounded-full border-2"
      aria-hidden="true"
      data-test="o-spinner-ring"
    />
  </span>
</template>
