// Copyright 2026 OpenObserve Inc.

export interface DateTimeRangeTimezoneProps {
  /** Selected IANA zone; "" means the browser's own time. */
  modelValue: string;
  /** Zones to list, in display order. */
  options: string[];
  disabled?: boolean;
}

export interface DateTimeRangeTimezoneEmits {
  (_e: "update:modelValue", _value: string): void;
}
