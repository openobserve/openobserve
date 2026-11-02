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
 * One Databases row per server, its schemas kept underneath.
 *
 * `db_totals` arrives at (system, instance, namespace) grain. On Postgres the
 * namespace is a database ON the server, so one RDS host serving seventeen of
 * them came back as seventeen rows all titled with the host name — and every
 * one of them expanded to the same server-wide split. The reader's unit is the
 * server; the namespaces are what they want to filter inside it.
 *
 * So the rows are folded here, client-side, and each folded row keeps the
 * per-namespace rows it came from. Those stay EXACT: they are the server's own
 * totals, which is why the schema children are built from them rather than
 * from the top-N `query_stats` split.
 *
 * Counts and time are additive across namespaces, so their sums are exact. A
 * percentile is not: for a server with more than one schema the folded
 * p50/p95/p99 are call-weighted means of the schemas' own percentiles — the
 * same merge the backend uses when it folds rows — while the schema children
 * keep their exact figures.
 */

import type { DbTotalsRow } from "@/services/db_monitoring";

/** A server row, with the per-schema rows it was folded from. */
export interface DbmInstanceTotals extends DbTotalsRow {
  /** The per-namespace rows, heaviest first. Always at least one. */
  schemas: DbTotalsRow[];
}

const num = (value: number | undefined | null): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** NUL-separated, like `totalsKey`: no host or engine name can contain it. */
export const instanceKey = (row: Pick<DbTotalsRow, "db_system" | "db_instance">): string =>
  `${row.db_system}\u0000${row.db_instance}`;

/**
 * Call-weighted mean of one percentile across rows, skipping rows that did not
 * report it. `undefined` when none did — an absent latency must stay absent.
 */
const weightedPercentile = (
  rows: DbTotalsRow[],
  pick: (row: DbTotalsRow) => number | undefined,
): number | undefined => {
  let weight = 0;
  let sum = 0;
  let any = false;
  for (const row of rows) {
    const value = pick(row);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    any = true;
    const calls = num(row.calls);
    weight += calls;
    sum += value * calls;
  }
  if (!any) return undefined;
  if (weight > 0) return sum / weight;
  // Reported, but over zero calls: there is nothing to weight by, so the worst
  // reading is the only statement that holds for all of them.
  return Math.max(...rows.map(pick).filter((v): v is number => typeof v === "number"));
};

const optionalSum = (
  rows: DbTotalsRow[],
  pick: (row: DbTotalsRow) => number | undefined,
): number | undefined =>
  rows.some((row) => typeof pick(row) === "number")
    ? rows.reduce((acc, row) => acc + num(pick(row)), 0)
    : undefined;

const foldOne = (schemas: DbTotalsRow[]): DbmInstanceTotals => {
  const [first] = schemas;
  const names = [...new Set(schemas.map((row) => row.db_namespace ?? ""))];
  const maxes = schemas.map((row) => row.max_ns).filter((v): v is number => typeof v === "number");
  return {
    db_system: first.db_system,
    db_instance: first.db_instance,
    // Kept only when it names the whole row. A server row spanning several
    // schemas has no single namespace, and borrowing one would scope every
    // hand-off from the row to that schema alone.
    db_namespace: names.length === 1 ? first.db_namespace : undefined,
    statements: optionalSum(schemas, (row) => row.statements),
    calls: optionalSum(schemas, (row) => row.calls),
    errors: optionalSum(schemas, (row) => row.errors),
    total_time_ns: optionalSum(schemas, (row) => row.total_time_ns),
    traces: optionalSum(schemas, (row) => row.traces),
    qps: optionalSum(schemas, (row) => row.qps),
    p50_ns: weightedPercentile(schemas, (row) => row.p50_ns),
    p95_ns: weightedPercentile(schemas, (row) => row.p95_ns),
    p99_ns: weightedPercentile(schemas, (row) => row.p99_ns),
    max_ns: maxes.length ? Math.max(...maxes) : undefined,
    trace_stream_name: first.trace_stream_name,
    calling_services: [
      ...new Set(schemas.flatMap((row) => row.calling_services ?? []).filter(Boolean)),
    ],
    schemas: [...schemas].sort((a, b) => num(b.total_time_ns) - num(a.total_time_ns)),
  };
};

/**
 * Fold namespace-grain rows into one row per (system, instance), first-seen
 * order. `namespace` narrows which schemas fold in — the Schema filter — and a
 * server with none of them drops out.
 */
export const foldByInstance = (
  rows: DbTotalsRow[],
  namespace?: string | null,
): DbmInstanceTotals[] => {
  const groups = new Map<string, DbTotalsRow[]>();
  for (const row of rows) {
    if (namespace && (row.db_namespace ?? "") !== namespace) continue;
    const key = instanceKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].map(foldOne);
};
