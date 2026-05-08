// Copyright 2026 OpenObserve Inc.

export type ToggleSize = "sm" | "md" | "lg";

export interface ToggleProps {
  /** Current on/off state */
  modelValue?: boolean;
  /** Accessible label rendered beside the switch */
  label?: string;
  /** Whether the label appears before (start) or after (end) the switch */
  labelPlacement?: "start" | "end";
  /** Control size */
  size?: ToggleSize;
  /** Icon shown for both states when state-specific icons are absent */
  icon?: string;
  /** Icon shown when checked */
  checkedIcon?: string;
  /** Icon shown when unchecked */
  uncheckedIcon?: string;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface ToggleEmits {
  (_e: "update:modelValue", _value: boolean): void;
  (_e: "change", _value: boolean): void;
}

export interface ToggleSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
}
