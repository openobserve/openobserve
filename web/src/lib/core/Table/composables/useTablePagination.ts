// Copyright 2026 OpenObserve Inc.

import { computed, watch } from "vue";
import type { Table } from "@tanstack/vue-table";
import type { OTablePaginationMode } from "../OTable.types";

export function useTablePagination<TData>(
  table: Table<TData>,
  props: {
    pagination: OTablePaginationMode;
    pageSize?: number;
    pageSizeOptions?: number[];
    currentPage?: number;
    totalCount?: number;
    data: TData[];
  },
  emit: any,
) {
  const isClientMode = computed(() => props.pagination === "client");
  const isServerMode = computed(() => props.pagination === "server");
  const isEnabled = computed(() => props.pagination !== "none");

  const pageSizeOptions = computed(() =>
    props.pageSizeOptions ?? [20, 50, 100, 250, 500],
  );

  // In client mode, allow the parent to force a specific page by passing currentPage.
  // This lets callers reset to page 1 on filter/search changes without relying on
  // TanStack's autoResetPageIndex (which can't distinguish filter vs expansion changes).
  watch(
    () => props.currentPage,
    (page) => {
      if (isClientMode.value && page != null) {
        table.setPageIndex(page - 1);
      }
    },
  );

  // Client-side: current page from TanStack state
  const currentPage = computed(() => {
    if (isServerMode.value) return props.currentPage ?? 1;
    return (table.getState().pagination?.pageIndex ?? 0) + 1;
  });

  const pageSize = computed(() => {
    if (isServerMode.value) return props.pageSize ?? 20;
    return table.getState().pagination?.pageSize ?? props.pageSize ?? 20;
  });

  const totalPages = computed(() => {
    if (isServerMode.value) {
      return Math.ceil((props.totalCount ?? 0) / pageSize.value) || 1;
    }
    return table.getPageCount() || 1;
  });

  const totalCount = computed(() => {
    if (isServerMode.value) return props.totalCount ?? 0;
    return props.data.length;
  });

  const isFirstPage = computed(() => currentPage.value <= 1);
  const isLastPage = computed(() => currentPage.value >= totalPages.value);

  const showingFrom = computed(() => {
    if (totalCount.value === 0) return 0;
    return (currentPage.value - 1) * pageSize.value + 1;
  });

  const showingTo = computed(() => {
    const to = currentPage.value * pageSize.value;
    return to > totalCount.value ? totalCount.value : to;
  });

  function setPageSize(size: number) {
    if (isClientMode.value) {
      table.setPageSize(size);
    }
    emit("update:pageSize", size);
    emit("pagination-change", { page: currentPage.value, size });
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages.value) return;
    if (isClientMode.value) {
      table.setPageIndex(page - 1);
    }
    emit("update:currentPage", page);
    emit("pagination-change", { page, size: pageSize.value });
  }

  function nextPage() {
    if (!isLastPage.value) goToPage(currentPage.value + 1);
  }

  function prevPage() {
    if (!isFirstPage.value) goToPage(currentPage.value - 1);
  }

  function firstPage() {
    goToPage(1);
  }

  function lastPage() {
    goToPage(totalPages.value);
  }

  return {
    isClientMode,
    isServerMode,
    isEnabled,
    pageSizeOptions,
    currentPage,
    pageSize,
    totalPages,
    totalCount,
    isFirstPage,
    isLastPage,
    showingFrom,
    showingTo,
    setPageSize,
    goToPage,
    nextPage,
    prevPage,
    firstPage,
    lastPage,
  };
}
