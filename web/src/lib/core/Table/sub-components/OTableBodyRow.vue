<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import { computed, inject, ref, onMounted, useSlots } from "vue";
import OTableBodyCell from "./OTableBodyCell.vue";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import OTableExpandButton from "./OTableExpandButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { OTableTreeContextKey } from "../composables/useTableTree";
import { TABLE_CHECKBOX_COL_SIZE as TABLE_CHECKBOX_COL_WIDTH } from "../OTable.types";

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
  /** Per-cell inline style function */
  getCellStyle?: (params: { columnId: string; row: any; value: any }) => Record<string, any>;
  /** When true, renders a drag handle grip icon as the first cell. */
  enableRowReorder?: boolean;
  /** Per-row predicate: when false, the drag handle is hidden for this row. */
  rowDraggable?: boolean;
}>();

const emit = defineEmits<{
  "toggle-selection": [row: any];
  "toggle-expansion": [row: any];
  "row-click": [row: any, event: MouseEvent];
  "row-dblclick": [row: any, event: MouseEvent];
  "row-mouseenter": [row: any, event: MouseEvent];
  "row-mouseleave": [row: any];
  "cell-click": [params: { columnId: string; row: any; value: any }];
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
const showTreeWarning = computed(
  () =>
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
  const expansionWidth = props.expansionEnabled ? 32 : 0; // w-8
  const selectionWidth = props.selectionEnabled ? TABLE_CHECKBOX_COL_WIDTH : 0;
  const dragWidth = props.enableRowReorder ? 16 : 0; // w-4
  const cellPaddingLeft = 8; // px-2
  const halfChevron = 9; // 18px / 2
  const parentDepth = treeMeta.value?.depth ?? 0;
  return (
    expansionWidth + selectionWidth + dragWidth + cellPaddingLeft + parentDepth * 16 + halfChevron
  );
});

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, select, textarea, label, [role='button']")) {
    return;
  }
  emit("row-click", props.row.original, event);
}

function onDblclick(event: MouseEvent) {
  emit("row-dblclick", props.row.original, event);
}

// Row hover/focus keyboard shortcuts (↑/↓, Enter, action keys) are handled by a
// SINGLE delegated listener at the table level (useTableRowShortcuts in
// OTable.vue) instead of one window listener per row. Rows only need to stay
// hoverable/focusable — the CSS + tabindex on the <tr> below — and surface their
// hover events for parents that listen.
function onRowMouseenter(e: MouseEvent) {
  emit("row-mouseenter", props.row.original, e);
}
function onRowMouseleave() {
  emit("row-mouseleave", props.row.original);
}
</script>

<template>
  <tr
    ref="rowRef"
    :data-test="`o2-table-row-${row.index}`"
    :tabindex="clickable ? 0 : undefined"
    :class="[
      'group/row',
      'transition-colors duration-150',
      clickable ? 'cursor-pointer' : '',
      'hover:bg-table-row-hover-bg',
      clickable ? 'focus-visible:bg-table-row-hover-bg focus:outline-none' : '',
      isRowSelected ? 'bg-table-row-selected-bg' : '',
      !isRowSelected && isStriped ? 'bg-table-row-striped-bg' : '',
      statusBarColor ? 'o2-table-row-with-status' : '',
      rowClass,
    ]"
    :style="{
      height: 'var(--table-row-height, 2.25rem)',
      ...(statusBarColor ? { '--row-status-color': statusBarColor } : {}),
      ...rowStyle,
    }"
    :data-status-bar="statusBarColor ? 'true' : undefined"
    @click="onClick"
    @dblclick="onDblclick"
    @mouseenter="onRowMouseenter"
    @mouseleave="onRowMouseleave"
  >
    <!-- Expand button cell -->
    <td
      v-if="expansionEnabled"
      :class="[
        'w-4 min-w-4 px-0 text-center align-middle',
        bordered ? 'border-table-row-divider border-b' : '',
      ]"
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
        'text-left align-middle',
        bordered ? 'border-table-row-divider border-b' : '',
        isRowSelectable && !isRowSelectable(row.original) ? 'cursor-not-allowed' : '',
      ]"
      :style="{
        width: TABLE_CHECKBOX_COL_WIDTH + 'px',
        minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
        maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
        paddingLeft: 'var(--spacing-table-edge)',
      }"
      data-test="o2-table-select-cell"
    >
      <div class="flex items-center justify-start">
        <OTableSelectCheckbox
          :model-value="isRowSelected ?? false"
          :row-id="String(row.index)"
          :disabled="isRowSelectable ? !isRowSelectable(row.original) : false"
          @update:model-value="emit('toggle-selection', row.original)"
        />
      </div>
    </td>

    <!-- Drag handle cell -->
    <td
      v-if="enableRowReorder"
      :class="[
        'w-4 min-w-4 px-0 text-center align-middle',
        bordered ? 'border-table-row-divider border-b' : '',
      ]"
      class="o2-table-drag-handle"
      data-test="o2-table-row-drag-handle"
    >
      <OIcon
        name="drag-indicator"
        size="xs"
        :class="[rowDraggable === false ? 'invisible' : '']"
        class="text-text-secondary cursor-grab transition-opacity"
      />
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
          :index="row.index"
        />
      </template>
    </OTableBodyCell>
  </tr>

  <!-- Tree-mode warning row (rendered between parent and its children) -->
  <tr
    v-if="showTreeWarning"
    :data-test="`o2-table-tree-warning-${row.index}`"
    class="bg-warning-surface"
  >
    <td
      :colspan="
        row.getVisibleCells().length +
        (expansionEnabled ? 1 : 0) +
        (selectionEnabled ? 1 : 0) +
        (enableRowReorder ? 1 : 0)
      "
      :class="[
        'o2-table-tree-warning-cell relative',
        bordered ? 'border-table-row-divider border-b' : '',
      ]"
      :style="{ '--tree-connector-x': treeConnectorX + 'px' }"
    >
      <div class="relative z-1 flex items-center justify-center">
        <slot name="tree-warning" :row="row.original" />
      </div>
    </td>
  </tr>

  <!-- Expanded row content -->
  <tr
    v-if="hasExpansionSlot && isExpanded"
    :data-test="`o2-table-expanded-row-${row.index}`"
    class="bg-table-row-expanded-bg"
  >
    <td
      :colspan="
        row.getVisibleCells().length +
        (expansionEnabled ? 1 : 0) +
        (selectionEnabled ? 1 : 0) +
        (enableRowReorder ? 1 : 0)
      "
      :class="bordered ? 'border-table-row-divider border-b' : ''"
    >
      <slot name="expansion" :row="row.original" />
    </td>
  </tr>
</template>

<style scoped>
/* keep(complex-state): per-row status spine, painted as an inset box-shadow on
   the row's first cell (a `> td:first-child` child-combinator target) — an extra
   <td> would add a phantom column and misalign cells under table-fixed. */
.o2-table-row-with-status > td:first-child {
  box-shadow: inset 0.25rem 0 0 0 var(--row-status-color, transparent);
}

/* keep(generated-content): continuation of the tree connector vertical line
   through the warning row, drawn as an ::after off the inline connector-x var. */
.o2-table-tree-warning-cell::after {
  content: "";
  position: absolute;
  left: var(--tree-connector-x, 0);
  top: 0;
  bottom: 0;
  width: 0.09375rem;
  background-color: var(--color-theme-accent);
  opacity: 0.55;
  z-index: 0;
}
</style>
