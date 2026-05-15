<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  /** Show loading as an overlay over existing rows (e.g., page change) */
  overlay?: boolean;
}>();

defineSlots<{
  default(): any;
}>();
</script>

<template>
  <div
    data-test="o2-table-loading"
    :class="[
      'tw:flex tw:items-center tw:justify-center tw:w-full tw:py-4',
      overlay
        ? 'tw:absolute tw:inset-0 tw:z-10 tw:bg-surface-base/70'
        : '',
    ]"
  >
    <slot>
      <OSpinner size="sm" />
      <span class="tw:ml-2 tw:text-text-secondary tw:text-sm">
        {{ t("confirmDialog.loading") }}
      </span>
    </slot>
  </div>
</template>
