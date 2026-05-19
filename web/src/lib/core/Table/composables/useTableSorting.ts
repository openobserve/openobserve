// Copyright 2026 OpenObserve Inc.

import { computed } from "vue";
import type { Table } from "@tanstack/vue-table";
import type { OTableSortingMode, OTableSortParams } from "../OTable.types";

export function useTableSorting<TData>(
  table: Table<TData>,
  props: {
    sorting: OTableSortingMode;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    sortFieldMap?: Record<string, string>;
  },
  emit: any,
) {
  const isClientMode = computed(() => props.sorting === "client");
  const isServerMode = computed(() => props.sorting === "server");
  const isEnabled = computed(() => props.sorting !== "none");

  const activeSortBy = computed(() => props.sortBy ?? null);
  const activeSortOrder = computed(() => props.sortOrder ?? "asc");

  function handleSort(columnId: string) {
    if (isServerMode.value) {
      const field = props.sortFieldMap?.[columnId] ?? columnId;
      if (activeSortBy.value !== field) {
        emit("update:sortBy", field);
        emit("update:sortOrder", "asc");
        emit("sort-change", { column: field, order: "asc" });
      } else if (activeSortOrder.value === "asc") {
        emit("update:sortBy", field);
        emit("update:sortOrder", "desc");
        emit("sort-change", { column: field, order: "desc" });
      } else {
        // was desc → clear sort
        emit("update:sortBy", "");
        emit("update:sortOrder", "asc");
        emit("sort-change", { column: "", order: "asc" });
      }
    }
    // Client-side sorting is handled by TanStack internally via toggleSorting
  }

  function getSortIcon(columnId: string): "asc" | "desc" | "none" {
    if (isServerMode.value) {
      const field = props.sortFieldMap?.[columnId] ?? columnId;
      if (activeSortBy.value === field) return activeSortOrder.value;
      return "none";
    }
    const sorting = table.getState().sorting;
    const colSort = sorting?.find((s) => s.id === columnId);
    if (!colSort) return "none";
    return colSort.desc ? "desc" : "asc";
  }

  return {
    isClientMode,
    isServerMode,
    isEnabled,
    activeSortBy,
    activeSortOrder,
    handleSort,
    getSortIcon,
  };
}
