<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { HeaderGroup, Table } from "@tanstack/vue-table";
import { FlexRender } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import { PIVOT_TABLE_TOTAL_COLUMN_WIDTH } from "@/utils/dashboard/constants";

const props = defineProps<{
  headerGroups: HeaderGroup<any>[];
  table: Table<any>;
  columnOrder: string[];
  selectionMultiple?: boolean;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
  expansionEnabled?: boolean;
  enableColumnReorder?: boolean;
  enableColumnResize?: boolean;
  isResizing?: boolean;
  sortingEnabled?: boolean;
  sortBy?: string;
  sortOrder?: string;
  sortFieldMap?: Record<string, string>;
  getSortIcon?: (columnId: string) => "asc" | "desc" | "none";
  stickyHeader?: boolean;
  bordered?: boolean;
  pivotHeaderLevels?: any[];
  pivotRowColumns?: any[];
  stickyColTotals?: boolean;
  dense?: boolean;
}>();

const emit = defineEmits<{
  "toggle-all-rows": [];
  sort: [columnId: string];
  "column-close": [columnId: string];
  "update:columnOrder": [order: string[]];
  "drag-start": [event: any];
  "drag-end": [];
}>();

const drag = ref(false);

function handleSort(columnId: string, toggleHandler?: (event: Event) => void, event?: MouseEvent) {
  const meta = (props.table.getColumn(columnId)?.columnDef?.meta as any);
  if (!meta?.sortable) return;
  emit("sort", columnId);
  if (event) toggleHandler?.(event);
}

function handleColumnClose(columnId: string) {
  emit("column-close", columnId);
}

