// Eval Job detail — Runs + Failures tab data.
// Queries `_evaluator` for invocations of a single job. KPIs (total runs,
// success rate, avg latency) come from a single rollup query; the runs table
// comes from a separate hits query that's lazily fired only when the Runs or
// Failures tab is active. A third small query rolls failures up by scorer so
// the Failures tab can show which scorer is the culprit.

import { computed, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";

export type RunStatus = "success" | "error" | "timeout" | "skipped" | "unknown";

export interface JobRunKpis {
  totalRuns: number | null;
  successRate: number | null; // 0-100
  avgLatencyMs: number | null;
  failureCount: number | null;
}

export interface JobRunRow {
  /** Span id from `_evaluator` itself — used as row key. */
  id: string;
  timestampMs: number;
  status: RunStatus;
  scorerId: string;
  targetSpanId: string;
  targetTraceId: string;
  targetStream: string;
  latencyMs: number | null;
  scoreNumeric: number | null;
  scoreBoolean: boolean | null;
  scoreCategorical: string | null;
  scoreDisplay: string;
}

/** Per-scorer rollup used by the Failures tab to show "which scorer is failing
 * most" at a glance. */
export interface FailuresByScorer {
  scorerId: string;
  totalRuns: number;
  failures: number;
  failureRate: number; // 0-100
}

const EMPTY_KPIS: JobRunKpis = {
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
  if (s === "success" || s === "error" || s === "timeout" || s === "skipped") return s;
  return "unknown";
}

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
  attributes_scorer_id?: string | null;
  attributes_target_span_id?: string | null;
  attributes_target_trace_id?: string | null;
  attributes_target_stream?: string | null;
  attributes_response?: any;
  span_id?: string;
}

interface FailuresByScorerRow {
  scorer_id?: string;
  total_runs?: number | string;
  failures?: number | string;
}

export interface JobRunsWindow {
  startUs: number;
  endUs: number;
}

