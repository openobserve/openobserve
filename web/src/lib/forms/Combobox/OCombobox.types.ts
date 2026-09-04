// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

export interface ComboboxOption {
  label: I18nText;
  value: string;
}

export interface ComboboxProps {
  /** Bound value — the text displayed in the input */
  modelValue?: string;
  /** Placeholder text for the input */
  placeholder?: I18nText;
  /** Label shown above the input */
  label?: I18nText;
  /** Options array: `{ label, value }` objects  */
  items?: ComboboxOption[];
  /**
   * Regex applied to the current input to extract the search needle.
   * Capture groups are tried in order; the first non-undefined group
   * becomes the needle. Mirrors CommonAutoComplete's `searchRegex` prop.
   * When omitted, the full input value is used as the needle.
   */
  searchRegex?: string;
  /**
   * Transform function applied to the selected option before the value
   * is emitted. Mirrors CommonAutoComplete's `valueReplaceFn` prop.
   * Defaults to returning `option.value`.
   */
  valueReplaceFn?: (option: ComboboxOption) => string;
  /** Disables the control */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** Input size */
  size?: "sm" | "md";
  /** Whether the input is in an error state */
  error?: boolean;
  /** Error message shown below the input */
  errorMessage?: I18nText;
  /** Help text shown below the input */
  helpText?: I18nText;
  /**
   * Debounce delay (ms) before emitting `update:modelValue`.
   * Useful when the parent performs expensive operations on every change.
   * Defaults to 0 (no debounce).
   */
  debounce?: number;
  /** id forwarded to the input element */
  id?: string;
  /** name forwarded to the input element */
  name?: string;
  /**
   * Controls where the label is rendered.
   * - `"outside"` (default): label renders above the input as a block element.
   * - `"inside"`: label renders as a small floating label pinned inside the top of the input.
   */
  labelPosition?: "inside" | "outside";
}

export interface ComboboxEmits {
  "update:modelValue": [value: string];
  /** Fired when the user selects an option from the dropdown */
  select: [value: string];
}

export interface ComboboxSlots {
  /** Slot rendered inside the label area (replaces label prop) */
  label?(): unknown;
  /** Slot for a tooltip icon next to the label */
  tooltip?(): unknown;
}
