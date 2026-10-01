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
import type { I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import type { DowntimeSchedule, DowntimeWindow } from "@/services/downtimes";

export const MIN_DURATION_SECS = 60;
export const MAX_DURATION_SECS = 7 * 24 * 3600;
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const MICROS = 1_000_000;
const DAY_MS = 86_400_000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const UNIT_SECS: Record<string, number> = { d: 86_400, h: 3600, m: 60 };

export const isHhMm = (value: string): boolean => HHMM.test(value);
export const isYmd = (value: string): boolean => YMD.test(value);

/** `90`, `90m`, `2h`, `1h 30m`, `1 h 30 min`, `1d 2h` → seconds; a bare number is minutes. */
export function parseDuration(text: string): number | null {
  const input = String(text ?? "")
    .trim()
    .toLowerCase();
  if (!input) return null;
  if (/^\d+$/.test(input)) return Number(input) * 60;
  const tokens = input.match(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)/g);
  if (!tokens) return null;
  const consumed = tokens.join("").replace(/\s+/g, "");
  if (consumed.length !== input.replace(/\s+/g, "").length) return null;
  return tokens.reduce((sum, token) => {
    const [, amount, unit] = token.match(/(\d+)\s*([a-z]+)/) ?? [];
    return sum + Number(amount) * UNIT_SECS[unit[0]];
  }, 0);
}

const durationParts = (secs: number) => ({
  d: Math.floor(secs / 86_400),
  h: Math.floor((secs % 86_400) / 3600),
  m: Math.floor((secs % 3600) / 60),
});

/** The input form the page writes back into the Duration field, e.g. `1h 30m`. */
export function durationInput(secs: number): string {
  const { d, h, m } = durationParts(secs);
  return [d ? `${d}d` : "", h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

/** `1 h 30 min`, `2 h`, `45 min`, `1 d 2 h`. */
export function formatDuration(secs: number, t: TranslateFn): I18nText {
  const { d, h, m } = durationParts(secs);
  const parts = [
    d ? t("alerts.downtimes.duration.days", { count: d }) : "",
    h ? t("alerts.downtimes.duration.hours", { count: h }) : "",
    m ? t("alerts.downtimes.duration.minutes", { count: m }) : "",
  ].filter(Boolean);
  return raw(parts.join(" ") || t("alerts.downtimes.duration.minutes", { count: 0 }));
}

/** A wall-clock date and time in `tz`, as microseconds UTC; `null` when either part is malformed. */
export function localToUtcMicros(date: string, time: string, tz: string): number | null {
  if (!isYmd(date) || !isHhMm(time) || !tz) return null;
  const ms = fromZonedTime(`${date}T${time}:00`, tz).getTime();
  return Number.isFinite(ms) ? ms * 1000 : null;
}

export function utcMicrosToLocal(micros: number, tz: string): { date: string; time: string } {
  const at = new Date(Math.floor(micros / 1000));
  return {
    date: formatInTimeZone(at, tz, "yyyy-MM-dd"),
    time: formatInTimeZone(at, tz, "HH:mm"),
  };
}

const addDays = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
};

const isoWeekday = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
};

const occursOn = (s: DowntimeSchedule, ymd: string): boolean => {
  if (ymd < utcMicrosToLocal(s.starts_at, s.timezone).date) return false;
  if (s.ends_at && ymd > utcMicrosToLocal(s.ends_at, s.timezone).date) return false;
  return s.repeat !== "weekly" || s.weekdays.includes(isoWeekday(ymd));
};

/** The window that is running at `nowMicros`, else the next one; recurring rows look 8 days ahead. */
export function currentOrNextWindow(
  s: DowntimeSchedule,
  nowMicros: number,
): DowntimeWindow | null {
  if (s.repeat === "none") {
    if (!s.ends_at || s.ends_at <= nowMicros) return null;
    return { start: s.starts_at, end: s.ends_at };
  }
  if (!s.start_time_local || !isHhMm(s.start_time_local)) return null;
  const today = utcMicrosToLocal(nowMicros, s.timezone).date;
  for (let offset = -1; offset <= 8; offset += 1) {
    const day = addDays(today, offset);
    if (!occursOn(s, day)) continue;
    const start = localToUtcMicros(day, s.start_time_local, s.timezone);
    if (start === null) continue;
    const end = start + s.duration_secs * MICROS;
    if (end > nowMicros) return { start, end };
  }
  return null;
}

/** The last `count` windows that ended before `nowMicros`, oldest first; looks back 60 days. */
export function recentWindows(
  s: DowntimeSchedule,
  nowMicros: number,
  count: number,
): DowntimeWindow[] {
  if (s.repeat === "none") {
    return s.ends_at && s.ends_at <= nowMicros ? [{ start: s.starts_at, end: s.ends_at }] : [];
  }
  if (!s.start_time_local || !isHhMm(s.start_time_local)) return [];
  const today = utcMicrosToLocal(nowMicros, s.timezone).date;
  const found: DowntimeWindow[] = [];
  for (let offset = 0; offset >= -60 && found.length < count; offset -= 1) {
    const day = addDays(today, offset);
    if (!occursOn(s, day)) continue;
    const start = localToUtcMicros(day, s.start_time_local, s.timezone);
    if (start === null) continue;
    const end = start + s.duration_secs * MICROS;
    if (end <= nowMicros) found.push({ start, end });
  }
  return found.reverse();
}

/** `Sun 20 Sep, 02:00` in `tz`; the names follow `locale`, the order is fixed. */
export function formatWindowTime(micros: number, tz: string, locale?: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).formatToParts(new Date(Math.floor(micros / 1000)));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")}`;
}

export function formatWindow(
  w: DowntimeWindow,
  tz: string,
  t: TranslateFn,
  locale?: string,
): I18nText {
  return t("alerts.downtimes.schedule.windowRange", {
    start: formatWindowTime(w.start, tz, locale),
    end: formatWindowTime(w.end, tz, locale),
    zone: tz,
  });
}

const weekdayNames = (days: number[], locale?: string): string => {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2024-01-01 is a Monday, so ISO day n is 2024-01-0n.
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => fmt.format(new Date(Date.UTC(2024, 0, d))))
    .join(", ");
};

/** The one-line schedule used in the list, the detail page and the summary. */
export function scheduleSentence(s: DowntimeSchedule, t: TranslateFn, locale?: string): I18nText {
  if (s.repeat === "none") {
    return t("alerts.downtimes.schedule.onceSentence", {
      start: formatWindowTime(s.starts_at, s.timezone, locale),
      end: s.ends_at ? formatWindowTime(s.ends_at, s.timezone, locale) : "",
      zone: s.timezone,
    });
  }
  const params = {
    time: s.start_time_local ?? "",
    duration: formatDuration(s.duration_secs, t),
    zone: s.timezone,
    days: weekdayNames(s.weekdays, locale),
  };
  return s.repeat === "daily"
    ? t("alerts.downtimes.schedule.dailySentence", params)
    : t("alerts.downtimes.schedule.weeklySentence", params);
}