function onResizeStart(event: MouseEvent | TouchEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function handleDragStart(event: any) {
  emit("drag-start", event);
}

function handleDragEnd() {
  emit("drag-end");
}

function isAutoWidthColumn(header: any): boolean {
  return (header.column.columnDef.meta as any)?.autoWidth === true;
}

function headerPaddingClass(header: any): string {
  return (header.column.columnDef.meta as any)?.compactPadding ? 'tw:px-1' : 'tw:px-2';
}

function headerSizeVar(header: any): string {
  return `var(--header-${header.id.replace(/[^a-zA-Z0-9]/g, '-')}-size)`;
}

// ── Pivot helpers ───────────────────────────────────────────────

function getPivotRowColStyle(colId: string): Record<string, any> {
  const col = props.table.getColumn(colId);
  if (!col) return {};
  const leftOffset = col.getStart("left");
  return {
    position: "sticky",
    left: `${leftOffset}px`,
    zIndex: 12,
    boxShadow: leftOffset > 0 ? "2px 0 4px -2px var(--color-border-default)" : "none",
    backgroundColor: "var(--color-table-header-bg)",
  };
}

function getPivotTotalHeaderStyle(cell: any): Record<string, any> {
  if (!props.stickyColTotals || !cell._isTotalHeader) return {};
  const rightOffset = (cell._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  const width = cell.colspan
    ? cell.colspan * PIVOT_TABLE_TOTAL_COLUMN_WIDTH
    : PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  return {
    position: "sticky",
    right: `${rightOffset}px`,
    top: 0,
    zIndex: 11,
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
    backgroundColor: "var(--color-table-header-bg)",
    boxShadow: "-4px 0 8px rgba(0, 0, 0, 0.15)",
  };
}
</script>

<template>
  <!-- ── Pivot multi-level headers (dashboard only) ───────────── -->
  <thead
    v-if="pivotHeaderLevels && pivotHeaderLevels.length > 0"
    class="tw:sticky tw:top-0 tw:z-10"
    data-test="o2-table-pivot-header"
  >
    <tr
      v-for="(level, levelIdx) in pivotHeaderLevels"
      :key="'pivot-hl-' + levelIdx"
      class="tw:h-7"
    >
      <!-- Row-field column headers: first row only, rowspan all levels -->
      <th
        v-if="levelIdx === 0"
        v-for="col in pivotRowColumns"
        :key="'pivot-rh-' + col.id"
        :rowspan="pivotHeaderLevels.length"
        :data-test="`o2-table-pivot-th-${col.id}`"
        class="tw:px-2 tw:text-left tw:cursor-pointer tw:font-medium tw:text-text-secondary tw:text-sm"
        :style="getPivotRowColStyle(col.id)"
        @click="handleSort(col.id)"
      >
        <div class="tw:flex tw:items-center tw:gap-1">
          <FlexRender
            v-if="col.header"
            :render="col.header"
            :props="{}"
          />
          <span v-else>{{ col.label ?? col.id }}</span>
          <q-icon
            v-if="getSortIcon?.(col.id) === 'asc'"
            name="arrow_upward"
            size="0.85rem"
            class="tw:text-[var(--color-table-sort-icon-active)]"
          />
          <q-icon
            v-else-if="getSortIcon?.(col.id) === 'desc'"
            name="arrow_downward"
            size="0.85rem"
            class="tw:text-[var(--color-table-sort-icon-active)]"
          />
          <q-icon
            v-else
            name="unfold_more"
            size="0.85rem"
            class="tw:opacity-40"
          />
        </div>
      </th>

      <!-- Pivot group / value headers -->
      <th
        v-for="(cell, cellIdx) in level.cells"
        :key="'pivot-c-' + levelIdx + '-' + cellIdx"
        :colspan="cell.colspan"
        :rowspan="cell.rowspan || 1"
        :data-test="`o2-table-pivot-th-${levelIdx}-${cellIdx}`"
        class="tw:px-2"
        :class="[
          level.isLeaf
            ? 'pivot-value-header tw:text-text-secondary tw:text-sm'
            : 'pivot-group-header tw:text-center tw:font-medium tw:text-text-secondary tw:text-sm',
          {
            'tw:border-l tw:border-border-default':
              cell.hasBorder && !(stickyColTotals && cell._isTotalHeader),
          },
          {
            'tw:cursor-pointer': cell._sortColumn,
          },
        ]"
        :style="
          stickyColTotals && cell._isTotalHeader
            ? getPivotTotalHeaderStyle(cell)
            : {}
        "
        @click="cell._sortColumn && handleSort(cell._sortColumn)"
      >
        {{ cell.label }}
        <q-icon
          v-if="level.isLeaf && cell._sortColumn && getSortIcon?.(cell._sortColumn) === 'asc'"
          name="arrow_upward"
          size="0.85rem"
          class="tw:text-[var(--color-table-sort-icon-active)] tw:ml-1"
        />
        <q-icon
          v-else-if="level.isLeaf && cell._sortColumn && getSortIcon?.(cell._sortColumn) === 'desc'"
          name="arrow_downward"
          size="0.85rem"
          class="tw:text-[var(--color-table-sort-icon-active)] tw:ml-1"
        />
        <q-icon
          v-else-if="level.isLeaf && cell._sortColumn"
          name="unfold_more"
          size="0.85rem"
          class="tw:opacity-40 tw:ml-1"
        />
      </th>
    </tr>
  </thead>

  <!-- ── Standard TanStack headers (non-pivot) ─────────────────── -->
  <thead
    v-else
    v-for="headerGroup in headerGroups"
    :key="headerGroup.id"
    :class="[
      'tw:bg-[var(--color-table-header-bg)]',
      'tw:border-b tw:border-[var(--color-table-header-border)]',
      stickyHeader ? 'tw:sticky tw:top-0 tw:z-10' : '',
    ]"
    data-test="o2-table-header"
  >
    <!-- Drag-reorder wrapper -->
    <VueDraggable
      v-if="enableColumnReorder"
      :model-value="columnOrder"
      :element="'table'"
      :animation="200"
      :sort="!isResizing"
      handle=".table-head"
      tag="tr"
      :class="[
        columnOrder.length > 1 ? 'tw:cursor-move' : '',
      ]"
      :style="{
        minWidth: '100%',
      }"
      @start="handleDragStart"
      @end="handleDragEnd"
      @update:model-value="(val: string[]) => emit('update:columnOrder', val)"
    >
      <!-- Expand placeholder -->
      <th
        v-if="expansionEnabled"
        class="tw:w-0 tw:px-0 tw:border-b tw:border-[var(--color-table-header-border)]"
        data-test="o2-table-th-expand"
      />

      <!-- Selection checkbox header -->
      <th
        v-if="selectionMultiple"
        class="tw:w-9 tw:border-b tw:border-[var(--color-table-header-border)]"
        data-test="o2-table-th-select"
      >
        <OTableSelectCheckbox
          :model-value="isAllSelected ?? false"
          :indeterminate="isIndeterminate ?? false"
          row-id="all"
          @update:model-value="emit('toggle-all-rows')"
        />
      </th>

      <!-- Column headers -->
      <th
        v-for="header in headerGroup.headers"
        :key="header.id"
        :colspan="header.colSpan"
        :rowspan="header.rowSpan"
        :data-test="`o2-table-th-${header.id}`"
        :class="[
          `${headerPaddingClass(header)} tw:text-left tw:font-semibold tw:text-text-secondary tw:text-xs tw:select-none tw:relative`,
          'table-head',
          dense ? 'tw:h-6' : 'tw:h-7',
          'tw:border-b tw:border-[var(--color-table-header-border)]',
          'tw:group',
          header.column.getIsPinned?.() ? 'tw:bg-[var(--color-table-header-bg)]' : '',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          ...(isAutoWidthColumn(header) ? {} : { width: headerSizeVar(header), maxWidth: headerSizeVar(header) }),
          ...(header.column.getIsPinned?.() === 'left'
            ? {
                position: 'sticky',
                left: `${header.column.getStart?.('left') ?? 0}px`,
                zIndex: 20,
                boxShadow: '2px 0 4px -2px var(--color-border-default)',
              }
            : {}),
          ...(header.column.getIsPinned?.() === 'right'
            ? {
                position: 'sticky',
                right: `${header.column.getAfter?.('right') ?? 0}px`,
                zIndex: 20,
                boxShadow: '-2px 0 4px -2px var(--color-border-default)',
              }
            : {}),
        }"
      >
        <div class="tw:flex tw:items-center tw:gap-1 tw:h-full">
          <!-- Sortable header -->
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:flex-1 tw:overflow-hidden"
            data-test="o2-table-th-sort-trigger"
            @click="(e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)"
          >
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
            <!-- Sort icons -->
            <template v-if="sortingEnabled && (header.column.columnDef.meta as any)?.sortable">
              <q-icon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow_upward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow_downward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else
                name="unfold_more"
                size="0.85rem"
                class="tw:opacity-40"
                data-test="o2-table-sort-icon-inactive"
              />
            </template>
          </div>

          <!-- Non-sortable header -->
          <div v-else class="tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>

          <!-- Close column button (visible on header hover) -->
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-close-${header.id}`"
            class="tw:opacity-0 group-hover:tw:opacity-100 tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-text-secondary tw:hover:text-text-primary tw:p-0 tw:leading-none tw:transition-opacity"
            @click.stop="handleColumnClose(header.id)"
          >
            <q-icon name="cancel" size="1rem" />
          </button>
        </div>

        <!-- Column resize handle -->
        <div
          v-if="header.column.getCanResize()"
          :class="[
            'resizer',
            'tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-1 tw:cursor-col-resize tw:hover:bg-[var(--color-table-resize-handle)] tw:hover:opacity-100 tw:opacity-0 tw:transition-opacity',
            header.column.getIsResizing() ? 'isResizing tw:bg-[var(--color-table-resize-handle)]!' : '',
          ]"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="header.getResizeHandler()?.($event)"
          @touchstart.prevent.stop="header.getResizeHandler()?.($event)"
        />
      </th>
    </VueDraggable>

    <!-- Non-draggable header (when reorder disabled) -->
    <tr v-if="!enableColumnReorder">
      <th
        v-if="expansionEnabled"
        class="tw:w-0 tw:px-0 tw:border-b tw:border-[var(--color-table-header-border)]"
        data-test="o2-table-th-expand"
      />
      <th
        v-if="selectionMultiple"
        class="tw:w-9 tw:border-b tw:border-[var(--color-table-header-border)]"
        data-test="o2-table-th-select"
      >
        <OTableSelectCheckbox
          :model-value="isAllSelected ?? false"
          :indeterminate="isIndeterminate ?? false"
          row-id="all"
          @update:model-value="emit('toggle-all-rows')"
        />
      </th>
      <th
        v-for="header in headerGroup.headers"
        :key="header.id"
        :data-test="`o2-table-th-${header.id}`"
        :class="[
          `${headerPaddingClass(header)} tw:text-left tw:font-semibold tw:text-text-secondary tw:text-xs tw:select-none tw:relative`,
          dense ? 'tw:h-7 tw:group' : 'tw:h-8 tw:group',
          'tw:border-b tw:border-[var(--color-table-header-border)]',
          header.column.getIsPinned?.() ? 'tw:bg-[var(--color-table-header-bg)]' : '',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          ...(isAutoWidthColumn(header) ? {} : { width: headerSizeVar(header), maxWidth: headerSizeVar(header) }),
          ...(header.column.getIsPinned?.() === 'left'
            ? {
                position: 'sticky',
                left: `${header.column.getStart?.('left') ?? 0}px`,
                zIndex: 20,
                boxShadow: '2px 0 4px -2px var(--color-border-default)',
              }
            : {}),
          ...(header.column.getIsPinned?.() === 'right'
            ? {
                position: 'sticky',
                right: `${header.column.getAfter?.('right') ?? 0}px`,
                zIndex: 20,
                boxShadow: '-2px 0 4px -2px var(--color-border-default)',
              }
            : {}),
        }"
      >
        <div class="tw:flex tw:items-center tw:gap-1 tw:h-full">
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:flex-1 tw:overflow-hidden"
            data-test="o2-table-th-sort-trigger"
            @click="(e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)"
          >
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
            <template v-if="sortingEnabled && (header.column.columnDef.meta as any)?.sortable">
              <q-icon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow_upward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow_downward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else
                name="unfold_more"
                size="0.85rem"
                class="tw:opacity-40"
                data-test="o2-table-sort-icon-inactive"
              />
            </template>
          </div>
          <div v-else class="tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-close-${header.id}`"
            class="tw:opacity-0 group-hover:tw:opacity-100 tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-text-secondary tw:hover:text-text-primary tw:p-0 tw:leading-none tw:transition-opacity"
            @click.stop="handleColumnClose(header.id)"
          >
            <q-icon name="cancel" size="1rem" />
          </button>
        </div>
        <div
          v-if="header.column.getCanResize()"
          :class="[
            'resizer',
            'tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-1 tw:cursor-col-resize tw:hover:bg-[var(--color-table-resize-handle)] tw:hover:opacity-100 tw:opacity-0 tw:transition-opacity',
            header.column.getIsResizing() ? 'isResizing tw:bg-[var(--color-table-resize-handle)]!' : '',
          ]"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="header.getResizeHandler()?.($event)"
          @touchstart.prevent.stop="header.getResizeHandler()?.($event)"
        />
      </th>
    </tr>
  </thead>
</template>
