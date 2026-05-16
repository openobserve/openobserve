// Copyright 2026 OpenObserve Inc.

export type SwitchSize = "sm" | "md" | "lg";
export type SwitchValue = boolean | string | number;
/**
 * Custom value type for `checkedValue`/`uncheckedValue`. Excludes `boolean` on
 * purpose: Vue auto-coerces optional Boolean-typed props to `false` when not
 * passed, which would make `checkedValue !== undefined` always evaluate true
 * and break the default boolean toggle behaviour.
 */
export type SwitchCustomValue = string | number;

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
  checkedValue?: SwitchCustomValue;
  /** Value to emit when unchecked — replaces q-toggle `false-value` */
  uncheckedValue?: SwitchCustomValue;
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
  /** Tooltip content — renders an info icon inline in the label when provided.
   *  The icon gets `data-test="${parentDataTest}-info"` automatically. */
  tooltip?: () => unknown;
}
