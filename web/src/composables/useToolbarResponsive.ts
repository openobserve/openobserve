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

export function useToolbarResponsive() {
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

  onMounted(() => {
    const barEl = toolbarLeftRef.value?.parentElement;
    if (barEl) {
      toolbarBarWidth.value = barEl.getBoundingClientRect().width;
      leftObserver = new ResizeObserver((entries) => {
        toolbarBarWidth.value = entries[0]?.contentRect.width ?? 0;
      });
      leftObserver.observe(barEl);
    }
    if (toolbarRightRef.value) {
      toolbarRightWidth.value = toolbarRightRef.value.getBoundingClientRect().width;
      rightObserver = new ResizeObserver((entries) => {
        toolbarRightWidth.value = entries[0]?.contentRect.width ?? 0;
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
