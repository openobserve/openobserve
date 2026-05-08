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
 * LLM Insights panel definitions.
 *
 * Each entry describes one chart on the LLM Insights dashboard. The shape is
 * intentionally JSON-serializable so that, in a future iteration, these can be
 * persisted to and loaded from a database (organization-level dashboard
 * configuration) without changing the renderer.
 *
 * SQL query templates support these placeholders:
 *   {{stream}}    — stream name, quoted at substitution time
 *   {{startTime}} — epoch microseconds (current window start)
 *   {{endTime}}   — epoch microseconds (current window end)
 *   {{interval}}  — auto-selected histogram bucket width string ("5 minutes" etc.)
 */

export type LLMPanelType =
  | "stacked-area"
  | "histogram-with-thresholds"
  | "horizontal-bar"
  | "table";

export type LLMTableColumnFormat =
  | "time"
  | "service-chip"
  | "error"
  | "cost"
  | "view-link"
  | "text";

export interface LLMTableColumn {
  /** Hit field used as the value source. May be omitted for "view-link". */
  field?: string;
  /** Header label (rendered uppercase). */
  label: string;
  format?: LLMTableColumnFormat;
  align?: "left" | "right";
}

export type LLMValueFormat = "cost";

export interface LLMPanelQuery {
  /** SQL with {{stream}}, {{startTime}}, {{endTime}}, {{interval}} placeholders */
  sql: string;
  /** Hit field used for the time axis (bucket timestamp). */
  timeField?: string;
  /** Hit field used to break out series or as a category axis (e.g. "model"). */
  seriesField?: string;
  /** Hit field used for the y-value (or bar length). */
  valueField?: string;
  /** Legend label used when seriesField is not set. */
  seriesLabel?: string;
  /**
   * Hint to the renderer for axis / tooltip formatting.
   * - "cost": prefix with `$` and use 2-decimal precision in tooltips.
   */
  valueFormat?: LLMValueFormat;
}

export interface LLMPanelLayout {
  /** Number of grid columns this panel spans (1 or 2 in a 2-col layout). */
  colSpan: 1 | 2;
}

export interface LLMPanelDef {
  id: string;
  title: string;
  subtitle?: string;
  type: LLMPanelType;
  layout: LLMPanelLayout;
  query: LLMPanelQuery;
  /** Optional single color for monochrome panels (e.g. horizontal-bar). */
  color?: string;
  /** Optional row cap for horizontal-bar panels (top N). */
  limit?: number;
  /**
   * For time-series panels (stacked-area): how to handle missing/empty data.
   * - "zero": synthesise a flat zero line across the time range so empty results
   *   render as "0 over time" instead of "No data". Useful for absence-is-good
   *   metrics like errors / timeouts / rate-limits.
   */
  gapFill?: "zero";
  /** Column definitions for "table" panels. */
  columns?: LLMTableColumn[];
  /** Friendly message shown when the panel has no data (overrides "No data"). */
  emptyStateText?: string;
  /**
   * For "histogram-with-thresholds": optional second query that returns a
   * single row containing percentile values to render as guide lines.
   * Each entry maps a hit field name to a label & color.
   */
  thresholds?: Array<{ field: string; label: string; color: string }>;
  thresholdsQuery?: { sql: string };
}

// Time-range pruning is handled by the search engine via the start_time /
// end_time fields on the request payload — no need to repeat it in WHERE.
//
// LLM Insights panels reference only the new OTEL gen_ai_* semantic-convention
// fields. DataFusion validates column references at parse time, so referencing
// a legacy column that doesn't exist on a given stream's schema would fail
// the entire query — staying on the standard fields keeps panels portable.
const baseFilter = `gen_ai_operation_name IS NOT NULL`;

// Centralised column names so a future rename only touches this file.
const COST_FIELD = `gen_ai_usage_cost`;
const TOKENS_FIELD = `gen_ai_usage_total_tokens`;
const MODEL_FIELD = `gen_ai_response_model`;
const OBSERVATION_TYPE_FIELD = `gen_ai_operation_name`;

