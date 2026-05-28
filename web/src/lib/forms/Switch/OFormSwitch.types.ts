// Copyright 2026 OpenObserve Inc.

import type { SwitchProps, SwitchValue } from "./OSwitch.types";
import type { FieldValidator } from "../Form/OForm.types";

/** OFormSwitch props — everything OSwitch accepts except modelValue. */
export interface FormSwitchProps extends Omit<SwitchProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<SwitchValue>[];
}
