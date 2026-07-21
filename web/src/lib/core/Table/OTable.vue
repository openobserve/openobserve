<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts" generic="TData extends Record<string, any>">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { useTableColumnPersistence } from "./composables/useTableColumnPersistence";
import OTableColumnToggle from "./sub-components/OTableColumnToggle.vue";
import { FlexRender } from "@tanstack/vue-table";
import { TABLE_CHECKBOX_COL_SIZE, type OTableProps, type OTableEmits, type OTableSlots } from "./OTable.types";

import { useTableCore } from "./composables/useTableCore";
import { useTablePagination } from "./composables/useTablePagination";
import { useTableSorting } from "./composables/useTableSorting";
import { useTableSelection } from "./composables/useTableSelection";
import { useTableExpansion } from "./composables/useTableExpansion";
import { useTableTree, OTableTreeContextKey } from "./composables/useTableTree";
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
  enableRowReorder: false,
  persistColumns: false,
  loading: false,
  streaming: false,
  error: null,
  dense: true,
  bordered: true,
  // No outer box border on tables (design system): the app chrome already frames
  // content, and CRUD listing tables sit flush to the edges. Row dividers (the
  // `bordered` row-bottom hairlines) stay; only the surrounding border is gone.
  frame: false,
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
  fillHeight: true,
});

const emit = defineEmits<OTableEmits<TData>>();
const slots = defineSlots<OTableSlots<TData>>();

// A row only gets the pointer cursor when it's actually interactive — i.e. the
// parent listens for @row-click / @row-dblclick, or row-click toggles expansion.
// Otherwise rows are display-only and keep the default cursor.
const instance = getCurrentInstance();
const isRowClickable = computed(() => {
  const listeners = instance?.vnode.props ?? {};
  const hasRowClick = !!(listeners.onRowClick || listeners.onRowDblclick);
  const expandOnClick =
    typeof props.expandOnRowClick === "function" ? true : !!props.expandOnRowClick;
  return hasRowClick || expandOnClick;
});

// Only forward cell-slot templates for columns whose cell slot the parent actually provides.
// If we forward an empty slot for every column, OTableBodyCell sees $slots.default as truthy
// and renders the (empty) slot instead of falling through to the plain-text {{ displayValue }}.
const cellSlotColumns = computed(() =>
  props.columns.filter((col) => slots[`cell-${col.id}`]),
);

// ── Refs for virtual scroll & keyboard ──────────────────────────
const scrollContainerRef = ref<HTMLElement | null>(null);
const columnIds = computed(() => props.columns.map((c) => c.id));

// ── Skeleton row count strategy ─────────────────────────────────
// Easy to switch between strategies — change the `SKELETON_ROW_STRATEGY`
// constant below. Pending team discussion on which feels right.
//
//   "fixed"     → always show FIXED_SKELETON_ROWS rows (GitHub style).
//                 Predictable, doesn't over-promise on tall pageSizes.
//   "pageSize"  → match the table's pageSize (Stripe / Vercel style).
//                 Skeleton fills the page; can feel excessive when the
//                 real dataset turns out to be small.
const SKELETON_ROW_STRATEGY = "fixed" as "fixed" | "pageSize";
const FIXED_SKELETON_ROWS = 8;

const skeletonRowCount = computed(() => {
  if (SKELETON_ROW_STRATEGY === "pageSize") {
    return props.pageSize ?? FIXED_SKELETON_ROWS;
  }
  return FIXED_SKELETON_ROWS;
});

// ── Skeleton hold ───────────────────────────────────────────────
// Show the skeleton for at least 50ms once loading starts, so it doesn't
// flash-and-disappear on fast responses. If the server is slow, the
// skeleton stays visible until data actually arrives.
const MIN_SKELETON_MS = 50;
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

// ── Column persistence ──────────────────────────────────────────
const persistence = useTableColumnPersistence({
  tableId: props.tableId,
  enabled: props.persistColumns && !!props.tableId,
});

