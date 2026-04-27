/**
 * ToggleGroup.types.ts ΓÇö single source of truth for all OToggleGroup family types.
 */

import type { AcceptableValue } from "reka-ui";

// --- OToggleGroup -------------------------------------------------------------

export type ToggleGroupType = "single" | "multiple";
export type ToggleGroupOrientation = "horizontal" | "vertical";

export interface ToggleGroupProps {
  /** Whether one or multiple items can be active at a time */
  type?: ToggleGroupType;
  /** Controlled active value(s) ΓÇö use with v-model */
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

// --- OToggleGroupItem ---------------------------------------------------------

export interface ToggleGroupItemProps {
  /** Unique value for this option ΓÇö required */
  value: AcceptableValue;
  /** Disables only this item */
  disabled?: boolean;
}

export interface ToggleGroupItemSlots {
  /** Icon placed before the label */
  "icon-left"?: () => unknown;
  /** Label text / content */
  default?: () => unknown;
  /** Icon placed after the label */
  "icon-right"?: () => unknown;
}
