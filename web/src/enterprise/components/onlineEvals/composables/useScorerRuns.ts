// Scorer detail — Runs tab data.
// Queries `_evaluator` for invocations of a single scorer. KPIs (total, success
// rate, avg latency) come from a single rollup query; the runs table comes from
// a separate hits query that's lazily fired only when the Runs tab is active.

import { computed, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import {
  buildEvaluatorAgentFilterWhere,
  combineWhere,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";

export type RunStatus = "success" | "error" | "timeout" | "skipped" | "unknown";

export interface RunKpis {
  totalRuns: number | null;
  successRate: number | null; // 0-100
  avgLatencyMs: number | null;
  failureCount: number | null;
}

export interface RunRow {
  /** Span id from `_evaluator` itself — used as row key. */
  id: string;
  timestampMs: number;
  status: RunStatus;
  jobId: string;
  targetSpanId: string;
  targetTraceId: string;
  targetStream: string;
  targetStreamType: string;
  latencyMs: number | null;
  /** Parsed from `attributes_response`. One of these will be filled if the
   * judge actually returned a score; otherwise all null and `scoreDisplay` is
   * `"—"`. */
  scoreNumeric: number | null;
  scoreBoolean: boolean | null;
  scoreCategorical: string | null;
  scoreDisplay: string;
}

const EMPTY_KPIS: RunKpis = {
  totalRuns: null,
  successRate: null,
  avgLatencyMs: null,
  failureCount: null,
};

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bucketToMs(bucket: unknown): number {
  if (typeof bucket === "number") {
    return bucket > 1e14 ? Math.round(bucket / 1000) : bucket;
  }
  if (typeof bucket === "string") {
    const parsed = Date.parse(bucket);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseStatus(raw: unknown): RunStatus {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if (s === "success" || s === "error" || s === "timeout" || s === "skipped")
    return s;
  return "unknown";
}

/** Pull a score value out of `attributes_response`. The backend writes the
 * judge's raw response there (often a JSON string with `value_*` keys). */
function extractScore(response: unknown): {
  numeric: number | null;
  boolean: boolean | null;
  categorical: string | null;
} {
  if (response == null) {
    return { numeric: null, boolean: null, categorical: null };
  }
  let parsed: any = response;
  if (typeof response === "string") {
    try {
      parsed = JSON.parse(response);
    } catch {
      return { numeric: null, boolean: null, categorical: null };
    }
  }
  if (parsed && typeof parsed === "object") {
    const n = toNumber(parsed.value_numeric ?? parsed.score ?? parsed.value);
    const b =
      typeof parsed.value_boolean === "boolean"
        ? parsed.value_boolean
        : typeof parsed.passed === "boolean"
          ? parsed.passed
          : null;
    const c =
      typeof parsed.value_categorical === "string"
        ? parsed.value_categorical
        : typeof parsed.category === "string"
          ? parsed.category
          : null;
    return { numeric: n, boolean: b, categorical: c };
  }
  return { numeric: null, boolean: null, categorical: null };
}

function scoreDisplayFrom(score: {
  numeric: number | null;
  boolean: boolean | null;
  categorical: string | null;
}): string {
  if (score.numeric != null) return score.numeric.toFixed(2);
  if (score.boolean != null) return score.boolean ? "true" : "false";
  if (score.categorical != null) return score.categorical;
  return "—";
}

interface KpiRow {
  total_runs?: number | string;
  success_runs?: number | string;
  failure_runs?: number | string;
  avg_latency_ms?: number | string | null;
}

interface RawRunRow {
  _timestamp?: string | number;
  attributes_status?: string;
  attributes_latency_ms?: number | string | null;
  attributes_job_id?: string | null;
  attributes_target_span_id?: string | null;
  attributes_target_trace_id?: string | null;
  attributes_target_stream?: string | null;
  attributes_target_stream_type?: string | null;
  attributes_response?: any;
  span_id?: string;
}

export interface ScorerRunsWindow {
  startUs: number;
  endUs: number;
}

export function useScorerRuns(
  scorerId: Ref<string | null>,
  /** Active window. */
  dateWindow: Ref<ScorerRunsWindow>,
  /** Toggled to `true` by the parent only when the Runs tab is active. Gates
   * the (heavier) runs hits query; KPIs always fire when `scorerId` is set
   * since the KPI strip is visible in every tab. */
  runsEnabled: Ref<boolean>,
  agentFilter?: Ref<AgentFilterSelection | null | undefined>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const isLoadingKpis = ref(false);
  const isLoadingRuns = ref(false);
  const kpis = ref<RunKpis>({ ...EMPTY_KPIS });
  const runs = ref<RunRow[]>([]);

  const kpiSql = computed<string | null>(() => {
    const id = scorerId.value;
    if (!id) return null;
    const where = combineWhere(
      `CAST(attributes_scorer_id AS VARCHAR) = '${escapeSqlString(id)}'`,
      buildEvaluatorAgentFilterWhere(agentFilter?.value ?? null),
    );
    return [
      "SELECT",
      "  COUNT(*) AS total_runs,",
      "  COUNT(CASE WHEN attributes_status = 'success' THEN 1 END) AS success_runs,",
      "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failure_runs,",
      // Same Utf8 column problem as the evaluator latency on the Quality
      // page — TRY_CAST so AVG can swallow the string-typed values.
      "  AVG(TRY_CAST(attributes_latency_ms AS DOUBLE)) AS avg_latency_ms",
      'FROM "_evaluator"',
      `WHERE ${where}`,
    ].join("\n");
  });

  const runsSql = computed<string | null>(() => {
    const id = scorerId.value;
    if (!id) return null;
    const where = combineWhere(
      `CAST(attributes_scorer_id AS VARCHAR) = '${escapeSqlString(id)}'`,
      buildEvaluatorAgentFilterWhere(agentFilter?.value ?? null),
    );
    return [
      "SELECT",
      "  span_id,",
      "  _timestamp,",
      "  attributes_status,",
      "  attributes_latency_ms,",
      "  attributes_job_id,",
      "  attributes_target_span_id,",
      "  attributes_target_trace_id,",
      "  attributes_target_stream,",
      "  attributes_target_stream_type,",
      "  attributes_response",
      'FROM "_evaluator"',
      `WHERE ${where}`,
      "ORDER BY _timestamp DESC",
      "LIMIT 200",
    ].join("\n");
  });

  async function refreshKpis() {
    if (!scorerId.value || !kpiSql.value) return;
    const { startUs, endUs } = dateWindow.value;
    isLoadingKpis.value = true;
    try {
      const kpiHits = await executeQuery(
        kpiSql.value,
        startUs,
        endUs,
        "traces",
      ).catch((err) => {
        console.warn("[ScorerRuns:kpis] failed", err);
        return [] as KpiRow[];
      });
      const k = (kpiHits as KpiRow[])[0] ?? null;
      if (k) {
        const total = toNumber(k.total_runs) ?? 0;
        const success = toNumber(k.success_runs) ?? 0;
        kpis.value = {
          totalRuns: total,
          successRate: total > 0 ? (success / total) * 100 : null,
          avgLatencyMs: toNumber(k.avg_latency_ms),
          failureCount: toNumber(k.failure_runs),
        };
      } else {
        kpis.value = { ...EMPTY_KPIS };
      }
    } finally {
      isLoadingKpis.value = false;
    }
  }

  async function refreshRuns() {
    if (!runsEnabled.value || !scorerId.value || !runsSql.value) return;
    const { startUs, endUs } = dateWindow.value;
    isLoadingRuns.value = true;
    try {
      const runHits = await executeQuery(
        runsSql.value,
        startUs,
        endUs,
        "traces",
      ).catch((err) => {
        console.warn("[ScorerRuns:runs] failed", err);
        return [] as RawRunRow[];
      });
      runs.value = (runHits as RawRunRow[]).map((r): RunRow => {
        const score = extractScore(r.attributes_response);
        return {
          id:
            r.span_id ??
            `${r._timestamp ?? ""}-${r.attributes_target_span_id ?? ""}`,
          timestampMs: bucketToMs(r._timestamp),
          status: parseStatus(r.attributes_status),
          jobId: r.attributes_job_id ?? "",
          targetSpanId: r.attributes_target_span_id ?? "",
          targetTraceId: r.attributes_target_trace_id ?? "",
          targetStream: r.attributes_target_stream ?? "",
          targetStreamType: r.attributes_target_stream_type ?? "traces",
          latencyMs: toNumber(r.attributes_latency_ms),
          scoreNumeric: score.numeric,
          scoreBoolean: score.boolean,
          scoreCategorical: score.categorical,
          scoreDisplay: scoreDisplayFrom(score),
        };
      });
    } finally {
      isLoadingRuns.value = false;
    }
  }

  async function refresh() {
    await Promise.all([refreshKpis(), refreshRuns()]);
  }

  // KPIs are eager — fire whenever scorerId or window changes, regardless of tab.
  watch(
    [scorerId, dateWindow, agentFilter ?? ref(null)],
    () => {
      if (scorerId.value) void refreshKpis();
      else kpis.value = { ...EMPTY_KPIS };
    },
    { immediate: true },
  );

  // Runs hits are lazy — only fire when the Runs tab is active.
  watch(
    [scorerId, runsEnabled, dateWindow, agentFilter ?? ref(null)],
    () => {
      if (runsEnabled.value) void refreshRuns();
      else runs.value = [];
    },
    { immediate: true },
  );

  return {
    isLoadingKpis,
    isLoadingRuns,
    kpis,
    runs,
    refresh,
    refreshKpis,
    refreshRuns,
  };
}
