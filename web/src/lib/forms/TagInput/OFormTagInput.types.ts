// Copyright 2026 OpenObserve Inc.

/**
 * OFormTagInput props — everything OTagInput accepts except `modelValue`
 * (auto-bound to the OForm field by `name`). OTagInput has no exported types
 * file, so its (small) prop surface is mirrored here.
 */
import type { I18nText } from "@/types/i18n";

export interface FormTagInputProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /** Placeholder shown when there are no tags (forwarded to OTagInput) */
  placeholder?: I18nText;
  /** Label shown above the field, like the other OForm* fields */
  label?: I18nText;
  /** Hint shown under the field while it has no error */
  helpText?: I18nText;
  /** Marks the label with an asterisk; the schema still owns the rule */
  required?: boolean;
}
