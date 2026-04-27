/**
 * Dropdown.types.ts ΓÇö single source of truth for all ODropdown family types.
 */

import type { DropdownMenuContentProps, DropdownMenuRootProps } from "reka-ui";

// --- ODropdown (Root + Content) ----------------------------------------------

export type DropdownAlign = "start" | "center" | "end";
export type DropdownSide = "top" | "right" | "bottom" | "left";

export interface DropdownProps {
  /** Controlled open state ΓÇö use with v-model:open */
  open?: boolean;
  /** Whether the dropdown blocks interaction with the rest of the page */
  modal?: DropdownMenuRootProps["modal"];
  /** Preferred side to open relative to the trigger */
  side?: DropdownSide;
  /** Preferred alignment against the trigger */
  align?: DropdownAlign;
  /** Pixel offset from the trigger */
  sideOffset?: DropdownMenuContentProps["sideOffset"];
}

export interface DropdownEmits {
  (e: "update:open", value: boolean): void;
}

export interface DropdownSlots {
  /** The element that opens the dropdown ΓÇö rendered as-child into the trigger */
  trigger?: () => unknown;
  /** ODropdownItem / ODropdownGroup / ODropdownSeparator children */
  default?: () => unknown;
}

// --- ODropdownItem ------------------------------------------------------------

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

// --- ODropdownGroup -----------------------------------------------------------

export interface DropdownGroupProps {
  /** Optional visible group label */
  label?: string;
}

export interface DropdownGroupSlots {
  default?: () => unknown;
}

// --- ODropdownSeparator -------------------------------------------------------

export interface DropdownSeparatorSlots {
  // no slots ΓÇö purely visual
}
