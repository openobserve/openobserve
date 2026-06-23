/**
 * OShortcut.types.ts — single source of truth for all OShortcut public types.
 * No types should be defined inline in OShortcut.vue.
 */

/** Size controls keycap height and font-size only — shape is baked in. */
export type ShortcutSize = "sm" | "md";

export interface ShortcutProps {
  /**
   * The shortcut to render as keycaps. Modifier tokens are symbolised and made
   * platform-aware automatically (`ctrl` → `⌘` on Mac, `Ctrl` on Windows;
   * `shift` → `⇧`; `enter` → `↵`; …). Either:
   *  - a string combo (`"ctrl+enter"`, `"ctrl+shift+a"`, `"?"`) — rendered as a
   *    single keycap (`⌘↵`, `⌘⇧A`, `?`).
   *  - an array — one keycap per element (`["g", "l"]` → `G` `L`); each element
   *    is itself symbolised, so pre-symbolised values pass through unchanged.
   */
  keys: string | string[];
  /** Keycap size. Default: `"sm"` */
  size?: ShortcutSize;
}
