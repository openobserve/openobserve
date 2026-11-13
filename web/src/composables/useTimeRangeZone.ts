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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { fromZonedTime } from "date-fns-tz";
import { convertToUtcTimestamp } from "@/utils/zincutils";
import { subtractRelativeTime } from "@/utils/date";
import { formatCalendarTooltip, resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import {
  formatAbsoluteInstant,
  formatCivilDayPrefix,
  formatPeriodLabel,
} from "@/utils/timeRangeRail";
import { parseRollingPeriod, resolveZonedCivil } from "@/utils/dateTimeRangeParse";
import { localeFileMap } from "@/locales";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export const MICROS_PER_SECOND = 1_000_000;
export const MICROS_PER_MINUTE = 60 * MICROS_PER_SECOND;
export const MICROS_PER_HOUR = 60 * MICROS_PER_MINUTE;

// Arithmetic units for date subtraction: code tokens, never rendered, so they stay English in every locale.
const PERIOD_ARITHMETIC_UNIT: Record<string, string> = {
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
  w: "weeks",
  M: "months",
};

// One offset lookup per zone for the whole app, renewed each quarter hour as DST moves offsets on those bounds.
const zoneOffsets = { quarterHour: -1, byZone: new Map<string, string>() };

export const civilDayMs = (date: string): number =>
  Date.parse(`${date.replace(/\//g, "-")}T00:00:00Z`);

export const addCivilDays = (date: string, days: number): string =>
  new Date(civilDayMs(date) + days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "/");

// longOffset throws on engines that lack it, so the label falls back to no offset.
export const zoneOffset = (zone: string, atMs: number): string => {
  const quarterHour = Math.floor(atMs / 900_000);
  if (quarterHour !== zoneOffsets.quarterHour) {
    zoneOffsets.quarterHour = quarterHour;
    zoneOffsets.byZone.clear();
  }
  const cached = zoneOffsets.byZone.get(zone);
  if (cached !== undefined) return cached;
  let offset = "";
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(atMs))
      .find((part) => part.type === "timeZoneName")?.value;
    offset = name?.replace("GMT", "") || "+00:00";
  } catch {
    offset = "";
  }
  zoneOffsets.byZone.set(zone, offset);
  return offset;
};

/** The picker's zone and minute clock, and instants read and written as civil dates and labels in that zone. */
export default function useTimeRangeZone(pickerTimezone: () => string) {
  const store = useStore();
  const { t, locale } = useI18nTyped();
  const pickerZone = ref(pickerTimezone());
  const zone = computed<string>(() => (pickerTimezone() ? pickerZone.value : store.state.timezone));
  const intlLocale = computed(() => localeFileMap[String(locale.value)] ?? "en-US");
  // Offset-0 tooltips end at now, so they read a clock refreshed on hover rather than a stale render time.
  const tooltipNow = ref(Date.now());

  const refreshTooltipNow = () => {
    tooltipNow.value = Date.now();
  };

  const labelOptions = () => ({
    timezone: zone.value,
    locale: intlLocale.value,
    nowMs: tooltipNow.value,
  });

  const convertUnixTime = (unixTimeMicros: number) =>
    formatAbsoluteInstant(unixTimeMicros, zone.value);

  // Wall-clock date and time in the picker zone to epoch µs, the inverse of convertUnixTime.
  // One rule for the bar and the Start/End fields: a gap time moves forward, a repeated one takes its first instant.
  const absoluteToMicros = (date: string, time: string, zoneName = zone.value): number => {
    try {
      return resolveZonedCivil(date, time, zoneName).micros;
    } catch {
      const iso = `${date.replace(/\//g, "-")}T${time}`;
      return fromZonedTime(iso, zoneName).getTime() * 1000;
    }
  };

  // A shown 23:59:59 is the whole last second, so the exclusive backend end is the next midnight.
  const endFieldToMicros = (date: string, time: string, throughSecond = false): number =>
    absoluteToMicros(date, time) + (throughSecond || time === "23:59:59" ? MICROS_PER_SECOND : 0);

  const isZoneMidnight = (micros: number) =>
    micros % MICROS_PER_SECOND === 0 && convertUnixTime(micros).time === "00:00:00";

  const civilDayStart = (date: string) => convertToUtcTimestamp(`${date} 00:00:00`, zone.value);

  const dayLabel = (date: string): string =>
    formatCivilDayPrefix(date, zone.value, tooltipNow.value, intlLocale.value);

  // "Last 1 hour" for a rolling period, the calendar label for a token.
  const relativeLabel = (period: string): I18nText =>
    formatPeriodLabel(period, zone.value, t, intlLocale.value, tooltipNow.value);

  // Weeks have no date arithmetic of their own, so they count as seven days each.
  const rollingRange = (value: number, unit: string, nowMs: number) => {
    const subtraction =
      unit === "w" ? { days: value * 7 } : { [PERIOD_ARITHMETIC_UNIT[unit]]: value };
    const start = subtractRelativeTime(new Date(nowMs), subtraction);
    return { startTime: new Date(start).getTime() * 1000, endTime: nowMs * 1000 };
  };

  const resolveRelativePeriod = (
    period: string,
    nowMs: number,
  ): { startTime: number; endTime: number } | null => {
    const calendarRange = resolveCalendarPeriod(period, zone.value, nowMs);
    if (calendarRange) return calendarRange;
    const rolling = parseRollingPeriod(period);
    return rolling ? rollingRange(rolling.value, rolling.unit, nowMs) : null;
  };

  const calendarTooltip = (token: string | null) =>
    token === null
      ? undefined
      : (formatCalendarTooltip(token, zone.value, tooltipNow.value) ?? undefined);

  const formatShownInstant = (micros: number) => {
    const { date, time } = convertUnixTime(micros);
    return `${dayLabel(date)} ${time.slice(0, 5)}`;
  };

  // "Nov 12, 21:13:49.948", the instant a pasted time was read as.
  const formatExactInstant = (micros: number) => {
    const { date, time } = convertUnixTime(micros);
    const ms = String(Math.floor((((micros % 1e6) + 1e6) % 1e6) / 1000)).padStart(3, "0");
    return `${dayLabel(date)} ${time}.${ms}`;
  };

  // "21:08:49.948 – 21:18:49.948" for an anchor row, the day added only when the ends differ.
  const formatClockSpan = (startUs: number, endUs: number) => {
    const clock = (us: number) => formatExactInstant(us).split(" ").pop() ?? "";
    const sameDay = convertUnixTime(startUs).date === convertUnixTime(endUs).date;
    return sameDay
      ? `${clock(startUs)} – ${clock(endUs)}`
      : `${formatExactInstant(startUs)} – ${formatExactInstant(endUs)}`;
  };

  return {
    pickerZone,
    zone,
    intlLocale,
    tooltipNow,
    refreshTooltipNow,
    labelOptions,
    convertUnixTime,
    absoluteToMicros,
    endFieldToMicros,
    isZoneMidnight,
    civilDayStart,
    dayLabel,
    relativeLabel,
    rollingRange,
    resolveRelativePeriod,
    calendarTooltip,
    formatShownInstant,
    formatExactInstant,
    formatClockSpan,
  };
}

export type TimeRangeZone = ReturnType<typeof useTimeRangeZone>;
