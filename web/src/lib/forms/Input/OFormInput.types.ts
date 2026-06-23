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
