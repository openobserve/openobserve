// Copyright 2026 OpenObserve Inc.

import { useShortcuts } from "@/lib/vue-shortcut-manager";
import type { Shortcut } from "@/lib/vue-shortcut-manager";

/**
 * Returns true when no text-input element has focus.
 * Single-letter shortcuts should guard with this to avoid firing while typing.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName.toLowerCase();
  // Only treat contentEditable as an input when it has role="textbox"
  // (CodeMirror, ProseMirror, etc.). Generic contentEditable containers
  // (e.g. panel drag handles) should not block shortcuts.
  const isContentEditableInput =
    (el as HTMLElement).isContentEditable &&
    (el.getAttribute("role") === "textbox" ||
      el.closest('[role="textbox"]') !== null);
  return ["input", "textarea", "select"].includes(tag) || isContentEditableInput;
}

/**
 * Registers shortcuts on both Windows (ctrl) and Mac (meta/⌘).
 * For every shortcut whose key starts with "ctrl+", a hidden "meta+" twin is
 * also registered so the action fires on Mac without duplicating the cheatsheet entry.
 */
export function useShortcutsWithMac(shortcuts: Shortcut[]): void {
  const expanded: Shortcut[] = [];
  for (const s of shortcuts) {
    expanded.push(s);
    if (s.key.startsWith("ctrl+")) {
      expanded.push({
        ...s,
        key: "meta+" + s.key.slice(5),
        hidden: true,
      });
    }
  }
  useShortcuts(expanded);
}
