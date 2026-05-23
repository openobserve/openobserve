/**
 * OToggleGroupItem.types.ts — public types for OToggleGroupItem.
 */

import type { AcceptableValue } from "reka-ui";

/** Size controls padding and font-size — height is determined by content */
export type ToggleGroupItemSize = "md" | "sm" | "xs";

export interface ToggleGroupItemProps {
  /** Unique value for this option — required */
  value: AcceptableValue;
  /** Disables only this item */
  disabled?: boolean;
  /** Tooltip shown on hover — especially useful when disabled is true to explain why */
  tooltip?: string;
  /** Size controls padding and font-size. md (default) = full toolbar; sm = small toolbar; xs = compact inline toggle */
  size?: ToggleGroupItemSize;
  /** Icon name (from OIcon registry) placed before the label. For custom icon components, use the `icon-left` slot. */
  iconLeft?: string;
  /** Icon name (from OIcon registry) placed after the label. For custom icon components, use the `icon-right` slot. */
  iconRight?: string;
}

export interface ToggleGroupItemSlots {
  /** Icon placed before the label */
  "icon-left"?: () => unknown;
  /** Label text / content */
  default?: () => unknown;
  /** Icon placed after the label */
  "icon-right"?: () => unknown;
}
