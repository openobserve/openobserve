<script setup lang="ts">
import type { LoadingLineProps } from "./OLoadingLine.types";
import { useI18nTyped } from "@/types/i18n";
import { LOADER_REVEAL } from "@/lib/styles/motion";

defineProps<LoadingLineProps>();

const { t } = useI18nTyped();
</script>

<template>
  <div
    class="h-0.5 w-full shrink-0 overflow-hidden"
    :role="active ? 'progressbar' : undefined"
    :aria-label="active ? t('components.spinner.loading') : undefined"
    :aria-hidden="active ? undefined : 'true'"
    data-test="o-loading-line"
  >
    <!-- The reveal wait and the sweep are both animations, so they sit on two elements. -->
    <div v-if="active" :class="['h-full', LOADER_REVEAL]" data-test="o-loading-line-reveal">
      <div
        class="bg-accent o2-motion-keep h-full w-1/3 [animation:o2-indeterminate_calc(1.3s*var(--motion-slowdown))_ease-in-out_infinite]"
      />
    </div>
  </div>
</template>
