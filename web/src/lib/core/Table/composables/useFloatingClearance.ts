// Copyright 2026 OpenObserve Inc.

import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";

/** A fixed control floating over the page, and the element whose content it covers. */
export interface FloatingObstacle {
  rect: DOMRect;
  scope: Element;
}

const obstacle = shallowRef<FloatingObstacle | null>(null);

/** Publishes (or with null, withdraws) the floating control that table pagers must end before. */
export function publishFloatingObstacle(next: FloatingObstacle | null): void {
  obstacle.value = next;
}

/** Inline-end inset in px that clears `box` of `over`, or 0 when the two rects do not overlap. */
export function clearanceFor(box: DOMRect, over: DOMRect, rtl: boolean): number {
  const overlaps =
    box.top < over.bottom &&
    box.bottom > over.top &&
    box.left < over.right &&
    box.right > over.left;
  if (!overlaps) return 0;
  return Math.max(0, Math.ceil(rtl ? over.right - box.left : box.right - over.left));
}

/** Rem the element's inline-end content must give up to a published obstacle it overlaps; 0 otherwise. */
export function useFloatingClearance(el: Ref<HTMLElement | null>): Ref<number> {
  const clearance = ref(0);
  let entering: IntersectionObserver | null = null;
  let resizing: ResizeObserver | null = null;

  function measure(): void {
    const node = el.value;
    const current = obstacle.value;
    if (!node || !current || !current.scope.contains(node)) {
      clearance.value = 0;
      return;
    }
    const rtl = getComputedStyle(node).direction === "rtl";
    clearance.value = clearanceFor(node.getBoundingClientRect(), current.rect, rtl) / 16;
  }

  // Observers exist only while an obstacle is published, so pagers cost nothing without one.
  function detach(): void {
    entering?.disconnect();
    resizing?.disconnect();
    entering = resizing = null;
  }

  // The viewport shrunk to the obstacle's rect is the root, so any move into or out of it re-measures.
  function attach(node: HTMLElement, { rect }: FloatingObstacle): void {
    if (typeof IntersectionObserver !== "undefined") {
      const edges = [
        rect.top,
        window.innerWidth - rect.right,
        window.innerHeight - rect.bottom,
        rect.left,
      ];
      const rootMargin = edges.map((edge) => `${-Math.max(0, Math.floor(edge))}px`).join(" ");
      entering = new IntersectionObserver(measure, { rootMargin });
      entering.observe(node);
    }
    if (typeof ResizeObserver === "undefined") return;
    resizing = new ResizeObserver(measure);
    resizing.observe(node);
  }

  watch(
    [obstacle, el],
    ([current, node]) => {
      detach();
      if (current && node) attach(node, current);
      measure();
    },
    { immediate: true, flush: "post" },
  );
  onBeforeUnmount(detach);
  return clearance;
}