// Internal column visibility — merges the prop default with any persisted
// overrides. Managed as a ref so OTableColumnToggle can mutate it without
// requiring the parent to bind v-model:columnVisibility.
const internalColumnVisibility = ref<Record<string, boolean>>({
  ...(props.columnVisibility ?? {}),
  ...(persistence.loadColumnVisibility() ?? {}),
});

// Keep in sync when the parent's prop changes (e.g. programmatic reset)
watch(
  () => props.columnVisibility,
  (val) => {
    if (!val) return;
    internalColumnVisibility.value = {
      ...val,
      ...(persistence.isActive ? persistence.loadColumnVisibility() ?? {} : {}),
    };
  },
);

function handleColumnVisibilityChange(visibility: Record<string, boolean>): void {
  internalColumnVisibility.value = visibility;
  persistence.saveColumnVisibility(visibility);
  emit("column-visibility-change", visibility);
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
  effectiveColumns,
  columnOrder,
  columnSizing,
  columnSizeVars,
} = useTableCore<TData>(
  {
    get data() { return tree.enabled.value ? tree.flatRows.value : props.data; },
    get columns() { return props.columns; },
    get pageSize() { return props.pageSize; },
    get currentPage() { return props.currentPage; },
    showIndex: props.showIndex,
    sortBy: props.sortBy,
    sortOrder: props.sortOrder,
    sortFieldMap: props.sortFieldMap,
    get globalFilter() { return globalFilterLocal.value; },
    rowKey: props.rowKey,
    enableColumnResize: props.enableColumnResize,
    enableColumnReorder: props.enableColumnReorder,
    enableColumnPin: props.enableColumnPin,
    get columnVisibility() { return internalColumnVisibility.value; },
    defaultColumns: props.defaultColumns,
    initialColumnSizes: persistence.loadColumnSizes(),
    getSubRows: props.getSubRows,
    pagination: props.pagination,
    sorting: props.sorting,
    rowHeight: props.rowHeight,
    filterMode: props.filterMode,
    get horizontalScroll() { return props.horizontalScroll; },
    get keepPageOnDataChange() { return props.keepPageOnDataChange; },
  },
  emit,
);

// ── Column resize reset ─────────────────────────────────────────
const hasResizedColumns = computed(() =>
  Object.keys(table.getState().columnSizing).length > 0,
);

function handleResetColumnSizes(): void {
  table.resetColumnSizing?.();
  persistence.saveColumnSizes({});
  // Drop the frozen floors so reset matches a fresh load (flex columns re-fill).
  frozen.value = false;
}

// ── Pagination ──────────────────────────────────────────────────
const pagination = useTablePagination(table, {
  pagination: props.pagination,
  pageSize: props.pageSize,
  pageSizeOptions: props.pageSizeOptions,
  get currentPage() { return props.currentPage; },
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
  // Forward the per-row guard so "Select All" only toggles rows the caller
  // marked selectable. Without this, parents that drop non-selectable rows
  // from `selectedIds` can never reach a fully-selected state and the header
  // checkbox stays stuck in "select" mode forever.
  get isRowSelectable() { return props.isRowSelectable; },
}, emit);

// ── Expansion ───────────────────────────────────────────────────
const expansion = useTableExpansion<TData>(
  {
    expansion: props.expansion,
    expandedIds: () => props.expandedIds,
    rowKey: props.rowKey,
    getSubRows: props.getSubRows,
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
    get columnVisibility() { return internalColumnVisibility.value; },
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
  // Keep this in sync with the --table-row-height-* tokens (dense = 38px) so the
  // virtualizer's measured height matches the actual rendered row height.
  rowHeight: props.rowHeight ?? (props.dense ? 38 : 54),
  overscan: 100,
});

const isVirtual = computed(() => props.virtualScroll && displayRows.value.length > 0);

// ── Per-column CSS size-var overrides ──────────────────────────
// Override channel the table style/sums read from, overriding the nominal sizes
// computed in useTableCore. The actions column is sized deterministically from
// its icon count in useTableCore (so the skeleton and loaded table match), so
// this currently stays empty.
const measuredColumnSizeVars = ref<Record<string, string>>({});

