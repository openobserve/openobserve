/**
 * OToggleGroup.types.ts — public types for OToggleGroup.
 */

import type { AcceptableValue } from "reka-ui";

// Re-export item types so callers can import everything from one place if needed
export type {
  ToggleGroupItemSize,
  ToggleGroupItemProps,
  ToggleGroupItemSlots,
} from "./OToggleGroupItem.types";

export type ToggleGroupType = "single" | "multiple";
export type ToggleGroupOrientation = "horizontal" | "vertical";
/**
 * default — standard toggle on neutral/white backgrounds (logs page, dialogs)
 * primary — toggle placed on a primary-100 colored bar (dashboard query bar);
 *           uses a white active pill on a primary-200 track so it reads clearly
 */
export type ToggleGroupVariant = "default" | "primary";

export interface ToggleGroupProps {
  /** Whether one or multiple items can be active at a time */
  type?: ToggleGroupType;
  /** Controlled active value(s) — use with v-model */
  modelValue?: AcceptableValue | AcceptableValue[];
  /** Disables all items in the group */
  disabled?: boolean;
  /** Layout axis for keyboard navigation */
  orientation?: ToggleGroupOrientation;
  /** Visual variant — use 'primary' when the toggle sits on a primary-colored bar */
  variant?: ToggleGroupVariant;
}

export interface ToggleGroupEmits {
  (e: "update:modelValue", value: AcceptableValue | AcceptableValue[]): void;
}

export interface ToggleGroupSlots {
  /** One or more OToggleGroupItem children */
  default?: () => unknown;
}
