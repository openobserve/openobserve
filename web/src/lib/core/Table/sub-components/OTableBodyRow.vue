<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import { computed, ref, onMounted, watch, useSlots } from "vue";
import OTableBodyCell from "./OTableBodyCell.vue";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import OTableExpandButton from "./OTableExpandButton.vue";

const props = defineProps<{
  row: Row<any>;
  table: Table<any>;
  selectionEnabled?: boolean;
  selectionMultiple?: boolean;
  isRowSelected?: boolean;
  expansionEnabled?: boolean;
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
      'tw:transition-colors tw:duration-150',
      'tw:hover:bg-[var(--color-table-row-hover-bg)]',
      isRowSelected
        ? 'tw:bg-[var(--color-table-row-selected-bg)]'
        : '',
      !isRowSelected && isStriped
        ? 'tw:bg-[var(--color-table-row-striped-bg)]'
        : '',
      rowClass,
    ]"
    :style="rowStyle"
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
      :class="['tw:w-0 tw:px-0 tw:align-middle', bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : '']"
      data-test="o2-table-expand-cell"
    >
      <OTableExpandButton
        :expanded="isExpanded ?? false"
        :row-id="String(row.index)"
        @toggle="emit('toggle-expansion', row.original)"
      />
    </td>

    <!-- Selection checkbox cell -->
    <td
      v-if="selectionEnabled"
      :class="['tw:w-9 tw:align-middle', bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : '']"
      data-test="o2-table-select-cell"
    >
      <OTableSelectCheckbox
        :model-value="isRowSelected ?? false"
        :row-id="String(row.index)"
        @update:model-value="emit('toggle-selection', row.original)"
      />
    </td>

    <!-- Data cells -->
    <OTableBodyCell
      v-for="cell in row.getVisibleCells()"
      :key="cell.id"
      :cell="cell"
      :row="row"
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
