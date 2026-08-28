// Copyright 2026 OpenObserve Inc.

import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * Edge-scroll state for a horizontally overflowing strip.
 *
 * Extracted from the same logic OTabs carries inline, because the parts that
 * are easy to get wrong are not the arrows — they are knowing WHEN to measure.
 * A ResizeObserver alone misses children being added or removed when the strip
 * itself does not change size, and a mutation callback can sample mid-update
 * layout, leaving a wrong `hasOverflow` that never corrects itself.
 */
export function useHorizontalOverflow(elRef: Ref<HTMLElement | null>) {
  const hasOverflow = ref(false);
  const canScrollLeft = ref(false);
  const canScrollRight = ref(false);

  function update(): void {
    const el = elRef.value;
    if (!el) {
      hasOverflow.value = false;
      canScrollLeft.value = false;
      canScrollRight.value = false;
      return;
    }
    // The 1px slack absorbs sub-pixel layout: without it a strip scrolled fully
    // right can report a fraction of a pixel remaining and keep its arrow.
    hasOverflow.value = el.scrollWidth > el.clientWidth + 1;
    canScrollLeft.value = el.scrollLeft > 1;
    canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  let raf = 0;
  function updateSettled(): void {
    update();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }

  /** One column per press: a full-viewport jump loses the reader's place. */
  function scrollByStep(direction: 1 | -1): void {
    const el = elRef.value;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const step = first ? first.offsetWidth + 12 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }

  let ro: ResizeObserver | null = null;
  let mo: MutationObserver | null = null;

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    ro = new ResizeObserver(update);
    ro.observe(el);
    mo = new MutationObserver(updateSettled);
    mo.observe(el, { childList: true, subtree: true });
    updateSettled();
  });

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
    elRef.value?.removeEventListener("scroll", update);
    ro?.disconnect();
    mo?.disconnect();
  });

  return { hasOverflow, canScrollLeft, canScrollRight, scrollByStep, update };
}
