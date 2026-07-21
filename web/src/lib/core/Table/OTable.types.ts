// Copyright 2026 OpenObserve Inc.

import type { Component, ComputedRef, InjectionKey, Ref } from "vue";
import type { ColumnDef, Row, Table } from "@tanstack/vue-table";

// ─── Cell hover-actions context (G13) ────────────────────────────
/**
 * Single-active-cell hover model shared by OTable → OTableBodyCell via
 * provide/inject. Hovering a cell marks it active (after a short debounce), so a
 * consumer's `#cell-actions` overlay renders for only ONE cell at a time — this
 * mirrors the legacy tables, which mounted a heavy actions menu lazily rather
 * than on every cell. `enabled` is false when no `#cell-actions` slot is present
 * so cells can skip the mouse bookkeeping entirely.
 */
export interface OTableCellActionsContext {
  activeCellKey: Ref<string | null>;
  setActiveCell: (key: string | null) => void;
  enabled: ComputedRef<boolean>;
}

export const OTableCellActionsKey: InjectionKey<OTableCellActionsContext> =
  Symbol("OTableCellActions");

// ─── Shared column size constants ────────────────────────────────
/**
 * Fixed width (px) of the auto-rendered selection-checkbox column. Imported by
 * OTableHeader/OTableBodyRow/OTableLoading so the three stay in sync. The box's
 * left inset is the shared `--spacing-table-edge` token (applied in inline
 * style), the same edge line the first data column and toolbar search bar use.
 */
export const TABLE_CHECKBOX_COL_SIZE = 44;
/**
 * Fixed width (px) of the row-index ("#") column. Fits a 4-digit number at
 * text-xs after the `--spacing-table-edge` left inset (14px) + right padding.
 * Paired with `tabular-nums` on the cell so every digit is the same advance
 * width — otherwise a proportional font makes wide-glyph values (209, 200) clip
 * to "2…" while narrow ones (215) fit, at the same column width.
 */
export const TABLE_INDEX_COL_SIZE = 56;

export const COL = {
  name:         200,
  firstName:    130,
  lastName:     130,
  email:        220,
  description:  300,
  status:       100,
  toggle:        80,
  date:         200,
  // Full "YYYY-MM-DD HH:mm:ss" timestamps — predictable, so fix their width.
  createdAt:    200,
  updatedAt:    200,
  dateAbsolute: 160,
  duration:     120,
  frequency:    130,
  type:         180,
  streamType:   120,
  streamName:   180,
  method:        80,
  count:         90,
  sizeBytes:    130,
  url:          220,
  template:     180,
  owner:        220,
  folder:       150,
  role:         160,
  authType:     100,
  token:        200,
  cron:         160,
  price:        110,
  defaultModel: 180,
  version:      100,
  // Synthetic monitoring
  responseTime: 90,
  uptime:       130,
  locations:    120,
  interval:     72,
  steps:        72,
  assertions:   90,
  lastCheck:    100,
  history:      180,
} as const;

// ── Column Definition ────────────────────────────────────────────

export interface OTableColumnMeta {
  /** Text alignment for header and body cells */
  align?: "left" | "center" | "right";
  /** Additional class applied to the <th> */
  headerClass?: string;
  /** Additional class applied to the <td> */
  cellClass?: string;
  /**
   * Mark this as the primary "name" column. The record-name column renders at
   * weight 500 — enough to separate it from metadata columns (which stay 400 /
   * --text-3) without the "wall of bold". Only affects default-rendered cells;
   * custom `cell` renderers style their own.
   */
  isName?: boolean;
  /** Format function applied to cell value before rendering */
  format?: (value: any, row: any) => any;
  /** Arbitrary metadata for custom cell renderers */
  [key: string]: any;
}

export interface OTableColumnDef<TData = any> {
  /** Unique column identifier (used as accessorKey when accessorKey not explicitly set) */
  id: string;
  /** Header display text or render function */
  header: string | Component;
  /** Key in the data row object */
  accessorKey?: string;
  /** Custom accessor function (receives the full row) */
  accessorFn?: (row: TData) => any;
  /** Custom cell renderer — component or render function */
  cell?: string | Component;
  /** Column width hint in px (translated to rem) */
  size?: number;
  minSize?: number;
  maxSize?: number;
  /** Can the user sort by this column? */
  sortable?: boolean;
  /** Can the user filter by this column? */
  filterable?: boolean;
  /** Can the user resize this column? */
  resizable?: boolean;
  /** Can the user pin this column? */
  pinnable?: boolean;
  /** Pin this column to the left or right edge */
  pinned?: "left" | "right" | false;
  /** Can the user hide/close this column? */
  hideable?: boolean;
  /** Action columns (no data, just buttons/icons) get compact styling */
  isAction?: boolean;
  /** Footer display text or aggregate */
  footer?: string | Component;
  /** Aggregate function for footer */
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
  /** Metadata for styling and custom behavior */
  meta?: OTableColumnMeta;
}

