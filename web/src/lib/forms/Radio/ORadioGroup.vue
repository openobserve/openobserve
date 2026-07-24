<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  RadioGroupProps,
  RadioGroupEmits,
  RadioGroupSlots,
  RadioValue,
} from "./ORadio.types";
import { RADIO_VALUE_MAP_KEY } from "./ORadio.types";
import { RadioGroupRoot, type AcceptableValue } from "reka-ui";
import { provide } from "vue";

withDefaults(defineProps<RadioGroupProps>(), {
  disabled: false,
  orientation: "vertical",
});

const emit = defineEmits<RadioGroupEmits>();

defineSlots<RadioGroupSlots>();

const valueMap = new Map<string, RadioValue>();
provide(RADIO_VALUE_MAP_KEY, valueMap);

function handleUpdate(value: AcceptableValue) {
  // RadioGroupRoot binds string model values, so recover the original via the map.
  const key = String(value);
  emit("update:modelValue", valueMap.get(key) ?? key);
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
      'flex gap-2',
      orientation === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col',
    ]"
    @update:model-value="handleUpdate"
  >
    <slot />
  </RadioGroupRoot>
</template>
