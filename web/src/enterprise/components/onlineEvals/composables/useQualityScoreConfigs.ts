// Tier 2 Overview composable.
// Batched latest-score aggregates across span, trace, and session targets,
// keyed by each Score Config's stable entity_id.

import { computed, ref, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import { chooseBucketInterval, type DateWindow } from "./useQualityData";
import {
  buildScoresAgentFilterWhere,
  combineWhere,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";
import { latestScoreAttemptsFromSql, latestScoresFromSql } from "../utils/latestScoreSql";
import { scopeCountsFromRow, type ScopeCounts } from "../utils/qualityScope";
import { qualitySummaryForConfig, type QualityFormat } from "../utils/qualitySummary";
import { buildUnhealthyCaseBranches, thresholdForConfig } from "../utils/scoreThreshold";

// "unhealthy" | "warn" | "noThreshold" are legacy — no longer produced here,
// but QualityConfigSidebar still branches on them.
export type ConfigStatus = "healthy" | "noData" | "unhealthy" | "warn" | "noThreshold";

export interface ScoreConfigRow {
  config: ScoreConfig;
  configId: string;
  name: string;
  description: string;
  dataType: "numeric" | "categorical" | "boolean" | "unknown";
  totalScores: number;
  scopeCounts: ScopeCounts;
  qualityValue: number | string | null;
  qualityFormat: QualityFormat;
  qualityLabel: string;
  hasThreshold: boolean;
  thresholdLabel: string;
  unhealthyCount: number | null;
  unhealthyPercent: number | null;
  lastUpdatedMs: number | null;
  status: ConfigStatus;
  statusPriority: number;
  trendSparkline: number[];
  /** Legacy field kept for QualityConfigSidebar, which guards on its absence.
      `hasThreshold` is declared above and IS populated, so it is not repeated
      here — the merge briefly had it twice. */
  unhealthyPct?: number | null;
}

interface AggRow {
  score_config_id?: string | null;
  total_scores?: number | string;
  span_count?: number | string;
  trace_count?: number | string;
  session_count?: number | string;
  avg_numeric?: number | string | null;
  numeric_values?: number | string;
  unhealthy_scores?: number | string | null;
  true_scores?: number | string;
  false_scores?: number | string;
  last_updated_us?: number | string | null;
}

interface TrendRow {
  score_config_id?: string | null;
  bucket?: string | number;
  c?: number | string;
}

interface CategoryRow {
  score_config_id?: string | null;
  value_categorical?: string | null;
  c?: number | string;
}

function bucketIntervalMs(interval: string): number {
  const match = interval.trim().match(/^(\d+)\s+(minute|hour|day)$/i);
  if (!match) return 60_000;
  const amount = Number(match[1]);
  const unitMs =
    match[2].toLowerCase() === "day"
      ? 86_400_000
      : match[2].toLowerCase() === "hour"
        ? 3_600_000
        : 60_000;
  return amount * unitMs;
}

function trendBucketMs(bucket: unknown): number | null {
  if (typeof bucket === "number") {
    return bucket > 1e14 ? Math.round(bucket / 1000) : bucket;
  }
  if (typeof bucket !== "string" || !bucket) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(bucket) ? bucket : `${bucket}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildTrendSeries(
  rows: TrendRow[],
  startUs: number,
  endUs: number,
  interval: string,
): Record<string, number[]> {
  const intervalMs = bucketIntervalMs(interval);
  const startMs = Math.floor(startUs / 1000 / intervalMs) * intervalMs;
  const endMs = Math.floor(endUs / 1000 / intervalMs) * intervalMs;
  const bucketCount = Math.max(1, Math.min(1000, Math.floor((endMs - startMs) / intervalMs) + 1));
  const countsByConfig: Record<string, Map<number, number>> = {};

  for (const row of rows) {
    const id = row.score_config_id ? String(row.score_config_id) : "";
    const bucketMs = trendBucketMs(row.bucket);
    if (!id || bucketMs == null) continue;
    const alignedBucket = Math.floor(bucketMs / intervalMs) * intervalMs;
    if (!countsByConfig[id]) countsByConfig[id] = new Map();
    countsByConfig[id].set(
      alignedBucket,
      (countsByConfig[id].get(alignedBucket) ?? 0) + (toNumber(row.c) ?? 0),
    );
  }

  const seriesByConfig: Record<string, number[]> = {};
  for (const [id, counts] of Object.entries(countsByConfig)) {
    seriesByConfig[id] = Array.from({ length: bucketCount }, (_, index) => {
      const bucketMs = startMs + index * intervalMs;
      return counts.get(bucketMs) ?? 0;
    });
  }
  return seriesByConfig;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The ID stored on score records under `score_config_id` is the Score
 * Config's stable `entity_id` (the per-row version is tracked in a separate
 * `score_config_version` column on `_llm_scores`). Joining on `entity_id`
 * survives every version bump and matches the cross-version identifier the
 * rest of the UI keys on. */
function joinId(config: ScoreConfig): string {
  return entityId(config);
}

export function buildQualityConfigAggSql(
  configs: ScoreConfig[],
  agentWhere: string | null,
): string {
  const where = combineWhere("score_config_id IS NOT NULL", agentWhere);
  const unhealthyCase = buildUnhealthyCaseBranches(configs, "1");
  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    "  COUNT(*) AS total_scores,",
    "  COUNT(CASE WHEN _target_scope = 'span' THEN 1 END) AS span_count,",
    "  COUNT(CASE WHEN _target_scope = 'trace' THEN 1 END) AS trace_count,",
    "  COUNT(CASE WHEN _target_scope = 'session' THEN 1 END) AS session_count,",
    "  AVG(value_numeric) AS avg_numeric,",
    "  COUNT(value_numeric) AS numeric_values,",
    `  ${unhealthyCase ? `COUNT(${unhealthyCase})` : "CAST(NULL AS INTEGER)"} AS unhealthy_scores,`,
    "  COUNT(CASE WHEN value_boolean = true THEN 1 END) AS true_scores,",
    "  COUNT(CASE WHEN value_boolean = false THEN 1 END) AS false_scores,",
    "  MAX(_timestamp) AS last_updated_us",
    `FROM ${latestScoresFromSql(where)}`,
    "GROUP BY score_config_id",
  ].join("\n");
}

function buildCategorySql(agentWhere: string | null): string {
  const where = combineWhere("score_config_id IS NOT NULL", agentWhere);
  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    "  value_categorical,",
    "  COUNT(*) AS c",
    `FROM ${latestScoresFromSql(where)}`,
    "WHERE value_categorical IS NOT NULL",
    "GROUP BY score_config_id, value_categorical",
    "ORDER BY score_config_id, c DESC, value_categorical",
  ].join("\n");
}

function buildTrendSql(interval: string, agentWhere: string | null): string {
  const where = combineWhere("score_config_id IS NOT NULL", agentWhere);
  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    `  histogram(_timestamp, '${interval}') AS bucket,`,
    "  COUNT(*) AS c",
    `FROM ${latestScoreAttemptsFromSql(where)}`,
    "GROUP BY score_config_id, bucket",
    "ORDER BY bucket",
  ].join("\n");
}

export function configHealthStatus(
  totalScores: number,
  unhealthyScores: number | null,
  hasThreshold: boolean,
): {
  status: ConfigStatus;
  priority: number;
} {
  if (totalScores === 0) return { status: "noData", priority: 3 };
  if (!hasThreshold) return { status: "noThreshold", priority: 2 };
  if ((unhealthyScores ?? 0) > 0) {
    return { status: "unhealthy", priority: 0 };
  }
  return { status: "healthy", priority: 1 };
}

export function useQualityScoreConfigs(
  scoreConfigs: Ref<ScoreConfig[]>,
  dateWindow: Ref<DateWindow>,
  agentFilter?: Ref<AgentFilterSelection | null | undefined>,
) {
  const { executeQuery, executeQueryOnce } = useLLMStreamQuery();
  const isLoading = ref(false);
  const aggByConfig = ref<Record<string, AggRow>>({});
  const trendByConfig = ref<Record<string, number[]>>({});
  const categoriesByConfig = ref<Record<string, CategoryRow[]>>({});

  async function refresh() {
    if (scoreConfigs.value.length === 0) {
      aggByConfig.value = {};
      trendByConfig.value = {};
      categoriesByConfig.value = {};
      return;
    }
    isLoading.value = true;
    try {
      const { startUs, endUs } = dateWindow.value;
      const interval = chooseBucketInterval((endUs - startUs) / 1000);
      const agentWhere = buildScoresAgentFilterWhere(agentFilter?.value ?? null);
      const aggSql = buildQualityConfigAggSql(scoreConfigs.value, agentWhere);
      const trendSql = buildTrendSql(interval, agentWhere);
      const categorySql = buildCategorySql(agentWhere);

      // `runQuery` swallows failures so one bad query doesn't blank the page.
      const runQuery = async <T>(
        sqlText: string,
        label: string,
        fullRange = false,
      ): Promise<T[] | null> => {
        try {
          const hits = await (fullRange ? executeQueryOnce : executeQuery)(
            sqlText,
            startUs,
            endUs,
            "logs",
          );
          console.debug(`[Quality:${label}]`, { hitCount: hits.length });
          return hits as T[];
        } catch (err: any) {
          console.warn(`[Quality:${label}] query failed:`, err?.response?.data ?? err);
          return null;
        }
      };

      const [aggHits, trendHits, categoryHits] = await Promise.all([
        runQuery<AggRow>(aggSql, "configs.agg").then((rows) => rows ?? []),
        runQuery<TrendRow>(trendSql, "configs.trend", true).then((rows) => rows ?? []),
        runQuery<CategoryRow>(categorySql, "configs.categories").then((rows) => rows ?? []),
      ]);

      const byId: Record<string, AggRow> = {};
      for (const hit of aggHits) {
        if (hit.score_config_id) {
          byId[String(hit.score_config_id)] = hit;
        }
      }
      aggByConfig.value = byId;

      // Surface ID-matching diagnostics. If any local config doesn't appear
      // here as "matched", its row will say 0 in the table.
      const localIds = scoreConfigs.value.map((c) => ({
        name: c.name,
        joinId: joinId(c),
      }));
      const hitIds = Object.keys(byId);
      const matched = localIds.filter((l) => byId[l.joinId]);
      const unmatchedLocal = localIds.filter((l) => !byId[l.joinId]);
      const unmatchedHits = hitIds.filter((h) => !localIds.find((l) => l.joinId === h));
      console.debug("[Quality:configs.match]", {
        localIds,
        hitIds,
        matched,
        unmatchedLocal,
        unmatchedHits,
      });

      trendByConfig.value = buildTrendSeries(trendHits, startUs, endUs, interval);

      const categoryById: Record<string, CategoryRow[]> = {};
      for (const row of categoryHits) {
        const id = row.score_config_id ? String(row.score_config_id) : "";
        if (!id || row.value_categorical == null) continue;
        if (!categoryById[id]) categoryById[id] = [];
        categoryById[id].push(row);
      }
      categoriesByConfig.value = categoryById;
    } finally {
      isLoading.value = false;
    }
  }

  const rows = computed<ScoreConfigRow[]>(() => {
    const out: ScoreConfigRow[] = scoreConfigs.value.map((config) => {
      const configId = entityId(config); // stable cross-version id for the row key
      const lookup = joinId(config); // entity_id — matches score_config_id on `_llm_scores`
      const agg = aggByConfig.value[lookup];
      const total = toNumber(agg?.total_scores) ?? 0;
      const lastUpdatedUs = toNumber(agg?.last_updated_us);
      const dataType = (dataTypeOf(config) as ScoreConfigRow["dataType"]) || "unknown";
      const threshold = thresholdForConfig(config);
      const hasThreshold = threshold.unhealthyExpr != null;
      const unhealthyCount = hasThreshold ? (toNumber(agg?.unhealthy_scores) ?? 0) : null;
      const unhealthyPercent =
        total > 0 && unhealthyCount != null ? (unhealthyCount / total) * 100 : null;
      const { status, priority } = configHealthStatus(total, unhealthyCount, hasThreshold);
      const summary = qualitySummaryForConfig(
        config,
        {
          avgNumeric: toNumber(agg?.avg_numeric),
          numericValues: toNumber(agg?.numeric_values) ?? 0,
          numericUnhealthy: toNumber(agg?.unhealthy_scores),
          trueScores: toNumber(agg?.true_scores) ?? 0,
          falseScores: toNumber(agg?.false_scores) ?? 0,
        },
        (categoriesByConfig.value[lookup] ?? []).map((row) => ({
          category: String(row.value_categorical),
          count: toNumber(row.c) ?? 0,
        })),
      );

      return {
        config,
        configId,
        name: config.name,
        description: config.description ?? "",
        dataType,
        totalScores: total,
        scopeCounts: scopeCountsFromRow(agg),
        ...summary,
        hasThreshold,
        thresholdLabel: threshold.label,
        unhealthyCount,
        unhealthyPercent,
        lastUpdatedMs: lastUpdatedUs != null ? Math.round(lastUpdatedUs / 1000) : null,
        status,
        statusPriority: priority,
        trendSparkline: trendByConfig.value[lookup] ?? [],
      };
    });

    out.sort((a, b) => {
      if (a.statusPriority !== b.statusPriority) return a.statusPriority - b.statusPriority;
      if (
        a.status === "unhealthy" &&
        b.status === "unhealthy" &&
        a.unhealthyPercent !== b.unhealthyPercent
      ) {
        return (b.unhealthyPercent ?? 0) - (a.unhealthyPercent ?? 0);
      }
      if (a.totalScores !== b.totalScores) return b.totalScores - a.totalScores;
      return a.name.localeCompare(b.name);
    });

    return out;
  });

  return { rows, isLoading, refresh };
}
