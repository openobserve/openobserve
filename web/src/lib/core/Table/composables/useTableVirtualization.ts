// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, toValue, type Ref, type MaybeRefOrGetter } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { Row } from "@tanstack/vue-table";

export interface VirtualizationOptions {
  rows: Ref<Row<any>[]>;
  parentRef: Ref<HTMLElement | null>;
  /**
   * External scroll element for delegated/unified scroll (e.g. the logs grid
   * shares one scroll container with the histogram above it). Accepts a plain
   * element, a ref, or a getter so it can be resolved **reactively** — the
   * element is often `null` at setup time and only becomes available after the
   * parent mounts. Passing a snapshot (`props.scrollEl`) means the virtualizer
   * would never rebind to the real element; a getter/ref fixes that.
   */
  scrollEl?: MaybeRefOrGetter<HTMLElement | null>;
  scrollMargin?: number;
  rowHeight?: number;
  /** Custom height estimator for expanded rows */
  expandedRowHeights?: Ref<Record<number, number>>;
  overscan?: number;
  /**
   * Variable-height mode (G8): when true, EVERY data row is measured from the
   * DOM (not just expanded rows) — required for logs `wrap` where wrapped
   * content makes each row a different height. `rowHeight` is only the initial
   * estimate; the real height comes from measurement (and a ResizeObserver keeps
   * it correct when content reflows, e.g. the wrap toggle). Off by default so
   * fixed-height virtual tables (traces grid) keep their cheaper fixed path.
   * Accepts a ref/getter so it can track the reactive `wrap` state.
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
    // Resolve the scroll element INSIDE the computed body so the computed tracks
    // it: when a ref/getter scrollEl (or the parentRef template ref) flips from
    // null → the real element after mount, the options recompute and the
    // virtualizer rebinds its scroll listener to the correct element (G10).
    const resolvedScrollEl =
      (toValue(scrollEl) as HTMLElement | null) ?? parentRef.value;
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
      // In variable-height mode `rowHeight` is only the initial estimate; the
      // real height is supplied by measureElement once the row renders.
      return rowHeight;
    },
    overscan,
    // Called by the virtualizer when a row invokes `measureRowElement` (below).
    // It reads the element's `data-index` and returns the measured DOM height for
    // expanded rows AND — in variable-height mode — every data row. Fixed-height
    // rows never call it (they keep `estimateSize`), so this stays cheap there.
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
    rowVirtualizer.value.measure();
  }

  /**
   * Ref callback for a virtual row's `<tr>` in variable-height mode (G8). The
   * element must carry `data-index`; the virtualizer measures it (and, in modern
   * @tanstack/vue-virtual, observes it so it re-measures when its content
   * reflows — e.g. the logs wrap toggle). No-op when the element is null.
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
