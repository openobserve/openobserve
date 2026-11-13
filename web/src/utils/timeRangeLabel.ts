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

import { formatInTimeZone } from "date-fns-tz";

import { safeTimezone } from "@/utils/dashboard/calendarPeriods";

const MICROS_PER_MS = 1_000;
const MICROS_PER_SECOND = 1_000_000;
const MICROS_PER_MINUTE = 60 * MICROS_PER_SECOND;
const MICROS_PER_DAY = 86_400 * MICROS_PER_SECOND;
const MS_PER_DAY = 86_400_000;
// A Date holds ±8.64e15 ms; two days of headroom keep a zone shift and a next-day step inside it.
const MAX_DATE_MS = 8.64e15 - 2 * MS_PER_DAY;
const LIVE_SECONDS_BELOW_US = 5 * MICROS_PER_MINUTE;
const MS_BELOW_US = MICROS_PER_MINUTE;
// A month is the shortest period whose label carries its year.
const MONTH_LONG_US = 28 * MICROS_PER_DAY;
const DASH = " – ";
// Intl puts thin and narrow no-break spaces around range dashes and before am/pm; copies read better with plain ones.
const THIN_SPACES = /[\u2009\u202f]/g;

export type RangeLabelSurface = "toolbar" | "dashboard" | "print" | "summary" | "row" | "toast";

export interface RangeLabelOptions {
  timezone?: string | null;
  locale?: string;
  nowMs?: number;
  surface?: RangeLabelSurface;
}

export interface RangeLabelInput {
  startUs: number;
  /** Exclusive; a midnight end, or a legacy 23:59:59 one, is shown as the day before. */
  endUs: number;
  name?: string | null;
  live?: boolean;
  calendar?: boolean;
  /** The name is a typed period (`Q4 2026`) that already names its year. */
  period?: boolean;
}

type Precision = "minute" | "second" | "ms";

interface Civil {
  date: string;
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  seconds: number;
  ms: number;
}

interface Shape {
  zone: string;
  locale: string;
  start: Civil;
  lastDay: Civil;
  end: Civil;
  wholeDays: boolean;
  withYear: boolean;
  precision: Precision;
  /** Full stamps name the year on both bounds. */
  repeatYear?: boolean;
  /** A named period cut short shows its first day alone: `Oct 1 – Nov 12, 21:24`. */
  startDayOnly?: boolean;
}

/** Dates part of a label: "Nov 12, 21:08:49 – 21:18:49", "Nov 4 – 6", "Oct 1 – Nov 12, 2026". */
export const formatRangeDates = (range: RangeLabelInput, opts: RangeLabelOptions = {}): string =>
  datesOf(shapeOf(range, opts));

/** Live: the name, or "name · dates" when `showDates`. Fixed: the dates, after a given name only. */
export const formatRangeLabel = (
  range: RangeLabelInput,
  opts: RangeLabelOptions & { showDates?: boolean } = {},
): string => {
  const showDates = opts.showDates ?? (opts.surface === "dashboard" || opts.surface === "print");
  if (range.live && range.name) {
    return showDates ? `${range.name} · ${formatRangeDates(range, opts)}` : range.name;
  }
  if (range.name) return `${range.name} · ${formatRangeDates(range, opts)}`;
  return formatRangeDates(range, opts);
};

/** Largest two units ("2m 20s", "12h 24m"); "1 ms" or "974 µs" under a second, never "0s". */
export const formatRangeDuration = (startUs: number, endUs: number): string => {
  const span = Math.max(0, Math.round(endUs - startUs));
  if (span < MICROS_PER_MS) return `${span} µs`;
  if (span < MICROS_PER_SECOND) return `${Math.floor(span / MICROS_PER_MS)} ms`;
  const total = Math.floor(span / MICROS_PER_SECOND);
  const units: [string, number][] = [
    ["d", Math.floor(total / 86_400)],
    ["h", Math.floor((total % 86_400) / 3600)],
    ["m", Math.floor((total % 3600) / 60)],
    ["s", total % 60],
  ];
  return units
    .filter(([, value]) => value > 0)
    .slice(0, 2)
    .map(([unit, value]) => `${value}${unit}`)
    .join(" ");
};

