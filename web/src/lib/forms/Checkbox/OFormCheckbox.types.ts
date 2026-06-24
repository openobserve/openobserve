// Copyright 2026 OpenObserve Inc.

import type { CheckboxProps } from "./OCheckbox.types";

/** OFormCheckbox props — everything OCheckbox accepts except modelValue/indeterminate. */
export interface FormCheckboxProps extends Omit<CheckboxProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
