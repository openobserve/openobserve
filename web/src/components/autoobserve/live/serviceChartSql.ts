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

import { escapeSingleQuotes } from "@/utils/queryUtils";
import { ERROR_LEVELS } from "@/utils/alerts/prefill/fromAutoObserve";
import {
  STEPS,
  type ChartRange,
  type MetricDef,
  type MetricSeries,
  type MetricUnit,
} from "../coverageSeries";
import { SIGNAL_LABEL } from "../fixtures";

export type LiveChartSignal = "requests" | "errors" | "latency";

export type ChartSource = "traces" | "logs";

export type ErrorRule = { kind: "level"; field: string } | { kind: "stderr" };

export interface ServiceChartFacts {
  current: number | null;
  usual: number | null;
  peak: number | null;
  peakAt: number | null;
  missingField: string | null;
}

export type BucketHit = Record<string, unknown>;

export const LIVE_SIGNALS: LiveChartSignal[] = ["requests", "errors", "latency"];

// The first text field present wins, so a stream with several level fields uses the most specific one.
const LEVEL_FIELDS = ["severity_text", "level", "severity", "log_level"];
// lower() fails on a numeric column, and real deployments store severity or level as a number.
const TEXT_TYPES = new Set(["Utf8", "LargeUtf8", "Utf8View"]);
const BUCKET: Record<ChartRange, string> = {
  "1h": "1 minute",
  "24h": "15 minute",
  "7d": "1 hour",
};
const NO_FACTS: ServiceChartFacts = {
  current: null,
  usual: null,
  peak: null,
  peakAt: null,
  missingField: null,
};

export const quoteIdent = (name: string) => `"${name.replace(/"/g, "")}"`;

/** A null value means the field must be absent, as on a service that has no namespace. */
export const filterSql = (filters: Record<string, string | null> | undefined): string =>
  Object.entries(filters ?? {})
    .map(([field, value]) =>
      value === null
        ? `(${quoteIdent(field)} IS NULL OR ${quoteIdent(field)} = '')`
        : `${quoteIdent(field)} = '${escapeSingleQuotes(String(value))}'`,
    )
    .join(" AND ");

export const pickErrorField = (fields: Map<string, string>): ErrorRule | null => {
  const level = LEVEL_FIELDS.find((f) => TEXT_TYPES.has(fields.get(f) ?? ""));
  if (level) return { kind: "level", field: level };
  return TEXT_TYPES.has(fields.get("log_iostream") ?? "") ? { kind: "stderr" } : null;
};

const errorCondition = (rule: ErrorRule) =>
  rule.kind === "stderr"
    ? `"log_iostream" = 'stderr'`
    : `lower(${quoteIdent(rule.field)}) IN (${ERROR_LEVELS.map((l) => `'${l}'`).join(", ")})`;

const bucketSql = (
  stream: string,
  filters: Record<string, string | null>,
  range: ChartRange,
  cols: string[],
) =>
  `SELECT ${[`histogram(_timestamp, '${BUCKET[range]}') AS t`, "count(*) AS n", ...cols].join(", ")} ` +
  `FROM ${quoteIdent(stream)} WHERE ${filterSql(filters)} GROUP BY t ORDER BY t`;

export const tracesSql = (
  stream: string,
  filters: Record<string, string | null>,
  range: ChartRange,
  want: { errors: boolean; latency: boolean },
) =>
  bucketSql(stream, filters, range, [
    ...(want.errors ? ["count(*) FILTER (WHERE span_status = 'ERROR') AS e"] : []),
    ...(want.latency ? ["approx_percentile_cont(duration, 0.95) AS p95"] : []),
  ]);

export const logsSql = (
  stream: string,
  filters: Record<string, string | null>,
  range: ChartRange,
  rule: ErrorRule | null,
) =>
  bucketSql(
    stream,
    filters,
    range,
    rule ? [`count(*) FILTER (WHERE ${errorCondition(rule)}) AS e`] : [],
  );

