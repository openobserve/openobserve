// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { formatInTimeZone, toZonedTime } from "date-fns-tz";

import { raw, type I18nKey, type I18nText } from "@/types/i18n";
import { resolveCalendarCivilSpan, safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { displayEndUs, formatUtcOffsetAt, wallInstants } from "@/utils/rangeText";

export { formatRecentDuration } from "@/utils/rangeText";

const MICROS_PER_SECOND = 1_000_000;

/** Seconds in one relative unit; a month counts as 31 days so a limit check never lets a long month through. */
export const RELATIVE_UNIT_SECONDS: Readonly<Record<RelativeUnit, number>> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
  w: 604_800,
  M: 2_678_400,
};

// Largest first, months excluded: a doubled or clamped window is named in the largest unit that divides it exactly.
const EXACT_UNITS: readonly RelativeUnit[] = ["w", "d", "h", "m", "s"];

// Current period first, then the one before it, so the single-column rail reads top to bottom by recency.
export const CALENDAR_RAIL_ITEMS: readonly CalendarRailPreset[] = [
  { id: "today", token: "calendar:day:0", labelKey: "common.today", soFar: true },
  { id: "yesterday", token: "calendar:day:-1", labelKey: "common.yesterday", soFar: false },
  { id: "this-week", token: "calendar:week:0", labelKey: "common.thisWeek", soFar: true },
  { id: "last-week", token: "calendar:week:-1", labelKey: "common.lastWeek", soFar: false },
  { id: "this-month", token: "calendar:month:0", labelKey: "common.thisMonth", soFar: true },
  { id: "last-month", token: "calendar:month:-1", labelKey: "common.lastMonth", soFar: false },
  { id: "this-quarter", token: "calendar:quarter:0", labelKey: "common.thisQuarter", soFar: true },
  {
    id: "last-quarter",
    token: "calendar:quarter:-1",
    labelKey: "common.lastQuarter",
    soFar: false,
  },
  // No year chip — nobody keeps a year of retention; the resolver still accepts calendar:year:* tokens.
];

/** A relative period's unit, as `<n><unit>` tokens spell it: `m` minutes, `M` months. */
export type RelativeUnit = "s" | "m" | "h" | "d" | "w" | "M";

/** A rolling window ending now. */
export interface RelativeWindow {
  value: number;
  unit: RelativeUnit;
}

/** What Zoom out starts from and returns: a rolling window, or fixed instants in microseconds. */
export type ZoomRange =
  ({ kind: "relative" } & RelativeWindow) | { kind: "absolute"; startUs: number; endUs: number };

/** Bounds Zoom out keeps to; a limit of 0 means none. */
export interface ZoomBounds {
  nowUs: number;
  minUs?: number;
  limitHours?: number;
}

export interface CalendarRailPreset {
  id: string;
  token: string;
  labelKey: I18nKey;
  soFar: boolean;
}

/** One row of the time picker's rail, already formatted for display. */
export interface TimeRangeRailItem {
  id: string;
  label: I18nText;
  tooltip: I18nText | undefined;
  selected: boolean;
  disabled: boolean;
  /** Recent rows only: the compact label and the duration chip shown instead of the full range. */
  compact?: { label: string; duration: string };
  /** Calendar rows only: the muted date hint shown beside the label. */
  hint?: string;
  /** Recent rows only: the zone the range was applied in, when it is not the picker's. */
  zoneTag?: string;
}

/** How many clock digits a range label carries: seconds only when needed, always, or never. */
export type RangeLabelPrecision = "auto" | "seconds" | "minutes";

export interface RangeLabelOptions {
  /** BCP 47 locale for month names and date order. */
  locale?: string;
  hourCycle?: "h23" | "h12";
  /** The suffix appears only when the picker zone differs from this one. */
  browserZone?: string;
  nowMs?: number;
  precision?: RangeLabelPrecision;
}

