// Copyright 2026 OpenObserve Inc.

import type { SwitchProps } from "./OSwitch.types";

/** OFormSwitch props — everything OSwitch accepts except modelValue. */
export interface FormSwitchProps extends Omit<SwitchProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
