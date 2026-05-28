// Copyright 2026 OpenObserve Inc.

/**
 * Column definition helper — builds TanStack-compatible column definitions
 * from the simplified OTableColumnDef format.
 */

import type { ColumnDef } from "@tanstack/vue-table";
import type { OTableColumnDef } from "../OTable.types";

/**
 * Converts OTableColumnDef[] to TanStack ColumnDef[].
 * Handles default values and formatting.
 */
export function buildColumnDefs<TData>(
  columns: OTableColumnDef<TData>[],
): ColumnDef<TData>[] {
  return columns.map((col) => ({
    id: col.id,
    header: col.header as any,
    accessorKey: col.accessorKey ?? col.id,
    accessorFn: col.accessorFn as any,
    cell: col.cell
      ? ({ row, getValue }: any) => {
          if (typeof col.cell === "function") {
            return (col.cell as any)({ row: row.original, value: getValue() });
          }
          return getValue();
        }
      : undefined,
    size: col.size,
    minSize: col.minSize,
    maxSize: col.maxSize,
    enableSorting: col.sortable ?? false,
    enableColumnFilter: col.filterable ?? false,
    enableResizing: col.resizable ?? false,
    meta: {
      align: col.meta?.align ?? "left",
      headerClass: col.meta?.headerClass ?? "",
      cellClass: col.meta?.cellClass ?? "",
      isAction: col.isAction,
      sortable: col.sortable,
      hideable: col.hideable,
      ...col.meta,
    },
    footer: col.footer as any,
    aggregationFn: col.aggregate,
  }));
}
