// Copyright 2026 OpenObserve Inc.

import type { InlineEditProps } from "./OInlineEdit.types";

/** OFormInlineEdit props — everything OInlineEdit takes except the auto-bound state. */
export interface FormInlineEditProps extends Omit<
  InlineEditProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name — must match a key in the parent OForm's defaultValues. */
  name: string;
}

export interface FormInlineEditEmits {
  /** Re-emitted from OInlineEdit after the field has been written. */
  (_e: "update:modelValue", _value: string): void;
  (_e: "commit", _value: string): void;
  (_e: "cancel", _value: string): void;
  (_e: "edit-start"): void;
}
