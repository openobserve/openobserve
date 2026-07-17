// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch } from "vue";
import type { OTableExpansionMode } from "../OTable.types";

export function useTableExpansion<TData>(
  props: {
    expansion: OTableExpansionMode;
    /** Getter for expanded row IDs.
     *
     *  Must be a **getter**, not a plain array. When OTable's setup()
     *  reads `props.expandedIds` and passes the value into this plain
     *  object, Vue unwraps the reactive prop → the composable receives
     *  a frozen snapshot that never changes. A getter (OTable passes
     *  `() => props.expandedIds`) closes over OTable's reactive props
     *  so the watcher below can track the dependency reactively. */
    expandedIds?: () => string[] | undefined;
    rowKey?: string;
    getSubRows?: (row: TData) => TData[];
  },
  emit: any,
) {
  const isEnabled = computed(() => props.expansion !== "none");
  const isSingle = computed(() => props.expansion === "single");
  const isMultiple = computed(() => props.expansion === "multiple");
  const isTree = computed(() => props.expansion === "tree");

  const keyField = computed(() => props.rowKey ?? "id");

  /** Resolve the expanded IDs, falling back to empty array. */
  const resolveExpandedIds = () => props.expandedIds?.() ?? [];

  const localExpandedIds = ref<Set<string>>(
    new Set(resolveExpandedIds()),
  );

  watch(
    () => resolveExpandedIds(),
    (ids) => {
      localExpandedIds.value = new Set(ids);
    },
    { flush: 'sync' },
  );

  function getRowId(row: TData): string {
    return (row as any)[keyField.value]?.toString() ?? "";
  }

  function isExpanded(row: TData): boolean {
    return localExpandedIds.value.has(getRowId(row));
  }

  function toggleRow(row: TData) {
    const id = getRowId(row);
    const newSet = new Set(localExpandedIds.value);

    if (isSingle.value && !isTree.value) {
      const wasExpanded = newSet.has(id);
      newSet.clear();
      if (!wasExpanded) newSet.add(id);
    } else {
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
    }

    localExpandedIds.value = newSet;
    emitExpanded(newSet);
  }

  function expandRow(row: TData) {
    const id = getRowId(row);
    const newSet = new Set(localExpandedIds.value);
    if (isSingle.value && !isTree.value) newSet.clear();
    newSet.add(id);
    localExpandedIds.value = newSet;
    emitExpanded(newSet);
  }

  function collapseRow(row: TData) {
    const id = getRowId(row);
    const newSet = new Set(localExpandedIds.value);
    newSet.delete(id);
    localExpandedIds.value = newSet;
    emitExpanded(newSet);
  }

  function expandAll(rows?: TData[]) {
    const newSet = new Set(localExpandedIds.value);
    const targetRows = rows ?? [];
    for (const row of targetRows) {
      newSet.add(getRowId(row));
    }
    localExpandedIds.value = newSet;
    emitExpanded(newSet);
  }

  function collapseAll() {
    localExpandedIds.value = new Set();
    emitExpanded(new Set());
  }

  function emitExpanded(ids: Set<string>) {
    emit("update:expandedIds", Array.from(ids));
  }

  return {
    isEnabled,
    isSingle,
    isMultiple,
    isTree,
    keyField,
    getRowId,
    isExpanded,
    toggleRow,
    expandRow,
    collapseRow,
    expandAll,
    collapseAll,
  };
}
