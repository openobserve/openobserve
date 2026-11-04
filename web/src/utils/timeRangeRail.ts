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

import { raw, type I18nKey, type I18nText } from "@/types/i18n";
import { resolveCalendarCivilSpan, safeTimezone } from "@/utils/dashboard/calendarPeriods";

const MICROS_PER_SECOND = 1_000_000;

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
  /** Recent rows only: the compact bold label and the duration chip shown instead of the full range. */
  compact?: { label: string; duration: string };
  /** Calendar rows only: the muted date hint shown beside the label. */
  hint?: string;
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
): { start: { date: string; time: string }; end: { date: string; time: string } } => {
  const endsAtMidnight =
    endUs > startUs &&
    endUs % MICROS_PER_SECOND === 0 &&
    formatAbsoluteInstant(endUs, zone).time === "00:00:00";
  return {
    start: formatAbsoluteInstant(startUs, zone),
    end: formatAbsoluteInstant(endsAtMidnight ? endUs - 1 : endUs, zone),
  };
};

/** "2026/10/01 00:00:00 - 2026/10/27 09:43:21", matching the trigger's absolute-range label exactly. */
export const formatRecentRange = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
): I18nText => {
  const { start, end } = splitRecentRange(startUs, endUs, safeTimezone(timezone));
  return raw(`${start.date} ${start.time} - ${end.date} ${end.time}`);
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
): string => {
  const zone = safeTimezone(timezone);
  const { start, end } = splitRecentRange(startUs, endUs, zone);
  const from = civilParts(start.date);
  const to = civilParts(end.date);
  const withYear =
    from.year !== currentYearIn(nowMs, zone) || to.year !== currentYearIn(nowMs, zone);
  const day = (p: typeof from) => `${MONTHS[p.month]} ${p.day}${withYear ? `, ${p.year}` : ""}`;
  if (from.year === to.year && from.month === to.month) {
    if (from.day === to.day) return `${day(from)}${sameDayTimes(start.time, end.time)}`;
    return `${MONTHS[from.month]} ${from.day} – ${to.day}${withYear ? `, ${from.year}` : ""}`;
  }
  return `${day(from)} – ${day(to)}`;
};

/** The two largest non-zero units of d/h/m/s in the span, e.g. "1d 15m", "45m", "30s". */
export const formatRecentDuration = (startUs: number, endUs: number): string => {
  const total = Math.max(0, Math.floor((endUs - startUs) / MICROS_PER_SECOND));
  const units: [string, number][] = [
    ["d", Math.floor(total / 86_400)],
    ["h", Math.floor((total % 86_400) / 3600)],
    ["m", Math.floor((total % 3600) / 60)],
    ["s", total % 60],
  ];
  const shown = units.filter(([, value]) => value > 0).slice(0, 2);
  return shown.length === 0 ? "0s" : shown.map(([unit, value]) => `${value}${unit}`).join(" ");
};

/** The muted hint beside a calendar row: "Nov 4", "Nov 2–8", "Nov", "Q4", with the year only outside the current one. */
export const formatCalendarRailHint = (
  token: string,
  timezone: string | null | undefined,
  nowMs: number = Date.now(),
): string | null => {
  const span = resolveCalendarCivilSpan(token, timezone, nowMs);
  if (!span) return null;
  const { unit, first, last, today } = span;
  const currentYear = today.getUTCFullYear();
  const withYear = first.getUTCFullYear() !== currentYear || last.getUTCFullYear() !== currentYear;
  const day = (d: Date) =>
    `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${withYear ? `, ${d.getUTCFullYear()}` : ""}`;
  const yearSuffix = withYear ? ` ${first.getUTCFullYear()}` : "";
  if (unit === "day") return day(first);
  if (unit === "month") return `${MONTHS[first.getUTCMonth()]}${yearSuffix}`;
  if (unit === "quarter") return `Q${Math.floor(first.getUTCMonth() / 3) + 1}${yearSuffix}`;
  if (unit === "year") return String(first.getUTCFullYear());
  if (
    first.getUTCFullYear() === last.getUTCFullYear() &&
    first.getUTCMonth() === last.getUTCMonth()
  ) {
    return `${MONTHS[first.getUTCMonth()]} ${first.getUTCDate()}–${last.getUTCDate()}${withYear ? `, ${first.getUTCFullYear()}` : ""}`;
  }
  return `${day(first)}–${day(last)}`;
};

/** Whether a range is longer than the page's query-range limit; 0 means no limit. */
export const exceedsRangeRestriction = (
  startUs: number,
  endUs: number,
  restrictionInHours: number,
): boolean => restrictionInHours > 0 && (endUs - startUs) / 3_600_000_000 > restrictionInHours;
