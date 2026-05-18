<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SelectItemProps, SelectItemSlots } from "./OSelect.types";
import { SELECT_VALUE_MAP_KEY, NULL_VALUE_SENTINEL } from "./OSelect.types";
import { SelectItem, SelectItemText } from "reka-ui";
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
      'tw:ps-3 tw:pe-3 tw:py-1.5 tw:text-sm',
      'tw:text-select-item-text tw:rounded-sm',
      'tw:cursor-pointer tw:select-none tw:outline-none',
      'tw:transition-colors tw:duration-100',
      'tw:data-highlighted:bg-select-item-hover-bg',
      'tw:data-[state=checked]:bg-select-item-selected-bg tw:data-[state=checked]:text-select-item-selected-text',
      'tw:data-disabled:text-select-item-disabled tw:data-disabled:cursor-not-allowed tw:data-disabled:pointer-events-none',
    ]"
  >
    <SelectItemText>
      <slot>{{ props.label }}</slot>
    </SelectItemText>
  </SelectItem>
</template>
