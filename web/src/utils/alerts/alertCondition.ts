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
 * What an alert is watching, as one line.
 *
 * Lived inside `AlertConfigSummary` until an on-call page needed the same
 * sentence: a responder opening a page asks "what fired" before anything else,
 * and two spellings of the same condition on two screens is how they stop
 * trusting either.
 */

import {
  convertV0ToV2,
  convertV1BEToV2,
  detectConditionsVersion,
} from "@/utils/alerts/alertDataTransforms";
import { buildConditionsString, isUnaryOperator } from "@/utils/alerts/conditionsFormatter";

const EMPTY = "—";

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

/** The single-alert GET calls it `query_condition`; the list calls it `condition`. */
function queryConditionOf(alert: any) {
  return alert?.query_condition || alert?.condition;
}

/** The critical condition as one line; `—` when the alert is unknown. */
export function alertConditionText(alert: any): string {
  const qc = queryConditionOf(alert);
  // PromQL keeps its threshold on `promql_condition`; the expression itself is
  // the query, so rendering the comparison stops this falling through to "—".
  if (qc?.type === "promql") {
    if (qc.promql_rule_mode) return qc.promql || EMPTY;
    const pc = qc.promql_condition;
    return isBlank(pc?.value) ? EMPTY : `${pc.operator || ""} ${pc.value}`.trim();
  }
  const agg = qc?.aggregation;
  // A Builder alert can still store SQL from another mode; it never runs.
  if (!agg)
    return qc?.type === "custom"
      ? countConditionText(qc, alert?.trigger_condition)
      : qc?.sql || EMPTY;
  const fn = agg.function || "";
  const col = agg.having?.column || "";
  const op = agg.having?.operator || "";
  return `${fn}(${col}) ${op} ${agg.having?.value}`;
}

/** A Builder rule with no aggregation fires on how many rows match: `body contains 'ERROR' · count >= 1`. */
function countConditionText(qc: any, trigger: any): string {
  const group = storedConditionsGroup(qc?.conditions);
  const filters = group ? buildConditionsString(group) : "";
  const threshold = isBlank(trigger?.threshold)
    ? ""
    : `count ${trigger.operator || ""} ${trigger.threshold}`.replace(/\s+/g, " ");
  return [filters, threshold].filter(Boolean).join(" · ") || EMPTY;
}

/** A stored condition tree as a v2 group: the `{version: 2}` wrapper the API returns, a bare group, a v1 tree or a v0 list. */
function storedConditionsGroup(stored: any): any {
  if (!stored) return null;
  if (String(stored.version) === "2") return stored.conditions ?? null;
  if (Array.isArray(stored)) return convertV0ToV2(stored);
  return detectConditionsVersion(stored) === 1 ? convertV1BEToV2(stored) : stored;
}

/** True when the critical condition is a whole query (raw SQL, a PromQL rule, anomaly SQL or filters) rather than a threshold. */
export function alertConditionIsQuery(alert: any): boolean {
  if (alert?.alert_type === "anomaly_detection") return true;
  const qc = queryConditionOf(alert);
  if (qc?.type === "promql") return !!qc.promql_rule_mode;
  return !qc?.aggregation && qc?.type !== "custom" && !isBlank(qc?.sql);
}

/** The warning condition, or `—` when the alert has only a critical one. */
export function alertWarningConditionText(alert: any): string {
  const qc = queryConditionOf(alert);
  if (qc?.type === "promql") {
    if (qc.promql_rule_mode) return EMPTY;
    return isBlank(qc.promql_warning_value)
      ? EMPTY
      : `${qc.promql_condition?.operator || ""} ${qc.promql_warning_value}`.trim();
  }
  const agg = qc?.aggregation;
  if (isBlank(agg?.warning_value)) return EMPTY;
  return `${agg.function || ""}(${agg.having?.column || ""}) ${agg.having?.operator || ""} ${agg.warning_value}`;
}

/** How long a window the rule evaluates, in minutes. `null` when unset. */
export function alertPeriodMinutes(alert: any): number | null {
  const period = Number(alert?.trigger_condition?.period);
  return Number.isFinite(period) && period > 0 ? period : null;
}

type QueryMode = "custom" | "sql" | "promql";

/** The SQL the form writes into an empty SQL tab; it is not the user's query. */
const STARTER_SQL = /^SELECT \* FROM "[^"]*"$/;

/** Complete Builder conditions (column, operator, value unless unary), nested groups included. */
export function countCompleteConditions(tree: any): number {
  if (!Array.isArray(tree?.conditions)) return 0;
  let count = 0;
  for (const item of tree.conditions) {
    if (item?.filterType === "group") {
      count += countCompleteConditions(item);
    } else if (
      item?.column &&
      item.operator &&
      (!isBlank(item.value) || isUnaryOperator(item.operator))
    ) {
      count++;
    }
  }
  return count;
}

/** The modes of a scheduled alert that hold content, in the order Builder, SQL, PromQL. */
export function modesWithContent(input: {
  sql?: string;
  promql?: string;
  conditions?: unknown;
  streamType?: string;
}): QueryMode[] {
  const modes: QueryMode[] = [];
  if (countCompleteConditions(input.conditions) > 0) modes.push("custom");
  const sql = input.sql?.trim();
  if (sql && !STARTER_SQL.test(sql)) modes.push("sql");
  if (input.streamType === "metrics" && input.promql?.trim()) modes.push("promql");
  return modes;
}
