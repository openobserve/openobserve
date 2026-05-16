<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue: boolean;
  indeterminate?: boolean;
  rowId?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const computedValue = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});
</script>

<template>
  <q-checkbox
    v-model="computedValue"
    :data-test="`o2-table-select-${rowId ?? 'header'}`"
    :indeterminate="indeterminate"
    size="sm"
    class="o2-table-checkbox"
  />
</template>
