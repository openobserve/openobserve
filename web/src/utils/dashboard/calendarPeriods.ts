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

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

const CALENDAR_TOKEN_PATTERN = /^calendar:(day|week|month|quarter|year):(0|-[1-9]\d{0,5})$/;
const RANGE_FORMAT = "yyyy/MM/dd HH:mm:ss";
const DST_SEARCH_SECONDS = 3 * 60 * 60;

const THIS_KEYS: Record<Exclude<CalendarUnit, "day">, I18nKey> = {
  week: "common.thisWeek",
  month: "common.thisMonth",
  quarter: "common.thisQuarter",
  year: "common.thisYear",
};

const LAST_KEYS: Record<Exclude<CalendarUnit, "day">, I18nKey> = {
  week: "common.lastWeek",
  month: "common.lastMonth",
  quarter: "common.lastQuarter",
  year: "common.lastYear",
};

export type CalendarUnit = "day" | "week" | "month" | "quarter" | "year";

export interface CalendarPeriod {
  unit: CalendarUnit;
  offset: number;
}

export interface CalendarRange {
  startTime: number;
  endTime: number;
}

interface CivilBounds {
  start: Date;
  next: Date;
  today: Date;
}

export const parseCalendarToken = (token: unknown): CalendarPeriod | null => {
  if (typeof token !== "string") return null;
  const match = token.match(CALENDAR_TOKEN_PATTERN);
  if (!match) return null;
  return { unit: match[1] as CalendarUnit, offset: Number(match[2]) };
};

export const buildCalendarToken = (unit: CalendarUnit, offset: number): string =>
  `calendar:${unit}:${offset}`;

/** Moves a calendar token by `step` periods; null when the result would be in the future or invalid. */
export const shiftCalendarToken = (token: string, step: number): string | null => {
  const period = parseCalendarToken(token);
  if (!period) return null;
  const offset = period.offset + step;
  if (offset > 0) return null;
  const next = buildCalendarToken(period.unit, offset);
  return parseCalendarToken(next) ? next : null;
};

export const resolveCalendarPeriod = (
  token: unknown,
  timezone?: string | null,
  nowMs: number = Date.now(),
): CalendarRange | null => {
  const period = parseCalendarToken(token);
  if (!period) return null;
  const zone = safeTimezone(timezone);
  const bounds = civilBounds(period, zone, nowMs);
  if (!bounds) return null;
  const startMs = zonedMidnight(bounds.start, zone);
  const endMs = period.offset === 0 ? nowMs : zonedMidnight(bounds.next, zone) - 1;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startTime: startMs * 1000, endTime: endMs * 1000 };
};

/** Trigger-button label for a calendar token, e.g. "This month", "Oct 6", "Q2 2026". */
export const formatCalendarLabel = (
  token: unknown,
  timezone: string | null | undefined,
  t: TranslateFn,
  locale: string = "en-US",
  nowMs: number = Date.now(),
): I18nText | null => {
  const period = parseCalendarToken(token);
  if (!period) return null;
  const bounds = civilBounds(period, safeTimezone(timezone), nowMs);
  if (!bounds) return null;
  const { unit, offset } = period;
  if (unit === "day") {
    if (offset === 0) return t("common.today");
    if (offset === -1) return t("common.yesterday");
  } else {
    if (offset === 0) return t(THIS_KEYS[unit]);
    if (offset === -1) return t(LAST_KEYS[unit]);
  }
  return formatOlderLabel(unit, bounds, t, locale);
};

/** Absolute range in the product's absolute format plus the timezone, for tooltips. */
export const formatCalendarTooltip = (
  token: unknown,
  timezone?: string | null,
  nowMs: number = Date.now(),
): I18nText | null => {
  const range = resolveCalendarPeriod(token, timezone, nowMs);
  if (!range) return null;
  const zone = safeTimezone(timezone);
  const start = formatInTimeZone(range.startTime / 1000, zone, RANGE_FORMAT);
  const end = formatInTimeZone(Math.floor(range.endTime / 1000), zone, RANGE_FORMAT);
  return raw(`${start} - ${end} (${zone})`);
};

