<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { I18nText } from "@/types/i18n";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { OTableFocusToolbarKey } from "../OTable.types";

const props = defineProps<{
  modelValue: boolean;
  indeterminate?: boolean;
  rowId?: string;
  disabled?: boolean;
  /** Display position (0-based), which a sorted table no longer shares with the row index. */
  position?: number;
  label?: I18nText;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const checkboxModel = computed<CheckboxModelValue>(() => {
  if (props.indeterminate) return "indeterminate";
  return props.modelValue;
});

const { t } = useI18nTyped();
const focusCtx = inject(OTableFocusToolbarKey, null);
// Only focus-toolbar tables name their checkboxes, so every other table renders byte-identical.
const ariaLabel = computed(() => {
  if (!focusCtx?.enabled.value) return undefined;
  if (props.rowId === "all") return t("components.table.selectAllRows");
  return t("components.table.selectRow", {
    name: raw(String((props.position ?? Number(props.rowId ?? 0)) + 1)),
  });
});

// The row's cells hold the table's one tab stop and Space on a cell already selects, so a row checkbox is no extra stop.
const root = ref<{ $el?: Element } | null>(null);
onMounted(() => {
  if (!focusCtx?.enabled.value || props.rowId === "all") return;
  const box = root.value?.$el?.querySelector?.<HTMLElement>('button[role="checkbox"]');
  if (box) box.tabIndex = -1;
});

function handleUpdate(val: CheckboxModelValue) {
  if (props.disabled) return;
  if (typeof val === "boolean") {
    emit("update:modelValue", val);
  } else {
    emit("update:modelValue", true);
  }
}
</script>

<template>
  <OCheckbox
    ref="root"
    :model-value="checkboxModel"
    :data-test="`o2-table-select-${rowId ?? 'header'}`"
    size="sm"
    :aria-label="label ?? ariaLabel"
    :disabled="disabled"
    @update:model-value="handleUpdate"
  />
</template>
