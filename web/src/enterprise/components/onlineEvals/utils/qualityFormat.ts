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

import type { LocationQuery, RouteLocationRaw } from "vue-router";
import type { AiDateState } from "@/enterprise/composables/useAiDateRange";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import type {
  EvalTargetScope,
  QualityAgentParams,
  QualityConfigSummary,
  QualityDistributionBucket,
  QualityScore,
  QualityScoresParams,
  QualityStatus,
  ScoreDataType,
} from "@/services/online-evals.service";
import { ALL_AGENTS_VALUE } from "@/plugins/traces/llmAgentFilter";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import { buildEvaluatorAgentFilterWhere } from "./agentFilterSql";

/** A list row joined with the Score Config fields the API does not return. */
export interface QualityRow extends QualityConfigSummary {
  description: string;
  version: number | null;
  /** Threshold rule such as "≥ 0.7"; empty without a threshold. */
  thresholdLabel: string;
  range: { min: number; max: number };
}

export type QualityScope = "all" | EvalTargetScope;
export type QualityOnly = "all" | "unhealthy";

/** A bar click on the distribution: a numeric bucket range or one exact value. */
export type QualityChartFilter =
  { kind: "bucket"; from: number; to: number } | { kind: "value"; value: string };

export const QUALITY_SCOPES: EvalTargetScope[] = ["span", "trace", "session"];

const STATUS_RANK: Record<QualityStatus, number> = {
  attention: 0,
  healthy: 1,
  unset: 2,
  no_data: 3,
};

// Detail views search a window; an hour either side of the target matches the Discovery page.
const LINK_WINDOW_US = 3_600_000_000;

export const statusRank = (status: QualityStatus): number => STATUS_RANK[status] ?? 4;

/** Unhealthy share, or null without a threshold or without scores. */
export function unhealthyShare(row: Pick<QualityConfigSummary, "total" | "unhealthy">) {
  return row.total > 0 && row.unhealthy != null ? row.unhealthy / row.total : null;
}

/** Bar colour for an unhealthy share, banded on the percent the cell shows: under 25 green, under 75 orange, else red; null without a share. */
export function unhealthyTone(share: number | null): ProgressBarVariant | null {
  if (share == null) return null;
  const percent = Number((share * 100).toFixed(1));
  if (percent < 25) return "success";
  return percent < 75 ? "warning" : "danger";
}

/** Default sort: status rank first, then the higher unhealthy share. */
export const healthSortValue = (row: QualityConfigSummary): number =>
  statusRank(row.status) * 10 - (unhealthyShare(row) ?? 0);

/** Numeric configs sort by the average; the others by the share of the top value. */
export function typicalSortValue(row: QualityConfigSummary): number {
  if (!row.total) return -1;
  if (row.dataType === "numeric") return row.average ?? -1;
  return row.topValue ? row.topValue.count / row.total : -1;
}

export const formatNumber = (value: number): string => String(Number(value.toFixed(2)));

export const formatPercent = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";

export function formatScoreValue(value: QualityScore["value"], dataType: ScoreDataType): string {
  if (value == null) return "—";
  if (dataType === "numeric" && typeof value === "number") return value.toFixed(2);
  return String(value);
}

/** The typical score cell: the average for numeric configs, the top value for the others. */
export function typicalScore(
  row: QualityRow,
  t: TranslateFn,
): { value: I18nText; sub: I18nText } | null {
  if (!row.total) return null;
  if (row.dataType === "numeric") {
    if (row.average == null) return null;
    return {
      value: raw(row.average.toFixed(2)),
      sub: t("onlineEvals.quality.table.averageRange", {
        min: formatNumber(row.range.min),
        max: formatNumber(row.range.max),
      }),
    };
  }
  if (!row.topValue) return null;
  return {
    value: raw(String(row.topValue.key)),
    sub: t("onlineEvals.quality.table.mostCommon", {
      count: row.topValue.count,
      total: row.total,
    }),
  };
}

