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

import {
  ANOMALY_FILTER_OPERATORS,
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";

// Exactly the backend DetectionFunction percentile variants; p75/p90 would be rejected on save.
const percentileMap: Record<string, number> = {
  p50: 0.5,
  p95: 0.95,
  p99: 0.99,
};

// Engine spellings a V2 group leaf can carry that the anomaly row operator list spells differently.
const ENGINE_TO_ANOMALY_OPERATOR: Record<string, string> = {
  "!=": "<>",
  NotContains: "Not Contains",
  starts_with: "Starts With",
  ends_with: "Ends With",
  is_null: "Is Null",
  is_not_null: "Is Not Null",
};

/**
 * Converts a detection function name + field to the SQL expression for the
 * histogram query. The percentile short-names the backend accepts (p50, p95,
 * p99) are expanded to `approx_percentile_cont(field, percentile)`; any other
 * name is wrapped verbatim. Regular alerts accept a wider percentile set and
 * build their own SQL in alertQueryBuilder.ts.
 */
export const toDetectionFunctionSql = (rawFn: string, field: string): string => {
  // API may return already-wrapped forms like "p90(duration)" or "avg(size)"
  const match = rawFn.match(/^(\w+)\((.+)\)$/);
  if (match) {
    const fnName = match[1].toLowerCase();
    const fnField = match[2];
    return percentileMap[fnName]
      ? `approx_percentile_cont(${fnField}, ${percentileMap[fnName]})`
      : rawFn;
  }
  const fnLower = rawFn.toLowerCase();
  if (percentileMap[fnLower]) {
    return `approx_percentile_cont(${field || "*"}, ${percentileMap[fnLower]})`;
  }
  if (fnLower === "count") return "count(*)";
  return `${rawFn}(${field || "*"})`;
};

/**
 * Builds the SQL query for an anomaly detection config, matching the SQL Preview
 * shown during config setup.
 *
 * For custom_sql mode, returns the user-provided SQL.
 * For filters mode, generates the full SQL from stream, function and filters.
 */
export const buildAnomalyPreviewSql = (config: any): string => {
  if (!config) return "";

  if (config.query_mode === "custom_sql") {
    return config.custom_sql || "";
  }

  const streamName = config.stream_name;
  if (!streamName) return "";

  // Support both combined "5m" (API) and separate value+unit (form) formats
  const interval =
    config.histogram_interval ||
    `${config.histogram_interval_value ?? 5}${config.histogram_interval_unit ?? "m"}`;
  const rawFn = config.detection_function || "count";
  const fn = toDetectionFunctionSql(rawFn, config.detection_function_field || "*");

  const filterLines = anomalyFilterRows(config.filters)
    .filter((f: any) => f.field && (operatorNeedsValue(f.operator) ? f.value : true))
    .map((f: any) => `  AND ${buildAnomalyFilterExpression(f.field, f.operator, f.value)}`);

  const where = filterLines.length
    ? [
        "WHERE",
        ...filterLines.map((l: string, i: number) => (i === 0 ? l.replace(/^\s+AND /, "  ") : l)),
      ].join("\n")
    : "";

  return [
    `SELECT histogram(_timestamp, '${interval}') AS time_bucket,`,
    `       ${fn} AS value`,
    `FROM ${streamName}`,
    where,
    `GROUP BY time_bucket`,
    `ORDER BY time_bucket`,
  ]
    .filter(Boolean)
    .join("\n");
};

/** The anomaly filter rows; an API-written V2 group is read as rows only when it is one AND level of plain leaves, else as no rows. */
export const anomalyFilterRows = (filters: unknown): any[] => {
  if (Array.isArray(filters)) return filters;
  const group = filters as any;
  if (group?.filterType !== "group" || !Array.isArray(group.conditions)) return [];
  const andOnly = group.conditions.every(
    (leaf: any, index: number) =>
      index === 0 || String(leaf?.logicalOperator ?? "AND").toUpperCase() !== "OR",
  );
  const rows = group.conditions.map(anomalyRowOf);
  return andOnly && rows.every(Boolean) ? rows : [];
};

const anomalyRowOf = (leaf: any): { field: string; operator: string; value: string } | null => {
  if (leaf?.filterType !== "condition" || typeof leaf.column !== "string") return null;
  const operator = ENGINE_TO_ANOMALY_OPERATOR[leaf.operator] ?? leaf.operator;
  if (!(ANOMALY_FILTER_OPERATORS as readonly string[]).includes(operator)) return null;
  if (typeof leaf.value === "object" && leaf.value !== null) return null;
  return { field: leaf.column, operator, value: leaf.value == null ? "" : String(leaf.value) };
};
