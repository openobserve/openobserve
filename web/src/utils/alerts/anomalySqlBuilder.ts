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
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";

/**
 * Builds the SQL query for an anomaly detection config, including seasonality
 * columns (hour, dow) that match the SQL Preview shown during config setup.
 *
 * For custom_sql mode, returns the user-provided SQL.
 * For filters mode, generates the full SQL from stream, function, filters, and
 * training window.
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
  // The API may return "count(*)" or "avg(field)" (with parens already),
  // while the form stores "count" + separate field. Handle both.
  const fnAlreadyWrapped = rawFn.includes("(");
  const fn = fnAlreadyWrapped
    ? rawFn
    : rawFn === "count"
      ? "count(*)"
      : `${rawFn}(${config.detection_function_field || "*"})`;

  const filterLines = (config.filters || [])
    .filter(
      (f: any) =>
        f.field && (operatorNeedsValue(f.operator) ? f.value : true),
    )
    .map(
      (f: any) =>
        `  AND ${buildAnomalyFilterExpression(f.field, f.operator, f.value)}`,
    );

  const where = filterLines.length
    ? [
        "WHERE",
        ...filterLines.map((l: string, i: number) =>
          i === 0 ? l.replace(/^\s+AND /, "  ") : l,
        ),
      ].join("\n")
    : "";

  // Seasonality columns based on training window (matches AddAlert SQL preview)
  const trainingDays = config.training_window_days ?? 14;
  const autoSeasonality = trainingDays >= 7 ? "week" : "day";
  const seasonalSelect =
    autoSeasonality === "week"
      ? ",\n       date_part('hour', to_timestamp(_timestamp / 1000000)) AS hour,\n       date_part('dow', to_timestamp(_timestamp / 1000000)) AS dow"
      : ",\n       date_part('hour', to_timestamp(_timestamp / 1000000)) AS hour";
  const seasonalGroup =
    autoSeasonality === "week" ? ", hour, dow" : ", hour";

  return [
    `SELECT histogram(_timestamp, '${interval}') AS time_bucket,`,
    `       ${fn} AS value${seasonalSelect}`,
    `FROM ${streamName}`,
    where,
    `GROUP BY time_bucket${seasonalGroup}`,
    `ORDER BY time_bucket`,
  ]
    .filter(Boolean)
    .join("\n");
};
