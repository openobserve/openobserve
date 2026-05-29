// Copyright 2026 OpenObserve Inc.

import type { CheckboxGroupProps, CheckboxGroupValue } from "./OCheckbox.types";
import type { FieldValidator } from "../Form/OForm.types";

/** OFormCheckboxGroup props — everything OCheckboxGroup accepts + form wiring. */
export interface FormCheckboxGroupProps extends CheckboxGroupProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<CheckboxGroupValue>[];
}
