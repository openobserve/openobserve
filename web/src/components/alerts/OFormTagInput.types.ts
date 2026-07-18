// Copyright 2026 OpenObserve Inc.

/**
 * OFormTagInput props — everything TagInput accepts except `modelValue`
 * (auto-bound to the OForm field by `name`). TagInput has no exported types
 * file, so its (small) prop surface is mirrored here.
 */
export interface FormTagInputProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /** Placeholder shown when there are no tags (forwarded to TagInput) */
  placeholder?: string;
  /** Floating label (forwarded to TagInput) */
  label?: string;
}