// ── Pagination ────────────────────────────────────────────────────

export interface OTablePaginationParams {
  page: number;
  size: number;
}

// ── Sort ──────────────────────────────────────────────────────────

export interface OTableSortParams {
  column: string;
  order: "asc" | "desc";
}

// ── Filter ────────────────────────────────────────────────────────

export interface OTableFilterParams {
  [columnId: string]: any;
}

// ── Selection ─────────────────────────────────────────────────────

export type OTableSelectionMode = "none" | "single" | "multiple";

// ── Expansion ─────────────────────────────────────────────────────

export type OTableExpansionMode = "none" | "single" | "multiple" | "tree";

// ── Pagination mode ───────────────────────────────────────────────

export type OTablePaginationMode = "client" | "server" | "none";

// ── Sorting mode ──────────────────────────────────────────────────

export type OTableSortingMode = "client" | "server" | "none";

// ── Filter mode ───────────────────────────────────────────────────

export type OTableFilterMode = "client" | "server";

// ── Main Props ────────────────────────────────────────────────────

export interface OTableProps<TData = any> {
  // ── Data ──
  /** Row data array (for client-side pagination/sorting) */
  data: TData[];
  /** Column definitions */
  columns: OTableColumnDef<TData>[];

  // ── Pagination ──
  pagination?: OTablePaginationMode;
  /** Default page size (client-side) or current page size (server-side) */
  pageSize?: number;
  /** Available page size options */
  pageSizeOptions?: number[];
  /** Current page index (1-based, for server-side v-model) */
  currentPage?: number;
  /** Total record count (required for server-side pagination) */
  totalCount?: number;
  /** When true, the page index is NOT reset when the data array changes (e.g. on row expand/collapse). Defaults to false. */
  keepPageOnDataChange?: boolean;

  // ── Sorting ──
  sorting?: OTableSortingMode;
  /** Active sort column id (server-side) */
  sortBy?: string;
  /** Active sort direction (server-side) */
  sortOrder?: "asc" | "desc";
  /** Maps TanStack column id → backend field name for server-side sort */
  sortFieldMap?: Record<string, string>;

  // ── Filtering ──
  /** Global search/filter text */
  globalFilter?: string;
  /** Placeholder for global filter input */
  globalFilterPlaceholder?: string;
  /** Show built-in global filter search bar (default: true) */
  showGlobalFilter?: boolean;
  filterMode?: OTableFilterMode;
  /** Label shown bold in the footer as "N footerTitle" (e.g. "2 Dashboards") */
  footerTitle?: string;

  // ── Selection ──
  selection?: OTableSelectionMode;
  /** Selected row ids (v-model) */
  selectedIds?: string[];
  /** Per-row predicate: return false to disable that row's selection checkbox
   *  (renders with `cursor: not-allowed` and ignores toggles). E.g. block bulk
   *  selection of the root user in IAM. */
  isRowSelectable?: (row: TData) => boolean;
  /** Field used as unique row identifier */
  rowKey?: string;

  // ── Expansion ──
  expansion?: OTableExpansionMode;
  /** Expanded row ids (v-model) */
  expandedIds?: string[];
  /** Per-row predicate: return false to hide the expand button for that row */
  getRowExpansionEnabled?: (row: TData) => boolean;
  /** When true or a per-row predicate, clicking a row also toggles expansion */
  expandOnRowClick?: boolean | ((row: TData) => boolean);
  /** For tree/grouping: returns sub-rows of a given row */
  getSubRows?: (row: TData) => TData[];

  // ── Tree mode (parent + nested children, inline chevron, optional warning row) ──
  /**
   * Enables tree mode. When true, OTable flattens parents + their children
   * (when expanded) into the visible row list, renders an inline chevron in the
   * tree column, and optionally renders a warning row between a parent and its
   * children. State is managed internally; use `:expanded-ids` to control it.
   */
  tree?: boolean;
  /** Children accessor for tree mode (defaults to `row.children`). */
  getChildren?: (row: TData) => TData[] | undefined;
  /** Per-parent predicate — when true and the parent is expanded, OTable renders the `#tree-warning` slot row before its children. */
  getRowWarning?: (row: TData) => boolean;
  /** Id of the column that should host the inline chevron + indent. Defaults to the first non-action column. */
  treeColumnId?: string;

  // ── Virtual Scroll ──
  virtualScroll?: boolean;
  /** Fixed row height for virtual scroll calculations (default 48) */
  virtualScrollItemSize?: number;
  /** Container max height; falls back to parent height when not set */
  maxHeight?: string | number;