// ── Flex-fill measurement ───────────────────────────────────────
// While filling (not frozen), the flex column's width = the container's
// clientWidth minus the ACTUAL rendered widths of every other header cell.
// Measuring (rather than arithmetic) makes it pixel-exact: it accounts for the
// vertical scrollbar (clientWidth excludes it) and any sub-pixel rounding, so
// the table fills with no gap AND no 1-10px overflow scrollbar.
const measuredFlexFill = ref<Record<string, number>>({});

function measureFlexFill() {
  const root = scrollContainerRef.value;
  if (!root || frozen.value || !flexColIds.value.length) {
    if (Object.keys(measuredFlexFill.value).length) measuredFlexFill.value = {};
    return;
  }
  const cw = root.clientWidth;
  if (!cw) return;
  const ids = flexColIds.value;
  const skip = new Set([...ids.map((id) => `o2-table-th-${id}`), `o2-table-th-${SPACER_ID}`]);
  let nonFlexSum = 0;
  root
    .querySelectorAll<HTMLElement>('thead th[data-test^="o2-table-th-"]')
    .forEach((th) => {
      if (skip.has(th.getAttribute("data-test") || "")) return;
      nonFlexSum += th.getBoundingClientRect().width;
    });
  // Floor the leftover so the flex column can NEVER be a sub-pixel wider than the
  // exact remaining space — that rounding is what shows as a 1-2px scrollbar.
  const available = Math.max(0, Math.floor(cw - nonFlexSum));
  const per = Math.max(Math.floor(available / ids.length), 0);
  const next: Record<string, number> = {};
  ids.forEach((id, i) => {
    const w = i === ids.length - 1 ? available - per * (ids.length - 1) : per;
    next[id] = Math.max(w, colMinSize(id));
  });
  const cur = measuredFlexFill.value;
  const changed =
    Object.keys(cur).length !== ids.length || ids.some((id) => cur[id] !== next[id]);
  if (changed) measuredFlexFill.value = next;
}

function scheduleMeasureActions() {
  // The actions column is sized deterministically (no DOM measurement), so only
  // the flex fill needs measuring. Do it after the DOM settles.
  nextTick(() => requestAnimationFrame(measureFlexFill));
}

onMounted(scheduleMeasureActions);
// NOTE: the watch that re-runs the measurements lives AFTER `frozen` /
// `containerWidth` are declared (below), to avoid a temporal-dead-zone access.

// ── Resizable-table width strategy (flex tables) ────────────────
// `table-fixed; width:100%` would squeeze sibling columns when one is resized
// (they can collapse past their min-width). Instead, for tables with a `flex`
// column we drive widths explicitly:
//   • the flex column fills the leftover (measured exactly, see measureFlexFill);
//   • once a column is resized (`frozen`), every column holds its width and an
//     invisible trailing spacer absorbs any slack so the pinned actions column
//     stays flush-right and the table grows + scrolls only as needed.
// `containerWidth` tracks the scroll container's live inner width.
const EXPANSION_COL_WIDTH = 16; // w-4
const containerWidth = ref(0);
let containerRO: ResizeObserver | null = null;

onMounted(() => {
  if (scrollContainerRef.value && typeof ResizeObserver !== "undefined") {
    containerWidth.value = scrollContainerRef.value.clientWidth;
    containerRO = new ResizeObserver(() => {
      containerWidth.value = scrollContainerRef.value?.clientWidth ?? 0;
    });
    containerRO.observe(scrollContainerRef.value);
  }
});
onBeforeUnmount(() => {
  containerRO?.disconnect();
  containerRO = null;
});

// ── Flex columns (fill-until-first-resize) ──────────────────────
// Columns the page marks `meta.flex` divide the leftover width on initial
// render (so the table fills the viewport with no empty space). The first time
// the user drags any column, the flex columns freeze at their current width and
// the table switches to Excel-style fixed widths (grow + horizontal scroll).
const flexColIds = computed(() =>
  table
    .getVisibleLeafColumns()
    .filter((c) => (c.columnDef.meta as any)?.flex)
    .map((c) => c.id),
);

