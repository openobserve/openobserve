<script setup lang="ts">
import type { InnerLoadingProps } from "./OInnerLoading.types";
import OSpinner from "../Spinner/OSpinner.vue";

withDefaults(defineProps<InnerLoadingProps>(), {
  size: "xs",
});
</script>

<template>
  <Transition
    enter-active-class="tw:transition-opacity tw:duration-200"
    leave-active-class="tw:transition-opacity tw:duration-200"
    enter-from-class="tw:opacity-0"
    leave-to-class="tw:opacity-0"
  >
    <div
      v-if="showing"
      class="tw:absolute tw:inset-0 tw:z-10 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:bg-inner-loading-overlay"
      role="status"
      aria-live="polite"
      :aria-label="label ?? 'Loading'"
    >
      <OSpinner variant="ring" :size="size" />
      <span
        v-if="label"
        class="tw:text-xs tw:text-inner-loading-label tw:select-none"
      >
        {{ label }}
      </span>
    </div>
  </Transition>
</template>
