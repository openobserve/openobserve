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

import { type I18nKey } from "@/types/i18n";
import type { AiAlertKind } from "@/utils/alerts/prefill/fromAi";
import { LLM_ERRORS_COLOR, LLM_TRACES_COLOR } from "@/utils/dashboard/colorPalette";

export type LLMPanelType =
  | "stacked-area"
  | "stacked-bar"
  | "line"
  | "horizontal-bar"
  /** The errors grouped by message (LLMTopErrorsTable). */
  | "error-table"
  /** The failing-tools ranking (LLMFailingToolsTable). */
  | "tool-table";

export type LLMValueFormat = "cost" | "latency-ms";

export interface LLMPanelQuery {
  /** SQL with {{stream}}, {{startTime}}, {{endTime}}, {{interval}} placeholders */
  sql: string;
  /** Hit field used for the time axis (bucket timestamp). */
  timeField?: string;
  /** Hit field used to break out series or as a category axis (e.g. "model"). */
  seriesField?: string;
  /** Hit field used for the y-value (or bar length). */
  valueField?: string;
  /**
   * i18n KEY for the legend label used when seriesField is not set. Resolved by
   * `buildLLMPanelSchema`: this module is a plain config, so a resolved string
   * would not follow the locale.
   */
  seriesLabelKey?: I18nKey;
  /**
   * Several value columns drawn as one series each (input and output tokens),
   * in place of `valueField`; the label is the legend name. `color` pins the
   * series colour; `errored` is what a click on the series lists: errored
   * traces (true) or traces without an error (false).
   */
  measures?: Array<{ field: string; labelKey: I18nKey; color?: string; errored?: boolean }>;
  /**
   * Hint to the renderer for axis / tooltip formatting.
   * - "cost": prefix with `$` and use 2-decimal precision in tooltips.
   */
  valueFormat?: LLMValueFormat;
  /**
   * Keep only the `n` series with the largest window total (a stream can carry
   * dozens of models). `others` folds the rest into one "others" series, for
   * values that add up (cost); percentiles do not, so latency drops the rest.
   */
  topSeries?: { n: number; others: boolean };
}

export interface LLMPanelLayout {
  /** Number of grid columns this panel spans (1 or 2 in a 2-col layout). */
  colSpan: 1 | 2;
}

export interface LLMPanelDef {
  id: string;
  /** i18n KEY for the panel heading, resolved by the panel component. */
  titleKey: I18nKey;
  /** i18n KEY for the panel sub-heading. */
  subtitleKey?: I18nKey;
  type: LLMPanelType;
  layout: LLMPanelLayout;
  query: LLMPanelQuery;
  /** Optional single color for monochrome panels (e.g. horizontal-bar). */
  color?: string;
  /** Optional row cap for horizontal-bar panels (top N). */
  limit?: number;
  /**
   * Click-through (AIO-26): what a clicked point selects. `seriesSql` is the
   * expression the series/category value was computed from (a trace matches
   * when any span has that value); `errored` selects the traces with an
   * errored span.
   */
  drill?: { seriesSql?: string; errored?: true };
  /** "Create alert" from this panel (AIO-20): the pack template it maps to. */
  alert?: AiAlertKind;
}

/** The series expressions a drill can select on, shared with the panels. */
export const MODEL_SERIES_SQL = "gen_ai_response_model";
const TOOL_SERIES_SQL = "gen_ai_tool_name";
/** The failing span's status message; a span with none groups under "". */
export const ERROR_MESSAGE_SQL = "COALESCE(status_message, '')";

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
const INPUT_TOKENS_FIELD = `gen_ai_usage_input_tokens`;
const OUTPUT_TOKENS_FIELD = `gen_ai_usage_output_tokens`;
const TOTAL_TOKENS_FIELD = `gen_ai_usage_total_tokens`;
const MODEL_FIELD = `gen_ai_response_model`;
const OBSERVATION_TYPE_FIELD = `gen_ai_operation_name`;

// Scope for every panel that groups by model. `baseFilter` alone admits ALL
// gen_ai spans — including `execute_tool` children and evaluator spans, which
// legitimately carry no model (the OTEL gen_ai conventions only put a model on
// generation/embedding operations). Bucketing those under a synthetic
// "unknown" model made them dominate the per-model panels: an agent emits one
// generation span per turn but a tool span per tool call, so "unknown" read as
// ~9x the real model and its token bar was always a flat zero.
const modelScopedFilter = `${baseFilter} AND ${MODEL_FIELD} IS NOT NULL`;

