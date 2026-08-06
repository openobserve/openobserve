// Copyright 2026 OpenObserve Inc.

import { computed, toValue, type Ref, type MaybeRefOrGetter } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { Row } from "@tanstack/vue-table";

export interface VirtualizationOptions {
  rows: Ref<Row<any>[]>;
  parentRef: Ref<HTMLElement | null>;
  /**
   * External scroll element for delegated scroll. Accepts an element, a ref or a
   * getter: the element is usually null at setup, so a snapshot would leave the
   * virtualizer bound to nothing once the real element mounts.
   */
  scrollEl?: MaybeRefOrGetter<HTMLElement | null>;
  scrollMargin?: number;
  rowHeight?: number;
  /** Custom height estimator for expanded rows */
  expandedRowHeights?: Ref<Record<number, number>>;
  overscan?: number;
  /**
   * Variable-height mode: measure every data row from the DOM, not just expanded
   * rows, so wrapped content of differing heights lays out correctly. `rowHeight`
   * becomes the initial estimate only. Accepts a ref/getter so it can track a
   * reactive `wrap` state.
   */
  dynamicRowHeight?: MaybeRefOrGetter<boolean>;
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
    dynamicRowHeight,
  } = options;

  const isFirefox = computed(() => {
    return (
      typeof document !== "undefined" &&
      typeof CSS !== "undefined" &&
      CSS.supports("-moz-appearance", "none")
    );
  });

  const baseOffset = isFirefox.value ? 20 : 0;

  const rowVirtualizerOptions = computed(() => {
    // Resolve inside the computed body so it is tracked: when the element flips
    // from null to real after mount, the virtualizer rebinds its scroll listener.
    const resolvedScrollEl = (toValue(scrollEl) as HTMLElement | null) ?? parentRef.value;
    return {
      count: rows.value.length,
      getScrollElement: () => resolvedScrollEl,
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
      // Reads the element's `data-index` and returns its measured height for
      // expanded rows and, in variable-height mode, every data row.
      measureElement:
        typeof window !== "undefined"
          ? (element: any) => {
              const idx = Number(element?.getAttribute?.("data-index"));
              const row = Number.isFinite(idx) ? rows.value[idx] : undefined;
              const isExpandedRow = (row?.original as any)?.isExpandedRow;
              const dyn = !!toValue(dynamicRowHeight);
              if (isExpandedRow || dyn) {
                const height = element.getBoundingClientRect().height;
                if (isExpandedRow && expandedRowHeights?.value) {
                  expandedRowHeights.value[idx] = height;
                }
                return height;
              }
              return rowHeight;
            }
          : undefined,
    };
  });

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
    // The virtualizer only exposes `measure` once it has bound to a live scroll
    // element; under jsdom (and any pre-mount call) it can be absent, so guard
    // it the same way `measureRowElement` guards its DOM access below.
    if (typeof rowVirtualizer.value?.measure === "function") {
      rowVirtualizer.value.measure();
    }
  }

  /**
   * Ref callback for a virtual row's `<tr>` in variable-height mode. The element
   * must carry `data-index`; the virtualizer measures and observes it so it
   * re-measures when the content reflows.
   */
  function measureRowElement(el: Element | null) {
    if (el && typeof window !== "undefined") {
      rowVirtualizer.value.measureElement(el);
    }
  }

  return {
    rowVirtualizer,
    virtualRows,
    totalSize,
    scrollToIndex,
    scrollToTop,
    measure,
    measureRowElement,
    baseOffset,
    isFirefox,
  };
}
