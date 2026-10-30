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
 * Who is spending one database's time — schema, then service.
 *
 * The Overview row already names the calling services, but `calling_services`
 * is a flat name list with no weights, so it can say WHO talks to a database
 * and never HOW MUCH. Weight exists only one grain down, on `query_stats`, so
 * this module rolls per-fingerprint rows up into the two levels a reader
 * actually asks about: which schema, and which service inside it.
 *
 * Three decisions the callers depend on:
 *
 *  • It is a TREE, not a graph. Schema contains service contains nothing; there
 *    are no cycles and no shared children, so every node's share is a fraction
 *    of exactly one parent and the arithmetic is closed.
 *
 *  • A level that carries no information is not rendered. When no row names a
 *    schema — the normal case for Redis, and for any engine whose driver omits
 *    `db.namespace` — a single "—" schema node would add a nesting tier whose
 *    only content is the absence of a fact. `collapsed` says so and the caller
 *    drops straight to services.
 *
 *  • It reports its own SHORTFALL. The query grain is top-N truncated and
 *    defaults to `stmt_class = query`, so the per-service sum can legitimately
 *    fall short of the database's own exact total. The gap is returned rather
 *    than hidden, because a breakdown that quietly does not add up is the one
 *    failure this whole feature exists to avoid.
 *
 * Percentiles are deliberately NOT summed or averaged across children: a
 * percentile cannot be pooled from other percentiles. Each level reports the
 * WORST p50/p95/p99 among its rows, which is a true statement about the rows it
 * covers — "no query under this service had a p95 better than this".
 *
 * Every `query_stats` row carries p50_ns/p95_ns/p99_ns, and all three follow
 * the same worst-of rule — none is blanked, none is special.
 */

import type { DbTotalsRow, QueryStatsRow } from "@/services/db_monitoring";

/** Below this the unattributed remainder is rounding, not a coverage story. */
export const SHORTFALL_FLOOR = 0.02;

/** One node of the breakdown — a schema or a service. Same shape at both levels. */
export interface DbmBreakdownNode {
  /** Stable identity for `v-for` / expansion state. */
  key: string;
  /** The schema or service name, or `null` when the rows carried none. */
  name: string | null;
  /** Database time attributed to this node, nanoseconds. */
  totalTimeNs: number;
  /** Share of the PARENT level's attributed time, `0`–`1`. */
  share: number;
  calls: number;
  errors: number;
  /** Worst p50/p95/p99 among this node's rows — never a pooled percentile. */
  p50Ns: number | null;
  p95Ns: number | null;
  p99Ns: number | null;
  /** How many fingerprint rows rolled up into this node. */
  queryCount: number;
  /** Services under a schema node; empty on a service node. */
  children: DbmBreakdownNode[];
}

export interface DbmBreakdown {
  /**
   * Schema nodes, or — when `collapsed` — the service nodes directly. The
   * caller renders one flat list either way and reads `collapsed` only to pick
   * the column label.
   */
  levels: DbmBreakdownNode[];
  /** No row named a schema, so the schema tier was dropped as empty. */
  collapsed: boolean;
  /** Time the fingerprint rows account for, nanoseconds. */
  attributedNs: number;
  /** The database row's own exact total, nanoseconds — `null` when unknown. */
  databaseTotalNs: number | null;
  /**
   * Unattributed share of the database's total, `0`–`1`, or `null` when there
   * is no total to compare against. Only set above `SHORTFALL_FLOOR`.
   */
  shortfall: number | null;
}

const num = (value: number | undefined | null): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * The schema a row belongs to.
 *
 * `db_namespace` is the scalar the merge emits when every constituent row
 * agreed; when they did not, only the distinct-value array survives. A row that
 * spans two schemas is not attributable to either, so it falls to `null`
 * alongside rows that never named one — both are honestly "we cannot say".
 */
export const rowNamespace = (row: QueryStatsRow): string | null => {
  if (row.db_namespace) return row.db_namespace;
  const list = (row.namespaces ?? []).filter(Boolean);
  return list.length === 1 ? list[0] : null;
};

/**
 * The service that issued a row.
 *
 * Same fallback as the schema, with one difference: a fingerprint called by
 * several services is genuinely shared, and the rollup gives us no way to split
 * its time between them. Attributing all of it to `services[0]` would invent a
 * number, so a multi-service row is `null` — "we know it was called, not by
 * whom" — and lands in the unattributed node.
 */
export const rowService = (row: QueryStatsRow): string | null => {
  if (row.service_name) return row.service_name;
  const list = (row.services ?? []).filter(Boolean);
  return list.length === 1 ? list[0] : null;
};

