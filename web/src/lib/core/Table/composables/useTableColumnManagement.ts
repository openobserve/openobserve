// Copyright 2026 OpenObserve Inc.

import { ref, watch } from "vue";

/**
 * Manages column resize, reorder, and visibility state.
 * The actual TanStack column sizing is handled via columnSizing state in useTableCore.
 */
export function useTableColumnManagement(props: {
  enableColumnResize?: boolean;
  enableColumnReorder?: boolean;
  columnVisibility?: Record<string, boolean>;
  columnOrder?: string[];
}) {
  const isResizing = ref(false);

  function onResizeStart() {
    isResizing.value = true;
  }

  function onResizeEnd() {
    isResizing.value = false;
  }

  return {
    isResizing,
    onResizeStart,
    onResizeEnd,
  };
}
