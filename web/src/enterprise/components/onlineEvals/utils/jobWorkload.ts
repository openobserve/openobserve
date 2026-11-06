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

/**
 * An eval job as a workload (AIO-25): score lag and throughput from
 * `_llm_scores`, judge errors and spend from `_evaluator`, bucketed over the
 * drawer's window; and "Scores stopped", which compares the scores the job
 * wrote with the traces its filter matched.
 */

import type { EvalTargetScope } from "@/services/online-evals.service";
import { countExpression, quoteIdent } from "../composables/useJobMatchedTargets";

const MINUTE_US = 60_000_000;
/** Bucket widths the charts step through, smallest first. */
const BUCKETS: { minutes: number; interval: string }[] = [
  { minutes: 1, interval: "1 minute" },
  { minutes: 5, interval: "5 minute" },
  { minutes: 10, interval: "10 minute" },
  { minutes: 30, interval: "30 minute" },
  { minutes: 60, interval: "1 hour" },
  { minutes: 180, interval: "3 hour" },
  { minutes: 360, interval: "6 hour" },
  { minutes: 720, interval: "12 hour" },
  { minutes: 1440, interval: "1 day" },
];
const MAX_BUCKETS = 60;

/** The smallest bucket that keeps the window to about 60 points. */
export function workloadBucket(startUs: number, endUs: number) {
  const minutes = (endUs - startUs) / MINUTE_US;
  return BUCKETS.find((b) => minutes / b.minutes <= MAX_BUCKETS) ?? BUCKETS[BUCKETS.length - 1];
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const SCORER_ROWS =
  "attributes_scorer_id IS NOT NULL AND attributes_scorer_id != '' " +
  "AND attributes_status IN ('success', 'error', 'timeout')";

/** Scores written per bucket and their p95 lag (score written − target time), in µs. */
export function scoreSeriesSql(jobId: string, interval: string): string {
  return [
    `SELECT histogram(_timestamp, '${interval}') AS bucket, count(*) AS scores,`,
    "  approx_percentile_cont(_timestamp - ref_timestamp, 0.95) AS lag_p95_us",
    'FROM "_llm_scores"',
    `WHERE job_id = ${quote(jobId)} AND (status IS NULL OR status = 'success')`,
    "GROUP BY bucket ORDER BY bucket",
  ].join("\n");
}

/**
 * Judge calls per bucket and outcome; failures by error kind. The kind column
 * appears with a stream's first failure, so `withKind: false` groups failures
 * by status for a stream that has none yet.
 */
export function judgeOutcomeSql(jobId: string, interval: string, withKind = true): string {
  const failure = withKind
    ? "COALESCE(attributes_error_kind, attributes_status)"
    : "attributes_status";
  return [
    `SELECT histogram(_timestamp, '${interval}') AS bucket,`,
    `  CASE WHEN attributes_status = 'success' THEN '' ELSE ${failure} END AS kind, count(*) AS calls`,
    'FROM "_evaluator"',
    `WHERE attributes_job_id = ${quote(jobId)} AND ${SCORER_ROWS}`,
    "GROUP BY bucket, kind ORDER BY bucket",
  ].join("\n");
}

/** Judge spend per bucket, in USD. */
export function judgeSpendSql(jobId: string, interval: string): string {
  return [
    `SELECT histogram(_timestamp, '${interval}') AS bucket, sum(gen_ai_usage_cost) AS cost`,
    'FROM "_evaluator"',
    `WHERE attributes_job_id = ${quote(jobId)}`,
    "GROUP BY bucket ORDER BY bucket",
  ].join("\n");
}

/** The newest score the job wrote. */
export function lastScoreSql(jobId: string): string {
  return `SELECT max(_timestamp) AS last_us FROM "_llm_scores" WHERE job_id = ${quote(jobId)}`;
}

/**
 * Targets the job's filter matched, at its scope; null when the stream (with
 * schema `fields`) cannot be counted at it.
 */
export function matchedSinceSql(
  stream: string,
  where: string,
  scope: EvalTargetScope,
  fields: readonly string[],
): string | null {
  const count = countExpression(scope, fields);
  if (!count) return null;
  return [
    `SELECT ${count} AS cnt FROM ${quoteIdent(stream)}`,
    where.trim() ? `WHERE ${where.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Histogram buckets arrive as µs or ISO strings; charts plot ms. */
export function bucketMs(bucket: unknown): number {
  if (typeof bucket === "number") return bucket > 1e14 ? Math.round(bucket / 1000) : bucket;
  if (typeof bucket === "string") {
    const parsed = Date.parse(bucket.endsWith("Z") || bucket.includes("+") ? bucket : `${bucket}Z`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export type Point = [number, number | null];

export interface ErrorSeries {
  /** Error rate per bucket, % of judge calls, one series per error kind. */
  byKind: Record<string, Point[]>;
  /** Failed calls per kind over the window, most first. */
  totals: { kind: string; calls: number }[];
}

export function errorSeries(rows: any[]): ErrorSeries {
  const calls = new Map<number, number>();
  for (const r of rows) {
    const at = bucketMs(r.bucket);
    calls.set(at, (calls.get(at) ?? 0) + (Number(r.calls) || 0));
  }
  const byKind: Record<string, Point[]> = {};
  const totals = new Map<string, number>();
  for (const r of rows) {
    const kind = String(r.kind ?? "");
    if (!kind) continue;
    const at = bucketMs(r.bucket);
    const n = Number(r.calls) || 0;
    (byKind[kind] ??= []).push([at, (100 * n) / (calls.get(at) || 1)]);
    totals.set(kind, (totals.get(kind) ?? 0) + n);
  }
  return {
    byKind,
    totals: [...totals].map(([kind, n]) => ({ kind, calls: n })).sort((a, b) => b.calls - a.calls),
  };
}

/** Scores stop being late and start being missing after this long. */
export const SCORES_STOPPED_AFTER_MIN = 30;
/**
 * Expected scores (matched × rate) before missing ones mean anything: at 3, a
 * job sampling 10% goes 30 matched traces without a score about 4% of the time.
 * Small jobs are judged by their own rate, not by a minimum run count.
 */
export const SCORES_STOPPED_MIN_EXPECTED = 3;

/**
 * Where the "Scores stopped" count starts: the newest score, or a day ago when
 * there is none, but never before the job's last edit or transition. A paused
 * job is not expected to score, so a resume restarts the count.
 */
export function stoppedSinceUs(opts: {
  lastScoreUs: number;
  updatedUs: number;
  nowUs: number;
}): number {
  const fallbackUs = opts.nowUs - 24 * 60 * MINUTE_US;
  return Math.max(opts.lastScoreUs || fallbackUs, opts.updatedUs);
}

/**
 * No score since `sinceUs` while the filter kept matching. `matched` counts
 * targets from `sinceUs` until the completion window before now, since newer
 * ones cannot have been scored yet.
 */
export function scoresStopped(opts: {
  sinceUs: number;
  nowUs: number;
  matched: number;
  rate: number;
}): boolean {
  return (
    opts.nowUs - opts.sinceUs >= SCORES_STOPPED_AFTER_MIN * MINUTE_US &&
    opts.matched * opts.rate >= SCORES_STOPPED_MIN_EXPECTED
  );
}
