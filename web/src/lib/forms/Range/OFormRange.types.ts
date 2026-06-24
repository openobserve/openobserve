// Copyright 2026 OpenObserve Inc.

import type { RangeProps } from "./ORange.types";

export interface FormRangeProps extends Omit<RangeProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
