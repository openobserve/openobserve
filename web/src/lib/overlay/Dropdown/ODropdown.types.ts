/**
 * ODropdown.types.ts — public types for ODropdown.
 */

import type { DropdownMenuContentProps, DropdownMenuRootProps } from "reka-ui";

// Re-export family types so callers can import everything from one place if needed
export type {
  DropdownItemVariant,
  DropdownItemProps,
  DropdownItemEmits,
  DropdownItemSlots,
} from "./ODropdownItem.types";
export type {
  DropdownGroupProps,
  DropdownGroupSlots,
} from "./ODropdownGroup.types";
export type { DropdownSeparatorSlots } from "./ODropdownSeparator.types";

export type DropdownAlign = "start" | "center" | "end";
export type DropdownSide = "top" | "right" | "bottom" | "left";

export interface DropdownProps {
  /** Controlled open state — use with v-model:open */
  open?: boolean;
  /** Whether the dropdown blocks interaction with the rest of the page (default: false) */
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
  /** The element that opens the dropdown — rendered as-child into the trigger */
  trigger?: () => unknown;
  /** ODropdownItem / ODropdownGroup / ODropdownSeparator children */
  default?: () => unknown;
}
