// Copyright 2026 OpenObserve Inc.

import type { RangeProps, RangeValue } from "./ORange.types";
import type { FieldValidator } from "../Form/OForm.types";

export interface FormRangeProps extends Omit<RangeProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<RangeValue>[];
}
