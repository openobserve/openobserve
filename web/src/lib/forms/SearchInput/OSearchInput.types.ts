// Copyright 2026 OpenObserve Inc.

export type SearchInputSize = "xs" | "sm" | "md";

export interface SearchInputProps {
  modelValue?: string;
  placeholder?: string;
  size?: SearchInputSize;
  clearable?: boolean;
  debounce?: number;
  disabled?: boolean;
}

export interface SearchInputEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "clear"): void;
}
