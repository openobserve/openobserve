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
const LIVE_SECONDS_BELOW_US = 5 * MICROS_PER_MINUTE;
const MS_BELOW_US = MICROS_PER_MINUTE;
// A month is the shortest period whose label carries its year.
const MONTH_LONG_US = 28 * MICROS_PER_DAY;
const DASH = " – ";
const CIVIL_FORMAT = "yyyy-MM-dd HH:mm:ss.SSS";
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
}

type Precision = "minute" | "second" | "ms";

// `toDate`: a period still running, shown from its start to the range's end.
interface NamedPeriod {
  name: string;
  withDates: boolean;
  toDate?: boolean;
}

interface Civil {
  date: string;
  time: string;
  year: number;
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
}

/** Dates part of a label: "Nov 12, 21:08:49 – 21:18:49", "Nov 4 – 6", "Oct 1 – Nov 12, 2026". */
export const formatRangeDates = (range: RangeLabelInput, opts: RangeLabelOptions = {}): string =>
  datesOf(shapeOf(range, opts));

/** "Q3 2026", "H1 2026", "Sep 2026" or "2025" when a range is exactly that period in the zone, else null. */
export const namedFixedPeriod = (
  startUs: number,
  endUs: number,
  opts: RangeLabelOptions = {},
): string | null => periodOf(startUs, endUs, opts)?.name ?? null;

/** A named fixed range in two parts, as the summary row shows it: "Q4 2026" and "Oct 1 – Nov 12, 21:24". */
export const namedFixedRange = (
  startUs: number,
  endUs: number,
  opts: RangeLabelOptions = {},
): { name: string; dates: string } | null => {
  const period = periodOf(startUs, endUs, opts);
  if (!period) return null;
  const range = { startUs, endUs };
  const dates = period.withDates ? periodDates(period, range, opts) : formatRangeDates(range, opts);
  return { name: period.name, dates };
};

/** Live: the name, or "name · dates" when `showDates`. Fixed: "Q3 2026 · Jul 1 – Sep 30", "Sep 2026", "2025", else the dates. */
export const formatRangeLabel = (
  range: RangeLabelInput,
  opts: RangeLabelOptions & { showDates?: boolean } = {},
): string => {
  const showDates = opts.showDates ?? (opts.surface === "dashboard" || opts.surface === "print");
  if (range.live && range.name) {
    return showDates ? `${range.name} · ${formatRangeDates(range, opts)}` : range.name;
  }
  if (range.name) return `${range.name} · ${formatRangeDates(range, opts)}`;
  const period = periodOf(range.startUs, range.endUs, opts);
  if (!period) return formatRangeDates(range, opts);
  if (!period.withDates) return period.name;
  return `${period.name} · ${periodDates(period, range, opts)}`;
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
  };
  return datesOf(shape);
};

