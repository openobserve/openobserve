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
    class="flex flex-1 flex-col items-center justify-center min-h-75"
  >
    <slot>
      <OEmptyState size="inline" :title="message ?? t('search.noData')" />
    </slot>
  </div>
</template>
