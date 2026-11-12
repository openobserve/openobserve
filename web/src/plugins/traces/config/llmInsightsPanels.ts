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
  /** i18n key for the legend label when seriesField is unset, resolved per locale. */
  seriesLabelKey?: I18nKey;
  /** Series drawn one per value column; `errored` picks errored (true) or error-free (false) traces on click. */
  measures?: Array<{ field: string; labelKey: I18nKey; color?: string; errored?: boolean }>;
  /**
   * Hint to the renderer for axis / tooltip formatting.
   * - "cost": prefix with `$` and use 2-decimal precision in tooltips.
   */
  valueFormat?: LLMValueFormat;
  /** Keep the top `n` series; `others` folds the rest only for additive values (percentiles don't add up). */
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
  /** A trace matches when any span has the `seriesSql` value; `errored` selects errored traces. */
  drill?: { seriesSql?: string; errored?: true };
  /** "Create alert" from this panel: the pack template it maps to. */
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

const AGENT_SPAN = `${OBSERVATION_TYPE_FIELD} = 'invoke_agent'`;

/** Stored column holding a span's parent span id; a stream whose spans never had a parent lacks it. */
export const PARENT_SPAN_FIELD = "reference_parent_span_id";

/** Joins each span to its `invoke_agent` parent; without the parent column every agent span is top-level. Mirrors `agent_parents_join` in session.rs. */
export function agentParentsJoin(stream: string, hasParentSpan: boolean): string {
  const agents = `SELECT DISTINCT trace_id AS agent_parent_trace, span_id AS agent_parent_span FROM "${stream}"`;
  return hasParentSpan
    ? ` LEFT JOIN (${agents} WHERE ${AGENT_SPAN}) AS agent_parents ` +
        `ON trace_id = agent_parent_trace AND ${PARENT_SPAN_FIELD} = agent_parent_span`
    : ` LEFT JOIN (${agents} WHERE false) AS agent_parents ON trace_id = agent_parent_trace`;
}

/** Nested agents are skipped because their parent's usage already includes theirs; needs `agentParentsJoin` in FROM. */
export const topLevelAgentUsage = (column: string) =>
  `SUM(CASE WHEN ${AGENT_SPAN} AND agent_parent_span IS NULL THEN ${column} END)`;

/** Top-level agent usage when no LLM call in the trace carries any; per-model views show it as unattributed. */
export const agentFallbackUsage = (column: string) =>
  `CASE WHEN COALESCE(${llmCallUsageSum(column)}, 0) = 0 ` +
  `THEN COALESCE(${topLevelAgentUsage(column)}, 0) ELSE 0 END`;

/** Agent-only traces judged whole (not per bucket) so they never count twice; `first_ts` because `_timestamp` cannot be aliased. */
function agentOnlyTracesSql(columns: Array<[string, string]>, havingColumn: string): string {
  const projected = columns.map(([col, alias]) => `${agentFallbackUsage(col)} as ${alias}`);
  return `
    SELECT trace_id, MIN(_timestamp) as first_ts, ${projected.join(", ")}
    FROM {{stream}}{{agentParents}}
    WHERE trace_id IS NOT NULL{{scope}}
    GROUP BY trace_id
    HAVING ${agentFallbackUsage(havingColumn)} > 0`;
}

export const LLM_INSIGHTS_PANELS: LLMPanelDef[] = [
  {
    // Counted like the KPI strip (approx_distinct trace_id) so the bars add up to the Traces tile.
    id: "traces-over-time",
    titleKey: "aiObservability.panels.tracesOverTime.title",
    subtitleKey: "aiObservability.panels.tracesOverTime.subtitle",
    type: "stacked-bar",
    layout: { colSpan: 1 },
    // A click lists the bucket's traces of the clicked series (`measures[].errored`).
    drill: {},
    alert: "failure_rate",
    query: {
      // No baseFilter: failures land on deep child spans without gen_ai_operation_name.
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
    // Not stacked: percentiles of two models do not add up.
    type: "line",
    layout: { colSpan: 1 },
    drill: { seriesSql: MODEL_SERIES_SQL },
    query: {
      // Scoped to LLM calls so fast tool/child spans don't drag the tail down.
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
    // `operation` uses MIN so it is stable across reloads.
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
    // Every span carries the agent's canonical name, so the agent filter needs no parent climb.
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
      // Agent-only cost is the unattributed series so the bars add up to the Total Cost tile.
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
      // Includes agent-span-only tokens, as the Total Tokens tile does.
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

/** Fills `{{…}}` placeholders; `{{stream}}` is quoted since DataFusion folds unquoted identifiers. */
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
    /** The stream stores span parents ({{agentParents}}); false or absent when it has none. */
    hasParentSpan?: boolean;
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
    )
    .replace(/\{\{agentParents\}\}/g, () => agentParentsJoin(ctx.stream, !!ctx.hasParentSpan));

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
/** Mirrors `generate_histogram_interval` in histogram_interval.rs so a clicked bar maps back to its range. */
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
