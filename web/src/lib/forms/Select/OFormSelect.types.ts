// Copyright 2026 OpenObserve Inc.

import type { SelectProps } from "./OSelect.types";

/** OFormSelect props — everything OSelect accepts except modelValue/error/errorMessage. */
export interface FormSelectProps extends Omit<
  SelectProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
