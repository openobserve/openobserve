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
import {
  autoGranularity,
  granularityOptions,
  periodEndUs,
  retentionPeriods,
  type Period,
} from "@/utils/rum/productAnalyticsModel";
import type { FunnelPair, Granularity } from "@/utils/rum/productAnalyticsQueries";
import type { UsWindow } from "@/utils/rum/funnelCompare";
import type { I18nText } from "@/types/i18n";

const DAY_US = 86_400_000_000;
/** Below this many entrants a bucket's rate gets the low-volume tag. */
export const TREND_LOW_VOLUME = 10;
/** A breakdown's table pivots value × bucket up to this many buckets, and averages past it. */
export const PIVOT_MAX_BUCKETS = 8;
const PAIR_PARAM = /^([1-9][0-9]?)-([1-9][0-9]?)$/;
const REST_ID = "\u0000rest";

export type FunnelView = "steps" | "trend";

/** The calendar buckets a trend is drawn over; `runningIndex` is the bucket holding now. */
export interface TrendPeriods {
  granularity: Period;
  boundariesUs: number[];
  endsUs: number[];
  runningIndex: number | null;
}

export type TrendPeriodsResult = TrendPeriods | { tooShort: true } | { tooMany: true };

export interface TrendBucket {
  index: number;
  startUs: number;
  endUs: number;
  entered: number;
  reached: number;
  rate: number | null;
  empty: boolean;
  beforeData: boolean;
  stillConverting: boolean;
  arriving: boolean;
  lowVolume: boolean;
  partial: boolean;
}

export type TrendSeriesKind = "all" | "value" | "other" | "notSet";

export interface TrendSeries {
  id: string;
  value: string | null;
  kind: TrendSeriesKind;
  buckets: TrendBucket[];
}

/** What decides each bucket's flags besides its own counts. */
export interface TrendContext {
  range: UsWindow;
  nowUs: number;
  dataStartUs: number | null;
  dataThroughUs: number | null;
  /** Users mode's conversion window; null when the unit converts within a session. */
  windowUs: number | null;
}

/** A breakdown value's numbers over the buckets whose window has closed. */
export interface TrendAverage {
  entered: number;
  reached: number;
  rate: number | null;
}

/** A previous-period bucket lined up with this period's bucket of the same index. */
export interface TrendPrevious {
  startUs: number;
  entered: number;
  rate: number | null;
}

/** The previous period's run as the trend view shows it. */
export interface TrendPreviousView {
  status: "loading" | "failed" | "ok";
  buckets: (TrendPrevious | null)[];
  range: string;
  /** The compare mode's name, such as "1 week ago". */
  label: I18nText;
}

export function parsePair(raw: unknown): FunnelPair | null {
  if (typeof raw !== "string") return null;
  const m = PAIR_PARAM.exec(raw);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a < b ? { a, b } : null;
}

export const pairParam = (p: FunnelPair): string => `${p.a}-${p.b}`;

/** A pair the funnel's steps cannot hold falls back to step 1 → the last step. */
export function resolvePair(pair: FunnelPair | null, steps: number): FunnelPair {
  if (pair && pair.a >= 1 && pair.a < pair.b && pair.b <= steps) return pair;
  return { a: 1, b: Math.max(2, steps) };
}

export function parseInterval(raw: unknown): Granularity {
  return raw === "day" || raw === "week" || raw === "month" ? raw : "auto";
}

/** The interval a pick resolves to; a pick the range rules out falls back to Auto. */
export function resolveInterval(
  range: UsWindow,
  tz: string,
  dataStartUs: number | null,
  per: Granularity,
): Period | null {
  const opts = granularityOptions(range.startUs, range.endUs, tz, dataStartUs);
  const picked = per !== "auto" && !opts.find((o) => o.value === per)?.disabled ? per : null;
  return picked ?? autoGranularity(range.startUs, range.endUs, dataStartUs);
}

/** Unclipped buckets, so a bucket before the app's first data still shows as one. */
export function trendPeriods(
  range: UsWindow,
  tz: string,
  nowUs: number,
  g: Period | null,
): TrendPeriodsResult {
  if (!g) return { tooShort: true };
  const p = retentionPeriods(range.startUs, range.endUs, tz, nowUs, null, g);
  if (!("boundariesUs" in p)) return p;
  const b = p.boundariesUs;
  return {
    granularity: p.granularity,
    boundariesUs: b,
    endsUs: b.map((_, i) => (i < b.length - 1 ? b[i + 1] : periodEndUs(b[i], tz, g))),
    runningIndex: p.runningIndex,
  };
}

/** The previous window's buckets at the same interval, so bucket i lines up with bucket i. */
export function previousTrendPeriods(
  prev: UsWindow,
  tz: string,
  nowUs: number,
  g: Period,
): TrendPeriods | null {
  const p = trendPeriods(prev, tz, nowUs, g);
  return "boundariesUs" in p ? p : null;
}

