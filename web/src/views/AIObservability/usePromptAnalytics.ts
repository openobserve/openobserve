// Copyright 2026 OpenObserve Inc.

import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import llmExperimentsService, {
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import type { Prompt, PromptVersion } from "@/services/llm-prompts.service";
import { latestScoresFromSql } from "@/enterprise/components/onlineEvals/utils/latestScoreSql";

export type PromptAnalyticsWindow = "24h" | "7d" | "30d";

export interface PromptTrafficKpis {
  calls: number;
  errorRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  cost: number | null;
}

export interface PromptTrafficRow {
  id: string;
  traceId: string;
  spanId: string;
  timestamp: unknown;
  model: string | null;
  label: string | null;
  status: string | null;
  latencyMs: number | null;
  cost: number | null;
  scores: Array<{ name: string; value: unknown }>;
}

export interface PromptExperimentEvidence {
  experiment: LlmExperiment;
  kind: "managed" | "content_match";
}

const WINDOW_US: Record<PromptAnalyticsWindow, number> = {
  "24h": 24 * 60 * 60 * 1_000_000,
  "7d": 7 * 24 * 60 * 60 * 1_000_000,
  "30d": 30 * 24 * 60 * 60 * 1_000_000,
};
const MAX_WINDOW_US = 90 * 24 * 60 * 60 * 1_000_000;

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlIdentifier(value: string): string {
  return value.replace(/"/g, '""');
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}


function scoreValue(row: Record<string, unknown>): unknown {
  return row.value_numeric ?? row.value_boolean ?? row.value_categorical ?? null;
}

function quartiles(experiments: LlmExperiment[]): { p50: number | null; iqr: number | null } {
  const values = experiments.flatMap((experiment) =>
    (experiment.scoreSummaries ?? []).flatMap((summary) => {
      const value = summary.value ?? {};
      const candidate = value.p50 ?? value.median ?? value.mean ?? value.value;
      const number = toNumber(candidate);
      return number == null ? [] : [number];
    }),
  );
  if (!values.length) return { p50: null, iqr: null };
  values.sort((left, right) => left - right);
  const at = (fraction: number) => values[Math.min(values.length - 1, Math.floor(fraction * values.length))];
  const q1 = at(0.25);
  const p50 = at(0.5);
  const q3 = at(0.75);
  return { p50, iqr: q3 - q1 };
}
export interface PromptVersionScoreSummary {
  version: number;
  p50: number | null;
  iqr: number | null;
}

export async function loadPromptVersionScoreComparison(
  orgId: string,
  promptId: string,
  versions: [number, number],
): Promise<{ left: PromptVersionScoreSummary; right: PromptVersionScoreSummary }> {
  const [left, right] = await Promise.all(
    versions.map((selected) =>
      llmExperimentsService.list(orgId, {
        includeSummary: true,
        promptId,
        promptVersion: selected,
      }),
    ),
  );
  return {
    left: { version: versions[0], ...quartiles(left) },
    right: { version: versions[1], ...quartiles(right) },
  };
}


export function usePromptAnalytics(
  prompt: Ref<Prompt>,
  version: Ref<PromptVersion>,
  streamName: Ref<string>,
  window: Ref<PromptAnalyticsWindow>,
) {
  const { executeQuery, executeQueryOnce, cancelAll } = useLLMStreamQuery();
  const loading = ref(false);
  const error = ref<string | null>(null);
  const kpis = ref<PromptTrafficKpis>({
    calls: 0,
    errorRate: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    cost: null,
  });
  const breakdown = ref<Record<string, unknown>[]>([]);
  const recent = ref<PromptTrafficRow[]>([]);
  const evidence = ref<PromptExperimentEvidence[]>([]);

  const bounds = computed(() => {
    const endUs = Date.now() * 1_000;
    const requested = WINDOW_US[window.value];
    return { endUs, startUs: endUs - Math.min(requested, MAX_WINDOW_US) };
  });

  async function loadTraffic() {
    if (!streamName.value || !prompt.value?.name || !version.value?.version) return;
    loading.value = true;
    error.value = null;
    const stream = sqlIdentifier(streamName.value);
    const name = sqlString(prompt.value.name);
    const number = version.value.version;
    const where = `gen_ai_prompt_name = '${name}' AND TRY_CAST(gen_ai_prompt_version AS BIGINT) = ${number}`;
    const kpiSql = [
      "SELECT",
      "  COUNT(*) AS calls,",
      "  COUNT(CASE WHEN span_status = 'ERROR' THEN 1 END) AS errors,",
      "  approx_percentile_cont(TRY_CAST(duration AS DOUBLE) / 1000000.0, 0.5) AS p50_latency_ms,",
      "  approx_percentile_cont(TRY_CAST(duration AS DOUBLE) / 1000000.0, 0.95) AS p95_latency_ms,",
      "  SUM(TRY_CAST(gen_ai_usage_cost AS DOUBLE)) AS cost",
      `FROM "${stream}"`,
      `WHERE ${where}`,
    ].join("\n");
    const breakdownSql = [
      "SELECT",
      "  COALESCE(gen_ai_prompt_label, '') AS label,",
      "  COALESCE(gen_ai_response_model, gen_ai_request_model, '') AS model,",
      "  COUNT(*) AS calls,",
      "  COUNT(CASE WHEN span_status = 'ERROR' THEN 1 END) AS errors,",
      "  approx_percentile_cont(TRY_CAST(duration AS DOUBLE) / 1000000.0, 0.5) AS p50_latency_ms,",
      "  approx_percentile_cont(TRY_CAST(duration AS DOUBLE) / 1000000.0, 0.95) AS p95_latency_ms,",
      "  SUM(TRY_CAST(gen_ai_usage_cost AS DOUBLE)) AS cost",
      `FROM "${stream}"`,
      `WHERE ${where}`,
      "GROUP BY label, model",
      "ORDER BY calls DESC",
    ].join("\n");
    const recentSql = [
      "SELECT span_id, trace_id, _timestamp, span_status, duration,",
      "  gen_ai_prompt_label, gen_ai_response_model, gen_ai_request_model, gen_ai_usage_cost",
      `FROM "${stream}"`,
      `WHERE ${where}`,
      "ORDER BY _timestamp DESC",
      "LIMIT 200",
    ].join("\n");

    try {
      const { startUs, endUs } = bounds.value;
      const [kpiRows, breakdownRows, recentRows] = await Promise.all([
        executeQuery(kpiSql, startUs, endUs),
        executeQuery(breakdownSql, startUs, endUs),
        executeQuery(recentSql, startUs, endUs),
      ]);
      const kpi = kpiRows[0] ?? {};
      const calls = toNumber(kpi.calls) ?? 0;
      const errors = toNumber(kpi.errors) ?? 0;
      kpis.value = {
        calls,
        errorRate: calls ? (errors / calls) * 100 : null,
        p50LatencyMs: toNumber(kpi.p50_latency_ms),
        p95LatencyMs: toNumber(kpi.p95_latency_ms),
        cost: toNumber(kpi.cost),
      };
      breakdown.value = breakdownRows;
      const rows = recentRows.map<PromptTrafficRow>((row: Record<string, unknown>) => ({
        id: String(row.span_id ?? row.trace_id ?? row._timestamp),
        traceId: String(row.trace_id ?? ""),
        spanId: String(row.span_id ?? ""),
        timestamp: row._timestamp,
        model: stringOrNull(row.gen_ai_response_model) ?? stringOrNull(row.gen_ai_request_model),
        label: stringOrNull(row.gen_ai_prompt_label),
        status: stringOrNull(row.span_status),
        latencyMs: (toNumber(row.duration) ?? 0) / 1_000_000,
        cost: toNumber(row.gen_ai_usage_cost),
        scores: [],
      }));
      recent.value = await mergeLatestScores(rows, startUs, endUs);
    } catch (caught: unknown) {
      error.value = caught instanceof Error ? caught.message : "Prompt traffic query failed.";
      kpis.value = { calls: 0, errorRate: null, p50LatencyMs: null, p95LatencyMs: null, cost: null };
      breakdown.value = [];
      recent.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function mergeLatestScores(
    rows: PromptTrafficRow[],
    startUs: number,
    endUs: number,
  ): Promise<PromptTrafficRow[]> {
    const ids = [...new Set(rows.flatMap((row) => [row.spanId, row.traceId]).filter(Boolean))];
    if (!ids.length) return rows;
    const inList = ids.map((id) => `'${sqlString(id)}'`).join(", ");
    const source = latestScoresFromSql(`_target_id IN (${inList})`);
    const sql = `SELECT _target_id AS target_id, name, value_numeric, value_boolean, value_categorical FROM ${source}`;
    const scores = await executeQueryOnce(sql, startUs, endUs, "logs").catch(() => []);
    const byTarget = new Map<string, Array<{ name: string; value: unknown }>>();
    for (const score of scores) {
      const target = String(score.target_id ?? "");
      const entries = byTarget.get(target) ?? [];
      entries.push({ name: String(score.name ?? "score"), value: scoreValue(score) });
      byTarget.set(target, entries);
    }
    return rows.map((row) => ({
      ...row,
      scores: [...(byTarget.get(row.spanId) ?? []), ...(byTarget.get(row.traceId) ?? [])],
    }));
  }


  async function loadExperimentEvidence(orgId: string) {
    const [managed, contentMatches] = await Promise.all([
      llmExperimentsService.list(orgId, {
        includeSummary: true,
        promptId: prompt.value.entityId,
        promptVersion: version.value.version,
      }),
      llmExperimentsService.list(orgId, {
        includeSummary: true,
        contentHash: version.value.contentHash,
      }),
    ]);
    const managedIds = new Set(managed.map((experiment) => experiment.id));
    const secondary = contentMatches.filter(
      (experiment) => experiment.task.type === "inline_prompt" && !managedIds.has(experiment.id),
    );
    evidence.value = [
      ...managed.map((experiment) => ({ experiment, kind: "managed" as const })),
      ...secondary.map((experiment) => ({ experiment, kind: "content_match" as const })),
    ];
  }

  watch([streamName, window, () => prompt.value.name, () => version.value.version], loadTraffic, {
    immediate: true,
  });
  onUnmounted(cancelAll);

  return {
    kpis,
    breakdown,
    recent,
    evidence,
    loading,
    error,
    loadTraffic,
    loadExperimentEvidence,
  };
}
