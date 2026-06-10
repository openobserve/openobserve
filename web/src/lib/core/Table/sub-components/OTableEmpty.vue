<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

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
    class="tw:flex tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:min-h-75"
  >
    <slot>
      <OEmptyState size="inline" :title="message ?? t('search.noData')" />
    </slot>
  </div>
</template>
