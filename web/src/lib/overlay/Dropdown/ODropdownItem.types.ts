/**
 * ODropdownItem.types.ts — public types for ODropdownItem.
 */

import type { IconName } from "../../core/Icon/OIcon.icons";

/** Visual intent of the item */
export type DropdownItemVariant = "default" | "destructive";

export interface DropdownItemProps {
  /** Visual intent — use destructive for Delete/Remove actions */
  variant?: DropdownItemVariant;
  /** Prevents the user from interacting with this item */
  disabled?: boolean;
  /** Text used for typeahead matching (overrides text content) */
  textValue?: string;
  /** Icon placed before the label — renders an OIcon internally */
  iconLeft?: IconName;
  /**
   * Renders a keyboard-shortcut hint (OShortcut keycaps) at the trailing edge
   * of the item. Accepts a pre-symbolised string (`"⌘I"`) or an array of
   * keycaps (`["⌘", "I"]`). Omit to show no hint.
   */
  shortcut?: string | string[];
  /**
   * Registry shortcut id — resolves the hint keys from `shortcutRegistry.ts`
   * (the single source of truth) so a key change there updates this item too.
   * Prefer this over `shortcut`; `shortcut` wins if both are set.
   */
  shortcutId?: string;
}

export interface DropdownItemEmits {
  (e: "select", event: Event): void;
}

export interface DropdownItemSlots {
  /** Icon placed before the label */
  "icon-left"?: () => unknown;
  /** Label text / content */
  default?: () => unknown;
  /** Icon placed after the label */
  "icon-right"?: () => unknown;
}
