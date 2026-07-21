/**
 * OToggleGroup.types.ts — public types for OToggleGroup.
 */

import type { AcceptableValue } from "reka-ui";
import type { ComputedRef, InjectionKey } from "vue";

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
  /** Label text rendered next to the toggle bar. For richer content use the `label` slot. */
  label?: string;
  /** Position of the label relative to the toggle bar */
  labelPosition?: "left" | "right" | "top";
}

/**
 * Provided by OToggleGroup, injected by each OToggleGroupItem so the item knows to
 * defer its active fill to the group's sliding indicator. True for single-select
 * groups (which have exactly one item to track); false for multiple-select, where
 * each item keeps painting its own fill.
 */
export const ToggleGroupAnimatedKey: InjectionKey<ComputedRef<boolean>> = Symbol(
  "o-toggle-group-animated-selection",
);

export interface ToggleGroupEmits {
  (e: "update:modelValue", value: AcceptableValue | AcceptableValue[]): void;
}

export interface ToggleGroupSlots {
  /** One or more OToggleGroupItem children */
  default?: () => unknown;
  /** Custom label content (overrides the `label` prop) */
  label?: () => unknown;
}
