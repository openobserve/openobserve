// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

export type DateSize = "sm" | "md";

export interface DateProps {
  /** ISO-8601 date string in `YYYY-MM-DD` format */
  modelValue?: string;
  /** Minimum selectable date — `YYYY-MM-DD` */
  min?: string;
  /** Maximum selectable date — `YYYY-MM-DD` */
  max?: string;
  /** Label rendered above the field */
  label?: I18nText;
  /** Placeholder shown when the field is empty (browser support varies) */
  placeholder?: I18nText;
  /** Helper text rendered below the field */
  helpText?: I18nText;
  /** Error message — when provided the field shows error styling */
  errorMessage?: I18nText;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Whether the user can clear the value */
  clearable?: boolean;
  /** Apply immediately on date click (default true). Set false to show an Apply button. */
  autoApply?: boolean;
  /** Prevents editing */
  readonly?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** Control size */
  size?: DateSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface DateEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "change", _value: string): void;
  (_e: "clear"): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
}

export interface DateSlots {
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
}
