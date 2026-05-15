// Copyright 2026 OpenObserve Inc.
// Licensed under AGPL v3.

import { ref, watch, onMounted, onBeforeUnmount, type Ref } from "vue";
import { useScreen } from "./useScreen";
import { useHaptics } from "./useHaptics";

export interface PullToRefreshOptions {
  threshold?: number;
  onRefresh: () => Promise<unknown> | unknown;
}

export function usePullToRefresh(
  containerRef: Ref<HTMLElement | null>,
  options: PullToRefreshOptions,
) {
  const { isMobile } = useScreen();
  const { vibrate } = useHaptics();
  const threshold = options.threshold ?? 70;

  const pullDistance = ref(0);
  const isRefreshing = ref(false);
  const isPulling = ref(false);

  let startY = 0;
  let pulling = false;
  // Fire haptic exactly once per gesture, the instant the pull crosses the
  // threshold (iOS Messages / Mail behavior). Don't fire on release — the
  // feedback is most useful as confirmation that the refresh is armed.
  let thresholdCrossed = false;
  // Guard the post-await ref writes: a parent may destroy the wrapper while
  // `onRefresh` is still in flight (navigation, route change). The refs are
  // still reactive — we just skip the redundant mutation to avoid appearing
  // to "finish" a gesture on a detached component.
  let unmounted = false;

  const resetPull = () => {
    pullDistance.value = 0;
    isPulling.value = false;
    pulling = false;
    startY = 0;
    thresholdCrossed = false;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (!isMobile.value || isRefreshing.value) return;
    const el = containerRef.value;
    if (!el) return;
    if (el.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  };

  // Don't commit to a pull (preventDefault + visible distance) until the
  // finger has moved past a small intent threshold. iOS Safari otherwise
  // loses the first ~8px of any native scroll-out-of-bounce gesture.
  const INTENT_DELTA_PX = 8;

  const onTouchMove = (e: TouchEvent) => {
    if (!pulling || isRefreshing.value) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) {
      resetPull();
      return;
    }
    if (delta < INTENT_DELTA_PX) return;
    isPulling.value = true;
    pullDistance.value = Math.min(delta * 0.5, threshold * 1.5);
    if (!thresholdCrossed && pullDistance.value >= threshold) {
      thresholdCrossed = true;
      vibrate("impact");
    }
    if (e.cancelable) e.preventDefault();
  };

  const onTouchEnd = async () => {
    if (!pulling) return;
    const triggered = pullDistance.value >= threshold;
    pulling = false;
    isPulling.value = false;

    if (triggered && !isRefreshing.value) {
      isRefreshing.value = true;
      try {
        await options.onRefresh();
      } catch (err) {
        // Callers own error UX (they control the data fetch that backs
        // `onRefresh`). Log for diagnostics rather than re-throwing into a
        // microtask, which surfaces as an uncaught exception with no stack
        // context for the original caller.
        // eslint-disable-next-line no-console
        console.error("[usePullToRefresh] onRefresh rejected:", err);
      } finally {
        if (!unmounted) {
          isRefreshing.value = false;
          pullDistance.value = 0;
          thresholdCrossed = false;
        }
      }
    } else {
      pullDistance.value = 0;
      thresholdCrossed = false;
    }
  };

  const attach = (el: HTMLElement) => {
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
  };

  const detach = (el: HTMLElement) => {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchEnd);
  };

  let attached: HTMLElement | null = null;

  onMounted(() => {
    if (containerRef.value) {
      attach(containerRef.value);
      attached = containerRef.value;
    }
  });

  // Re-bind if the container element is remounted (v-if in a parent destroys
  // and recreates the node; without this watcher listeners stay on the stale
  // node). flush:'post' ensures the new DOM node is committed before we
  // attach — otherwise an immediate touch on the freshly-mounted container
  // could land on the stale listener set.
  watch(
    containerRef,
    (el) => {
      if (el === attached) return;
      if (attached) detach(attached);
      if (el) attach(el);
      attached = el;
    },
    { flush: "post" },
  );

  onBeforeUnmount(() => {
    unmounted = true;
    if (attached) detach(attached);
    attached = null;
  });

  return {
    pullDistance,
    isRefreshing,
    isPulling,
    threshold,
  };
}
