// Copyright 2026 OpenObserve Inc.

/** Control height: md 32 in toolbars (default), sm 28 in compact rows (guideline S1). */
export type DateTimeRangeSize = "sm" | "md";

export type DateTimeRangeType = "relative" | "absolute";

export type DateTimeRangeMenuAlign = "center" | "start" | "end";

/** Payload of `on:date-change`; times are epoch microseconds. */
export interface DateTimeRangeChange {
  startTime: number;
  endTime: number;
  /** `15m`, `2h` or a calendar token while relative; null for an absolute range. */
  relativeTimePeriod: string | null;
  selectedDate?: { from: string; to: string };
  selectedTime?: { startTime: string; endTime: string };
  /** `relative`, `relative-custom` or `absolute`. */
  valueType?: string;
  /** False when the parent set the range (mount replay, setters), so it must not refetch. */
  userChangedValue?: boolean;
}

export interface DateTimeRangeProps {
  /** Tab the picker opens on; read once at mount. */
  defaultType?: DateTimeRangeType;
  /** `{ startTime, endTime }` in micro- or milliseconds; read once at mount. */
  defaultAbsoluteTime?: { startTime?: number; endTime?: number } | null;
  /** Relative period such as `15m`; read once at mount. */
  defaultRelativeTime?: string;
  /** Emit on every change instead of on Apply. */
  autoApply?: boolean;
  /** Apply a relative preset chip on click even without `autoApply`. */
  applyPresets?: boolean;
  initialTimezone?: string | null;
  disabled?: boolean;
  size?: DateTimeRangeSize;
  queryRangeRestrictionMsg?: string;
  queryRangeRestrictionInHour?: number;
  dataTestName?: string;
  /** Date-only picker: no Relative tab and no rail. */
  disableRelative?: boolean;
  hideRelativeTime?: boolean;
  hideRelativeTimezone?: boolean;
  /** Keeps zone changes local to this picker instead of writing the app's timezone. */
  pickerTimezone?: string;
  hideClipboard?: boolean;
  hideRangeShift?: boolean;
  disablePrevShift?: boolean;
  /** First pickable day (`yyyy/MM/dd`), date-only pickers. */
  minDate?: string;
  /** Last pickable day (`yyyy/MM/dd`); absent means today. */
  maxDate?: string;
  menuAlign?: DateTimeRangeMenuAlign;
  /** Offers Today … Last year in the rail. */
  calendarPresets?: boolean;
  /** Sizes the trigger like a form field (full width, field border). */
  fieldAppearance?: boolean;
  defaultOpen?: boolean;
  hideSeconds?: boolean;
  /** Replaces the trigger's range text; empty keeps the picker's own label. */
  triggerText?: string;
}

export interface DateTimeRangeEmits {
  (e: "on:date-change", value: DateTimeRangeChange): void;
  (e: "on:timezone-change", zone: string): void;
  (e: "hide"): void;
  (e: "show"): void;
}
