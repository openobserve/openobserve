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
  /** Label text rendered next to the toggle bar. For richer content use the `label` slot. */
  label?: string;
  /** Position of the label relative to the toggle bar */
  labelPosition?: "left" | "right" | "top";
  /**
   * Enables drag-to-reorder. OToggleGroup only reports the intended move via
   * the `reorder` event; the parent owns the item list/order and is
   * responsible for applying it. Default: false
   */
  reorderable?: boolean;
}

export interface ToggleGroupEmits {
  (e: "update:modelValue", value: AcceptableValue | AcceptableValue[]): void;
  /**
   * Fired when an item is dropped onto another (reorderable mode). `from` is
   * the dragged item's value, `to` is the drop-target item's value, and
   * `before` indicates the drop side (true = insert before the target, false =
   * after) as determined by the pointer position. The parent moves `from`
   * accordingly.
   *
   * Values round-trip through the DOM `dataset`, so they are always strings
   * here even when the item's `value` prop was a number — compare with
   * `String(item.value)` on the receiving side.
   */
  (e: "reorder", payload: { from: string; to: string; before: boolean }): void;
}

export interface ToggleGroupSlots {
  /** One or more OToggleGroupItem children */
  default?: () => unknown;
  /** Custom label content (overrides the `label` prop) */
  label?: () => unknown;
}

/** Shape of the provide() payload shared with child OToggleGroupItem components */
export interface ToggleGroupContext {
  /** Whether items can be dragged to reorder (sets draggable on each item) */
  reorderable: boolean;
  /** Value of the item currently being dragged (null when not dragging) */
  draggingValue: string | null;
  /** Value of the item the pointer is hovering as a drop target (null = none) */
  dropTargetValue: string | null;
  /** Drop side for the current drop target: true = before, false = after */
  dropBefore: boolean;
  /** Whether the group is laid out vertically (drop side uses Y instead of X) */
  isVertical: boolean;
}

/** Symbol key used for provide / inject */
export const TOGGLE_GROUP_CONTEXT_KEY = Symbol("OToggleGroupContext");
