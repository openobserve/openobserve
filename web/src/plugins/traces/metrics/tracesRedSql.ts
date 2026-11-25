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

import type { SpanSet } from "@/utils/traces/tracesSql";
import { HEATMAP_ROW_LIMIT, buildLatencyHeatmapSql, parseBucketUs } from "./latencyHeatmap";

export interface RedInterval {
  sql: string;
  seconds: number;
}

export interface RedQuery {
  sql: string;
  size: number;
}

/** One zero-filled bucket of the combined Rate and Errors query. */
export interface RedPoint {
  time_bucket: string;
  spans: number;
  errors: number;
}

// size -1 stops at 1,000 rows, and histogram() at -999 loses data, so only the modulo bucket sends -999.
const ONE_PARTITION_SIZE = -999;
const DEFAULT_SIZE = -1;

/** Every span of a stream, for the frame's Show all spans. */
export function streamSpanSet(stream: string): SpanSet {
  return {
    kind: "set",
    subject: "stream",
    with: "",
    from: `"${stream.replaceAll('"', '""')}"`,
    where: "",
    dropped: [],
    keepsSubquery: false,
  };
}

/** One query for Rate and Errors over the span set; its WHERE appears once. */
export function buildRedSql(set: SpanSet, interval: RedInterval): RedQuery {
  const where = set.where ? ` WHERE (${set.where})` : "";
  // One row per bucket, so the heatmap's row cap covers every bucket the range can have.
  const sql =
    `${withPrefix(set)}SELECT ${bucketExpr(set, interval)} AS time_bucket, count(*) AS spans, ` +
    `count(*) FILTER (WHERE span_status = 'ERROR') AS errors FROM ${set.from}${where} ` +
    `GROUP BY time_bucket ORDER BY time_bucket ASC LIMIT ${HEATMAP_ROW_LIMIT}`;
  return { sql, size: sizeOf(set) };
}

/** The Duration heatmap over the same FROM and WHERE as Rate and Errors. */
export function buildSpanSetHeatmapSql(set: SpanSet, interval: RedInterval): RedQuery {
  const sql = buildLatencyHeatmapSql(
    "",
    set.where ? [`(${set.where})`] : [],
    interval.sql,
    set.from,
    bucketExpr(set, interval),
  );
  return { sql: `${withPrefix(set)}${sql}`, size: sizeOf(set) };
}

/** Rate and Errors draw every bucket of the range, so a bucket with no spans is a zero, not a gap. */
export function fillRedBuckets(
  hits: Record<string, unknown>[],
  intervalSec: number,
  startUs: number,
  endUs: number,
): RedPoint[] {
  const intervalUs = intervalSec * 1_000_000;
  const byBucket = new Map<number, Record<string, unknown>>();
  for (const hit of hits) byBucket.set(parseBucketUs(hit.time_bucket), hit);
  const points: RedPoint[] = [];
  for (let t = Math.floor(startUs / intervalUs) * intervalUs; t < endUs; t += intervalUs) {
    const hit = byBucket.get(t);
    points.push({
      time_bucket: new Date(t / 1000).toISOString().slice(0, 19),
      spans: Number(hit?.spans ?? 0),
      errors: Number(hit?.errors ?? 0),
    });
  }
  return points;
}

function withPrefix(set: SpanSet): string {
  return set.with ? `${set.with} ` : "";
}

// HistogramIntervalVisitor matches only histogram(), so a modulo bucket keeps the query one partition.
function bucketExpr(set: SpanSet, interval: RedInterval): string {
  if (!set.keepsSubquery) return `histogram(_timestamp, '${interval.sql}')`;
  const n = interval.seconds * 1_000_000;
  return `_timestamp - (_timestamp % ${n})`;
}

function sizeOf(set: SpanSet): number {
  return set.keepsSubquery ? ONE_PARTITION_SIZE : DEFAULT_SIZE;
}