// Operations that are LLM calls (mirrors GENERATION_GEN_AI_OPERATIONS in
// src/config/src/meta/traces.rs). Agent/workflow spans repeat their children's
// usage, so summing every span double-counts tokens and cost.
const GENERATION_GEN_AI_OPERATIONS = ["chat", "text_completion", "generate_content", "embeddings"];

/**
 * SUM of a usage column over LLM-call spans only — the same rule the backend
 * applies to trace/session totals. A span without an operation name counts.
 *
 * Every LLM Insights query already references `gen_ai_operation_name`, so a
 * stream without that column fails at parse time and lands on the "no LLM
 * fields" empty state; there is no plain-SUM fallback to pick here.
 *
 * @example
 *   llmCallUsageSum("gen_ai_usage_cost")
 *   // => SUM(CASE WHEN (gen_ai_operation_name IS NULL OR gen_ai_operation_name IN ('chat', ...)) THEN gen_ai_usage_cost ELSE 0 END)
 */
export function llmCallUsageSum(column: string): string {
  const ops = GENERATION_GEN_AI_OPERATIONS.map((op) => `'${op}'`).join(", ");
  const predicate = `(${OBSERVATION_TYPE_FIELD} IS NULL OR ${OBSERVATION_TYPE_FIELD} IN (${ops}))`;
  return `SUM(CASE WHEN ${predicate} THEN ${column} ELSE 0 END)`;
}

/** The largest `invoke_agent` span's usage: the outermost agent's rollup. */
export const agentSpanUsage = (column: string) =>
  `MAX(CASE WHEN ${OBSERVATION_TYPE_FIELD} = 'invoke_agent' THEN ${column} END)`;

/**
 * Inside `GROUP BY trace_id`: the agent-span usage a trace's total falls back
 * to when none of its LLM calls carries any (`traceUsageSum`), else 0. That
 * usage has no LLM call to take a model from, so per-model views show it as
 * unattributed.
 */
export const agentFallbackUsage = (column: string) =>
  `CASE WHEN COALESCE(${llmCallUsageSum(column)}, 0) = 0 ` +
  `THEN COALESCE(${agentSpanUsage(column)}, 0) ELSE 0 END`;

/**
 * The traces whose usage is only on their agent span, one row each, placed in
 * the bucket of their first span. A trace is judged whole, not per bucket, so a
 * trace whose agent span and LLM calls fall in different buckets never counts
 * twice. Its first span's time is projected as `first_ts` (the search layer
 * forbids aliasing `_timestamp`), which the outer `histogram(first_ts, …)` buckets.
 */
function agentOnlyTracesSql(columns: Array<[string, string]>, havingColumn: string): string {
  const projected = columns.map(([col, alias]) => `${agentFallbackUsage(col)} as ${alias}`);
  return `
    SELECT trace_id, MIN(_timestamp) as first_ts, ${projected.join(", ")}
    FROM {{stream}}
    WHERE trace_id IS NOT NULL{{scope}}
    GROUP BY trace_id
    HAVING ${agentFallbackUsage(havingColumn)} > 0`;
}