  // ── Column Features ──
  /**
   * Auto-render a fixed-width row-index ("#") column as the first data column.
   * OTable injects the column, fixes its width (TABLE_INDEX_COL_SIZE), and
   * numbers rows by their position (accounting for the page offset under
   * server-side pagination). Pages no longer need to declare a `#` column or
   * inject a `"#"` value into row data. Ignored if the caller already provides
   * a column with id `"#"`.
   */
  showIndex?: boolean;
  enableColumnResize?: boolean;
  enableColumnReorder?: boolean;
  enableColumnPin?: boolean;
  /** Initial column visibility */
  columnVisibility?: Record<string, boolean>;
  /**
   * Persist column widths and visibility to localStorage.
   * Requires `tableId` to be set. When both are present, column sizes and
   * visibility survive page reloads. Off by default.
   */
  persistColumns?: boolean;

  // ── Layout ──
  /** When false, table shrinks to fit its content instead of filling the container height (default: true) */
  fillHeight?: boolean;

  // ── Display ──
  loading?: boolean;
  /** Data is arriving incrementally (SSE/WebSocket). Shows a pulsing indicator. */
  streaming?: boolean;
  error?: string | null;
  /** Text shown when data is empty and not loading */
  emptyMessage?: string;
  dense?: boolean;
  bordered?: boolean;
  /**
   * Draws the outer frame (border) around the whole table region. Default true.
   * Set false when the table is embedded inside an already-bordered container
   * (e.g. a page card) so it renders flush without a double border.
   */
  frame?: boolean;
  striped?: boolean;
  stickyHeader?: boolean;
  showHeader?: boolean;
  /** Wrap cell content */
  wrap?: boolean;
  /**
   * When true, cells render their natural width and the table scrolls
   * horizontally if the total content overflows the container. Switches
   * the inner table from `table-fixed` to `table-auto` and removes the
   * default `overflow-hidden + text-ellipsis` clipping on non-wrapped cells.
   * Pair with `wrap=false` for long, unbroken content (e.g. SQL strings).
   */
  horizontalScroll?: boolean;
  /** Fixed table width (CSS value) */
  width?: string | number;

  // ── Highlighting ──
  /** Keyword(s) to highlight in cells */
  highlightText?: string;
  /** Which column ids to apply highlighting to (default: all) */
  highlightFields?: string[];

  // ── Row Reorder ──
  /** Enable drag-and-drop row reordering. Renders a drag handle (grip icon)
   *  as the first column. Uses vue-draggable-next under the hood. */
  enableRowReorder?: boolean;
  /** Per-row predicate: return false to disable dragging for that row.
   *  Defaults to all rows draggable when `enableRowReorder` is true. */
  disableRowReorder?: (row: TData) => boolean;

  // ── Row Styling ──
  /** Static class or dynamic function for row <tr> */
  rowClass?: string | ((row: TData) => string);
  /** Dynamic inline style for row */
  getRowStyle?: (row: TData) => Record<string, any>;
  /** Returns a CSS color for the status bar (4px left border) per row */
  getRowStatusColor?: (row: TData) => string | undefined;
  /** Returns inline styles for individual cells */
  getCellStyle?: (params: {
    columnId: string;
    row: TData;
    value: any;
  }) => Record<string, any>;
  /** Show hover-visible copy button on each cell */
  enableCellCopy?: boolean;
  /** Fixed row height in px (for virtual scroll accuracy) */
  rowHeight?: number;

  // ── Scroll ──
  /** External scroll element (for shared scroll containers) */
  scrollEl?: HTMLElement | null;
  /** Margin for scroll detection (default 0) */
  scrollMargin?: number;

  // ── Pivot (Dashboard) ──
  /** Pivot header levels (multi-level headers) */
  pivotHeaderLevels?: any[];
  /** Pivot row field columns (for sticky headers + row-field cell merge) */
  pivotRowColumns?: any[];
  /** Grand-total row data object rendered as a sticky `<tfoot>` (pivot). Keyed by
   *  each column's `accessorKey`/`id`; values run through the column's `meta.format`. */
  stickyTotalRow?: Record<string, any> | null;
  /** Show sticky row totals (pins the grand-total `<tfoot>` to the bottom) */
  stickyRowTotals?: boolean;
  /** Show sticky column totals */
  stickyColTotals?: boolean;

  // ── Misc ──
  /** Default column definitions applied to all columns */
  defaultColumns?: boolean;
  /** Unique id for the table instance (useful for multi-table pages) */
  tableId?: string;
}

// ── Emits ─────────────────────────────────────────────────────────

