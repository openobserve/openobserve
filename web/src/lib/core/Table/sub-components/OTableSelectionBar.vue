<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

import { guardMenusWhile, swallowActivation } from "../composables/useInactiveGuard";

const props = withDefaults(
  defineProps<{
    selectedCount: number;
    totalCount: number;
    /** False when totalCount is only a lower bound. */
    totalCountExact?: boolean;
    /** The rows on screen are being refetched: the actions stay focusable but inactive. */
    stale?: boolean;
  }>(),
  { totalCountExact: true },
);

const emit = defineEmits<{ clear: [] }>();

const { t } = useI18nTyped();

const actionsRef = ref<HTMLElement | null>(null);

guardMenusWhile(
  () => actionsRef.value,
  () => !!props.stale,
);

const selectionLabel = computed(() => {
  const selected = props.selectedCount.toLocaleString();
  // A selection can outlive its rows (filter, refetch), and "5 of 3 selected" reads as a bug.
  if (props.selectedCount > props.totalCount) {
    return t("components.table.selectedCount", { selected });
  }
  const total = `${props.totalCount.toLocaleString()}${props.totalCountExact ? "" : "+"}`;
  return t("components.table.selectedOfTotal", { selected, total });
});
</script>

<template>
  <div
    class="px-page-edge bg-selected-bg text-selected-fg border-selected-border flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b py-2"
    data-test="o2-table-selection-bar"
  >
    <span
      class="text-compact font-medium whitespace-nowrap tabular-nums"
      role="status"
      data-test="o2-table-selected-count"
      >{{ selectionLabel }}</span
    >
    <span class="bg-selected-border h-4 w-px shrink-0 max-md:hidden" aria-hidden="true" />
    <div
      ref="actionsRef"
      :class="[
        'flex min-w-0 flex-wrap items-center gap-2 transition-opacity',
        stale ? 'cursor-not-allowed opacity-60' : '',
      ]"
      :role="stale ? 'group' : undefined"
      :aria-disabled="stale ? 'true' : undefined"
      data-test="o2-table-selection-actions"
      @pointerdown.capture="swallowActivation($event, !!stale)"
      @mousedown.capture="swallowActivation($event, !!stale)"
      @click.capture="swallowActivation($event, !!stale)"
      @keydown.capture="swallowActivation($event, !!stale)"
    >
      <slot />
    </div>
    <OButton
      variant="ghost"
      size="sm"
      icon-left="close"
      class="ms-auto"
      data-test="o2-table-selection-clear"
      @click="emit('clear')"
    >
      {{ t("components.select.clearSelection") }}
    </OButton>
  </div>
</template>
