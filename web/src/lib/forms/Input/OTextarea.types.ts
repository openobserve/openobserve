// Copyright 2026 OpenObserve Inc.

import type { FieldWidth } from "../Input/OInput.types";

export type TextareaSize = "sm" | "md";

export interface TextareaProps {
  /** Bound value */
  modelValue?: string;
  /** Floating / static label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text displayed below the field */
  helpText?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in an error state without a message */
  error?: boolean;
  /** Number of visible rows */
  rows?: number;
  /** Auto-resize to fit content */
  autogrow?: boolean;
  /** Prevents value editing */
  readonly?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** Focuses the textarea on mount */
  autofocus?: boolean;
  /** Maximum character length — shows a counter when set */
  maxlength?: number;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
  /** HTML autocomplete */
  autocomplete?: string;
  /** Control size */
  size?: TextareaSize;
  /**
   * Semantic field width — controls how wide the component renders.
   * Defaults to `"full"` (fills the container).
   * @see FieldWidth
   */
  width?: FieldWidth;
  /**
   * When true, the textarea stretches to fill its parent's height
   * (instead of being sized by `rows`). Useful when the textarea lives
   * inside a flex container that has a bounded height.
   */
  fill?: boolean;
}

export interface TextareaEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "focus", _event: FocusEvent): void;
  (_e: "keydown", _event: KeyboardEvent): void;
}

export interface TextareaSlots {
  /** Appended block outside the border */
  append?: () => unknown;
  /**
   * Tooltip content rendered inside an info icon in the label area.
   * Provide a tooltip element as the slot content.
   */
  tooltip?: () => unknown;
}
