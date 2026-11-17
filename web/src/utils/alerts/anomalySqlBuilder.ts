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
import { conditionListValues } from "@/utils/alerts/conditionsFormatter";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

// Exactly the backend DetectionFunction percentile variants; p75/p90 would be rejected on save.
const percentileMap: Record<string, number> = {
  p50: 0.5,
  p95: 0.95,
  p99: 0.99,
};

// Engine spellings (UI and backend serde names) a V2 group leaf can carry that the anomaly row operator list spells differently.
const ENGINE_TO_ANOMALY_OPERATOR: Record<string, string> = {
  "!=": "<>",
  contains: "Contains",
  NotContains: "Not Contains",
  not_contains: "Not Contains",
  starts_with: "Starts With",
  ends_with: "Ends With",
  IsNull: "Is Null",
  is_null: "Is Null",
  IsNotNull: "Is Not Null",
  is_not_null: "Is Not Null",
  in: "IN",
  not_in: "NOT IN",
  regex: "re_match",
  not_regex: "re_not_match",
};

const CONTAINS_OPERATORS = new Set(["Contains", "str_match"]);

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

  const where = anomalyWhereClause(config.filters);

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

/** The preview WHERE clause: saved rows exactly as main renders them, or a V2 group as its AND/OR expression. */
export const anomalyWhereClause = (filters: unknown): string => {
  const group = filters as any;
  if (group?.filterType === "group" && Array.isArray(group.conditions)) {
    const parts = groupParts(group);
    return parts.length ? ["WHERE", ...parts.map((part) => `  ${part}`)].join("\n") : "";
  }
  const filterLines = (Array.isArray(filters) ? filters : [])
    .filter((f: any) => f.field && (operatorNeedsValue(f.operator) ? f.value : true))
    .map((f: any) => `  AND ${buildAnomalyFilterExpression(f.field, f.operator, f.value)}`);
  return filterLines.length
    ? [
        "WHERE",
        ...filterLines.map((l: string, i: number) => (i === 0 ? l.replace(/^\s+AND /, "  ") : l)),
      ].join("\n")
    : "";
};

// Each item carries the connector written before it, as in conditionsFormatter; the first part written takes none.
const groupParts = (group: any): string[] => {
  const parts: string[] = [];
  for (const item of group.conditions) {
    const text = nodeSql(item);
    if (!text) continue;
    const connector = String(item?.logicalOperator ?? "AND").toUpperCase() === "OR" ? "OR" : "AND";
    parts.push(parts.length ? `${connector} ${text}` : text);
  }
  return parts;
};

const nodeSql = (node: any): string => {
  if (node?.filterType === "group" && Array.isArray(node.conditions)) {
    const inner = groupParts(node).join(" ");
    return inner ? `(${inner})` : "";
  }
  return leafSql(node);
};

const leafSql = (leaf: any): string => {
  if (leaf?.filterType !== "condition" || typeof leaf.column !== "string" || !leaf.column) {
    return "";
  }
  const operator = anomalyOperatorOf(leaf);
  if (!operator) return "";
  if (operator === "IN" || operator === "NOT IN") {
    const items = conditionListValues(leaf.value);
    if (!items.length) return "";
    const list = items.map((item) => sqlLiteral(String(item ?? ""))).join(", ");
    return buildAnomalyFilterExpression(leaf.column, operator, list);
  }
  if (typeof leaf.value === "object" && leaf.value !== null) return "";
  const value = leaf.value == null ? "" : String(leaf.value);
  if (operatorNeedsValue(operator) && !value) return "";
  return buildAnomalyFilterExpression(leaf.column, operator, value);
};

const anomalyOperatorOf = (leaf: any): string | null => {
  const operator = ENGINE_TO_ANOMALY_OPERATOR[leaf.operator] ?? leaf.operator;
  if (CONTAINS_OPERATORS.has(operator) && leaf.case_insensitive === true) {
    return "str_match_ignore_case";
  }
  return (ANOMALY_FILTER_OPERATORS as readonly string[]).includes(operator) ? operator : null;
};
