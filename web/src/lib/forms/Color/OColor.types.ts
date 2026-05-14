// Copyright 2026 OpenObserve Inc.

export type ColorSize = "sm" | "md";

export interface ColorProps {
  /** Color value in `#RRGGBB` format */
  modelValue?: string;
  /** Label rendered above the field */
  label?: string;
  /** Placeholder shown when value is empty */
  placeholder?: string;
  /** Helper text below the field */
  helpText?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /**
   * If true, the hex text input is read-only — users can only change the
   * value via the swatch picker. Defaults to false (typing is allowed).
   *
   * Inverted from a previous `editable` prop to avoid Vue's boolean coercion
   * making the input read-only when the parent doesn't pass anything.
   */
  readonly?: boolean;
  /** Whether the user can clear the value */
  clearable?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Control size */
  size?: ColorSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface ColorEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "change", _value: string): void;
  (_e: "clear"): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
}

export interface ColorSlots {
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
}
