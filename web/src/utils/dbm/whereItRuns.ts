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
 * whereItRuns — the FR-5 "Where it runs" breakdown on the query detail page.
 *
 * The history endpoint returns per-(instance, namespace) totals for one query
 * (`breakdown` in the `/query/history` response, folded server-side from the
 * same rows its series merges per window). This module shapes those slices
 * into the instance → namespace rows the section renders, and owns the small
 * decisions a template must not: which rows can act as a filter, which row is
 * the active filter, and how shares are computed.
 *
 * Two honesty contracts, inherited from the server fold:
 *
 *  • An empty `db_namespace` means the spans REPORTED no database — it is a
 *    real slice, never dropped. It cannot become a filter though: the stored
 *    rows spell "absent" two ways (NULL and `""`) and a `namespace=''` filter
 *    would match only one of them, silently halving the page. So unnamed rows
 *    render but refuse the click.
 *  • The figures cover only the stretches where the query was heavy enough to
 *    be tracked on its own (per instance) — they are floors, not exact window
 *    totals, and the section's copy says so.
 */

/** One per-(instance, namespace) slice from the history response. */
export interface QueryBreakdownRow {
  /** `""` when the spans reported no instance. */
  db_instance?: string;
  /** `""` when the spans reported no database/schema. */
  db_namespace?: string;
  calls?: number;
  errors?: number;
  total_time_ns?: number;
  p50_ns?: number;
  p95_ns?: number;
  p99_ns?: number;
  max_ns?: number;
  statements?: number;
  traces?: number;
}

/** One rendered row: an instance, or one namespace inside it. */
export interface WhereItRunsRow {
  rowKey: string;
  /** Namespace rows render indented under their instance. */
  isChild: boolean;
  /** Instance name, or namespace name on a child. `""` = not reported. */
  label: string;
  /** The filter this row would set. `namespace` only on children. */
  instance: string;
  namespace?: string;
  calls: number;
  errors: number;
  totalTimeNs: number;
  /** Share of the query's tracked time, `0`–`1` (instance rows only; a child's
   *  share is of the whole query too, so the bars stay comparable). */
  share: number;
  /** `errors / calls`, or `null` when no calls were counted. */
  errorRate: number | null;
  /** `totalTimeNs / calls`, or `null` when no calls were counted. */
  avgNs: number | null;
  /** Whether clicking this row can set a page filter (named dims only). */
  clickable: boolean;
}

interface Slice {
  namespace: string;
  calls: number;
  errors: number;
  totalTimeNs: number;
}

const num = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Flatten breakdown slices into instance rows with namespace children.
 *
 * Instances rank by tracked time descending (ties by name, deterministic), and
 * namespaces likewise within each instance. Children are emitted only when
 * they would add a fact: an instance whose single slice reported no namespace
 * gets none — an indented row restating the parent under a "not reported"
 * label says nothing.
 */
export const buildWhereItRunsRows = (rows: QueryBreakdownRow[]): WhereItRunsRow[] => {
  const byInstance = new Map<string, Slice[]>();
  for (const row of rows) {
    const instance = row.db_instance ?? "";
    const slices = byInstance.get(instance) ?? [];
    slices.push({
      namespace: row.db_namespace ?? "",
      calls: num(row.calls),
      errors: num(row.errors),
      totalTimeNs: num(row.total_time_ns),
    });
    byInstance.set(instance, slices);
  }

  const grandTotal = rows.reduce((acc, row) => acc + num(row.total_time_ns), 0);
  const share = (timeNs: number) => (grandTotal > 0 ? timeNs / grandTotal : 0);
  const rates = (calls: number, errors: number, timeNs: number) => ({
    errorRate: calls > 0 ? errors / calls : null,
    avgNs: calls > 0 ? timeNs / calls : null,
  });

  const byTimeDesc = <T extends { totalTimeNs: number }>(name: (entry: T) => string) => {
    return (a: T, b: T) => b.totalTimeNs - a.totalTimeNs || name(a).localeCompare(name(b));
  };

  const instances = [...byInstance.entries()]
    .map(([instance, slices]) => ({
      instance,
      slices: [...slices].sort(byTimeDesc((slice: Slice) => slice.namespace)),
      calls: slices.reduce((acc, slice) => acc + slice.calls, 0),
      errors: slices.reduce((acc, slice) => acc + slice.errors, 0),
      totalTimeNs: slices.reduce((acc, slice) => acc + slice.totalTimeNs, 0),
    }))
    .sort(byTimeDesc((entry) => entry.instance));

  const out: WhereItRunsRow[] = [];
  for (const entry of instances) {
    out.push({
      rowKey: `i:${entry.instance}`,
      isChild: false,
      label: entry.instance,
      instance: entry.instance,
      calls: entry.calls,
      errors: entry.errors,
      totalTimeNs: entry.totalTimeNs,
      share: share(entry.totalTimeNs),
      ...rates(entry.calls, entry.errors, entry.totalTimeNs),
      clickable: entry.instance !== "",
    });
    // A lone unnamed slice restates the parent — skip it. Anything named (or
    // an unnamed slice beside named ones, whose share must stay visible)
    // renders as a child.
    const informative =
      entry.slices.length > 1 || (entry.slices.length === 1 && entry.slices[0].namespace !== "");
    if (!informative) continue;
    for (const slice of entry.slices) {
      out.push({
        rowKey: `n:${entry.instance}:${slice.namespace}`,
        isChild: true,
        label: slice.namespace,
        instance: entry.instance,
        namespace: slice.namespace,
        calls: slice.calls,
        errors: slice.errors,
        totalTimeNs: slice.totalTimeNs,
        share: share(slice.totalTimeNs),
        ...rates(slice.calls, slice.errors, slice.totalTimeNs),
        clickable: entry.instance !== "" && slice.namespace !== "",
      });
    }
  }
  return out;
};

/** The filters currently narrowing the page (from the URL). */
export interface WhereItRunsScope {
  instance?: string;
  namespace?: string;
}

/**
 * Whether a row IS the page's current filter — the row a second click clears.
 * An instance row is active only when no namespace narrows further, so exactly
 * one row can be active at a time.
 */
export const isWhereRowActive = (row: WhereItRunsRow, scope: WhereItRunsScope): boolean =>
  row.isChild
    ? scope.instance === row.instance && scope.namespace === row.namespace
    : scope.instance === row.instance && !scope.namespace;

/**
 * The scope a click on `row` moves the page to. `undefined` values mean
 * "cleared". A click on the active row backs out one level: a namespace back
 * to its instance, an instance back to everything.
 */
export const whereRowClickScope = (
  row: WhereItRunsRow,
  scope: WhereItRunsScope,
): WhereItRunsScope | null => {
  if (!row.clickable) return null;
  if (isWhereRowActive(row, scope)) {
    return row.isChild
      ? { instance: row.instance, namespace: undefined }
      : { instance: undefined, namespace: undefined };
  }
  return row.isChild
    ? { instance: row.instance, namespace: row.namespace }
    : { instance: row.instance, namespace: undefined };
};
