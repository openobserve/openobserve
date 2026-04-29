/**
 * ODropdownItem.types.ts — public types for ODropdownItem.
 */

/** Visual intent of the item */
export type DropdownItemVariant = "default" | "destructive";

export interface DropdownItemProps {
  /** Visual intent — use destructive for Delete/Remove actions */
  variant?: DropdownItemVariant;
  /** Prevents the user from interacting with this item */
  disabled?: boolean;
  /** Text used for typeahead matching (overrides text content) */
  textValue?: string;
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
