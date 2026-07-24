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
export type { DropdownGroupProps, DropdownGroupSlots } from "./ODropdownGroup.types";
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
  /** Extra class(es) for the content (menu) element — e.g. to match trigger width. */
  contentClass?: string;
  /**
   * Outside-click persistence. Controls how many outside-click events must
   * happen before this dropdown actually dismisses:
   *
   *   false (default) — close immediately on the first outside click
   *   true            — never close on outside click (only via trigger / Esc / programmatic)
   *   number  N >= 1  — require N outside clicks to close
   *
   * Use a number when the dropdown contains nested popups (e.g. an OSelect)
   * and you want each outer-click to peel one layer at a time:
   *   <ODropdown :persistent="2">  ←  outer dropdown
   *     <OSelect />                ←  nested popup
   *   </ODropdown>
   * First click closes the OSelect; second click closes the ODropdown.
   */
  persistent?: boolean | number;
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
