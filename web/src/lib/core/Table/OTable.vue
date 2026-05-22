<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts" generic="TData extends Record<string, any>">
import { computed, onBeforeUnmount, provide, ref, toRef, useSlots, watch } from "vue";
import { FlexRender } from "@tanstack/vue-table";
import type { OTableProps, OTableEmits, OTableSlots } from "./OTable.types";

import { useTableCore } from "./composables/useTableCore";
import { useTablePagination } from "./composables/useTablePagination";
import { useTableSorting } from "./composables/useTableSorting";
import { useTableSelection } from "./composables/useTableSelection";
import { useTableExpansion } from "./composables/useTableExpansion";
import { useTableTree, OTableTreeContextKey } from "./composables/useTableTree";
import { useTableFiltering } from "./composables/useTableFiltering";
import { useTableHighlight } from "./composables/useTableHighlight";
import { useTableColumnManagement } from "./composables/useTableColumnManagement";
import { useTableVirtualization } from "./composables/useTableVirtualization";
import { useTableKeyboard } from "./composables/useTableKeyboard";

import OTableHeader from "./sub-components/OTableHeader.vue";
import OTableBody from "./sub-components/OTableBody.vue";
import OTablePagination from "./sub-components/OTablePagination.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTableEmpty from "./sub-components/OTableEmpty.vue";
import OTableLoading from "./sub-components/OTableLoading.vue";
import OTableError from "./sub-components/OTableError.vue";

const props = withDefaults(defineProps<OTableProps<TData>>(), {
  pagination: "client",
  pageSize: 20,
  pageSizeOptions: () => [20, 50, 100, 250, 500],
  sorting: "client",
  selection: "none",
  expansion: "none",
  virtualScroll: false,
  virtualScrollItemSize: 48,
  enableColumnResize: false,
  enableColumnReorder: false,
  enableColumnPin: false,
  loading: false,
  streaming: false,
  error: null,
  dense: true,
  bordered: true,
  striped: false,
  stickyHeader: true,
  wrap: false,
  rowKey: "id",
  rowHeight: undefined,
  showGlobalFilter: true,
  globalFilterPlaceholder: "Search...",
  filterMode: "client",
  defaultColumns: true,
  footerTitle: "",
  showHeader: true,
});

const emit = defineEmits<OTableEmits<TData>>();
const slots = defineSlots<OTableSlots<TData>>();

// Only forward cell-slot templates for columns whose cell slot the parent actually provides.
// If we forward an empty slot for every column, OTableBodyCell sees $slots.default as truthy
// and renders the (empty) slot instead of falling through to the plain-text {{ displayValue }}.
const cellSlotColumns = computed(() =>
  props.columns.filter((col) => slots[`cell-${col.id}`]),
);

// ── Refs for virtual scroll & keyboard ──────────────────────────
const scrollContainerRef = ref<HTMLElement | null>(null);
const columnIds = computed(() => props.columns.map((c) => c.id));

