<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject } from "vue";
import { OTableStaleKey } from "../OTable.types";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { I18nText } from "@/types/i18n";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";

const props = defineProps<{
  modelValue: boolean;
  indeterminate?: boolean;
  rowId?: string;
  disabled?: boolean;
  label?: I18nText;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

// Selecting a kept row during a refetch would act on rows about to be replaced; it stays focusable, only inactive.
const stale = inject(OTableStaleKey, null);
const isStale = computed(() => !!stale?.value);

const checkboxModel = computed<CheckboxModelValue>(() => {
  if (props.indeterminate) return "indeterminate";
  return props.modelValue;
});

function handleUpdate(val: CheckboxModelValue) {
  if (props.disabled || isStale.value) return;
  if (typeof val === "boolean") {
    emit("update:modelValue", val);
  } else {
    emit("update:modelValue", true);
  }
}
</script>

<template>
  <span
    class="contents"
    :role="isStale ? 'group' : undefined"
    :aria-disabled="isStale ? 'true' : undefined"
  >
    <!-- Row checkboxes sit in the dimmed body already; only the header one dims itself. -->
    <OCheckbox
      :model-value="checkboxModel"
      :data-test="`o2-table-select-${rowId ?? 'header'}`"
      size="sm"
      class="align-middle"
      :aria-label="label"
      :disabled="disabled"
      :class="isStale ? ['cursor-not-allowed', rowId === 'all' ? 'opacity-60' : ''] : undefined"
      @update:model-value="handleUpdate"
    />
  </span>
</template>
