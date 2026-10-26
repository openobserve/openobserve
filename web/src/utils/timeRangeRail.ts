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

import { raw, type I18nKey, type I18nText } from "@/types/i18n";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";

const DAY_MS = 86_400_000;

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
  { id: "this-year", token: "calendar:year:0", labelKey: "common.thisYear", soFar: true },
  { id: "last-year", token: "calendar:year:-1", labelKey: "common.lastYear", soFar: false },
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
  suffix: I18nText | null;
  tooltip: I18nText | undefined;
  selected: boolean;
  disabled: boolean;
}

export interface RecentRangeLabel {
  label: I18nText;
  /** 1 when the range ends on the day after it starts, else 0. */
  extraDays: number;
}

/** "Oct 26 · 15:45–16:20", "Oct 25 22:00–01:30" (+1 day) or "Oct 19 – Oct 21", in the picker timezone. */
export const formatRecentRange = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
  locale: string = "en-US",
  nowMs: number = Date.now(),
): RecentRangeLabel => {
  const zone = safeTimezone(timezone);
  const startMs = Math.floor(startUs / 1000);
  const endMs = Math.floor(endUs / 1000);
  const currentYear = formatInTimeZone(nowMs, zone, "yyyy");
  const day = (ms: number) => {
    const withYear = formatInTimeZone(ms, zone, "yyyy") !== currentYear;
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: zone,
    }).format(ms);
  };
  const time = (ms: number) => formatInTimeZone(ms, zone, "HH:mm");
  const dayDiff = Math.round(
    (Date.parse(formatInTimeZone(endMs, zone, "yyyy-MM-dd")) -
      Date.parse(formatInTimeZone(startMs, zone, "yyyy-MM-dd"))) /
      DAY_MS,
  );

  if (dayDiff <= 0) {
    return { label: raw(`${day(startMs)} · ${time(startMs)}–${time(endMs)}`), extraDays: 0 };
  }
  if (dayDiff === 1) {
    return { label: raw(`${day(startMs)} ${time(startMs)}–${time(endMs)}`), extraDays: 1 };
  }
  return { label: raw(`${day(startMs)} – ${day(endMs)}`), extraDays: 0 };
};

/** Whether a range is longer than the page's query-range limit; 0 means no limit. */
export const exceedsRangeRestriction = (
  startUs: number,
  endUs: number,
  restrictionInHours: number,
): boolean => restrictionInHours > 0 && (endUs - startUs) / 3_600_000_000 > restrictionInHours;
