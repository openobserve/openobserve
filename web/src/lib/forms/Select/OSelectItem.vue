<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SelectItemProps, SelectItemSlots } from "./OSelect.types";
import { SELECT_VALUE_MAP_KEY, SELECT_PARENT_DATA_TEST_KEY, NULL_VALUE_SENTINEL } from "./OSelect.types";
import { SelectItem, SelectItemText } from "reka-ui";
import { computed, inject, onMounted, onUnmounted } from "vue";

const props = withDefaults(defineProps<SelectItemProps>(), {
  disabled: false,
});

defineSlots<SelectItemSlots>();

// Register original value type into the parent OSelect's value map so that
// numeric (or boolean or null) values are recovered when Reka UI returns a string.
const valueMap = inject(SELECT_VALUE_MAP_KEY, null);

// Inject the parent OSelect's data-test (forwarded via provide) so that
// option rows receive a `<parent>-option` data-test attribute and a
// `data-test-value` mirroring the option's value. Matches the listbox-mode
// behaviour and keeps e2e selectors data-test-only (§4 OSelect convention).
const parentDataTestRef = inject(SELECT_PARENT_DATA_TEST_KEY, null);
const parentDataTest = computed(() => parentDataTestRef?.value);

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
    :data-test="parentDataTest ? `${parentDataTest}-option` : undefined"
    :data-test-value="rekaValue"
    :data-test-label="props.label"
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
