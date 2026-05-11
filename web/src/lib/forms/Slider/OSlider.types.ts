// Copyright 2026 OpenObserve Inc.

export type SliderSize = "sm" | "md" | "lg";

export interface SliderProps {
  /** Current numeric value */
  modelValue?: number;
  /** Minimum value (inclusive) */
  min?: number;
  /** Maximum value (inclusive) */
  max?: number;
  /** Step increment */
  step?: number;
  /** Label rendered above the track */
  label?: string;
  /** Show numeric value next to the label */
  showValue?: boolean;
  /** Format function for the displayed value */
  formatValue?: (_value: number) => string;
  /** Helper text below the track */
  helpText?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Control size */
  size?: SliderSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface SliderEmits {
  (_e: "update:modelValue", _value: number): void;
  (_e: "change", _value: number): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
}

export interface SliderSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
}