export interface OTableEmits<TData = any> {
  // Pagination
  "update:currentPage": [page: number];
  "update:pageSize": [size: number];
  "pagination-change": [params: OTablePaginationParams];

  // Sorting
  "update:sortBy": [columnId: string];
  "update:sortOrder": [order: "asc" | "desc"];
  "sort-change": [params: OTableSortParams];

  // Filter
  "update:globalFilter": [value: string];
  "filter-change": [filters: OTableFilterParams];

  // Selection
  "update:selectedIds": [ids: string[]];
  "selection-change": [rows: TData[]];

  // Expansion
  "update:expandedIds": [ids: string[]];

  // Row events
  "row-click": [row: TData, event: MouseEvent];
  "row-dblclick": [row: TData, event: MouseEvent];
  "row-mouseenter": [row: TData, event: MouseEvent];
  "row-mouseleave": [row: TData];
  "cell-click": [params: { columnId: string; row: TData; value: any }];

  // Column events
  "column-order-change": [order: string[]];
  "column-visibility-change": [visibility: Record<string, boolean>];
  /** A column's close ("x") affordance was clicked (G4). Payload is the column
   *  definition; the consumer decides how to remove/hide it. */
  "close-column": [column: OTableColumnDef<TData>];
  "update:columnSizes": [
    sizes: Record<string, number>,
    idMap: Record<string, string>,
  ];

  // Row reorder
  "row-reorder": [data: TData[]];

  // Virtual scroll
  "scroll-end": [scrollInfo: any];
  scroll: [scrollInfo: any];
}

// ── Slots ─────────────────────────────────────────────────────────

export interface OTableSlots<TData = any> {
  /** Custom cell content — scoped to { row, column, value, table } */
  cell?: (props: {
    row: Row<TData>;
    column: OTableColumnDef<TData>;
    value: any;
    table: Table<TData>;
  }) => any;
  /**
   * Per-cell hover-action overlay (G13). Rendered as an absolutely-positioned
   * overlay inside every data cell; `active` is true only for the single cell
   * the pointer is currently hovering (debounced). Consumers gate their heavy
   * action menus on `active` so they mount lazily — e.g. logs cell copy /
   * add-search-term / add-to-table, traces "view traces". Scoped to
   * `{ row, column, value, active }` (`row` is the original data object).
   *
   * NOTE: deliberately **not** named `cell-actions` — that name is already the
   * established per-column cell slot for a column whose `id` is `"actions"`
   * (the `#cell-{id}` convention), used across the app (WorkflowsList,
   * SourceMaps, LogStream, …). This overlay is orthogonal to any single column.
   */
  "cell-hover-actions"?: (props: {
    row: TData;
    column: OTableColumnDef<TData>;
    value: any;
    active: boolean;
  }) => any;
  /** Custom header content */
  "header-actions"?: () => any;
  /** Content above the table */
  top?: () => any;
  /** Toolbar rendered INSIDE the table's bordered frame, above the column
   *  header (search / filters / view controls). Reads as part of the table. */
  toolbar?: () => any;
  /** Trailing toolbar actions rendered AFTER the auto-injected column toggle (e.g. a refresh button). */
  "toolbar-trailing"?: () => any;
  /** Content below the table (above pagination). Scoped with pagination state. */
  bottom?: (props: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalRows: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    setPageSize: (size: number) => void;
    firstPage: () => void;
    prevPage: () => void;
    nextPage: () => void;
    lastPage: () => void;
  }) => any;
  /** Shown when loading=true AND data exists (thin banner, not overlay) */
  "loading-banner"?: () => any;
  /** Custom loading indicator (overlay when no data) */
  loading?: () => any;
  /** Custom empty state */
  empty?: () => any;
  /** Custom error state */
  error?: (props: { message: string }) => any;
  /** Expanded row content — scoped to { row } */
  expansion?: (props: { row: Row<TData> }) => any;
  /** Tree-mode warning row — rendered between an expanded parent and its children when `getRowWarning(row)` is true. */
  "tree-warning"?: (props: { row: TData }) => any;
}

// ── Exposed (template ref) ────────────────────────────────────────

export interface OTableExposed<TData = any> {
  /** The underlying TanStack table instance */
  table: Table<TData>;
  /** Toggle all rows selection */
  toggleAllRows: () => void;
  /** Clear selection */
  clearSelection: () => void;
  /** Reset column sizes to default */
  resetColumnSizes: () => void;
  /** Reset column order to default */
  resetColumnOrder: () => void;
  /** Clear all persisted column state (sizes + visibility) for this tableId */
  resetPersistedColumns: () => void;
  /** Scroll to top */
  scrollToTop: () => void;
  /** Get all currently visible rows as plain objects */
  getRows: () => TData[];
}
