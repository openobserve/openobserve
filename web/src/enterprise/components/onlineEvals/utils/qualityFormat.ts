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
  QualityTimelineBucket,
  ScoreDataType,
} from "@/services/online-evals.service";
import { ALL_AGENTS_VALUE } from "@/plugins/traces/llmAgentFilter";
import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";

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

// Below 0.01 two decimals collapse distinct values to 0, so tiny values keep 2 significant digits.
const isTiny = (value: number) => value !== 0 && Math.abs(value) < 0.01;

// Significant digits through toLocaleString, so 1e-9 reads "0.000000001", not "1e-9".
const formatTiny = (value: number) =>
  value.toLocaleString("en-US", { maximumSignificantDigits: 2 });

/** A score or an average: 2 to 4 decimals, so 0.50 keeps its look and 0.019 never reads as a 0.02 rule; tiny values kept distinct. */
export const formatScore = (value: number): string =>
  isTiny(value)
    ? formatTiny(value)
    : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** An axis tick: up to 4 decimals, thousands grouped, so float noise like 0.0499999999999996 reads "0.05"; smaller ticks keep 2 significant digits. */
export const formatAxis = (value: number): string =>
  value !== 0 && Math.abs(value) < 0.0001
    ? formatTiny(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 4 });

/** A number for labels and ranges: up to 2 decimals, thousands grouped ("1,000,000"), tiny values kept distinct ("0.00032"). */
export const formatNumber = (value: number): string =>
  isTiny(value) ? formatTiny(value) : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A configured value as entered: thousands grouped, never rounded, so a 0.333 threshold reads "0.333". */
export const formatExact = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 20 });

/** A bucket edge with one more decimal than the bucket width needs, so neighbours never share a label: "0.045" for 0.005-wide buckets. */
export function formatEdge(value: number, width: number): string {
  const decimals = width > 0 ? Math.min(20, Math.max(0, Math.ceil(-Math.log10(width)) + 1)) : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** A count with thousands grouped: "150,000". */
export const formatCount = (value: number): string => value.toLocaleString("en-US");

/** One decimal, but never "0.0%" for some or "100.0%" for not all: 1 in 5,000 reads "<0.1%". */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const percent = (part / whole) * 100;
  if (part > 0 && percent < 0.05) return "<0.1%";
  if (part < whole && percent >= 99.95) return ">99.9%";
  return `${percent.toFixed(1)}%`;
}

/** Bar fill for a share: any non-zero share keeps a visible sliver, so it never looks like a healthy config. */
export const barShare = (share: number | null): number =>
  share == null || share <= 0 ? 0 : Math.max(share, 0.02);

export function formatScoreValue(value: QualityScore["value"], dataType: ScoreDataType): string {
  if (value == null) return "—";
  if (dataType === "numeric" && typeof value === "number") return formatScore(value);
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
      value: raw(formatScore(row.average)),
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
      count: formatCount(row.topValue.count),
      total: formatCount(row.total),
    }),
  };
}

