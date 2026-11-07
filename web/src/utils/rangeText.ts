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

const MICROS_PER_SECOND = 1_000_000;
const DAY_MS = 86_400_000;
const LONG_OFFSET_RE = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/;

// date-fns-tz 3.2 reads New York's repeated hour with the later offset, so offsets come from Intl.
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** A clock change near a wall time: the wall clock just before it and just after it, both `HH:mm`. */
export interface DstTransition {
  before: string;
  after: string;
  atMs: number;
}

/** The two lines of an absolute range's tooltip: the ISO range and "duration · zone". */
export interface RangeTooltipLines {
  range: string;
  detail: string;
}

/** The two largest non-zero units of d/h/m/s in the span, e.g. "1d 15m", "45m", "30s". */
export const formatRecentDuration = (startUs: number, endUs: number): string => {
  const spanSeconds = Math.max(0, Math.floor((endUs - startUs) / MICROS_PER_SECOND));
  // A range ending at :59 is inclusive of that minute, so a whole day reads 1d, not 23h 59m.
  const total = Math.floor(endUs / MICROS_PER_SECOND) % 60 === 59 ? spanSeconds + 1 : spanSeconds;
  const units: [string, number][] = [
    ["d", Math.floor(total / 86_400)],
    ["h", Math.floor((total % 86_400) / 3600)],
    ["m", Math.floor((total % 3600) / 60)],
    ["s", total % 60],
  ];
  const shown = units.filter(([, value]) => value > 0).slice(0, 2);
  return shown.length === 0 ? "0s" : shown.map(([unit, value]) => `${value}${unit}`).join(" ");
};

/** The zone's offset at that instant as `UTC` or `UTC+05:30`; Intl would spell it `GMT+5:30`. */
export const formatUtcOffsetAt = (ms: number, zone: string): string => {
  const offsetMs = zoneOffsetMs(ms, zone);
  if (!Number.isFinite(offsetMs) || offsetMs === 0) return "UTC";
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  const sign = offsetMs < 0 ? "-" : "+";
  return `UTC${sign}${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
};

/** Every instant (ms) whose wall clock in `zone` reads `date time`: none in a skipped hour, two in a repeated one. */
export const wallInstants = (date: string, time: string, zone: string): number[] => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(naive)) return [];
  const found = new Set<number>();
  let offsetKnown = false;
  for (const probe of [naive - DAY_MS, naive, naive + DAY_MS]) {
    const offset = zoneOffsetMs(probe, zone);
    if (!Number.isFinite(offset)) continue;
    offsetKnown = true;
    const candidate = naive - offset;
    if (zoneOffsetMs(candidate, zone) === offset) found.add(candidate);
  }
  if (!offsetKnown) return fallbackInstant(date, time, zone, naive);
  return [...found].sort((a, b) => a - b);
};

/** An end exactly at a midnight is exclusive, so it reads as the previous day's last second. */
export const displayEndUs = (startUs: number, endUs: number, zone: string): number => {
  const endsAtMidnight =
    endUs > startUs &&
    endUs % MICROS_PER_SECOND === 0 &&
    formatInTimeZone(Math.floor(endUs / 1000), zone, "HH:mm:ss") === "00:00:00";
  return endsAtMidnight ? endUs - 1 : endUs;
};

/** `2026-11-04 13:47:03`, seconds always, in the zone. */
export const formatIsoInstant = (us: number, zone: string): string =>
  formatInTimeZone(Math.floor(us / 1000), zone, "yyyy-MM-dd HH:mm:ss");

/** The zone as the timezone select names it: `UTC`, or `Asia/Calcutta (UTC+05:30)`. */
export const formatZoneName = (zone: string, atMs: number): string =>
  zone === "UTC" ? "UTC" : `${zone} (${formatUtcOffsetAt(atMs, zone)})`;

/** `2026-11-04 13:47:03 – 2026-11-06 14:02:03` and `2d 15m · Asia/Calcutta (UTC+05:30)`; `zone` must be valid. */
export const formatRangeTooltipLines = (
  startUs: number,
  endUs: number,
  zone: string,
): RangeTooltipLines => ({
  range: `${formatIsoInstant(startUs, zone)} – ${formatIsoInstant(displayEndUs(startUs, endUs, zone), zone)}`,
  detail: `${formatRecentDuration(startUs, endUs)} · ${formatZoneName(zone, Math.floor(startUs / 1000))}`,
});

/** The clock change within a day of that wall time, or null when the offset does not change. */
export const describeDstTransition = (
  date: string,
  time: string,
  zone: string,
): DstTransition | null => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let low = naive - DAY_MS;
  let high = naive + DAY_MS;
  const before = zoneOffsetMs(low, zone);
  const after = zoneOffsetMs(high, zone);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return null;
  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2);
    if (zoneOffsetMs(mid, zone) === before) low = mid;
    else high = mid;
  }
  const wall = (offset: number) => new Date(high + offset).toISOString().slice(11, 16);
  return { before: wall(before), after: wall(after), atMs: high };
};

/** The zone's UTC offset in ms at that instant; NaN for an unknown zone. */
export const zoneOffsetMs = (ms: number, zone: string): number => {
  let format = offsetFormatters.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    } catch {
      return Number.NaN;
    }
    offsetFormatters.set(zone, format);
  }
  const name = format.formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName");
  const match = name?.value.match(LONG_OFFSET_RE);
  if (!match) return Number.NaN;
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === "-" ? -minutes : minutes) * 60_000;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

// Without an Intl offset the wall time cannot be shown to fall in a gap, so it is read by date-fns-tz, or as UTC.
const fallbackInstant = (date: string, time: string, zone: string, naive: number): number[] => {
  let ms = Number.NaN;
  try {
    ms = fromZonedTime(`${date}T${time}`, zone).getTime();
  } catch {
    ms = Number.NaN;
  }
  return [Number.isFinite(ms) ? ms : naive];
};
