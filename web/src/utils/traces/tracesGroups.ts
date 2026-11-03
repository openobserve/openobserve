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

import { withScope } from "@/utils/traces/tracesScope";

// The server stops a query without LIMIT at its default row cap, so every Groups query carries its own.
export const GROUPS_LIMIT = 50;

const SPARK_BUCKETS = 24;

// histogram() bins from date_bin's origin, 2001-01-01T00:00:00Z (config/src/meta/histogram_origin.rs).
const HISTOGRAM_ORIGIN_US = 978_307_200_000_000;

export type GroupsSortKey = "value" | "spans" | "errors" | "error_pct" | "p50" | "p95" | "p99";

export const GROUPS_SORT_KEYS: readonly GroupsSortKey[] = [
  "value",
  "spans",
  "errors",
  "error_pct",
  "p50",
  "p95",
  "p99",
];

export interface GroupsSort {
  by: GroupsSortKey;
  order: "asc" | "desc";
}

export const DEFAULT_GROUPS_SORT: GroupsSort = { by: "errors", order: "desc" };

export type GroupValue = string | number | boolean | null;

export interface GroupRow {
  value: GroupValue;
  spans: number;
  errors: number;
  errorPct: number;
  p50: number;
  p95: number;
  p99: number;
}

/** The key, the filter as the list resolves it and the scope condition, over one stream. */
export interface GroupsQueryInput {
  stream: string;
  key: string;
  filter: string;
  scope: string;
}

/** The sparkline histogram's interval and its first bucket, so rows land in fixed slots. */
export interface SparklinePlan {
  intervalSec: number;
  alignedStartUs: number;
  bucketCount: number;
}

export function isGroupsSortKey(value: unknown): value is GroupsSortKey {
  return GROUPS_SORT_KEYS.includes(value as GroupsSortKey);
}

export function isDefaultGroupsSort(sort: GroupsSort): boolean {
  return sort.by === DEFAULT_GROUPS_SORT.by && sort.order === DEFAULT_GROUPS_SORT.order;
}

export function encodeGroupsSort(sort: GroupsSort): string {
  return `${sort.by}:${sort.order}`;
}

