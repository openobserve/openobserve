/**
 * OContextMenuItem.types.ts — a context-menu item shares the dropdown menu item's API.
 */

import type { MenuItemProps, MenuItemSlots } from "../Dropdown/ODropdownItem.types";

export type ContextMenuItemProps = MenuItemProps;

export interface ContextMenuItemEmits {
  (e: "select", event: Event): void;
}

export type ContextMenuItemSlots = MenuItemSlots;
