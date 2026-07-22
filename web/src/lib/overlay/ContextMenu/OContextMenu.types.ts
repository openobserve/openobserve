/**
 * OContextMenu.types.ts — public types for OContextMenu.
 *
 * OContextMenu is the right-click (and long-press on touch) counterpart to
 * ODropdown. Positioning is anchored to the pointer, not to the trigger
 * element, so the trigger can be an arbitrarily large region (a whole table,
 * a canvas, a list) and the menu still opens exactly where the user clicked.
 */

import type { ContextMenuRootProps } from "reka-ui";

// Re-export family types so callers can import everything from one place if needed
export type {
  ContextMenuItemVariant,
  ContextMenuItemProps,
  ContextMenuItemEmits,
  ContextMenuItemSlots,
} from "./OContextMenuItem.types";
export type { ContextMenuLabelSlots } from "./OContextMenuLabel.types";
export type { ContextMenuSeparatorSlots } from "./OContextMenuSeparator.types";

export interface ContextMenuProps {
  /**
   * Disables the menu without unmounting it — right-click falls through to the
   * browser's native context menu. Use for read-only or permission-gated views.
   */
  disabled?: boolean;
  /** Whether the menu blocks interaction with the rest of the page (default: false) */
  modal?: ContextMenuRootProps["modal"];
  /** Extra class(es) for the content (menu) element */
  contentClass?: string;
}

export interface ContextMenuEmits {
  (e: "update:open", value: boolean): void;
}

export interface ContextMenuSlots {
  /**
   * The region that responds to right-click — rendered as-child, so it keeps
   * its own tag and attributes (no wrapper element is introduced).
   */
  trigger?: () => unknown;
  /** OContextMenuItem / OContextMenuLabel / OContextMenuSeparator children */
  default?: () => unknown;
}
