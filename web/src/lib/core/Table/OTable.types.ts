// Copyright 2026 OpenObserve Inc.

import type { Component } from "vue";
import type { ColumnDef, Row, Table } from "@tanstack/vue-table";

// ── Column Definition ────────────────────────────────────────────

export interface OTableColumnMeta {
  /** Text alignment for header and body cells */
  align?: "left" | "center" | "right";
  /** Additional class applied to the <th> */
  headerClass?: string;
  /** Additional class applied to the <td> */
  cellClass?: string;
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
  filterMode?: OTableFilterMode;

  // ── Selection ──
  selection?: OTableSelectionMode;
  /** Selected row ids (v-model) */
  selectedIds?: string[];
  /** Field used as unique row identifier */
  rowKey?: string;

  // ── Expansion ──
  expansion?: OTableExpansionMode;
  /** Expanded row ids (v-model) */
  expandedIds?: string[];
  /** For tree/grouping: returns sub-rows of a given row */
  getSubRows?: (row: TData) => TData[];

  // ── Virtual Scroll ──
  virtualScroll?: boolean;
  /** Fixed row height for virtual scroll calculations (default 48) */
  virtualScrollItemSize?: number;
  /** Container max height; falls back to parent height when not set */
  maxHeight?: string | number;

  // ── Column Features ──
  enableColumnResize?: boolean;
  enableColumnReorder?: boolean;
  enableColumnPin?: boolean;
  /** Initial column visibility */
  columnVisibility?: Record<string, boolean>;

  // ── Display ──
  loading?: boolean;
  /** Data is arriving incrementally (SSE/WebSocket). Shows a pulsing indicator. */
  streaming?: boolean;
  error?: string | null;
  /** Text shown when data is empty and not loading */
  emptyMessage?: string;
  dense?: boolean;
  bordered?: boolean;
  striped?: boolean;
  stickyHeader?: boolean;
  /** Wrap cell content */
  wrap?: boolean;
  /** Fixed table width (CSS value) */
  width?: string | number;

  // ── Highlighting ──
  /** Keyword(s) to highlight in cells */
  highlightText?: string;
  /** Which column ids to apply highlighting to (default: all) */
  highlightFields?: string[];

  // ── Row Styling ──
  /** Static class or dynamic function for row <tr> */
  rowClass?: string | ((row: TData) => string);
  /** Dynamic inline style for row */
  getRowStyle?: (row: TData) => Record<string, any>;
  /** Fixed row height in px (for virtual scroll accuracy) */
  rowHeight?: number;

  // ── Pivot (Dashboard) ──
  /** Pivot header levels (multi-level headers) */
  pivotHeaderLevels?: any[];
  /** Pivot row field columns (for sticky headers) */
  pivotRowColumns?: any[];
  /** Show sticky row totals */
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
  "cell-click": [params: { columnId: string; row: TData; value: any }];

  // Column events
  "column-order-change": [order: string[]];
  "column-visibility-change": [visibility: Record<string, boolean>];
  "column-close": [columnId: string];

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
  /** Custom header content */
  "header-actions"?: () => any;
  /** Content above the table */
  top?: () => any;
  /** Content below the table (above pagination) */
  bottom?: () => any;
  /** Custom loading indicator */
  loading?: () => any;
  /** Custom empty state */
  empty?: () => any;
  /** Custom error state */
  error?: (props: { message: string }) => any;
  /** Expanded row content — scoped to { row } */
  expansion?: (props: { row: Row<TData> }) => any;
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
  /** Scroll to top */
  scrollToTop: () => void;
}
