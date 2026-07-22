// Copyright 2026 OpenObserve Inc.

import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type AggregationFn,
  type ColumnDef,
  type Row,
} from "@tanstack/vue-table";
import { computed, ref, watch, type Ref } from "vue";
import { TABLE_INDEX_COL_SIZE, type OTableColumnDef } from "../OTable.types";

// Register the custom "avg" fn (provided via table options below) so
// OTableColumnDef.aggregate values type-check against AggregationFnOption.
declare module "@tanstack/table-core" {
  interface AggregationFns {
    avg: AggregationFn<unknown>;
  }
}

/**
 * Creates and manages the TanStack Table instance.
 * This is the foundational composable — all other table composables
 * depend on the table instance returned here.
 */
export function useTableCore<TData>(
  props: {
    data: TData[];
    columns: OTableColumnDef<TData>[];
    pageSize?: number;
    currentPage?: number;
    /** Auto-render a fixed-width, auto-numbered row-index ("#") column. */
    showIndex?: boolean;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    sortFieldMap?: Record<string, string>;
    globalFilter?: string;
    rowKey?: string;
    enableColumnResize?: boolean;
    enableColumnReorder?: boolean;
    enableColumnPin?: boolean;
    columnVisibility?: Record<string, boolean>;
    defaultColumns?: boolean;
    getSubRows?: (row: TData) => TData[];
    pagination: string;
    sorting: string;
    rowHeight?: number;
    filterMode?: string;
    horizontalScroll?: boolean;
    /** Initial column sizes loaded from localStorage (for persistence) */
    initialColumnSizes?: Record<string, number> | null;
    /** When true, do not auto-reset page index when data changes */
    keepPageOnDataChange?: boolean;
  },
  _emit?: unknown,
) {
  // ── Effective columns ───────────────────────────────────────────
  // When `showIndex` is set (and the caller hasn't already declared a `#`
  // column), prepend an auto-rendered, auto-numbered row-index column. Its
  // value is derived from the row's position so pages need not hand-roll a
  // `"#"` field in their data. Under server pagination we add the page offset
  // so numbering stays continuous across pages.
  const indexColumn = computed<OTableColumnDef<TData> | null>(() => {
    if (!props.showIndex) return null;
    if (props.columns.some((c) => c.id === "#")) return null;
    const isServer = props.pagination === "server";
    const offset = isServer
      ? Math.max(((props.currentPage ?? 1) - 1) * (props.pageSize ?? 0), 0)
      : 0;
    return {
      id: "#",
      header: "#",
      size: TABLE_INDEX_COL_SIZE,
      sortable: false,
      hideable: false,
      resizable: false,
      // accessorFn receives (row, index); returning the value lets the default
      // text cell render it. (A `cell` *function* can't be used here — the core
      // cell wrapper only forwards string/component cells.)
      accessorFn: ((_row: TData, index: number) => {
        const n = index + 1 + offset;
        return n <= 9 ? `0${n}` : `${n}`;
      }) as any,
      // tabular-nums: uniform digit width so 3-/4-digit values never clip to
      // "2…" on the fixed-width column (see TABLE_INDEX_COL_SIZE).
      meta: { align: "left", cellClass: "tabular-nums" },
    };
  });

  // Invisible trailing spacer that absorbs the table's leftover width so the
  // real columns keep their exact widths (Excel-style resize) and an action
  // column can stay pinned flush-right. Only added when resizing is on and the
  // table has no explicit elastic (`autoWidth`) column — if a column is marked
  // autoWidth, THAT column is the filler instead and no spacer is needed.
  // Whether an invisible trailing `__spacer__` column will be appended. When
  // true the actions column is NOT the row's last cell (the spacer is), so it
  // keeps px-2; when false the actions column is last and gets the 1rem right
  // edge inset. `actionColumnWidth` reads this to budget the right padding.
  const hasTrailingSpacer = computed<boolean>(() => {
    const base = indexColumn.value
      ? [indexColumn.value, ...props.columns]
      : props.columns;
    const hasAutoWidth = base.some((c) => c.meta?.autoWidth);
    return (
      (props.enableColumnResize ?? false) &&
      !props.horizontalScroll &&
      !props.defaultColumns &&
      !hasAutoWidth
    );
  });

  const effectiveColumns = computed<OTableColumnDef<TData>[]>(() => {
    const base = indexColumn.value
      ? [indexColumn.value, ...props.columns]
      : props.columns;
    // An `autoWidth` column flexes permanently and absorbs leftover on its own,
    // so those tables need no spacer. Every other resizable table gets an
    // invisible trailing spacer: it sits before the pinned actions column and
    // absorbs leftover width so the table stays ≥ container (actions stays
    // flush-right) and blank space lands in the spacer when a column shrinks.
    // `flex` tables need it too — the flex column freezes after the first resize
    // and no longer re-absorbs, so the spacer takes over.
    if (!hasTrailingSpacer.value) return base;
    const spacer: OTableColumnDef<TData> = {
      id: "__spacer__",
      header: "",
      sortable: false,
      hideable: false,
      resizable: false,
      size: 0,
      minSize: 0,
      // Not `autoWidth`: its width is driven explicitly by OTable (0 while
      // filling, the leftover once frozen). `spacer` marks it for skip logic.
      meta: { align: "left", spacer: true },
    };
    return [...base, spacer];
  });

  // A column is "rigid" — width pinned independently of the other columns —
  // when it's the selection-driven row index, or an action/buttons column.
  const isRigidColumn = (col: OTableColumnDef<TData>) =>
    col.isAction === true || col.id === "actions" || col.id === "#";

  // Deterministic actions-column width from its icon count: N icon buttons
  // (icon-sm = 32px) + gaps + cell padding, never narrower than the "Actions"
  // header. Computed (not DOM-measured) so the skeleton and loaded table match.
  const ACTION_ICON_BTN = 32; // OButton size="icon-sm" → w-8
  const ACTION_BTN_GAP = 4; // gap-1 between buttons
  const ACTIONS_HEADER_MIN = 80; // enough to show the "Actions" header in full
  // The page-edge inset (--spacing-page-edge) that OTable applies to the last
  // cell's right padding, in px. Keep in sync with the token (0.75rem = 12px).
  const PAGE_EDGE_PX = 12;
  const actionColumnWidth = (actionCount?: number): number => {
    const n = Math.max(1, Number(actionCount) || 2);
    // Cell padding: px-2 is 8+8=16. When the actions column is the row's last
    // cell (no trailing spacer) the edge inset replaces its right padding with
    // the page-edge inset, so budget 8 + PAGE_EDGE_PX — exact, so the buttons
    // land on the same right-edge grid line as everything else (no over-width).
    const cellPad = hasTrailingSpacer.value ? 16 : 8 + PAGE_EDGE_PX;
    const content = n * ACTION_ICON_BTN + (n - 1) * ACTION_BTN_GAP + cellPad;
    return Math.max(content, ACTIONS_HEADER_MIN);
  };

  // Track column order for drag-reorder
  const columnOrder = ref<string[]>([]) as Ref<string[]>;

  // Track column sizing — seeded with persisted values when provided
  const columnSizing = ref<Record<string, number>>(props.initialColumnSizes ?? {});
  const columnResizeMode = "onChange";

  // Track sorting state for client-side
  const initialSorting = computed(() => {
    if (props.sorting === "client" && props.sortBy) {
      const field = props.sortFieldMap?.[props.sortBy] ?? props.sortBy;
      return [{ id: field, desc: props.sortOrder === "desc" }];
    }
    return [];
  });

  const sortingState = ref<any[]>(initialSorting.value);

  // Column pinning — auto-pin isAction columns to right, pivotRowColumns to left, plus explicitly pinned columns
  const pivotRowColumnIds = computed(() => {
    const raw = (props as any).pivotRowColumns as any[] | undefined;
    if (!raw || !raw.length) return undefined;
    return raw.map((c: any) => (typeof c === "string" ? c : c.id));
  });
  const rightPinnedIds = computed(() =>
    effectiveColumns.value
      .filter((c) => c.pinned === "right" || c.isAction)
      .map((c) => c.id),
  );
  const leftPinnedIds = computed(() => {
    const explicit = effectiveColumns.value
      .filter((c) => c.pinned === "left")
      .map((c) => c.id);
    const pivot = pivotRowColumnIds.value ?? [];
    return [...new Set([...explicit, ...pivot])];
  });
  const columnPinning = ref<{ left?: string[]; right?: string[] }>({});

  // Keep auto-pinned columns in sync
  watch(
    [rightPinnedIds, leftPinnedIds],
    () => {
      columnPinning.value = {
        left: leftPinnedIds.value.length ? leftPinnedIds.value : undefined,
        right: rightPinnedIds.value.length ? rightPinnedIds.value : undefined,
      };
    },
    { immediate: true },
  );

  // Build TanStack ColumnDef array from our OTableColumnDef
  const tanstackColumns = computed<ColumnDef<TData>[]>(() => {
    return effectiveColumns.value.map((col) => {
      const rigid = isRigidColumn(col);
      const isActionCol = col.isAction === true || col.id === "actions";
      // Rigid columns (selection index, actions) hold a width that does not
      // depend on the other columns: min === size === max so the table layout
      // can neither grow nor shrink them. The actions column's width is computed
      // DETERMINISTICALLY from its icon count (not DOM-measured at runtime) so
      // the loading skeleton and the loaded table render it at the exact same
      // width — no flash when data arrives.
      const size = isActionCol
        ? Math.max(col.size ?? 0, actionColumnWidth((col.meta as any)?.actionCount))
        : (col.size ?? 150);
      const columnDef: ColumnDef<TData> = {
        id: col.id,
        header: col.header as any,
        accessorKey: col.accessorKey ?? col.id,
        accessorFn: col.accessorFn as any,
        cell: col.cell
          ? (() => {
              if (typeof col.cell === "string") return col.cell;
              return col.cell;
            })
          : undefined,
        size,
        // Resize floor: just enough that the dragged column stays usable (its
        // resize handle is still grabbable and content can ellipsize) — NOT a
        // layout guard, since the Excel-style width strategy means a drag only
        // ever changes the dragged column. Columns that need a larger minimum
        // (e.g. the name column) set their own `minSize`. Rigid columns locked.
        minSize: rigid ? size : (col.minSize ?? (col.size !== undefined && col.size < 48 ? col.size : 48)),
        maxSize: rigid ? size : (col.maxSize ?? 800),
        enableSorting: (props.sorting === "client" && col.sortable) ?? false,
        enableColumnFilter: col.filterable ?? false,
        // Rigid (actions / #), permanent-elastic (autoWidth), and the invisible
        // spacer are never resizable. `flex` columns ARE resizable — dragging one
        // freezes it (OTable) then resizes it like any other column.
        enableResizing: (rigid || col.meta?.autoWidth || col.meta?.spacer) ? false : (col.resizable ?? props.enableColumnResize ?? false),
        enablePinning: col.pinnable ?? props.enableColumnPin ?? false,
        meta: {
          // Action columns (pinned-right icon buttons) center by default — the
          // app-wide convention — unless a column opts into a specific align.
          align: col.meta?.align ?? (isActionCol ? "center" : "left"),
          headerClass: col.meta?.headerClass ?? "",
          cellClass: col.meta?.cellClass ?? "",
          isAction: col.isAction,
          sortable: col.sortable,
          hideable: col.hideable,
          closable: col.hideable,
          showWrap: false,
          // Width is independent of sibling columns; OTableHeader/BodyCell pin
          // min+max to the column's CSS size var.
          fixedWidth: rigid,
          ...col.meta,
        },
        footer: col.footer as any,
        aggregationFn: col.aggregate,
      };
      return columnDef;
    });
  });

  const isClientSort = computed(() => props.sorting === "client");
  const isClientPagination = computed(() => props.pagination === "client");
  const isClientFilter = computed(
    () => (props.filterMode ?? "client") === "client",
  );

  // Built-in aggregation functions for footer totals
  const aggregationFns: Record<string, AggregationFn<TData>> = {
    sum: (columnId: string, leafRows: Row<TData>[]) => {
      return leafRows.reduce((sum, row) => sum + (Number(row.getValue(columnId)) || 0), 0);
    },
    count: (_columnId: string, leafRows: Row<TData>[]) => {
      return leafRows.length;
    },
    avg: (columnId: string, leafRows: Row<TData>[]) => {
      if (leafRows.length === 0) return 0;
      return leafRows.reduce((sum, row) => sum + (Number(row.getValue(columnId)) || 0), 0) / leafRows.length;
    },
    min: (columnId: string, leafRows: Row<TData>[]) => {
      if (leafRows.length === 0) return undefined;
      return Math.min(...leafRows.map((row) => Number(row.getValue(columnId)) || 0));
    },
    max: (columnId: string, leafRows: Row<TData>[]) => {
      if (leafRows.length === 0) return undefined;
      return Math.max(...leafRows.map((row) => Number(row.getValue(columnId)) || 0));
    },
  };

  // Build the TanStack table instance
  const table = useVueTable({
    get data() {
      return props.data;
    },
    get columns() {
      return tanstackColumns.value;
    },
    autoResetPageIndex: !props.keepPageOnDataChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: isClientSort.value ? getSortedRowModel() : undefined,
    getFilteredRowModel: isClientFilter.value
      ? getFilteredRowModel()
      : undefined,
    getPaginationRowModel: isClientPagination.value
      ? getPaginationRowModel()
      : undefined,
    aggregationFns,
    getSubRows: props.getSubRows as any,
    enableSorting: props.sorting !== "none",
    enableColumnResizing: props.enableColumnResize ?? false,
    columnResizeMode,
    onSortingChange: (updater) => {
      if (props.sorting === "server") return;
      const old = sortingState.value;
      const next =
        typeof updater === "function" ? updater(old) : updater;
      sortingState.value = next;
    },
    onColumnSizingChange: (updater: any) => {
      const old = columnSizing.value;
      const next = typeof updater === "function" ? updater(old) : updater;
      columnSizing.value = next;
    },
    onColumnPinningChange: (updater: any) => {
      const old = columnPinning.value;
      const next =
        typeof updater === "function" ? updater(old) : updater;
      columnPinning.value = next;
    },
    defaultColumn: {
      minSize: 20,
      maxSize: 800,
    },
    state: {
      get sorting() {
        if (isClientSort.value) return sortingState.value;
        return [];
      },
      get globalFilter() {
        return props.globalFilter ?? "";
      },
      get columnOrder() {
        return columnOrder.value.length ? columnOrder.value : undefined;
      },
      get columnSizing() {
        return props.enableColumnResize ? columnSizing.value : {};
      },
      get columnVisibility() {
        return props.columnVisibility ?? {};
      },
      get columnPinning() {
        return columnPinning.value;
      },
    },
  });

  // Sync columnOrder when columns change
  watch(
    () => effectiveColumns.value.map((c) => c.id),
    (newIds) => {
      const existing = columnOrder.value.filter((id) => newIds.includes(id));
      const added = newIds.filter((id) => !existing.includes(id));
      columnOrder.value = [...existing, ...added];
    },
    { immediate: true },
  );

  // Client-side pagination: set page size
  watch(
    () => props.pageSize,
    (size) => {
      if (isClientPagination.value && size) {
        table.setPageSize?.(size);
      }
    },
    { immediate: true },
  );

  // Compute column size CSS variables
  const columnSizeVars = computed(() => {
    const headers = table?.getFlatHeaders?.() ?? [];
    const colSizes: Record<string, string> = {};
    for (const header of headers) {
      const safeId = header.id.replace(/[^a-zA-Z0-9]/g, "-");
      colSizes[`--header-${safeId}-size`] = `${header.getSize()}px`;
      colSizes[`--col-${header.column.id}-size`] = `${header.column.getSize()}px`;
    }
    return colSizes;
  });

  return {
    table,
    effectiveColumns,
    columnOrder,
    columnSizing,
    sortingState,
    isClientSort,
    isClientPagination,
    isClientFilter,
    tanstackColumns,
    columnResizeMode,
    columnSizeVars,
  };
}
