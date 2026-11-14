<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

const { t } = useI18nTyped();

withDefaults(
  defineProps<{
    message?: I18nText;
    /**
     * Reserve a minimum height so the empty state has presence in
     * content-sized (non-fill-height) tables. Fill-height tables turn this
     * off: their container already has a definite height, and the floor
     * would force a scrollbar when the table is shorter than the floor.
     */
    floor?: boolean;
  }>(),
  { floor: true },
);

defineSlots<{
  default(): any;
}>();
</script>

<template>
  <!-- Sticky to the pane's start: the scroll container is as wide as the pane, the table can be wider. -->
  <div
    data-test="o2-table-empty"
    :class="[
      'sticky start-0 flex flex-1 flex-col items-center justify-center',
      floor ? 'min-h-75' : '',
    ]"
  >
    <slot>
      <OEmptyState size="inline" :title="message ?? t('search.noData')" />
    </slot>
  </div>
</template>
