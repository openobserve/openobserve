<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import { computed, ref, watch, useSlots } from "vue";
import OTableBodyRow from "./OTableBodyRow.vue";
import { VueDraggableNext } from "vue-draggable-next";

const props = defineProps<{
  rows: Row<any>[];
  table: Table<any>;
  clickable?: boolean;
  selectionEnabled?: boolean;
  selectionMultiple?: boolean;
  isRowSelectedFn?: (row: any) => boolean;
  /** When provided, rows for which this returns false render a disabled
   *  (not-allowed cursor) selection checkbox. Forwarded to OTableBodyRow. */
  isRowSelectable?: (row: any) => boolean;
  expansionEnabled?: boolean;
  isExpandedFn?: (row: any) => boolean;
  getRowExpansionEnabled?: (row: any) => boolean;
  highlightText?: string;
  shouldHighlightColumn?: (columnId: string) => boolean;
  getHighlightedHtml?: (columnId: string, cellValue: any) => string | null;
  wrap?: boolean;
  dense?: boolean;
  bordered?: boolean;
  striped?: boolean;
  rowClass?: string | ((row: any) => string);
  rowStyleFn?: (row: any) => Record<string, any>;
  loading?: boolean;
  /** Enable drag-and-drop row reordering. */
  enableRowReorder?: boolean;
  /** Per-row predicate disabling drag for that row. */
  disableRowReorder?: (row: any) => boolean;
  /** When true, the global filter is active — drag is auto-disabled. */
  globalFilterActive?: boolean;
  /** Unique row identifier field (used as VueDraggableNext item-key). */
  rowKey?: string;
  /** Virtual scroll: virtual items from useTableVirtualization */
  virtualRows?: {
    index: number;
    start: number;
    size: number;
    key: number | string | bigint;
  }[];
  /** Virtual scroll: total height of the virtual container */
  totalSize?: number;
  /** Virtual scroll: base offset for Firefox compatibility */
  baseOffset?: number;
  /** Virtual scroll: ref callback for measuring elements */
  measureElement?: (el: any) => void;
  /** Variable-height mode (G8): ref callback each row invokes so the virtualizer
   *  measures its real DOM height. Only supplied when the table wraps content. */
  measureRowElement?: (el: Element | null) => void;
  /** Variable-height mode flag (G8) — drives per-row measurement + data-index. */
  dynamicRowHeight?: boolean;
  /** Status bar color function per row */
  getStatusBarColor?: (row: any) => string | undefined;
  /** Enable click-to-copy on cell values */
  enableCellCopy?: boolean;
  /** Per-cell inline style function */
  getCellStyle?: (params: { columnId: string; row: any; value: any }) => Record<string, any>;
  /** Pivot row-field cell merge (G17): returns hide flags for a merged cell. */
  getPivotMerge?: (
    row: any,
    columnId: string,
  ) => { hideContent: boolean; hideBorder: boolean } | null;
}>();

const emit = defineEmits<{
  "toggle-selection": [row: any];
  "toggle-expansion": [row: any];
  "row-click": [row: any, event: MouseEvent];
  "row-dblclick": [row: any, event: MouseEvent];
  "row-mouseenter": [row: any, event: MouseEvent];
  "row-mouseleave": [row: any];
  "cell-click": [params: { columnId: string; row: any; value: any }];
  "row-reorder": [data: any[]];
}>();

const slots = useSlots();

// When every row's disableRowReorder returns true, fall back to non-draggable body
const allRowsDisabled = computed(() => {
  if (!props.disableRowReorder || !props.rows.length) return false;
  return props.rows.every((r) => props.disableRowReorder!(r.original));
});

const rowReorderEnabled = computed(
  () => props.enableRowReorder && !props.globalFilterActive && !allRowsDisabled.value,
);

// ── Row reorder state ──────────────────────────────────────────────

// Local working copy synced from rows — suppressed during drag
const draggableModel = ref<any[]>([]);
const isDragging = ref(false);

watch(
  () => props.rows,
  (rows) => {
    if (isDragging.value) return;
    draggableModel.value = rows.map((r) => r.original);
  },
  { immediate: true },
);

// Map original data → TanStack Row for rendering inside the draggable
const rowByOriginal = computed(() => {
  const map = new Map<any, Row<any>>();
  for (const r of props.rows) {
    map.set(r.original, r);
  }
  return map;
});

function onDragStart() {
  isDragging.value = true;
}

function onDragEnd() {
  isDragging.value = false;
  emit("row-reorder", [...draggableModel.value]);
}

