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

export type AlertSeverity = "critical" | "warning";

export interface WouldFireResult {
  incidents: number;
  runs: number;
  /** Seconds of history the query actually covered, never more than the window. */
  checkedSeconds: number;
  noData: boolean;
}

export interface PromqlSeries {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

export interface SqlBucket {
  time: number;
  count: number;
}

export interface HistorySummary {
  incidents: number;
  runs: number;
  leftOffIncidents: number;
  lowConfidence: boolean;
  /** Shortest history behind the headline, in seconds. */
  checkedSeconds: number;
}

export interface SummaryRow {
  chosen: boolean;
  result: WouldFireResult | null;
}

export const HISTORY_WINDOW_SECONDS = 24 * 60 * 60;
export const NOISE_INCIDENTS = 2;
export const SECONDS_PER_DAY = 86_400;

const CRITICAL_MAX_PRIORITY = 2;
const STEP_TOLERANCE = 1.5;
const PARTIAL_RATIO = 0.9;
const AGGREGATE_FUNCTION = "aggr_func";
export const HISTOGRAM_ALIAS = "o2_history_bucket";
export const COUNT_ALIAS = "o2_history_count";

/** Mirrors the backend `compare`, including the two spellings of equal. */
export const compareValue = (value: number, operator: string, threshold: number): boolean => {
  switch (operator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "=":
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
    default:
      return false;
  }
};

export const severityOf = (alert: Record<string, any>): AlertSeverity =>
  Number(alert.priority) <= CRITICAL_MAX_PRIORITY ? "critical" : "warning";

export const frequencySeconds = (alert: Record<string, any>): number => {
  const trigger = alert.trigger_condition ?? {};
  const frequency = Number(trigger.frequency) || Number(trigger.period) || 10;
  return trigger.frequency_type === "seconds" ? frequency : frequency * 60;
};

export const periodMinutes = (alert: Record<string, any>): number =>
  Math.max(1, Number(alert.trigger_condition?.period) || 1);

/** Queries a day once on: the shown cost, which is zero while an alert is off. */
export const queriesPerDay = (alerts: Array<Record<string, any>>): number =>
  alerts.reduce((sum, alert) => sum + Math.round(SECONDS_PER_DAY / frequencySeconds(alert)), 0);

// Consecutive failing points are one incident, whatever their count (D3).
const incidentsIn = (times: number[], stepSeconds: number): number => {
  const sorted = [...new Set(times)].sort((left, right) => left - right);
  return sorted.filter(
    (time, index) => index === 0 || time - sorted[index - 1] > stepSeconds * STEP_TOLERANCE,
  ).length;
};

const seriesKey = (metric: Record<string, string>) =>
  JSON.stringify(Object.entries(metric).sort(([left], [right]) => (left < right ? -1 : 1)));

/** Streamed chunks may split a series, so the identity is its label set. */
export const promqlResult = (
  chunks: PromqlSeries[],
  alert: Record<string, any>,
  stepSeconds: number,
): WouldFireResult => {
  const condition = alert.query_condition?.promql_condition ?? {};
  const threshold = Number(condition.value);
  const merged = new Map<string, Array<[number, string]>>();
  for (const { metric, values } of chunks) {
    const key = seriesKey(metric ?? {});
    merged.set(key, [...(merged.get(key) ?? []), ...(values ?? [])]);
  }
  const seen = new Set<number>();
  let incidents = 0;
  let runs = 0;
  for (const values of merged.values()) {
    const failing: number[] = [];
    for (const [time, value] of values) {
      const number = Number(value);
      if (!Number.isFinite(number)) continue;
      seen.add(time);
      if (compareValue(number, condition.operator, threshold)) failing.push(time);
    }
    runs += new Set(failing).size;
    incidents += incidentsIn(failing, stepSeconds);
  }
  return {
    incidents,
    runs,
    checkedSeconds: Math.min(seen.size * stepSeconds, HISTORY_WINDOW_SECONDS),
    noData: seen.size === 0,
  };
};

/** Partitions may report one bucket twice, so buckets add up before the threshold applies. */
export const sqlResult = (
  buckets: SqlBucket[],
  alert: Record<string, any>,
  stepSeconds: number,
  streamAgeSeconds: number | null,
): WouldFireResult => {
  const trigger = alert.trigger_condition ?? {};
  const totals = new Map<number, number>();
  for (const { time, count } of buckets) totals.set(time, (totals.get(time) ?? 0) + count);
  const failing = [...totals.entries()]
    .filter(([, count]) => compareValue(count, trigger.operator, Number(trigger.threshold)))
    .map(([time]) => time);
  const first = Math.min(...totals.keys());
  const ownSpan = totals.size ? Date.now() / 1000 - first : 0;
  const span = Math.max(streamAgeSeconds ?? 0, ownSpan);
  return {
    incidents: incidentsIn(failing, stepSeconds),
    runs: failing.length,
    checkedSeconds: Math.round(Math.min(span, HISTORY_WINDOW_SECONDS)),
    noData: !totals.size && !streamAgeSeconds,
  };
};

export const isNoisy = (result: WouldFireResult | null): boolean =>
  !!result && result.incidents > NOISE_INCIDENTS;

export const isPartlyChecked = (result: WouldFireResult | null, longest: number): boolean =>
  !!result && !result.noData && result.checkedSeconds < longest * PARTIAL_RATIO;

/** Counts chosen rows only; short history stays low confidence and is never scaled to a day. */
export const summarize = (rows: SummaryRow[]): HistorySummary => {
  const checked = rows.filter(({ result }) => result && !result.noData);
  const chosen = checked.filter((row) => row.chosen);
  const seconds = chosen.map(({ result }) => result!.checkedSeconds);
  return {
    incidents: chosen.reduce((sum, { result }) => sum + result!.incidents, 0),
    runs: chosen.reduce((sum, { result }) => sum + result!.runs, 0),
    leftOffIncidents: checked
      .filter((row) => !row.chosen)
      .reduce((sum, { result }) => sum + result!.incidents, 0),
    lowConfidence: seconds.some((value) => value < HISTORY_WINDOW_SECONDS),
    checkedSeconds: seconds.length ? Math.min(...seconds) : 0,
  };
};

const hasAggregate = (node: unknown): boolean => {
  if (Array.isArray(node)) return node.some(hasAggregate);
  if (typeof node !== "object" || node === null) return false;
  const record = node as Record<string, unknown>;
  return record.type === AGGREGATE_FUNCTION || Object.values(record).some(hasAggregate);
};

/** The alert's filter counted per period, or null for SQL whose rows cannot be counted that way. */
export const historySql = (parser: any, sql: string, minutes: number): string | null => {
  const ast = parser.astify(sql);
  if (Array.isArray(ast)) return null;
  const bucket = parser.astify(
    `SELECT histogram(_timestamp, '${minutes} minute') AS ${HISTOGRAM_ALIAS}, COUNT(*) AS ${COUNT_ALIAS} FROM t GROUP BY ${HISTOGRAM_ALIAS}`,
  );
  const grouped = (ast.groupby?.columns ?? ast.groupby ?? []).length > 0;
  if (grouped || hasAggregate(ast.columns)) return null;
  ast.columns = bucket.columns;
  ast.groupby = bucket.groupby;
  ast.orderby = null;
  ast.limit = null;
  return parser.sqlify(ast, { database: "PostgreSQL" });
};
