// Copyright 2026 OpenObserve Inc.

import { onMounted, onBeforeUnmount, type Ref } from "vue";
import { isInputFocused } from "@/utils/keyboardShortcuts";

// Single-letter shortcuts a hovered/focused row responds to. A page opts a row
// in by putting data-row-action="edit|delete|…" on the matching action button.
const ROW_ACTION_KEYS: Record<string, string> = {
  e: "edit",
  d: "duplicate",
  i: "inspect",
  p: "pause",
  r: "resume",
  v: "view",
  x: "export",
};

const ROW_SELECTOR = "tr[data-test^='o2-table-row-']";

/**
 * Row hover/focus keyboard shortcuts for OTable — ONE delegated `window`
 * listener for the whole table.
 *
 * Previously EVERY row registered its own identical `window` keydown listener
 * (gated by a per-row hovered/focused flag, deduped through a shared WeakSet), so
 * a 500-row page installed 500 listeners and every keystroke fanned out to all of
 * them. This installs a single listener and resolves the "active" row on demand:
 * the focused row (rows are focusable when the table is clickable) or, failing
 * that, the row under the pointer.
 *
 * Supported on the active row:
 *  • ↑ / ↓                              move focus to the adjacent row
 *  • Enter                              click the row (same as a mouse click)
 *  • Delete/Backspace, e/d/i/p/r/v/x    click its [data-row-action='…'] button
 */
export function useTableRowShortcuts(containerRef: Ref<HTMLElement | null>) {
  function activeRow(container: HTMLElement): HTMLElement | null {
    const active = document.activeElement;
    // A focused row wins — keyboard navigation focuses rows via their tabindex.
    if (
      active instanceof HTMLElement &&
      active.matches(ROW_SELECTOR) &&
      container.contains(active)
    ) {
      return active;
    }
    // Otherwise the row under the pointer.
    const hovered = container.querySelector(`${ROW_SELECTOR}:hover`);
    return hovered instanceof HTMLElement ? hovered : null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return;
    const container = containerRef.value;
    if (!container) return;
    const row = activeRow(container);
    if (!row) return;

    // Only act when focus is on the document body or on the active row itself —
    // never hijack keys while the user is on a specific control (a button/input).
    const active = document.activeElement;
    if (active && active !== document.body && active !== row) return;

    // ↑ / ↓ — move focus to the adjacent row.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      let sibling: Element | null =
        e.key === "ArrowDown"
          ? row.nextElementSibling
          : row.previousElementSibling;
      while (sibling && !(sibling as HTMLElement).matches?.(ROW_SELECTOR)) {
        sibling =
          e.key === "ArrowDown"
            ? sibling.nextElementSibling
            : sibling.previousElementSibling;
      }
      if (sibling instanceof HTMLElement) {
        e.preventDefault();
        if (sibling.hasAttribute("tabindex")) sibling.focus();
        else sibling.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      }
      return;
    }

    // Enter triggers the row's click handler (same as a mouse click).
    if (e.key === "Enter") {
      e.preventDefault();
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return;
    }

    const action =
      e.key === "Delete" || e.key === "Backspace"
        ? "delete"
        : ROW_ACTION_KEYS[e.key.toLowerCase()];
    if (!action) return;

    const btn = row.querySelector<HTMLElement>(`[data-row-action='${action}']`);
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  }

  onMounted(() => window.addEventListener("keydown", handleKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
}
