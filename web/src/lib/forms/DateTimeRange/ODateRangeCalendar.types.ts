// Copyright 2026 OpenObserve Inc.

/**
 * Props accepted by ODateRangeCalendar.
 * All date strings are in YYYY/MM/DD format — matching the app's internal date convention.
 * The component handles conversion to/from reka-ui's YYYY-MM-DD format internally.
 */
export interface DateRangeCalendarProps {
  /** Start of the selected range — YYYY/MM/DD */
  startDate?: string;
  /** End of the selected range — YYYY/MM/DD */
  endDate?: string;
  /** Earliest selectable date — YYYY/MM/DD */
  minDate?: string;
  /** Latest selectable date — YYYY/MM/DD */
  maxDate?: string;
  /** When true, all cell interactions are disabled */
  disabled?: boolean;
}

export interface DateRangeCalendarEmits {
  /** Fired when the user selects (or changes) the start date. Value is YYYY/MM/DD. */
  (_e: "update:startDate", _value: string): void;
  /** Fired when the user completes the range by selecting an end date. Value is YYYY/MM/DD. */
  (_e: "update:endDate", _value: string): void;
}
