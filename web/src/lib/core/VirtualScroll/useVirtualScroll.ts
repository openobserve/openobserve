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
  } = options;

  const scrollMargin = ref(0);

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

  const virtualizerOptions = computed(() => ({
    count: items.value.length,
    getScrollElement: () =>
      (scrollTarget?.value as HTMLElement | null) ?? parentRef.value,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin: scrollMargin.value,
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

  return {
    virtualItems,
    totalSize,
    visibleRange,
    scrollMargin,
    scrollToIndex,
    scrollToTop,
    measure,
  };
}