/** "Trace 38 · Session 8", skipping empty scopes. */
export function scopeMixText(counts: QualityConfigSummary["scopeCounts"], t: TranslateFn): string {
  return QUALITY_SCOPES.filter((scope) => counts[scope] > 0)
    .map((scope) =>
      t("onlineEvals.quality.scopeCount", {
        scope: t(`onlineEvals.quality.scopes.${scope}`),
        count: formatCount(counts[scope]),
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

/** A bar's label. The backend folds values below the range into the first numeric bar and values above it into the last, so those two read open-ended: "< 0.1" and "≥ 0.9". */
export function bucketLabel(
  bucket: QualityDistributionBucket,
  edge: { first?: boolean; last?: boolean } = {},
): string {
  if (bucket.lower != null && bucket.upper != null) {
    const width = bucket.upper - bucket.lower;
    const lower = formatEdge(bucket.lower, width);
    const upper = formatEdge(bucket.upper, width);
    if (edge.first && !edge.last) return `< ${upper}`;
    if (edge.last && !edge.first) return `≥ ${lower}`;
    return `${lower}–${upper}`;
  }
  return String(bucket.key);
}

/** The score trend's y axis: the config range, widened to any average or p95 outside it, so no line is clipped. */
export function scoreAxisBounds(
  range: { min: number; max: number } | null | undefined,
  timeline: QualityTimelineBucket[],
): { min: number | "dataMin"; max: number | "dataMax" } {
  if (!range) return { min: "dataMin", max: "dataMax" };
  const values = timeline
    .flatMap((bucket) => [bucket.average, bucket.p95])
    .filter((value): value is number => value != null && Number.isFinite(value));
  return { min: Math.min(range.min, ...values), max: Math.max(range.max, ...values) };
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

/** The chart filter as URL values, so Back and a shared link reopen it with its page: "3-5" for a bucket range, else the exact value. */
export function chartFilterToQuery(filter: QualityChartFilter | null): {
  bucket?: string;
  value?: string;
} {
  if (!filter) return {};
  return filter.kind === "bucket"
    ? { bucket: `${filter.from}-${filter.to}` }
    : { value: filter.value };
}

/** The backend always splits a numeric range into this many buckets. */
const NUMERIC_BUCKETS = 10;

/** The chart filter from URL values; a malformed or out-of-range value restores no filter. */
export function chartFilterFromQuery(query: {
  bucket?: unknown;
  value?: unknown;
}): QualityChartFilter | null {
  if (typeof query.bucket === "string") {
    const match = /^(\d+)-(\d+)$/.exec(query.bucket);
    if (!match) return null;
    const [from, to] = [Number(match[1]), Number(match[2])];
    return from <= to && to < NUMERIC_BUCKETS ? { kind: "bucket", from, to } : null;
  }
  return typeof query.value === "string" && query.value
    ? { kind: "value", value: query.value }
    : null;
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
  // The same precision as the bar labels, so the chip and the bars read alike.
  const width = first?.lower != null && first.upper != null ? first.upper - first.lower : 1;
  const from = formatEdge(first?.lower ?? filter.from, width);
  const to = formatEdge(last?.upper ?? filter.to + 1, width);
  // The edge bars also hold the values outside the range, as their labels say.
  const openLow = filter.from === distribution[0]?.key;
  const openHigh = filter.to === distribution[distribution.length - 1]?.key;
  if (openLow && openHigh) return t("onlineEvals.quality.detail.filterAny");
  if (openLow) return t("onlineEvals.quality.detail.filterBelow", { to });
  if (openHigh) return t("onlineEvals.quality.detail.filterAtLeast", { from });
  return t("onlineEvals.quality.detail.filterRange", { from, to });
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

/** The data type a distribution implies when the config is unknown: numeric buckets carry edges, boolean keys are booleans. */
export function distributionDataType(distribution: QualityDistributionBucket[]): ScoreDataType {
  if (distribution.some((bucket) => bucket.lower != null)) return "numeric";
  if (distribution.some((bucket) => typeof bucket.key === "boolean")) return "boolean";
  return "categorical";
}

/** The trend, as the earlier Quality page drew it: average and p95 for numeric configs, the healthy rate with a threshold, else the true rate for boolean configs, else the score count. */
export type QualityTrendKind = "score" | "healthyRate" | "trueRate" | "count";
export type QualityTrendMetric = "average" | "p95" | "healthyRate" | "trueRate" | "count";

export function trendKind(
  timeline: QualityTimelineBucket[],
  dataType: ScoreDataType,
): QualityTrendKind {
  if (dataType === "numeric") return "score";
  if (timeline.some((bucket) => bucket.unhealthy != null)) return "healthyRate";
  return dataType === "boolean" ? "trueRate" : "count";
}

/** Buckets that got scores; the trend skips the others and joins its points across them. */
export const trendBuckets = (timeline: QualityTimelineBucket[]) =>
  timeline.filter((bucket) => bucket.count > 0);

function trendValue(bucket: QualityTimelineBucket, metric: QualityTrendMetric): number | null {
  if (metric === "average") return bucket.average;
  if (metric === "p95") return bucket.p95;
  if (metric === "count") return bucket.count;
  const part = metric === "healthyRate" ? bucket.count - (bucket.unhealthy ?? 0) : bucket.trueCount;
  return part == null ? null : (part / bucket.count) * 100;
}

/** One point per bucket with scores, at the bucket's midpoint in milliseconds. */
export function trendPoints(
  timeline: QualityTimelineBucket[],
  metric: QualityTrendMetric,
): [number, number | null][] {
  return trendBuckets(timeline).map((bucket) => [
    (bucket.start + bucket.end) / 2000,
    trendValue(bucket, metric),
  ]);
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
  if (typeof period === "string" && (/^\d+[smhdwM]$/.test(period) || parseCalendarToken(period))) {
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

/** The window in microseconds that the target links search: an hour either side of the target time. */
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
