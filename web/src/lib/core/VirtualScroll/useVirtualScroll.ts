// Copyright 2026 OpenObserve Inc.

import { computed, onMounted, ref, watch, type Ref } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";

export interface UseVirtualScrollOptions {
  /** Reactive array of items to virtualize. */
  items: Ref<any[]>;
  /** Ref to the component's own scroll container (used when no external scrollTarget). */
  parentRef: Ref<HTMLElement | null>;
  /** Optional external scroll container. Overrides parentRef for scroll listening. */
  scrollTarget?: Ref<HTMLElement | null | undefined>;
  /** Estimated item height in px. @default 40 */
  estimateSize?: number;
  /** Extra items rendered outside the visible viewport. @default 5 */
  overscan?: number;
  /**
   * When true, enables per-element DOM measurement via ResizeObserver +
   * measureElement, so items with variable heights are tracked correctly.
   * When false (default), all items use the static estimateSize.
   */
  dynamicRowHeight?: boolean;
}

/**
 * Thin composable wrapping @tanstack/vue-virtual for generic list virtualization.
 *
 * Mirrors the pattern of `useTableVirtualization` but works with any `T[]`
 * instead of TanStack Table `Row<T>[]`.
 */
export function useVirtualScroll(options: UseVirtualScrollOptions) {
  const {
    items,
    parentRef,
    scrollTarget,
    estimateSize = 40,
    overscan = 5,
    dynamicRowHeight = false,
  } = options;

  const scrollMargin = ref(0);
  const measuredHeights = ref<Record<number, number>>({});

  /**
   * Recompute scrollMargin when using an external scroll target.
   * scrollMargin = distance from the top of the scroll container to the top
   * of this component's container — required for correct virtualizer offsets.
   */
  function updateScrollMargin() {
    const target = scrollTarget?.value;
    const parent = parentRef.value;
    if (!target || !parent) {
      scrollMargin.value = 0;
      return;
    }
    const parentRect = parent.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scrollMargin.value = parentRect.top - targetRect.top + target.scrollTop;
  }

  onMounted(() => {
    updateScrollMargin();
  });

  // Update scrollMargin whenever the external target changes.
  if (scrollTarget) {
    watch(scrollTarget, () => updateScrollMargin());
  }

  // Reset measured heights when items array changes (stale heights
  // from old items would misposition the virtualizer).
  watch(
    () => items.value.length,
    () => {
      measuredHeights.value = {};
    },
  );

  const virtualizerOptions = computed(() => ({
    count: items.value.length,
    getScrollElement: () =>
      (scrollTarget?.value as HTMLElement | null) ?? parentRef.value,
    estimateSize: dynamicRowHeight
      ? (index: number) => measuredHeights.value[index] || estimateSize
      : () => estimateSize,
    overscan,
    scrollMargin: scrollMargin.value,
    ...(dynamicRowHeight
      ? {
          indexAttribute: "data-virtual-index" as const,
          measureElement:
            typeof window !== "undefined"
              ? (element: HTMLElement) => {
                  const height = (element as HTMLElement).getBoundingClientRect().height;
                  const index = parseInt(
                    (element as HTMLElement).getAttribute("data-virtual-index") ?? "",
                    10,
                  );
                  if (!isNaN(index)) {
                    measuredHeights.value[index] = height;
                  }
                  return height;
                }
              : undefined,
        }
      : {}),
  }));

  const virtualizer = useVirtualizer(virtualizerOptions);

  const virtualItems = computed(() => virtualizer.value.getVirtualItems());
  const totalSize = computed(() => virtualizer.value.getTotalSize());
  /** Visible-only range (no overscan) as reported by the virtualizer. */
  const visibleRange = computed(() => virtualizer.value.range);

  function scrollToIndex(
    index: number,
    options?: Parameters<typeof virtualizer.value.scrollToIndex>[1],
  ) {
    virtualizer.value.scrollToIndex(index, options);
  }

  function scrollToTop() {
    virtualizer.value.scrollToIndex(0);
  }

  function measure() {
    virtualizer.value.measure();
  }

  function measureElement(node: any) {
    if (!dynamicRowHeight) return;
    virtualizer.value.measureElement(node);
  }
  return {
    virtualItems,
    totalSize,
    visibleRange,
    scrollMargin,
    scrollToIndex,
    scrollToTop,
    measure,
    measureElement
  };
}
