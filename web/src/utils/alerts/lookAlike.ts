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

/** The query condition fields this module reads, as the list API and the form both carry them. */
export interface LookAlikeCondition {
  type?: string | null;
  conditions?: unknown;
  sql?: string | null;
  promql?: string | null;
  promql_condition?: { operator?: string; value?: unknown } | null;
  aggregation?: {
    function?: string;
    having?: { column?: string; operator?: string; value?: unknown } | null;
  } | null;
}

/** A row of `GET /api/v2/{org}/alerts`, or the alert being written with `condition` set from the form. */
export interface LookAlikeAlert {
  alert_id?: string;
  name?: string;
  stream_type?: string | null;
  stream_name?: string | null;
  condition?: LookAlikeCondition | null;
}

export interface AlertThreshold {
  operator: string;
  value: number;
}

// "column = 'value'" and "column IN ('a', 'b')", the equalities a SQL alert filters on.
const SQL_EQUALS = /"?([A-Za-z_][\w.]*)"?\s*(?:=|i?like)\s*'([^']*)'/gi;
const SQL_IN = /"?([A-Za-z_][\w.]*)"?\s+in\s*\(([^)]*)\)/gi;
const PROMQL_MATCHER = /([A-Za-z_]\w*)\s*(?:=~|!~|!=|=)\s*"([^"]*)"/g;

const pair = (column: string, value: unknown) =>
  `f:${column.toLowerCase()}=${String(value).toLowerCase()}`;

function leafPairs(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) return node.forEach((child) => leafPairs(child, out));
  if (!node || typeof node !== "object") return;
  const n = node as { conditions?: unknown; column?: unknown; value?: unknown };
  if (n.conditions !== undefined) return leafPairs(n.conditions, out);
  if (typeof n.column !== "string" || !n.column) return;
  const values = Array.isArray(n.value) ? n.value : [n.value];
  values
    .filter((v) => v !== undefined && v !== null && v !== "")
    .forEach((v) => out.add(pair(n.column as string, v)));
}

/** What a condition filters on and measures: shared items between two alerts make them look alike. */
function conditionItems(qc: LookAlikeCondition | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!qc) return out;
  if (qc.type === "promql") {
    for (const [, label, value] of (qc.promql ?? "").matchAll(PROMQL_MATCHER))
      if (label !== "__name__") out.add(pair(label, value));
    return out;
  }
  if (qc.type === "sql") {
    const sql = qc.sql ?? "";
    for (const [, column, value] of sql.matchAll(SQL_EQUALS)) out.add(pair(column, value));
    for (const [, column, list] of sql.matchAll(SQL_IN))
      for (const [, value] of list.matchAll(/'([^']*)'/g)) out.add(pair(column, value));
    return out;
  }
  leafPairs(qc.conditions, out);
  const fn = qc.aggregation?.function;
  const column = qc.aggregation?.having?.column;
  if (fn && fn !== "count" && column) out.add(`a:${fn}(${column.toLowerCase()})`);
  return out;
}

const sameStream = (a: LookAlikeAlert, b: LookAlikeAlert) =>
  !!a.stream_name &&
  a.stream_type === b.stream_type &&
  a.stream_name.toLowerCase() === (b.stream_name ?? "").toLowerCase();

/** Existing alerts on the draft's stream that share a filter value, matcher or aggregate with it. */
export function lookAlikeAlerts<T extends LookAlikeAlert>(
  draft: LookAlikeAlert,
  rows: readonly T[],
  selfId?: string,
): T[] {
  const mine = conditionItems(draft.condition);
  if (!mine.size) return [];
  return rows.filter(
    (row) =>
      row.alert_id !== selfId &&
      sameStream(draft, row) &&
      [...conditionItems(row.condition)].some((item) => mine.has(item)),
  );
}

/** The comparison an alert fires on: the PromQL value, the aggregate's having, else the event count. */
export function alertThreshold(
  qc: LookAlikeCondition | null | undefined,
  trigger?: { operator?: string; threshold?: unknown } | null,
): AlertThreshold | null {
  const source =
    qc?.type === "promql"
      ? qc.promql_condition
      : qc?.aggregation?.having
        ? qc.aggregation.having
        : trigger
          ? { operator: trigger.operator, value: trigger.threshold }
          : null;
  const value = Number(source?.value);
  if (!source?.operator || source.value === "" || !Number.isFinite(value)) return null;
  return { operator: source.operator, value };
}

/** Both comparisons when an installed copy alerts at another value than its suggestion, else null. */
export function installedThresholdDiffers(
  suggestion: {
    query_condition?: LookAlikeCondition | null;
    trigger_condition?: { operator?: string; threshold?: unknown } | null;
  },
  row: {
    condition?: LookAlikeCondition | null;
    trigger_condition?: { operator?: string; threshold?: unknown } | null;
  },
): { installed: AlertThreshold; suggested: AlertThreshold } | null {
  const suggested = alertThreshold(suggestion.query_condition, suggestion.trigger_condition);
  const installed = alertThreshold(row.condition, row.trigger_condition);
  if (!suggested || !installed) return null;
  const same = suggested.operator === installed.operator && suggested.value === installed.value;
  return same ? null : { installed, suggested };
}

const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

/** A card's "> 80%" for a query whose threshold reads 0.8: each percent the threshold stands for is
 * written as the threshold first, so the copy matches the number the field shows. */
export function inThresholdUnit(
  text: string,
  alert: {
    query_condition?: LookAlikeCondition | null;
    trigger_condition?: { operator?: string; threshold?: unknown } | null;
  },
): string {
  const threshold = alertThreshold(alert.query_condition, alert.trigger_condition)?.value;
  if (threshold === undefined || !(threshold > 0 && threshold <= 1)) return text;
  return text.replace(PERCENT, (match, n: string) =>
    Math.abs(Number(n) / 100 - threshold) < 1e-9 ? `${threshold} (${match})` : match,
  );
}
