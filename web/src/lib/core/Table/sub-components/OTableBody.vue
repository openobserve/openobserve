<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import OTableBodyRow from "./OTableBodyRow.vue";

defineProps<{
  rows: Row<any>[];
  table: Table<any>;
  selectionEnabled?: boolean;
  selectionMultiple?: boolean;
  isRowSelectedFn?: (row: any) => boolean;
  expansionEnabled?: boolean;
  isExpandedFn?: (row: any) => boolean;
  highlightText?: string;
  shouldHighlightColumn?: (columnId: string) => boolean;
  wrap?: boolean;
  dense?: boolean;
  bordered?: boolean;
  striped?: boolean;
  rowClass?: string | ((row: any) => string);
  rowStyleFn?: (row: any) => Record<string, any>;
  loading?: boolean;
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
</script>

<template>
  <tbody data-test="o2-table-body">
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
      :wrap="wrap"
      :dense="dense"
      :bordered="bordered"
      :striped="striped"
      :row-class-fn="rowClass"
      :row-style-fn="rowStyleFn"
      @toggle-selection="emit('toggle-selection', $event)"
      @toggle-expansion="emit('toggle-expansion', $event)"
      @row-click="emit('row-click', $event[0], $event[1])"
      @row-dblclick="emit('row-dblclick', $event[0], $event[1])"
      @cell-click="emit('cell-click', $event)"
    >
      <!-- Pass through cell slots from parent -->
      <template
        v-for="(_, slotName) in $slots"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps" />
      </template>
    </OTableBodyRow>

    <!-- Expansion row: shown below each expanded row -->
    <!-- (handled by parent via slots for now) -->
  </tbody>
</template>