// Top to bottom: is it healthy (traffic with its errors, latency), what is
// breaking (errors by message, failing tools), then what it costs (cost and
// token trends). Pairs of one-column panels, so every row is full.
export const LLM_INSIGHTS_PANELS: LLMPanelDef[] = [
  {
    // Traces per bucket, split into OK and errored, so the errors read against
    // the traffic. Counted the way the KPI strip counts them (approx_distinct of
    // trace_id; errored = any ERROR span), so the bars add up to the Traces tile
    // and the red part to the Error rate tile's numerator.
    id: "traces-over-time",
    titleKey: "aiObservability.panels.tracesOverTime.title",
    subtitleKey: "aiObservability.panels.tracesOverTime.subtitle",
    type: "stacked-bar",
    layout: { colSpan: 1 },
    // A click lists the bucket's traces of the clicked series (`measures[].errored`).
    drill: {},
    alert: "failure_rate",
    query: {
      // No baseFilter: OTel SDKs typically propagate the failure to a deep
      // child span (e.g. tool.<name>) which doesn't carry
      // gen_ai_operation_name, and the KPI strip counts every trace too. The
      // WHERE is there for renderPanelSql to splice the scope onto.
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          approx_distinct(trace_id) - approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR') as ok,
          approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR') as errored
        FROM {{stream}}
        WHERE trace_id IS NOT NULL
        GROUP BY ts
        ORDER BY ts
      `,
      timeField: "ts",
      measures: [
        {
          field: "ok",
          labelKey: "aiObservability.panels.tracesOverTime.ok",
          color: LLM_TRACES_COLOR,
          errored: false,
        },
        {
          field: "errored",
          labelKey: "aiObservability.panels.tracesOverTime.errored",
          color: LLM_ERRORS_COLOR,
          errored: true,
        },
      ],
    },
  },
  {
    id: "latency-trend",
    titleKey: "aiObservability.panels.latencyByModel.title",
    subtitleKey: "aiObservability.panels.latencyByModel.subtitle",
    // A line per model, not stacked: percentiles of two models do not add up.
    // A bucket with no calls is a gap, not a line drawn through it.
    type: "line",
    layout: { colSpan: 1 },
    drill: { seriesSql: MODEL_SERIES_SQL },
    query: {
      // p95 of each model's LLM calls (ms) per bucket. Scoped to LLM calls so
      // fast tool/child spans don't drag the tail down.
      sql: `
        SELECT
          histogram(_timestamp, '{{interval}}') as ts,
          ${MODEL_FIELD} as model,
          approx_percentile_cont(duration, 0.95) / 1000.0 as p95
        FROM {{stream}}
        WHERE ${modelScopedFilter}
        GROUP BY ts, ${MODEL_FIELD}
        ORDER BY ts
      `,
      timeField: "ts",
      seriesField: "model",
      // The alias is the axis label; the unit formatter adds ms / s.
      valueField: "p95",
      valueFormat: "latency-ms",
      topSeries: { n: 10, others: false },
    },
  },
  {
    // What fails, by the message the failing span set (the OTel status
    // message): where it happened, the traces it hit and when it was last
    // seen. Spans with no message share the "" row. `operation` is one of the
    // operations the message came from (MIN, so it is stable across reloads)
    // and `operations` how many there are.
    id: "top-errors",
    titleKey: "aiObservability.panels.topErrors.title",
    subtitleKey: "aiObservability.panels.topErrors.subtitle",
    type: "error-table",
    layout: { colSpan: 1 },
    drill: { seriesSql: ERROR_MESSAGE_SQL, errored: true },
    query: {
      // No baseFilter, for the same reason as traces-over-time.
      sql: `
        SELECT
          ${ERROR_MESSAGE_SQL} as message,
          MIN(operation_name) as operation,
          approx_distinct(operation_name) as operations,
          approx_distinct(trace_id) as traces,
          MAX(_timestamp) as last_seen
        FROM {{stream}}
        WHERE span_status = 'ERROR'
        GROUP BY ${ERROR_MESSAGE_SQL}
        ORDER BY traces DESC
        LIMIT 10
      `,
    },
  },
  {
    // Which tools keep failing: the 10 tools with the most failed calls, with
    // failed and total calls (for the failure rate), the traces with a failed
    // call, and the last failure. Counts the tool-call spans themselves: every
    // span carries the agent's canonical name, so the agent filter needs no
    // parent climb.
    id: "failing-tools",
    titleKey: "aiObservability.panels.failingTools.title",
    subtitleKey: "aiObservability.panels.failingTools.subtitle",
    type: "tool-table",
    layout: { colSpan: 1 },
    drill: { seriesSql: TOOL_SERIES_SQL, errored: true },
    query: {
      sql: `
        SELECT
          ${TOOL_SERIES_SQL} as tool,
          SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) as failures,
          COUNT(*) as calls,
          approx_distinct(CASE WHEN span_status = 'ERROR' THEN trace_id END) as traces,
          MAX(CASE WHEN span_status = 'ERROR' THEN _timestamp END) as last_failed
        FROM {{stream}}
        WHERE ${OBSERVATION_TYPE_FIELD} = 'execute_tool' AND ${TOOL_SERIES_SQL} IS NOT NULL
        GROUP BY ${TOOL_SERIES_SQL}
        HAVING SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) > 0
        ORDER BY failures DESC
        LIMIT 10
      `,
    },
  },
  {
    id: "cost-trend",
    titleKey: "aiObservability.panels.costTrend.title",
    subtitleKey: "aiObservability.panels.costTrend.subtitle",
    type: "stacked-bar",
    layout: { colSpan: 1 },
    drill: { seriesSql: MODEL_SERIES_SQL },
    alert: "cost",
    query: {
      // Cost field populated by the backend extractor from
      // gen_ai.usage.cost / Langfuse cost_details — same source the Traces
      // tab uses. Each model's LLM-call cost per bucket, plus the traces whose
      // cost is only on their agent span as the unattributed series, so the
      // bars add up to the Total Cost tile (the rule of `traceUsageSum`).
      sql: `
        SELECT ts, model, SUM(cost) as cost
        FROM (
          SELECT
            histogram(_timestamp, '{{interval}}') as ts,
            ${MODEL_FIELD} as model,
            COALESCE(${llmCallUsageSum(COST_FIELD)}, 0) as cost
          FROM {{stream}}
          WHERE ${modelScopedFilter}{{scope}}
          GROUP BY ts, ${MODEL_FIELD}
          UNION ALL
          SELECT histogram(first_ts, '{{interval}}') as ts, {{unattributed}} as model, cost
          FROM (${agentOnlyTracesSql([[COST_FIELD, "cost"]], COST_FIELD)})
        )
        GROUP BY ts, model
        ORDER BY ts
      `,
      timeField: "ts",
      seriesField: "model",
      valueField: "cost",
      valueFormat: "cost",
      topSeries: { n: 10, others: true },
    },
  },
  {
    id: "token-trend",
    titleKey: "aiObservability.panels.tokenTrend.title",
    subtitleKey: "aiObservability.panels.tokenTrend.subtitle",
    type: "stacked-bar",
    layout: { colSpan: 1 },
    // A click lists the bucket's traces; input and output are measures, not a filter.
    drill: {},
    query: {
      // Input and output tokens of LLM calls per bucket, stacked: together they
      // are the bucket's total. A trace whose tokens are only on its agent span
      // counts those, as the Total Tokens tile does.
      sql: `
        SELECT ts, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
        FROM (
          SELECT
            histogram(_timestamp, '{{interval}}') as ts,
            COALESCE(${llmCallUsageSum(INPUT_TOKENS_FIELD)}, 0) as input_tokens,
            COALESCE(${llmCallUsageSum(OUTPUT_TOKENS_FIELD)}, 0) as output_tokens
          FROM {{stream}}
          WHERE ${baseFilter}{{scope}}
          GROUP BY ts
          UNION ALL
          SELECT histogram(first_ts, '{{interval}}') as ts, input_tokens, output_tokens
          FROM (${agentOnlyTracesSql(
            [
              [INPUT_TOKENS_FIELD, "input_tokens"],
              [OUTPUT_TOKENS_FIELD, "output_tokens"],
            ],
            TOTAL_TOKENS_FIELD,
          )})
        )
        GROUP BY ts
        ORDER BY ts
      `,
      timeField: "ts",
      measures: [
        { field: "input_tokens", labelKey: "aiObservability.panels.tokenTrend.input" },
        { field: "output_tokens", labelKey: "aiObservability.panels.tokenTrend.output" },
      ],
    },
  },
];

/**
 * Substitute the standard placeholders in a SQL template with concrete values.
 *
 * Replaces (globally, all occurrences):
 *   {{stream}}     → `"streamName"` (always quoted — DataFusion treats unquoted
 *                                    identifiers as case-insensitive)
 *   {{startTime}}  → numeric microseconds, unquoted
 *   {{endTime}}    → numeric microseconds, unquoted
 *   {{interval}}   → bucket width string ("5 minutes", "1 hour", etc.) — used
 *                                    only inside `histogram(_timestamp, '…')`
 *   {{scope}}      → ` AND (<agentFilter>)`, or nothing: a template with several
 *                                    WHEREs (a UNION) marks each one to scope
 *   {{unattributed}} → the quoted series name for usage with no model
 *
 * @example
 *   renderPanelSql(
 *     `SELECT histogram(_timestamp, '{{interval}}') FROM {{stream}}`,
 *     { stream: "default", startTime: 1700000000000000, endTime: 1700001000000000, interval: "1 minute" },
 *   )
 *   // => `SELECT histogram(_timestamp, '1 minute') FROM "default"`
 */
export function renderPanelSql(
  sql: string,
  ctx: {
    stream: string;
    startTime: number;
    endTime: number;
    interval: string;
    // Bare agent predicate (no leading AND). Empty = "All Agents".
    // Auto-spliced into each panel's WHERE (see below).
    agentFilter?: string;
    /** Translated name of the series for usage with no model ({{unattributed}}). */
    unattributedLabel?: string;
  },
): string {
  const marked = sql.includes("{{scope}}");
  const rendered = sql
    .replace(/\{\{stream\}\}/g, `"${ctx.stream}"`)
    .replace(/\{\{startTime\}\}/g, String(ctx.startTime))
    .replace(/\{\{endTime\}\}/g, String(ctx.endTime))
    .replace(/\{\{interval\}\}/g, ctx.interval)
    // Function replacers: a `$` in a user's filter or label is not a replacement pattern.
    .replace(/\{\{scope\}\}/g, () => (ctx.agentFilter ? ` AND (${ctx.agentFilter})` : ""))
    .replace(
      /\{\{unattributed\}\}/g,
      () => `'${(ctx.unattributedLabel ?? "Unattributed").replace(/'/g, "''")}'`,
    );

  if (!ctx.agentFilter || marked) return compactSql(rendered);

  // Append the agent predicate to the query's WHERE clause. Every panel has
  // exactly one flat WHERE, so we splice ` AND
  // <agentFilter>` in just before the first GROUP BY / ORDER BY / LIMIT (or at
  // the end if none). Panel templates carry no subqueries of their own, so the
  // first such keyword always belongs to the main query, not the agent
  // sub-select that gets inserted here.
  const clause = ` AND ${ctx.agentFilter} `;
  const tail = rendered.match(/\b(group\s+by|order\s+by|limit)\b/i);
  if (tail && tail.index !== undefined) {
    return compactSql(rendered.slice(0, tail.index) + clause + rendered.slice(tail.index));
  }
  return compactSql(`${rendered}${clause}`);
}

