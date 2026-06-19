// Copyright 2026 OpenObserve Inc.

export type RangeSize = "sm" | "md" | "lg";

export interface RangeValue {
  min: number;
  max: number;
}

export interface RangeProps {
  /** Current { min, max } pair */
  modelValue?: RangeValue;
  /** Lowest selectable value */
  min?: number;
  /** Highest selectable value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Label rendered above the track */
  label?: string;
  /** Show numeric range next to the label */
  showValue?: boolean;
  /** Format function for individual displayed values */
  formatValue?: (_value: number) => string;
  /** Helper text below the track */
  helpText?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** Control size */
  size?: RangeSize;
  /** HTML id used as a prefix for both inputs */
  id?: string;
  /** HTML name used as a prefix for both inputs */
  name?: string;
  /** Vertical orientation — renders the track top-to-bottom */
  vertical?: boolean;
  /** Reverse value direction. For vertical: max at top, min at bottom */
  reverse?: boolean;
  /** Always show the current value label next to each thumb */
  labelAlways?: boolean;
  /** Show tick marks at marker label positions */
  markers?: boolean;
  /** Custom labels at specific value positions along the track */
  markerLabels?: { value: number; label: string }[];
}

export interface RangeEmits {
  (_e: "update:modelValue", _value: RangeValue): void;
  (_e: "change", _value: RangeValue): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
}

export interface RangeSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
}
