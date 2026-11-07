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
  /** Any day of the month to show — YYYY/MM/DD; follows the range when absent. */
  month?: string;
  /** Days ringed as part of an invalid range — YYYY/MM/DD. */
  invalidDates?: string[];
  /** A range drawn with the dashed preview outline, without selecting it — YYYY/MM/DD ends. */
  previewRange?: { start: string; end: string } | null;
}

export interface DateRangeCalendarEmits {
  /** Fired when the user selects (or changes) the start date. Value is YYYY/MM/DD. */
  (_e: "update:startDate", _value: string): void;
  /** Fired when the user completes the range by selecting an end date. Value is YYYY/MM/DD. */
  (_e: "update:endDate", _value: string): void;
  /** A first click waiting for its end date (YYYY/MM/DD), or null once the range is complete. */
  (_e: "update:pendingDate", _value: string | null): void;
  /** The shown month changed by its own navigation; value is its first day, YYYY/MM/DD. */
  (_e: "update:month", _value: string): void;
}
