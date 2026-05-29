// Copyright 2026 OpenObserve Inc.

import type { RadioGroupProps } from "./ORadio.types";
import type { FieldValidator } from "../Form/OForm.types";
import type { RadioValue } from "./ORadio.types";

/** OFormRadioGroup props — everything ORadioGroup accepts + form wiring. */
export interface FormRadioGroupProps extends RadioGroupProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<RadioValue | undefined>[];
}
