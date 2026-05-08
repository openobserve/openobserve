// Copyright 2026 OpenObserve Inc.

import type { CheckboxProps, CheckboxModelValue } from "./OCheckbox.types";
import type { FieldValidator } from "../Form/OForm.types";

/** OFormCheckbox props — everything OCheckbox accepts except modelValue/indeterminate. */
export interface FormCheckboxProps extends Omit<CheckboxProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<CheckboxModelValue>[];
}
