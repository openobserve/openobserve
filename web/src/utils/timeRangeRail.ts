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
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";

const MICROS_PER_SECOND = 1_000_000;

// Ordered as this/last pairs, last on the left: the rail renders two per row.
export const CALENDAR_RAIL_ITEMS: readonly CalendarRailPreset[] = [
  { id: "yesterday", token: "calendar:day:-1", labelKey: "common.yesterday", soFar: false },
  { id: "today", token: "calendar:day:0", labelKey: "common.today", soFar: true },
  { id: "last-week", token: "calendar:week:-1", labelKey: "common.lastWeek", soFar: false },
  { id: "this-week", token: "calendar:week:0", labelKey: "common.thisWeek", soFar: true },
  { id: "last-month", token: "calendar:month:-1", labelKey: "common.lastMonth", soFar: false },
  { id: "this-month", token: "calendar:month:0", labelKey: "common.thisMonth", soFar: true },
  {
    id: "last-quarter",
    token: "calendar:quarter:-1",
    labelKey: "common.lastQuarter",
    soFar: false,
  },
  { id: "this-quarter", token: "calendar:quarter:0", labelKey: "common.thisQuarter", soFar: true },
  // No year chip — nobody keeps a year of retention; the resolver still accepts calendar:year:* tokens.
];

export interface CalendarRailPreset {
  id: string;
  token: string;
  labelKey: I18nKey;
  soFar: boolean;
}

/** A recent row's label split into date/time segments, so the rail can colour them differently. */
export interface TimeRangeRailRangeParts {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/** One row of the time picker's rail, already formatted for display. */
export interface TimeRangeRailItem {
  id: string;
  label: I18nText;
  tooltip: I18nText | undefined;
  selected: boolean;
  disabled: boolean;
  /** Recent rows only — lets the rail render the date in the normal colour and the time muted. */
  parts?: TimeRangeRailRangeParts;
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

/** Same range as {@link formatRecentRange}, split so the rail can colour the date and time differently. */
export const formatRecentRangeParts = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
): TimeRangeRailRangeParts => {
  const { start, end } = splitRecentRange(startUs, endUs, safeTimezone(timezone));
  return { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
};

/** Whether a range is longer than the page's query-range limit; 0 means no limit. */
export const exceedsRangeRestriction = (
  startUs: number,
  endUs: number,
  restrictionInHours: number,
): boolean => restrictionInHours > 0 && (endUs - startUs) / 3_600_000_000 > restrictionInHours;
