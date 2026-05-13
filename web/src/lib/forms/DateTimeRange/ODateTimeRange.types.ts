// Copyright 2026 OpenObserve Inc.

export type DateTimeMode = "relative" | "absolute";
export type RelativeUnit =
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months";

export interface DateTimeRangeProps {
  // ── Absolute mode values ──────────────────────────────────────
  /** ISO date string `YYYY-MM-DD` for start */
  startDate?: string;
  /** Time string `HH:MM` or `HH:MM:SS` for start */
  startTime?: string;
  /** ISO date string `YYYY-MM-DD` for end */
  endDate?: string;
  /** Time string `HH:MM` or `HH:MM:SS` for end */
  endTime?: string;

  // ── Mode ──────────────────────────────────────────────────────
  /** Active mode; drives the trigger label */
  mode?: DateTimeMode;

  // ── Relative mode values ──────────────────────────────────────
  /** Relative period unit */
  relativeUnit?: RelativeUnit;
  /** Relative period amount (0 = no selection) */
  relativeAmount?: number;

  // ── Behaviour ─────────────────────────────────────────────────
  /** Show seconds segments in time fields */
  withSeconds?: boolean;
  /** Emit immediately on every change (no Apply button needed) */
  autoApply?: boolean;
  /** Hide the Relative tab; force absolute-only mode */
  disableRelative?: boolean;
  /** Hide Start/End time inputs in the Absolute tab */
  hideTime?: boolean;
  /** Show the timezone selector (hidden by default) */
  showTimezone?: boolean;

  // ── Restrictions ──────────────────────────────────────────────
  /** Minimum selectable date `YYYY-MM-DD` */
  minDate?: string;
  /** Maximum selectable date `YYYY-MM-DD` */
  maxDate?: string;
  /** Disable relative options that exceed this many hours */
  maxHours?: number;

  // ── Timezone ──────────────────────────────────────────────────
  /** IANA timezone string; empty string = browser local time */
  timezone?: string;

  // ── Field metadata ────────────────────────────────────────────
  label?: string;
  helpText?: string;
  errorMessage?: string;
  disabled?: boolean;
  placeholder?: string;
}

export interface DateTimeRangeAbsoluteValue {
  type: "absolute";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
}

export interface DateTimeRangeRelativeValue {
  type: "relative";
  unit: RelativeUnit;
  amount: number;
  timezone: string;
}

export type DateTimeRangeValue =
  | DateTimeRangeAbsoluteValue
  | DateTimeRangeRelativeValue;

export interface DateTimeRangeEmits {
  (_e: "update:startDate", _value: string): void;
  (_e: "update:startTime", _value: string): void;
  (_e: "update:endDate", _value: string): void;
  (_e: "update:endTime", _value: string): void;
  (_e: "update:mode", _value: DateTimeMode): void;
  (_e: "update:timezone", _value: string): void;
  (_e: "update:relativeUnit", _value: RelativeUnit): void;
  (_e: "update:relativeAmount", _value: number): void;
  (_e: "change", _value: DateTimeRangeValue): void;
}

export interface DateTimeRangeSlots {
  label?: () => unknown;
}
