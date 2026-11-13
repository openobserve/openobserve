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
  /** Paints only the start and end days solid and the days between them with a light tint. */
  bandRange?: boolean;
  /** A click on the selected single day starts a new range there instead of clearing the selection. */
  preventDeselect?: boolean;
  /** Stretches the month grid to the full width of its container instead of fixed-width day cells. */
  fill?: boolean;
  /** Leaves the range unpainted and tints today instead, for a range another control produced. */
  hideSelection?: boolean;
  /** Shorter header, weekday and day rows, so six weeks fit a fixed-height panel. */
  compact?: boolean;
  /** BCP 47 locale for the month heading, weekday letters and day labels. */
  locale?: string;
  /** First column of the week grid, 0 = Sunday (the default). */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Accessible name of the grid. */
  calendarLabel?: string;
  /** Accessible names of the month navigation buttons. */
  prevLabel?: string;
  nextLabel?: string;
  /** Moves focus into the grid on mount: the selected start, else today. */
  autoFocus?: boolean;
  /** Days before this one (YYYY/MM/DD) are struck and cannot be picked, with `unavailableReason` as their title. */
  unavailableBefore?: string;
  unavailableReason?: string;
}

/** Methods a parent may call through a template ref. */
export interface DateRangeCalendarExposed {
  /** Drops a half-picked start and returns whether there was one. */
  clearPending: () => boolean;
}

export interface DateRangeCalendarEmits {
  /** Fired when the user selects (or changes) the start date. Value is YYYY/MM/DD. */
  (_e: "update:startDate", _value: string): void;
  /** Fired when the user completes the range by selecting an end date. Value is YYYY/MM/DD. */
  (_e: "update:endDate", _value: string): void;
  /** A first click waiting for its end date (YYYY/MM/DD), or null once the range is complete. */
  (_e: "update:pendingDate", _value: string | null): void;
  /** The day a second pick would end on (hovered or focused) while a start waits, else null. */
  (_e: "update:previewDate", _value: string | null): void;
}
