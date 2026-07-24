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
 * Builds dashboard panel schemas (version 2) for the Cloud Billing → Usage
 * daily view, so they render through the shared `PanelSchemaRenderer` (the same
 * engine dashboards use). This is UI-only: the charts fire normal SQL searches
 * against the current org's own self-reporting `usage` stream — exactly like a
 * hand-built dashboard panel — so no billing API changes are needed.
 *
 * The `usage` stream carries one row per usage event with fields:
 *   `_timestamp`, `event` (Ingestion/Search/...), `size`, `stream_type`,
 *   `org_id`, `unit`.
 *
 * The daily view shows one bar chart per metric (Ingestion, Search), each
 * bucketed by day with `histogram(_timestamp, '1 day')`, so users see a daily
 * run-rate and can catch a spike without waiting for the monthly total.
 */

/** The org's own self-reporting usage stream (populated when usage reporting
 *  is enabled for the org). Matches the backend constant `USAGE_STREAM`
 *  (`src/config/src/meta/self_reporting/usage.rs`), which writes to a stream
 *  literally named `usage` in each org — NOT `_usage`. Single source of truth
 *  if a deployment names it differently. */
export const USAGE_STREAM_NAME = "usage";

export type UsageMetric = "Ingestion" | "Search" | "Pipeline" | "RemotePipeline";

/** The byte-based billable events charted daily (all except Functions, and
 *  except Data Retention / AI Credits which use different units/streams). */
export const CHART_METRICS: UsageMetric[] = ["Ingestion", "Search", "Pipeline", "RemotePipeline"];

/** Per-metric display colour (kept distinct so the lines read apart). */
const METRIC_COLOR: Record<UsageMetric, string> = {
  Ingestion: "#5960b2",
  Search: "#e6a817",
  Pipeline: "#3fb27f",
  RemotePipeline: "#c65fb2",
};

function safe(s: string): string {
  return String(s).replace(/'/g, "''");
}

/** MB→GB is done in SQL when needed so values match the card totals exactly. */
function sizeExpr(dataType: "gb" | "mb"): string {
  return dataType === "gb" ? "sum(size) / 1024" : "sum(size)";
}

/**
 * Daily-bucketed SQL for all byte-based billable metrics in one query, broken
 * down by `event` (Ingestion, Search, Pipeline, Remote Pipeline — everything
 * except Functions). Powers the single combined line chart.
 */
export function buildUsageCombinedSql(opts: { orgId: string; dataType: "gb" | "mb" }): string {
  const { orgId, dataType } = opts;
  const events = CHART_METRICS.map((e) => `'${e}'`).join(", ");
  return (
    `SELECT histogram(_timestamp, '1 day') as "x_axis_1", ` +
    `${sizeExpr(dataType)} as "y_axis_1", ` +
    `event as "breakdown_1" ` +
    `FROM "${USAGE_STREAM_NAME}" ` +
    `WHERE org_id = '${safe(orgId)}' AND event IN (${events}) ` +
    `GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`
  );
}

/**
 * Build a single combined daily LINE panel showing both metrics as separate
 * lines (broken down by `event`). One query for both series — Ingestion +
 * Search — day buckets on X, GB/MB on Y (converted in SQL, labelled here).
 */
export function buildUsageCombinedLinePanelSchema(opts: {
  orgId: string;
  dataType: "gb" | "mb";
}): any {
  const { orgId, dataType } = opts;
  const sql = buildUsageCombinedSql({ orgId, dataType });
  const unitLabel = dataType === "gb" ? "GB" : "MB";

  return {
    version: 2,
    id: "usage-daily-combined",
    title: "",
    description: "",
    type: "line",
    // Silence PanelSchemaRenderer's own error text (e.g. "stream not found:
    // usage", shown until the org reports any usage). We turn error handling
    // ON but give NO custom_error_message, so both of the renderer's error
    // blocks are suppressed — usage.vue then overlays the illustrated
    // "waiting for usage data" empty state instead.
    error_config: {
      custom_error_handeling: true,
      default_data_on_error: false,
    },
    config: {
      show_legends: true,
      legends_position: "bottom",
      unit: "custom",
      unit_custom: unitLabel,
      decimals: 2,
      axis_border_show: true,
      // Bridge gaps so each metric's line stays continuous across empty days.
      connect_nulls: true,
      no_value_replacement: "",
      show_symbol: true,
      base_map: { type: "osm" },
      map_view: { zoom: 1, lat: 0, lng: 0 },
      mark_line: [],
      // Pin the series colours so the metrics read consistently.
      color: {
        mode: "palette-classic",
        fixedColor: CHART_METRICS.map((m) => METRIC_COLOR[m]),
        seriesBy: "last",
      },
    },
    queryType: "sql",
    queries: [
      {
        query: sql,
        customQuery: true,
        vrlFunctionQuery: "",
        fields: {
          stream: USAGE_STREAM_NAME,
          stream_type: "logs",
          x: [{ alias: "x_axis_1", column: "x_axis_1", color: null, label: "Time" }],
          y: [
            {
              alias: "y_axis_1",
              column: "y_axis_1",
              color: null,
              label: unitLabel,
            },
          ],
          z: [],
          breakdown: [
            {
              alias: "breakdown_1",
              column: "breakdown_1",
              color: null,
              label: "Event",
            },
          ],
          filter: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [],
          },
          latitude: null,
          longitude: null,
          weight: null,
        },
        config: {
          promql_legend: "",
          layer_type: "scatter",
          weight_fixed: 1,
          limit: 0,
          min: 0,
          max: 100,
          time_shift: [],
        },
      },
    ],
  };
}
