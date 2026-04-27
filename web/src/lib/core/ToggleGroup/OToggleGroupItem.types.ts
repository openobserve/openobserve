/**
 * OToggleGroupItem.types.ts — public types for OToggleGroupItem.
 */

import type { AcceptableValue } from "reka-ui";

export interface ToggleGroupItemProps {
  /** Unique value for this option — required */
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
