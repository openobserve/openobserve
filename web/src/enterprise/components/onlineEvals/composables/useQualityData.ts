// Quality page data composable.
// Queries `_llm_scores` (Logs) and `_evaluator` (Traces) system streams
// for Tier 1 KPI values. Each refresh runs current-window and prev-window
// aggregates in parallel; one stream's failure doesn't break the page.

import { computed, ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";

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
  id:
    | "evaluated"
    | "qualityIssueRate"
    | "evaluationCost"
    | "jobSuccess"
    | "scorerFailures"
    | "latencyP95";
  value: number | null;
  prevValue: number | null;
  /** small series for the sparkline; oldest → newest. Empty when no data. */
  sparkline: number[];
  healthyDirection: HealthyDirection;
  format: "percent" | "currency" | "count" | "seconds";
}


interface ScoresAggRow {
  evaluated_count?: number | string;
  unhealthy_count?: number | string;
}

interface EvaluatorAggRow {
  total_runs?: number | string;
  success_runs?: number | string;
  failure_runs?: number | string;
  latency_p95_ms?: number | string | null;
}

interface ScoresBucketRow {
  bucket?: string | number;
  evaluated_c?: number | string;
  unhealthy_c?: number | string;
}

interface EvaluatorBucketRow {
  bucket?: string | number;
  total?: number | string;
  success?: number | string;
  failures?: number | string;
  latency_p95_ms?: number | string | null;
}


function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function emptyKpis(): KpiCard[] {
  return [
    { id: "evaluated", value: null, prevValue: null, sparkline: [], healthyDirection: "up", format: "percent" },
    { id: "qualityIssueRate", value: null, prevValue: null, sparkline: [], healthyDirection: "down", format: "percent" },
    { id: "evaluationCost", value: null, prevValue: null, sparkline: [], healthyDirection: "neutral", format: "currency" },
    { id: "jobSuccess", value: null, prevValue: null, sparkline: [], healthyDirection: "up", format: "percent" },
    { id: "scorerFailures", value: null, prevValue: null, sparkline: [], healthyDirection: "down", format: "count" },
    { id: "latencyP95", value: null, prevValue: null, sparkline: [], healthyDirection: "down", format: "seconds" },
  ];
}

// Only references columns that always exist on `_llm_scores` (trace_id,
// data_type, value_boolean). value_numeric / value_categorical are dropped
// here because they only enter the schema once at least one score of that
// data_type has been written. Per-config unhealthy detection (which can
// reference all three) lives on the Tier 2 query instead.
function scoresSql(): string {
  // Scores are written per-span (each evaluated span produces one row per
  // scorer), so the right unit for "evaluated" is distinct span_id, not
  // trace_id. A single trace can have many evaluated spans.
  return [
    "SELECT",
    "  COUNT(DISTINCT span_id) AS evaluated_count,",
    "  COUNT(DISTINCT CASE WHEN data_type = 'boolean' AND value_boolean = false THEN span_id END) AS unhealthy_count",
    'FROM "_llm_scores"',
  ].join("\n");
}

// `_evaluator` spans flatten OTel attributes under an `attributes_` prefix.
function evaluatorSql(): string {
  return [
    "SELECT",
    "  COUNT(*) AS total_runs,",
    "  COUNT(CASE WHEN attributes_status = 'success' THEN 1 END) AS success_runs,",
    "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failure_runs,",
    "  approx_percentile_cont(attributes_latency_ms, 0.95) AS latency_p95_ms",
    'FROM "_evaluator"',
  ].join("\n");
}

function scoresSparklineSql(interval: string): string {
  // Same span-level rollup as scoresSql() — distinct span_id per bucket.
  return [
    "SELECT",
    `  histogram(_timestamp, '${interval}') AS bucket,`,
    "  COUNT(DISTINCT span_id) AS evaluated_c,",
    "  COUNT(DISTINCT CASE WHEN data_type = 'boolean' AND value_boolean = false THEN span_id END) AS unhealthy_c",
    'FROM "_llm_scores"',
    "GROUP BY bucket",
    "ORDER BY bucket",
  ].join("\n");
}

function evaluatorSparklineSql(interval: string): string {
  return [
    "SELECT",
    `  histogram(_timestamp, '${interval}') AS bucket,`,
    "  COUNT(*) AS total,",
    "  COUNT(CASE WHEN attributes_status = 'success' THEN 1 END) AS success,",
    "  COUNT(CASE WHEN attributes_status IN ('error', 'timeout') THEN 1 END) AS failures,",
    "  approx_percentile_cont(attributes_latency_ms, 0.95) AS latency_p95_ms",
    'FROM "_evaluator"',
    "GROUP BY bucket",
    "ORDER BY bucket",
  ].join("\n");
}

export function useQualityData(dateWindow: import("vue").Ref<DateWindow>) {
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
      const [scoresNow, scoresPrev, evalNow, evalPrev, scoresSeries, evalSeries] =
        await Promise.all([
          fetchAgg<ScoresAggRow>("logs", scoresSql(), startUs, endUs, "scores.now"),
          fetchAgg<ScoresAggRow>("logs", scoresSql(), prevStartUs, prevEndUs, "scores.prev"),
          fetchAgg<EvaluatorAggRow>("traces", evaluatorSql(), startUs, endUs, "eval.now"),
          fetchAgg<EvaluatorAggRow>("traces", evaluatorSql(), prevStartUs, prevEndUs, "eval.prev"),
          fetchHits<ScoresBucketRow>("logs", scoresSparklineSql(interval), startUs, endUs, "scores.spark"),
          fetchHits<EvaluatorBucketRow>("traces", evaluatorSparklineSql(interval), startUs, endUs, "eval.spark"),
        ]);

      const evaluatedSpark = scoresSeries.map((r) => toNumber(r.evaluated_c) ?? 0);
      const issueRateSpark = scoresSeries.map((r) => {
        const e = toNumber(r.evaluated_c) ?? 0;
        const u = toNumber(r.unhealthy_c) ?? 0;
        return e > 0 ? (u / e) * 100 : 0;
      });
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

      const evaluatedNow = toNumber(scoresNow?.evaluated_count);
      const evaluatedPrev = toNumber(scoresPrev?.evaluated_count);
      const unhealthyNow = toNumber(scoresNow?.unhealthy_count);
      const unhealthyPrev = toNumber(scoresPrev?.unhealthy_count);

      const issueRateNow =
        evaluatedNow && evaluatedNow > 0 && unhealthyNow != null
          ? (unhealthyNow / evaluatedNow) * 100
          : null;
      const issueRatePrev =
        evaluatedPrev && evaluatedPrev > 0 && unhealthyPrev != null
          ? (unhealthyPrev / evaluatedPrev) * 100
          : null;

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
          id: "qualityIssueRate",
          value: issueRateNow,
          prevValue: issueRatePrev,
          sparkline: issueRateSpark,
          healthyDirection: "down",
          format: "percent",
        },
        {
          // EVALUATION COST is not yet captured in `_evaluator` attributes.
          // Leave null until the backend exposes a cost field.
          id: "evaluationCost",
          value: null,
          prevValue: null,
          sparkline: [],
          healthyDirection: "neutral",
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
