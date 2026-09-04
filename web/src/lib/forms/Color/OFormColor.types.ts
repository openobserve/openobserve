// Copyright 2026 OpenObserve Inc.

import type { ColorProps } from "./OColor.types";

export interface FormColorProps extends Omit<ColorProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
