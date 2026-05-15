<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts" generic="TData extends Record<string, any>">
import { computed, toRef, useSlots } from "vue";
import type { OTableProps, OTableEmits, OTableSlots } from "./OTable.types";

import { useTableCore } from "./composables/useTableCore";
import { useTablePagination } from "./composables/useTablePagination";
import { useTableSorting } from "./composables/useTableSorting";
import { useTableSelection } from "./composables/useTableSelection";
import { useTableExpansion } from "./composables/useTableExpansion";
import { useTableFiltering } from "./composables/useTableFiltering";
import { useTableHighlight } from "./composables/useTableHighlight";
import { useTableColumnManagement } from "./composables/useTableColumnManagement";

import OTableHeader from "./sub-components/OTableHeader.vue";
import OTableBody from "./sub-components/OTableBody.vue";
import OTablePagination from "./sub-components/OTablePagination.vue";
import OTableEmpty from "./sub-components/OTableEmpty.vue";
import OTableLoading from "./sub-components/OTableLoading.vue";
import OTableError from "./sub-components/OTableError.vue";

const props = withDefaults(defineProps<OTableProps<TData>>(), {
  pagination: "none",
  pageSize: 20,
  pageSizeOptions: () => [20, 50, 100, 250, 500],
  sorting: "none",
  selection: "none",
  expansion: "none",
  virtualScroll: false,
  virtualScrollItemSize: 48,
  enableColumnResize: false,
  enableColumnReorder: false,
  enableColumnPin: false,
  loading: false,
  error: null,
  dense: false,
  bordered: true,
  striped: false,
  stickyHeader: true,
  rowKey: "id",
  filterMode: "client",
  defaultColumns: true,
});

const emit = defineEmits<OTableEmits<TData>>();
const slots = defineSlots<OTableSlots<TData>>();

// ── Core table instance ─────────────────────────────────────────
const {
  table,
  columnOrder,
  columnSizing,
  isClientSort,
  isClientPagination,
} = useTableCore<TData>(
  {
    data: props.data,
    columns: props.columns,
    pageSize: props.pageSize,
    sortBy: props.sortBy,
    sortOrder: props.sortOrder,
    sortFieldMap: props.sortFieldMap,
    globalFilter: props.globalFilter,
    rowKey: props.rowKey,
    enableColumnResize: props.enableColumnResize,
    enableColumnReorder: props.enableColumnReorder,
    enableColumnPin: props.enableColumnPin,
    columnVisibility: props.columnVisibility,
    defaultColumns: props.defaultColumns,
    getSubRows: props.getSubRows,
    pagination: props.pagination,
    sorting: props.sorting,
  },
  emit,
);

// ── Pagination ──────────────────────────────────────────────────
const pagination = useTablePagination(table, {
  pagination: props.pagination,
  pageSize: props.pageSize,
  pageSizeOptions: props.pageSizeOptions,
  currentPage: props.currentPage,
  totalCount: props.totalCount,
  data: props.data,
}, emit);

// ── Sorting ─────────────────────────────────────────────────────
const sorting = useTableSorting(table, {
  sorting: props.sorting,
  sortBy: props.sortBy,
  sortOrder: props.sortOrder,
  sortFieldMap: props.sortFieldMap,
}, emit);

// ── Selection ───────────────────────────────────────────────────
const selection = useTableSelection(table, {
  selection: props.selection,
  selectedIds: props.selectedIds,
  rowKey: props.rowKey,
}, emit);

// ── Expansion ───────────────────────────────────────────────────
const expansion = useTableExpansion<TData>(
  {
    expansion: props.expansion,
    expandedIds: props.expandedIds,
    rowKey: props.rowKey,
    getSubRows: props.getSubRows,
  },
  emit,
);

// ── Filtering ───────────────────────────────────────────────────
const filtering = useTableFiltering<TData>(
  {
    globalFilter: props.globalFilter,
    globalFilterPlaceholder: props.globalFilterPlaceholder,
    filterMode: props.filterMode,
  },
  emit,
);

// ── Highlighting ────────────────────────────────────────────────
const highlighting = useTableHighlight({
  highlightText: props.highlightText,
  highlightFields: props.highlightFields,
});

