// Chart data for the Tier-2 selected-state detail panel.
// One query per chart family. Each query is scoped to a single
// score_config_id and the active time window.

import { ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import { chooseBucketInterval, type DateWindow } from "./useQualityData";
import {
  buildScoresAgentFilterWhere,
  combineWhere,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";

export interface TrendPoint {
  /** Bucket end in milliseconds */
  t: number;
  avg: number | null;
  p95: number | null;
}

export interface DistributionBucket {
  rangeStart: number;
  rangeEnd: number;
  label: string;
  count: number;
  healthy: boolean;
}

export interface BooleanTrendPoint {
  t: number;
  passRate: number; // 0-100
  total: number;
}

export interface BooleanTrendSeries {
  /** Stable id derived from the group-by key (e.g. scorer_id, source_type, or "default"). */
  id: string;
  /** Display label shown in the legend / tooltip. */
  label: string;
  points: BooleanTrendPoint[];
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
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

interface RawNumericTrendRow {
  bucket?: string | number;
  avg_v?: number | string | null;
  p95_v?: number | string | null;
}

interface RawBooleanSplitRow {
  bucket?: string | number;
  series_key?: string | number | null;
  total?: number | string;
  trues?: number | string;
}

function valueOf<T = any>(
  row: any,
  camel: string,
  snake: string,
): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

function numericRangeOf(
  config: ScoreConfig,
): { min: number; max: number } | null {
  const r = valueOf<any>(config, "numericRange", "numeric_range");
  if (!r) return null;
  const min = toNumber(r.min);
  const max = toNumber(r.max);
  if (min == null || max == null || max <= min) return null;
  return { min, max };
}

function healthyThresholdValue(
  config: ScoreConfig,
): { value: number; direction: "gte" | "lte" } | null {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  if (!ht || ht.value == null || !ht.direction) return null;
  const v = toNumber(ht.value);
  if (v == null) return null;
  return { value: v, direction: ht.direction === "gte" ? "gte" : "lte" };
}

export function useQualityDetailCharts(
  selectedConfig: Ref<ScoreConfig | null>,
  dateWindow: Ref<DateWindow>,
  agentFilter?: Ref<AgentFilterSelection | null | undefined>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const isLoading = ref(false);
  const numericTrend = ref<TrendPoint[]>([]);
  const numericDistribution = ref<DistributionBucket[]>([]);
  const booleanTrend = ref<BooleanTrendPoint[]>([]);
  const booleanTrendSeries = ref<BooleanTrendSeries[]>([]);

  async function runQuery<T>(
    sqlText: string,
    label: string,
    startUs: number,
    endUs: number,
  ): Promise<T[]> {
    try {
      const hits = await executeQuery(sqlText, startUs, endUs, "logs");
      console.debug(`[QualityCharts:${label}]`, { hitCount: hits.length });
      return hits as T[];
    } catch (err: any) {
      console.warn(`[QualityCharts:${label}] failed:`, err);
      return [];
    }
  }

  function buildDistribution(
    values: number[],
    range: { min: number; max: number },
    threshold: { value: number; direction: "gte" | "lte" } | null,
  ): DistributionBucket[] {
    if (values.length === 0) return [];
    const buckets = 8;
    const width = (range.max - range.min) / buckets;
    if (!Number.isFinite(width) || width <= 0) return [];
    const counts = new Array<number>(buckets).fill(0);
    for (const v of values) {
      let idx = Math.floor((v - range.min) / width);
      if (idx < 0) idx = 0;
      if (idx >= buckets) idx = buckets - 1;
      counts[idx] += 1;
    }
    return counts.map((c, i) => {
      const start = range.min + i * width;
      const end = i === buckets - 1 ? range.max : start + width;
      const healthy = threshold
        ? threshold.direction === "gte"
          ? start >= threshold.value
          : start <= threshold.value
        : false;
      const decimals = width < 1 ? 1 : 0;
      return {
        rangeStart: start,
        rangeEnd: end,
        label: `${start.toFixed(decimals)}–${end.toFixed(decimals)}`,
        count: c,
        healthy,
      };
    });
  }

  async function refresh() {
    const cfg = selectedConfig.value;
    if (!cfg) {
      numericTrend.value = [];
      numericDistribution.value = [];
      booleanTrend.value = [];
      booleanTrendSeries.value = [];
      return;
    }

    isLoading.value = true;
    try {
      const { startUs, endUs } = dateWindow.value;
      const interval = chooseBucketInterval((endUs - startUs) / 1000);
      // `score_config_id` on `_llm_scores` is the entity_id, not the
      // per-version row id — join on entity_id so trend/distribution chart
      // queries survive version bumps.
      const configId = escapeSqlString(entityId(cfg));
      const type = dataTypeOf(cfg);
      const where = combineWhere(
        `CAST(score_config_id AS VARCHAR) = '${configId}'`,
        buildScoresAgentFilterWhere(agentFilter?.value ?? null),
      )!;

      if (type === "numeric") {
        const trendSql = [
          "SELECT",
          `  histogram(_timestamp, '${interval}') AS bucket,`,
          "  AVG(value_numeric) AS avg_v,",
          "  approx_percentile_cont(value_numeric, 0.95) AS p95_v",
          'FROM "_llm_scores"',
          `WHERE ${where}`,
          "GROUP BY bucket",
          "ORDER BY bucket",
        ].join("\n");

        const valuesSql = [
          "SELECT value_numeric AS v",
          'FROM "_llm_scores"',
          `WHERE ${where} AND value_numeric IS NOT NULL`,
        ].join("\n");

        const [trendRows, valueRows] = await Promise.all([
          runQuery<RawNumericTrendRow>(
            trendSql,
            "numeric.trend",
            startUs,
            endUs,
          ),
          runQuery<{ v?: number | string }>(
            valuesSql,
            "numeric.values",
            startUs,
            endUs,
          ),
        ]);

        numericTrend.value = trendRows
          .map((r) => ({
            t: bucketToMs(r.bucket),
            avg: toNumber(r.avg_v),
            p95: toNumber(r.p95_v),
          }))
          .filter((r) => r.t > 0);

        const range = numericRangeOf(cfg);
        if (range) {
          const values = valueRows
            .map((r) => toNumber(r.v))
            .filter((v): v is number => v != null);
          numericDistribution.value = buildDistribution(
            values,
            range,
            healthyThresholdValue(cfg),
          );
        } else {
          numericDistribution.value = [];
        }
        booleanTrend.value = [];
        booleanTrendSeries.value = [];
      } else if (type === "boolean") {
        // Single pass-rate series — a constant series_key keeps the downstream
        // grouped-series code path working as a one-element array.
        const trendSql = [
          "SELECT",
          `  histogram(_timestamp, '${interval}') AS bucket,`,
          "  '__default__' AS series_key,",
          "  COUNT(*) AS total,",
          "  COUNT(CASE WHEN value_boolean = true THEN 1 END) AS trues",
          'FROM "_llm_scores"',
          `WHERE ${where}`,
          "GROUP BY bucket, series_key",
          "ORDER BY bucket",
        ].join("\n");
        const rows = await runQuery<RawBooleanSplitRow>(
          trendSql,
          "boolean.trend",
          startUs,
          endUs,
        );

        const groupedByKey = new Map<string, BooleanTrendPoint[]>();
        for (const r of rows) {
          const key =
            r.series_key != null ? String(r.series_key) : "__default__";
          const total = toNumber(r.total) ?? 0;
          const trues = toNumber(r.trues) ?? 0;
          const point: BooleanTrendPoint = {
            t: bucketToMs(r.bucket),
            total,
            passRate: total > 0 ? (trues / total) * 100 : 0,
          };
          if (point.t === 0) continue;
          if (!groupedByKey.has(key)) groupedByKey.set(key, []);
          groupedByKey.get(key)!.push(point);
        }

        const series: BooleanTrendSeries[] = Array.from(
          groupedByKey.entries(),
        ).map(([key, points]) => ({
          id: key,
          label: key === "__default__" ? "Pass rate" : key,
          points: points.sort((a, b) => a.t - b.t),
        }));
        // Sort by total volume descending so the dominant series renders first.
        series.sort(
          (a, b) =>
            b.points.reduce((s, p) => s + p.total, 0) -
            a.points.reduce((s, p) => s + p.total, 0),
        );

        booleanTrendSeries.value = series;
        // Keep the legacy flat array for any consumer still binding it; it
        // mirrors the first (largest) series.
        booleanTrend.value = series[0]?.points ?? [];

        numericTrend.value = [];
        numericDistribution.value = [];
      } else {
        numericTrend.value = [];
        numericDistribution.value = [];
        booleanTrend.value = [];
        booleanTrendSeries.value = [];
      }
    } finally {
      isLoading.value = false;
    }
  }

  // Only opening the drawer on a row (selectedConfig change) refreshes from
  // here. Date-window / agent-filter changes are driven by the page's
  // refreshAll(), so watching them here would double-fire the chart queries
  // alongside the KPI/table reload. No `immediate`: the initial load is
  // covered by refreshAll() too.
  watch(selectedConfig, () => {
    void refresh();
  });

  return {
    isLoading,
    numericTrend,
    numericDistribution,
    booleanTrend,
    booleanTrendSeries,
    refresh,
  };
}
