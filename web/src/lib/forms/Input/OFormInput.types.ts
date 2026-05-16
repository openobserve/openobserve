// Copyright 2026 OpenObserve Inc.

import type { InputProps } from "./OInput.types";
import type { FieldValidator } from "../Form/OForm.types";

/** OFormInput props — everything OInput accepts except modelValue/error/errorMessage (auto-bound). */
export interface FormInputProps extends Omit<
  InputProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   * The first non-undefined result is shown as the error message.
   */
  validators?: FieldValidator<string | number | undefined>[];
}
