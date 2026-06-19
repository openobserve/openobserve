// Copyright 2026 OpenObserve Inc.

import type { OptionGroupProps } from "./OOptionGroup.types";

export interface FormOptionGroupProps
  extends Omit<OptionGroupProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
