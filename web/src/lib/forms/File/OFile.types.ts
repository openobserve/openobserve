// Copyright 2026 OpenObserve Inc.

export type FileSize = "sm" | "md";

/**
 * Bound value type: single File when `multiple=false`, array of Files when
 * `multiple=true`. `null` represents "no file selected".
 */
export type FileValue = File | File[] | null;

export interface FileProps {
  /** Bound File or array of Files */
  modelValue?: FileValue;
  /** Allow multiple file selection */
  multiple?: boolean;
  /** Comma-separated list of MIME types / extensions (e.g. "image/*,.pdf") */
  accept?: string;
  /** Maximum allowed file size in bytes — emits "size-error" when exceeded */
  maxFileSize?: number;
  /** Show drag-and-drop drop zone */
  dropZone?: boolean;
  /** Label rendered above the control */
  label?: string;
  /** Placeholder displayed when no file is selected */
  placeholder?: string;
  /** Helper text below the control */
  helpText?: string;
  /** Error message — when provided the field shows error styling */
  errorMessage?: string;
  /** Marks the field as being in error state without a message */
  error?: boolean;
  /** Prevents interaction */
  disabled?: boolean;
  /** Control size */
  size?: FileSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface FileEmits {
  (_e: "update:modelValue", _value: FileValue): void;
  (_e: "change", _value: FileValue): void;
  (_e: "clear"): void;
  (_e: "size-error", _files: File[]): void;
}

export interface FileSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
  /** Custom drop-zone hint when dropZone is enabled */
  hint?: () => unknown;
}
