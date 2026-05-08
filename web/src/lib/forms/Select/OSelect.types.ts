// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";
import type { FieldWidth } from "../Input/OInput.types";

export type SelectValue = string | number | boolean;
export type SelectModelValue = SelectValue | SelectValue[] | undefined;

/** Injection key for the value map that preserves original value types across OSelect → OSelectItem */
export const SELECT_VALUE_MAP_KEY: InjectionKey<Map<string, SelectValue>> =
  Symbol("SelectValueMap");

export type SelectSize = "sm" | "md";

// ── Option shape ──────────────────────────────────────────────────────────

export interface SelectOption {
  label: string;
  value: SelectValue;
  disabled?: boolean;
  [key: string]: unknown;
}

// ── Root ──────────────────────────────────────────────────────────────────

export interface SelectProps {
  /** Currently selected value */
  modelValue?: SelectModelValue;
  /**
   * Flat list of options. When provided, OSelectItem nodes are rendered
   * automatically. For grouped or custom-rendered options, use the `default`
   * slot instead.
   */
  options?: SelectOption[];
  /** Allows selecting multiple options */
  multiple?: boolean;
  /** q-select compatibility prop; normalized options are always supported */
  mapOptions?: boolean;
  /** q-select compatibility prop; OSelect always emits value model */
  emitValue?: boolean;
  /** Enables editable input behavior similar to q-select use-input */
  useInput?: boolean;
  /** Fills input area with selected value label when supported */
  fillInput?: boolean;
  /** Enables local text filtering for options mode */
  searchable?: boolean;
  /** Debounce (ms) before emitting filter events */
  inputDebounce?: number;
  /** Hides already selected options in multiple mode */
  hideSelected?: boolean;
  /** Renders multiple selected values as chips in the trigger */
  useChips?: boolean;
  /** Strategy for values created by typing into the input */
  newValueMode?: "add" | "add-unique";
  /** Optional popup content style passthrough */
  popupContentStyle?: string | Record<string, string | number>;
  /** Compatibility prop with q-select; currently no-op */
  popupNoRouteDismiss?: boolean;
  /** Compatibility prop with q-select; currently no-op */
  behavior?: "menu" | "dialog";
  /** Placeholder text shown in the internal search input */
  searchPlaceholder?: string;
  /** Empty-state text when no options match */
  emptyText?: string;
  /** Key to read label from each option object */
  optionLabel?: string;
  /** Key to read value from each option object */
  optionValue?: string;
  /** Key to read disabled state from each option object */
  optionDisabled?: string;
  /** Floating label rendered above the trigger */
  label?: string;
  /** Placeholder text shown when no value is selected */
  placeholder?: string;
  /** Error message — when truthy the field shows error styling */
  errorMessage?: string;
  /** Marks the field in error state without a message */
  error?: boolean;
  /** Shows a ✕ button to clear the selection */
  clearable?: boolean;
  /** q-select compatibility prop; OSelect uses outlined visuals by default */
  outlined?: boolean;
  /** q-select compatibility prop; accepted for migration parity */
  filled?: boolean;
  /** q-select compatibility prop; accepted for migration parity */
  borderless?: boolean;
  /** Prevents value changes */
  disabled?: boolean;
  /** Control size */
  size?: SelectSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
  /**
   * Semantic field width — controls how wide the component renders.
   * Defaults to `"full"` (fills the container).
   * @see FieldWidth
   */
  width?: FieldWidth;
  /**
   * Validation rules run on value change.
   * Each function receives the current value and must return `true` when valid
   * or an error string when invalid. The first failing rule's message is shown.
   *
   * @example
   * :rules="[(v) => v !== undefined || 'Required']"
   */
  rules?: Array<(val: SelectModelValue) => true | string>;
}

export interface SelectEmits {
  (_e: "update:modelValue", _value: SelectModelValue): void;
  (_e: "clear"): void;
  /** q-select-compatible filter callback trigger */
  (
    _e: "filter",
    _value: string,
    _update: (_cb?: () => void) => void,
    _abort: () => void,
  ): void;
  /** q-select-compatible new value callback trigger */
  (
    _e: "new-value",
    _value: string,
    _done: (_value?: SelectValue, _mode?: "add" | "add-unique") => void,
  ): void;
}

export interface SelectSlots {
  /** Custom options — render OSelectItem / OSelectGroup nodes here */
  default?: () => unknown;
  /** Custom trigger content — overrides the default value display */
  trigger?: (_scope: { value: SelectModelValue }) => unknown;
}

// ── Item ─────────────────────────────────────────────────────────────────

export interface SelectItemProps {
  /** The value emitted when this item is selected */
  value: SelectValue;
  /** Display label */
  label?: string;
  /** Prevents selection */
  disabled?: boolean;
}

export interface SelectItemSlots {
  default?: () => unknown;
}

// ── Group ─────────────────────────────────────────────────────────────────

export interface SelectGroupProps {
  /** Visible heading above the group */
  label?: string;
}

export interface SelectGroupSlots {
  default?: () => unknown;
}
