// Copyright 2026 OpenObserve Inc.

import type { SecretInputProps, SecretInputState } from "./OSecretInput.types";

/** OFormSecretInput props: the value and its validity come from the OForm field named `name`. */
export interface FormSecretInputProps extends Omit<
  SecretInputProps,
  "modelValue" | "error" | "errorMessage"
> {
  /** Field name; must match a key in the parent OForm's defaultValues. */
  name: string;
}

export interface FormSecretInputEmits {
  (e: "update:state", value: SecretInputState): void;
}
