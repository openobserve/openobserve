<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SelectItemProps, SelectItemSlots } from "./OSelect.types";
import {
  SELECT_VALUE_MAP_KEY,
  SELECT_PARENT_DATA_TEST_KEY,
  NULL_VALUE_SENTINEL,
} from "./OSelect.types";
import { SelectItem, SelectItemText } from "reka-ui";
import { computed, inject, onMounted, onUnmounted, ref, useSlots } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useIsTruncated } from "@/lib/overlay/Tooltip/useIsTruncated";

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

// Only the default (unslotted) label rendering below is measured — a custom
// slot's own content is that consumer's responsibility to truncate/tooltip.
const labelRef = ref<HTMLElement | null>(null);
const { isTruncated } = useIsTruncated(labelRef);
const hasCustomSlot = computed(() => !!useSlots().default);
</script>

<template>
  <SelectItem
    :value="rekaValue"
    :disabled="props.disabled"
    :data-test="parentDataTest ? `${parentDataTest}-option` : undefined"
    :data-test-value="rekaValue"
    :data-test-label="props.label"
    :class="[
      'relative flex w-full items-center',
      'py-1.5 ps-3 pe-3 text-sm',
      'text-select-item-text rounded-default',
      'cursor-pointer outline-none select-none',
      'transition-colors duration-100',
      'data-highlighted:bg-select-item-hover-bg',
      'data-[state=checked]:bg-select-item-selected-bg data-[state=checked]:text-select-item-selected-text',
      'data-disabled:text-select-item-disabled data-disabled:pointer-events-none data-disabled:cursor-not-allowed',
    ]"
  >
    <SelectItemText>
      <slot>
        <span ref="labelRef" class="block min-w-0 flex-1 truncate">{{ props.label }}</span>
      </slot>
    </SelectItemText>
    <OTooltip v-if="!hasCustomSlot" :content="props.label" :disabled="!isTruncated" />
  </SelectItem>
</template>