/**
 * Collapse a multi-line SQL template into a single clean line.
 *
 * Flattens all runs of whitespace — newlines, tabs, leading indentation — down
 * to a single space and trims the ends. The result is byte-for-byte equivalent
 * SQL: none of these queries embed intentional multi-space string literals
 * (`'1 hour'`, `'5 minutes'` etc. keep their single space), so collapsing
 * whitespace can't alter any value.
 *
 * @example
 *   compactSql(`
 *     SELECT a
 *     FROM "default"
 *     WHERE b IS NOT NULL
 *   `)
 *   // => `SELECT a FROM "default" WHERE b IS NOT NULL`
 */
export function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * Choose a histogram bucket width that yields roughly 30 buckets across the
 * given window. Mirrors the helper used by KPI sparklines so panels remain
 * visually aligned (same bucket → same x-axis ticks → same tooltips).
 *
 * The breakpoints are chosen so that "Past 15 minutes" → 30 × 30s = 15 min,
 * "Past 1 hour" → 30 × ~2min = ~60 min (rounded to "1 minute" buckets), etc.
 *
 * @param durationMicros window duration in microseconds (endTime - startTime)
 * @returns interval string accepted by DataFusion's `histogram()` function
 *
 * Branch boundaries (strict `<` at each threshold):
 *   duration <  15 min  → "10 seconds"
 *   duration <   1 hr   → "1 minute"
 *   duration <   5 hr   → "5 minutes"
 *   duration <  15 hr   → "15 minutes"
 *   duration <  30 hr   → "30 minutes"
 *   duration <   7.5 d  → "1 hour"
 *   duration <  30 d    → "6 hours"
 *   else                → "1 day"
 *
 * @example
 *   pickInterval(10 * 60 * 1_000_000)     // "10 seconds" (10 min window)
 *   pickInterval(30 * 60 * 1_000_000)     // "1 minute"   (30 min window)
 *   pickInterval(3 * 3600 * 1_000_000)    // "5 minutes"  (3 hr window)
 *   pickInterval(12 * 3600 * 1_000_000)   // "15 minutes" (12 hr window)
 *   pickInterval(24 * 3600 * 1_000_000)   // "30 minutes" (24 hr window)
 *   pickInterval(5 * 86400 * 1_000_000)   // "1 hour"     (5 day window)
 *   pickInterval(14 * 86400 * 1_000_000)  // "6 hours"    (14 day window)
 *   pickInterval(60 * 86400 * 1_000_000)  // "1 day"      (60 day window)
 */
/**
 * Width (µs) of the buckets `histogram(_timestamp)` picks for a window, so a
 * clicked bar maps back to its time range. Mirrors `generate_histogram_interval`
 * in src/search/src/sql/visitor/histogram_interval.rs.
 */
export function autoHistogramBucketMicros(startMicros: number, endMicros: number): number {
  const HOUR = 3_600_000_000;
  const range = endMicros - startMicros;
  const steps: Array<[number, number]> = [
    [24 * 60 * HOUR, 24 * HOUR],
    [24 * 30 * HOUR, 12 * HOUR],
    [24 * 28 * HOUR, 6 * HOUR],
    [24 * 21 * HOUR, 3 * HOUR],
    [24 * 15 * HOUR, 2 * HOUR],
    [6 * HOUR, HOUR],
    [2 * HOUR, 60_000_000],
    [HOUR, 30_000_000],
    [HOUR / 2, 15_000_000],
    [10_000_000, 10_000_000],
  ];
  for (const [atLeast, width] of steps) if (range >= atLeast) return width;
  return 1_000_000;
}

export function pickInterval(durationMicros: number): string {
  // Target ~30 buckets across the window — the histogram() arg is chosen
  // by checking which "round" interval slot the per-bucket width falls in.
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
