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

const EMPTY = "—";

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

/** The single-alert GET calls it `query_condition`; the list calls it `condition`. */
function queryConditionOf(alert: any) {
  return alert?.query_condition || alert?.condition;
}

/**
 * The critical condition — `avg(latency) > 500`, a PromQL comparison, or the
 * raw SQL when the rule is not an aggregation. `—` when the alert is unknown.
 */
export function alertConditionText(alert: any): string {
  const qc = queryConditionOf(alert);
  // PromQL keeps its threshold on `promql_condition`; the expression itself is
  // the query, so rendering the comparison stops this falling through to "—".
  if (qc?.type === "promql") {
    const pc = qc.promql_condition;
    return isBlank(pc?.value) ? EMPTY : `${pc.operator || ""} ${pc.value}`.trim();
  }
  const agg = qc?.aggregation;
  if (!agg) return qc?.sql || EMPTY;
  const fn = agg.function || "";
  const col = agg.having?.column || "";
  const op = agg.having?.operator || "";
  return `${fn}(${col}) ${op} ${agg.having?.value}`;
}

/** The warning condition, or `—` when the alert has only a critical one. */
export function alertWarningConditionText(alert: any): string {
  const qc = queryConditionOf(alert);
  if (qc?.type === "promql") {
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
