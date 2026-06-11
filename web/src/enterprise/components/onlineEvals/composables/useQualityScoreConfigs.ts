// Tier 2 Overview composable.
// Single batched aggregate query against `_llm_scores` per config,
// keyed by entity_id. No per-config "unhealthy" detection — the table no
// longer surfaces an unhealthy column.

import { computed, ref, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
} from "../utils/evalEntity";
import { chooseBucketInterval, type DateWindow } from "./useQualityData";

export type ConfigStatus = "healthy" | "noData";

export interface ScoreConfigRow {
  config: ScoreConfig;
  configId: string;
  name: string;
  description: string;
  dataType: "numeric" | "categorical" | "boolean" | "unknown";
  totalScores: number;
  uniqueSpans: number;
  coveragePct: number | null;
  lastUpdatedMs: number | null;
  status: ConfigStatus;
  statusPriority: number;
  trendSparkline: number[];
}

interface AggRow {
  score_config_id?: string | null;
  total_scores?: number | string;
  unique_spans?: number | string;
  last_updated_us?: number | string | null;
}

interface TrendRow {
  score_config_id?: string | null;
  bucket?: string | number;
  c?: number | string;
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

/** Aggregate SQL that only references columns guaranteed to exist on the
 * `_llm_scores` schema, so it never trips DataFusion's parse-time column
 * check. No per-config unhealthy detection — the table doesn't render an
 * unhealthy column anymore. */
function buildAggSql(): string {
  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    "  COUNT(*) AS total_scores,",
    "  COUNT(DISTINCT span_id) AS unique_spans,",
    "  MAX(_timestamp) AS last_updated_us",
    'FROM "_llm_scores"',
    "WHERE score_config_id IS NOT NULL",
    "GROUP BY score_config_id",
  ].join("\n");
}

function buildTrendSql(interval: string): string {
  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    `  histogram(_timestamp, '${interval}') AS bucket,`,
    "  COUNT(*) AS c",
    'FROM "_llm_scores"',
    "WHERE score_config_id IS NOT NULL",
    "GROUP BY score_config_id, bucket",
    "ORDER BY bucket",
  ].join("\n");
}

function statusOf(totalScores: number): { status: ConfigStatus; priority: number } {
  // No scores in the window — config exists but is dormant. Reported as a
  // distinct status (gray dot, sorted to bottom) so it doesn't get mistaken
  // for a config that actually has scores in this window.
  if (totalScores === 0) return { status: "noData", priority: 2 };
  return { status: "healthy", priority: 1 };
}

export function useQualityScoreConfigs(
  scoreConfigs: Ref<ScoreConfig[]>,
  dateWindow: Ref<DateWindow>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const isLoading = ref(false);
  const aggByConfig = ref<Record<string, AggRow>>({});
  const trendByConfig = ref<Record<string, number[]>>({});
  const totalUniqueSpansAcrossConfigs = ref<number>(0);

  async function refresh() {
    if (scoreConfigs.value.length === 0) {
      aggByConfig.value = {};
      return;
    }
    isLoading.value = true;
    try {
      const { startUs, endUs } = dateWindow.value;
      const interval = chooseBucketInterval((endUs - startUs) / 1000);
      const aggSql = buildAggSql();
      const trendSql = buildTrendSql(interval);

      // `runQuery` swallows failures so one bad query doesn't blank the page.
      const runQuery = async <T>(
        sqlText: string,
        label: string,
      ): Promise<T[] | null> => {
        try {
          const hits = await executeQuery(sqlText, startUs, endUs, "logs");
          console.debug(`[Quality:${label}]`, { hitCount: hits.length });
          return hits as T[];
        } catch (err: any) {
          console.warn(`[Quality:${label}] query failed:`, err);
          return null;
        }
      };

      const aggHits = (await runQuery<AggRow>(aggSql, "configs.agg")) ?? [];
      const trendHits = (await runQuery<TrendRow>(trendSql, "configs.trend")) ?? [];

      const byId: Record<string, AggRow> = {};
      let maxUnique = 0;
      for (const hit of aggHits) {
        if (hit.score_config_id) {
          byId[String(hit.score_config_id)] = hit;
          const u = toNumber(hit.unique_spans) ?? 0;
          if (u > maxUnique) maxUnique = u;
        }
      }
      aggByConfig.value = byId;
      totalUniqueSpansAcrossConfigs.value = maxUnique;

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

      const trendById: Record<string, number[]> = {};
      for (const row of trendHits) {
        const id = row.score_config_id ? String(row.score_config_id) : "";
        if (!id) continue;
        if (!trendById[id]) trendById[id] = [];
        trendById[id].push(toNumber(row.c) ?? 0);
      }
      trendByConfig.value = trendById;
    } finally {
      isLoading.value = false;
    }
  }

  const rows = computed<ScoreConfigRow[]>(() => {
    const denom = totalUniqueSpansAcrossConfigs.value;
    const out: ScoreConfigRow[] = scoreConfigs.value.map((config) => {
      const configId = entityId(config); // stable cross-version id for the row key
      const lookup = joinId(config); // entity_id — matches score_config_id on `_llm_scores`
      const agg = aggByConfig.value[lookup];
      const total = toNumber(agg?.total_scores) ?? 0;
      const uniqueSpans = toNumber(agg?.unique_spans) ?? 0;
      const lastUpdatedUs = toNumber(agg?.last_updated_us);
      const dataType = (dataTypeOf(config) as ScoreConfigRow["dataType"]) || "unknown";
      const { status, priority } = statusOf(total);

      return {
        config,
        configId,
        name: config.name,
        description: config.description ?? "",
        dataType,
        totalScores: total,
        uniqueSpans,
        coveragePct: denom > 0 ? (uniqueSpans / denom) * 100 : null,
        lastUpdatedMs: lastUpdatedUs != null ? Math.round(lastUpdatedUs / 1000) : null,
        status,
        statusPriority: priority,
        trendSparkline: trendByConfig.value[lookup] ?? [],
      };
    });

    out.sort((a, b) => {
      if (a.statusPriority !== b.statusPriority) return a.statusPriority - b.statusPriority;
      if (a.totalScores !== b.totalScores) return b.totalScores - a.totalScores;
      return a.name.localeCompare(b.name);
    });

    return out;
  });

  return { rows, isLoading, refresh };
}
