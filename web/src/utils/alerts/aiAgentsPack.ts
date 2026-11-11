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

// Shipped in-app because the external library manifest names one fixed stream while users name their own.

import type { I18nKey } from "@/types/i18n";
import { SEVERITY_TO_PRIORITY, type LibrarySeverity } from "@/constants/alertLibrary";
import { TRACE_ERRORED_SQL } from "@/plugins/traces/llmTraceOutcome";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

export const AI_PACK_ID = "ai-agents";
export const AI_PACK_FOLDER = "AI agents";
/** Score streams the evaluator writes; evaluator lag reads them. */
export const LLM_SCORES_STREAM = "_llm_scores";
/** One span per judge call, with the job, status and error kind. */
export const EVALUATOR_STREAM = "_evaluator";

const and = (scope: string) => (scope ? ` AND ${scope}` : "");

/** One alert's query and schedule. */
export interface AiAlertSpec {
  name: string;
  streamName: string;
  streamType: "traces" | "logs";
  sql: string;
  periodMinutes: number;
  frequencyMinutes: number;
  silenceMinutes: number;
  severity: LibrarySeverity;
}

/** Agent matched on the trace since `gen_ai.agent.name` is only on the `invoke_agent` span; the tool stays span-local. */
export function agentToolScope(
  stream: string,
  agent?: string | null,
  tool?: string | null,
): string {
  return [
    agent
      ? `trace_id IN (SELECT trace_id FROM "${stream}" WHERE gen_ai_agent_name = ${sqlLiteral(agent)})`
      : "",
    tool ? `gen_ai_tool_name = ${sqlLiteral(tool)}` : "",
  ]
    .filter(Boolean)
    .join(" AND ");
}

/** The pack's default thresholds: tool calls per trace, and failing calls per trace. */
export const REPEATED_TOOL_MIN_CALLS = 10;
export const FAILING_TOOL_MIN_CALLS = 3;

/** Same tool called `minCalls`+ times in one trace; one row per trace, agent and tool. */
export function repeatedToolCallsSql(
  stream: string,
  opts: { minCalls?: number; failingOnly?: boolean; scope?: string } = {},
): string {
  const {
    minCalls = opts.failingOnly ? FAILING_TOOL_MIN_CALLS : REPEATED_TOOL_MIN_CALLS,
    failingOnly = false,
    scope = "",
  } = opts;
  return (
    `SELECT trace_id, max(span_id) AS span_id, gen_ai_agent_name AS agent_name, ` +
    `gen_ai_tool_name AS tool_name, count(*) AS calls FROM "${stream}" ` +
    `WHERE gen_ai_operation_name = 'execute_tool' AND gen_ai_tool_name IS NOT NULL` +
    `${failingOnly ? " AND span_status = 'ERROR'" : ""}${and(scope)} ` +
    `GROUP BY trace_id, gen_ai_agent_name, gen_ai_tool_name HAVING count(*) >= ${minCalls}`
  );
}

export function failureRateSql(
  stream: string,
  opts: { minTraces?: number; maxRatePct?: number; scope?: string } = {},
): string {
  const { minTraces = 50, maxRatePct = 5, scope = "" } = opts;
  return (
    `SELECT agent_name, count(*) AS traces, 100.0 * sum(failed) / count(*) AS failure_rate ` +
    `FROM (SELECT trace_id, max(gen_ai_agent_name) AS agent_name, ${TRACE_ERRORED_SQL} AS failed ` +
    `FROM "${stream}"${scope ? ` WHERE ${scope}` : ""} GROUP BY trace_id) ` +
    `WHERE agent_name IS NOT NULL GROUP BY agent_name ` +
    `HAVING count(*) >= ${minTraces} AND 100.0 * sum(failed) / count(*) > ${maxRatePct}`
  );
}

/** Models whose LLM spend over the period is above `maxUsd`. */
export function costSql(stream: string, opts: { maxUsd?: number; scope?: string } = {}): string {
  const { maxUsd = 5, scope = "" } = opts;
  return (
    `SELECT gen_ai_response_model AS model, sum(gen_ai_usage_cost) AS cost FROM "${stream}" ` +
    `WHERE gen_ai_response_model IS NOT NULL${and(scope)} ` +
    `GROUP BY gen_ai_response_model HAVING sum(gen_ai_usage_cost) > ${maxUsd}`
  );
}

/** Manual re-evaluations score old targets on purpose, so they say nothing about live scoring. */
const ONLINE_SCORES_SQL = "(task_producer IS NULL OR task_producer != 'manual')";

/** Online evaluator scores only: annotations, feedback and manual runs carry the target's time, which is not lag. */
export function evaluatorLagSql(opts: { maxLagMinutes?: number } = {}): string {
  const { maxLagMinutes = 10 } = opts;
  const lagMinutes = "approx_percentile_cont(_timestamp - ref_timestamp, 0.95) / 60000000.0";
  return (
    `SELECT name, count(*) AS scores, ${lagMinutes} AS lag_minutes FROM "${LLM_SCORES_STREAM}" ` +
    `WHERE ref_timestamp IS NOT NULL AND source_type IN ('llm_judge', 'code', 'remote') ` +
    `AND ${ONLINE_SCORES_SQL} GROUP BY name HAVING ${lagMinutes} > ${maxLagMinutes}`
  );
}

