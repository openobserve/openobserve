// Copyright 2026 OpenObserve Inc.

/** The timerange value an OFormDateTimeRange field holds. */
import type { I18nText } from "@/types/i18n";

export interface DateTimeRangeValue {
  type?: string;
  period?: string;
  from?: number;
  to?: number;
}

/** OFormDateTimeRange props — all other DateTime attrs pass through via $attrs. */
export interface FormDateTimeRangeProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /** Optional header label rendered above the picker (DateTime has none of its own). */
  label?: I18nText;
  /** Render the required `*` after the label (never hardcode the asterisk). */
  required?: boolean;
  /** Optional helper line rendered under the label. */
  description?: I18nText;
}
