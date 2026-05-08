<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  CheckboxGroupProps,
  CheckboxGroupEmits,
  CheckboxGroupSlots,
  CheckboxGroupValue,
  CheckboxPrimitive,
} from "./OCheckbox.types";
import { CHECKBOX_GROUP_KEY } from "./OCheckbox.types";
import { provide } from "vue";

const props = withDefaults(defineProps<CheckboxGroupProps>(), {
  modelValue: () => [],
  disabled: false,
});

const emit = defineEmits<CheckboxGroupEmits>();

defineSlots<CheckboxGroupSlots>();

function toggle(value: CheckboxPrimitive) {
  const current: CheckboxGroupValue = props.modelValue ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  emit("update:modelValue", next);
}

function isChecked(value: CheckboxPrimitive): boolean {
  return (props.modelValue ?? []).includes(value);
}

provide(CHECKBOX_GROUP_KEY, {
  get modelValue() {
    return props.modelValue ?? [];
  },
  get disabled() {
    return props.disabled;
  },
  toggle,
  isChecked,
});
</script>

<template>
  <div role="group" class="tw:flex tw:flex-col tw:gap-2">
    <slot />
  </div>
</template>