// Excel-style explicit-width mode applies ONLY to tables with a `flex` filler
// (alerts/streams). Such tables NEVER use width:100% — they always set an
// explicit table width so `table-fixed` can't squeeze columns: it fills the
// container while flex fills, and grows + scrolls once a column is resized.
// Tables that instead use `meta.autoWidth` keep the simpler width:100% elastic
// layout (unchanged).
const useComputedWidth = computed(
  () =>
    (props.enableColumnResize ?? false) &&
    !props.horizontalScroll &&
    !props.defaultColumns &&
    flexColIds.value.length > 0,
);

// True when the table has a filler column (flex or autoWidth) that absorbs the
// leftover width — i.e. it's designed to exactly fit its container and should
// never need a horizontal scrollbar in the fill state.
const hasFillColumn = computed(() =>
  table
    .getVisibleLeafColumns()
    .some((c) => {
      const m = c.columnDef.meta as any;
      return m?.flex || m?.autoWidth;
    }),
);

// Suppress the horizontal scrollbar for fill tables that aren't intentionally
// scrolling (sub-pixel rounding otherwise shows a 1-2px scrollbar). Keep it for
// horizontal-scroll tables and frozen flex tables ONLY when the columns
// genuinely exceed the container (a column was resized wider) — when the spacer
// is still absorbing the leftover the table fits, so a stray 1-2px scrollbar
// from rounding must stay hidden.
const allowHorizontalScroll = computed(() => {
  if (props.horizontalScroll) return true;
  if (!hasFillColumn.value) return true;
  if (useComputedWidth.value) {
    if (containerWidth.value <= 0) return false;
    // Frozen → scroll once the resized columns exceed the container.
    if (frozen.value) return realSum() > containerWidth.value + 1;
    // Fill → scroll once the columns can't fit even at their min widths
    // (table-fixed otherwise grows past 100% and the overflow is clipped).
    return fillMinSum() > containerWidth.value + 1;
  }
  return false;
});

const SPACER_ID = "__spacer__";

function sizeVarKeys(id: string): [string, string] {
  const safe = id.replace(/[^a-zA-Z0-9]/g, "-");
  return [`--header-${safe}-size`, `--col-${id}-size`];
}

function colMinSize(id: string): number {
  return table.getColumn(id)?.columnDef.minSize ?? 48;
}

// ── Fill ⇄ frozen state ─────────────────────────────────────────
// Fill state (initial): flex columns ABSORB the leftover via the table's
// width:100% — the browser computes their width (immune to any px-rounding in
// our own sums, so no stray scrollbar). The spacer is 0.
// Frozen state (after the first resize): each flex column holds an explicit
// width stored in `columnSizing` (so it's independently resizable), and the
// invisible `__spacer__` column absorbs leftover to keep the table ≥ container
// (actions stays flush-right; blank space lands in the spacer on shrink).
const frozen = ref(false);

// Re-run the action + flex-fill measurements whenever the inputs change.
// (Declared here — after `frozen`/`containerWidth` — to avoid a TDZ access.)
watch(
  [
    displayRows,
    effectiveColumns,
    () => props.loading,
    () => props.dense,
    () => frozen.value,
    () => measuredColumnSizeVars.value,
    () => containerWidth.value,
    // Re-measure when columns are hidden/shown from the picker — otherwise the
    // flex fill is stale and `table-fixed` redistributes the freed width to the
    // rigid columns (the `#` column visibly grows).
    () => internalColumnVisibility.value,
  ],
  scheduleMeasureActions,
  { flush: "post" },
);

// Frozen width of a flex column — TanStack's getSize() already reflects the
// resized size (or the freeze-captured fill written into columnSizing, or the
// base `size` after a double-click reset). Always at least its min.
function frozenFlexWidth(id: string): number {
  void columnSizing.value;
  const sz = table.getColumn(id)?.getSize();
  return Math.max(typeof sz === "number" ? sz : colMinSize(id), colMinSize(id));
}

