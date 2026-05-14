<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SelectItemProps, SelectItemSlots } from "./OSelect.types";
import { SELECT_VALUE_MAP_KEY, NULL_VALUE_SENTINEL } from "./OSelect.types";
import { SelectItem, SelectItemText, SelectItemIndicator } from "reka-ui";
import { computed, inject, onMounted, onUnmounted } from "vue";

const props = withDefaults(defineProps<SelectItemProps>(), {
  disabled: false,
});

defineSlots<SelectItemSlots>();

// Register original value type into the parent OSelect's value map so that
// numeric (or boolean or null) values are recovered when Reka UI returns a string.
const valueMap = inject(SELECT_VALUE_MAP_KEY, null);

/** Internal string Reka sees — null maps to the sentinel */
const rekaValue = computed(() =>
  props.value === null ? NULL_VALUE_SENTINEL : String(props.value),
);

onMounted(() => {
  valueMap?.set(rekaValue.value, props.value);
});
onUnmounted(() => {
  valueMap?.delete(rekaValue.value);
});
</script>

<template>
  <SelectItem
    :value="rekaValue"
    :disabled="props.disabled"
    :class="[
      'tw:relative tw:flex tw:items-center tw:w-full',
      'tw:ps-8 tw:pe-3 tw:py-1.5 tw:text-sm',
      'tw:text-select-item-text tw:rounded-sm',
      'tw:cursor-pointer tw:select-none tw:outline-none',
      'tw:transition-colors tw:duration-100',
      'tw:data-highlighted:bg-select-item-hover-bg',
      'tw:data-[state=checked]:bg-select-item-selected-bg tw:data-[state=checked]:text-select-item-selected-text',
      'tw:data-disabled:text-select-item-disabled tw:data-disabled:cursor-not-allowed tw:data-disabled:pointer-events-none',
    ]"
  >
    <!-- Check indicator -->
    <SelectItemIndicator
      class="tw:absolute tw:start-2 tw:flex tw:items-center tw:justify-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        class="tw:size-3.5"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
          clip-rule="evenodd"
        />
      </svg>
    </SelectItemIndicator>

    <SelectItemText>
      <slot>{{ props.label }}</slot>
    </SelectItemText>
  </SelectItem>
</template>