const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// An unknown zone (or the "Browser Time (…)" option label) would make date-fns-tz throw or return NaN.
const safeTimezone = (timezone?: string | null): string => {
  if (!timezone) return browserTimezone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return browserTimezone();
  }
};

// setUTCFullYear avoids Date.UTC mapping years 0-99 onto 1900-1999.
const civilDate = (year: number, monthIndex: number, day: number): Date => {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
};

const periodStart = (unit: CalendarUnit, offset: number, today: Date): Date => {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  if (unit === "day") return civilDate(y, m, d + offset);
  if (unit === "week") {
    const isoWeekday = ((today.getUTCDay() + 6) % 7) + 1;
    return civilDate(y, m, d - (isoWeekday - 1) + 7 * offset);
  }
  if (unit === "month") return civilDate(y, m + offset, 1);
  if (unit === "quarter") return civilDate(y, Math.floor(m / 3) * 3 + 3 * offset, 1);
  return civilDate(y + offset, 0, 1);
};

// Calendar maths runs on UTC-held civil dates so the browser's own zone never shifts a boundary.
const civilBounds = (period: CalendarPeriod, zone: string, nowMs: number): CivilBounds | null => {
  const [y, m, d] = formatInTimeZone(nowMs, zone, "yyyy-MM-dd").split("-").map(Number);
  const today = civilDate(y, m - 1, d);
  const start = periodStart(period.unit, period.offset, today);
  const next = periodStart(period.unit, period.offset + 1, today);
  const startYear = start.getUTCFullYear();
  if (!Number.isFinite(startYear) || startYear < 1 || next.getUTCFullYear() > 9999) return null;
  return { start, next, today };
};

const zonedMidnight = (civil: Date, zone: string): number => {
  const day = `${String(civil.getUTCFullYear()).padStart(4, "0")}-${pad2(civil.getUTCMonth() + 1)}-${pad2(civil.getUTCDate())}`;
  const guess = fromZonedTime(`${day}T00:00:00`, zone).getTime();
  if (!Number.isFinite(guess)) return guess;
  const reached = (seconds: number) => formatInTimeZone(seconds * 1000, zone, "yyyy-MM-dd") >= day;
  const guessSeconds = Math.floor(guess / 1000);
  if (reached(guessSeconds) && !reached(guessSeconds - 1)) return guess;
  // A DST change at midnight skips or repeats 00:00, so binary-search the first second of the day.
  let before = guessSeconds - DST_SEARCH_SECONDS;
  let after = guessSeconds + DST_SEARCH_SECONDS;
  while (after - before > 1) {
    const mid = Math.floor((before + after) / 2);
    if (reached(mid)) after = mid;
    else before = mid;
  }
  return after * 1000;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatOlderLabel = (
  unit: CalendarUnit,
  bounds: CivilBounds,
  t: TranslateFn,
  locale: string,
): I18nText => {
  const { start, next, today } = bounds;
  const currentYear = today.getUTCFullYear();
  const lastDay = new Date(next.getTime() - 86_400_000);
  if (unit === "day") {
    const withYear = start.getUTCFullYear() !== currentYear;
    return raw(civilFormatter(locale, dayOptions(withYear)).format(start));
  }
  if (unit === "week") {
    const withYear =
      start.getUTCFullYear() !== currentYear || lastDay.getUTCFullYear() !== currentYear;
    return raw(civilFormatter(locale, dayOptions(withYear)).formatRange(start, lastDay));
  }
  if (unit === "month") {
    return raw(civilFormatter(locale, { month: "short", year: "numeric" }).format(start));
  }
  if (unit === "quarter") {
    return t("common.calendarQuarterOf", {
      quarter: Math.floor(start.getUTCMonth() / 3) + 1,
      year: start.getUTCFullYear(),
    });
  }
  return raw(String(start.getUTCFullYear()));
};

const dayOptions = (withYear: boolean): Intl.DateTimeFormatOptions =>
  withYear
    ? { month: "short", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric" };

const civilFormatter = (locale: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
