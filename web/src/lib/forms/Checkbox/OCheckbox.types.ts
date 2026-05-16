// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

export type CheckboxSize = "xs" | "sm" | "md";
/**
 * Identifier values used in group/custom-value mode. Excludes `boolean` on
 * purpose: Vue auto-coerces optional Boolean-typed props to `false` when not
 * passed, which would make these props indistinguishable from "unset".
 * Boolean checkbox state is carried by `modelValue` instead.
 */
export type CheckboxPrimitive = string | number;
export type CheckboxModelValue =
  | boolean
  | "indeterminate"
  | CheckboxPrimitive
  | CheckboxPrimitive[];

export interface CheckboxProps {
  /** Current checked state. Use `true`, `false`, or `'indeterminate'` */
  modelValue?: CheckboxModelValue;
  /**
   * Value used when this checkbox is a member of an OCheckboxGroup.
   * When set and a group context is present, modelValue is ignored in favour
   * of the group's checked-values array.
   */
  value?: CheckboxPrimitive;
  /** q-checkbox compatibility alias for `value` */
  val?: CheckboxPrimitive;
  /** Accessible label rendered next to the checkbox */
  label?: string;
  /** Control size */
  size?: CheckboxSize;
  /** Value to emit when checked in custom-value mode */
  trueValue?: CheckboxPrimitive;
  /** Value to emit when unchecked in custom-value mode */
  falseValue?: CheckboxPrimitive;
  /** Value to emit in indeterminate state in custom-value mode */
  indeterminateValue?: CheckboxPrimitive;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id — forwarded to the native input for external label association */
  id?: string;
  /** HTML name attribute */
  name?: string;
}

export interface CheckboxEmits {
  (_e: "update:modelValue", _value: CheckboxModelValue): void;
  /** Fired when the checkbox is inside a group — emits the item value */
  (_e: "change", _value: CheckboxModelValue): void;
}

export interface CheckboxSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
}

// ── Group ──────────────────────────────────────────────────────────────────

/** Values checked in the group */
export type CheckboxGroupValue = Array<CheckboxPrimitive>;

export interface CheckboxGroupContext {
  modelValue: CheckboxGroupValue;
  disabled: boolean;
  toggle(_value: CheckboxPrimitive): void;
  isChecked(_value: CheckboxPrimitive): boolean;
}

export const CHECKBOX_GROUP_KEY: InjectionKey<CheckboxGroupContext> =
  Symbol("CheckboxGroup");

export interface CheckboxGroupProps {
  /** Array of currently checked values */
  modelValue?: CheckboxGroupValue;
  /** Disables all checkboxes in the group */
  disabled?: boolean;
}

export interface CheckboxGroupEmits {
  (_e: "update:modelValue", _value: CheckboxGroupValue): void;
}

export interface CheckboxGroupSlots {
  default?: () => unknown;
}
