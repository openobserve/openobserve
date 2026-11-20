/**
 * OShortcut.types.ts — single source of truth for all OShortcut public types.
 * No types should be defined inline in OShortcut.vue.
 */

export interface ShortcutProps {
  /**
   * Keys to show when there is no registry binding. A combo string ("ctrl+enter") or an
   * array of combos (["g", "l"]); every key renders as its own cap, in order.
   */
  keys?: string | string[];
  /** Registry shortcut id; preferred, so the cap always shows the real binding (KB3). */
  id?: string;
}
