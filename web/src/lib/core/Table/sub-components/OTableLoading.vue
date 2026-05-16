<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useSlots } from "vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

defineProps<{
  /** Variant: "skeleton" (rows) or "spinner" (centered). Default: "skeleton" */
  variant?: "skeleton" | "spinner";
  /** Number of skeleton rows. Default: 5 */
  skeletonRows?: number;
  /** Number of skeleton shapes per row. Default: 4 */
  skeletonCols?: number;
  /** Position as overlay over existing content */
  overlay?: boolean;
}>();

defineSlots<{
  default(): any;
}>();

const slots = useSlots();
</script>

<template>
  <!-- Custom slot overrides everything -->
  <template v-if="slots.default">
    <div
      data-test="o2-table-loading"
      :class="overlay ? 'tw:absolute tw:inset-0 tw:z-10 tw:bg-surface-base/70' : ''"
    >
      <slot />
    </div>
  </template>

  <!-- Spinner variant -->
  <OInnerLoading
    v-else-if="variant === 'spinner'"
    :showing="true"
    label="Loading"
    size="sm"
    data-test="o2-table-loading"
  />

  <!-- Skeleton variant (default) -->
  <div
    v-else
    data-test="o2-table-loading"
    :class="overlay ? 'tw:absolute tw:inset-0 tw:z-10 tw:bg-surface-base/70' : ''"
  >
    <div
      data-test="o2-table-skeleton-rows"
      class="tw:flex tw:flex-col tw:gap-1 tw:p-2"
      role="status"
      aria-label="Loading data"
      aria-live="polite"
    >
      <div
        v-for="i in (skeletonRows ?? 5)"
        :key="`skel-row-${i}`"
        class="tw:flex tw:gap-2"
      >
        <OSkeleton
          v-for="j in (skeletonCols ?? 4)"
          :key="`skel-cell-${i}-${j}`"
          type="rect"
          animation="pulse"
          class="tw:h-5 tw:flex-1"
        />
      </div>
    </div>
  </div>
</template>