/** An alert cannot count source traffic, so scoring in the same hour yesterday stands in for it. */
export function scoresStoppedSql(opts: { jobId?: string | null; minScores?: number } = {}): string {
  const { jobId, minScores = 3 } = opts;
  const since = (interval: string) =>
    `to_timestamp_micros(_timestamp) >= now() - INTERVAL '${interval}'`;
  return (
    `SELECT job_id, count(*) AS scores_24h FROM "${LLM_SCORES_STREAM}" ` +
    `WHERE job_id ${jobId ? `= ${sqlLiteral(jobId)}` : "IS NOT NULL"} AND ${ONLINE_SCORES_SQL} ` +
    `GROUP BY job_id ` +
    `HAVING count(CASE WHEN ${since("30 minutes")} THEN 1 END) = 0 ` +
    `AND count(CASE WHEN NOT (${since("23 hours")}) THEN 1 END) >= ${minScores}`
  );
}

/** Eval jobs whose judge calls fail more than `maxErrorPct` of the time, per job. */
export function judgeErrorRateSql(
  opts: { jobId?: string | null; maxErrorPct?: number; minCalls?: number } = {},
): string {
  const { jobId, maxErrorPct = 20, minCalls = 3 } = opts;
  const errorPct =
    "sum(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 ELSE 0 END) * 100.0 / count(*)";
  return (
    `SELECT attributes_job_id AS job_id, count(*) AS calls, ${errorPct} AS error_pct ` +
    `FROM "${EVALUATOR_STREAM}" WHERE attributes_scorer_id IS NOT NULL AND attributes_scorer_id != '' ` +
    `AND attributes_status IN ('success', 'error', 'timeout')` +
    `${jobId ? ` AND attributes_job_id = ${sqlLiteral(jobId)}` : ""} ` +
    `GROUP BY attributes_job_id HAVING count(*) >= ${minCalls} AND ${errorPct} > ${maxErrorPct}`
  );
}

export type AiPackRuleReadiness = "ready" | "needs-data" | "waits";

export interface AiPackRule {
  id: string;
  kind: "rule" | "template";
  titleKey: I18nKey;
  whenKey: I18nKey;
  /** Shown instead of "Runs now" for a rule without a query (see ruleWaitsKey). */
  waitsKey?: I18nKey;
  spec?: (stream: string) => AiAlertSpec;
}

const traces = (
  name: string,
  stream: string,
  sql: string,
  severity: LibrarySeverity,
  periodMinutes: number,
  silenceMinutes: number,
): AiAlertSpec => ({
  name,
  streamName: stream,
  streamType: "traces",
  sql,
  periodMinutes,
  frequencyMinutes: 5,
  silenceMinutes,
  severity,
});

