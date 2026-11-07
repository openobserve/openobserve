// Copyright 2026 OpenObserve Inc.
//
// recordNav.ts — prev/next through the rows the analyst actually sees.
//
// OTable sorts and paginates client-side inside TanStack, so the page's own
// array is in neither the displayed order nor on the displayed page. Stepping
// reads the table's sorted row model and moves the table's page when a step
// crosses a page boundary, so the highlighted row never slides out of view.

/** The slice of a TanStack table this needs (OTable exposes `table`). */
export interface NavTable<T> {
  getSortedRowModel(): { rows: { original: T }[] };
  getState(): { pagination?: { pageIndex: number; pageSize: number } };
  setPageIndex(index: number): void;
}

/** Rows in display order; the given array when no table is mounted yet. */
export function displayOrder<T>(table: NavTable<T> | null | undefined, fallback: T[]): T[] {
  if (!table) return fallback;
  try {
    return table.getSortedRowModel().rows.map((row) => row.original);
  } catch {
    return fallback;
  }
}

export function positionOf<T>(rows: T[], isCurrent: (row: T) => boolean): number | null {
  const i = rows.findIndex(isCurrent);
  return i === -1 ? null : i;
}

/**
 * The neighbour `delta` rows away in display order, with the table's page
 * moved to show it. Null at either end of the list.
 */
export function stepRow<T>(
  table: NavTable<T> | null | undefined,
  fallback: T[],
  isCurrent: (row: T) => boolean,
  delta: number,
): { row: T; index: number } | null {
  const rows = displayOrder(table, fallback);
  const at = positionOf(rows, isCurrent);
  if (at === null) return null;
  const index = at + delta;
  const row = rows[index];
  if (row === undefined) return null;
  const pagination = table?.getState().pagination;
  if (table && pagination && pagination.pageSize > 0) {
    const page = Math.floor(index / pagination.pageSize);
    if (page !== pagination.pageIndex) table.setPageIndex(page);
  }
  return { row, index };
}
