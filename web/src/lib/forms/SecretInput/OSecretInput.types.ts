// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** `unchanged` keeps the stored value, `replacing` overwrites it on save, `new` has none stored yet. */
export type SecretInputState = "unchanged" | "replacing" | "new";

export interface SecretInputProps {
  /** `null` means unchanged, including an empty field while replacing, so a stored secret is never cleared. */
  modelValue: string | null;
  state: SecretInputState;
  label: I18nText;
  unchangedLabel: I18nText;
  replaceLabel: I18nText;
  keepLabel: I18nText;
  willReplaceLabel: I18nText;
  showLabel: I18nText;
  hideLabel: I18nText;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  errorMessage?: I18nText;
  dataTest: string;
}

export interface SecretInputEmits {
  (e: "update:modelValue", value: string | null): void;
  (e: "update:state", value: SecretInputState): void;
  (e: "blur"): void;
}
