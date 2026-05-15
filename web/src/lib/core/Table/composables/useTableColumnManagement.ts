// Copyright 2026 OpenObserve Inc.

import { ref, watch, computed, type Ref } from "vue";

/**
 * Manages column resize, drag-reorder, and visibility state.
 *
 * Coordinates:
 * - Column resize state tracking (is currently resizing?)
 * - Column drag-reorder state (drag start/end handlers)
 * - Column visibility toggle
 */
export function useTableColumnManagement(
  props: {
    enableColumnResize?: boolean;
    enableColumnReorder?: boolean;
    columnVisibility?: Record<string, boolean>;
    columnOrder: Ref<string[]>;
    columnIds: Ref<string[]>;
    /** Column id that must stay first (e.g., timestamp column in logs) */
    pinnedFirstColumn?: string;
  },
  emit: any,
) {
  const isResizing = ref(false);
  const isDragging = ref(false);

  function onResizeStart() {
    isResizing.value = true;
  }

  function onResizeEnd() {
    // Debounce — actual resize ends quickly
    setTimeout(() => {
      isResizing.value = false;
    }, 100);
  }

  function onDragStart(event: any) {
    isDragging.value = true;
    // state tracking only — event flows through header emit
  }

  function onDragEnd() {
    isDragging.value = false;

    // Enforce pinned first column position
    if (
      props.pinnedFirstColumn &&
      props.columnOrder.value.includes(props.pinnedFirstColumn) &&
      props.columnOrder.value[0] !== props.pinnedFirstColumn
    ) {
      const newOrder = props.columnOrder.value.filter(
        (id) => id !== props.pinnedFirstColumn,
      );
      newOrder.unshift(props.pinnedFirstColumn);
      props.columnOrder.value = [...newOrder];
    }

    emit("column-order-change", props.columnOrder.value);
  }

  function closeColumn(columnId: string) {
    // Remove from column order
    const newOrder = props.columnOrder.value.filter(
      (id) => id !== columnId,
    );
    props.columnOrder.value = newOrder;
    // Update visibility
    const newVisibility = { ...props.columnVisibility };
    newVisibility[columnId] = false;
    emit("column-visibility-change", newVisibility);
    emit("column-close", columnId);
  }

  function toggleColumnVisibility(columnId: string) {
    const newVisibility = { ...props.columnVisibility };
    newVisibility[columnId] = !(newVisibility[columnId] ?? true);
    emit("column-visibility-change", newVisibility);
  }

  const visibleColumnCount = computed(() => {
    return props.columnOrder.value.filter(
      (id) => props.columnVisibility?.[id] !== false,
    ).length;
  });

  return {
    isResizing,
    isDragging,
    onResizeStart,
    onResizeEnd,
    onDragStart,
    onDragEnd,
    closeColumn,
    toggleColumnVisibility,
    visibleColumnCount,
  };
}
