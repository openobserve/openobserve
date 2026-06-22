// Copyright 2026 OpenObserve Inc.

import type { RadioGroupProps } from "./ORadio.types";

/** OFormRadioGroup props — everything ORadioGroup accepts + form wiring. */
export interface FormRadioGroupProps extends RadioGroupProps {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
