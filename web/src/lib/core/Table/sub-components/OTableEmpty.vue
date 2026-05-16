<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  message?: string;
}>();

defineSlots<{
  default(): any;
}>();
</script>

<template>
  <div
    data-test="o2-table-empty"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-8 tw:text-center"
  >
    <slot>
      <div class="tw:text-text-secondary tw:text-sm">
        {{ message ?? t("search.noData") }}
      </div>
    </slot>
  </div>
</template>