/** "Trace 38 · Session 8", skipping empty scopes. */
export function scopeMixText(counts: QualityConfigSummary["scopeCounts"], t: TranslateFn): string {
  return QUALITY_SCOPES.filter((scope) => counts[scope] > 0)
    .map((scope) =>
      t("onlineEvals.quality.scopeCount", {
        scope: t(`onlineEvals.quality.scopes.${scope}`),
        count: counts[scope],
      }),
    )
    .join(" · ");
}

/** Totals and status from `distribution[]`, by the same rule as the backend. */
export function summarizeDistribution(distribution: QualityDistributionBucket[]): {
  total: number;
  unhealthy: number | null;
  status: QualityStatus;
} {
  const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const classified = distribution.length > 0 && distribution.every((b) => b.unhealthy != null);
  const unhealthy = classified
    ? distribution.reduce((sum, bucket) => sum + (bucket.unhealthy ?? 0), 0)
    : null;
  let status: QualityStatus = "healthy";
  if (total === 0) status = "no_data";
  else if (unhealthy == null) status = "unset";
  else if (unhealthy > 0) status = "attention";
  return { total, unhealthy, status };
}

export function bucketLabel(bucket: QualityDistributionBucket): string {
  if (bucket.lower != null && bucket.upper != null) {
    return `${formatNumber(bucket.lower)}–${formatNumber(bucket.upper)}`;
  }
  return String(bucket.key);
}

/** The filter after a bar click: numeric bars select a bucket range (shift widens it), others one value; re-clicking the only bar clears it. */
export function nextChartFilter(
  current: QualityChartFilter | null,
  bucket: QualityDistributionBucket,
  shift: boolean,
): QualityChartFilter | null {
  if (typeof bucket.key === "number") {
    const index = bucket.key;
    if (shift && current?.kind === "bucket") {
      return {
        kind: "bucket",
        from: Math.min(current.from, index),
        to: Math.max(current.to, index),
      };
    }
    if (current?.kind === "bucket" && current.from === index && current.to === index) return null;
    return { kind: "bucket", from: index, to: index };
  }
  const value = String(bucket.key);
  if (current?.kind === "value" && current.value === value) return null;
  return { kind: "value", value };
}

export function chartFilterParams(
  filter: QualityChartFilter | null,
): Pick<QualityScoresParams, "bucket_from" | "bucket_to" | "value"> {
  if (!filter) return {};
  if (filter.kind === "bucket") return { bucket_from: filter.from, bucket_to: filter.to };
  return { value: filter.value };
}

/** Whether a bar is inside the active filter, so the chart can dim the rest. */
export function bucketSelected(
  filter: QualityChartFilter | null,
  bucket: QualityDistributionBucket,
): boolean {
  if (!filter) return true;
  if (filter.kind === "bucket") {
    return typeof bucket.key === "number" && bucket.key >= filter.from && bucket.key <= filter.to;
  }
  return String(bucket.key) === filter.value;
}

/** Chip text for the active filter: "0.3 to 0.5" for a numeric range, else the value. */
export function chartFilterLabel(
  filter: QualityChartFilter,
  distribution: QualityDistributionBucket[],
  t: TranslateFn,
): I18nText {
  if (filter.kind === "value") return raw(filter.value);
  const first = distribution.find((b) => b.key === filter.from);
  const last = distribution.find((b) => b.key === filter.to);
  return t("onlineEvals.quality.detail.filterRange", {
    from: formatNumber(first?.lower ?? filter.from),
    to: formatNumber(last?.upper ?? filter.to + 1),
  });
}

const pinned = (level: string) => !!level && level !== ALL_AGENTS_VALUE;

/** Agents the Env, Agent and Version levels select; null while every level is "All". */
export function selectedAgents(
  agents: GenAiAgentListItem[],
  env: string,
  name: string,
  version: string,
): GenAiAgentListItem[] | null {
  if (!pinned(env) && !pinned(name) && !pinned(version)) return null;
  return agents.filter(
    (agent) =>
      (!pinned(env) || agent.env === env) &&
      (!pinned(name) || agent.name === name) &&
      (!pinned(version) || agent.version === version),
  );
}