/** A range label and its muted zone suffix, empty when the zone needs no mention. */
export interface RangeLabel {
  range: string;
  zone: string;
}

/** The trigger's absolute-range date/time split: "yyyy/MM/dd" + "HH:mm:ss", in the given zone. */
export const formatAbsoluteInstant = (
  unixTimeMicros: number,
  timezone: string,
): { date: string; time: string } => {
  const date = toZonedTime(unixTimeMicros / 1000, timezone);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return { date: date.toLocaleDateString("en-ZA"), time: `${hours}:${minutes}:${seconds}` };
};

// An end exactly at midnight is exclusive, so the row shows the previous day's last second, as the trigger does.
const splitRecentRange = (
  startUs: number,
  endUs: number,
  zone: string,
): { start: { date: string; time: string }; end: { date: string; time: string } } => ({
  start: formatAbsoluteInstant(startUs, zone),
  end: formatAbsoluteInstant(displayEndUs(startUs, endUs, zone), zone),
});

/** The Recent row's accessible range, the same text as the panel summary (always seconds). */
export const formatRecentRange = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
): I18nText => raw(joinRangeLabel(formatRangeFull(startUs, endUs, timezone)));

// Intl keeps each locale's word order, as the sibling older-period labels do; thin spaces become plain ones.
const formatCivilDays = (locale: string, first: Date, last: Date, withYear: boolean): string => {
  const format = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
    calendar: "gregory",
    numberingSystem: "latn",
  });
  const text =
    first.getTime() === last.getTime() ? format.format(first) : format.formatRange(first, last);
  return plainSpaces(text);
};

const plainSpaces = (text: string): string => text.replace(/[\u2009\u202f]/g, " ");

const isRepeatedWallTime = (date: string, time: string, zone: string): boolean =>
  wallInstants(date.replace(/\//g, "-"), time, zone).length > 1;

const civilParts = (date: string): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split("/").map(Number);
  return { year, month: month - 1, day };
};

const currentYearIn = (nowMs: number, zone: string): number =>
  toZonedTime(nowMs, zone).getFullYear();

// A within-day range names its hours so two windows on one day do not read alike; a whole day stays bare.
const sameDayTimes = (startTime: string, endTime: string): string =>
  startTime === "00:00:00" && endTime === "23:59:59"
    ? ""
    : ` · ${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`;

/** "Oct 2 · 08:00–09:00", "Oct 2 – 3" or "Oct 30 – Nov 2" for a recent range, with the year only outside the current one. */
export const formatRecentRangeLabel = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
  locale: string = "en-US",
): string => {
  const zone = safeTimezone(timezone);
  const { start, end } = splitRecentRange(startUs, endUs, zone);
  const from = civilParts(start.date);
  const to = civilParts(end.date);
  const year = currentYearIn(nowMs, zone);
  const days = formatCivilDays(
    locale,
    new Date(Date.UTC(from.year, from.month, from.day)),
    new Date(Date.UTC(to.year, to.month, to.day)),
    from.year !== year || to.year !== year,
  );
  const sameDay = from.year === to.year && from.month === to.month && from.day === to.day;
  return sameDay ? `${days}${sameDayTimes(start.time, end.time)}` : days;
};

