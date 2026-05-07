// Copyright 2026 OpenObserve Inc.

export type SelectSize = "sm" | "md";

// ── Option shape ──────────────────────────────────────────────────────────

export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
}

// ── Root ──────────────────────────────────────────────────────────────────

export interface SelectProps {
  /** Currently selected value */
  modelValue?: string | number;
  /**
   * Flat list of options. When provided, OSelectItem nodes are rendered
   * automatically. For grouped or custom-rendered options, use the `default`
   * slot instead.
   */
  options?: SelectOption[];
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
}

export interface SelectEmits {
  (e: "update:modelValue", value: string | number | undefined): void;
  (e: "clear"): void;
}

export interface SelectSlots {
  /** Custom options — render OSelectItem / OSelectGroup nodes here */
  default?: () => unknown;
  /** Custom trigger content — overrides the default value display */
  trigger?: (scope: { value: string | number | undefined }) => unknown;
}

// ── Item ─────────────────────────────────────────────────────────────────

export interface SelectItemProps {
  /** The value emitted when this item is selected */
  value: string | number;
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
