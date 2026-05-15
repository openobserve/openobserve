// Copyright 2026 OpenObserve Inc.

import { computed } from "vue";
import type { OTableFilterMode, OTableFilterParams } from "../OTable.types";

export function useTableFiltering<TData>(
  props: {
    globalFilter?: string;
    globalFilterPlaceholder?: string;
    filterMode?: OTableFilterMode;
  },
  emit: any,
) {
  const isClientMode = computed(() => (props.filterMode ?? "client") === "client");
  const isServerMode = computed(() => props.filterMode === "server");

  const filterValue = computed(() => props.globalFilter ?? "");

  function setGlobalFilter(value: string) {
    emit("update:globalFilter", value);
    if (isServerMode.value) {
      emit("filter-change", { global: value });
    }
  }

  function clearFilter() {
    setGlobalFilter("");
  }

  return {
    isClientMode,
    isServerMode,
    filterValue,
    setGlobalFilter,
    clearFilter,
  };
}
