// Copyright 2026 OpenObserve Inc.

import type { TimeProps } from "./OTime.types";
import type { FieldValidator } from "../Form/OForm.types";

export interface FormTimeProps extends Omit<TimeProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /** Validators — run on every change after first blur */
  validators?: FieldValidator<string>[];
}
