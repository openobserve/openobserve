// Copyright 2026 OpenObserve Inc.

import type { InputProps } from "./OInput.types";

/** OFormInput props — everything OInput accepts except modelValue/error/errorMessage (auto-bound). */
export interface FormInputProps extends Omit<
  InputProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}

/**
 * OFormInput slots. In addition to the OInput passthrough slots
 * (icon-left/icon-right/prefix/suffix/tooltip/append), OFormInput adds:
 *
 * - `error` — when provided, the consumer OWNS the validation message and
 *   OInput's built-in error (border + inline text) is suppressed. Use it to
 *   render the message where the default can't reach — e.g. a full-width sibling
 *   outside a composite "input + unit" border group. May be left empty purely to
 *   suppress the built-in error.
 */
export interface FormInputSlots {
  error?: () => unknown;
}
