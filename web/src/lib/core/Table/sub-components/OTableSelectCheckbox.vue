<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";

const props = defineProps<{
  modelValue: boolean;
  indeterminate?: boolean;
  rowId?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const checkboxModel = computed<CheckboxModelValue>(() => {
  if (props.indeterminate) return "indeterminate";
  return props.modelValue;
});

function handleUpdate(val: CheckboxModelValue) {
  if (typeof val === "boolean") {
    emit("update:modelValue", val);
  } else {
    emit("update:modelValue", true);
  }
}
</script>

<template>
  <OCheckbox
    :model-value="checkboxModel"
    :data-test="`o2-table-select-${rowId ?? 'header'}`"
    size="sm"
    @update:model-value="handleUpdate"
  />
</template>
