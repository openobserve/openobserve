<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  RadioGroupProps,
  RadioGroupEmits,
  RadioGroupSlots,
} from "./ORadio.types";
import { RadioGroupRoot } from "reka-ui";

withDefaults(defineProps<RadioGroupProps>(), {
  disabled: false,
  orientation: "vertical",
});

const emit = defineEmits<RadioGroupEmits>();

defineSlots<RadioGroupSlots>();

function handleUpdate(value: string) {
  emit("update:modelValue", value);
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