/** Full stamps for the tooltip: "Nov 12, 2026, 21:08:49.948 – 21:18:49.948"; a whole-day end shows its last millisecond. */
export const formatRangeStamps = (range: RangeLabelInput, opts: RangeLabelOptions = {}): string => {
  const base = shapeOf(range, opts);
  const exclusiveEnd = base.wholeDays && (isMidnight(base.end) || isLegacyDayEnd(base.end));
  const endUs = exclusiveEnd
    ? Math.ceil(range.endUs / MICROS_PER_MS) * MICROS_PER_MS - MICROS_PER_MS
    : range.endUs;
  const shape: Shape = {
    ...base,
    end: civilOf(endUs, base.zone),
    wholeDays: false,
    withYear: true,
    precision: "ms",
    repeatYear: true,
    startDayOnly: false,
  };
  return datesOf(shape);
};

/** The zone's offset at an instant as "UTC+05:30", or "UTC". */
export const formatZoneOffset = (
  timezone: string | null | undefined,
  atMs: number = Date.now(),
): string => {
  const offset = formatInTimeZone(clampMs(atMs), safeTimezone(timezone), "xxx");
  return offset === "+00:00" ? "UTC" : `UTC${offset}`;
};

/** Text Copy puts on the clipboard, which the bar reads back: stamps and offset, after the name for a live range. */
export const formatRangeCopyText = (
  range: RangeLabelInput,
  opts: RangeLabelOptions = {},
): string => {
  const zone = safeTimezone(opts.timezone);
  // Stamps hold milliseconds; the exclusive end rounds up so pasting the copy keeps the last sub-ms event.
  const endUs = Math.ceil(range.endUs / MICROS_PER_MS) * MICROS_PER_MS;
  const startMs = Math.floor(range.startUs / MICROS_PER_MS);
  const endMs = endUs / MICROS_PER_MS;
  const start = civilOf(range.startUs, zone);
  const end = civilOf(endUs, zone);
  const precision = range.live
    ? range.endUs - range.startUs < LIVE_SECONDS_BELOW_US
      ? "second"
      : "minute"
    : neededPrecision(start, end);
  const startOffset = formatZoneOffset(zone, startMs);
  const endOffset = formatZoneOffset(zone, endMs);
  // Across a DST change each side names its own offset, so reading the text back gives the same instants.
  const startText = `${start.date} ${clockText(start, precision)}${startOffset === endOffset ? "" : ` ${startOffset}`}`;
  const endText = `${end.date === start.date ? "" : `${end.date} `}${clockText(end, precision)} ${endOffset}`;
  const stamps = `${startText}${DASH}${endText}`;
  return range.live && range.name ? `${range.name} (${stamps})` : stamps;
};

const clean = (text: string): string => text.replace(THIN_SPACES, " ");

const clampMs = (ms: number): number => Math.min(Math.max(ms, -MAX_DATE_MS), MAX_DATE_MS);

const civilFormats = new Map<string, Intl.DateTimeFormat>();

const civilFormat = (zone: string): Intl.DateTimeFormat => {
  let format = civilFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      era: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    civilFormats.set(zone, format);
  }
  return format;
};

// Read field by field, as `yyyy` text breaks past year 9999 and drops the sign before year 1.
const civilOf = (micros: number, zone: string): Civil => {
  const ms = clampMs(Math.floor(micros / MICROS_PER_MS));
  const parts: Record<string, string> = {};
  for (const part of civilFormat(zone).formatToParts(ms)) parts[part.type] = part.value;
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const era = Number(parts.year);
  const year = parts.era === "BC" ? 1 - era : era;
  const [month, day] = [Number(parts.month), Number(parts.day)];
  const [hour, minute, seconds] = [Number(parts.hour), Number(parts.minute), Number(parts.second)];
  const milli = ((ms % 1000) + 1000) % 1000;
  return {
    date: `${year < 0 ? "-" : ""}${pad(Math.abs(year), 4)}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}:${pad(seconds)}.${pad(milli, 3)}`,
    year,
    month,
    day,
    hour,
    minute,
    seconds,
    ms: milli,
  };
};

// The civil fields as a UTC Date, which Intl formats in `timeZone: "UTC"`.
const utcDateOf = (civil: Civil, withClock: boolean): Date => {
  const date = new Date(0);
  date.setUTCFullYear(civil.year, civil.month - 1, civil.day);
  if (withClock) date.setUTCHours(civil.hour, civil.minute, civil.seconds, civil.ms);
  return date;
};

const isMidnight = (civil: Civil): boolean => civil.time === "00:00:00.000";

const isLegacyDayEnd = (civil: Civil): boolean => civil.time.startsWith("23:59:59");