// ── Column Management ───────────────────────────────────────────
const columnMgmt = useTableColumnManagement({
  enableColumnResize: props.enableColumnResize,
  enableColumnReorder: props.enableColumnReorder,
  columnVisibility: props.columnVisibility,
  columnOrder: columnOrder.value,
});

// ── Rows to display ─────────────────────────────────────────────
const displayRows = computed(() => {
  if (isClientPagination.value) {
    return table.getRowModel().rows;
  }
  return table.getRowModel().rows;
});

// ── Expansion slot lookup ───────────────────────────────────────
const hasExpansionSlot = computed(() => !!slots.expansion);

// ── Table-level empty/loading/error state ──────────────────────
const showEmpty = computed(
  () => !props.loading && !props.error && displayRows.value.length === 0,
);
const showError = computed(() => !props.loading && !!props.error);
const showLoadingOverlay = computed(
  () => props.loading && displayRows.value.length === 0,
);

// ── CSS variable computation for column sizes ──────────────────
const columnSizeVars = computed(() => {
  const sizes: Record<string, string> = {};
  // Build CSS custom properties for each column's computed size
  const headers = table.getFlatHeaders?.() ?? [];
  for (const header of headers) {
    const safeId = header.id.replace(/[^a-zA-Z0-9]/g, "-");
    sizes[`--header-${safeId}-size`] = `${header.getSize()}px`;
  }
  return sizes;
});

/**
 * Exposed API: parent can access the TanStack table instance
 * and imperative methods via template ref.
 */
defineExpose({
  table,
  toggleAllRows: selection.toggleAllRows,
  clearSelection: selection.clearSelection,
  resetColumnSizes: () => table.resetColumnSizing?.(),
  resetColumnOrder: () => {
    columnOrder.value = props.columns.map((c) => c.id);
  },
  scrollToTop: () => {
    // Implemented when virtual scroll is integrated
  },
});
</script>

