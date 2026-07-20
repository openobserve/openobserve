<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "../OTable.types";

const props = defineProps<{
  columns: OTableColumnDef[];
  columnVisibility: Record<string, boolean>;
  hasResizedColumns?: boolean;
}>();

const emit = defineEmits<{
  "update:columnVisibility": [visibility: Record<string, boolean>];
  "reset:columnSizes": [];
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
      <div class="relative inline-flex">
        <OButton
          variant="outline"
          size="icon-sm"
          :aria-label="`Manage columns${hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''}`"
          data-test="o2-table-column-toggle-btn"
        >
          <template #icon-left>
            <OIcon name="view-column" size="sm" />
          </template>
          <OTooltip
            :content="hiddenCount > 0 ? `Columns (${hiddenCount} hidden)` : 'Columns'"
            side="bottom"
          />
        </OButton>
        <span
          v-if="hiddenCount > 0"
          class="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-[var(--color-primary-600)] text-white text-[10px] font-medium w-4 h-4 leading-none pointer-events-none"
          data-test="o2-table-column-toggle-hidden-badge"
        >
          {{ hiddenCount }}
        </span>
      </div>
    </template>

    <!-- Column list panel -->
    <div
      class="py-1 min-w-44"
      data-test="o2-table-column-toggle-panel"
    >
      <p class="px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
        Columns
      </p>

      <ul role="listbox" aria-label="Toggle column visibility" aria-multiselectable="true">
        <li
          v-for="col in toggleableColumns"
          :key="col.id"
          class="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded hover:bg-surface-panel transition-colors"
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
          <span class="text-sm text-text-primary select-none flex-1">
            {{ typeof col.header === "string" ? col.header : col.id }}
          </span>
        </li>
      </ul>

      <!-- Reset buttons — same px-3 gap-2 structure as list items for alignment -->
      <div
        v-if="hiddenCount > 0 || props.hasResizedColumns"
        class="border-t border-[var(--color-border-default)] mt-1 pt-1 pb-1"
      >
        <button
          v-if="hiddenCount > 0"
          class="flex items-center gap-2 px-3 py-1.5 w-full text-sm cursor-pointer rounded hover:bg-surface-panel transition-colors text-text-primary"
          data-test="o2-table-column-toggle-reset-btn"
          @click="resetToDefault"
        >
          <OIcon name="refresh" size="sm" class="shrink-0" />
          <span class="select-none">Reset to default</span>
        </button>
        <button
          v-if="props.hasResizedColumns"
          class="flex items-center gap-2 px-3 py-1.5 w-full text-sm cursor-pointer rounded hover:bg-surface-panel transition-colors text-text-primary"
          data-test="o2-table-column-resize-reset-btn"
          @click="emit('reset:columnSizes')"
        >
          <OIcon name="refresh" size="sm" class="shrink-0" />
          <span class="select-none">Reset column widths</span>
        </button>
      </div>
    </div>
  </ODropdown>
</template>