const neededPrecision = (start: Civil, end: Civil): Precision => {
  if (start.ms || end.ms) return "ms";
  return start.seconds || end.seconds ? "second" : "minute";
};

const shapeOf = (range: RangeLabelInput, opts: RangeLabelOptions): Shape => {
  const zone = safeTimezone(opts.timezone);
  const locale = opts.locale ?? "en-US";
  const span = range.endUs - range.startUs;
  const start = civilOf(range.startUs, zone);
  const end = civilOf(range.endUs, zone);
  // A live calendar period runs from a midnight to now, so it reads as the days it covers so far.
  const toDate = Boolean(range.live && range.calendar);
  const wholeDays =
    span > 0 && isMidnight(start) && (toDate || isMidnight(end) || isLegacyDayEnd(end));
  // A step of 1 µs is lost in a float past the year 2255, so the day before steps back 1 ms.
  const lastDay = wholeDays && isMidnight(end) ? civilOf(range.endUs - MICROS_PER_MS, zone) : end;
  const thisYear = civilOf((opts.nowMs ?? Date.now()) * MICROS_PER_MS, zone).year;
  const longPeriod = (range.calendar || Boolean(range.name)) && span >= MONTH_LONG_US;
  const namedPeriod = Boolean(range.period && range.name && !range.live);
  const withYear = namedPeriod
    ? start.year !== lastDay.year
    : opts.surface === "dashboard" ||
      opts.surface === "print" ||
      start.year !== thisYear ||
      lastDay.year !== thisYear ||
      longPeriod;
  let precision: Precision =
    range.live || namedPeriod
      ? span < LIVE_SECONDS_BELOW_US
        ? "second"
        : "minute"
      : neededPrecision(start, end);
  if (span < MS_BELOW_US) precision = "ms";
  else if (precision === "ms") precision = "second";
  // The End field shows an exclusive midnight as 23:59:59, so a fixed label shows the day's last minute or second too.
  const shownEnd =
    !wholeDays && !range.live && precision !== "ms" && isMidnight(end)
      ? civilOf(range.endUs - MICROS_PER_SECOND, zone)
      : end;
  const startDayOnly = namedPeriod && !wholeDays && isMidnight(start) && start.date !== end.date;
  return {
    zone,
    locale,
    start,
    lastDay,
    end: shownEnd,
    wholeDays,
    withYear,
    precision,
    startDayOnly,
  };
};

const datesOf = (shape: Shape): string => {
  const { locale, start, lastDay, end, wholeDays, withYear, precision, repeatYear } = shape;
  const day = (civil: Civil) => utcDateOf(civil, false);
  if (wholeDays) {
    const format = new Intl.DateTimeFormat(locale, dayOptions(withYear));
    const text =
      start.date === lastDay.date
        ? format.format(day(start))
        : format.formatRange(day(start), day(lastDay));
    return clean(text);
  }
  const at = (civil: Civil) => utcDateOf(civil, true);
  const dated = (year: boolean) =>
    new Intl.DateTimeFormat(locale, { ...dayOptions(year), ...clockOptions(precision) });
  if (start.date !== end.date) {
    // One year, on the end, when both bounds share it.
    const startYear = withYear && (repeatYear || start.year !== end.year);
    const startText = shape.startDayOnly
      ? clean(new Intl.DateTimeFormat(locale, dayOptions(startYear)).format(day(start)))
      : clean(dated(startYear).format(at(start)));
    return `${startText}${DASH}${clean(dated(withYear).format(at(end)))}`;
  }
  const startText = clean(dated(withYear).format(at(start)));
  const clock = new Intl.DateTimeFormat(locale, { ...clockOptions(precision), timeZone: "UTC" });
  return `${startText}${DASH}${clean(clock.format(at(end)))}`;
};

const dayOptions = (withYear: boolean): Intl.DateTimeFormatOptions => ({
  month: "short",
  day: "numeric",
  ...(withYear ? { year: "numeric" } : {}),
  timeZone: "UTC",
});

const clockOptions = (precision: Precision): Intl.DateTimeFormatOptions => ({
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  ...(precision === "minute" ? {} : { second: "2-digit" }),
  ...(precision === "ms" ? { fractionalSecondDigits: 3 } : {}),
});

const clockText = (civil: Civil, precision: Precision): string => {
  if (precision === "minute") return civil.time.slice(0, 5);
  return precision === "second" ? civil.time.slice(0, 8) : civil.time;
};
