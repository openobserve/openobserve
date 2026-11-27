// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/**
 * Bound value type: single File when `multiple=false`, array of Files when
 * `multiple=true`. `null` represents "no file selected".
 */
export type FileValue = File | File[] | null;

/** A file the control refused, with the reason shown on its row. */
export interface FileRejection {
  file: File;
  reason: I18nText;
}

/** Returns the row's error for an invalid file, or null when the file is fine. */
export type FileValidator = (
  file: File,
) => I18nText | null | undefined | Promise<I18nText | null | undefined>;

export interface FileProps {
  /** Bound File or array of Files */
  modelValue?: FileValue;
  /** Allow multiple file selection */
  multiple?: boolean;
  /** Comma-separated list of MIME types / extensions (e.g. "image/*,.pdf"); shown under the zone */
  accept?: string;
  /** Largest accepted file in bytes; a bigger file gets an error row */
  maxSize?: number;
  /** Most files accepted at once; defaults to 1 unless `multiple` */
  maxFiles?: number;
  /** Checks each chosen file; a message moves it to an error row instead of the value */
  validate?: FileValidator;
  /** Label rendered above the control */
  label?: I18nText;
  /** Helper text below the control */
  helpText?: I18nText;
  /** Error message — when provided the field shows error styling */
  errorMessage?: I18nText;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Prevents interaction, drops included */
  disabled?: boolean;
  /** Says why the control is disabled, shown in the zone */
  disabledReason?: I18nText;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface FileEmits {
  (_e: "update:modelValue", _value: FileValue): void;
  (_e: "change", _value: FileValue): void;
  (_e: "clear"): void;
  /** Files refused by type, size, count or `validate`; each also shows as an error row */
  (_e: "rejected", _rejections: FileRejection[]): void;
}

export interface FileSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
}
