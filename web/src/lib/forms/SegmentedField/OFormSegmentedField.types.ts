// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";
import type { SegmentedFieldProps } from "./OSegmentedField.types";

export interface FormSegmentedFieldProps extends Omit<SegmentedFieldProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /** Shown while the date is outside `min`/`max`; the form value still holds it, so a schema should check the bounds too. */
  outOfRangeMessage?: I18nText;
}
