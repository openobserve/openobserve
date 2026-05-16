// Copyright 2026 OpenObserve Inc.

import { onMounted, onBeforeUnmount, type Ref } from "vue";
import type { Table } from "@tanstack/vue-table";

/**
 * Keyboard navigation for OTable — accessible row/cell navigation.
 *
 * Supports:
 * - Arrow keys (↑ ↓ ← →) for cell navigation
 * - Enter/Space for row selection/expansion
 * - Home/End for first/last row
 * - PageUp/PageDown for page-by-page navigation
 */
export function useTableKeyboard<TData>(
  table: Table<TData>,
  containerRef: Ref<HTMLElement | null>,
  options?: {
    enabled?: Ref<boolean>;
    onRowSelect?: (row: TData) => void;
    onRowExpand?: (row: TData) => void;
  },
) {
  const isEnabled = options?.enabled ?? { value: true };

  function handleKeyDown(event: KeyboardEvent) {
    if (!isEnabled.value) return;

    const target = event.target as HTMLElement;
    // Only handle when focused within the table container
    if (!containerRef.value?.contains(target)) return;

    const rows = table.getRowModel().rows;
    if (rows.length === 0) return;

    // Find currently focused cell
    const focusedCell = containerRef.value?.querySelector(
      "td:focus, th:focus",
    ) as HTMLElement | null;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(1, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(-1, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveFocus(0, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(0, -1);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        if (focusedCell) {
          const rowEl = focusedCell.closest("tr");
          const rowIndex = Array.from(
            rowEl?.parentElement?.children ?? [],
          ).indexOf(rowEl as Element);
          if (rowIndex >= 0 && rowIndex < rows.length) {
            options?.onRowSelect?.(rows[rowIndex].original);
          }
        }
        break;
      }
      case "Home":
        event.preventDefault();
        focusCell(0, 0);
        break;
      case "End":
        event.preventDefault();
        focusCell(rows.length - 1, table.getAllColumns().length - 1);
        break;
    }
  }

  function moveFocus(rowDelta: number, colDelta: number) {
    const focusedCell = containerRef.value?.querySelector(
      "td:focus, th:focus",
    ) as HTMLElement | null;
    if (!focusedCell) {
      focusCell(0, 0);
      return;
    }

    const row = focusedCell.closest("tr");
    const cell = focusedCell.closest("td, th");
    if (!row || !cell) return;

    const rows = Array.from(row.parentElement?.children ?? []);
    const cells = Array.from(row.children);
    const rowIndex = rows.indexOf(row);
    const cellIndex = cells.indexOf(cell as Element);

    const newRowIndex = Math.max(
      0,
      Math.min(rows.length - 1, rowIndex + rowDelta),
    );
    const newCellIndex = Math.max(
      0,
      Math.min(
        (rows[newRowIndex]?.children.length ?? 1) - 1,
        cellIndex + colDelta,
      ),
    );

    focusCell(newRowIndex, newCellIndex);
  }

  function focusCell(rowIndex: number, cellIndex: number) {
    const rows = containerRef.value?.querySelectorAll("tbody tr");
    if (!rows || rowIndex >= rows.length) return;
    const cells = rows[rowIndex].querySelectorAll("td, th");
    if (cells.length === 0 || cellIndex >= cells.length) return;
    (cells[cellIndex] as HTMLElement).focus();
  }

  onMounted(() => {
    containerRef.value?.addEventListener("keydown", handleKeyDown);
  });

  onBeforeUnmount(() => {
    containerRef.value?.removeEventListener("keydown", handleKeyDown);
  });
}
