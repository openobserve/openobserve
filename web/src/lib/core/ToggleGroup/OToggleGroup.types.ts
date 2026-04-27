/**
 * OToggleGroup.types.ts — public types for OToggleGroup.
 */

import type { AcceptableValue } from "reka-ui";

// Re-export item types so callers can import everything from one place if needed
export type {
  ToggleGroupItemProps,
  ToggleGroupItemSlots,
} from "./OToggleGroupItem.types";

export type ToggleGroupType = "single" | "multiple";
export type ToggleGroupOrientation = "horizontal" | "vertical";

export interface ToggleGroupProps {
  /** Whether one or multiple items can be active at a time */
  type?: ToggleGroupType;
  /** Controlled active value(s) — use with v-model */
  modelValue?: AcceptableValue | AcceptableValue[];
  /** Disables all items in the group */
  disabled?: boolean;
  /** Layout axis for keyboard navigation */
  orientation?: ToggleGroupOrientation;
}

export interface ToggleGroupEmits {
  (e: "update:modelValue", value: AcceptableValue | AcceptableValue[]): void;
}

export interface ToggleGroupSlots {
  /** One or more OToggleGroupItem children */
  default?: () => unknown;
}