// Sum of all columns whose width is fixed/known (everything except the flex
// columns and the spacer): data columns + selection/expansion gutters. Actions
// uses its measured width.
function nonFlexFixedSum(): number {
  const measured = measuredColumnSizeVars.value;
  let sum = 0;
  for (const col of table.getVisibleLeafColumns()) {
    const m = col.columnDef.meta as any;
    if (m?.flex || m?.spacer || m?.autoWidth) continue;
    const measuredVar = m?.isAction ? measured[`--col-${col.id}-size`] : undefined;
    sum += measuredVar ? parseFloat(measuredVar) : col.getSize();
  }
  if (selection.isMultiple.value) sum += TABLE_CHECKBOX_COL_SIZE;
  if (expansion.isEnabled.value) sum += EXPANSION_COL_WIDTH;
  return sum;
}

// Sum of the real columns in the frozen state (fixed + flex at their frozen
// widths). The spacer fills (container − this).
function realSum(): number {
  return (
    nonFlexFixedSum() +
    flexColIds.value.reduce((a, id) => a + frozenFlexWidth(id), 0)
  );
}

// Minimum width the table needs in the FILL state: fixed columns + every flex
// column shrunk to its minSize. When this exceeds the container the flex fill
// can no longer absorb the overflow (table-fixed grows the table past 100%), so
// the table must scroll horizontally instead of clipping the trailing columns.
function fillMinSum(): number {
  return (
    nonFlexFixedSum() +
    flexColIds.value.reduce((a, id) => a + colMinSize(id), 0)
  );
}

// CSS size-var overrides:
//  • Fill state → each flex column = its (measured) fill width; spacer = 0.
//  • Frozen state → each flex column = its frozen width; spacer = the leftover.
const dynamicSizeVars = computed<Record<string, string>>(() => {
  const vars: Record<string, string> = {};
  if (!useComputedWidth.value || containerWidth.value <= 0) return vars;
  void columnSizing.value;
  // Each flex column gets an EXPLICIT width via its CSS var (never relies on the
  // browser's table-fixed auto-distribution, which with border-separate could
  // leave the leftover as a trailing gap): while filling, the MEASURED fill
  // (exact) — falling back to the arithmetic estimate until measured — and its
  // stored width once frozen.
  const arith = frozen.value ? null : fillWidths();
  for (const id of flexColIds.value) {
    const w = frozen.value
      ? frozenFlexWidth(id)
      : (measuredFlexFill.value[id] ?? arith![id] ?? colMinSize(id));
    const [h, c] = sizeVarKeys(id);
    vars[h] = `${w}px`;
    vars[c] = `${w}px`;
  }
  // Spacer: 0 while filling (flex fills exactly), the leftover once frozen.
  const [spacerHeaderVar, spacerColVar] = sizeVarKeys(SPACER_ID);
  const spacerW = frozen.value ? Math.max(0, containerWidth.value - realSum()) : 0;
  vars[spacerHeaderVar] = `${spacerW}px`;
  vars[spacerColVar] = `${spacerW}px`;
  return vars;
});

// Arithmetic fill widths (container leftover split across the flex columns).
// Drives both the fill-state CSS var and the freeze.
function fillWidths(): Record<string, number> {
  const ids = flexColIds.value;
  const out: Record<string, number> = {};
  if (!ids.length || containerWidth.value <= 0) return out;
  const mins = ids.map(colMinSize);
  const minTotal = mins.reduce((a, b) => a + b, 0);
  const available = containerWidth.value - nonFlexFixedSum();
  if (available <= minTotal) {
    ids.forEach((id, i) => (out[id] = mins[i]));
    return out;
  }
  const extra = available - minTotal;
  const per = Math.floor(extra / ids.length);
  ids.forEach((id, i) => {
    out[id] = mins[i] + (i === ids.length - 1 ? extra - per * (ids.length - 1) : per);
  });
  return out;
}

