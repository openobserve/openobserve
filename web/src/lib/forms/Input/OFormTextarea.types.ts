// Copyright 2026 OpenObserve Inc.

import type { TextareaProps } from "./OTextarea.types";

/** OFormTextarea props — everything OTextarea accepts except modelValue/error/errorMessage. */
export interface FormTextareaProps extends Omit<
  TextareaProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
