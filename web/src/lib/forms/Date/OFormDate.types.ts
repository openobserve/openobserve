// Copyright 2026 OpenObserve Inc.

import type { DateProps } from "./ODate.types";

export interface FormDateProps extends Omit<DateProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