// Freeze on the first resize (called SYNCHRONOUSLY from the header `resize-start`
// before TanStack captures the drag). Measure each flex column's CURRENT filled
// width from the DOM and pin it into `columnSizing`, then switch to frozen mode.
function freezeFlexColumns(): void {
  if (frozen.value) return;
  const ids = flexColIds.value;
  if (!ids.length) return;
  // Pin each flex column to its ACTUAL rendered width so TanStack's resize
  // starts from exactly where the column is — no jump. The DOM is current at
  // mousedown, so getBoundingClientRect is reliable; the arithmetic fill is a
  // fallback for when the element isn't found / has no layout (tests). (Arithmetic
  // alone can be off where a column's rendered width differs from its nominal size.)
  const fills = fillWidths();
  const sizing = { ...columnSizing.value };
  for (const id of ids) {
    let w = 0;
    const th = scrollContainerRef.value?.querySelector(
      `th[data-test="o2-table-th-${id}"]`,
    ) as HTMLElement | null;
    if (th) w = Math.round(th.getBoundingClientRect().width);
    if (!w) w = fills[id] ?? colMinSize(id);
    sizing[id] = Math.max(w, colMinSize(id));
  }
  columnSizing.value = sizing;
  frozen.value = true;
}

const computedTableWidth = computed<string | undefined>(() => {
  if (!useComputedWidth.value) return undefined;
  // Fill state → width:100% (w-full class): the table can't overflow (no stray
  // scrollbar); the flex column fills via its explicit measured width.
  if (!frozen.value) return undefined;
  void columnSizing.value;
  void effectiveColumns.value;
  void measuredColumnSizeVars.value;
  // Frozen → width = max(container, Σ real columns). The spacer absorbs the
  // difference: increase a column → Σ > container → scroll; decrease → Σ <
  // container → spacer grows (blank before the flush-right actions). Real
  // columns always get their exact width — no redistribution.
  return `${Math.max(containerWidth.value || 0, realSum())}px`;
});

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

