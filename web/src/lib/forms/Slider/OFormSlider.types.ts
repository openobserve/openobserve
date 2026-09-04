// Copyright 2026 OpenObserve Inc.

import type { SliderProps } from "./OSlider.types";

/** OFormSlider props — everything OSlider accepts except modelValue. */
export interface FormSliderProps extends Omit<SliderProps, "modelValue"> {
  /** Field name — must match a key in the parent OForm's defaultValues */
  name: string;
}
