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
