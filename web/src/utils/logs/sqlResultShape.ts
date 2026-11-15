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

type AstNode = Record<string, any>;

const TIME_BUCKET_FUNCTIONS = new Set(["histogram", "date_bin", "date_trunc", "time_bucket"]);
const RESULT_KEY_SAMPLE = 100;

const columnsOf = (parsedSQL: AstNode | null | undefined): AstNode[] =>
  Array.isArray(parsedSQL?.columns) ? parsedSQL.columns : [];

const groupByOf = (parsedSQL: AstNode | null | undefined): AstNode[] => {
  const groupby = parsedSQL?.groupby;
  if (Array.isArray(groupby)) return groupby;
  return Array.isArray(groupby?.columns) ? groupby.columns : [];
};

const columnNameOf = (node: AstNode): string | undefined =>
  typeof node.column === "string" ? node.column : node.column?.expr?.value;

// An aggregate over the timestamp (max(_timestamp)) is a value, not a time bucket, so it is skipped.
const readsTime = (node: unknown, timestampColumn: string): boolean => {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => readsTime(child, timestampColumn));
  const current = node as AstNode;
  if (current.type === "aggr_func") return false;
  if (current.type === "column_ref" && columnNameOf(current) === timestampColumn) return true;
  if (current.type === "function") {
    const name = String(current.name?.name?.[0]?.value ?? "").toLowerCase();
    if (TIME_BUCKET_FUNCTIONS.has(name)) return true;
  }
  return Object.values(current).some((child) => readsTime(child, timestampColumn));
};

/** A query whose rows are groups, not events: GROUP BY, or an aggregate in the SELECT list. */
export function isAggregateQuery(parsedSQL: AstNode | null | undefined, rawQuery = ""): boolean {
  if (columnsOf(parsedSQL).some((column) => column?.expr?.type === "aggr_func")) return true;
  if (groupByOf(parsedSQL).length) return true;
  return /\bgroup\s+by\b/i.test(rawQuery);
}

/** An aggregate that is not bucketed by time, so an event histogram says nothing about its rows. */
export function isNonTimeSeriesAggregate(
  parsedSQL: AstNode | null | undefined,
  rawQuery: string,
  timestampColumn: string,
): boolean {
  if (!parsedSQL || !isAggregateQuery(parsedSQL, rawQuery)) return false;
  const keys = [...columnsOf(parsedSQL).map((column) => column?.expr), ...groupByOf(parsedSQL)];
  return !keys.some((node) => readsTime(node, timestampColumn));
}

/** The columns an aggregate returned, in the server's order; the timestamp keeps its own column. */
export function aggregateResultColumns(
  hits: Record<string, unknown>[] | undefined,
  timestampColumn: string,
): string[] {
  const seen = new Set<string>();
  for (const hit of (hits ?? []).slice(0, RESULT_KEY_SAMPLE)) {
    for (const key of Object.keys(hit ?? {})) {
      if (key !== timestampColumn) seen.add(key);
    }
  }
  return [...seen];
}

const NUMERIC_SAMPLE = 20;

/** Result columns whose sampled values are all numbers: right-aligned with tabular figures (D3, T4). */
export function numericResultColumns(
  hits: Record<string, unknown>[] | undefined,
  columns: string[],
): Set<string> {
  const sample = (hits ?? []).slice(0, NUMERIC_SAMPLE);
  const numeric = new Set<string>();
  for (const column of columns) {
    const values = sample.map((hit) => hit?.[column]).filter((v) => v !== null && v !== undefined);
    if (values.length && values.every((v) => typeof v === "number")) numeric.add(column);
  }
  return numeric;
}
