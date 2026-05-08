// Copyright 2026 OpenObserve Inc.

export type SwitchSize = "sm" | "md" | "lg";
export type SwitchValue = boolean | string | number;

export interface SwitchProps {
  /** Current on/off state */
  modelValue?: SwitchValue;
  /** Accessible label rendered beside the switch */
  label?: string;
  /** Whether the label appears before (left) or after (right) the switch */
  labelPosition?: "left" | "right";
  /** Control size */
  size?: SwitchSize;
  /** Value to emit when checked — replaces q-toggle `true-value` */
  checkedValue?: SwitchValue;
  /** Value to emit when unchecked — replaces q-toggle `false-value` */
  uncheckedValue?: SwitchValue;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface SwitchEmits {
  (_e: "update:modelValue", _value: SwitchValue): void;
  (_e: "change", _value: SwitchValue): void;
}

export interface SwitchSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
}