export function useEvalJobRuns(
  jobId: Ref<string | null>,
  /** Active window. */
  dateWindow: Ref<JobRunsWindow>,
  /** Toggled to `true` by the parent only when the Runs or Failures tab is
   * active, so the (heavier) runs hits + failures-by-scorer queries don't fire
   * while a different tab is open. KPIs always run when `jobId` is set since
   * the KPI strip is visible in every tab. */
  tableEnabled: Ref<boolean>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const isLoadingKpis = ref(false);
  const isLoading = ref(false);
  const kpis = ref<JobRunKpis>({ ...EMPTY_KPIS });
  const runs = ref<JobRunRow[]>([]);
  const failuresByScorer = ref<FailuresByScorer[]>([]);

  const kpiSql = computed<string | null>(() => {
    const id = jobId.value;
    if (!id) return null;
    return [
      "SELECT",
      "  COUNT(*) AS total_runs,",
      "  COUNT(CASE WHEN attributes_status = 'success' THEN 1 END) AS success_runs,",
      "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failure_runs,",
      // `attributes_latency_ms` is auto-inferred as Utf8 when the SDK
      // emits the value as a JSON string. AVG requires a numeric input,
      // so TRY_CAST to Double — unparseable values become NULL and AVG
      // silently skips them.
      "  AVG(TRY_CAST(attributes_latency_ms AS DOUBLE)) AS avg_latency_ms",
      'FROM "_evaluator"',
      `WHERE CAST(attributes_job_id AS VARCHAR) = '${escapeSqlString(id)}'`,
    ].join("\n");
  });

  const runsSql = computed<string | null>(() => {
    const id = jobId.value;
    if (!id) return null;
    return [
      "SELECT",
      "  span_id,",
      "  _timestamp,",
      "  attributes_status,",
      "  attributes_latency_ms,",
      "  attributes_scorer_id,",
      "  attributes_target_span_id,",
      "  attributes_target_trace_id,",
      "  attributes_target_stream,",
      "  attributes_response",
      'FROM "_evaluator"',
      `WHERE CAST(attributes_job_id AS VARCHAR) = '${escapeSqlString(id)}'`,
      "ORDER BY _timestamp DESC",
      "LIMIT 200",
    ].join("\n");
  });

  const failuresByScorerSql = computed<string | null>(() => {
    const id = jobId.value;
    if (!id) return null;
    return [
      "SELECT",
      "  CAST(attributes_scorer_id AS VARCHAR) AS scorer_id,",
      "  COUNT(*) AS total_runs,",
      "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failures",
      'FROM "_evaluator"',
      `WHERE CAST(attributes_job_id AS VARCHAR) = '${escapeSqlString(id)}'`,
      "GROUP BY scorer_id",
      "ORDER BY failures DESC",
    ].join("\n");
  });

  async function refreshKpis() {
    if (!jobId.value || !kpiSql.value) return;
    const { startUs, endUs } = dateWindow.value;
    isLoadingKpis.value = true;
    try {
      const kpiHits = await executeQuery(
        kpiSql.value,
        startUs,
        endUs,
        "traces",
      ).catch((err) => {
        console.warn("[JobRuns:kpis] failed", err);
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

  async function refreshTables() {
    if (!tableEnabled.value || !jobId.value) return;
    const { startUs, endUs } = dateWindow.value;
    isLoading.value = true;
    try {
      const [runHits, failureHits] = await Promise.all([
        runsSql.value
          ? executeQuery(runsSql.value, startUs, endUs, "traces").catch((err) => {
              console.warn("[JobRuns:runs] failed", err);
              return [] as RawRunRow[];
            })
          : Promise.resolve([] as RawRunRow[]),
        failuresByScorerSql.value
          ? executeQuery(failuresByScorerSql.value, startUs, endUs, "traces").catch(
              (err) => {
                console.warn("[JobRuns:failuresByScorer] failed", err);
                return [] as FailuresByScorerRow[];
              },
            )
          : Promise.resolve([] as FailuresByScorerRow[]),
      ]);

      runs.value = (runHits as RawRunRow[]).map((r): JobRunRow => {
        const score = extractScore(r.attributes_response);
        return {
          id: r.span_id ?? `${r._timestamp ?? ""}-${r.attributes_target_span_id ?? ""}`,
          timestampMs: bucketToMs(r._timestamp),
          status: parseStatus(r.attributes_status),
          scorerId: r.attributes_scorer_id ?? "",
          targetSpanId: r.attributes_target_span_id ?? "",
          targetTraceId: r.attributes_target_trace_id ?? "",
          targetStream: r.attributes_target_stream ?? "",
          latencyMs: toNumber(r.attributes_latency_ms),
          scoreNumeric: score.numeric,
          scoreBoolean: score.boolean,
          scoreCategorical: score.categorical,
          scoreDisplay: scoreDisplayFrom(score),
        };
      });

      failuresByScorer.value = (failureHits as FailuresByScorerRow[])
        .map((row): FailuresByScorer => {
          const total = toNumber(row.total_runs) ?? 0;
          const fails = toNumber(row.failures) ?? 0;
          return {
            scorerId: String(row.scorer_id ?? ""),
            totalRuns: total,
            failures: fails,
            failureRate: total > 0 ? (fails / total) * 100 : 0,
          };
        })
        .filter((row) => row.scorerId);
    } finally {
      isLoading.value = false;
    }
  }

  async function refresh() {
    await Promise.all([refreshKpis(), refreshTables()]);
  }

  // KPIs are eager — fire whenever jobId or window changes, regardless of tab.
  watch(
    [jobId, dateWindow],
    () => {
      if (jobId.value) void refreshKpis();
      else kpis.value = { ...EMPTY_KPIS };
    },
    { immediate: true },
  );

  // Runs + failures-by-scorer queries are lazy — only fire when the Runs or
  // Failures tab is active.
  watch(
    [jobId, tableEnabled, dateWindow],
    () => {
      if (tableEnabled.value) void refreshTables();
      else {
        runs.value = [];
        failuresByScorer.value = [];
      }
    },
    { immediate: true },
  );

  return {
    isLoading,
    isLoadingKpis,
    kpis,
    runs,
    failuresByScorer,
    refresh,
    refreshKpis,
    refreshTables,
  };
}
