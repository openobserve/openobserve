/**
 * ODropdownItem.types.ts — public types for a menu item (ODropdownItem and OContextMenuItem).
 */

import type { I18nText } from "@/types/i18n";

import type { IconName } from "../../core/Icon/OIcon.icons";

/** `danger` items go last, after a separator, and confirm (guideline B7). */
export type MenuItemTone = "default" | "danger";

export interface MenuItemProps {
  /** Leading glyph. */
  icon?: IconName;
  /** @default "default" */
  tone?: MenuItemTone;
  disabled?: boolean;
  /** With `disabled`, keeps the item focusable and says why under its label (guideline B9). */
  disabledReason?: I18nText | null;
  /** A second line under the label for a rich item. */
  description?: I18nText | null;
  /** Single-choice groups: a check mark at the end of the chosen item. */
  checked?: boolean;
  /** Shortcut registry id; its keys show at the end (KB3). */
  shortcut?: string;
  /** Keys to show when there is no registry binding. */
  keys?: string | string[];
  /** Text used for typeahead matching (overrides text content) */
  textValue?: string;
  as?: "div" | "button";
}

export type DropdownItemProps = MenuItemProps;

export interface DropdownItemEmits {
  (e: "select", event: Event): void;
}

export interface MenuItemSlots {
  /** A custom leading glyph (an avatar, a colour dot) instead of `icon`. */
  icon?: () => unknown;
  /** Label text / content */
  default?: () => unknown;
  /** Trailing content (a count, a badge) before the shortcut. */
  end?: () => unknown;
}

export type DropdownItemSlots = MenuItemSlots;