/** API params for the levels: "All" sends nothing; the agent level sends the id its matches share, else the name. */
export function agentParamsFor(
  agents: GenAiAgentListItem[],
  env: string,
  name: string,
  version: string,
): QualityAgentParams {
  const params: QualityAgentParams = {};
  if (pinned(env)) params.agent_env = env;
  if (pinned(version)) params.agent_version = version;
  if (!pinned(name)) return params;
  const ids = new Set((selectedAgents(agents, env, name, version) ?? []).map((a) => a.id ?? ""));
  const [id] = ids;
  if (ids.size === 1 && id) params.agent_id = id;
  else params.agent_name = name;
  return params;
}

/** `_evaluator` filter for the selected agents, one OR'd clause per agent id (or name without one). */
export function evaluatorAgentWhere(
  agents: Pick<GenAiAgentListItem, "id" | "name">[],
): string | null {
  const clauses = new Set(agents.map((agent) => buildEvaluatorAgentFilterWhere(agent) ?? ""));
  clauses.delete("");
  return clauses.size ? [...clauses].map((clause) => `(${clause})`).join(" OR ") : null;
}

/** The data type a distribution implies when the config is unknown: numeric buckets carry edges, boolean keys are booleans. */
export function distributionDataType(distribution: QualityDistributionBucket[]): ScoreDataType {
  if (distribution.some((bucket) => bucket.lower != null)) return "numeric";
  if (distribution.some((bucket) => typeof bucket.key === "boolean")) return "boolean";
  return "categorical";
}

/** Quality's own default range; LLM Insights and Sessions keep the shared AI range and its default. */
export const DEFAULT_QUALITY_RANGE: AiDateState = {
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: "24h",
};

/** The range in the URL: `period` when relative, `from` and `to` (µs) when absolute; null when absent or malformed. */
export function qualityRangeFromQuery(query: LocationQuery): AiDateState | null {
  const { period, from, to } = query;
  if (typeof period === "string" && /^\d+[smhdwM]$/.test(period)) {
    return { valueType: "relative", startTime: null, endTime: null, relativeTimePeriod: period };
  }
  const start = Number(from);
  const end = Number(to);
  if (typeof from !== "string" || typeof to !== "string" || !(end > start) || start < 0)
    return null;
  return { valueType: "absolute", startTime: start, endTime: end, relativeTimePeriod: null };
}

/** URL params for a range; the default range and the keys a range does not use come back undefined, for the caller to drop. */
export function qualityRangeQuery(
  range: AiDateState,
): Record<"period" | "from" | "to", string | undefined> {
  if (range.valueType === "absolute" && range.startTime != null && range.endTime != null) {
    return { period: undefined, from: String(range.startTime), to: String(range.endTime) };
  }
  const period = range.relativeTimePeriod ?? DEFAULT_QUALITY_RANGE.relativeTimePeriod;
  return {
    period: period === DEFAULT_QUALITY_RANGE.relativeTimePeriod ? undefined : (period ?? undefined),
    from: undefined,
    to: undefined,
  };
}

/** The window in microseconds that the target links and the full-text fetch search: an hour either side of the target time. */
export const targetWindow = (score: QualityScore) => ({
  startTime: score.refTimestamp - LINK_WINDOW_US,
  endTime: score.refTimestamp + LINK_WINDOW_US,
});

/** The trace a span or trace score points at; null for a session. */
export const targetTraceId = (score: QualityScore): string | null =>
  score.targetScope === "session"
    ? null
    : (score.traceId ?? (score.targetScope === "trace" ? score.targetId : null));

/** Opens the scored span, trace or session around its start time. */
export function targetLink(score: QualityScore, org: string): RouteLocationRaw | null {
  const { startTime, endTime } = targetWindow(score);
  const query: Record<string, string | number> = {
    org_identifier: org,
    from: startTime,
    to: endTime,
  };
  if (score.sourceStream) query.stream = score.sourceStream;
  if (score.targetScope === "session") {
    return score.sessionId
      ? { name: "sessionDetails", query: { ...query, session_id: score.sessionId } }
      : null;
  }
  const traceId = targetTraceId(score);
  if (!traceId) return null;
  const spanId = score.targetScope === "span" ? (score.spanId ?? score.targetId) : null;
  return {
    name: "traceDetails",
    query: { ...query, trace_id: traceId, ...(spanId ? { span_id: spanId } : {}) },
  };
}

