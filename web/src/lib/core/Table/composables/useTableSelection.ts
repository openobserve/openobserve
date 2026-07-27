// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch } from "vue";
import type { Row, Table } from "@tanstack/vue-table";
import type { OTableSelectionMode } from "../OTable.types";

export function useTableSelection<TData>(
  table: Table<TData>,
  props: {
    selection: OTableSelectionMode;
    selectedIds?: string[];
    rowKey?: string;
    /**
     * Predicate that decides whether a row participates in selection. When
     * provided, "Select All" and the indeterminate / all-selected state of
     * the header checkbox only consider rows that pass this predicate.
     * Without this, a parent that filters non-selectable rows out of the
     * controlled `selectedIds` would break the header toggle: `allSelected`
     * could never become true (because the visible non-selectable rows are
     * never in the set), so the header could only ever select, never
     * deselect.
     */
    isRowSelectable?: (row: TData) => boolean;
  },
  emit: any,
) {
  const isEnabled = computed(() => props.selection !== "none");
  const isMultiple = computed(() => props.selection === "multiple");
  const isSingle = computed(() => props.selection === "single");

  const keyField = computed(() => props.rowKey ?? "id");

  // Track selected ids locally
  const localSelectedIds = ref<Set<string>>(new Set(props.selectedIds ?? []));

  watch(
    () => props.selectedIds,
    (ids) => {
      localSelectedIds.value = new Set(ids ?? []);
    },
  );

  function getRowId(row: TData): string {
    return (row as any)[keyField.value]?.toString() ?? "";
  }

  function isRowSelected(row: TData): boolean {
    return localSelectedIds.value.has(getRowId(row));
  }

  function toggleRow(row: TData) {
    const id = getRowId(row);
    const newSet = new Set(localSelectedIds.value);

    if (isSingle.value) {
      // Single select: clear all and set only this one
      newSet.clear();
      if (!newSet.has(id)) newSet.add(id);
      else newSet.delete(id);
    } else {
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
    }

    localSelectedIds.value = newSet;
    emitSelection(newSet);
  }

  function selectableRows(): Row<TData>[] {
    const rows = table.getRowModel().rows;
    if (!props.isRowSelectable) return rows;
    return rows.filter((r) => props.isRowSelectable!(r.original));
  }

  function toggleAllRows() {
    const newSet = new Set(localSelectedIds.value);
    const allIds =
      props.selection === "multiple" ? selectableRows().map((r) => getRowId(r.original)) : [];

    if (allIds.length === 0) return;

    const allSelected = allIds.every((id) => newSet.has(id));

    if (allSelected) {
      allIds.forEach((id) => newSet.delete(id));
    } else {
      allIds.forEach((id) => newSet.add(id));
    }

    localSelectedIds.value = newSet;
    emitSelection(newSet);
  }

  function isAllSelected(): boolean {
    const rows = selectableRows();
    if (rows.length === 0) return false;
    return rows.every((r) => isRowSelected(r.original));
  }

  function isIndeterminate(): boolean {
    const rows = selectableRows();
    if (rows.length === 0) return false;
    const selectedCount = rows.filter((r) => isRowSelected(r.original)).length;
    return selectedCount > 0 && selectedCount < rows.length;
  }

  function clearSelection() {
    localSelectedIds.value = new Set();
    emitSelection(new Set());
  }

  function getSelectedRows(): TData[] {
    return table
      .getRowModel()
      .rows.filter((r) => isRowSelected(r.original))
      .map((r) => r.original);
  }

  function emitSelection(ids: Set<string>) {
    const arr = Array.from(ids);
    emit("update:selectedIds", arr);
    emit("selection-change", getSelectedRows());
  }

  return {
    isEnabled,
    isMultiple,
    isSingle,
    keyField,
    getRowId,
    isRowSelected,
    toggleRow,
    toggleAllRows,
    isAllSelected,
    isIndeterminate,
    clearSelection,
    getSelectedRows,
  };
}
