// Copyright 2026 OpenObserve Inc.

export type InputSize = "sm" | "md";

/**
 * Semantic field width — maps to pre-defined CSS tokens.
 * - `xs`   ~120px  zip codes, CVV, short numbers
 * - `sm`   ~200px  dates, narrow labels
 * - `md`   ~280px  names, phone numbers
 * - `lg`   ~400px  emails, full addresses
 * - `full` 100%    fills the container (default)
 */
export type FieldWidth = "xs" | "sm" | "md" | "lg" | "full";

export type InputType =
  | "text"
  | "password"
  | "email"
  | "number"
  | "search"
  | "url"
  | "tel"
  | "textarea";

export interface InputProps {
  /** Bound value */
  modelValue?: string | number;
  /** HTML input type — use `textarea` for a multi-line field */
  type?: InputType;
  /** Floating / static label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text displayed below the field */
  hint?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in an error state without a message */
  error?: boolean;
  /** Text prefix rendered inside the field (left) */
  prefix?: string;
  /** Text suffix rendered inside the field (right) */
  suffix?: string;
  /** Shows a ✕ button to clear the field */
  clearable?: boolean;
  /** Prevents value editing */
  readonly?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Focuses the input on mount */
  autofocus?: boolean;
  /** Maximum character length — shows a counter when set */
  maxlength?: number;
  /** Rows for textarea type */
  rows?: number;
  /** Control size */
  size?: InputSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
  /** HTML autocomplete */
  autocomplete?: string;
  /**
   * Semantic field width — controls how wide the component renders.
   * Defaults to `"full"` (fills the container).
   * @see FieldWidth
   */
  width?: FieldWidth;
  /**
   * Validation rules run on blur (and on value change after the first blur).
   * Each function receives the current value and must return `true` when valid
   * or an error string when invalid. The first failing rule's message is shown.
   *
   * @example
   * :rules="[(v) => !!v || 'Required', (v) => String(v).length >= 3 || 'Min 3 chars']"
   */
  rules?: Array<(val: string | number | undefined) => true | string>;
}

export interface InputEmits {
  (_e: "update:modelValue", _value: string | number): void;
  (_e: "clear"): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
  (_e: "keydown", _event: KeyboardEvent): void;
  (_e: "keyup", _event: KeyboardEvent): void;
  (_e: "keypress", _event: KeyboardEvent): void;
}

export interface InputSlots {
  /** Content placed before the input (inside the border) */
  prefix?: () => unknown;
  /** Content placed after the input (inside the border) */
  suffix?: () => unknown;
  /** Prepended block placed outside the border on the left */
  prepend?: () => unknown;
  /** Appended block placed outside the border on the right */
  append?: () => unknown;
}

// ── InputDisplay ─────────────────────────────────────────────────────────────
// OInputDisplay renders a read-only display field that looks like OInput
// but accepts arbitrary content in its default slot. Useful as a preview
// placeholder before a real value has been chosen.

export interface InputDisplayProps {
  /** Label above the field */
  label?: string;
  /** Placeholder text when no content is slotted */
  placeholder?: string;
  /** Marks the field as disabled */
  disabled?: boolean;
  /** Control size */
  size?: InputSize;
  /**
   * Semantic field width — controls how wide the component renders.
   * Defaults to `"full"` (fills the container).
   * @see FieldWidth
   */
  width?: FieldWidth;
}

export interface InputDisplaySlots {
  /** The content to display inside the stub */
  default?: () => unknown;
}
