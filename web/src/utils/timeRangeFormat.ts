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

import { gt, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { CalendarUnit } from "@/utils/dashboard/calendarPeriods";
import {
  formatRangeCopyText,
  formatRangeLabel,
  formatZoneOffset,
  type RangeLabelInput,
  type RangeLabelSurface,
} from "@/utils/timeRangeLabel";
import { formatKnownPeriod } from "@/utils/timeRangeRail";
import {
  rangeState,
  rangeToken,
  resolveRange,
  type TimeRange,
  type TimeRangeContext,
} from "@/utils/timeRangeModel";

const MICROS_PER_MS = 1_000;
// Months a calendar unit spans; weeks and days are counted in days instead.
const UNIT_MONTHS: Partial<Record<CalendarUnit, number>> = { month: 1, quarter: 3, year: 12 };
// Older links keep offsets the UI no longer makes; they are named by how far back they are.
const AGO_KEYS: Record<CalendarUnit, I18nKey> = {
  day: "dateTime.daysAgo",
  week: "dateTime.weeksAgo",
  month: "dateTime.monthsAgo",
  quarter: "dateTime.quartersAgo",
  year: "dateTime.yearsAgo",
};

export type RangeSurface = RangeLabelSurface;

interface CivilDay {
  year: number;
  month: number;
  day: number;
  midnight: boolean;
}

/** The range's name: `Last 15 minutes`, `Previous quarter`, `Q3 2026`; null for a fixed range that is no period. */
export const timeRangeName = (
  range: TimeRange,
  ctx: TimeRangeContext,
  t: TranslateFn = gt,
): string | null => {
  if (range.kind === "calendar" && range.offset < -1) {
    const count = -range.offset;
    return t(
      AGO_KEYS[range.unit],
      { count: new Intl.NumberFormat(ctx.locale).format(count) },
      count,
    );
  }
  if (range.kind !== "fixed") {
    const nowMs = Math.floor(ctx.nowUs / MICROS_PER_MS);
    return formatKnownPeriod(rangeToken(range), ctx.zone, t, ctx.locale, nowMs);
  }
  return fixedPeriodName(range.startUs, range.endUs, ctx);
};

/** The full label of §6 column 1 for a surface; an in-progress end shows as now. */
export const formatTimeRange = (
  range: TimeRange,
  ctx: TimeRangeContext,
  surface: RangeSurface,
  t: TranslateFn = gt,
): string => {
  const nowMs = Math.floor(ctx.nowUs / MICROS_PER_MS);
  return formatRangeLabel(labelInput(range, ctx, t), {
    timezone: ctx.zone,
    locale: ctx.locale,
    nowMs,
    surface,
  });
};

/** Clipboard text the bar reads back: stamps and offset, after the name of a token or a named period. */
export const timeRangeCopyText = (
  range: TimeRange,
  ctx: TimeRangeContext,
  t: TranslateFn = gt,
): string => {
  const input = labelInput(range, ctx, t);
  const nowMs = Math.floor(ctx.nowUs / MICROS_PER_MS);
  const text = formatRangeCopyText(
    { ...input, live: range.kind !== "fixed" },
    { timezone: ctx.zone, locale: ctx.locale, nowMs },
  );
  return range.kind === "fixed" && input.name ? `${input.name} (${text})` : text;
};

/** The kind tag of §3: `live`, `changes Jan 1`, `changes at midnight`, `fixed`. */
export const timeRangeKindTag = (
  range: TimeRange,
  ctx: TimeRangeContext,
  t: TranslateFn = gt,
): I18nText => {
  const state = rangeState(range, ctx);
  if (state === "live") return t("dateTime.tagLive");
  if (state !== "calendar-ended" || range.kind !== "calendar") return t("dateTime.fixed");
  if (range.unit === "day") return t("dateTime.changesAtMidnight");
  return t("dateTime.changesWhen", { when: nextChangeText(range.unit, ctx) });
};

/** `ends Dec 31` for a fixed range still in progress, else null. */
export const timeRangeEndsNote = (
  range: TimeRange,
  ctx: TimeRangeContext,
  t: TranslateFn = gt,
): I18nText | null => {
  if (range.kind !== "fixed" || rangeState(range, ctx) !== "fixed-in-progress") return null;
  const end = civilDay(range.endUs, ctx.zone);
  // An exclusive midnight end is the day before it.
  const last = end.midnight ? addDays(end, -1) : end;
  return t("dateTime.endsWhen", { when: dayText(last, ctx, last.year !== thisYear(ctx)) });
};

/** The zone offset at the range's start, for badges and share text. */
export const timeRangeZoneText = (range: TimeRange, ctx: TimeRangeContext): string =>
  formatZoneOffset(ctx.zone, Math.floor(resolveRange(range, ctx).startUs / MICROS_PER_MS));

const labelInput = (range: TimeRange, ctx: TimeRangeContext, t: TranslateFn): RangeLabelInput => {
  const { startUs, endUs } = resolveRange(range, ctx);
  const name = timeRangeName(range, ctx, t);
  return {
    startUs,
    endUs: Math.min(endUs, ctx.nowUs),
    name,
    live: rangeState(range, ctx) === "live",
    calendar: range.kind === "calendar",
    period: range.kind === "fixed" && name !== null,
  };
};

// A period name iff the instants are exactly one month, quarter, half, year or fiscal year in the zone.
const fixedPeriodName = (startUs: number, endUs: number, ctx: TimeRangeContext): string | null => {
  const start = civilDay(startUs, ctx.zone);
  const end = civilDay(endUs, ctx.zone);
  if (!start.midnight || !end.midnight || start.day !== 1 || end.day !== 1) return null;
  const months = end.year * 12 + end.month - (start.year * 12 + start.month);
  if (months === 1) return monthName(start, ctx.locale);
  if (months === 3 && (start.month - 1) % 3 === 0) {
    return `Q${(start.month - 1) / 3 + 1} ${start.year}`;
  }
  if (months === 6 && (start.month === 1 || start.month === 7)) {
    return `H${start.month === 1 ? 1 : 2} ${start.year}`;
  }
  if (months !== 12) return null;
  if (start.month === 1) return String(start.year);
  // Fiscal years are named by the calendar year they end in.
  return ctx.fiscalYearStartMonth === start.month ? `FY${String(end.year).slice(-2)}` : null;
};

const monthName = (day: CivilDay, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
    utcDate(day),
  );

const nextChangeText = (unit: CalendarUnit, ctx: TimeRangeContext): string => {
  const running = resolveRange({ kind: "calendar", unit, offset: 0 }, ctx);
  const start = civilDay(running.startUs, ctx.zone);
  const next = unit === "week" ? addDays(start, 7) : addMonths(start, UNIT_MONTHS[unit] ?? 1);
  return dayText(next, ctx, false);
};

const thisYear = (ctx: TimeRangeContext): number => civilDay(ctx.nowUs, ctx.zone).year;

const dayText = (day: CivilDay, ctx: TimeRangeContext, withYear: boolean): string =>
  new Intl.DateTimeFormat(ctx.locale, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(utcDate(day));

const civilDay = (micros: number, zone: string): CivilDay => {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const ms = Math.floor(micros / MICROS_PER_MS);
  for (const part of format.formatToParts(ms)) parts[part.type] = part.value;
  const midnight =
    micros % MICROS_PER_MS === 0 &&
    ms % 1000 === 0 &&
    Number(parts.hour) === 0 &&
    Number(parts.minute) === 0 &&
    Number(parts.second) === 0;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), midnight };
};

const utcDate = (day: CivilDay): Date => {
  const date = new Date(0);
  date.setUTCFullYear(day.year, day.month - 1, day.day);
  return date;
};

const addDays = (day: CivilDay, days: number): CivilDay => {
  const date = utcDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date, day.midnight);
};

const addMonths = (day: CivilDay, months: number): CivilDay => {
  const date = utcDate(day);
  date.setUTCMonth(date.getUTCMonth() + months);
  return fromUtc(date, day.midnight);
};

const fromUtc = (date: Date, midnight: boolean): CivilDay => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  midnight,
});