// ── Debounced column size emission + persistence ────────────────
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
      persistence.saveColumnSizes(newSizes as Record<string, number>);
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
  resetColumnSizes: () => {
    table.resetColumnSizing?.();
    frozen.value = false;
  },
  resetColumnOrder: () => {
    columnOrder.value = props.columns.map((c) => c.id);
  },
  resetPersistedColumns: () => {
    persistence.clearPersistedState();
    internalColumnVisibility.value = { ...(props.columnVisibility ?? {}) };
    table.resetColumnSizing?.();
    frozen.value = false;
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
    :class="['flex flex-col overflow-hidden', props.fillHeight ? 'h-full' : 'h-auto']"
  >
    <!-- ── Top slot (search bar, title, actions) ─────────────── -->
    <slot name="top" />

    <!-- ── Bordered wrapper: search + loading + top pagination + table area ── -->
    <div
      class="flex-1 flex flex-col min-h-0"
      :class="props.frame ? 'border border-border-default' : ''"
    >
    <!-- ── Custom toolbar slot (rendered INSIDE the frame, above the table) ── -->
    <div
      v-if="slots.toolbar || slots['toolbar-trailing']"
      class="flex items-center px-page-edge py-2 gap-2 border-b border-table-row-divider"
      data-test="o2-table-toolbar"
    >
      <slot name="toolbar" />
      <OTableColumnToggle
        v-if="props.persistColumns && props.tableId && props.columns.some((c) => c.hideable && !c.isAction)"
        :columns="props.columns"
        :column-visibility="internalColumnVisibility"
        :has-resized-columns="props.enableColumnResize && hasResizedColumns"
        class="shrink-0"
        data-test="o2-table-column-toggle"
        @update:column-visibility="handleColumnVisibilityChange"
        @reset:column-sizes="handleResetColumnSizes"
      />
      <slot name="toolbar-trailing" />
    </div>
    <!-- ── Built-in global search ─────────────────────────── -->
    <div
      v-if="props.showGlobalFilter && !slots.top && !slots.toolbar"
      class="flex items-center gap-2 px-page-edge py-2 border-b border-table-row-divider bg-table-header-bg"
      data-test="o2-table-global-filter"
    >
      <div class="relative max-w-xs flex-1">
        <OIcon
          name="search"
          size="sm"
          class="absolute left-2 top-1/2 -translate-y-1/2 text-secondary"
        />
        <input
          :value="globalFilterLocal"
          type="text"
          :placeholder="props.globalFilterPlaceholder"
          class="pl-7 pr-2 py-1 text-sm bg-transparent border-none text-primary placeholder-text-disabled outline-none w-full"
          data-test="o2-table-global-filter-input"
          @input="handleGlobalFilterChange(($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- Column visibility toggle — inline with search bar -->
      <OTableColumnToggle
        v-if="props.persistColumns && props.tableId && props.columns.some((c) => c.hideable && !c.isAction)"
        :columns="props.columns"
        :column-visibility="internalColumnVisibility"
        :has-resized-columns="props.enableColumnResize && hasResizedColumns"
        data-test="o2-table-column-toggle"
        @update:column-visibility="handleColumnVisibilityChange"
        @reset:column-sizes="handleResetColumnSizes"
      />
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
      :class="['flex flex-col overflow-y-auto min-h-0 relative', allowHorizontalScroll ? 'overflow-x-auto' : 'overflow-x-hidden', props.fillHeight ? 'flex-1' : '']"
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
          props.horizontalScroll ? 'min-w-max' : ((useComputedWidth && frozen) ? '' : 'w-full'),
          props.horizontalScroll || props.defaultColumns ? 'table-auto' : 'table-fixed',
          (props.bordered && !props.columns.some((c) => c.pinned || c.isAction)) ? '' : 'border-separate border-spacing-0',
          // Symmetric edge inset (SPACING_AUDIT.md §7): the first and last cell
          // content sit --spacing-table-edge (14px) from the table edges on EVERY
          // table, while the per-cell row dividers still span the full width
          // (full-bleed). Applied unconditionally so all tables align identically;
          // the compact `.o2-table` modifier still overrides it via !important, and
          // a leading checkbox/expand/drag gutter supplies the left inset on its
          // own (same token — see the CSS).
          'o2-table--edge-inset',
        ]"
        :style="{
          ...columnSizeVars,
          ...measuredColumnSizeVars,
          ...dynamicSizeVars,
          ...(computedTableWidth ? { width: computedTableWidth } : {}),
          '--table-row-height': props.rowHeight != null
            ? `${props.rowHeight}px`
            : (props.dense ? 'var(--table-row-height-dense, 2.25rem)' : 'var(--table-row-height-normal, 2.75rem)'),
        }"
        data-test="o2-table"
        :data-test-loading="props.loading ? 'true' : 'false'"
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
          :enable-row-reorder="props.enableRowReorder"
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
          @update:column-order="(order: string[]) => { columnOrder = order; }"
          @drag-start="columnMgmt.onDragStart"
          @drag-end="columnMgmt.onDragEnd"
          @resize-start="freezeFlexColumns"
        />

        <!-- ── Skeleton Body (loading with no existing data) ───── -->
        <OTableLoading
          v-if="showLoadingOverlay"
          :rows="skeletonRowCount"
          :table-columns="table.getVisibleLeafColumns()"
          :selection-enabled="selection.isEnabled.value"
          :expansion-enabled="expansion.isEnabled.value"
          :enable-row-reorder="props.enableRowReorder"
          :bordered="props.bordered"
        />

        <!-- ── Body ─────────────────────────────────────────── -->
        <OTableBody
          v-else-if="!showEmpty && !showError"
          :rows="displayRows"
          :table="table"
          :clickable="isRowClickable"
          :selection-enabled="selection.isEnabled.value"
          :selection-multiple="selection.isMultiple.value"
          :is-row-selected-fn="(row: TData) => selection.isRowSelected(row)"
          :is-row-selectable="props.isRowSelectable"
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
          :enable-row-reorder="props.enableRowReorder"
          :disable-row-reorder="props.disableRowReorder"
          :global-filter-active="!!globalFilterLocal"
          :row-key="props.rowKey"
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
          @row-reorder="(data: TData[]) => emit('row-reorder', data)"
          @row-dblclick="(row: TData, evt: MouseEvent) => emit('row-dblclick', row, evt)"
          @row-mouseenter="(row: TData, evt: MouseEvent) => emit('row-mouseenter', row, evt)"
          @row-mouseleave="(row: TData) => emit('row-mouseleave', row)"
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
              :index="slotProps.index"
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
          class="sticky bottom-0 z-10"
        >
          <tr
            v-for="footerGroup in table.getFooterGroups()"
            :key="footerGroup.id"
            class="bg-table-header-bg"
          >
            <!-- Expand placeholder -->
            <th
              v-if="expansion.isEnabled.value"
              class="w-0 px-0"
            />
            <!-- Selection placeholder -->
            <th
              v-if="selection.isMultiple.value"
              class="w-0"
            />
            <!-- Drag handle placeholder -->
            <th
              v-if="props.enableRowReorder"
              class="w-0 px-0"
            />
            <th
              v-for="header in footerGroup.headers"
              :key="header.id"
              :colspan="header.colSpan"
              :data-test="`o2-table-footer-cell-${header.id}`"
              :class="[
                'px-2 py-1 text-left text-text-body text-xs',
                'border-t border-table-header-border',
                (header.column.columnDef.meta as any)?.align === 'center' ? 'text-center' : '',
                (header.column.columnDef.meta as any)?.align === 'right' ? 'text-right' : '',
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
        class="absolute inset-0 z-10 bg-surface-base/70 flex items-center justify-center"
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
        class="sticky bottom-0 h-1 w-full bg-table-streaming-bar animate-pulse z-10"
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
      <template
        v-if="slots.bottom"
        #actions
      >
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

