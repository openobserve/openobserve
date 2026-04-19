// Copyright 2026 OpenObserve Inc.
/**
 * O2 Component Library
 *
 * Headless-first drop-in replacements for all Quasar form elements.
 * Three-layer design token strategy throughout.
 *
 * Usage:  import { O2Input, O2Select, O2Btn, ... } from '@/lib'
 *
 * ─── Token layers ────────────────────────────────────────────────────────────
 * Layer 1 – Primitive  : $o2-*  SCSS vars  (web/src/styles/_variables.scss)
 * Layer 2 – Semantic   : --o2-* CSS props  (same file, :root / .body--dark)
 * Layer 3 – Component  : --o2-<component>-* CSS props  (each component file)
 */

// ─── High-usage form elements ─────────────────────────────────────────────────
export { O2Input } from "./components/forms/o2-input";
export type { O2InputProps } from "./components/forms/o2-input";

export { O2Select } from "./components/forms/o2-select";
export type { O2SelectProps } from "./components/forms/o2-select";

export { default as O2Btn } from "./components/forms/o2-btn/O2Btn.vue";
export type { O2BtnProps } from "./components/forms/o2-btn/O2Btn.vue";

export { default as O2Field } from "./components/forms/o2-field/O2Field.vue";
export type { O2FieldProps } from "./components/forms/o2-field/O2Field.vue";

export { default as O2Checkbox } from "./components/forms/o2-checkbox/O2Checkbox.vue";
export type { O2CheckboxProps } from "./components/forms/o2-checkbox/O2Checkbox.vue";

export { default as O2Toggle } from "./components/forms/o2-toggle/O2Toggle.vue";
export type { O2ToggleProps } from "./components/forms/o2-toggle/O2Toggle.vue";

export { default as O2Form } from "./components/forms/o2-form/O2Form.vue";
export type { O2FormProps } from "./components/forms/o2-form/O2Form.vue";

// ─── Medium-usage form elements ───────────────────────────────────────────────
export { default as O2Radio } from "./components/forms/o2-radio/O2Radio.vue";
export type { O2RadioProps } from "./components/forms/o2-radio/O2Radio.vue";

export { default as O2Slider } from "./components/forms/o2-slider/O2Slider.vue";
export type { O2SliderProps } from "./components/forms/o2-slider/O2Slider.vue";

export { default as O2Range } from "./components/forms/o2-range/O2Range.vue";
export type { O2RangeProps } from "./components/forms/o2-range/O2Range.vue";

export { default as O2BtnToggle } from "./components/forms/o2-btn-toggle/O2BtnToggle.vue";
export type { O2BtnToggleProps } from "./components/forms/o2-btn-toggle/O2BtnToggle.vue";

export { default as O2OptionGroup } from "./components/forms/o2-option-group/O2OptionGroup.vue";
export type { O2OptionGroupProps } from "./components/forms/o2-option-group/O2OptionGroup.vue";

export { default as O2File } from "./components/forms/o2-file/O2File.vue";
export type { O2FileProps } from "./components/forms/o2-file/O2File.vue";

// ─── Complex wrappers (Quasar passthrough + token styling) ────────────────────
export { default as O2Date } from "./components/forms/o2-date/O2Date.vue";
export { default as O2Time } from "./components/forms/o2-time/O2Time.vue";
export { default as O2Color } from "./components/forms/o2-color/O2Color.vue";

// ─── Utilities ────────────────────────────────────────────────────────────────
export { cn } from "./utils/cn";
