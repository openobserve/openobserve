// Copyright 2026 OpenObserve Inc.

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

export const SCROLL_IDLE_MS = 150;

/** True while `target` scrolls and for SCROLL_IDLE_MS after its last scroll event. */
export function useScrollHoverGuard(target: () => HTMLElement | null | undefined): Ref<boolean> {
  const scrolling = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onScroll = (): void => {
    scrolling.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      scrolling.value = false;
      timer = null;
    }, SCROLL_IDLE_MS);
  };

  let bound: HTMLElement | null = null;
  const bind = (el: HTMLElement | null | undefined): void => {
    if (el === bound) return;
    bound?.removeEventListener("scroll", onScroll);
    bound = el ?? null;
    bound?.addEventListener("scroll", onScroll, { passive: true });
  };

  onMounted(() => bind(target()));
  watch(target, bind, { flush: "post" });

  onBeforeUnmount(() => {
    bind(null);
    if (timer) clearTimeout(timer);
  });

  return scrolling;
}
