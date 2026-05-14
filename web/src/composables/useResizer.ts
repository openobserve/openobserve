// Copyright 2026 OpenObserve Inc.

import { ref, onUnmounted, type Ref } from "vue";
import { throttle } from "lodash-es";

interface UseResizerOptions {
  direction: "horizontal" | "vertical";
  initialValue: number;
  minValue?: number;
  maxValue?: number;
  unit: "px" | "%";
  containerRef?: Ref<HTMLElement | null>;
  throttleMs?: number;
  invert?: boolean;
  onResize?: (value: number) => void;
}

function useResizer(options: UseResizerOptions) {
  const {
    direction,
    initialValue,
    minValue = -Infinity,
    maxValue = Infinity,
    unit,
    containerRef,
    throttleMs = 50,
    invert = false,
    onResize,
  } = options;

  const value = ref(initialValue);
  const isResizing = ref(false);

  let initialCoord = 0;
  let initialSize = 0;

  const cleanup = () => {
    document.removeEventListener("mousemove", resizing);
    document.removeEventListener("mouseup", stopResize);
    document.body.classList.remove("no-select");
    isResizing.value = false;
    if(resizing?.cancel) resizing.cancel();
  };

  const stopResize = () => {
    cleanup();
  };

  const resizing = throttle((event: MouseEvent) => {
    if (!isResizing.value) return;

    const currentCoord =
      direction === "horizontal" ? event.clientX : event.clientY;
    const delta = currentCoord - initialCoord;
    let newValue = initialSize + (invert ? -delta : delta);

    if (unit === "%" && containerRef?.value) {
      const containerSize =
        direction === "horizontal"
          ? containerRef.value.clientWidth
          : containerRef.value.clientHeight;
      const deltaPercent = ((invert ? -delta : delta) / containerSize) * 100;
      newValue = initialSize + deltaPercent;
    }

    newValue = Math.max(minValue, Math.min(maxValue, newValue));
    value.value = newValue;
    onResize?.(newValue);
  }, throttleMs);

  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    initialCoord =
      direction === "horizontal" ? event.clientX : event.clientY;
    initialSize = value.value;
    isResizing.value = true;

    document.addEventListener("mousemove", resizing);
    document.addEventListener("mouseup", stopResize);
    document.body.classList.add("no-select");
  };

  onUnmounted(() => {
    cleanup();
  });

  return {
    value,
    isResizing,
    onMouseDown,
  };
}

export default useResizer;
