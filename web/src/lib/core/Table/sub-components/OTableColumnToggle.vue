<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import type { OTableColumnDef } from "../OTable.types";

const props = defineProps<{
  columns: OTableColumnDef[];
  columnVisibility: Record<string, boolean>;
}>();

const emit = defineEmits<{
  "update:columnVisibility": [visibility: Record<string, boolean>];
}>();

// Only show columns that are marked hideable (non-action columns the user can control)
const toggleableColumns = computed(() =>
  props.columns.filter((col) => col.hideable && !col.isAction),
);

const hiddenCount = computed(
  () =>
    toggleableColumns.value.filter(
      (col) => props.columnVisibility[col.id] === false,
    ).length,
);

function isVisible(columnId: string): boolean {
  return props.columnVisibility[columnId] !== false;
}

function toggleColumn(columnId: string): void {
  const current = props.columnVisibility[columnId] !== false;
  emit("update:columnVisibility", {
    ...props.columnVisibility,
    [columnId]: !current,
  });
}

function resetToDefault(): void {
  // Remove all per-column visibility overrides — restores the prop-defined defaults
  const reset: Record<string, boolean> = {};
  for (const col of toggleableColumns.value) {
    reset[col.id] = true;
  }
  emit("update:columnVisibility", reset);
}
</script>

<template>
  <ODropdown align="end" side="bottom" :side-offset="4">
    <template #trigger>
      <OButton
        variant="ghost"
        size="sm"
        :aria-label="`Manage columns${hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''}`"
        data-test="o2-table-column-toggle-btn"
      >
        <template #icon-left>
          <OIcon name="view-column" size="sm" />
        </template>
        Columns
        <span
          v-if="hiddenCount > 0"
          class="tw:ml-1 tw:inline-flex tw:items-center tw:justify-center tw:rounded-full tw:bg-[var(--color-primary-100)] tw:text-[var(--color-primary-700)] tw:text-xs tw:font-medium tw:w-4 tw:h-4"
          data-test="o2-table-column-toggle-hidden-badge"
        >
          {{ hiddenCount }}
        </span>
      </OButton>
    </template>

    <!-- Column list panel -->
    <div
      class="tw:py-1 tw:min-w-44"
      data-test="o2-table-column-toggle-panel"
    >
      <p class="tw:px-3 tw:py-1 tw:text-xs tw:font-semibold tw:text-[var(--color-text-secondary)]">
        Columns
      </p>

      <ul role="listbox" aria-label="Toggle column visibility" aria-multiselectable="true">
        <li
          v-for="col in toggleableColumns"
          :key="col.id"
          class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1.5 tw:cursor-pointer tw:rounded tw:hover:bg-[var(--color-surface-panel)] tw:transition-colors"
          :data-test="`o2-table-column-toggle-item-${col.id}`"
          @click.stop="toggleColumn(col.id)"
        >
          <OCheckbox
            :model-value="isVisible(col.id)"
            size="sm"
            :aria-label="`Toggle ${typeof col.header === 'string' ? col.header : col.id} column`"
            @update:model-value="toggleColumn(col.id)"
            @click.stop
          />
          <span class="tw:text-sm tw:text-[var(--color-text-primary)] tw:select-none tw:flex-1">
            {{ typeof col.header === "string" ? col.header : col.id }}
          </span>
        </li>
      </ul>

      <!-- Reset button -->
      <div
        v-if="hiddenCount > 0"
        class="tw:border-t tw:border-[var(--color-border-default)] tw:mt-1 tw:pt-1 tw:px-2 tw:pb-1"
      >
        <OButton
          variant="ghost"
          size="sm"
          class="tw:w-full tw:justify-start"
          data-test="o2-table-column-toggle-reset-btn"
          @click="resetToDefault"
        >
          <template #icon-left>
            <OIcon name="refresh" size="sm" />
          </template>
          Reset to default
        </OButton>
      </div>
    </div>
  </ODropdown>
</template>
