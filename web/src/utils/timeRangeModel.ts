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

import { sub } from "date-fns";
import {
  buildCalendarToken,
  parseCalendarToken,
  resolveCalendarPeriod,
  type CalendarUnit,
} from "@/utils/dashboard/calendarPeriods";
import { parseRollingPeriod } from "@/utils/dateTimeRangeParse";
import type { WeekDay } from "@/utils/weekStart";

// A fixed range may run into the future (in progress), but never further than this.
export const MAX_FUTURE_US = 10 * 366 * 86_400_000_000;

const ROLLING_UNITS: Record<string, keyof Duration | "weeks"> = {
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
  w: "weeks",
  M: "months",
  y: "years",
};
// Epoch numbers in a link: seconds, ms, µs or ns by digit count.
const EPOCH_SCALE: Record<number, number> = { 10: 1e6, 13: 1e3, 16: 1, 19: 1e-3 };

export type TimeRange =
  | { kind: "rolling"; span: string }
  | { kind: "calendar"; unit: CalendarUnit; offset: number }
  | { kind: "fixed"; startUs: number; endUs: number };

export type TimeRangeKind = TimeRange["kind"];

export type TimeRangeHostPreset = "explorer-manual" | "explorer-auto" | "dashboard" | "form";

export type TimeRangeState = "live" | "calendar-ended" | "fixed-in-progress" | "fixed-ended";

export interface TimeRangeContext {
  nowUs: number;
  zone: string;
  weekStart: WeekDay;
  locale: string;
  fiscalYearStartMonth: number | null;
}

export interface TimeRangeCapabilities {
  kinds?: TimeRangeKind[];
  future?: boolean;
  wholeDays?: boolean;
}

export interface TimeRangeApplyMeta {
  source: "panel" | "step" | "zoom-out" | "drag-zoom" | "undo" | "live" | "freeze";
  run: boolean;
  undoRuns?: boolean;
}

export interface LegacyDateTime {
  startTime: number;
  endTime: number;
  relativeTimePeriod: string | null;
  valueType: "relative" | "absolute";
}

interface Duration {
  seconds: number;
  minutes: number;
  hours: number;
  days: number;
  months: number;
  years: number;
}

export const ALL_KINDS: readonly TimeRangeKind[] = ["rolling", "calendar", "fixed"];

export const resolveRange = (
  range: TimeRange,
  ctx: TimeRangeContext,
): { startUs: number; endUs: number } => {
  if (range.kind === "fixed") return { startUs: range.startUs, endUs: range.endUs };
  const nowMs = Math.floor(ctx.nowUs / 1000);
  if (range.kind === "calendar") {
    const token = buildCalendarToken(range.unit, range.offset);
    const resolved = resolveCalendarPeriod(token, ctx.zone, nowMs, ctx.weekStart);
    // A calendar period that is still running ends at now, to the microsecond the caller gave.
    if (resolved) {
      return {
        startUs: resolved.startTime,
        endUs: range.offset === 0 ? ctx.nowUs : resolved.endTime,
      };
    }
    return { startUs: ctx.nowUs, endUs: ctx.nowUs };
  }
  return { startUs: rollingStartUs(range.span, ctx.nowUs), endUs: ctx.nowUs };
};

export const queryWindow = (
  range: TimeRange,
  ctx: TimeRangeContext,
): { startUs: number; endUs: number } => {
  const { startUs, endUs } = resolveRange(range, ctx);
  return { startUs, endUs: Math.min(endUs, ctx.nowUs) };
};

export const rangeState = (range: TimeRange, ctx: TimeRangeContext): TimeRangeState => {
  if (range.kind === "rolling") return "live";
  if (range.kind === "calendar") return range.offset === 0 ? "live" : "calendar-ended";
  return range.endUs > ctx.nowUs ? "fixed-in-progress" : "fixed-ended";
};

export const sameRange = (a: TimeRange | null, b: TimeRange | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === "rolling" && b.kind === "rolling") return a.span === b.span;
  if (a.kind === "calendar" && b.kind === "calendar") {
    return a.unit === b.unit && a.offset === b.offset;
  }
  if (a.kind === "fixed" && b.kind === "fixed") {
    return a.startUs === b.startUs && a.endUs === b.endUs;
  }
  return false;
};

