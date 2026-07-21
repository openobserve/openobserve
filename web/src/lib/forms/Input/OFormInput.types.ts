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
 * - `error` — when provided, the consumer OWNS the validation message: OInput's
 *   inline error TEXT is suppressed, but the field still renders its error
 *   border (a field whose message moved elsewhere must still look invalid). Use
 *   it to render the message where the default can't reach — e.g. a full-width
 *   sibling outside a composite "input + unit" border group, or below a narrow
 *   numeric field where the message would otherwise wrap into a ragged column.
 *   May be left empty purely to suppress the text.
 */
export interface FormInputSlots {
  error?: () => unknown;
}
