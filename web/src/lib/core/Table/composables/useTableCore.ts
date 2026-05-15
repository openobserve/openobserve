// Copyright 2026 OpenObserve Inc.

import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type Table,
  type RowModel,
} from "@tanstack/vue-table";
import { computed, ref, watch, type Ref } from "vue";
import type { OTableColumnDef, OTableProps } from "../OTable.types";

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
  },
  emit: any,
) {
  // Track column order for drag-reorder
  const columnOrder = ref<string[]>([]) as Ref<string[]>;

  // Track column sizes
  const columnSizing = ref<Record<string, number>>({});

  // Build TanStack ColumnDef array from our OTableColumnDef
  const tanstackColumns = computed<ColumnDef<TData>[]>(() => {
    return props.columns.map((col) => {
      const columnDef: ColumnDef<TData> = {
        id: col.id,
        header: col.header as any,
        accessorKey: col.accessorKey ?? col.id,
        accessorFn: col.accessorFn as any,
        cell: col.cell
          ? ({ row, column, getValue }: any) => {
              // When a string is provided, treat it as a component name for FlexRender
              return typeof col.cell === "string"
                ? col.cell
                : (col.cell as any);
            }
          : undefined,
        size: col.size,
        minSize: col.minSize,
        maxSize: col.maxSize,
        enableSorting: col.sortable ?? false,
        enableColumnFilter: col.filterable ?? false,
        enableResizing: col.resizable ?? props.enableColumnResize ?? false,
        enablePinning: col.pinnable ?? props.enableColumnPin ?? false,
        meta: {
          align: col.meta?.align ?? "left",
          headerClass: col.meta?.headerClass ?? "",
          cellClass: col.meta?.cellClass ?? "",
          ...col.meta,
          isAction: col.isAction,
          sortable: col.sortable,
          hideable: col.hideable,
          closable: col.hideable,
        },
        footer: col.footer as any,
        aggregationFn: col.aggregate,
      };
      return columnDef;
    });
  });

  // Determine if client-side sorting is active
  const isClientSort = computed(() => props.sorting === "client");
  // For server-side sort, pass the active sort state to TanStack
  // but we handle sorting externally
  const isClientPagination = computed(() => props.pagination === "client");

  // Initial sorting state
  const initialSorting = computed(() => {
    if (props.sorting === "client" && props.sortBy) {
      const field = props.sortFieldMap?.[props.sortBy] ?? props.sortBy;
      return [{ id: field, desc: props.sortOrder === "desc" }];
    }
    return [];
  });

  // Build the TanStack table
  const table = useVueTable({
    get data() {
      return props.data;
    },
    get columns() {
      return tanstackColumns.value;
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: isClientSort.value ? getSortedRowModel() : undefined,
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: isClientPagination.value
      ? getPaginationRowModel()
      : undefined,
    getSubRows: props.getSubRows as any,
    onSortingChange: (updater) => {
      if (props.sorting === "server") return;
      // Let TanStack handle client-side sorting
      const oldSorting = table.getState()?.sorting ?? [];
      const newSorting =
        typeof updater === "function" ? updater(oldSorting) : updater;
      if (props.sorting === "client") {
        // Update the table sorting state
        (table as any).setSorting(newSorting);
      }
    },
    state: {
      sorting: initialSorting.value,
      get columnOrder() {
        return columnOrder.value.length ? columnOrder.value : undefined;
      },
      get columnSizing() {
        return columnSizing.value;
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
        (table as any).setPageSize?.(size);
      }
    },
    { immediate: true },
  );

  return {
    table,
    columnOrder,
    columnSizing,
    isClientSort,
    isClientPagination,
    tanstackColumns,
  };
}
