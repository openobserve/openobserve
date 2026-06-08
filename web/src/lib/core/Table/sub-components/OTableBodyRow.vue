<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import { computed, inject, ref, onMounted, watch, useSlots } from "vue";
import OTableBodyCell from "./OTableBodyCell.vue";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import OTableExpandButton from "./OTableExpandButton.vue";
import { OTableTreeContextKey } from "../composables/useTableTree";
import { TABLE_CHECKBOX_COL_SIZE as TABLE_CHECKBOX_COL_WIDTH, TABLE_CHECKBOX_COL_PAD_LEFT } from "../OTable.types";

const props = defineProps<{
  row: Row<any>;
  table: Table<any>;
  clickable?: boolean;
  selectionEnabled?: boolean;
  selectionMultiple?: boolean;
  isRowSelected?: boolean;
  /** When provided, returning false for a row disables its selection checkbox
   *  (visual not-allowed cursor + ignored toggles). Used e.g. to block bulk
   *  selection of the root user in IAM. */
  isRowSelectable?: (row: any) => boolean;
  expansionEnabled?: boolean;
  canExpand?: boolean;
  isExpanded?: boolean;
  highlightText?: string;
  shouldHighlightColumn?: (columnId: string) => boolean;
  getHighlightedHtml?: (columnId: string, cellValue: any) => string | null;
  wrap?: boolean;
  dense?: boolean;
  bordered?: boolean;
  striped?: boolean;
  rowClassFn?: string | ((row: any) => string);
  rowStyleFn?: (row: any) => Record<string, any>;
  /** Virtual scroll: callback for measuring row DOM element height */
  measureEl?: (el: HTMLElement | null) => void;
  /** Status bar color — renders a 4px left border indicator per row */
  statusBarColor?: string;
  /** Enable hover-visible copy button on cells */
  enableCellCopy?: boolean;
  /** Per-cell tw:inline style function */
  getCellStyle?: (params: {
    columnId: string;
    row: any;
    value: any;
  }) => Record<string, any>;
}>();

const emit = defineEmits<{
  "toggle-selection": [row: any];
  "toggle-expansion": [row: any];
  "row-click": [row: any, event: MouseEvent];
  "row-dblclick": [row: any, event: MouseEvent];
  "cell-click": [
    params: { columnId: string; row: any; value: any },
  ];
}>();

const slots = useSlots();

const rowRef = ref<HTMLElement | null>(null);

onMounted(() => {
  if (props.measureEl && rowRef.value) {
    props.measureEl(rowRef.value);
  }
});

const rowClass = computed(() => {
  if (typeof props.rowClassFn === "function") {
    return props.rowClassFn(props.row.original);
  }
  return props.rowClassFn ?? "";
});

const rowStyle = computed(() => {
  return props.rowStyleFn?.(props.row.original) ?? {};
});

const isStriped = computed(() => {
  return props.striped && props.row.index % 2 === 1;
});

const hasExpansionSlot = computed(() => !!slots.expansion);

// ── Tree mode ────────────────────────────────────────────────────
const treeCtx = inject(OTableTreeContextKey, null);
const treeMeta = computed(() => {
  if (!treeCtx?.value?.enabled) return null;
  return treeCtx.value.getMeta(props.row.original);
});
const isTreeParent = computed(() => !!treeMeta.value?.isParent);
const isTreeExpanded = computed(() => !!treeMeta.value?.isExpanded);
const showTreeWarning = computed(() =>
  treeCtx?.value?.enabled &&
  isTreeParent.value &&
  isTreeExpanded.value &&
  treeCtx.value.hasWarning(props.row.original) &&
  !!slots["tree-warning"],
);

/**
 * Horizontal offset (px) of the tree-column chevron from the row's left edge.
 * Used to align the warning row's content + connector line under the chevron.
 */
const treeConnectorX = computed(() => {
  const selectionWidth = props.selectionEnabled ? TABLE_CHECKBOX_COL_WIDTH : 0;
  const expansionWidth = props.expansionEnabled ? 32 : 0; // tw:w-8
  const cellPaddingLeft = 8; // tw:px-2
  const halfChevron = 9; // 18px / 2
  const parentDepth = treeMeta.value?.depth ?? 0;
  return (
    selectionWidth +
    expansionWidth +
    cellPaddingLeft +
    parentDepth * 16 +
    halfChevron
  );
});

function onClick(event: MouseEvent) {
  emit("row-click", props.row.original, event);
}

function onDblclick(event: MouseEvent) {
  emit("row-dblclick", props.row.original, event);
}
</script>

