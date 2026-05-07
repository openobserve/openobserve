// Copyright 2026 OpenObserve Inc.

export type InputSize = "sm" | "md";

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
}

export interface InputEmits {
  (e: "update:modelValue", value: string | number): void;
  (e: "clear"): void;
  (e: "blur", event: FocusEvent): void;
  (e: "focus", event: FocusEvent): void;
  (e: "keydown", event: KeyboardEvent): void;
  (e: "keyup", event: KeyboardEvent): void;
  (e: "keypress", event: KeyboardEvent): void;
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

// ── InputStub ──────────────────────────────────────────────────────────────
// OInputStub renders a read-only display field that looks like OInput
// but accepts arbitrary content in its default slot. Useful as a preview
// placeholder before a real value has been chosen.

export interface InputStubProps {
  /** Label above the stub */
  label?: string;
  /** Placeholder text when no content is slotted */
  placeholder?: string;
  /** Marks the stub as disabled */
  disabled?: boolean;
  /** Control size */
  size?: InputSize;
}

export interface InputStubSlots {
  /** The content to display inside the stub */
  default?: () => unknown;
}