/** Folds the trend run's rows; with a breakdown each value is a series and the rest fold into one. */
export function foldTrend(
  rows: Record<string, unknown>[],
  periods: TrendPeriods,
  ctx: TrendContext,
  breakdown: boolean,
): TrendSeries[] {
  if (!breakdown) return [toSeries("all", null, "all", rows, periods, ctx)];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const id = named(r.dim) ? String(r.dim) : REST_ID;
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  // The SQL ranked values by units at the table's start step, so order and colours match the Steps breakdown.
  const total = (id: string) => Math.max(0, ...(groups.get(id) ?? []).map((r) => num(r.tot)));
  const first = (id: string) => Math.max(0, ...(groups.get(id) ?? []).map((r) => num(r.t1)));
  const ids = [...groups.keys()]
    .filter((id) => id !== REST_ID)
    .sort((x, y) => total(y) - total(x) || first(y) - first(x) || (x < y ? -1 : x > y ? 1 : 0));
  const series = ids.map((id) => toSeries(id, id, "value", groups.get(id)!, periods, ctx));
  const rest = groups.get(REST_ID);
  if (rest) {
    const kind = rest.every((r) => num(r.un) === 1) ? "notSet" : "other";
    series.push(toSeries(REST_ID, null, kind, rest, periods, ctx));
  }
  return series;
}

/** Pools the closed buckets, so a still-converting bucket never drags the average down. */
export function trendAverage(s: TrendSeries): TrendAverage {
  const kept = s.buckets.filter((b) => !b.stillConverting && !b.beforeData);
  const entered = kept.reduce((n, b) => n + b.entered, 0);
  const reached = kept.reduce((n, b) => n + b.reached, 0);
  return { entered, reached, rate: entered > 0 ? reached / entered : null };
}

export function alignPrevious(
  cur: TrendSeries,
  prev: TrendSeries | null,
): (TrendPrevious | null)[] {
  return cur.buckets.map((_, i) => {
    const p = prev?.buckets[i];
    return p ? { startUs: p.startUs, entered: p.entered, rate: p.rate } : null;
  });
}

export const isTrendEmpty = (series: TrendSeries[]): boolean =>
  series.every((s) => s.buckets.every((b) => b.entered === 0));

/** A bucket's label in the viewer's zone: "8 Oct" for days and weeks, "Oct 2026" for months. */
export function bucketLabel(us: number, tz: string, g: Period): string {
  return formatInTimeZone(new Date(us / 1000), tz, g === "month" ? "MMM yyyy" : "d MMM");
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const named = (v: unknown): boolean => v !== null && v !== undefined && v !== "";

const counts = (entered: number, reached: number) => ({
  entered,
  reached,
  rate: entered > 0 ? Math.min(reached, entered) / entered : null,
  empty: entered === 0,
  lowVolume: entered > 0 && entered < TREND_LOW_VOLUME,
});

const toSeries = (
  id: string,
  value: string | null,
  kind: TrendSeriesKind,
  rows: Record<string, unknown>[],
  periods: TrendPeriods,
  ctx: TrendContext,
): TrendSeries => {
  const by = new Map<number, { ca: number; cb: number }>();
  for (const r of rows) {
    const k = num(r.bk);
    const cur = by.get(k) ?? { ca: 0, cb: 0 };
    by.set(k, { ca: cur.ca + num(r.ca), cb: cur.cb + num(r.cb) });
  }
  const buckets = periods.boundariesUs.map((startUs, i) => {
    const c = by.get(i) ?? { ca: 0, cb: 0 };
    return { index: i, startUs, endUs: periods.endsUs[i], ...counts(c.ca, c.cb) };
  });
  return {
    id,
    value,
    kind,
    buckets: buckets.map((b) => ({ ...b, ...bucketFlags(b, periods, ctx) })),
  };
};

const bucketFlags = (
  b: { index: number; startUs: number; endUs: number },
  periods: TrendPeriods,
  ctx: TrendContext,
) => {
  const running = periods.runningIndex === b.index;
  // A unit entering near the bucket's end has until end + window to convert.
  const stillConverting = running || (ctx.windowUs !== null && b.endUs + ctx.windowUs > ctx.nowUs);
  const dt = ctx.dataThroughUs;
  return {
    beforeData: ctx.dataStartUs !== null && b.endUs <= ctx.dataStartUs,
    stillConverting,
    // Only a recent bucket can be waiting on ingest; an old one past the last event is simply empty.
    arriving: dt !== null && b.startUs >= dt && !stillConverting && b.endUs > ctx.nowUs - DAY_US,
    partial: b.startUs < ctx.range.startUs || (!running && b.endUs > ctx.range.endUs),
  };
};
