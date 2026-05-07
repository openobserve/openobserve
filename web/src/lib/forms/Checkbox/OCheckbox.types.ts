// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

export type CheckboxSize = "sm" | "md";

export interface CheckboxProps {
  /** Current checked state. Use `true`, `false`, or `'indeterminate'` */
  modelValue?: boolean | "indeterminate";
  /**
   * Value used when this checkbox is a member of an OCheckboxGroup.
   * When set and a group context is present, modelValue is ignored in favour
   * of the group's checked-values array.
   */
  value?: string | number | boolean;
  /** Accessible label rendered next to the checkbox */
  label?: string;
  /** Control size */
  size?: CheckboxSize;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id — forwarded to the native input for external label association */
  id?: string;
  /** HTML name attribute */
  name?: string;
}

export interface CheckboxEmits {
  (_e: "update:modelValue", _value: boolean | "indeterminate"): void;
  /** Fired when the checkbox is inside a group — emits the item value */
  (_e: "change", _value: boolean | "indeterminate"): void;
}

export interface CheckboxSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
}

// ── Group ──────────────────────────────────────────────────────────────────

/** Values checked in the group */
export type CheckboxGroupValue = Array<string | number | boolean>;

export interface CheckboxGroupContext {
  modelValue: CheckboxGroupValue;
  disabled: boolean;
  toggle(_value: string | number | boolean): void;
  isChecked(_value: string | number | boolean): boolean;
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
