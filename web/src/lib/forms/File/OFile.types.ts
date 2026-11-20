// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** `zone` is a drop target for pages and drawers; `compact` is a button + file name in a form row. */
export type FileVariant = "zone" | "compact";

/** Where the content comes from. Two or more sources show a segmented switch (U2). */
export type FileSource = "file" | "url" | "paste";

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

/** Uploads one file; call `onProgress` with 0–1. Reject with an I18nText to show it on the row. */
export type FileUploader = (file: File, onProgress: (fraction: number) => void) => Promise<unknown>;

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
  /** Drop zone (default) or a compact button + file name for a form row */
  variant?: FileVariant;
  /** Sources offered; two or more show a File / URL / Paste switch over a fixed-height area */
  sources?: FileSource[];
  /** Active source (v-model:source); defaults to the first of `sources` */
  source?: FileSource;
  /** URL typed in the URL source (v-model:url) */
  url?: string;
  /** Text pasted in the Paste source (v-model:text) */
  text?: string;
  /** Placeholder of the URL field */
  urlPlaceholder?: I18nText;
  /** Placeholder of the paste area */
  textPlaceholder?: I18nText;
  /** Checks each chosen file; a message moves it to an error row instead of the value */
  validate?: FileValidator;
  /** Uploads each accepted file, driving the row's progress and error */
  upload?: FileUploader;
  /** Label rendered above the control */
  label?: I18nText;
  /** Empty-state text of the compact variant */
  placeholder?: I18nText;
  /** Helper text below the control */
  helpText?: I18nText;
  /** Error message — when provided the field shows error styling */
  errorMessage?: I18nText;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Says why the control is disabled, in the zone or the button's tooltip */
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
  (_e: "update:source", _value: FileSource): void;
  (_e: "update:url", _value: string): void;
  (_e: "update:text", _value: string): void;
}

export interface FileSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
  /** Tooltip content — renders an info icon in the label row when provided */
  tooltip?: () => unknown;
  /** Replaces the zone's "Drop … here or choose …" prompt */
  hint?: () => unknown;
}
