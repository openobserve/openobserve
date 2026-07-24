<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { HeaderGroup, Table } from "@tanstack/vue-table";
import { FlexRender } from "@tanstack/vue-table";
import { inject, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { PIVOT_TABLE_TOTAL_COLUMN_WIDTH } from "@/utils/dashboard/constants";
import { TABLE_CHECKBOX_COL_SIZE as TABLE_CHECKBOX_COL_WIDTH } from "../OTable.types";

const props = defineProps<{
  headerGroups: HeaderGroup<any>[];
  table: Table<any>;
  columnOrder: string[];
  selectionMultiple?: boolean;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
  expansionEnabled?: boolean;
  enableRowReorder?: boolean;
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
  /** Show the Excel-style per-column value-filter dropdown on filterable columns. */
  enableColumnFilter?: boolean;
}>();

const { t } = useI18n();

// ── Per-column value filter (ported from the legacy TenstackTable) ──
// Filter state lives in the TanStack instance (column.getFilterValue /
// setFilterValue → useTableCore's `valueInSet` fn); this only supplies the UI
// and each panel's local search box.
const colFilterSearch = reactive<Record<string, string>>({});

function columnUniqueValues(colId: string): any[] {
  const col = props.table.getColumn(colId);
  if (!col) return [];
  const seen = new Set<any>();
  // Pre-filtered rows: the option list must not collapse as filters get applied.
  for (const row of props.table.getPreFilteredRowModel().rows) {
    const val = row.getValue(colId);
    if (val !== null && val !== undefined && val !== "") seen.add(val);
  }
  return Array.from(seen).sort((a, b) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
  );
}

function filterDisplayValue(colId: string, rawVal: any): string {
  const fmt = (props.table.getColumn(colId)?.columnDef?.meta as any)?.format;
  if (fmt) {
    const f = fmt(rawVal);
    return f != null ? String(f) : String(rawVal ?? "");
  }
  return String(rawVal ?? "");
}

function filteredUniqueValues(colId: string): any[] {
  const all = columnUniqueValues(colId);
  const q = (colFilterSearch[colId] ?? "").trim().toLowerCase();
  if (!q) return all;
  return all.filter((v) => filterDisplayValue(colId, v).toLowerCase().includes(q));
}

function colFilterValues(colId: string): any[] {
  return (props.table.getColumn(colId)?.getFilterValue() as any[]) ?? [];
}

function isColFiltered(colId: string): boolean {
  return colFilterValues(colId).length > 0;
}

function toggleColFilterValue(colId: string, rawVal: any): void {
  const col = props.table.getColumn(colId);
  if (!col) return;
  const current = colFilterValues(colId);
  const idx = current.indexOf(rawVal);
  const next = idx === -1 ? [...current, rawVal] : current.filter((_, i) => i !== idx);
  col.setFilterValue(next.length ? next : undefined);
}

function clearColFilter(colId: string): void {
  props.table.getColumn(colId)?.setFilterValue(undefined);
}

const emit = defineEmits<{
  "toggle-all-rows": [];
  sort: [columnId: string];
  "update:columnOrder": [order: string[]];
  "drag-start": [event: any];
  "drag-end": [];
  "resize-start": [];
  /** Per-column close ("x") — remove-column affordance (G4). Emits the column
   *  definition so the consumer can drop the field (distinct from hide). */
  "close-column": [column: any];
}>();

// Notify the parent BEFORE the resize begins so it can freeze any flex columns
// synchronously (write their current widths into column sizing). This must run
// before TanStack captures the drag start state, otherwise the flex column
// would keep absorbing — shrinking — as the dragged column grows.
function startResize(header: any, event: MouseEvent | TouchEvent) {
  emit("resize-start");
  header.getResizeHandler()?.(event);
}

const horizontalScroll = inject<{ value: boolean } | null>("o2TableHorizontalScroll", null);

function handleSort(columnId: string, toggleHandler?: (event: Event) => void, event?: MouseEvent) {
  const meta = props.table.getColumn(columnId)?.columnDef?.meta as any;
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
  if (align === "center") return "text-center justify-center";
  if (align === "right") return "text-right justify-end";
  return "";
}

function headerPaddingClass(header: any): string {
  const m = header.column.columnDef.meta as any;
  if (m?.spacer) return "px-0"; // the invisible spacer must be able to reach 0 width
  return m?.compactPadding ? "px-1" : "px-2";
}

function headerSizeVar(header: any): string {
  return `var(--header-${header.id.replace(/[^a-zA-Z0-9]/g, "-")}-size)`;
}

// ── Pivot helpers ───────────────────────────────────────────────

function getPivotRowColStyle(colId: string): Record<string, any> {
  const col = props.table.getColumn(colId);
  // Only make the row-field header sticky when the column is genuinely pinned
  // left; otherwise header + (non-sticky) body cells would misalign on
  // horizontal scroll. Row-field columns aren't pinned today, so this returns {}.
  if (!col || col.getIsPinned?.() !== "left") return {};
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
    class="sticky top-0 z-10"
    data-test="o2-table-pivot-header"
  >
    <!-- bg on the <tr> as well as each <th>: in border-separate mode (forced by
         pivot) the row-group background does not paint, so border-spacing seams
         and rowspan/colspan gaps would be transparent and body rows would show
         through the sticky header while scrolling (QA #2239: header overlap / no
         header background). Mirrors the non-pivot header <tr> below. -->
    <tr
      v-for="(level, levelIdx) in pivotHeaderLevels"
      :key="'pivot-hl-' + levelIdx"
      class="bg-table-header-bg h-7"
    >
      <!-- Row-field column headers: first row only, rowspan all levels.
           Raw pivot row-field columns carry `name`/`field` but no `id`, so key +
           sort + style must use `name` (=== the table column id for pivot). Using
           `col.id` produced `undefined` for every one → duplicate Vue keys + dead
           sort (P0-A1). -->
      <th
        v-for="col in levelIdx === 0 ? pivotRowColumns : []"
        :key="'pivot-rh-' + (col.name ?? col.id)"
        :rowspan="pivotHeaderLevels.length"
        :data-test="`o2-table-pivot-th-${col.name ?? col.id}`"
        class="text-secondary bg-table-header-bg cursor-pointer px-2 text-left text-xs font-medium"
        :style="getPivotRowColStyle(col.name ?? col.id)"
        @click="handleSort(col.name ?? col.id)"
      >
        <div class="flex items-center gap-1">
          <FlexRender v-if="col.header" :render="col.header" :props="{}" />
          <span v-else>{{ col.label ?? col.name ?? col.id }}</span>
          <OIcon
            v-if="getSortIcon?.(col.name ?? col.id) === 'asc'"
            name="arrow-upward"
            size="sm"
            class="text-table-sort-icon-active"
          />
          <OIcon
            v-else-if="getSortIcon?.(col.name ?? col.id) === 'desc'"
            name="arrow-downward"
            size="sm"
            class="text-table-sort-icon-active"
          />
          <OIcon v-else name="unfold-more" size="sm" class="opacity-40" />
        </div>
      </th>

      <!-- Pivot group / value headers -->
      <th
        v-for="(cell, cellIdx) in level.cells"
        :key="'pivot-c-' + levelIdx + '-' + cellIdx"
        :colspan="cell.colspan"
        :rowspan="cell.rowspan || 1"
        :data-test="`o2-table-pivot-th-${levelIdx}-${cellIdx}`"
        class="bg-table-header-bg px-2"
        :class="[
          level.isLeaf
            ? 'pivot-value-header text-secondary text-xs font-medium'
            : 'pivot-group-header text-secondary text-center text-xs font-medium',
          {
            'border-border-default border-l':
              cell.hasBorder && !(stickyColTotals && cell._isTotalHeader),
          },
          {
            'cursor-pointer': cell._sortColumn,
          },
        ]"
        :style="stickyColTotals && cell._isTotalHeader ? getPivotTotalHeaderStyle(cell) : {}"
        @click="cell._sortColumn && handleSort(cell._sortColumn)"
      >
        <!-- Truncate the label so an unbreakable pivot group value (e.g. a long
             user_email with no spaces to wrap on) can't overflow its narrow
             fixed-width colspan and overlap neighbouring headers (QA issue 2239
             item 9). Sort icon stays pinned via shrink-0. -->
        <div
          :class="[
            'flex min-w-0 items-center gap-1 overflow-hidden',
            level.isLeaf ? 'justify-start' : 'justify-center',
          ]"
        >
          <span class="truncate" :title="String(cell.label ?? '')">{{ cell.label }}</span>
          <OIcon
            v-if="level.isLeaf && cell._sortColumn && getSortIcon?.(cell._sortColumn) === 'asc'"
            name="arrow-upward"
            size="sm"
            class="text-table-sort-icon-active shrink-0"
          />
          <OIcon
            v-else-if="
              level.isLeaf && cell._sortColumn && getSortIcon?.(cell._sortColumn) === 'desc'
            "
            name="arrow-downward"
            size="sm"
            class="text-table-sort-icon-active shrink-0"
          />
          <OIcon
            v-else-if="level.isLeaf && cell._sortColumn"
            name="unfold-more"
            size="sm"
            class="shrink-0 opacity-40"
          />
        </div>
      </th>
    </tr>
  </thead>

  <!-- ── Standard TanStack headers (non-pivot) ─────────────────── -->
  <thead
    v-else
    v-for="headerGroup in headerGroups"
    :key="headerGroup.id"
    :class="[
      'bg-table-header-bg',
      'border-table-header-border border-b',
      stickyHeader ? 'sticky top-0 z-10' : '',
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
      :class="['bg-table-header-bg', columnOrder.length > 1 ? 'cursor-move' : '']"
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
        class="border-table-header-border w-4 min-w-4 border-b px-0"
        data-test="o2-table-th-expand"
      />

      <!-- Selection checkbox header -->
      <th
        v-if="selectionMultiple"
        class="border-table-header-border border-b text-left"
        :style="{
          width: TABLE_CHECKBOX_COL_WIDTH + 'px',
          minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
          maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
          paddingLeft: 'var(--spacing-table-edge)',
        }"
        data-test="o2-table-th-select"
      >
        <OTableSelectCheckbox
          :model-value="isAllSelected ?? false"
          :indeterminate="isIndeterminate ?? false"
          row-id="all"
          @update:model-value="emit('toggle-all-rows')"
        />
      </th>

      <!-- Drag handle placeholder column -->
      <th
        v-if="enableRowReorder"
        class="border-table-header-border w-4 min-w-4 border-b px-0"
        data-test="o2-table-th-drag"
        aria-hidden="true"
      />

      <!-- Column headers -->
      <th
        v-for="header in headerGroup.headers"
        :key="header.id"
        :colspan="header.colSpan"
        :rowspan="header.rowSpan"
        :data-test="`o2-table-th-${header.id}`"
        :class="[
          `${headerPaddingClass(header)} text-table-header-text relative text-left text-xs font-medium select-none`,
          'table-head',
          dense ? 'h-8' : 'h-9',
          'border-table-header-border border-b',
          'group',
          header.column.getIsPinned?.() ? 'bg-table-header-bg' : '',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          ...(isAutoWidthColumn(header)
            ? header.column.columnDef.minSize
              ? { minWidth: `${header.column.columnDef.minSize}px` }
              : {}
            : (header.column.columnDef.meta as any)?.fixedWidth
              ? {
                  width: headerSizeVar(header),
                  minWidth: headerSizeVar(header),
                  maxWidth: headerSizeVar(header),
                }
              : horizontalScroll?.value
                ? { width: headerSizeVar(header) }
                : { width: headerSizeVar(header), maxWidth: headerSizeVar(header) }),
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
        <div
          :class="[
            'flex h-full min-w-0 items-center gap-1 overflow-hidden',
            headerAlignClass(header),
          ]"
        >
          <!-- Sortable header -->
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            :class="[
              'flex min-w-0 flex-1 cursor-pointer items-center gap-1',
              headerAlignClass(header),
            ]"
            data-test="o2-table-th-sort-trigger"
            @click="
              (e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)
            "
          >
            <span class="min-w-0 truncate">
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </span>
            <!-- Sort icons — `shrink-0` so they're never clipped even when the
                 header title truncates. -->
            <span
              v-if="sortingEnabled && (header.column.columnDef.meta as any)?.sortable"
              class="flex shrink-0 items-center"
            >
              <OIcon
                v-if="getSortIcon?.(header.id) === 'asc'"
                name="arrow-upward"
                size="sm"
                class="text-table-sort-icon-active"
                data-test="o2-table-sort-icon-active"
                data-test-sort-direction="asc"
              />
              <OIcon
                v-else-if="getSortIcon?.(header.id) === 'desc'"
                name="arrow-downward"
                size="sm"
                class="text-table-sort-icon-active"
                data-test="o2-table-sort-icon-active"
                data-test-sort-direction="desc"
              />
              <OIcon
                v-else
                name="unfold-more"
                size="sm"
                class="opacity-40"
                data-test="o2-table-sort-icon-inactive"
                data-test-sort-direction="none"
              />
            </span>
          </div>

          <!-- Non-sortable header -->
          <div v-else :class="['min-w-0 flex-1 truncate', headerAlignClass(header)]">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>

          <!-- Column close ("x") — remove-column affordance (G4). Shown on hover
               for columns whose meta marks them closable; emits close-column so
               the consumer can drop the field (distinct from columnVisibility). -->
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-remove-${header.id}-btn`"
            class="rounded-default text-text-secondary hover:text-text-body hover:bg-table-row-hover-bg inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Remove column"
            @click.stop="emit('close-column', header.column.columnDef)"
          >
            <OIcon name="close" size="xs" />
          </button>

          <!-- Per-column value filter (#2239.4) — Excel-style multi-select
               dropdown ported from the legacy TenstackTable. Rendered on
               filterable columns only when the table opts in via
               `enableColumnFilter`, so tables that don't are unaffected. -->
          <ODropdown
            v-if="enableColumnFilter && header.column.getCanFilter()"
            side="bottom"
            align="start"
            :side-offset="4"
            @update:open="
              (v: boolean) => {
                if (v) colFilterSearch[header.column.id] = '';
              }
            "
          >
            <template #trigger>
              <button
                type="button"
                :data-test="`o2-table-column-filter-btn-${header.column.id}`"
                class="rounded-default ml-0.5 inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0.5"
                @click.stop
              >
                <OIcon
                  name="filter-list"
                  size="xs"
                  :data-test="`o2-table-column-filter-icon-${header.column.id}-${isColFiltered(header.column.id) ? 'active' : 'inactive'}`"
                  :class="isColFiltered(header.column.id) ? 'text-primary' : 'opacity-50'"
                />
              </button>
            </template>
            <div
              class="max-w-75 min-w-50 py-1"
              :data-test="`o2-table-column-filter-panel-${header.column.id}`"
              @click.stop
            >
              <div class="border-table-row-divider border-b px-2 pb-1">
                <OInput
                  v-model="colFilterSearch[header.column.id]"
                  size="sm"
                  clearable
                  :placeholder="t('common.search')"
                  @click.stop
                  @keydown.stop
                >
                  <template #icon-left>
                    <OIcon name="search" size="xs" />
                  </template>
                </OInput>
              </div>
              <ul role="listbox" aria-multiselectable="true" class="max-h-60 overflow-y-auto">
                <li
                  v-for="rawVal in filteredUniqueValues(header.column.id)"
                  :key="String(rawVal)"
                  class="rounded-default hover:bg-surface-panel flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors"
                  @click.stop="toggleColFilterValue(header.column.id, rawVal)"
                >
                  <OCheckbox
                    :model-value="colFilterValues(header.column.id).includes(rawVal)"
                    size="sm"
                    @update:model-value="toggleColFilterValue(header.column.id, rawVal)"
                    @click.stop
                  />
                  <span class="flex-1 truncate text-sm select-none">
                    {{ filterDisplayValue(header.column.id, rawVal) }}
                  </span>
                </li>
                <li
                  v-if="filteredUniqueValues(header.column.id).length === 0"
                  class="px-3 py-1.5 text-xs opacity-60"
                >
                  {{ t("common.noMatches") }}
                </li>
              </ul>
              <div class="border-table-row-divider border-t">
                <div
                  class="hover:bg-surface-panel cursor-pointer px-3 py-1.5 text-xs opacity-70"
                  @click.stop="clearColFilter(header.column.id)"
                >
                  {{ t("common.clearFilter") }}
                </div>
              </div>
            </div>
          </ODropdown>
        </div>

        <!-- Column resize handle -->
        <div
          v-if="header.column.getCanResize()"
          class="resizer group/resizer absolute top-0 right-0 z-10 flex h-full w-1.25 cursor-col-resize touch-none items-center justify-end select-none"
          :title="'Drag to resize · double-click to reset'"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="startResize(header, $event)"
          @touchstart.prevent.stop="startResize(header, $event)"
        >
          <!-- A short, rounded, vertically-inset handle: a subtle divider by
               default, the accent (full-height) while hovering it or resizing. -->
          <div
            :class="[
              'rounded-full transition-all duration-150',
              header.column.getIsResizing()
                ? 'bg-table-resize-handle h-full w-0.5'
                : 'bg-border-default group-hover/resizer:bg-table-resize-handle h-4 w-px group-hover/resizer:h-full group-hover/resizer:w-0.5',
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
    <tr v-if="!enableColumnReorder" class="bg-table-header-bg">
      <!-- Gutter order MUST be expansion → selection → drag, matching
           OTableBodyRow and OTableLoading. This branch used to render
           selection → drag → expansion, so any table with both an expand and a
           checkbox gutter had its header columns offset from its body. -->
      <th
        v-if="expansionEnabled"
        class="border-table-header-border w-4 min-w-4 border-b px-0"
        data-test="o2-table-th-expand"
      />

      <th
        v-if="selectionMultiple"
        class="border-table-header-border border-b text-left"
        :style="{
          width: TABLE_CHECKBOX_COL_WIDTH + 'px',
          minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
          maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
          paddingLeft: 'var(--spacing-table-edge)',
        }"
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
        v-if="enableRowReorder"
        class="border-table-header-border w-4 min-w-4 border-b px-0"
        data-test="o2-table-th-drag"
        aria-hidden="true"
      />

      <th
        v-for="header in headerGroup.headers"
        :key="header.id"
        :data-test="`o2-table-th-${header.id}`"
        :class="[
          `${headerPaddingClass(header)} text-table-header-text relative text-left text-xs font-medium select-none`,
          dense ? 'group h-8' : 'group h-9',
          'border-table-header-border border-b',
          header.column.getIsPinned?.() ? 'bg-table-header-bg' : '',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          ...(isAutoWidthColumn(header)
            ? header.column.columnDef.minSize
              ? { minWidth: `${header.column.columnDef.minSize}px` }
              : {}
            : (header.column.columnDef.meta as any)?.fixedWidth
              ? {
                  width: headerSizeVar(header),
                  minWidth: headerSizeVar(header),
                  maxWidth: headerSizeVar(header),
                }
              : horizontalScroll?.value
                ? { width: headerSizeVar(header) }
                : { width: headerSizeVar(header), maxWidth: headerSizeVar(header) }),
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
        <div
          :class="[
            'flex h-full min-w-0 items-center gap-1 overflow-hidden',
            headerAlignClass(header),
          ]"
        >
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            :class="[
              'flex flex-1 cursor-pointer items-center gap-1 overflow-hidden whitespace-nowrap',
              headerAlignClass(header),
            ]"
            data-test="o2-table-th-sort-trigger"
            @click="
              (e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)
            "
          >
            <span class="min-w-0 truncate">
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </span>
            <template v-if="sortingEnabled && (header.column.columnDef.meta as any)?.sortable">
              <OIcon
                v-if="getSortIcon?.(header.id) === 'asc'"
                name="arrow-upward"
                size="sm"
                class="text-table-sort-icon-active shrink-0"
                data-test="o2-table-sort-icon-active"
                data-test-sort-direction="asc"
              />
              <OIcon
                v-else-if="getSortIcon?.(header.id) === 'desc'"
                name="arrow-downward"
                size="sm"
                class="text-table-sort-icon-active shrink-0"
                data-test="o2-table-sort-icon-active"
                data-test-sort-direction="desc"
              />
              <OIcon
                v-else
                name="unfold-more"
                size="sm"
                class="shrink-0 opacity-40"
                data-test="o2-table-sort-icon-inactive"
                data-test-sort-direction="none"
              />
            </template>
          </div>
          <div v-else :class="['min-w-0 flex-1 truncate', headerAlignClass(header)]">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>

          <!-- Column close ("x") — remove-column affordance (G4), hover-revealed. -->
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-remove-${header.id}-btn`"
            class="rounded-default text-text-secondary hover:text-text-body hover:bg-table-row-hover-bg inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Remove column"
            @click.stop="emit('close-column', header.column.columnDef)"
          >
            <OIcon name="close" size="xs" />
          </button>

          <!-- Per-column value filter (#2239.4) — Excel-style multi-select
               dropdown ported from the legacy TenstackTable. Rendered on
               filterable columns only when the table opts in via
               `enableColumnFilter`, so tables that don't are unaffected. -->
          <ODropdown
            v-if="enableColumnFilter && header.column.getCanFilter()"
            side="bottom"
            align="start"
            :side-offset="4"
            @update:open="
              (v: boolean) => {
                if (v) colFilterSearch[header.column.id] = '';
              }
            "
          >
            <template #trigger>
              <button
                type="button"
                :data-test="`o2-table-column-filter-btn-${header.column.id}`"
                class="rounded-default ml-0.5 inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0.5"
                @click.stop
              >
                <OIcon
                  name="filter-list"
                  size="xs"
                  :data-test="`o2-table-column-filter-icon-${header.column.id}-${isColFiltered(header.column.id) ? 'active' : 'inactive'}`"
                  :class="isColFiltered(header.column.id) ? 'text-primary' : 'opacity-50'"
                />
              </button>
            </template>
            <div
              class="max-w-75 min-w-50 py-1"
              :data-test="`o2-table-column-filter-panel-${header.column.id}`"
              @click.stop
            >
              <div class="border-table-row-divider border-b px-2 pb-1">
                <OInput
                  v-model="colFilterSearch[header.column.id]"
                  size="sm"
                  clearable
                  :placeholder="t('common.search')"
                  @click.stop
                  @keydown.stop
                >
                  <template #icon-left>
                    <OIcon name="search" size="xs" />
                  </template>
                </OInput>
              </div>
              <ul role="listbox" aria-multiselectable="true" class="max-h-60 overflow-y-auto">
                <li
                  v-for="rawVal in filteredUniqueValues(header.column.id)"
                  :key="String(rawVal)"
                  class="rounded-default hover:bg-surface-panel flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors"
                  @click.stop="toggleColFilterValue(header.column.id, rawVal)"
                >
                  <OCheckbox
                    :model-value="colFilterValues(header.column.id).includes(rawVal)"
                    size="sm"
                    @update:model-value="toggleColFilterValue(header.column.id, rawVal)"
                    @click.stop
                  />
                  <span class="flex-1 truncate text-sm select-none">
                    {{ filterDisplayValue(header.column.id, rawVal) }}
                  </span>
                </li>
                <li
                  v-if="filteredUniqueValues(header.column.id).length === 0"
                  class="px-3 py-1.5 text-xs opacity-60"
                >
                  {{ t("common.noMatches") }}
                </li>
              </ul>
              <div class="border-table-row-divider border-t">
                <div
                  class="hover:bg-surface-panel cursor-pointer px-3 py-1.5 text-xs opacity-70"
                  @click.stop="clearColFilter(header.column.id)"
                >
                  {{ t("common.clearFilter") }}
                </div>
              </div>
            </div>
          </ODropdown>
        </div>
        <div
          v-if="header.column.getCanResize()"
          class="resizer group/resizer absolute top-0 right-0 z-10 flex h-full w-1.25 cursor-col-resize touch-none items-center justify-end select-none"
          :title="'Drag to resize · double-click to reset'"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="startResize(header, $event)"
          @touchstart.prevent.stop="startResize(header, $event)"
        >
          <!-- A short, rounded, vertically-inset handle: a subtle divider by
               default, the accent (full-height) while hovering it or resizing. -->
          <div
            :class="[
              'rounded-full transition-all duration-150',
              header.column.getIsResizing()
                ? 'bg-table-resize-handle h-full w-0.5'
                : 'bg-border-default group-hover/resizer:bg-table-resize-handle h-4 w-px group-hover/resizer:h-full group-hover/resizer:w-0.5',
            ]"
          />
        </div>
      </th>
    </tr>
  </thead>
</template>
