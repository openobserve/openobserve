// Copyright 2026 OpenObserve Inc.
//
// Shared toolbar responsive composable.
// Tracks available left-section width via ResizeObserver so toolbar breakpoints
// (text→icon, items→menu, etc.) fire automatically on any layout change.
//
// Usage:
//   const { toolbarLeftRef, toolbarRightRef, availableLeftWidth } = useToolbarResponsive();
//   // attach refs to the left and right toolbar divs in the template
//   // derive page-specific breakpoints from availableLeftWidth.value

import { ref, computed, onMounted, onUnmounted } from "vue";

export interface ToolbarResponsiveOptions {
  /** Keep the last real widths while the bar is detached (a kept-alive page in the cache), so it returns at its old stage. */
  keepWidthWhenDetached?: boolean;
}

export function useToolbarResponsive(options: ToolbarResponsiveOptions = {}) {
  const toolbarLeftRef = ref<HTMLElement | null>(null);
  const toolbarRightRef = ref<HTMLElement | null>(null);
  const toolbarBarWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1200);
  const toolbarRightWidth = ref(0);

  let leftObserver: ResizeObserver | null = null;
  let rightObserver: ResizeObserver | null = null;

  // Available width for the left section:
  //   bar container width − right section width − bar padding (14px)
  const availableLeftWidth = computed(() =>
    Math.max(0, toolbarBarWidth.value - toolbarRightWidth.value - 14),
  );

  // A detached element measures 0; that is not a width the bar must fit.
  const keepsWidth = (el: HTMLElement, width: number) =>
    !!options.keepWidthWhenDetached && width === 0 && !el.isConnected;

  onMounted(() => {
    const barEl = toolbarLeftRef.value?.parentElement;
    if (barEl) {
      toolbarBarWidth.value = barEl.getBoundingClientRect().width;
      leftObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        if (keepsWidth(barEl, width)) return;
        toolbarBarWidth.value = width;
      });
      leftObserver.observe(barEl);
    }
    if (toolbarRightRef.value) {
      toolbarRightWidth.value = toolbarRightRef.value.getBoundingClientRect().width;
      const rightEl = toolbarRightRef.value;
      rightObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        if (keepsWidth(rightEl, width)) return;
        toolbarRightWidth.value = width;
      });
      rightObserver.observe(toolbarRightRef.value);
    }
  });

  onUnmounted(() => {
    leftObserver?.disconnect();
    rightObserver?.disconnect();
  });

  return {
    toolbarLeftRef,
    toolbarRightRef,
    availableLeftWidth,
  };
}
