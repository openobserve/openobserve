// Copyright 2026 OpenObserve Inc.

import type { ComboboxProps } from "./OCombobox.types";

/**
 * OFormCombobox props — everything OCombobox accepts except
 * modelValue/error/errorMessage (those are auto-bound from the form field).
 */
export interface FormComboboxProps extends Omit<
  ComboboxProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
