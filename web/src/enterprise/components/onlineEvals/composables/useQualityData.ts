// Quality page data composable.
// Queries `_llm_scores` (Logs) and `_evaluator` (Traces) system streams
// for KPI values. Each refresh runs current-window and prev-window
// aggregates in parallel; one stream's failure doesn't break the page.

import { computed, ref, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import {
  buildEvaluatorAgentFilterWhere,
  buildScoresAgentFilterWhere,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";

export type TimeRangeKey = "last1h" | "last24h" | "last7d" | "last30d";

/** Absolute time window in microseconds-since-epoch (OO's `_timestamp` unit). */
export interface DateWindow {
  startUs: number;
  endUs: number;
}

export type HealthyDirection = "up" | "down" | "neutral";

/** Choose a histogram bucket interval that yields ~10-30 buckets across the window. */
export function chooseBucketInterval(windowMs: number): string {
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (windowMs <= 2 * hour) return "5 minute";
  if (windowMs <= 12 * hour) return "30 minute";
  if (windowMs <= 2 * day) return "1 hour";
  if (windowMs <= 14 * day) return "6 hour";
  return "1 day";
}

export interface KpiCard {
  id: "evaluated" | "evaluationCost" | "jobSuccess" | "scorerFailures" | "latencyP95";
  value: number | null;
  prevValue: number | null;
  /** small series for the sparkline; oldest → newest. Empty when no data. */
  sparkline: number[];
  healthyDirection: HealthyDirection;
  format: "percent" | "currency" | "count" | "seconds";
}

interface ScoresAggRow {
  evaluated_count?: number | string;
}

interface EvaluatorAggRow {
  total_runs?: number | string;
  success_runs?: number | string;
  failure_runs?: number | string;
  latency_p95_ms?: number | string | null;
  total_cost_usd?: number | string | null;
}

interface ScoresBucketRow {
  bucket?: string | number;
  evaluated_c?: number | string;
}

interface EvaluatorBucketRow {
  bucket?: string | number;
  total?: number | string;
  success?: number | string;
  failures?: number | string;
  latency_p95_ms?: number | string | null;
  cost_usd?: number | string | null;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function emptyKpis(): KpiCard[] {
  return [
    {
      id: "evaluated",
      value: null,
      prevValue: null,
      sparkline: [],
      healthyDirection: "up",
      format: "percent",
    },
    {
      id: "evaluationCost",
      value: null,
      prevValue: null,
      sparkline: [],
      healthyDirection: "neutral",
      format: "currency",
    },
    {
      id: "jobSuccess",
      value: null,
      prevValue: null,
      sparkline: [],
      healthyDirection: "up",
      format: "percent",
    },
    {
      id: "scorerFailures",
      value: null,
      prevValue: null,
      sparkline: [],
      healthyDirection: "down",
      format: "count",
    },
    {
      id: "latencyP95",
      value: null,
      prevValue: null,
      sparkline: [],
      healthyDirection: "down",
      format: "seconds",
    },
  ];
}

// Org-wide KPI aggregate over `_llm_scores`. Only the evaluated-spans count
// is surfaced here — per-config unhealthy counts live on the table
// in `useQualityScoreConfigs`. Scores are written per-span (each evaluated
// span produces one row per scorer), so distinct span_id is the right unit
// for "evaluated"; a single trace can have many evaluated spans.
function whereLines(whereClause: string | null): string[] {
  return whereClause ? [`WHERE ${whereClause}`] : [];
}

function scoresSql(whereClause: string | null): string {
  return [
    "SELECT",
    "  COUNT(DISTINCT span_id) AS evaluated_count",
    'FROM "_llm_scores"',
    ...whereLines(whereClause),
  ].join("\n");
}

// `_evaluator` spans flatten OTel attributes under an `attributes_` prefix.
// `attributes_latency_ms` is auto-inferred as Utf8 when the first ingested
// value arrives quoted (OTel SDKs sometimes serialize numeric attributes as
// strings). `approx_percentile_cont` requires a numeric input, so we
// TRY_CAST to Double — TRY_CAST returns NULL on unparseable values and
// the percentile aggregator skips NULLs, keeping the query robust.
//
// Cost lives at the top level as `gen_ai_usage_cost` (OTel GenAI semantic
// convention) — not under `attributes_`. Already a Float64 in the schema,
// so no cast needed; SUM() naturally skips NULLs if any sneak in.
function evaluatorSql(whereClause: string | null): string {
  return [
    "SELECT",
    "  COUNT(*) AS total_runs,",
    "  COUNT(CASE WHEN attributes_status = 'success' THEN 1 END) AS success_runs,",
    "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failure_runs,",
    "  approx_percentile_cont(TRY_CAST(attributes_latency_ms AS DOUBLE), 0.95) AS latency_p95_ms,",
    "  SUM(gen_ai_usage_cost) AS total_cost_usd",
    'FROM "_evaluator"',
    ...whereLines(whereClause),
  ].join("\n");
}

function scoresSparklineSql(interval: string, whereClause: string | null): string {
  // Same span-level rollup as scoresSql() — distinct span_id per bucket.
  return [
    "SELECT",
    `  histogram(_timestamp, '${interval}') AS bucket,`,
    "  COUNT(DISTINCT span_id) AS evaluated_c",
    'FROM "_llm_scores"',
    ...whereLines(whereClause),
    "GROUP BY bucket",
    "ORDER BY bucket",
  ].join("\n");
}

function evaluatorSparklineSql(interval: string, whereClause: string | null): string {
  return [
    "SELECT",
    `  histogram(_timestamp, '${interval}') AS bucket,`,
    "  COUNT(*) AS total,",
    "  COUNT(CASE WHEN attributes_status = 'success' THEN 1 END) AS success,",
    "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failures,",
    "  approx_percentile_cont(TRY_CAST(attributes_latency_ms AS DOUBLE), 0.95) AS latency_p95_ms,",
    "  SUM(gen_ai_usage_cost) AS cost_usd",
    'FROM "_evaluator"',
    ...whereLines(whereClause),
    "GROUP BY bucket",
    "ORDER BY bucket",
  ].join("\n");
}

export function useQualityData(
  dateWindow: Ref<DateWindow>,
  agentFilter?: Ref<AgentFilterSelection | null | undefined>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const sourceStream = ref<string>("__all__");
  const isLoading = ref(false);
  const kpis = ref<KpiCard[]>(emptyKpis());

  async function fetchHits<T>(
    pageType: "logs" | "traces",
    sql: string,
    startUs: number,
    endUs: number,
    label: string,
  ): Promise<T[]> {
    try {
      const hits = await executeQuery(sql, startUs, endUs, pageType);
      console.debug(`[Quality:${label}]`, {
        pageType,
        startUs,
        endUs,
        hitCount: hits.length,
      });
      return hits as T[];
    } catch (err: any) {
      console.warn(`[Quality:${label}] ${pageType} query failed:`, err);
      return [];
    }
  }

  async function fetchAgg<T>(
    pageType: "logs" | "traces",
    sql: string,
    startUs: number,
    endUs: number,
    label: string,
  ): Promise<T | null> {
    const hits = await fetchHits<T>(pageType, sql, startUs, endUs, label);
    return hits.length > 0 ? hits[0] : null;
  }

  async function refresh() {
    isLoading.value = true;
    try {
      const { startUs, endUs } = dateWindow.value;
      const windowUs = endUs - startUs;
      const prevEndUs = startUs;
      const prevStartUs = startUs - windowUs;
      const windowMs = windowUs / 1000;
      const interval = chooseBucketInterval(windowMs);
      const selectedAgent = agentFilter?.value ?? null;
      const scoresWhere = buildScoresAgentFilterWhere(selectedAgent);
      const evaluatorWhere = buildEvaluatorAgentFilterWhere(selectedAgent);
      const [scoresNow, scoresPrev, evalNow, evalPrev, scoresSeries, evalSeries] =
        await Promise.all([
          fetchAgg<ScoresAggRow>("logs", scoresSql(scoresWhere), startUs, endUs, "scores.now"),
          fetchAgg<ScoresAggRow>(
            "logs",
            scoresSql(scoresWhere),
            prevStartUs,
            prevEndUs,
            "scores.prev",
          ),
          fetchAgg<EvaluatorAggRow>(
            "traces",
            evaluatorSql(evaluatorWhere),
            startUs,
            endUs,
            "eval.now",
          ),
          fetchAgg<EvaluatorAggRow>(
            "traces",
            evaluatorSql(evaluatorWhere),
            prevStartUs,
            prevEndUs,
            "eval.prev",
          ),
          fetchHits<ScoresBucketRow>(
            "logs",
            scoresSparklineSql(interval, scoresWhere),
            startUs,
            endUs,
            "scores.spark",
          ),
          fetchHits<EvaluatorBucketRow>(
            "traces",
            evaluatorSparklineSql(interval, evaluatorWhere),
            startUs,
            endUs,
            "eval.spark",
          ),
        ]);

      const evaluatedSpark = scoresSeries.map((r) => toNumber(r.evaluated_c) ?? 0);
      const jobSuccessSpark = evalSeries.map((r) => {
        const tot = toNumber(r.total) ?? 0;
        const ok = toNumber(r.success) ?? 0;
        return tot > 0 ? (ok / tot) * 100 : 0;
      });
      const failuresSpark = evalSeries.map((r) => toNumber(r.failures) ?? 0);
      const latencySpark = evalSeries.map((r) => {
        const ms = toNumber(r.latency_p95_ms);
        return ms != null ? ms / 1000 : 0;
      });
      const costSpark = evalSeries.map((r) => toNumber(r.cost_usd) ?? 0);

      const evaluatedNow = toNumber(scoresNow?.evaluated_count);
      const evaluatedPrev = toNumber(scoresPrev?.evaluated_count);

      const totalNow = toNumber(evalNow?.total_runs);
      const successNow = toNumber(evalNow?.success_runs);
      const totalPrev = toNumber(evalPrev?.total_runs);
      const successPrev = toNumber(evalPrev?.success_runs);

      const jobSuccessNow =
        totalNow && totalNow > 0 && successNow != null ? (successNow / totalNow) * 100 : null;
      const jobSuccessPrev =
        totalPrev && totalPrev > 0 && successPrev != null ? (successPrev / totalPrev) * 100 : null;

      const latencyP95SecNow = toNumber(evalNow?.latency_p95_ms);
      const latencyP95SecPrev = toNumber(evalPrev?.latency_p95_ms);

      const costNow = toNumber(evalNow?.total_cost_usd);
      const costPrev = toNumber(evalPrev?.total_cost_usd);

      kpis.value = [
        {
          id: "evaluated",
          value: evaluatedNow,
          prevValue: evaluatedPrev,
          sparkline: evaluatedSpark,
          healthyDirection: "up",
          format: "count",
        },
        {
          // Total USD spent by the evaluator (LLM-judge scorer calls) over
          // the window. Sourced from `gen_ai_usage_cost` on `_evaluator` —
          // top-level OTel GenAI semantic-convention column. Healthy
          // direction is "down" (lower spend = better) so the delta arrow
          // turns red when cost grows.
          id: "evaluationCost",
          value: costNow,
          prevValue: costPrev,
          sparkline: costSpark,
          healthyDirection: "down",
          format: "currency",
        },
        {
          id: "jobSuccess",
          value: jobSuccessNow,
          prevValue: jobSuccessPrev,
          sparkline: jobSuccessSpark,
          healthyDirection: "up",
          format: "percent",
        },
        {
          id: "scorerFailures",
          value: toNumber(evalNow?.failure_runs),
          prevValue: toNumber(evalPrev?.failure_runs),
          sparkline: failuresSpark,
          healthyDirection: "down",
          format: "count",
        },
        {
          id: "latencyP95",
          value: latencyP95SecNow != null ? latencyP95SecNow / 1000 : null,
          prevValue: latencyP95SecPrev != null ? latencyP95SecPrev / 1000 : null,
          sparkline: latencySpark,
          healthyDirection: "down",
          format: "seconds",
        },
      ];
    } finally {
      isLoading.value = false;
    }
  }

  const deltaByKpi = computed(() =>
    kpis.value.reduce<Record<string, number | null>>((acc, k) => {
      acc[k.id] = k.value != null && k.prevValue != null ? k.value - k.prevValue : null;
      return acc;
    }, {}),
  );

  return {
    sourceStream,
    isLoading,
    kpis,
    deltaByKpi,
    refresh,
  };
}
