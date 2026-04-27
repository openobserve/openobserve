/**
 * ODropdownItem.types.ts — public types for ODropdownItem.
 */

export interface DropdownItemProps {
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
