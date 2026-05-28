// Copyright 2026 OpenObserve Inc.

import type { SelectProps, SelectModelValue } from "./OSelect.types";
import type { FieldValidator } from "../Form/OForm.types";

/** OFormSelect props — everything OSelect accepts except modelValue/error/errorMessage. */
export interface FormSelectProps extends Omit<
  SelectProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<SelectModelValue>[];
}