/** The trigger's compact absolute label (`Nov 4, 13:47 – 15:52`, `Nov 4 – 6`), Intl-formatted in the picker zone. */
export const formatRangeLabel = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
  options: RangeLabelOptions = {},
): RangeLabel => {
  const zone = safeTimezone(timezone);
  const precision = options.precision ?? "auto";
  const locale = options.locale ?? "en-US";
  const shownEndUs = displayEndUs(startUs, endUs, zone);
  const start = formatAbsoluteInstant(startUs, zone);
  const end = formatAbsoluteInstant(shownEndUs, zone);
  const startMs = Math.floor(startUs / 1000);
  const endMs = Math.floor(shownEndUs / 1000);
  const from = civilParts(start.date);
  const to = civilParts(end.date);
  const year = currentYearIn(options.nowMs ?? Date.now(), zone);
  const withYear = from.year !== year || to.year !== year;
  const browserZone = options.browserZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const suffix = zone === browserZone ? "" : formatUtcOffsetAt(startMs, zone);
  if (precision !== "seconds" && start.time === "00:00:00" && end.time === "23:59:59") {
    const days = formatCivilDays(
      locale,
      new Date(Date.UTC(from.year, from.month, from.day)),
      new Date(Date.UTC(to.year, to.month, to.day)),
      withYear,
    );
    return { range: days, zone: suffix };
  }
  const seconds =
    precision === "seconds" ||
    (precision === "auto" && (start.time.slice(6) !== "00" || end.time.slice(6) !== "00"));
  const clock: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hourCycle: options.hourCycle ?? "h23",
    timeZone: zone,
    calendar: "gregory",
    numberingSystem: "latn",
  };
  const dated = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    ...clock,
  });
  const startOffset = formatUtcOffsetAt(startMs, zone);
  const endOffset = formatUtcOffsetAt(endMs, zone);
  const sameDate = start.date === end.date;
  const repeated =
    isRepeatedWallTime(start.date, start.time, zone) ||
    isRepeatedWallTime(end.date, end.time, zone);
  const clockRunsBack = sameDate && startOffset !== endOffset && end.time <= start.time;
  // Intl drops zone names inside formatRange, so each end of a DST-ambiguous range is formatted alone.
  if (repeated || clockRunsBack) {
    const endText = (sameDate ? new Intl.DateTimeFormat(locale, clock) : dated).format(endMs);
    return {
      range: `${plainSpaces(dated.format(startMs))} ${startOffset} – ${plainSpaces(endText)} ${endOffset}`,
      zone: "",
    };
  }
  return { range: plainSpaces(dated.formatRange(startMs, endMs)), zone: suffix };
};

/** One instant as the summary writes an end: `Nov 4, 13:47:03`, with the year outside the current one. */
export const formatInstantFull = (
  us: number,
  timezone: string | null | undefined,
  options: Omit<RangeLabelOptions, "precision" | "browserZone"> = {},
): string => {
  const zone = safeTimezone(timezone);
  const ms = Math.floor(us / 1000);
  const withYear = currentYearIn(ms, zone) !== currentYearIn(options.nowMs ?? Date.now(), zone);
  const format = new Intl.DateTimeFormat(options.locale ?? "en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: options.hourCycle ?? "h23",
    timeZone: zone,
    calendar: "gregory",
    numberingSystem: "latn",
  });
  return plainSpaces(format.format(ms));
};

/** The summary's range text: like the trigger label, with seconds always and no whole-day collapse. */
export const formatRangeFull = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
  options: Omit<RangeLabelOptions, "precision"> = {},
): RangeLabel => formatRangeLabel(startUs, endUs, timezone, { ...options, precision: "seconds" });

/** A label and its zone suffix as one line of text. */
export const joinRangeLabel = (label: RangeLabel): string =>
  label.zone ? `${label.range} ${label.zone}` : label.range;

/** The muted dates beside a calendar chip: "Nov 4", "Nov 2 – 7", "Oct 1 – 31"; a current period runs to today, with the year only outside the current one. */
export const formatCalendarRailHint = (
  token: string,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
  locale: string = "en-US",
): string | null => {
  const span = resolveCalendarCivilSpan(token, timezone, nowMs);
  if (!span) return null;
  const { unit, first, last, today } = span;
  if (unit === "year") return String(first.getUTCFullYear());
  const end = last.getTime() > today.getTime() ? today : last;
  const currentYear = today.getUTCFullYear();
  const withYear = first.getUTCFullYear() !== currentYear || end.getUTCFullYear() !== currentYear;
  return formatCivilDays(locale, first, end, withYear);
};