interface Bucket {
  name: string | null;
  totalTimeNs: number;
  calls: number;
  errors: number;
  p50Ns: number | null;
  p95Ns: number | null;
  p99Ns: number | null;
  queryCount: number;
  rows: QueryStatsRow[];
}

const emptyBucket = (name: string | null): Bucket => ({
  name,
  totalTimeNs: 0,
  calls: 0,
  errors: 0,
  p50Ns: null,
  p95Ns: null,
  p99Ns: null,
  queryCount: 0,
  rows: [],
});

/** Worst-of, skipping anything the row did not report. Never averages. */
const worst = (current: number | null, candidate: number | undefined): number | null => {
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return current;
  return current === null ? candidate : Math.max(current, candidate);
};

const absorb = (bucket: Bucket, row: QueryStatsRow) => {
  bucket.totalTimeNs += num(row.total_time_ns);
  bucket.calls += num(row.calls);
  bucket.errors += num(row.errors);
  bucket.queryCount += 1;
  bucket.rows.push(row);
  bucket.p50Ns = worst(bucket.p50Ns, row.p50_ns);
  bucket.p95Ns = worst(bucket.p95Ns, row.p95_ns);
  bucket.p99Ns = worst(bucket.p99Ns, row.p99_ns);
};

/** Group rows by a key, preserving nothing about input order — the caller ranks. */
const bucketBy = (rows: QueryStatsRow[], keyOf: (row: QueryStatsRow) => string | null) => {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const name = keyOf(row);
    const id = name ?? "";
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = emptyBucket(name);
      buckets.set(id, bucket);
    }
    absorb(bucket, row);
  }
  return [...buckets.values()];
};

/** Heaviest first — the ranking is the whole point of a breakdown. */
const byTimeDesc = (a: Bucket, b: Bucket) => b.totalTimeNs - a.totalTimeNs;

const toNode = (bucket: Bucket, parentTotal: number, keyPrefix: string): DbmBreakdownNode => ({
  key: `${keyPrefix}${bucket.name ?? ""}`,
  name: bucket.name,
  totalTimeNs: bucket.totalTimeNs,
  share: parentTotal > 0 ? bucket.totalTimeNs / parentTotal : 0,
  calls: bucket.calls,
  errors: bucket.errors,
  p50Ns: bucket.p50Ns,
  p95Ns: bucket.p95Ns,
  p99Ns: bucket.p99Ns,
  queryCount: bucket.queryCount,
  children: [],
});

/**
 * Roll one database's fingerprint rows into schema → service.
 *
 * `databaseTotalNs` is the Overview row's own exact total. Pass it and the
 * result can state its coverage; omit it and `shortfall` is `null`, because
 * "some time is missing" is a claim we would have nothing to measure against.
 */
export const buildDatabaseBreakdown = (
  rows: QueryStatsRow[],
  databaseTotal?: Pick<DbTotalsRow, "total_time_ns"> | number | null,
): DbmBreakdown => {
  const attributedNs = rows.reduce((acc, row) => acc + num(row.total_time_ns), 0);

  const databaseTotalNs =
    typeof databaseTotal === "number"
      ? databaseTotal
      : databaseTotal && typeof databaseTotal.total_time_ns === "number"
        ? databaseTotal.total_time_ns
        : null;

  // A schema tier whose every node is "no schema" states nothing the reader did
  // not already know, so it is dropped rather than drawn as a "—" row.
  const collapsed = rows.every((row) => rowNamespace(row) === null);

  const serviceNodes = (subset: QueryStatsRow[], parentTotal: number, keyPrefix: string) =>
    bucketBy(subset, rowService)
      .sort(byTimeDesc)
      .map((bucket) => toNode(bucket, parentTotal, keyPrefix));

  const levels = collapsed
    ? serviceNodes(rows, attributedNs, "service:")
    : bucketBy(rows, rowNamespace)
        .sort(byTimeDesc)
        .map((bucket) => {
          const node = toNode(bucket, attributedNs, "schema:");
          node.children = serviceNodes(
            bucket.rows,
            bucket.totalTimeNs,
            `service:${bucket.name ?? ""}:`,
          );
          return node;
        });

  // Only a gap big enough to change how a share reads is worth a sentence; the
  // two grains are computed by different code paths and drift by rounding.
  const missing =
    databaseTotalNs !== null && databaseTotalNs > 0
      ? (databaseTotalNs - attributedNs) / databaseTotalNs
      : null;
  const shortfall = missing !== null && missing >= SHORTFALL_FLOOR ? missing : null;

  return { levels, collapsed, attributedNs, databaseTotalNs, shortfall };
};
