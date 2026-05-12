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
  value?: SelectValue;
  disabled?: boolean;
  /** When true, renders the item as a non-selectable group header */
  header?: boolean;
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
  /**
   * Maximum number of selection chips rendered in the trigger before the
   * rest collapse into a "+N more" indicator. Defaults to 3.
   * Only meaningful when `multiple` is true.
   */
  maxVisibleChips?: number;
  /** Enables local text filtering / combobox mode */
  searchable?: boolean;
  /** Debounce (ms) before emitting search events */
  searchDebounce?: number;
  /** Hides already selected options in multiple mode */
  hideSelected?: boolean;
  /**
   * Renders a "Select All" master row at the top of the dropdown (multi-select
   * listbox mode only). Shows an indeterminate dash when only some options are
   * selected, a check when all are, and toggles the entire selection on click.
   */
  selectAll?: boolean;
  /** Allows creating new values by typing — emits @create event */
  creatable?: boolean;
  /** Optional dropdown content style passthrough */
  dropdownStyle?: string | Record<string, string | number>;
  /** Placeholder text shown in the internal search input */
  searchPlaceholder?: string;
  /** Key to read label from each option object */
  labelKey?: string;
  /** Key to read value from each option object */
  valueKey?: string;
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
  /** Prevents value changes */
  disabled?: boolean;
  /** Control size */
  size?: SelectSize;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
  /** Helper text displayed below the field */
  helpText?: string;
  /**
   * Semantic field width — controls how wide the component renders.
   * Defaults to "full" (fills the container).
   * @see FieldWidth
   */
  width?: FieldWidth;
}

export interface SelectEmits {
  (_e: "update:modelValue", _value: SelectModelValue): void;
  (_e: "clear"): void;
  /** Fired when the user types into the search input */
  (_e: "search", _value: string): void;
  /** Fired when a new value is created (requires creatable) */
  (_e: "create", _value: string): void;
  /** Fired when the dropdown opens */
  (_e: "open"): void;
  /** Fired when the dropdown closes */
  (_e: "close"): void;
  (_e: "blur", _event: FocusEvent): void;
  (_e: "change", _value: SelectModelValue): void;
  (_e: "keydown", _event: KeyboardEvent): void;
}

export interface SelectSlots {
  /** Custom options — render OSelectItem / OSelectGroup nodes here */
  default?: () => unknown;
  /** Custom trigger content — overrides the default value display */
  trigger?: (_scope: { value: SelectModelValue }) => unknown;
  /** Custom chip content for each selected item (multiple mode) */
  chip?: (_scope: { label: string; value: SelectValue }) => unknown;
  /** Empty state — shown when no options match the search */
  empty?: () => unknown;
  /** Content before the options list */
  "before-options"?: () => unknown;
  /** Prepend content inside the trigger (left) */
  prepend?: () => unknown;
  /** Append content inside the trigger (right) */
  append?: () => unknown;
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
