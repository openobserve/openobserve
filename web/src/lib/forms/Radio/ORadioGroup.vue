<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  RadioGroupProps,
  RadioGroupEmits,
  RadioGroupSlots,
} from "./ORadio.types";
import { RADIO_VALUE_MAP_KEY } from "./ORadio.types";
import { RadioGroupRoot } from "reka-ui";
import { provide } from "vue";

withDefaults(defineProps<RadioGroupProps>(), {
  disabled: false,
  orientation: "vertical",
});

const emit = defineEmits<RadioGroupEmits>();

defineSlots<RadioGroupSlots>();

const valueMap = new Map<string, string | number | boolean>();
provide(RADIO_VALUE_MAP_KEY, valueMap);

function handleUpdate(value: string) {
  emit("update:modelValue", valueMap.get(value) ?? value);
}
</script>

<template>
  <RadioGroupRoot
    :model-value="modelValue !== undefined ? String(modelValue) : undefined"
    :disabled="disabled"
    :orientation="orientation"
    :name="name"
    :aria-label="label"
    :class="[
      'tw:flex tw:gap-2',
      orientation === 'horizontal' ? 'tw:flex-row tw:flex-wrap' : 'tw:flex-col',
    ]"
    @update:model-value="handleUpdate"
  >
    <slot />
  </RadioGroupRoot>
</template>