<template>
  <tr
    ref="rowRef"
    :data-test="`o2-table-row-${row.index}`"
    :class="[
      'tw:group/row',
      'tw:transition-colors tw:duration-150',
      clickable ? 'tw:cursor-pointer' : '',
      'tw:hover:bg-[var(--color-table-row-hover-bg)]',
      isRowSelected
        ? 'tw:bg-[var(--color-table-row-selected-bg)]'
        : '',
      !isRowSelected && isStriped
        ? 'tw:bg-[var(--color-table-row-striped-bg)]'
        : '',
      rowClass,
    ]"
    :style="{ height: 'var(--o2-table-row-height, 2.25rem)', ...rowStyle }"
    @click="onClick"
    @dblclick="onDblclick"
  >
    <!-- Status bar color indicator -->
    <td
      v-if="statusBarColor"
      class="tw:absolute tw:left-0 tw:inset-y-0 tw:w-1 tw:p-0 tw:border-0 tw:z-10"
      :style="{ backgroundColor: statusBarColor }"
      data-test="o2-table-status-bar"
    />

    <!-- Expand button cell -->
    <td
      v-if="expansionEnabled"
      :class="['tw:w-4 tw:min-w-4 tw:px-0 tw:text-center tw:align-middle', bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : '']"
      data-test="o2-table-expand-cell"
    >
      <OTableExpandButton
        v-if="canExpand !== false"
        :expanded="isExpanded ?? false"
        :row-id="String(row.index)"
        @toggle="emit('toggle-expansion', row.original)"
      />
    </td>

    <!-- Selection checkbox cell -->
    <td
      v-if="selectionEnabled"
      :class="[
        'tw:text-left tw:align-middle',
        bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : '',
        isRowSelectable && !isRowSelectable(row.original) ? 'tw:cursor-not-allowed' : '',
      ]"
      :style="{ width: TABLE_CHECKBOX_COL_WIDTH + 'px', minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px', maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px', paddingLeft: TABLE_CHECKBOX_COL_PAD_LEFT + 'px' }"
      data-test="o2-table-select-cell"
    >
      <div class="tw:flex tw:items-center tw:justify-start">
        <OTableSelectCheckbox
          :model-value="isRowSelected ?? false"
          :row-id="String(row.index)"
          :disabled="isRowSelectable ? !isRowSelectable(row.original) : false"
          @update:model-value="emit('toggle-selection', row.original)"
        />
      </div>
    </td>

    <!-- Data cells -->
    <OTableBodyCell
      v-for="cell in row.getVisibleCells()"
      :key="cell.id"
      :cell="cell"
      :row="row"
      :row-selected="isRowSelected"
      :highlight-text="highlightText"
      :should-highlight="shouldHighlightColumn?.(cell.column.id) ?? false"
      :get-highlighted-html="getHighlightedHtml"
      :wrap="wrap"
      :dense="dense"
      :bordered="bordered"
      :enable-cell-copy="enableCellCopy"
      :get-cell-style="getCellStyle"
      @cell-click="emit('cell-click', $event)"
    >
      <template v-if="slots[`cell-${cell.column.id}`]" #default>
        <slot
          :name="`cell-${cell.column.id}`"
          :row="row.original"
          :value="cell.getValue()"
          :column="cell.column.columnDef"
        />
      </template>
    </OTableBodyCell>
  </tr>

  <!-- Tree-mode warning row (rendered between parent and its children) -->
  <tr
    v-if="showTreeWarning"
    :data-test="`o2-table-tree-warning-${row.index}`"
    class="o2-table-tree-warning-row"
  >
    <td
      :colspan="row.getVisibleCells().length + (expansionEnabled ? 1 : 0) + (selectionEnabled ? 1 : 0)"
      :class="[
        'o2-table-tree-warning-cell',
        bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : '',
      ]"
      :style="{ '--o2-tree-connector-x': treeConnectorX + 'px' }"
    >
      <div class="o2-table-tree-warning-content">
        <slot name="tree-warning" :row="row.original" />
      </div>
    </td>
  </tr>

  <!-- Expanded row content -->
  <tr
    v-if="hasExpansionSlot && isExpanded"
    :data-test="`o2-table-expanded-row-${row.index}`"
    class="tw:bg-[var(--color-table-row-expanded-bg)]"
  >
    <td
      :colspan="row.getVisibleCells().length + (expansionEnabled ? 1 : 0) + (selectionEnabled ? 1 : 0)"
      :class="bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : ''"
    >
      <slot name="expansion" :row="row.original" />
    </td>
  </tr>
</template>

<style scoped>
.o2-table-tree-warning-row {
  background: var(--color-warning-surface, rgba(251, 191, 36, 0.08));
}
.o2-table-tree-warning-cell {
  position: relative;
}
/* Continuation of the tree connector vertical line through the warning row */
.o2-table-tree-warning-cell::after {
  content: "";
  position: absolute;
  left: var(--o2-tree-connector-x);
  top: 0;
  bottom: 0;
  width: 1.5px;
  background-color: var(--q-primary, #6366f1);
  opacity: 0.55;
  z-index: 0;
}
.o2-table-tree-warning-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