// The window ends at the last full bucket, so the newest point is never a bucket still filling up.
export const chartWindow = (range: ChartRange, nowMs: number) => {
  const { count, stepMs } = STEPS[range];
  const end = Math.floor(nowMs / stepMs) * stepMs;
  return { start: end - count * stepMs, end, last: end - stepMs };
};

export const unitOf = (signal: LiveChartSignal, source: ChartSource): MetricUnit => {
  if (signal === "latency") return "ms";
  return signal === "errors" && source === "traces" ? "percent" : "perMin";
};

const num = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const valueOf = (signal: LiveChartSignal, source: ChartSource, range: ChartRange) => {
  const minutes = STEPS[range].stepMs / 60_000;
  return (hit: BucketHit): number | null => {
    const n = num(hit.n) ?? 0;
    if (signal === "requests") return n / minutes;
    if (signal === "latency") {
      const p95 = num(hit.p95);
      return p95 == null ? null : p95 / 1000;
    }
    const e = num(hit.e) ?? 0;
    if (source === "logs") return e / minutes;
    return n ? (100 * e) / n : 0;
  };
};

// Search answers a histogram bucket as a zone-less UTC string, or as epoch microseconds.
const bucketMs = (t: unknown): number | null => {
  if (typeof t === "number") return t > 1e14 ? Math.floor(t / 1000) : t;
  if (typeof t !== "string") return null;
  const ms = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(t) ? t : `${t}Z`);
  return Number.isNaN(ms) ? null : ms;
};

const round = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Number(v.toPrecision(3)));

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const toSeries = (
  hits: BucketHit[],
  range: ChartRange,
  nowMs: number,
  pick: (hit: BucketHit) => number | null,
  missing: 0 | null,
): { series: MetricSeries; facts: ServiceChartFacts; hasData: boolean } => {
  const { count, stepMs } = STEPS[range];
  const { start } = chartWindow(range, nowMs);
  const byBucket = new Map<number, number | null>();
  for (const hit of hits) {
    const ms = bucketMs(hit.t);
    if (ms == null) continue;
    const i = Math.floor((ms - start) / stepMs);
    if (i >= 0 && i < count) byBucket.set(start + i * stepMs, pick(hit));
  }
  const points = Array.from({ length: count }, (_, i): [number, number | null] => {
    const ms = start + i * stepMs;
    const value = byBucket.get(ms);
    return [ms, value == null ? missing : round(value)];
  });
  const measured = points.filter((p): p is [number, number] => p[1] != null);
  const present = [...byBucket.values()].filter((v): v is number => v != null).map(round);
  const peak = measured.reduce<[number, number] | null>(
    (best, p) => (best == null || p[1] > best[1] ? p : best),
    null,
  );
  const facts: ServiceChartFacts = present.length
    ? {
        current: points[count - 1][1],
        usual: round(median(present)),
        peak: peak?.[1] ?? null,
        peakAt: peak?.[0] ?? null,
        missingField: null,
      }
    : { ...NO_FACTS };
  return {
    series: {
      points,
      band: null,
      anomalies: [],
      current: points[count - 1][1],
      previous: points[0][1],
      low: null,
      high: null,
    },
    facts,
    hasData: present.length > 0,
  };
};

export const emptySeries = (): MetricSeries => ({
  points: [],
  band: null,
  anomalies: [],
  current: null,
  previous: null,
  low: null,
  high: null,
});

export const noFacts = (missingField: string | null = null): ServiceChartFacts => ({
  ...NO_FACTS,
  missingField,
});

export const liveMetricDef = (
  signal: LiveChartSignal,
  unit: MetricUnit,
  threshold: number | null = null,
): MetricDef => ({
  signal,
  titleKey: SIGNAL_LABEL[signal],
  unit,
  base: 0,
  spread: 0,
  ...(threshold !== null ? { threshold } : {}),
});
