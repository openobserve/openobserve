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

import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from "date-fns-tz";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import type { DowntimeSchedule, DowntimeWindow } from "@/services/downtimes";
import { canonicalTimezone } from "@/utils/timezoneAliases";

export const MIN_DURATION_SECS = 60;
export const MAX_DURATION_SECS = 7 * 24 * 3600;
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const MICROS = 1_000_000;
const DAY_MS = 86_400_000;
const FULL_DAY_SECS = 86_400;
const MAX_GAP_MINUTES = 180;
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
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 10) !== date) return null;
  // A wall time in a spring-forward gap moves to the first valid minute, as the server does.
  for (let minutes = 0; minutes <= MAX_GAP_MINUTES; minutes += 1) {
    const at = earliestInstant(naive + minutes * 60_000, tz);
    if (at !== null) return at * 1000;
  }
  return null;
}

/** The earliest instant whose wall clock in `tz` reads `naive` (a UTC-labelled wall time), else `null`. */
const earliestInstant = (naive: number, tz: string): number | null => {
  const wall = new Date(naive).toISOString().slice(0, 16);
  const candidates = [
    fromZonedTime(`${wall}:00`, tz).getTime(),
    ...[naive - DAY_MS, naive + DAY_MS].map((near) => naive - getTimezoneOffset(tz, near)),
  ].filter((ms) => Number.isFinite(ms));
  const valid = candidates.filter(
    (ms) => formatInTimeZone(new Date(ms), tz, "yyyy-MM-dd'T'HH:mm") === wall,
  );
  return valid.length ? Math.min(...valid) : null;
};

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

/** The ISO weekday (Monday 1 to Sunday 7) of a `yyyy-MM-dd` date. */
export const isoWeekday = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
};

const occursOn = (s: DowntimeSchedule, ymd: string): boolean => {
  if (ymd < utcMicrosToLocal(s.starts_at, s.timezone).date) return false;
  if (s.ends_at && ymd > utcMicrosToLocal(s.ends_at, s.timezone).date) return false;
  return s.repeat !== "weekly" || s.weekdays.includes(isoWeekday(ymd));
};

/** The start of the occurrence on a local day; the server skips one before `starts_at`, e.g. 09:00 on a day that starts at 13:00. */
const occurrenceStart = (s: DowntimeSchedule, day: string): number | null => {
  if (!s.start_time_local || !occursOn(s, day)) return null;
  const start = localToUtcMicros(day, s.start_time_local, s.timezone);
  return start === null || start < s.starts_at ? null : start;
};

/** The start of the first occurrence after a local day; a repeat gap is at most 7 days. */
const nextStartAfter = (s: DowntimeSchedule, day: string): number | null => {
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const start = occurrenceStart(s, addDays(day, ahead));
    if (start !== null) return start;
  }
  return null;
};

/** A full-day window ends at the next day's start, and no window runs past the next one's start, so DST days neither overlap nor gap. */
const windowEnd = (s: DowntimeSchedule, day: string, start: number): number => {
  const full =
    s.duration_secs === FULL_DAY_SECS && s.start_time_local
      ? localToUtcMicros(addDays(day, 1), s.start_time_local, s.timezone)
      : null;
  const end = full ?? start + s.duration_secs * MICROS;
  const next = nextStartAfter(s, day);
  return next !== null && next < end ? next : end;
};

/** Whether a recurring rule has any window, searched like the server: 8 days from its start. */
export function producesWindow(s: DowntimeSchedule): boolean {
  if (s.repeat === "none") return true;
  if (!s.start_time_local || !isHhMm(s.start_time_local)) return true;
  const first = utcMicrosToLocal(s.starts_at, s.timezone).date;
  for (let offset = 0; offset <= 8; offset += 1) {
    if (occurrenceStart(s, addDays(first, offset)) !== null) return true;
  }
  return false;
}

/** The window that is running at `nowMicros`, else the next one; recurring rows look 8 days ahead. */
export function currentOrNextWindow(s: DowntimeSchedule, nowMicros: number): DowntimeWindow | null {
  if (s.repeat === "none") {
    if (!s.ends_at || s.ends_at <= nowMicros) return null;
    return { start: s.starts_at, end: s.ends_at };
  }
  if (!s.start_time_local || !isHhMm(s.start_time_local)) return null;
  // Like the server, a series that starts later is searched from its start.
  const today = utcMicrosToLocal(Math.max(nowMicros, s.starts_at), s.timezone).date;
  // A window that started up to `duration` ago is still running; a late start reaches one day further.
  const lookback = Math.ceil(s.duration_secs / 86_400) + 1;
  for (let offset = -lookback; offset <= 8; offset += 1) {
    const day = addDays(today, offset);
    const start = occurrenceStart(s, day);
    if (start === null) continue;
    const end = windowEnd(s, day, start);
    if (end > nowMicros) return { start, end };
  }
  return null;
}

/** A cancel drops every later window and cuts the one that holds it, as the server's `cut_at_cancel` does. */
const cutAtCancel = (w: DowntimeWindow, cancelledAt?: number | null): DowntimeWindow | null => {
  if (cancelledAt === null || cancelledAt === undefined) return w;
  if (w.start >= cancelledAt) return null;
  return { start: w.start, end: Math.min(w.end, cancelledAt) };
};

/** The last `count` windows that ended before `nowMicros`, oldest first, cut at a cancel; looks back 60 days. */
export function recentWindows(
  s: DowntimeSchedule,
  nowMicros: number,
  count: number,
  cancelledAt?: number | null,
): DowntimeWindow[] {
  if (s.repeat === "none") {
    if (!s.ends_at) return [];
    const w = cutAtCancel({ start: s.starts_at, end: s.ends_at }, cancelledAt);
    return w && w.end <= nowMicros ? [w] : [];
  }
  if (!s.start_time_local || !isHhMm(s.start_time_local)) return [];
  const today = utcMicrosToLocal(nowMicros, s.timezone).date;
  const found: DowntimeWindow[] = [];
  for (let offset = 0; offset >= -60 && found.length < count; offset -= 1) {
    const day = addDays(today, offset);
    const start = occurrenceStart(s, day);
    if (start === null) continue;
    const w = cutAtCancel({ start, end: windowEnd(s, day, start) }, cancelledAt);
    if (w && w.end <= nowMicros) found.push(w);
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
      zone: canonicalTimezone(s.timezone),
    });
  }
  const params = {
    time: s.start_time_local ?? "",
    duration: formatDuration(s.duration_secs, t),
    zone: canonicalTimezone(s.timezone),
    days: weekdayNames(s.weekdays, locale),
  };
  return s.repeat === "daily"
    ? t("alerts.downtimes.schedule.dailySentence", params)
    : t("alerts.downtimes.schedule.weeklySentence", params);
}

/** A `yyyy-MM-dd` day with weekday and year, e.g. `Thu, Sep 17, 2026` in en-US. */
export function formatDay(ymd: string, locale?: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The schedule sentence plus, for a recurring row, its first day and its last day or no end. */
export function scheduleWithBounds(s: DowntimeSchedule, t: TranslateFn, locale?: string): I18nText {
  const schedule = scheduleSentence(s, t, locale);
  if (s.repeat === "none") return schedule;
  const start = formatDay(utcMicrosToLocal(s.starts_at, s.timezone).date, locale);
  if (!s.ends_at) return t("alerts.downtimes.schedule.fromNoEnd", { schedule, start });
  const until = formatDay(utcMicrosToLocal(s.ends_at, s.timezone).date, locale);
  return t("alerts.downtimes.schedule.fromUntil", { schedule, start, until });
}
