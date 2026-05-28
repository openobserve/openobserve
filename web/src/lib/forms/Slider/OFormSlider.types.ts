// Copyright 2026 OpenObserve Inc.

import type { SliderProps } from "./OSlider.types";
import type { FieldValidator } from "../Form/OForm.types";

/** OFormSlider props — everything OSlider accepts except modelValue. */
export interface FormSliderProps extends Omit<SliderProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
  /**
   * Validator functions — run on every change after first blur.
   * Return an error string on failure, `undefined` on pass.
   */
  validators?: FieldValidator<number>[];
}