export const LLM_INSIGHTS_PANELS: LLMPanelDef[] = [
  {
    id: "cost-trend",
    title: "Cost trend",
    subtitle: "USD by model",
    type: "stacked-area",
    layout: { colSpan: 1 },
    query: {
      // Cost field populated by the backend extractor from
      // gen_ai.usage.cost / Langfuse cost_details — same source the Traces
      // tab uses. Falls back to the legacy llm_usage_cost_total column.
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          ${MODEL_FIELD} as model,
          COALESCE(SUM(${COST_FIELD}), 0) as cost
        FROM {{stream}}
        WHERE ${baseFilter}
          AND ${MODEL_FIELD} IS NOT NULL
        GROUP BY ts, ${MODEL_FIELD}
        ORDER BY ts
      `,
      timeField: "ts",
      seriesField: "model",
      valueField: "cost",
      valueFormat: "cost",
    },
  },
  {
    id: "token-trend",
    title: "Token trend",
    subtitle: "tokens by model",
    type: "stacked-area",
    layout: { colSpan: 1 },
    query: {
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          ${MODEL_FIELD} as model,
          COALESCE(SUM(${TOKENS_FIELD}), 0) as tokens
        FROM {{stream}}
        WHERE ${baseFilter}
          AND ${MODEL_FIELD} IS NOT NULL
        GROUP BY ts, ${MODEL_FIELD}
        ORDER BY ts
      `,
      timeField: "ts",
      seriesField: "model",
      valueField: "tokens",
    },
  },
  {
    id: "span-trend",
    title: "Span trend",
    subtitle: "span count by kind",
    type: "stacked-area",
    layout: { colSpan: 1 },
    query: {
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          LOWER(COALESCE(${OBSERVATION_TYPE_FIELD}, 'span')) as kind,
          COUNT(*) as count
        FROM {{stream}}
        WHERE ${baseFilter}
        GROUP BY ts, kind
        ORDER BY ts
      `,
      timeField: "ts",
      seriesField: "kind",
      valueField: "count",
    },
  },
  {
    id: "latency-percentiles",
    title: "Latency p50 / p95 / p99",
    subtitle: "all LLM calls",
    type: "histogram-with-thresholds",
    layout: { colSpan: 1 },
    query: {
      // Pull raw durations and bucket client-side so the bucket width adapts
      // to the actual data range (sub-millisecond traces and 30s traces both
      // render correctly). Thresholds below stay exact via approx_percentile.
      sql: `
        SELECT duration as duration_us
        FROM {{stream}}
        WHERE ${baseFilter}
        LIMIT 50000
      `,
      valueField: "duration_us",
    },
    thresholds: [
      { field: "p50_ms", label: "p50", color: "#64748b" },
      { field: "p95_ms", label: "p95", color: "#3b82f6" },
      { field: "p99_ms", label: "p99", color: "#ef4444" },
    ],
    thresholdsQuery: {
      sql: `
        SELECT
          approx_percentile_cont(duration, 0.5) / 1000.0 as p50_ms,
          approx_percentile_cont(duration, 0.95) / 1000.0 as p95_ms,
          approx_percentile_cont(duration, 0.99) / 1000.0 as p99_ms
        FROM {{stream}}
        WHERE ${baseFilter}
      `,
    },
  },
  {
    id: "traces-over-time",
    title: "Traces over time",
    subtitle: "trace count by service",
    type: "stacked-area",
    layout: { colSpan: 1 },
    query: {
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          COALESCE(service_name, 'unknown') as service,
          approx_distinct(trace_id) as count
        FROM {{stream}}
        WHERE ${baseFilter}
        GROUP BY ts, COALESCE(service_name, 'unknown')
        ORDER BY ts
      `,
      timeField: "ts",
      seriesField: "service",
      valueField: "count",
    },
  },
  {
    id: "errors-over-time",
    title: "Errors over time",
    subtitle: "error count",
    type: "stacked-area",
    layout: { colSpan: 1 },
    color: "#ef4444",
    gapFill: "zero",
    query: {
      // No baseFilter: OTel SDKs typically propagate the failure to a deep
      // child span (e.g. tool.<name>) which doesn't carry
      // gen_ai_operation_name. The chosen stream is LLM-marked, so every
      // error in it is relevant to the dashboard.
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          COUNT(*) as count
        FROM {{stream}}
        WHERE span_status = 'ERROR'
        GROUP BY ts
        ORDER BY ts
      `,
      timeField: "ts",
      valueField: "count",
      seriesLabel: "errors",
    },
  },
  {
    id: "spans-by-model",
    title: "Spans by model",
    subtitle: "call count per model",
    type: "horizontal-bar",
    layout: { colSpan: 1 },
    color: "#3b82f6",
    limit: 10,
    query: {
      sql: `
        SELECT
          COALESCE(${MODEL_FIELD}, 'unknown') as model,
          COUNT(*) as count
        FROM {{stream}}
        WHERE ${baseFilter}
        GROUP BY COALESCE(${MODEL_FIELD}, 'unknown')
        ORDER BY count DESC
      `,
      seriesField: "model",
      valueField: "count",
    },
  },
  {
    id: "tokens-by-model",
    title: "Tokens by model",
    subtitle: "total tokens per model",
    type: "horizontal-bar",
    layout: { colSpan: 1 },
    color: "#a855f7",
    limit: 10,
    query: {
      sql: `
        SELECT
          COALESCE(${MODEL_FIELD}, 'unknown') as model,
          COALESCE(SUM(${TOKENS_FIELD}), 0) as tokens
        FROM {{stream}}
        WHERE ${baseFilter}
        GROUP BY COALESCE(${MODEL_FIELD}, 'unknown')
        ORDER BY tokens DESC
      `,
      seriesField: "model",
      valueField: "tokens",
    },
  },
  {
    id: "recent-errors",
    title: "Recent errors",
    subtitle: "last 10 failed spans",
    type: "table",
    layout: { colSpan: 2 },
    emptyStateText: "No errors in this time range",
    query: {
      // No baseFilter for the same reason as errors-over-time. Operation
      // label uses `operation_name` (the actual OO traces column) — `span_name`
      // does not exist in the schema and would fail at SQL parse time, which
      // was producing the "Failed to fetch query data" error.
      //
      // We deliberately don't surface model/cost here: the failure usually
      // lives on a deep child span (e.g. `tool.<name>`) which doesn't carry
      // those attributes — the LLM call that triggered the tool does, but
      // joining back up the trace is out of scope for this panel. The
      // dedicated Cost / Tokens panels handle attribution.
      sql: `
        SELECT
          _timestamp,
          COALESCE(service_name, 'unknown') as service_name,
          COALESCE(operation_name, '—') as operation,
          trace_id
        FROM {{stream}}
        WHERE span_status = 'ERROR'
        ORDER BY _timestamp DESC
        LIMIT 10
      `,
    },
    columns: [
      { field: "_timestamp", label: "Time", format: "time" },
      { field: "service_name", label: "Service", format: "service-chip" },
      { field: "operation", label: "Operation", format: "error" },
      { field: "trace_id", label: "Trace ID", format: "text" },
      { field: "trace_id", label: "", format: "view-link", align: "right" },
    ],
  },
];

/**
 * Substitute the standard placeholders in a SQL template.
 */
export function renderPanelSql(
  sql: string,
  ctx: {
    stream: string;
    startTime: number;
    endTime: number;
    interval: string;
  },
): string {
  return sql
    .replace(/\{\{stream\}\}/g, `"${ctx.stream}"`)
    .replace(/\{\{startTime\}\}/g, String(ctx.startTime))
    .replace(/\{\{endTime\}\}/g, String(ctx.endTime))
    .replace(/\{\{interval\}\}/g, ctx.interval);
}

/**
 * Choose a histogram bucket width that yields roughly 30 buckets across the
 * given window. Mirrors the helper used by KPI sparklines so panels remain
 * visually aligned.
 */
export function pickInterval(durationMicros: number): string {
  const seconds = durationMicros / 1_000_000;
  const target = seconds / 30;
  if (target < 30) return "10 seconds";
  if (target < 120) return "1 minute";
  if (target < 600) return "5 minutes";
  if (target < 1800) return "15 minutes";
  if (target < 3600) return "30 minutes";
  if (target < 21_600) return "1 hour";
  if (target < 86_400) return "6 hours";
  return "1 day";
}
