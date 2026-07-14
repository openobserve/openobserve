import type { Ref } from "vue";

export interface Shortcut {
  /**
   * Stable identifier (optional). When supplied it is used as the registration
   * id — handy for referencing/unregistering a specific shortcut. Auto-generated
   * when omitted.
   */
  id?: string;
  /** Default key combo — used on any platform with no platform-specific override. */
  key: string;
  /** Override combo on Windows / Linux (falls back to `key`). */
  keyForWindows?: string;
  /** Override combo on macOS (falls back to `key`). */
  keyForMac?: string;
  handler: () => void;
  description?: string;
  scope?: string;
  whenFocused?: Ref<HTMLElement | null> | HTMLElement | null;
  /** When true the shortcut fires but is omitted from the cheatsheet list */
  hidden?: boolean;
  /**
   * Fire even while a text input / contenteditable has focus. Only for
   * shortcuts that must work mid-typing (e.g. Escape closing a panel) —
   * plain-key shortcuts are otherwise suppressed so they don't steal
   * keystrokes from the user's typing.
   */
  allowInInput?: boolean;
}

/**
 * Registry-driven shortcut input: reference a shortcut by its registry `id` and
 * supply only the handler. Key(s), scope and description are resolved from
 * `shortcutRegistry.ts` — the single source of truth.
 */
export interface ShortcutById {
  id: string;
  handler: () => void;
  whenFocused?: Ref<HTMLElement | null> | HTMLElement | null;
}

/** Either a registry-driven reference (`{ id, handler }`) or a full inline `Shortcut`. */
export type ShortcutInput = ShortcutById | Shortcut;

export interface ShortcutManagerOptions {
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface RegisteredShortcut extends Shortcut {
  id: string;
}

export type ChangeListener = () => void;
