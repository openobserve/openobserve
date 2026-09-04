// Copyright 2026 OpenObserve Inc.

import type { CheckboxGroupProps } from "./OCheckbox.types";

/** OFormCheckboxGroup props — everything OCheckboxGroup accepts + form wiring. */
export interface FormCheckboxGroupProps extends CheckboxGroupProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
