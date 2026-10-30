// Copyright 2026 OpenObserve Inc.

import type { ToggleGroupProps } from "./OToggleGroup.types";

/**
 * OFormToggleGroup props — everything OToggleGroup accepts except `modelValue`
 * (auto-bound to the OForm field by `name`).
 */
export interface FormToggleGroupProps extends Omit<ToggleGroupProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}

/**
 * OFormToggleGroup slots.
 *
 * - `error` — when provided, the consumer OWNS the validation message and the
 *   built-in text is suppressed. Unlike OFormInput there is no invalid state to
 *   fall back on: OToggleGroup has no error styling, so a suppressed message
 *   leaves the group looking normal. Use it when another control bound to the
 *   same field renders the message instead. May be left empty.
 */
export interface FormToggleGroupSlots {
  /** The OToggleGroupItem children. */
  default?: () => unknown;
  /** Passed through to OToggleGroup's own label slot. */
  label?: () => unknown;
  error?: () => unknown;
}