<style scoped>
/* Symmetric edge inset (SPACING_AUDIT.md §7). The first and last real cell of
   every row are inset 1rem so a table's content aligns to the same 1rem grid
   line as the page header, on BOTH edges — while the per-cell row dividers
   (border-b on each td) still span the full table width, so separators stay
   full-bleed. Targeted by the data-test prefix so full-width colspan rows
   (expanded / tree-warning) are untouched, and the invisible trailing __spacer__
   column is excluded so the right inset lands on real content. A leading
   checkbox/expand/drag gutter is excluded from the left rule — that gutter cell
   already supplies the left inset itself; padding it would squish its icon. */
.o2-table--edge-inset :deep(th[data-test^="o2-table-th-"]:first-child:not([data-test="o2-table-th-select"]):not([data-test="o2-table-th-expand"]):not([data-test="o2-table-th-drag"])),
.o2-table--edge-inset :deep(td[data-test^="o2-table-cell-"]:first-child) {
  padding-left: var(--spacing-table-edge);
}
.o2-table--edge-inset :deep(th[data-test^="o2-table-th-"]:last-child:not([data-test="o2-table-th-__spacer__"])),
.o2-table--edge-inset :deep(td[data-test^="o2-table-cell-"]:last-child:not([data-test="o2-table-cell-__spacer__"])) {
  padding-right: var(--spacing-table-edge);
}

/* keep(lib-override:o2-table-modifiers): `.o2-table` / `.o2-row-md` /
   `.o2-table-header-sticky` are a PUBLIC modifier API — call sites put them on
   <OTable>, so they land on this component's root (attr fallthrough), but every
   declaration targets OTable's OWN th/td/thead, which OTableHeader /
   OTableBodyCell render. That is why they live here behind :deep() instead of
   as template utilities: no call site owns the DOM being styled. Scoping adds
   [data-v] to the root compound only, which the root already carries.
   Consumers: settings/DiscoveredServices.vue, plugins/logs/DetailTable.vue,
   plugins/logs/SearchJobInspector.vue. */
.o2-table :deep(th),
.o2-table :deep(td) {
  padding: 0 0.3125rem !important;
  height: 2.25rem;
}

.o2-table.o2-row-md :deep(th),
.o2-table.o2-row-md :deep(td) {
  height: 2.25rem !important;
}

.o2-table :deep(tr td) {
  border-bottom: 1px solid var(--color-card-glass-border) !important;
}

/* keep(lib-override:o2-table-hide-header): public modifier, same shape as the
   block above — `thead` is this component's own render, and the class is passed
   in by components/queries/QueryList.vue and plugins/logs/SearchBar.vue (x2). */
.o2-table-hide-header :deep(thead) {
  display: none;
}

.o2-table-header-sticky :deep(thead) {
  position: sticky;
  top: 0;
  z-index: 1000;
}
</style>
