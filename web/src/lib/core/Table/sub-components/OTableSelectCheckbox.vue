<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { OTableStaleKey } from "../OTable.types";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { I18nText } from "@/types/i18n";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { useI18nTyped } from "@/types/i18n";
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

// Selecting a kept row during a refetch would act on rows about to be replaced; it stays focusable, only inactive.
const stale = inject(OTableStaleKey, null);
const isStale = computed(() => !!stale?.value);

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
  return t("components.table.selectRowAt", {
    index: (props.position ?? Number(props.rowId ?? 0)) + 1,
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
      ref="root"
      :model-value="checkboxModel"
      :data-test="`o2-table-select-${rowId ?? 'header'}`"
      size="sm"
      class="align-middle"
      :aria-label="label ?? ariaLabel"
      :disabled="disabled"
      :class="isStale ? ['cursor-not-allowed', rowId === 'all' ? 'opacity-60' : ''] : undefined"
      @update:model-value="handleUpdate"
    />
  </span>
</template>
