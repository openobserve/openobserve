// Copyright 2026 OpenObserve Inc.

import type { OptionGroupProps, OptionGroupValue } from "./OOptionGroup.types";
import type { FieldValidator } from "../Form/OForm.types";

export interface FormOptionGroupProps
  extends Omit<OptionGroupProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /** Validators — run on every change after first blur */
  validators?: FieldValidator<OptionGroupValue>[];
}
