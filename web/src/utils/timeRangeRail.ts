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

import { toZonedTime } from "date-fns-tz";

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatCalendarLabel, safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { formatRangeDuration } from "@/utils/timeRangeLabel";

const MICROS_PER_SECOND = 1_000_000;

// One whole-sentence plural key per unit, as word order and plural forms differ per language.
export const PAST_PERIOD_KEYS: Record<string, I18nKey> = {
  s: "common.pastSecond",
  m: "common.pastMinute",
  h: "common.pastHour",
  d: "common.pastDay",
  w: "common.pastWeek",
  M: "common.pastMonth",
};

// List order; finished periods read "Previous …" so they are not taken for rolling ranges.
export const CALENDAR_RAIL_ITEMS: readonly CalendarRailPreset[] = [
  { id: "today", token: "calendar:day:0", labelKey: "common.today" },
  { id: "yesterday", token: "calendar:day:-1", labelKey: "common.yesterday" },
  { id: "this-week", token: "calendar:week:0", labelKey: "common.thisWeek" },
  { id: "last-week", token: "calendar:week:-1", labelKey: "dateTime.previousWeek" },
  { id: "this-month", token: "calendar:month:0", labelKey: "common.thisMonth" },
  { id: "last-month", token: "calendar:month:-1", labelKey: "dateTime.previousMonth" },
  { id: "this-quarter", token: "calendar:quarter:0", labelKey: "common.thisQuarter" },
  { id: "last-quarter", token: "calendar:quarter:-1", labelKey: "dateTime.previousQuarter" },
  { id: "year", token: "calendar:year:0", labelKey: "common.thisYear" },
  { id: "previous-year", token: "calendar:year:-1", labelKey: "dateTime.previousYear" },
];

export interface CalendarRailPreset {
  id: string;
  token: string;
  labelKey: I18nKey;
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

const civilDayOptions = (withYear: boolean): Intl.DateTimeFormatOptions => ({
  month: "short",
  day: "numeric",
  ...(withYear ? { year: "numeric" } : {}),
  timeZone: "UTC",
});

// Intl keeps each locale's word order, as the sibling older-period labels do; thin spaces become plain ones.
const formatCivilDays = (locale: string, first: Date, last: Date, withYear: boolean): string => {
  const format = new Intl.DateTimeFormat(locale, civilDayOptions(withYear));
  const text =
    first.getTime() === last.getTime() ? format.format(first) : format.formatRange(first, last);
  return text.replace(/[\u2009\u202f]/g, " ");
};

const civilParts = (date: string): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split("/").map(Number);
  return { year, month: month - 1, day };
};

const currentYearIn = (nowMs: number, zone: string): number =>
  toZonedTime(nowMs, zone).getFullYear();

/** "Nov 1", or "Jan 1, 1999" outside the current year, for a yyyy/MM/dd day. */
export const formatCivilDay = (
  date: string,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
  locale: string = "en-US",
): string => {
  const { year, month, day } = civilParts(date);
  if (!year || !day || !(month >= 0 && month <= 11)) return "";
  const civilDay = new Date(Date.UTC(year, month, day));
  const withYear = year !== currentYearIn(nowMs, safeTimezone(timezone));
  return formatCivilDays(locale, civilDay, civilDay, withYear);
};

/** The date that precedes a time of day on a civil day ("Nov 6," or "11月6日"), punctuated by the locale, with the year only outside the current one. */
export const formatCivilDayPrefix = (
  date: string,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
  locale: string = "en-US",
): string => {
  const { year, month, day } = civilParts(date);
  if (!year || !day || !(month >= 0 && month <= 11)) return "";
  const civilDay = new Date(Date.UTC(year, month, day));
  const withYear = year !== currentYearIn(nowMs, safeTimezone(timezone));
  const parts = new Intl.DateTimeFormat(locale, {
    ...civilDayOptions(withYear),
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(civilDay);
  const hourIndex = parts.findIndex((part) => part.type === "hour");
  // Locales that put the time first have no date-then-time separator, so they get the bare day.
  if (hourIndex <= 0) return formatCivilDays(locale, civilDay, civilDay, withYear);
  return parts
    .slice(0, hourIndex)
    .map((part) => part.value)
    .join("")
    .replace(/[\u2009\u202f]/g, " ")
    .trimEnd();
};

/** The short abbreviation of a zone at an instant, e.g. "UTC", "EST" or "GMT+5:30". */
export const formatZoneAbbreviation = (
  timezone: string | null | undefined,
  atMs: number = Date.now(),
  locale: string = "en-US",
): string => {
  const zone = safeTimezone(timezone);
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
        .formatToParts(new Date(atMs))
        .find((part) => part.type === "timeZoneName")?.value ?? zone
    );
  } catch {
    return zone;
  }
};

/** The two largest units of an exact span, e.g. "1h 30m", or "974 µs" under a second. */
export const formatDurationMicros = (spanMicros: number): string =>
  formatRangeDuration(0, spanMicros);

/** The two largest non-zero units of d/h/m/s in the span, e.g. "1d 15m", "45m", "30s". */
export const formatRecentDuration = (startUs: number, endUs: number): string => {
  // A legacy end on a whole :59 second is inclusive of that minute, so a whole day reads 1d, not 23h 59m.
  const inclusive =
    endUs % MICROS_PER_SECOND === 0 && Math.floor(endUs / MICROS_PER_SECOND) % 60 === 59;
  return formatRangeDuration(startUs, inclusive ? endUs + MICROS_PER_SECOND : endUs);
};

/** Whether a range is longer than the page's query-range limit; 0 means no limit. */
export const exceedsRangeRestriction = (
  startUs: number,
  endUs: number,
  restrictionInHours: number,
): boolean => restrictionInHours > 0 && (endUs - startUs) / 3_600_000_000 > restrictionInHours;

/** "Last 15 minutes" for a rolling period, the calendar label for a token, else null. */
export const formatKnownPeriod = (
  period: string | null | undefined,
  timezone: string | null | undefined,
  t: TranslateFn,
  locale: string = "en-US",
  nowMs: number = Date.now(),
): I18nText | null => {
  const calendar = formatCalendarLabel(period, timezone, t, locale, nowMs);
  if (calendar) return calendar;
  const rolling = String(period ?? "").match(/^(\d+)([smhdwM])$/);
  const count = Number(rolling?.[1]);
  if (!rolling || !(count >= 1)) return null;
  // Years are stored as months, so whole years read back in the unit they were typed in.
  if (rolling[2] === "M" && count % 12 === 0) {
    return t("common.pastYear", { count: count / 12 }, count / 12);
  }
  return t(PAST_PERIOD_KEYS[rolling[2]], { count }, count);
};

/** "Last 15 minutes" for a rolling period, the calendar label for a token, else the text as given. */
export const formatPeriodLabel = (
  period: string,
  timezone: string | null | undefined,
  t: TranslateFn,
  locale: string = "en-US",
  nowMs: number = Date.now(),
): I18nText => formatKnownPeriod(period, timezone, t, locale, nowMs) ?? raw(period);

/** The trigger's zone badge: the zone's own abbreviation, else `UTC±hh:mm`. */
export const formatZoneBadge = (timezone: string | null | undefined, atMs: number = Date.now()) => {
  const short = formatZoneAbbreviation(timezone, atMs, "en-US");
  const offset = short.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  return offset ? `UTC${offset[1]}${offset[2].padStart(2, "0")}:${offset[3] ?? "00"}` : short;
};