export const isValidRange = (
  range: TimeRange,
  nowUs: number,
  caps: TimeRangeCapabilities = {},
): boolean => {
  if (range.kind === "rolling") return parseRollingPeriod(range.span) !== null;
  if (range.kind === "calendar") {
    return parseCalendarToken(buildCalendarToken(range.unit, range.offset)) !== null;
  }
  const { startUs, endUs } = range;
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || startUs >= endUs) return false;
  if (endUs > nowUs + MAX_FUTURE_US) return false;
  return caps.future === true || startUs <= nowUs;
};

export const isRangeAllowed = (range: TimeRange, caps: TimeRangeCapabilities = {}): boolean =>
  (caps.kinds ?? ALL_KINDS).includes(range.kind);

export const rangeToQuery = (
  range: TimeRange,
): Record<"period" | "from" | "to", string | undefined> => {
  if (range.kind === "fixed") {
    return { period: undefined, from: String(range.startUs), to: String(range.endUs) };
  }
  return { period: rangeToken(range), from: undefined, to: undefined };
};

export const rangeFromQuery = (
  query: Record<string, unknown>,
  nowUs: number,
  caps: TimeRangeCapabilities = {},
): TimeRange | "invalid" | null => {
  const period = firstString(query.period);
  const from = firstString(query.from);
  const to = firstString(query.to);
  let range: TimeRange | null = null;
  if (from !== null || to !== null) {
    const startUs = from === null ? null : readInstantUs(from);
    const endUs = to === null ? null : readInstantUs(to);
    if (startUs === null || endUs === null) return "invalid";
    range = { kind: "fixed", startUs, endUs };
  } else if (period !== null) {
    range = rangeFromToken(period);
    if (range === null) return "invalid";
  } else {
    return null;
  }
  return isValidRange(range, nowUs, caps) && isRangeAllowed(range, caps) ? range : "invalid";
};

export const rangeToLegacy = (range: TimeRange, ctx: TimeRangeContext): LegacyDateTime => {
  const { startUs, endUs } = resolveRange(range, ctx);
  return {
    startTime: startUs,
    endTime: endUs,
    relativeTimePeriod: range.kind === "fixed" ? null : rangeToken(range),
    valueType: range.kind === "fixed" ? "absolute" : "relative",
  };
};

export const rangeFromLegacy = (value: {
  type?: string;
  valueType?: string;
  startTime?: number;
  endTime?: number;
  relativeTimePeriod?: string | null;
  period?: string | null;
}): TimeRange | null => {
  const type = value.valueType ?? value.type;
  if (type === "absolute") {
    const startUs = Number(value.startTime);
    const endUs = Number(value.endTime);
    return Number.isFinite(startUs) && Number.isFinite(endUs) && startUs < endUs
      ? { kind: "fixed", startUs, endUs }
      : null;
  }
  const token = value.relativeTimePeriod ?? value.period;
  return typeof token === "string" && token ? rangeFromToken(token) : null;
};

/** The URL and storage token of a rolling or calendar range: `15m`, `calendar:quarter:-1`. */
export const rangeToken = (range: Exclude<TimeRange, { kind: "fixed" }>): string =>
  range.kind === "rolling" ? range.span : buildCalendarToken(range.unit, range.offset);

export const rangeFromToken = (token: string): TimeRange | null => {
  const calendar = parseCalendarToken(token);
  if (calendar) return { kind: "calendar", unit: calendar.unit, offset: calendar.offset };
  return parseRollingPeriod(token) ? { kind: "rolling", span: token } : null;
};

const rollingStartUs = (span: string, nowUs: number): number => {
  const rolling = parseRollingPeriod(span);
  if (!rolling) return nowUs;
  const unit = ROLLING_UNITS[rolling.unit];
  if (!unit) return nowUs;
  const subtraction = unit === "weeks" ? { days: rolling.value * 7 } : { [unit]: rolling.value };
  const nowMs = Math.floor(nowUs / 1000);
  // Sub-millisecond digits of now are kept so a span is exactly its length.
  return sub(new Date(nowMs), subtraction).getTime() * 1000 + (nowUs - nowMs * 1000);
};

const firstString = (value: unknown): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === "number" && Number.isFinite(first)) return String(first);
  return typeof first === "string" && first.trim() ? first.trim() : null;
};

const readInstantUs = (text: string): number | null => {
  if (/^\d+$/.test(text)) {
    const scale = EPOCH_SCALE[text.length];
    return scale ? Math.round(Number(text) * scale) : null;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms * 1000 : null;
};
