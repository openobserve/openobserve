<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "../OTable.types";

const { t } = useI18n();

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
  () => toggleableColumns.value.filter((col) => props.columnVisibility[col.id] === false).length,
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
          class="bg-count-badge-bg text-3xs pointer-events-none absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full leading-none font-medium text-white"
          data-test="o2-table-column-toggle-hidden-badge"
        >
          {{ hiddenCount }}
        </span>
      </div>
    </template>

    <!-- Column list panel -->
    <div class="min-w-44 py-1" data-test="o2-table-column-toggle-panel">
      <p class="text-text-secondary px-3 py-1 text-xs font-medium">
        {{ t("components.table.columnToggle.columns") }}
      </p>

      <ul
        role="listbox"
        :aria-label="t('components.table.columnToggle.toggleVisibilityAria')"
        aria-multiselectable="true"
      >
        <li
          v-for="col in toggleableColumns"
          :key="col.id"
          class="rounded-default hover:bg-surface-panel flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors"
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
          <span class="text-text-body flex-1 text-sm select-none">
            {{ typeof col.header === "string" ? col.header : col.id }}
          </span>
        </li>
      </ul>

      <!-- Reset buttons — same px-3 gap-2 structure as list items for alignment -->
      <div
        v-if="hiddenCount > 0 || props.hasResizedColumns"
        class="border-border-default mt-1 border-t pt-1 pb-1"
      >
        <button
          v-if="hiddenCount > 0"
          class="rounded-default hover:bg-surface-panel text-text-body flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors"
          data-test="o2-table-column-toggle-reset-btn"
          @click="resetToDefault"
        >
          <OIcon name="refresh" size="sm" class="shrink-0" />
          <span class="select-none">{{ t("components.table.columnToggle.resetToDefault") }}</span>
        </button>
        <button
          v-if="props.hasResizedColumns"
          class="rounded-default hover:bg-surface-panel text-text-body flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors"
          data-test="o2-table-column-resize-reset-btn"
          @click="emit('reset:columnSizes')"
        >
          <OIcon name="refresh" size="sm" class="shrink-0" />
          <span class="select-none">{{
            t("components.table.columnToggle.resetColumnWidths")
          }}</span>
        </button>
      </div>
    </div>
  </ODropdown>
</template>
