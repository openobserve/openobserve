// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type Ref } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { Row } from "@tanstack/vue-table";

export interface VirtualizationOptions {
  rows: Ref<Row<any>[]>;
  parentRef: Ref<HTMLElement | null>;
  scrollEl?: HTMLElement | null;
  scrollMargin?: number;
  rowHeight?: number;
  /** Custom height estimator for expanded rows */
  expandedRowHeights?: Ref<Record<number, number>>;
  overscan?: number;
}

/**
 * Virtual scroll composable using @tanstack/vue-virtual.
 * Handles row virtualization with support for variable row heights
 * (e.g., expanded rows or wrapped content).
 */
export function useTableVirtualization(options: VirtualizationOptions) {
  const {
    rows,
    parentRef,
    scrollEl,
    scrollMargin = 0,
    rowHeight = 24,
    expandedRowHeights,
    overscan = 100,
  } = options;

  const isFirefox = computed(() => {
    return (
      typeof document !== "undefined" &&
      CSS.supports("-moz-appearance", "none")
    );
  });

  const baseOffset = isFirefox.value ? 20 : 0;

  const rowVirtualizerOptions = computed(() => ({
    count: rows.value.length,
    getScrollElement: () =>
      (scrollEl as HTMLElement | null) ?? parentRef.value,
    scrollMargin,
    estimateSize: (index: number) => {
      const row = rows.value[index];
      // Check for expanded rows (metadata flag)
      if ((row?.original as any)?.isExpandedRow) {
        return expandedRowHeights?.value?.[index] ?? 300;
      }
      return rowHeight;
    },
    overscan,
    measureElement:
      typeof window !== "undefined" && !isFirefox.value
        ? (element: any) => {
            const index = parseInt(element.dataset.virtualIndex);
            const row = rows.value[index];
            const isExpandedRow = (row?.original as any)?.isExpandedRow;
            if (isExpandedRow) {
              const height = element.getBoundingClientRect().height;
              if (expandedRowHeights?.value) {
                expandedRowHeights.value[index] = height;
              }
              return height;
            }
            return rowHeight;
          }
        : undefined,
  }));

  const rowVirtualizer = useVirtualizer(rowVirtualizerOptions);
  const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
  const totalSize = computed(() => rowVirtualizer.value.getTotalSize() + 24);

  function scrollToIndex(index: number) {
    rowVirtualizer.value.scrollToIndex(index);
  }

  function scrollToTop() {
    rowVirtualizer.value.scrollToIndex(0);
  }

  function measure() {
    rowVirtualizer.value.measure();
  }

  return {
    rowVirtualizer,
    virtualRows,
    totalSize,
    scrollToIndex,
    scrollToTop,
    measure,
    baseOffset,
    isFirefox,
  };
}
