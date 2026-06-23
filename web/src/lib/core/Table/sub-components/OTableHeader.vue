<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { HeaderGroup, Table } from "@tanstack/vue-table";
import { FlexRender } from "@tanstack/vue-table";
import { computed, inject, ref } from "vue";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { PIVOT_TABLE_TOTAL_COLUMN_WIDTH } from "@/utils/dashboard/constants";
import { TABLE_CHECKBOX_COL_SIZE as TABLE_CHECKBOX_COL_WIDTH, TABLE_CHECKBOX_COL_PAD_LEFT } from "../OTable.types";

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
  "update:columnOrder": [order: string[]];
  "drag-start": [event: any];
  "drag-end": [];
  "resize-start": [];
}>();

// Notify the parent BEFORE the resize begins so it can freeze any flex columns
// synchronously (write their current widths into column sizing). This must run
// before TanStack captures the drag start state, otherwise the flex column
// would keep absorbing — shrinking — as the dragged column grows.
function startResize(header: any, event: MouseEvent | TouchEvent) {
  emit("resize-start");
  header.getResizeHandler()?.(event);
}

const drag = ref(false);

const horizontalScroll = inject<{ value: boolean } | null>(
  "o2TableHorizontalScroll",
  null,
);

function handleSort(columnId: string, toggleHandler?: (event: Event) => void, event?: MouseEvent) {
  const meta = (props.table.getColumn(columnId)?.columnDef?.meta as any);
  if (!meta?.sortable) return;
  emit("sort", columnId);
  if (event) toggleHandler?.(event);
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

function headerAlignClass(header: any): string {
  const align = (header.column.columnDef.meta as any)?.align;
  if (align === 'center') return 'tw:text-center tw:justify-center';
  if (align === 'right') return 'tw:text-right tw:justify-end';
  return '';
}

function headerPaddingClass(header: any): string {
  const m = header.column.columnDef.meta as any;
  if (m?.spacer) return 'tw:px-0'; // the invisible spacer must be able to reach 0 width
  return m?.compactPadding ? 'tw:px-1' : 'tw:px-2';
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
        class="tw:px-2 tw:text-left tw:cursor-pointer tw:font-medium tw:text-secondary tw:text-xs"
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
          <OIcon
            v-if="getSortIcon?.(col.id) === 'asc'"
            name="arrow-upward"
            size="sm"
            class="tw:text-[var(--color-table-sort-icon-active)]"
          />
          <OIcon
            v-else-if="getSortIcon?.(col.id) === 'desc'"
            name="arrow-downward"
            size="sm"
            class="tw:text-[var(--color-table-sort-icon-active)]"
          />
          <OIcon
            v-else
            name="unfold-more"
            size="sm"
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
            ? 'pivot-value-header tw:text-secondary tw:text-xs tw:font-medium'
            : 'pivot-group-header tw:text-center tw:font-medium tw:text-secondary tw:text-xs',
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
        <OIcon
          v-if="level.isLeaf && cell._sortColumn && getSortIcon?.(cell._sortColumn) === 'asc'"
          name="arrow-upward"
          size="sm"
          class="tw:text-[var(--color-table-sort-icon-active)] tw:ml-1"
        />
        <OIcon
          v-else-if="level.isLeaf && cell._sortColumn && getSortIcon?.(cell._sortColumn) === 'desc'"
          name="arrow-downward"
          size="sm"
          class="tw:text-[var(--color-table-sort-icon-active)] tw:ml-1"
        />
        <OIcon
          v-else-if="level.isLeaf && cell._sortColumn"
          name="unfold-more"
          size="sm"
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
        'tw:bg-[var(--color-table-header-bg)]',
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
        class="tw:w-4 tw:min-w-4 tw:px-0 tw:border-b tw:border-[var(--color-table-header-border)]"
        data-test="o2-table-th-expand"
      />

      <!-- Selection checkbox header -->
      <th
        v-if="selectionMultiple"
        class="tw:text-left tw:border-b tw:border-[var(--color-table-header-border)]"
        :style="{ width: TABLE_CHECKBOX_COL_WIDTH + 'px', minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px', maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px', paddingLeft: TABLE_CHECKBOX_COL_PAD_LEFT + 'px' }"
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
          `${headerPaddingClass(header)} tw:text-left tw:font-medium tw:text-table-header-text tw:text-xs tw:select-none tw:relative`,
          'table-head',
          dense ? 'tw:h-8' : 'tw:h-9',
          'tw:border-b tw:border-[var(--color-table-header-border)]',
          'tw:group',
          header.column.getIsPinned?.() ? 'tw:bg-[var(--color-table-header-bg)]' : '',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          ...(isAutoWidthColumn(header)
            ? (header.column.columnDef.minSize ? { minWidth: `${header.column.columnDef.minSize}px` } : {})
            : (header.column.columnDef.meta as any)?.fixedWidth
              ? { width: headerSizeVar(header), minWidth: headerSizeVar(header), maxWidth: headerSizeVar(header) }
              : (horizontalScroll?.value ? { width: headerSizeVar(header) } : { width: headerSizeVar(header), maxWidth: headerSizeVar(header) })),
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
        <div :class="['tw:flex tw:items-center tw:gap-1 tw:h-full tw:overflow-hidden tw:min-w-0', headerAlignClass(header)]">
          <!-- Sortable header -->
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:gap-1 tw:cursor-pointer tw:flex-1 tw:min-w-0"
            :style="{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center' }"
            data-test="o2-table-th-sort-trigger"
            @click="(e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)"
          >
            <span class="tw:truncate tw:min-w-0">
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </span>
            <!-- Sort icons — in the grid's `auto` track, so never clipped even
                 when the header title truncates. -->
            <span
              v-if="sortingEnabled && (header.column.columnDef.meta as any)?.sortable"
              class="tw:flex tw:items-center"
            >
              <OIcon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow-upward"
                size="sm"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <OIcon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow-downward"
                size="sm"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <OIcon
                v-else
                name="unfold-more"
                size="sm"
                class="tw:opacity-40"
                data-test="o2-table-sort-icon-inactive"
              />
            </span>
          </div>

          <!-- Non-sortable header -->
          <div v-else :class="['tw:flex-1 tw:min-w-0 tw:truncate', headerAlignClass(header)]">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>

        </div>

        <!-- Column resize handle -->
        <div
          v-if="header.column.getCanResize()"
          class="resizer tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-2 tw:flex tw:items-center tw:justify-end tw:cursor-col-resize tw:select-none tw:touch-none tw:z-10 tw:group/resizer"
          :title="'Drag to resize · double-click to reset'"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="startResize(header, $event)"
          @touchstart.prevent.stop="startResize(header, $event)"
        >
          <!-- A short, rounded, vertically-inset handle: a subtle divider by
               default, the accent (full-height) while hovering it or resizing. -->
          <div
            :class="[
              'tw:rounded-full tw:transition-all tw:duration-150',
              header.column.getIsResizing()
                ? 'tw:w-0.5 tw:h-full tw:bg-[var(--color-table-resize-handle)]'
                : 'tw:w-px tw:h-4 tw:bg-[var(--color-border-default)] group-hover/resizer:tw:w-0.5 group-hover/resizer:tw:h-full group-hover/resizer:tw:bg-[var(--color-table-resize-handle)]',
            ]"
          />
        </div>
      </th>
    </VueDraggable>

    <!-- Non-draggable header (when reorder disabled).
         The white background lives on the <tr> (not just the <thead>) because in
         border-separate tables — used whenever a column is pinned/isAction — the
         row-group (<thead>) background does not paint, leaving the header grey
         while the toolbar <div> stays white. -->
    <tr
      v-if="!enableColumnReorder"
      class="tw:bg-[var(--color-table-header-bg)]"
    >
      <th
        v-if="expansionEnabled"
        class="tw:w-4 tw:min-w-4 tw:px-0 tw:border-b tw:border-[var(--color-table-header-border)]"
        data-test="o2-table-th-expand"
      />
      <th
        v-if="selectionMultiple"
        class="tw:text-left tw:border-b tw:border-[var(--color-table-header-border)]"
        :style="{ width: TABLE_CHECKBOX_COL_WIDTH + 'px', minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px', maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px', paddingLeft: TABLE_CHECKBOX_COL_PAD_LEFT + 'px' }"
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
          `${headerPaddingClass(header)} tw:text-left tw:font-medium tw:text-table-header-text tw:text-xs tw:select-none tw:relative`,
          dense ? 'tw:h-8 tw:group' : 'tw:h-9 tw:group',
          'tw:border-b tw:border-[var(--color-table-header-border)]',
          header.column.getIsPinned?.() ? 'tw:bg-[var(--color-table-header-bg)]' : '',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          ...(isAutoWidthColumn(header)
            ? (header.column.columnDef.minSize ? { minWidth: `${header.column.columnDef.minSize}px` } : {})
            : (header.column.columnDef.meta as any)?.fixedWidth
              ? { width: headerSizeVar(header), minWidth: headerSizeVar(header), maxWidth: headerSizeVar(header) }
              : (horizontalScroll?.value ? { width: headerSizeVar(header) } : { width: headerSizeVar(header), maxWidth: headerSizeVar(header) })),
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
        <div :class="['tw:flex tw:items-center tw:gap-1 tw:h-full tw:overflow-hidden tw:min-w-0', headerAlignClass(header)]">
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:flex-1 tw:overflow-hidden tw:whitespace-nowrap"
            data-test="o2-table-th-sort-trigger"
            @click="(e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)"
          >
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
            <template v-if="sortingEnabled && (header.column.columnDef.meta as any)?.sortable">
              <OIcon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow-upward"
                size="sm"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <OIcon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow-downward"
                size="sm"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <OIcon
                v-else
                name="unfold-more"
                size="sm"
                class="tw:opacity-40"
                data-test="o2-table-sort-icon-inactive"
              />
            </template>
          </div>
          <div v-else :class="['tw:flex-1 tw:min-w-0 tw:truncate', headerAlignClass(header)]">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>
        </div>
        <div
          v-if="header.column.getCanResize()"
          class="resizer tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-2 tw:flex tw:items-center tw:justify-end tw:cursor-col-resize tw:select-none tw:touch-none tw:z-10 tw:group/resizer"
          :title="'Drag to resize · double-click to reset'"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="startResize(header, $event)"
          @touchstart.prevent.stop="startResize(header, $event)"
        >
          <!-- A short, rounded, vertically-inset handle: a subtle divider by
               default, the accent (full-height) while hovering it or resizing. -->
          <div
            :class="[
              'tw:rounded-full tw:transition-all tw:duration-150',
              header.column.getIsResizing()
                ? 'tw:w-0.5 tw:h-full tw:bg-[var(--color-table-resize-handle)]'
                : 'tw:w-px tw:h-4 tw:bg-[var(--color-border-default)] group-hover/resizer:tw:w-0.5 group-hover/resizer:tw:h-full group-hover/resizer:tw:bg-[var(--color-table-resize-handle)]',
            ]"
          />
        </div>
      </th>

    </tr>
  </thead>
</template>