function isRowDraggable(row: any): boolean {
  if (props.disableRowReorder) return !props.disableRowReorder(row);
  return true;
}

const isVirtual = () => !!(props.virtualRows && props.virtualRows.length > 0);

function getRowForIndex(index: number) {
  return props.rows[index];
}

/** Get the TanStack Row from a draggable model item (plain data). */
function getRowForItem(item: any): Row<any> {
  return rowByOriginal.value.get(item) ?? props.rows[0];
}
</script>

<template>
  <!-- Normal draggable body -->
  <VueDraggableNext
    v-if="!isVirtual() && rowReorderEnabled"
    v-model="draggableModel"
    :item-key="rowKey || 'id'"
    tag="tbody"
    handle="[data-test='o2-table-row-drag-handle']"
    :animation="200"
    ghost-class="o2-table-drag-ghost"
    drag-class="o2-table-drag-dragging"
    data-test="o2-table-body"
    @start="onDragStart"
    @end="onDragEnd"
  >
    <OTableBodyRow
      v-for="item in draggableModel"
      :key="item.id ?? draggableModel.indexOf(item)"
      :row="getRowForItem(item)"
      :table="table"
      :clickable="clickable"
      :selection-enabled="selectionEnabled"
      :selection-multiple="selectionMultiple"
      :is-row-selected="isRowSelectedFn?.(item)"
      :is-row-selectable="isRowSelectable"
      :expansion-enabled="expansionEnabled"
      :can-expand="getRowExpansionEnabled ? getRowExpansionEnabled(item) : true"
      :is-expanded="isExpandedFn?.(item)"
      :highlight-text="highlightText"
      :should-highlight-column="shouldHighlightColumn"
      :get-highlighted-html="getHighlightedHtml"
      :wrap="wrap"
      :dense="dense"
      :bordered="bordered"
      :striped="striped"
      :row-class-fn="rowClass"
      :row-style-fn="rowStyleFn"
      :status-bar-color="getStatusBarColor?.(item)"
      :enable-cell-copy="enableCellCopy"
      :get-cell-style="getCellStyle"
      :get-pivot-merge="getPivotMerge"
      :enable-row-reorder="true"
      :row-draggable="isRowDraggable(item)"
      @toggle-selection="emit('toggle-selection', $event)"
      @toggle-expansion="emit('toggle-expansion', $event)"
      @row-click="(row: any, evt: MouseEvent) => emit('row-click', row, evt)"
      @row-dblclick="(row: any, evt: MouseEvent) => emit('row-dblclick', row, evt)"
      @row-mouseenter="(row: any, evt: MouseEvent) => emit('row-mouseenter', row, evt)"
      @row-mouseleave="(row: any) => emit('row-mouseleave', row)"
      @cell-click="emit('cell-click', $event)"
    >
      <!-- Pass through named cell slots from parent -->
      <template v-for="(_, slotName) in slots" :key="slotName" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps" />
      </template>
      <template v-if="slots.expansion" #expansion="expSlotProps">
        <slot name="expansion" v-bind="expSlotProps" />
      </template>
    </OTableBodyRow>
  </VueDraggableNext>

  <!-- Normal (non-virtual, non-draggable) body -->
  <tbody v-else-if="!isVirtual()" data-test="o2-table-body">
    <OTableBodyRow
      v-for="row in rows"
      :key="row.id"
      :row="row"
      :table="table"
      :clickable="clickable"
      :selection-enabled="selectionEnabled"
      :selection-multiple="selectionMultiple"
      :is-row-selected="isRowSelectedFn?.(row.original)"
      :is-row-selectable="isRowSelectable"
      :expansion-enabled="expansionEnabled"
      :can-expand="getRowExpansionEnabled ? getRowExpansionEnabled(row.original) : true"
      :is-expanded="isExpandedFn?.(row.original)"
      :highlight-text="highlightText"
      :should-highlight-column="shouldHighlightColumn"
      :get-highlighted-html="getHighlightedHtml"
      :wrap="wrap"
      :dense="dense"
      :bordered="bordered"
      :striped="striped"
      :row-class-fn="rowClass"
      :row-style-fn="rowStyleFn"
      :status-bar-color="getStatusBarColor?.(row.original)"
      :enable-cell-copy="enableCellCopy"
      :get-cell-style="getCellStyle"
      :get-pivot-merge="getPivotMerge"
      :enable-row-reorder="props.enableRowReorder"
      :row-draggable="false"
      @toggle-selection="emit('toggle-selection', $event)"
      @toggle-expansion="emit('toggle-expansion', $event)"
      @row-click="(row: any, evt: MouseEvent) => emit('row-click', row, evt)"
      @row-dblclick="(row: any, evt: MouseEvent) => emit('row-dblclick', row, evt)"
      @row-mouseenter="(row: any, evt: MouseEvent) => emit('row-mouseenter', row, evt)"
      @row-mouseleave="(row: any) => emit('row-mouseleave', row)"
      @cell-click="emit('cell-click', $event)"
    >
      <!-- Pass through named cell slots from parent -->
      <template v-for="(_, slotName) in slots" :key="slotName" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps" />
      </template>
      <template v-if="slots.expansion" #expansion="expSlotProps">
        <slot name="expansion" v-bind="expSlotProps" />
      </template>
    </OTableBodyRow>
  </tbody>

  <!-- Virtual scroll body: rows stay in flow; top/bottom spacer rows
       reserve the offset above first and below last visible row so cells
       inherit the parent table's column layout (same as non-virtual). -->
  <tbody v-else data-test="o2-table-body">
    <tr v-if="virtualRows && virtualRows.length && virtualRows[0].start > 0" aria-hidden="true">
      <td
        :style="{ height: `${virtualRows[0].start + (baseOffset ?? 0)}px`, padding: 0, border: 0 }"
      />
    </tr>

    <OTableBodyRow
      v-for="virtualRow in virtualRows"
      :key="virtualRow.key as string | number"
      :row="getRowForIndex(virtualRow.index)"
      :measure-el="measureElement"
      :measure-row-element="measureRowElement"
      :dynamic-row-height="dynamicRowHeight"
      :virtual-index="virtualRow.index"
      :table="table"
      :clickable="clickable"
      :selection-enabled="selectionEnabled"
      :selection-multiple="selectionMultiple"
      :is-row-selected="isRowSelectedFn?.(getRowForIndex(virtualRow.index)?.original)"
      :is-row-selectable="isRowSelectable"
      :expansion-enabled="expansionEnabled"
      :can-expand="
        getRowExpansionEnabled
          ? getRowExpansionEnabled(getRowForIndex(virtualRow.index)?.original)
          : true
      "
      :is-expanded="isExpandedFn?.(getRowForIndex(virtualRow.index)?.original)"
      :highlight-text="highlightText"
      :should-highlight-column="shouldHighlightColumn"
      :get-highlighted-html="getHighlightedHtml"
      :wrap="wrap"
      :dense="dense"
      :bordered="bordered"
      :striped="striped"
      :row-class-fn="rowClass"
      :status-bar-color="getStatusBarColor?.(getRowForIndex(virtualRow.index)?.original)"
      :enable-cell-copy="enableCellCopy"
      :get-cell-style="getCellStyle"
      :get-pivot-merge="getPivotMerge"
      :row-style-fn="rowStyleFn"
      @toggle-selection="emit('toggle-selection', $event)"
      @toggle-expansion="emit('toggle-expansion', $event)"
      @row-click="(row: any, evt: MouseEvent) => emit('row-click', row, evt)"
      @row-dblclick="(row: any, evt: MouseEvent) => emit('row-dblclick', row, evt)"
      @row-mouseenter="(row: any, evt: MouseEvent) => emit('row-mouseenter', row, evt)"
      @row-mouseleave="(row: any) => emit('row-mouseleave', row)"
      @cell-click="emit('cell-click', $event)"
    >
      <template v-for="(_, slotName) in slots" :key="slotName" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps" />
      </template>
      <template v-if="slots.expansion" #expansion="expSlotProps">
        <slot name="expansion" v-bind="expSlotProps" />
      </template>
    </OTableBodyRow>

    <tr v-if="virtualRows && virtualRows.length && totalSize" aria-hidden="true">
      <td
        :style="{
          height: `${Math.max(0, totalSize - (virtualRows[virtualRows.length - 1].start + virtualRows[virtualRows.length - 1].size))}px`,
          padding: 0,
          border: 0,
        }"
      />
    </tr>
  </tbody>
</template>

<style scoped>
/* keep(third-party): VueDraggableNext applies these classes to row clones at
   RUNTIME (ghost / dragging); no template ever writes them, so they cannot be
   utilities. Scoped still matches — the clones keep the row's data-v attr. */
.o2-table-drag-ghost {
  opacity: 0.3;
  background: var(--color-primary-50);
  border: 1px dashed var(--color-accent);
  border-radius: 0.375rem;
}
.o2-table-drag-dragging {
  opacity: 0.5;
  box-shadow: var(--shadow-lg);
}
</style>
