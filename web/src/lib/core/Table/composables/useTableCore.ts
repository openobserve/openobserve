// Copyright 2026 OpenObserve Inc.

import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type Table,
} from "@tanstack/vue-table";
import { computed, ref, watch, type Ref } from "vue";
import type { OTableColumnDef } from "../OTable.types";

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
  },
  emit: any,
) {
  // Track column order for drag-reorder
  const columnOrder = ref<string[]>([]) as Ref<string[]>;

  // Track column sizing
  const columnSizing = ref<Record<string, number>>({});
  const columnResizeMode = "onChange";

  // Track sorting state for client-side
  const sortingState = ref<any[]>([]);

  // Build TanStack ColumnDef array from our OTableColumnDef
  const tanstackColumns = computed<ColumnDef<TData>[]>(() => {
    return props.columns.map((col) => {
      const columnDef: ColumnDef<TData> = {
        id: col.id,
        header: col.header as any,
        accessorKey: col.accessorKey ?? col.id,
        accessorFn: col.accessorFn as any,
        cell: col.cell
          ? ((info: any) => {
              if (typeof col.cell === "string") return col.cell;
              return col.cell;
            })
          : undefined,
        size: col.size ?? 150,
        minSize: col.minSize ?? 40,
        maxSize: col.maxSize ?? 800,
        enableSorting: (props.sorting === "client" && col.sortable) ?? false,
        enableColumnFilter: col.filterable ?? false,
        enableResizing: col.resizable ?? props.enableColumnResize ?? false,
        enablePinning: col.pinnable ?? props.enableColumnPin ?? false,
        meta: {
          align: col.meta?.align ?? "left",
          headerClass: col.meta?.headerClass ?? "",
          cellClass: col.meta?.cellClass ?? "",
          isAction: col.isAction,
          sortable: col.sortable,
          hideable: col.hideable,
          closable: col.hideable,
          showWrap: false,
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

  // Initial sorting state (client-side)
  const initialSorting = computed(() => {
    if (props.sorting === "client" && props.sortBy) {
      const field = props.sortFieldMap?.[props.sortBy] ?? props.sortBy;
      return [{ id: field, desc: props.sortOrder === "desc" }];
    }
    return [];
  });

  // Build the TanStack table instance
  const table = useVueTable({
    get data() {
      return props.data;
    },
    get columns() {
      return tanstackColumns.value;
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: isClientSort.value ? getSortedRowModel() : undefined,
    getFilteredRowModel: isClientFilter.value
      ? getFilteredRowModel()
      : undefined,
    getPaginationRowModel: isClientPagination.value
      ? getPaginationRowModel()
      : undefined,
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
    defaultColumn: {
      minSize: 40,
      maxSize: 800,
    },
    state: {
      get sorting() {
        if (isClientSort.value) return sortingState.value;
        return [];
      },
      get columnOrder() {
        return columnOrder.value.length ? columnOrder.value : undefined;
      },
      get columnSizing() {
        return props.enableColumnResize ? undefined : undefined;
      },
      get columnVisibility() {
        return props.columnVisibility ?? {};
      },
    },
  });

  // Sync columnOrder when columns change
  watch(
    () => props.columns.map((c) => c.id),
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
