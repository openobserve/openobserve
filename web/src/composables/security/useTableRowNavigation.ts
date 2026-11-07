// Copyright 2026 OpenObserve Inc.
//
// useTableRowNavigation.ts — record-drawer next/previous over an OTable ref,
// in the table's displayed order (see utils/security/recordNav.ts).

import { ref, type Ref } from "vue";
import { displayOrder, positionOf, stepRow, type NavTable } from "@/utils/security/recordNav";

export function useTableRowNavigation<T>(
  tableRef: Ref<{ table?: unknown } | null>,
  fallbackRows: Ref<T[]>,
  keyOf: (row: T) => string,
) {
  /** Position of the open record in the table's current order, or null. */
  const index = ref<number | null>(null);
  const table = () => tableRef.value?.table as NavTable<T> | undefined;

  /** Re-reads the open record's position; call after open, sort or data change. */
  function locate(current: T | null) {
    const key = current ? keyOf(current) : null;
    index.value =
      key === null
        ? null
        : positionOf(displayOrder(table(), fallbackRows.value), (r) => keyOf(r) === key);
  }

  /** The row `delta` away from `current`, turning the table's page to show it. */
  function neighbour(current: T | null, delta: number): T | null {
    if (!current) return null;
    const key = keyOf(current);
    return stepRow(table(), fallbackRows.value, (r) => keyOf(r) === key, delta)?.row ?? null;
  }

  return {
    index,
    locate,
    neighbour,
    total: () => displayOrder(table(), fallbackRows.value).length,
  };
}