/** Reads `<column>:<asc|desc>`; null for anything else. */
export function decodeGroupsSort(value: unknown): GroupsSort | null {
  if (typeof value !== "string") return null;
  const [by, order] = value.split(":");
  if (!isGroupsSortKey(by) || (order !== "asc" && order !== "desc")) return null;
  return { by, order };
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const sqlString = (value: string | number | boolean) => `'${String(value).replace(/'/g, "''")}'`;

const whereOf = (filter: string) => (filter ? ` WHERE ${filter}` : "");

function orderBy(sort: GroupsSort): string {
  const dir = sort.order.toUpperCase();
  if (sort.by === "value") return `value ${dir}`;
  if (sort.by === "spans") return `spans ${dir}`;
  const expr = sort.by === "error_pct" ? "errors * 1.0 / spans" : sort.by;
  // Many keys tie on errors (often zero), so the busier one wins the top 50.
  return `${expr} ${dir}, spans DESC`;
}

/** RED per value of one field: the Groups table's rows. */
export function buildGroupsSql(input: GroupsQueryInput & { sort: GroupsSort }): string {
  const key = quoteIdentifier(input.key);
  const filter = withScope(input.filter, input.scope);
  return (
    `SELECT ${key} AS value, count(*) AS spans, ` +
    "count(*) FILTER (WHERE span_status = 'ERROR') AS errors, " +
    "approx_percentile_cont(duration, 0.5) AS p50, " +
    "approx_percentile_cont(duration, 0.95) AS p95, " +
    "approx_percentile_cont(duration, 0.99) AS p99 " +
    `FROM ${quoteIdentifier(input.stream)}${whereOf(filter)} GROUP BY ${key} ` +
    `ORDER BY ${orderBy(input.sort)} LIMIT ${GROUPS_LIMIT}`
  );
}

export function sparklinePlan(startUs: number, endUs: number): SparklinePlan {
  const intervalSec = Math.max(1, Math.ceil((endUs - startUs) / 1_000_000 / SPARK_BUCKETS));
  const intervalUs = intervalSec * 1_000_000;
  const alignedStartUs =
    HISTOGRAM_ORIGIN_US + Math.floor((startUs - HISTOGRAM_ORIGIN_US) / intervalUs) * intervalUs;
  return {
    intervalSec,
    alignedStartUs,
    bucketCount: Math.max(1, Math.ceil((endUs - alignedStartUs) / intervalUs)),
  };
}

/** Span counts over time for the given values; histogram must lead the SELECT or the server rejects the grouping. */
export function buildGroupsSparklineSql(
  input: GroupsQueryInput & { values: GroupValue[]; plan: SparklinePlan },
): string {
  const key = quoteIdentifier(input.key);
  const listed = input.values.filter((v): v is string | number | boolean => v !== null);
  const parts: string[] = [];
  if (listed.length) parts.push(`${key} IN (${listed.map(sqlString).join(", ")})`);
  if (listed.length < input.values.length) parts.push(`${key} IS NULL`);
  const filter = withScope(withScope(input.filter, input.scope), `(${parts.join(" OR ")})`);
  return (
    `SELECT histogram(_timestamp, '${input.plan.intervalSec} seconds') AS ts, ${key} AS value, ` +
    `count(*) AS spans FROM ${quoteIdentifier(input.stream)}${whereOf(filter)} ` +
    `GROUP BY ts, value ORDER BY ts LIMIT ${GROUPS_LIMIT * input.plan.bucketCount}`
  );
}

const bucketTimeUs = (ts: unknown): number => {
  if (typeof ts === "number") return ts;
  const text = String(ts ?? "");
  // The histogram column is a UTC time without a zone suffix.
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`) * 1000;
};

/** One count per bucket for each value; a bucket with no spans is a real zero. */
export function sparklineSeries(
  hits: Record<string, unknown>[],
  plan: SparklinePlan,
): Map<GroupValue, number[]> {
  const intervalUs = plan.intervalSec * 1_000_000;
  const series = new Map<GroupValue, number[]>();
  for (const hit of hits) {
    const index = Math.round((bucketTimeUs(hit.ts) - plan.alignedStartUs) / intervalUs);
    if (!Number.isFinite(index) || index < 0 || index >= plan.bucketCount) continue;
    const value = (hit.value ?? null) as GroupValue;
    if (!series.has(value)) series.set(value, new Array(plan.bucketCount).fill(0));
    series.get(value)![index] += Number(hit.spans) || 0;
  }
  return series;
}

/** Approximate number of values the key has under the same filter, for the footer. */
export function buildGroupsDistinctSql(input: GroupsQueryInput): string {
  const filter = withScope(input.filter, input.scope);
  return `SELECT approx_distinct(${quoteIdentifier(input.key)}) AS n FROM ${quoteIdentifier(input.stream)}${whereOf(filter)}`;
}

export function toGroupRows(hits: Record<string, unknown>[]): GroupRow[] {
  return hits.map((hit) => {
    const spans = Number(hit.spans) || 0;
    const errors = Number(hit.errors) || 0;
    return {
      value: (hit.value ?? null) as GroupValue,
      spans,
      errors,
      errorPct: spans ? (errors / spans) * 100 : 0,
      p50: Number(hit.p50) || 0,
      p95: Number(hit.p95) || 0,
      p99: Number(hit.p99) || 0,
    };
  });
}

export function isNoValue(value: GroupValue | undefined): boolean {
  return value === null || value === undefined || value === "";
}

/** The filter text for one group; the (no value) group holds both null and empty values. */
export function groupTerm(key: string, value: GroupValue, action: "include" | "exclude"): string {
  if (isNoValue(value)) {
    return action === "include"
      ? `(${key} IS NULL OR ${key} = '')`
      : `(${key} IS NOT NULL AND ${key} != '')`;
  }
  return `${key} ${action === "include" ? "=" : "!="} ${sqlString(value as string)}`;
}