// The conversation and tool fields the scorer reads, as in the backend's eval_jobs/tasks.rs.
const LLM_INPUT_FIELDS = [
  "gen_ai_input_messages",
  "gen_ai.input.messages",
  "llm.input",
  "_o2_llm_input",
  "gen_ai.content.prompt",
  "llm_input",
];
const LLM_OUTPUT_FIELDS = [
  "gen_ai_output_messages",
  "gen_ai.output.messages",
  "llm.output",
  "_o2_llm_output",
  "gen_ai.content.completion",
  "llm_output",
  "_o2_llm_response",
];
const TOOL_NAME_FIELDS = ["gen_ai.tool.name", "gen_ai_tool_name", "tool_name"];
const PARENT_FIELDS = ["reference_parent_span_id", "parent_span_id", "parentSpanId"];

type SpanRow = Record<string, unknown>;

const present = (value: unknown) => value != null && !(typeof value === "string" && !value.trim());
const hasLlmIo = (row: SpanRow) =>
  [...LLM_INPUT_FIELDS, ...LLM_OUTPUT_FIELDS].some((field) => present(row[field]));
const isToolRow = (row: SpanRow) => {
  const operation = String(row.operation_name ?? "");
  return (
    TOOL_NAME_FIELDS.some((field) => present(row[field])) ||
    [row["gen_ai.operation.name"], row.gen_ai_operation_name].some(
      (value) => typeof value === "string" && value.trim() === "execute_tool",
    ) ||
    operation.startsWith("execute_tool ") ||
    operation.startsWith("tool.")
  );
};
const isChatRow = (row: SpanRow) => hasLlmIo(row) && !isToolRow(row);
const isRootRow = (row: SpanRow) =>
  PARENT_FIELDS.filter((field) => field in row).every((field) => {
    const value = row[field];
    return value == null || (typeof value === "string" && /^0*$/.test(value.trim()));
  });
const orderNumber = (value: unknown) => {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
};

/** The span whose text a score was given: the span itself, or for a trace the root chat span, then the first chat span, then the first span with LLM input or output, as the backend scorer picks it. */
export function contentSpan(score: QualityScore, spans: SpanRow[]): SpanRow | undefined {
  if (score.targetScope === "span") {
    const spanId = score.spanId ?? score.targetId;
    return spans.find((span) => span.span_id === spanId);
  }
  const sorted = [...spans].sort(
    (a, b) =>
      orderNumber(a._timestamp) - orderNumber(b._timestamp) ||
      orderNumber(a._o2_ingest_ts) - orderNumber(b._o2_ingest_ts) ||
      String(a.span_id ?? "").localeCompare(String(b.span_id ?? "")),
  );
  return (
    sorted.find((span) => isRootRow(span) && isChatRow(span)) ??
    sorted.find(isChatRow) ??
    sorted.find(hasLlmIo)
  );
}

/** Opens the judge's own trace on `_evaluator`, around the score write time. */
export function evaluatorTraceLink(score: QualityScore, org: string): RouteLocationRaw | null {
  if (!score.evaluatorTraceId) return null;
  return {
    name: "traceDetails",
    query: {
      org_identifier: org,
      stream: "_evaluator",
      trace_id: score.evaluatorTraceId,
      from: score.timestamp - LINK_WINDOW_US,
      to: score.timestamp + LINK_WINDOW_US,
    },
  };
}

/** Opens a Score Config on the Score Configs tab of the same page. */
export function scoreConfigLink(
  routeName: string,
  org: string,
  entityId: string,
  action: "view" | "update",
): RouteLocationRaw {
  return {
    name: routeName,
    query: { org_identifier: org, tab: "scoreConfigs", action, id: entityId },
  };
}
