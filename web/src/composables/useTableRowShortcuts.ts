// Copyright 2026 OpenObserve Inc.

import { ref, onMounted, onBeforeUnmount } from "vue";
import { isInputFocused } from "@/utils/keyboardShortcuts";

/**
 * Keyboard shortcuts for a hovered table row.
 *
 * Follows the same pattern as PanelContainer.vue panel hover shortcuts:
 * a direct `keydown` listener on `window`, gated by an `isHovered` flag.
 * This avoids ShortcutManager conflicts when many rows are mounted at once.
 *
 * Usage — in the row component or in the page component that owns the table:
 *
 *   const { isHovered, onMouseenter, onMouseleave } = useTableRowShortcuts({
 *     onEdit:   () => openEditDialog(row),
 *     onDelete: () => confirmDeleteRow(row),   // page's existing confirm dialog
 *   });
 *
 *   <tr @mouseenter="onMouseenter" @mouseleave="onMouseleave">
 *
 * Rules:
 *  - E      → calls onEdit()   when this row is hovered and no input is focused
 *  - Del/⌫  → calls onDelete() when this row is hovered and no input is focused
 *             (onDelete should open the page's existing confirm dialog — not delete directly)
 */
export function useTableRowShortcuts(options: {
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const isHovered = ref(false);

  const handleKeydown = (e: KeyboardEvent) => {
    if (!isHovered.value) return;
    if (isInputFocused()) return;

    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      options.onEdit?.();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      options.onDelete?.();
    }
  };

  onMounted(() => window.addEventListener("keydown", handleKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));

  function onMouseenter() {
    isHovered.value = true;
  }

  function onMouseleave() {
    isHovered.value = false;
  }

  return { isHovered, onMouseenter, onMouseleave };
}
