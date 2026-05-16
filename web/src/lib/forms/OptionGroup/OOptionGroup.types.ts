// Copyright 2026 OpenObserve Inc.

export type OptionGroupType = "radio" | "checkbox";
export type OptionGroupOrientation = "horizontal" | "vertical";
export type OptionGroupSize = "xs" | "sm" | "md";

export type OptionPrimitive = string | number | boolean;

export interface OptionGroupOption {
  /** Display label */
  label: string;
  /** Bound value */
  value: OptionPrimitive;
  /** Disable just this option */
  disabled?: boolean;
}

/** modelValue: single primitive for `radio`, array for `checkbox`. */
export type OptionGroupValue = OptionPrimitive | OptionPrimitive[] | undefined;

export interface OptionGroupProps {
  /** Current selection — single for radio, array for checkbox */
  modelValue?: OptionGroupValue;
  /** Available options */
  options: OptionGroupOption[];
  /** Group input type */
  type?: OptionGroupType;
  /** Layout direction */
  orientation?: OptionGroupOrientation;
  /** Label rendered above the group */
  label?: string;
  /** Helper text below the group */
  helpText?: string;
  /** Error message — when provided the group shows error styling */
  errorMessage?: string;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Disables the entire group */
  disabled?: boolean;
  /** Size for inner radio/checkbox controls */
  size?: OptionGroupSize;
  /** HTML name applied to inner inputs */
  name?: string;
}

export interface OptionGroupEmits {
  (_e: "update:modelValue", _value: OptionGroupValue): void;
  (_e: "change", _value: OptionGroupValue): void;
}

export interface OptionGroupSlots {
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
}
