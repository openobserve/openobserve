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

// db_totals arrives per schema, but the reader's unit is the server, so rows fold here.

import type { DbTotalsRow } from "@/services/db_monitoring";
import { detectDrowningDatabases, isCriticalErrorRate } from "@/utils/dbm/insights";

/** A server row, with the per-schema rows it was folded from. */
export interface DbmInstanceTotals extends DbTotalsRow {
  /** The per-namespace rows, heaviest first. Always at least one. */
  schemas: DbTotalsRow[];
  /** The schemas that carry a name, heaviest first. */
  namedSchemas: string[];
}

const num = (value: number | undefined | null): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** NUL-separated, like `totalsKey`: no host or engine name can contain it. */
export const instanceKey = (row: Pick<DbTotalsRow, "db_system" | "db_instance">): string =>
  `${row.db_system}\u0000${row.db_instance}`;

/** The table identity of a server row; it must not move when the schema count or filter does. */
export const serverRowKey = (row: Pick<DbTotalsRow, "db_system" | "db_instance">): string =>
  `db\u0000${instanceKey(row)}`;

/** Whether a namespace-grain row falls inside the Schema filter. */
export const inSchema = (row: Pick<DbTotalsRow, "db_namespace">, namespace?: string | null) =>
  !namespace || (row.db_namespace ?? "") === namespace;

/** Percentiles cannot be pooled, so a group reports its worst; `undefined` when none reported. */
export const worstPercentile = <T>(
  rows: T[],
  pick: (row: T) => number | null | undefined,
): number | undefined => {
  const values = rows
    .map(pick)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return values.length ? Math.max(...values) : undefined;
};

const optionalSum = (
  rows: DbTotalsRow[],
  pick: (row: DbTotalsRow) => number | undefined,
): number | undefined =>
  rows.some((row) => typeof pick(row) === "number")
    ? rows.reduce((acc, row) => acc + num(pick(row)), 0)
    : undefined;

const foldOne = (rows: DbTotalsRow[]): DbmInstanceTotals => {
  const [first] = rows;
  const schemas = [...rows].sort((a, b) => num(b.total_time_ns) - num(a.total_time_ns));
  const names = [...new Set(rows.map((row) => row.db_namespace ?? ""))];
  return {
    db_system: first.db_system,
    db_instance: first.db_instance,
    // A server row stands for all its schemas, so it names one only when it holds exactly one.
    db_namespace: names.length === 1 ? first.db_namespace : undefined,
    statements: optionalSum(rows, (row) => row.statements),
    calls: optionalSum(rows, (row) => row.calls),
    errors: optionalSum(rows, (row) => row.errors),
    total_time_ns: optionalSum(rows, (row) => row.total_time_ns),
    traces: optionalSum(rows, (row) => row.traces),
    qps: optionalSum(rows, (row) => row.qps),
    p50_ns: worstPercentile(rows, (row) => row.p50_ns),
    p95_ns: worstPercentile(rows, (row) => row.p95_ns),
    p99_ns: worstPercentile(rows, (row) => row.p99_ns),
    max_ns: worstPercentile(rows, (row) => row.max_ns),
    trace_stream_name: first.trace_stream_name,
    calling_services: [
      ...new Set(rows.flatMap((row) => row.calling_services ?? []).filter(Boolean)),
    ],
    schemas,
    namedSchemas: [
      ...new Set(schemas.map((row) => row.db_namespace).filter((name): name is string => !!name)),
    ],
  };
};

/** One row per (system, instance); under the Schema filter a server without it drops out. */
export const foldByInstance = (
  rows: DbTotalsRow[],
  namespace?: string | null,
): DbmInstanceTotals[] => {
  const groups = new Map<string, DbTotalsRow[]>();
  for (const row of rows) {
    if (!inSchema(row, namespace)) continue;
    const key = instanceKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].map(foldOne);
};

/** Whether any server's speeds are the worst of several db_totals rows rather than its own. */
export const hasWorstOfPercentiles = (rows: { schemas?: DbTotalsRow[] }[]): boolean =>
  rows.some((row) => (row.schemas?.length ?? 0) > 1);

/** The servers with a schema slowing against its own baseline, by `instanceKey`. */
export const drowningInstanceKeys = (
  rows: DbTotalsRow[],
  previousRows: DbTotalsRow[],
  namespace?: string | null,
): Set<string> =>
  new Set(
    detectDrowningDatabases(
      rows.filter((row) => inSchema(row, namespace)),
      previousRows.filter((row) => inSchema(row, namespace)),
    ).map((found) => instanceKey(found.row)),
  );

/** A server is critical on its own rate, or when any one schema's rate is critical. */
export const isCriticalServer = (
  row: Pick<DbTotalsRow, "errors" | "calls"> & { schemas?: DbTotalsRow[] },
): boolean =>
  isCriticalErrorRate(row.errors, row.calls) ||
  (row.schemas ?? []).some((schema) => isCriticalErrorRate(schema.errors, schema.calls));