export const AI_AGENTS_PACK: AiPackRule[] = [
  {
    id: "repeated_tool_calls",
    kind: "rule",
    titleKey: "aiAlertPack.rules.repeatedToolCalls.title",
    whenKey: "aiAlertPack.rules.repeatedToolCalls.when",
    spec: (s) => traces("ai_repeated_tool_calls", s, repeatedToolCallsSql(s), "warning", 15, 60),
  },
  {
    id: "repeated_failing_tool_calls",
    kind: "rule",
    titleKey: "aiAlertPack.rules.repeatedFailingToolCalls.title",
    whenKey: "aiAlertPack.rules.repeatedFailingToolCalls.when",
    spec: (s) =>
      traces(
        "ai_repeated_failing_tool_calls",
        s,
        repeatedToolCallsSql(s, { failingOnly: true }),
        "warning",
        15,
        60,
      ),
  },
  {
    id: "tool_loop",
    kind: "rule",
    titleKey: "aiAlertPack.rules.toolLoop.title",
    whenKey: "aiAlertPack.rules.toolLoop.when",
    waitsKey: "aiAlertPack.waits.trustabl",
  },
  {
    id: "retry_storm",
    kind: "rule",
    titleKey: "aiAlertPack.rules.retryStorm.title",
    whenKey: "aiAlertPack.rules.retryStorm.when",
    waitsKey: "aiAlertPack.waits.trustabl",
  },
  {
    id: "false_idempotent",
    kind: "rule",
    titleKey: "aiAlertPack.rules.falseIdempotent.title",
    whenKey: "aiAlertPack.rules.falseIdempotent.when",
    waitsKey: "aiAlertPack.waits.trustabl",
  },
  {
    id: "dspm_unbound",
    kind: "rule",
    titleKey: "aiAlertPack.rules.dspmUnbound.title",
    whenKey: "aiAlertPack.rules.dspmUnbound.when",
    waitsKey: "aiAlertPack.waits.binding",
  },
  {
    id: "policy_absent",
    kind: "rule",
    titleKey: "aiAlertPack.rules.policyAbsent.title",
    whenKey: "aiAlertPack.rules.policyAbsent.when",
    waitsKey: "aiAlertPack.waits.binding",
  },
  {
    id: "failure_rate",
    kind: "template",
    titleKey: "aiAlertPack.rules.failureRate.title",
    whenKey: "aiAlertPack.rules.failureRate.when",
    spec: (s) => traces("ai_failure_rate", s, failureRateSql(s), "warning", 30, 30),
  },
  {
    id: "cost",
    kind: "template",
    titleKey: "aiAlertPack.rules.cost.title",
    whenKey: "aiAlertPack.rules.cost.when",
    spec: (s) => traces("ai_hourly_cost", s, costSql(s), "warning", 60, 60),
  },
  {
    id: "score_drop",
    kind: "template",
    titleKey: "aiAlertPack.rules.scoreDrop.title",
    whenKey: "aiAlertPack.rules.scoreDrop.when",
    waitsKey: "aiAlertPack.waits.perConfig",
  },
  {
    id: "evaluator_lag",
    kind: "template",
    titleKey: "aiAlertPack.rules.evaluatorLag.title",
    whenKey: "aiAlertPack.rules.evaluatorLag.when",
    spec: () => ({
      name: "ai_evaluator_lag",
      streamName: LLM_SCORES_STREAM,
      streamType: "logs",
      sql: evaluatorLagSql(),
      periodMinutes: 30,
      frequencyMinutes: 5,
      silenceMinutes: 60,
      severity: "warning",
    }),
  },
  {
    id: "eval_scores_stopped",
    kind: "template",
    titleKey: "evalWorkload.pack.scoresStopped.title",
    whenKey: "evalWorkload.pack.scoresStopped.when",
    // The period reaches back a day for the hour the job scored yesterday.
    spec: () => ({
      name: "ai_eval_scores_stopped",
      streamName: LLM_SCORES_STREAM,
      streamType: "logs",
      sql: scoresStoppedSql(),
      periodMinutes: 1440,
      frequencyMinutes: 5,
      silenceMinutes: 60,
      severity: "critical",
    }),
  },
  {
    id: "eval_judge_error_rate",
    kind: "template",
    titleKey: "evalWorkload.pack.judgeErrorRate.title",
    whenKey: "evalWorkload.pack.judgeErrorRate.when",
    spec: () => ({
      name: "ai_eval_judge_error_rate",
      streamName: EVALUATOR_STREAM,
      streamType: "traces",
      sql: judgeErrorRateSql(),
      periodMinutes: 30,
      frequencyMinutes: 5,
      silenceMinutes: 60,
      severity: "warning",
    }),
  },
];

/** How the pack names an existing stream: "type/name". */
export const streamKey = (streamType: string, name: string) => `${streamType}/${name}`;

/** An alert on a missing stream fails to save. */
export function ruleReadiness(
  rule: AiPackRule,
  stream: string,
  streams: ReadonlySet<string>,
): AiPackRuleReadiness {
  if (!rule.spec) return "waits";
  const spec = rule.spec(stream);
  return streams.has(streamKey(spec.streamType, spec.streamName)) ? "ready" : "needs-data";
}

export function ruleWaitsKey(rule: AiPackRule, stream: string): I18nKey {
  if (!rule.spec) return rule.waitsKey ?? "aiAlertPack.waits.perConfig";
  const { streamName } = rule.spec(stream);
  if (streamName === LLM_SCORES_STREAM) return "aiAlertPack.waits.scores";
  if (streamName === EVALUATOR_STREAM) return "aiAlertPack.waits.evaluator";
  return "aiAlertPack.waits.traceStream";
}

/** Alert names are per org: a pack installed on a second stream names that stream. */
export function packAlertName(spec: AiAlertSpec, stream: string): string {
  // Alerts on the evaluator's own streams are the same whichever stream the pack is for.
  if (spec.streamName !== stream || stream === "default") return spec.name;
  return `${spec.name}_${stream.replace(/[^A-Za-z0-9_]+/g, "_")}`;
}

/** The v2 alert create payload for one pack alert. */
export function aiPackAlertPayload(
  ruleId: string,
  spec: AiAlertSpec,
  opts: { stream: string; folderId: string; destination: string; owner: string; timezone: string },
): Record<string, unknown> {
  return {
    name: packAlertName(spec, opts.stream),
    stream_type: spec.streamType,
    stream_name: spec.streamName,
    is_real_time: false,
    enabled: true,
    destinations: opts.destination ? [opts.destination] : [],
    query_condition: {
      type: "sql",
      sql: spec.sql,
      conditions: null,
      aggregation: null,
      promql: null,
      promql_condition: null,
      vrl_function: null,
      multi_time_range: [],
    },
    trigger_condition: {
      period: spec.periodMinutes,
      operator: ">=",
      threshold: 1,
      frequency: spec.frequencyMinutes,
      silence: spec.silenceMinutes,
      timezone: opts.timezone,
      tolerance_in_secs: null,
    },
    folder_id: opts.folderId,
    owner: opts.owner,
    last_edited_by: opts.owner,
    tags: [`pack:${AI_PACK_ID}`],
    context_attributes: { library_id: `${AI_PACK_ID}/${ruleId}` },
    priority: SEVERITY_TO_PRIORITY[spec.severity],
  };
}
