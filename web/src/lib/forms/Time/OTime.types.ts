// Copyright 2026 OpenObserve Inc.

export type TimeSize = "sm" | "md";

export interface TimeProps {
  /** Time string in `HH:MM` (or `HH:MM:SS` when `withSeconds`) format */
  modelValue?: string;
  /** Enable seconds precision (`HH:MM:SS`) */
  withSeconds?: boolean;
  /** Minimum selectable time — `HH:MM` */
  min?: string;
  /** Maximum selectable time — `HH:MM` */
  max?: string;
  /** Step in seconds — default 60 (one minute) */
  step?: number;
  /** Label rendered above the field */
  label?: string;
  /** Placeholder shown when empty */
  placeholder?: string;
  /** Helper text below the field */
  helpText?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Whether the user can clear the value */
  clearable?: boolean;
  /** Prevents editing */
  readonly?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Control size */
  size?: TimeSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface TimeEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "change", _value: string): void;
  (_e: "clear"): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
}

export interface TimeSlots {
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
}