/** The zone's offset at an instant as "UTC+05:30", or "UTC". */
export const formatZoneOffset = (
  timezone: string | null | undefined,
  atMs: number = Date.now(),
): string => {
  const offset = formatInTimeZone(atMs, safeTimezone(timezone), "xxx");
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

const civilOf = (micros: number, zone: string): Civil => {
  const text = formatInTimeZone(Math.floor(micros / MICROS_PER_MS), zone, CIVIL_FORMAT);
  const [date, time] = text.split(" ");
  return {
    date,
    time,
    year: Number(date.slice(0, 4)),
    seconds: Number(time.slice(6, 8)),
    ms: Number(time.slice(9, 12)),
  };
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
  const lastDay = wholeDays && isMidnight(end) ? civilOf(range.endUs - 1, zone) : end;
  const thisYear = Number(formatInTimeZone(opts.nowMs ?? Date.now(), zone, "yyyy"));
  const longPeriod = (range.calendar || Boolean(range.name)) && span >= MONTH_LONG_US;
  const withYear =
    opts.surface === "dashboard" ||
    opts.surface === "print" ||
    start.year !== thisYear ||
    lastDay.year !== thisYear ||
    longPeriod;
  let precision: Precision = range.live
    ? span < LIVE_SECONDS_BELOW_US
      ? "second"
      : "minute"
    : neededPrecision(start, end);
  if (span < MS_BELOW_US) precision = "ms";
  else if (precision === "ms") precision = "second";
  // The End field shows an exclusive midnight as 23:59:59, so a label with seconds does too.
  const shownEnd =
    !wholeDays && precision === "second" && isMidnight(end)
      ? civilOf(range.endUs - MICROS_PER_SECOND, zone)
      : end;
  return { zone, locale, start, lastDay, end: shownEnd, wholeDays, withYear, precision };
};

const datesOf = (shape: Shape): string => {
  const { locale, start, lastDay, end, wholeDays, withYear, precision, repeatYear } = shape;
  const day = (civil: Civil) => new Date(`${civil.date}T00:00:00Z`);
  if (wholeDays) {
    const format = new Intl.DateTimeFormat(locale, dayOptions(withYear));
    const text =
      start.date === lastDay.date
        ? format.format(day(start))
        : format.formatRange(day(start), day(lastDay));
    return clean(text);
  }
  const at = (civil: Civil) => new Date(`${civil.date}T${civil.time}Z`);
  const dated = (year: boolean) =>
    new Intl.DateTimeFormat(locale, { ...dayOptions(year), ...clockOptions(precision) });
  if (start.date !== end.date) {
    // One year, on the end, when both bounds share it.
    const startYear = withYear && (repeatYear || start.year !== end.year);
    const startText = clean(dated(startYear).format(at(start)));
    return `${startText}${DASH}${clean(dated(withYear).format(at(end)))}`;
  }
  const startText = clean(dated(withYear).format(at(start)));
  const clock = new Intl.DateTimeFormat(locale, { ...clockOptions(precision), timeZone: "UTC" });
  return `${startText}${DASH}${clean(clock.format(at(end)))}`;
};

// The period's name already says the year, so its dates leave it out.
const periodDates = (period: NamedPeriod, range: RangeLabelInput, opts: RangeLabelOptions) => {
  const shape = { ...shapeOf(range, opts), withYear: false };
  return period.toDate ? sinceDates(shape) : datesOf(shape);
};

// "Oct 1 – Nov 12, 21:24": the start of a running period is its first day.
const sinceDates = ({ locale, start, end }: Shape): string => {
  const first = new Intl.DateTimeFormat(locale, dayOptions(false));
  const last = new Intl.DateTimeFormat(locale, { ...dayOptions(false), ...clockOptions("minute") });
  const startText = clean(first.format(new Date(`${start.date}T00:00:00Z`)));
  return `${startText}${DASH}${clean(last.format(new Date(`${end.date}T${end.time}Z`)))}`;
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

// A fixed range from a month's first midnight to a later one is that month, quarter, half or year.
const periodOf = (startUs: number, endUs: number, opts: RangeLabelOptions): NamedPeriod | null => {
  const zone = safeTimezone(opts.timezone);
  const locale = opts.locale ?? "en-US";
  const start = civilOf(startUs, zone);
  const end = civilOf(endUs, zone);
  if (!isMidnight(start) || !start.date.endsWith("-01")) return null;
  const startMonth = Number(start.date.slice(5, 7)) - 1;
  if (!isMidnight(end) || !end.date.endsWith("-01")) {
    return startedPeriod(start, end, startMonth, endUs - startUs, opts);
  }
  const months = (end.year - start.year) * 12 + Number(end.date.slice(5, 7)) - 1 - startMonth;
  if (months === 1) return { name: monthName(start, locale), withDates: false };
  const name = periodName(start.year, startMonth, months, locale);
  return name ? { name, withDates: months !== 12 } : null;
};

// A typed `Q4` or `2026` runs from its period's start to now; it is named while that period is still running.
const startedPeriod = (
  start: Civil,
  end: Civil,
  startMonth: number,
  spanUs: number,
  opts: RangeLabelOptions,
): NamedPeriod | null => {
  if (spanUs < MICROS_PER_DAY || isMidnight(end)) return null;
  const now = civilOf((opts.nowMs ?? Date.now()) * MICROS_PER_MS, safeTimezone(opts.timezone));
  const at = (civil: Civil) => `${civil.date} ${civil.time}`;
  for (const months of [1, 3, 6, 12]) {
    if (startMonth % months !== 0) continue;
    const next = startMonth + months;
    const year = start.year + Math.floor(next / 12);
    const periodEnd = `${year}-${String((next % 12) + 1).padStart(2, "0")}-01 00:00:00.000`;
    if (at(end) >= periodEnd) continue;
    if (at(now) >= periodEnd) return null;
    const locale = opts.locale ?? "en-US";
    const name =
      months === 1 ? monthName(start, locale) : periodName(start.year, startMonth, months, locale);
    return name ? { name, withDates: true, toDate: true } : null;
  }
  return null;
};

const periodName = (
  startYear: number,
  startMonth: number,
  months: number,
  locale: string,
): string | null => {
  const number = new Intl.NumberFormat(locale, { useGrouping: false });
  const year = number.format(startYear);
  if (months === 12 && startMonth === 0) return year;
  if (months === 6 && startMonth % 6 === 0) return `H${number.format(startMonth / 6 + 1)} ${year}`;
  if (months === 3 && startMonth % 3 === 0) return `Q${number.format(startMonth / 3 + 1)} ${year}`;
  return null;
};

const monthName = (start: Civil, locale: string): string =>
  clean(
    new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${start.date}T00:00:00Z`),
    ),
  );
