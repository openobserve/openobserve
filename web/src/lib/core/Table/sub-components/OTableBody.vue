<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import { useSlots } from "vue";
import OTableBodyRow from "./OTableBodyRow.vue";

const props = defineProps<{
  rows: Row<any>[];
  table: Table<any>;
  selectionEnabled?: boolean;
  selectionMultiple?: boolean;
  isRowSelectedFn?: (row: any) => boolean;
  expansionEnabled?: boolean;
  isExpandedFn?: (row: any) => boolean;
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
  /** Virtual scroll: virtual items from useTableVirtualization */
  virtualRows?: { index: number; start: number; size: number; key: number }[];
  /** Virtual scroll: total height of the virtual container */
  totalSize?: number;
  /** Virtual scroll: base offset for Firefox compatibility */
  baseOffset?: number;
  /** Virtual scroll: ref callback for measuring elements */
  measureElement?: (el: any) => void;
  /** Status bar color function per row */
  getStatusBarColor?: (row: any) => string | undefined;
  /** Enable click-to-copy on cell values */
  enableCellCopy?: boolean;
  /** Per-cell inline style function */
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

const isVirtual = () => !!(props.virtualRows && props.virtualRows.length > 0);

function getRowForIndex(index: number) {
  return props.rows[index];
}
</script>

<template>
  <!-- Normal (non-virtual) body -->
  <tbody
    v-if="!isVirtual()"
    data-test="o2-table-body"
  >
    <OTableBodyRow
      v-for="row in rows"
      :key="row.id"
      :row="row"
      :table="table"
      :selection-enabled="selectionEnabled"
      :selection-multiple="selectionMultiple"
      :is-row-selected="isRowSelectedFn?.(row.original)"
      :expansion-enabled="expansionEnabled"
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
      @toggle-selection="emit('toggle-selection', $event)"
      @toggle-expansion="emit('toggle-expansion', $event)"
      @row-click="(row: any, evt: MouseEvent) => emit('row-click', row, evt)"
      @row-dblclick="(row: any, evt: MouseEvent) => emit('row-dblclick', row, evt)"
      @cell-click="emit('cell-click', $event)"
    >
      <!-- Pass through named cell slots from parent -->
      <template
        v-for="(_, slotName) in slots"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps" />
      </template>
      <template v-if="slots.expansion" #expansion="expSlotProps">
        <slot name="expansion" v-bind="expSlotProps" />
      </template>
    </OTableBodyRow>
  </tbody>

  <!-- Virtual scroll body -->
  <tbody
    v-else
    data-test="o2-table-body"
    class="tw:relative"
  >
    <!-- Spacer for total scroll height -->
    <tr v-if="totalSize" aria-hidden="true">
      <td :style="{ height: `${totalSize}px` }" />
    </tr>

    <OTableBodyRow
      v-for="virtualRow in virtualRows"
      :key="virtualRow.key"
      :row="getRowForIndex(virtualRow.index)"
      :measure-el="measureElement"
      :table="table"
      :selection-enabled="selectionEnabled"
      :selection-multiple="selectionMultiple"
      :is-row-selected="isRowSelectedFn?.(getRowForIndex(virtualRow.index)?.original)"
      :expansion-enabled="expansionEnabled"
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
      :row-style-fn="(row: any) => ({
        ...(rowStyleFn?.(row) ?? {}),
        position: 'absolute',
        top: '0',
        transform: `translateY(${virtualRow.start + (baseOffset ?? 0)}px)`,
      })"
      @toggle-selection="emit('toggle-selection', $event)"
      @toggle-expansion="emit('toggle-expansion', $event)"
      @row-click="(row: any, evt: MouseEvent) => emit('row-click', row, evt)"
      @row-dblclick="(row: any, evt: MouseEvent) => emit('row-dblclick', row, evt)"
      @cell-click="emit('cell-click', $event)"
    >
      <template
        v-for="(_, slotName) in slots"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps" />
      </template>
      <template v-if="slots.expansion" #expansion="expSlotProps">
        <slot name="expansion" v-bind="expSlotProps" />
      </template>
    </OTableBodyRow>
  </tbody>
</template>