// ── Skeleton hold ───────────────────────────────────────────────
// Show the skeleton for at least 2s once loading starts, so it doesn't
// flash-and-disappear on fast responses. If the server is slow, the
// skeleton stays visible until data actually arrives.
const MIN_SKELETON_MS = 2000;
const heldLoading = ref(false);
let loadingStartedAt = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.loading,
  (loading) => {
    if (loading) {
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      loadingStartedAt = Date.now();
      heldLoading.value = true;
    } else if (heldLoading.value) {
      const elapsed = Date.now() - loadingStartedAt;
      const remaining = MIN_SKELETON_MS - elapsed;
      if (remaining <= 0) {
        heldLoading.value = false;
      } else {
        releaseTimer = setTimeout(() => {
          heldLoading.value = false;
          releaseTimer = null;
        }, remaining);
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
});

// ── Internal global filter state (uncontrolled when no parent binds :global-filter) ──
const globalFilterLocal = ref(props.globalFilter ?? "");
watch(
  () => props.globalFilter,
  (val) => {
    globalFilterLocal.value = val ?? "";
  },
);

function handleGlobalFilterChange(value: string) {
  globalFilterLocal.value = value;
  emit("update:globalFilter", value);
  if (props.filterMode === "server") {
    emit("filter-change", { global: value });
  }
}

// ── Tree mode ───────────────────────────────────────────────────
const tree = useTableTree<TData>(
  {
    get tree() { return props.tree; },
    get data() { return props.data; },
    get expandedIds() { return props.expandedIds; },
    rowKey: props.rowKey,
    getChildren: props.getChildren,
    getRowWarning: props.getRowWarning,
    treeColumnId: props.treeColumnId,
    get columns() { return props.columns; },
  },
  emit as any,
);

// Provide the computed (a reactive ref). Consumers `inject` and read `.value`.
provide(OTableTreeContextKey, tree.context);

// Expose horizontalScroll to descendant cells without prop-drilling.
provide("o2TableHorizontalScroll", computed(() => !!props.horizontalScroll));

// ── Core table instance ─────────────────────────────────────────
const {
  table,
  columnOrder,
  columnSizing,
  isClientSort,
  isClientPagination,
  columnSizeVars,
} = useTableCore<TData>(
  {
    get data() { return tree.enabled.value ? tree.flatRows.value : props.data; },
    get columns() { return props.columns; },
    get pageSize() { return props.pageSize; },
    sortBy: props.sortBy,
    sortOrder: props.sortOrder,
    sortFieldMap: props.sortFieldMap,
    get globalFilter() { return globalFilterLocal.value; },
    rowKey: props.rowKey,
    enableColumnResize: props.enableColumnResize,
    enableColumnReorder: props.enableColumnReorder,
    enableColumnPin: props.enableColumnPin,
    get columnVisibility() { return props.columnVisibility; },
    defaultColumns: props.defaultColumns,
    getSubRows: props.getSubRows,
    pagination: props.pagination,
    sorting: props.sorting,
    rowHeight: props.rowHeight,
    filterMode: props.filterMode,
  },
  emit,
);

// ── Pagination ──────────────────────────────────────────────────
const pagination = useTablePagination(table, {
  pagination: props.pagination,
  pageSize: props.pageSize,
  pageSizeOptions: props.pageSizeOptions,
  currentPage: props.currentPage,
  get totalCount() { return props.totalCount; },
  get data() { return props.data; },
}, emit);

// ── Sorting ─────────────────────────────────────────────────────
const sorting = useTableSorting(table, {
  sorting: props.sorting,
  get sortBy() { return props.sortBy; },
  get sortOrder() { return props.sortOrder; },
  get sortFieldMap() { return props.sortFieldMap; },
}, emit);

// ── Selection ───────────────────────────────────────────────────
const selection = useTableSelection(table, {
  selection: props.selection,
  get selectedIds() { return props.selectedIds; },
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
    get globalFilter() { return globalFilterLocal.value; },
    globalFilterPlaceholder: props.globalFilterPlaceholder,
    filterMode: props.filterMode,
  },
  emit,
);

// ── Highlighting ────────────────────────────────────────────────
const highlighting = useTableHighlight({
  highlightText: props.highlightText,
  highlightFields: props.highlightFields,
  enableSemanticHighlight: props.highlightFields?.length ? false : true,
  ftsKeys: (props.columns as any).ftsKeys,
});

// ── Column Management ───────────────────────────────────────────
const columnMgmt = useTableColumnManagement(
  {
    enableColumnResize: props.enableColumnResize,
    enableColumnReorder: props.enableColumnReorder,
    get columnVisibility() { return props.columnVisibility; },
    columnOrder,
    columnIds,
    pinnedFirstColumn: undefined,
  },
  emit,
);

// ── Rows to display ─────────────────────────────────────────────
const displayRows = computed(() => {
  return table.getRowModel().rows;
});

// ── Virtual scroll ──────────────────────────────────────────────
const {
  virtualRows,
  totalSize,
  baseOffset,
  measure: virtualMeasure,
} = useTableVirtualization({
  rows: displayRows,
  parentRef: scrollContainerRef,
  scrollEl: props.scrollEl ?? scrollContainerRef.value ?? undefined,
  scrollMargin: props.scrollMargin ?? 0,
  rowHeight: props.rowHeight ?? (props.dense ? 36 : 54),
  overscan: 100,
});

const isVirtual = computed(() => props.virtualScroll && displayRows.value.length > 0);

// Virtual measureElement callback — wraps the virtualizer's measure
function measureElement(el: any) {
  if (el && props.virtualScroll) {
    virtualMeasure();
  }
}

// ── Keyboard navigation ─────────────────────────────────────────
useTableKeyboard(table, scrollContainerRef, {
  enabled: computed(() => !props.loading),
  onRowSelect: (row: TData) => {
    selection.toggleRow(row);
  },
  onRowExpand: (row: TData) => {
    expansion.toggleRow(row);
  },
});

// ── Table-level empty/loading/error state ──────────────────────
// Use `heldLoading` (props.loading + min-2s hold) so skeleton doesn't flash.
// While loading, the full skeleton always wins — never show partial rows
// with a "Loading…" banner over them (that pattern lets consumers'
// progressive data mutations leak through visually). Consumers that want
// refetch-without-replacing-content should use the `streaming` prop.
const showEmpty = computed(
  () => !heldLoading.value && !props.streaming && !props.error && displayRows.value.length === 0,
);
const showError = computed(() => !heldLoading.value && !!props.error);
const showLoadingOverlay = computed(() => heldLoading.value);
/** Streaming: data is arriving incrementally. Show pulsing indicator while stream is active and data exists. */
const showStreaming = computed(
  () => props.streaming && displayRows.value.length > 0,
);

// ── Scroll event handler ────────────────────────────────────────
function handleScroll(event: Event) {
  const el = event.target as HTMLElement;
  if (!el) return;
  emit("scroll", { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });

  // Detect scroll end for lazy loading
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  if (atBottom) {
    emit("scroll-end", { scrollTop: el.scrollTop });
  }
}

// ── Debounced column size emission ─────────────────────────────
let columnSizeTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => table.getState().columnSizing,
  (newSizes) => {
    if (!props.enableColumnResize) return;
    if (columnSizeTimer) clearTimeout(columnSizeTimer);
    columnSizeTimer = setTimeout(() => {
      const idMap: Record<string, string> = {};
      for (const col of props.columns) {
        idMap[col.id] = col.id;
      }
      emit("update:columnSizes", newSizes as Record<string, number>, idMap);
    }, 500);
  },
  { deep: true },
);

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
    if (scrollContainerRef.value) {
      scrollContainerRef.value.scrollTop = 0;
    }
  },
  getRows: () => {
    return table.getRowModel().rows.map((r) => r.original);
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

    <!-- ── Bordered wrapper: search + loading + top pagination + table area ── -->
    <div class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0 tw:border tw:border-[var(--color-border-default)]">
    <!-- ── Built-in global search ─────────────────────────── -->
    <div
      v-if="props.showGlobalFilter && !slots.top"
      class="tw:flex tw:items-center tw:px-3 tw:py-2 tw:border-b tw:border-[var(--color-table-row-divider)] tw:bg-[var(--color-table-header-bg)]"
      data-test="o2-table-global-filter"
    >
      <div class="tw:relative tw:max-w-xs">
        <OIcon
          name="search"
          size="sm"
          class="tw:absolute tw:left-2 tw:top-1/2 tw:-translate-y-1/2 tw:text-secondary"
        />
        <input
          :value="globalFilterLocal"
          type="text"
          :placeholder="props.globalFilterPlaceholder"
          class="tw:pl-7 tw:pr-2 tw:py-1 tw:text-sm tw:bg-transparent tw:border-none tw:text-primary tw:placeholder-text-disabled tw:outline-none tw:w-full"
          data-test="o2-table-global-filter-input"
          @input="handleGlobalFilterChange(($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- ── Loading banner (shown when streaming with existing data) ──
         Only used for the streaming pattern now — when `loading=true`,
         the table body switches to the full skeleton instead. -->
    <slot
      v-if="props.streaming && displayRows.length > 0 && slots['loading-banner']"
      name="loading-banner"
    />
    <OBanner
      v-else-if="props.streaming && displayRows.length > 0"
      variant="info"
      :content="'Loading...'"
      dense
      data-test="o2-table-loading-banner"
    />

    <!-- ── Scrollable table area ────────────────────────────── -->
    <div
      ref="scrollContainerRef"
      class="tw:flex tw:flex-col tw:flex-1 tw:overflow-auto tw:min-h-0 tw:relative"
      :style="{
        maxHeight: props.maxHeight
          ? typeof props.maxHeight === 'number'
            ? `${props.maxHeight}px`
            : props.maxHeight
          : undefined,
      }"
      data-test="o2-table-scroll-container"
      @scroll="handleScroll"
    >
      <table
        :class="[
          props.horizontalScroll ? 'tw:min-w-max' : 'tw:w-full',
          props.horizontalScroll || props.defaultColumns ? 'tw:table-auto' : 'tw:table-fixed',
          (props.bordered && !props.columns.some((c) => c.pinned || c.isAction)) ? '' : 'tw:border-separate tw:border-spacing-0',
        ]"
        :style="{
          ...columnSizeVars,
          '--o2-table-row-height': props.rowHeight != null
            ? `${props.rowHeight}px`
            : (props.dense ? 'var(--table-row-height-dense, 2.25rem)' : 'var(--table-row-height-normal, 2.75rem)'),
        }"
        data-test="o2-table"
      >
        <!-- ── Header ───────────────────────────────────────── -->
        <OTableHeader
          v-if="props.showHeader"
          :header-groups="table.getHeaderGroups()"
          :table="table"
          :column-order="columnOrder"
          :selection-multiple="selection.isMultiple.value"
          :is-all-selected="selection.isAllSelected()"
          :is-indeterminate="selection.isIndeterminate()"
          :expansion-enabled="expansion.isEnabled.value"
          :enable-column-reorder="props.enableColumnReorder"
          :enable-column-resize="props.enableColumnResize"
          :is-resizing="columnMgmt.isResizing.value"
          :sorting-enabled="sorting.isEnabled.value"
          :sort-by="sorting.activeSortBy.value ?? undefined"
          :sort-order="sorting.activeSortOrder.value ?? undefined"
          :sort-field-map="props.sortFieldMap"
          :get-sort-icon="sorting.getSortIcon"
          :sticky-header="props.stickyHeader"
          :bordered="props.bordered"
          :dense="props.dense"
          :pivot-header-levels="props.pivotHeaderLevels"
          :pivot-row-columns="props.pivotRowColumns"
          :sticky-col-totals="props.stickyColTotals"
          @toggle-all-rows="selection.toggleAllRows"
          @sort="sorting.handleSort"
          @column-close="columnMgmt.closeColumn"
          @update:column-order="(order: string[]) => { columnOrder = order; }"
          @drag-start="columnMgmt.onDragStart"
          @drag-end="columnMgmt.onDragEnd"
        />

        <!-- ── Skeleton Body (loading with no existing data) ───── -->
        <OTableLoading
          v-if="showLoadingOverlay"
          :rows="props.pageSize ?? 10"
          :table-columns="table.getVisibleLeafColumns()"
          :selection-enabled="selection.isEnabled.value"
          :expansion-enabled="expansion.isEnabled.value"
        />

        <!-- ── Body ─────────────────────────────────────────── -->
        <OTableBody
          v-else-if="!showEmpty && !showError"
          :rows="displayRows"
          :table="table"
          :selection-enabled="selection.isEnabled.value"
          :selection-multiple="selection.isMultiple.value"
          :is-row-selected-fn="(row: TData) => selection.isRowSelected(row)"
          :expansion-enabled="expansion.isEnabled.value"
          :is-expanded-fn="(row: TData) => expansion.isExpanded(row)"
          :get-row-expansion-enabled="props.getRowExpansionEnabled"
          :highlight-text="props.highlightText"
          :should-highlight-column="highlighting.shouldHighlightColumn"
          :get-highlighted-html="highlighting.getHighlightedHtml"
          :wrap="props.wrap"
          :dense="props.dense"
          :bordered="props.bordered"
          :striped="props.striped"
          :row-class="(props.rowClass as any)"
          :row-style-fn="props.getRowStyle"
          :get-status-bar-color="props.getRowStatusColor"
          :enable-cell-copy="props.enableCellCopy"
          :loading="props.loading"
          :get-cell-style="(props.getCellStyle as any)"
          :virtual-rows="isVirtual ? virtualRows : undefined"
          :total-size="isVirtual ? totalSize : undefined"
          :base-offset="isVirtual ? baseOffset : undefined"
          :measure-element="isVirtual ? measureElement : undefined"
          @toggle-selection="selection.toggleRow"
          @toggle-expansion="expansion.toggleRow"
          @row-click="(row: TData, evt: MouseEvent) => {
            const canExpand = typeof props.expandOnRowClick === 'function'
              ? props.expandOnRowClick(row)
              : props.expandOnRowClick;
            if (canExpand) expansion.toggleRow(row);
            emit('row-click', row, evt);
          }"
          @row-dblclick="(row: TData, evt: MouseEvent) => emit('row-dblclick', row, evt)"
          @cell-click="(params: any) => emit('cell-click', params)"
        >
          <!-- Pass through named cell slots from parent (only for columns where parent provides a slot) -->
          <template
            v-for="col in cellSlotColumns"
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

          <!-- Expansion slot -->
          <template v-if="slots.expansion" #expansion="expSlotProps">
            <slot name="expansion" :row="expSlotProps.row" />
          </template>

          <!-- Tree-mode warning row slot -->
          <template v-if="slots['tree-warning']" #tree-warning="warnSlotProps">
            <slot name="tree-warning" :row="warnSlotProps.row" />
          </template>
        </OTableBody>

        <!-- ── Footer (sticky totals row) ─────────────────────── -->
        <tfoot
          v-if="table.getFooterGroups().some(fg => fg.headers.some(h => h.column.columnDef.footer))"
          data-test="o2-table-footer"
          class="tw:sticky tw:bottom-0 tw:z-10"
        >
          <tr
            v-for="footerGroup in table.getFooterGroups()"
            :key="footerGroup.id"
            class="tw:bg-[var(--color-table-header-bg)]"
          >
            <!-- Expand placeholder -->
            <th
              v-if="expansion.isEnabled.value"
              class="tw:w-0 tw:px-0"
            />
            <!-- Selection placeholder -->
            <th
              v-if="selection.isMultiple.value"
              class="tw:w-0"
            />
            <th
              v-for="header in footerGroup.headers"
              :key="header.id"
              :colspan="header.colSpan"
              :data-test="`o2-table-footer-cell-${header.id}`"
              :class="[
                'tw:px-2 tw:py-1 tw:text-left tw:font-semibold tw:text-primary tw:text-xs',
                'tw:border-t tw:border-[var(--color-table-header-border)]',
                (header.column.columnDef.meta as any)?.align === 'center' ? 'tw:text-center' : '',
                (header.column.columnDef.meta as any)?.align === 'right' ? 'tw:text-right' : '',
              ]"
              :style="{
                width: `var(--header-${header.id.replace(/[^a-zA-Z0-9]/g, '-')}-size)`,
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
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.footer"
                :props="header.getContext()"
              />
            </th>
          </tr>
        </tfoot>
      </table>

      <!-- ── Empty State ───────────────────────────────────── -->
      <OTableEmpty
        v-if="showEmpty"
        :message="props.emptyMessage"
      >
        <template v-if="slots.empty" #default>
          <slot name="empty" />
        </template>
      </OTableEmpty>

      <!-- ── Custom loading slot (overlay) ───────────────────── -->
      <div
        v-if="showLoadingOverlay && slots.loading"
        class="tw:absolute tw:inset-0 tw:z-10 tw:bg-surface-base/70 tw:flex tw:items-center tw:justify-center"
        data-test="o2-table-loading-slot"
      >
        <slot name="loading" />
      </div>

      <!-- ── Error State ────────────────────────────────────── -->
      <OTableError
        v-if="showError"
        :message="props.error ?? ''"
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

      <!-- ── Streaming Indicator ─────────────────────────────── -->
      <div
        v-if="showStreaming"
        data-test="o2-table-streaming-bar"
        class="tw:sticky tw:bottom-0 tw:h-1 tw:w-full tw:bg-[var(--color-table-streaming-bar)] tw:animate-pulse tw:z-10"
        aria-label="Data streaming in progress"
      />
    </div>

    <!-- ── Bottom Pagination (with optional bulk actions slot) ── -->
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
      :title="props.footerTitle"
      :loading="heldLoading"
      @update:page-size="pagination.setPageSize"
      @first-page="pagination.firstPage"
      @prev-page="pagination.prevPage"
      @next-page="pagination.nextPage"
      @last-page="pagination.lastPage"
    >
      <!-- OTablePagination authoritatively swaps the slot for a skeleton when
           its `loading` prop is true, so we can always pass the slot. -->
      <template v-if="slots.bottom" #actions>
        <slot
          name="bottom"
          :current-page="pagination.currentPage.value"
          :page-size="pagination.pageSize.value"
          :total-pages="pagination.totalPages.value"
          :total-rows="pagination.totalCount.value"
          :is-first-page="pagination.isFirstPage.value"
          :is-last-page="pagination.isLastPage.value"
          :set-page-size="pagination.setPageSize"
          :first-page="pagination.firstPage"
          :prev-page="pagination.prevPage"
          :next-page="pagination.nextPage"
          :last-page="pagination.lastPage"
        />
      </template>
    </OTablePagination>
    </div> <!-- /bordered wrapper -->
  </div>
</template>
