// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** Control height (S1): xs 24 inside table rows only, sm 28, md 32 (default), lg 36 sign-in only. */
export type InputSize = "xs" | "sm" | "md" | "lg";

/** Width by the expected value (S7): s 160, m 240, l 360, or the container's full width. */
export type FieldWidth = "s" | "m" | "l" | "full";

export const INPUT_SIZES = ["xs", "sm", "md", "lg"] as const satisfies readonly InputSize[];
export const FIELD_WIDTHS = ["s", "m", "l", "full"] as const satisfies readonly FieldWidth[];

export type InputType =
  "text" | "password" | "email" | "number" | "search" | "url" | "tel" | "date" | "datetime-local";

export interface InputProps {
  /** Bound value */
  modelValue?: string | number;
  /** v-model modifiers passthrough for number/trim semantics */
  modelModifiers?: {
    number?: boolean;
    trim?: boolean;
  };
  /** HTML input type. A password always gets the show/hide toggle. */
  type?: InputType;
  /** Label above the field (S3) */
  label?: I18nText;
  /** Placeholder text */
  placeholder?: I18nText;
  /** Helper text displayed below the field */
  helpText?: I18nText;
  /** Error message — when provided the field shows error styling */
  errorMessage?: I18nText;
  /** Marks the field as being in an error state without a message */
  error?: boolean;
  /** Leading icon inside the box */
  icon?: IconName;
  /** Text inside the box before the value, such as "$" */
  prefix?: string;
  /** Unit or suffix inside the box after the value, such as "%" or "ms" (T4) */
  suffix?: string;
  /** Shows a ✕ button to clear the field: on for filters, off for required fields (S6) */
  clearable?: boolean;
  /** Prevents value editing */
  readonly?: boolean;
  /** Adds a copy button inside the box; meant for read-only values */
  copyable?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** Monospace value for IDs, patterns and paths (T4) */
  mono?: boolean;
  /** Focuses the input on mount */
  autofocus?: boolean;
  /** Debounce delay in milliseconds before emitting model updates */
  debounce?: number;
  /** Input mask compatibility (supports `time`, `fulltime`, `DD-MM-YYYY`) */
  mask?: string;
  /** Maximum character length — shows a counter when set */
  maxlength?: number;
  /** Minimum value — `type="number"`/`"date"`/`"datetime-local"` only */
  min?: number | string;
  /** Maximum value — `type="number"`/`"date"`/`"datetime-local"` only */
  max?: number | string;
  /** Step increment — `type="number"` only */
  step?: number | string;
  /** Control height; xs is for inline editing inside a table row only */
  size?: InputSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
  /** HTML autocomplete */
  autocomplete?: string;
  /** Width by the expected value (S7); defaults to `full` */
  width?: FieldWidth;
}

export interface InputEmits {
  (_e: "update:modelValue", _value: string | number): void;
  (_e: "clear"): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
  (_e: "keydown", _event: KeyboardEvent): void;
  (_e: "keyup", _event: KeyboardEvent): void;
  (_e: "keypress", _event: KeyboardEvent): void;
  (_e: "paste", _event: ClipboardEvent): void;
}

export interface InputSlots {
  /** Custom leading content inside the box when `icon` cannot express it */
  icon?: () => unknown;
  /** Trailing content inside the box, before the clear and reveal buttons */
  "icon-end"?: () => unknown;
  /** Tooltip content rendered inside an info icon beside the label */
  tooltip?: () => unknown;
}
