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

import {
  buildCountChartQuery,
  cleanAggregationQuery,
} from "@/utils/alerts/aggregationPreviewQuery";

/** One period of the rule's measurement: bucket start (epoch ms) and its value. */
export interface Bucket {
  time: number;
  value: number;
}

/** Row count rules vs value/aggregate rules; they are fitted differently. */
export type RuleKind = "count" | "value";

/** How much history the stream holds, which decides what can honestly be shown. */
export type HistoryState = "ok" | "short" | "none";

export interface BacktestResult {
  episodes: number;
  at: number[];
}

export interface HistoryScore {
  history: HistoryState;
  suggested: number | null;
  usualHigh: number | null;
  backtestFor: (threshold: number | null) => BacktestResult | null;
}

export interface HistoryInput {
  buckets: Bucket[];
  now: number;
  historyStart: number;
  kind: RuleKind;
  operator: string;
  silenceMinutes: number;
  periodMinutes: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MIN_HISTORY_MS = HOUR_MS;
const FULL_HISTORY_MS = 2 * DAY_MS;
const MIN_COUNT_SUGGESTION = 5;
const RISING_OPERATORS = new Set([">=", ">"]);

const byTime = (a: Bucket, b: Bucket) => a.time - b.time;

/** Nearest-rank percentile `p` (0..1) of `values`, or null when empty. */
export const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
};

/** Whether `value` crosses `threshold` under the alert's operator. */
export const breaches = (value: number, operator: string, threshold: number): boolean => {
  switch (operator) {
    case ">":
      return value > threshold;
    case "<=":
      return value <= threshold;
    case "<":
      return value < threshold;
    case "=":
      return value === threshold;
    case "!=":
      return value !== threshold;
    default:
      return value >= threshold;
  }
};

/** Suggested limit from the fitting buckets, or null when there are none. */
export const suggestThreshold = (buckets: Bucket[], kind: RuleKind): number | null => {
  const values = buckets.map((b) => b.value);
  if (kind === "count") {
    const p90 = percentile(values, 0.9);
    return p90 === null ? null : Math.max(MIN_COUNT_SUGGESTION, Math.ceil(2.5 * p90));
  }
  const p99 = percentile(values, 0.99);
  // Rounded up so the shown limit never sits below the fitted percentile.
  return p99 === null ? null : Math.ceil(p99 * 100) / 100;
};

/** Fit on everything older than the last 24 h, test on the last 24 h (out of sample). */
export const splitFitTest = (buckets: Bucket[], now: number) => {
  const testStart = now - DAY_MS;
  const sorted = [...buckets].sort(byTime);
  return {
    fit: sorted.filter((b) => b.time < testStart),
    test: sorted.filter((b) => b.time >= testStart),
  };
};

/** Episodes the rule would have fired: a breach in the next period or within `silenceMinutes` of the last one is the same episode. */
export const backtest = (
  buckets: Bucket[],
  operator: string,
  threshold: number,
  silenceMinutes: number,
  periodMinutes: number,
): BacktestResult => {
  const mergeMs = Math.max(0, silenceMinutes, periodMinutes) * MINUTE_MS;
  const at: number[] = [];
  let lastBreach = -Infinity;
  for (const bucket of [...buckets].sort(byTime)) {
    if (!breaches(bucket.value, operator, threshold)) continue;
    if (bucket.time - lastBreach > mergeMs) at.push(bucket.time);
    lastBreach = bucket.time;
  }
  return { episodes: at.length, at };
};

/** Count buckets on a fixed `stepMs` grid from `start` to `end`; a period with no rows counted zero. */
export const fillCountBuckets = (
  buckets: Bucket[],
  start: number,
  end: number,
  stepMs: number,
): Bucket[] => {
  const byBucket = new Map<number, number>();
  for (const b of buckets) {
    const key = Math.floor(b.time / stepMs) * stepMs;
    byBucket.set(key, (byBucket.get(key) ?? 0) + b.value);
  }
  const filled: Bucket[] = [];
  for (let time = Math.floor(start / stepMs) * stepMs; time < end; time += stepMs) {
    filled.push({ time, value: byBucket.get(time) ?? 0 });
  }
  return filled;
};

/** Epoch ms of a histogram key: a zone-less string is UTC, a number is s, ms or µs. */
export const parseBucketTime = (key: unknown): number => {
  if (typeof key === "number") {
    if (key > 1e14) return Math.floor(key / 1000);
    return key > 1e11 ? key : key * 1000;
  }
  const text = String(key ?? "");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
  return Date.parse(zoned);
};

/** The rule's query bucketed by its period, with no HAVING so a threshold edit keeps the same query; null when it can't be bucketed. */
export const buildHistoryQuery = (sql: string, periodMinutes: number): string | null => {
  if (!sql?.trim()) return null;
  const bucketed = /^\s*SELECT\s+\*\s/i.test(sql)
    ? buildCountChartQuery(sql)
    : cleanAggregationQuery(sql);
  if (!bucketed) return null;
  const interval = `'${Math.max(1, Math.round(periodMinutes))} minute'`;
  return bucketed
    .replace(/\bhistogram\s*\(\s*([\w"]+)\s*(?:,\s*'[^']*'\s*)?\)/i, `histogram($1, ${interval})`)
    .replace(/\s+LIMIT\s+\d+\s*$/i, "");
};

/** Suggestion and a re-scorable back-test for one rule's history. */
export const scoreHistory = (input: HistoryInput): HistoryScore => {
  const span = input.now - input.historyStart;
  const history: HistoryState =
    span < MIN_HISTORY_MS || !input.buckets.length
      ? "none"
      : span < FULL_HISTORY_MS
        ? "short"
        : "ok";
  if (history === "none") {
    return { history, suggested: null, usualHigh: null, backtestFor: () => null };
  }
  const { fit, test } = splitFitTest(input.buckets, input.now);
  const fitting = history === "short" ? [...fit, ...test] : fit;
  const rising = RISING_OPERATORS.has(input.operator);
  const usualHigh = percentile(
    fitting.map((b) => b.value),
    0.9,
  );
  return {
    history,
    suggested: rising ? suggestThreshold(fitting, input.kind) : null,
    usualHigh,
    backtestFor: (threshold) =>
      history === "ok" && threshold !== null && Number.isFinite(threshold)
        ? backtest(test, input.operator, threshold, input.silenceMinutes, input.periodMinutes)
        : null,
  };
};