/** Whether a range is longer than the page's query-range limit; 0 means no limit. */
export const exceedsRangeRestriction = (
  startUs: number,
  endUs: number,
  restrictionInHours: number,
): boolean => restrictionInHours > 0 && (endUs - startUs) / 3_600_000_000 > restrictionInHours;

/** The window kept as typed when within the limit, else the largest whole period ≤ the limit in the largest unit no bigger than the typed one that names it exactly. */
export const clampRelativeWindow = (window: RelativeWindow, limitHours: number): RelativeWindow => {
  if (!(limitHours > 0)) return window;
  const limitSeconds = Math.round(limitHours * 3600);
  if (window.value * RELATIVE_UNIT_SECONDS[window.unit] <= limitSeconds) return window;
  const unit = EXACT_UNITS.find(
    (candidate) =>
      RELATIVE_UNIT_SECONDS[candidate] <= RELATIVE_UNIT_SECONDS[window.unit] &&
      limitSeconds % RELATIVE_UNIT_SECONDS[candidate] === 0,
  );
  return unit
    ? { value: limitSeconds / RELATIVE_UNIT_SECONDS[unit], unit }
    : { value: Math.floor(limitSeconds / 60), unit: "m" };
};

/** Doubles a range; null when it cannot grow (at the page's limit, or already reaching both now and the earliest date). */
export const zoomOutRange = (range: ZoomRange, bounds: ZoomBounds): ZoomRange | null => {
  const limitHours = bounds.limitHours ?? 0;
  if (range.kind === "relative") {
    const doubled = normaliseRelative(range.value * 2, range.unit);
    const clamped = clampRelativeWindow(doubled, limitHours);
    const before = range.value * RELATIVE_UNIT_SECONDS[range.unit];
    const after = clamped.value * RELATIVE_UNIT_SECONDS[clamped.unit];
    return after > before ? { kind: "relative", ...clamped } : null;
  }
  const duration = range.endUs - range.startUs;
  if (!(duration > 0)) return null;
  const centre = range.startUs + duration / 2;
  let startUs = Math.floor(centre - duration);
  let endUs = Math.ceil(centre + duration);
  // Time after now holds no data, so the overflow past now widens the start instead.
  if (endUs > bounds.nowUs) {
    const keptEnd = Math.max(bounds.nowUs, range.endUs);
    startUs -= endUs - keptEnd;
    endUs = keptEnd;
  }
  if (limitHours > 0) startUs = Math.max(startUs, endUs - limitHours * 3_600_000_000);
  if (bounds.minUs !== undefined) startUs = Math.max(startUs, bounds.minUs);
  startUs = Math.floor(startUs / MICROS_PER_SECOND) * MICROS_PER_SECOND;
  if (startUs >= range.startUs && endUs <= range.endUs) return null;
  return { kind: "absolute", startUs: Math.min(startUs, range.startUs), endUs };
};

/** The Copy text: an ISO 8601 interval with offsets, to the second, read back to the same instants in any zone. */
export const formatCopyRange = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
): string => {
  const zone = safeTimezone(timezone);
  const iso = (us: number) =>
    formatInTimeZone(Math.floor(us / MICROS_PER_SECOND) * 1000, zone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return `${iso(startUs)}/${iso(endUs)}`;
};

// Months stay months; any other doubled span is renamed into the largest unit that divides it.
const normaliseRelative = (value: number, unit: RelativeUnit): RelativeWindow => {
  if (unit === "M") return { value, unit };
  const seconds = value * RELATIVE_UNIT_SECONDS[unit];
  const exact = EXACT_UNITS.find((candidate) => seconds % RELATIVE_UNIT_SECONDS[candidate] === 0);
  return exact ? { value: seconds / RELATIVE_UNIT_SECONDS[exact], unit: exact } : { value, unit };
};