<template>
  <div
    data-test="o2-table-root"
    class="tw:flex tw:flex-col tw:h-full tw:overflow-hidden"
  >
    <!-- ── Top slot (search bar, title, actions) ─────────────── -->
    <slot name="top" />

    <!-- ── Top pagination ───────────────────────────────────── -->
    <OTablePagination
      v-if="pagination.isEnabled.value && pagination.isServerMode.value"
      position="top"
      :current-page="pagination.currentPage.value"
      :total-pages="pagination.totalPages.value"
      :total-count="pagination.totalCount.value"
      :page-size="pagination.pageSize.value"
      :page-size-options="pagination.pageSizeOptions.value"
      :showing-from="pagination.showingFrom.value"
      :showing-to="pagination.showingTo.value"
      :is-first-page="pagination.isFirstPage.value"
      :is-last-page="pagination.isLastPage.value"
      :title="(slots as any)?.['top']?.() ? '' : ''"
      @update:page-size="pagination.setPageSize"
      @first-page="pagination.firstPage"
      @prev-page="pagination.prevPage"
      @next-page="pagination.nextPage"
      @last-page="pagination.lastPage"
    />

    <!-- ── Scrollable table area ────────────────────────────── -->
    <div
      class="tw:flex-1 tw:overflow-auto tw:min-h-0 tw:relative"
      :style="{
        maxHeight: props.maxHeight
          ? typeof props.maxHeight === 'number'
            ? `${props.maxHeight}px`
            : props.maxHeight
          : undefined,
      }"
      data-test="o2-table-scroll-container"
    >
      <table
        :class="[
          'tw:w-full',
          !props.defaultColumns ? 'tw:table-fixed' : 'tw:table-auto',
          props.bordered ? '' : 'tw:border-separate tw:border-spacing-0',
        ]"
        :style="{
          ...columnSizeVars.value,
        }"
        data-test="o2-table"
      >
        <!-- ── Header ───────────────────────────────────────── -->
        <OTableHeader
          :header-groups="table.getHeaderGroups()"
          :table="table"
          :selection-multiple="selection.isMultiple.value"
          :is-all-selected="selection.isAllSelected()"
          :is-indeterminate="selection.isIndeterminate()"
          :expansion-enabled="expansion.isEnabled.value"
          :enable-column-reorder="props.enableColumnReorder"
          :enable-column-resize="props.enableColumnResize"
          :sorting-enabled="sorting.isEnabled.value"
          :sort-by="sorting.activeSortBy.value ?? undefined"
          :sort-order="sorting.activeSortOrder.value ?? undefined"
          :sort-field-map="props.sortFieldMap ?? {}"
          :get-sort-icon="sorting.getSortIcon"
          :sticky-header="props.stickyHeader"
          :bordered="props.bordered"
          @toggle-all-rows="selection.toggleAllRows"
          @sort="sorting.handleSort"
          @column-close="emit('column-close', $event)"
        />

        <!-- ── Body ─────────────────────────────────────────── -->
        <OTableBody
          v-if="!showEmpty && !showError"
          :rows="displayRows.value"
          :table="table"
          :selection-enabled="selection.isEnabled.value"
          :selection-multiple="selection.isMultiple.value"
          :is-row-selected-fn="(row: TData) => selection.isRowSelected(row)"
          :expansion-enabled="expansion.isEnabled.value"
          :is-expanded-fn="(row: TData) => expansion.isExpanded(row)"
          :highlight-text="props.highlightText"
          :should-highlight-column="highlighting.shouldHighlightColumn"
          :wrap="props.wrap"
          :dense="props.dense"
          :bordered="props.bordered"
          :striped="props.striped"
          :row-class="(props.rowClass as any)"
          :row-style-fn="props.getRowStyle"
          :loading="props.loading"
          @toggle-selection="selection.toggleRow"
          @toggle-expansion="expansion.toggleRow"
          @row-click="(row: TData, evt: MouseEvent) => emit('row-click', row, evt)"
          @row-dblclick="(row: TData, evt: MouseEvent) => emit('row-dblclick', row, evt)"
          @cell-click="(params) => emit('cell-click', params)"
        >
          <!-- Pass through named cell slots from parent -->
          <template
            v-for="col in props.columns.filter(c => c.isAction || c.cell)"
            :key="`cell-${col.id}`"
            #[`cell-${col.id}`]="slotProps"
          >
            <slot
              :name="`cell-${col.id}`"
              :row="slotProps.row"
              :value="slotProps.value"
              :column="slotProps.column"
            />
          </template>
        </OTableBody>
      </table>

      <!-- ── Empty State ───────────────────────────────────── -->
      <OTableEmpty
        v-if="showEmpty"
        :message="props.emptyMessage"
      >
        <slot name="empty" />
      </OTableEmpty>

      <!-- ── Loading State ──────────────────────────────────── -->
      <OTableLoading
        v-if="showLoadingOverlay"
        :overlay="displayRows.value.length > 0"
      >
        <slot name="loading" />
      </OTableLoading>

      <!-- ── Error State ────────────────────────────────────── -->
      <OTableError
        v-if="showError"
        :message="props.error"
        @retry="
          emit(
            'pagination-change',
            {
              page: pagination.currentPage.value,
              size: pagination.pageSize.value,
            },
          )
        "
      >
        <template v-if="slots.error" #default="errProps">
          <slot name="error" v-bind="errProps" />
        </template>
      </OTableError>
    </div>

    <!-- ── Bottom slot (custom actions) ─────────────────────── -->
    <slot name="bottom" />

    <!-- ── Bottom Pagination ────────────────────────────────── -->
    <OTablePagination
      v-if="pagination.isEnabled.value"
      position="bottom"
      :current-page="pagination.currentPage.value"
      :total-pages="pagination.totalPages.value"
      :total-count="pagination.totalCount.value"
      :page-size="pagination.pageSize.value"
      :page-size-options="pagination.pageSizeOptions.value"
      :showing-from="pagination.showingFrom.value"
      :showing-to="pagination.showingTo.value"
      :is-first-page="pagination.isFirstPage.value"
      :is-last-page="pagination.isLastPage.value"
      @update:page-size="pagination.setPageSize"
      @first-page="pagination.firstPage"
      @prev-page="pagination.prevPage"
      @next-page="pagination.nextPage"
      @last-page="pagination.lastPage"
    />
  </div>
</template>
