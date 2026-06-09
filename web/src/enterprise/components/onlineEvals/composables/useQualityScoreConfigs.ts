// Tier 2 Overview composable.
// Builds a single batched aggregate query against `_llm_scores`
// — one CASE branch per Score Config so the "unhealthy" count is
// computed using each config's own healthy_threshold definition.

import { computed, ref, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
} from "../utils/evalEntity";
import { thresholdForConfig, buildUnhealthyCaseBranches } from "../utils/scoreThreshold";
import { chooseBucketInterval, type DateWindow } from "./useQualityData";

export type ConfigStatus =
  | "unhealthy"
  | "warn"
  | "healthy"
  | "noThreshold"
  | "noData";

export interface ScoreConfigRow {
  config: ScoreConfig;
  configId: string;
  name: string;
  description: string;
  dataType: "numeric" | "categorical" | "boolean" | "unknown";
  totalScores: number;
  uniqueSpans: number;
  coveragePct: number | null;
  unhealthyCount: number | null;
  unhealthyPct: number | null;
  lastUpdatedMs: number | null;
  hasThreshold: boolean;
  thresholdLabel: string;
  status: ConfigStatus;
  statusPriority: number;
  trendSparkline: number[];
}

interface AggRow {
  score_config_id?: string | null;
  total_scores?: number | string;
  unique_spans?: number | string;
  unhealthy_count?: number | string;
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

/** Rich aggregate SQL with per-config unhealthy CASE. Fails at parse time if
 * any branch references a `value_*` column whose data_type has not yet been
 * written to `_llm_scores`. */
/** The ID stored on score records under `score_config_id` is the Score
 * Config's stable `entity_id` (the per-row version is tracked in a separate
 * `score_config_version` column on `_llm_scores`). Joining on `entity_id`
 * survives every version bump and matches the cross-version identifier the
 * rest of the UI keys on. */
function joinId(config: ScoreConfig): string {
  return entityId(config);
}

function buildRichAggSql(configs: ScoreConfig[]): string {
  const caseFragment = buildUnhealthyCaseBranches(configs, "1");
  const unhealthyExpr = caseFragment
    ? `  COUNT(${caseFragment}) AS unhealthy_count,`
    : "  CAST(NULL AS INTEGER) AS unhealthy_count,";

  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    "  COUNT(*) AS total_scores,",
    "  COUNT(DISTINCT span_id) AS unique_spans,",
    unhealthyExpr,
    "  MAX(_timestamp) AS last_updated_us",
    'FROM "_llm_scores"',
    "WHERE score_config_id IS NOT NULL",
    "GROUP BY score_config_id",
  ].join("\n");
}

/** Plain aggregate SQL with no unhealthy detection. Only references columns
 * that always exist (`score_config_id`, `trace_id`, `_timestamp`), so it
 * survives even when only one `data_type`'s `value_*` column has been
 * written to the schema. Used as a fallback when the rich query fails. */
function buildPlainAggSql(): string {
  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    "  COUNT(*) AS total_scores,",
    "  COUNT(DISTINCT span_id) AS unique_spans,",
    "  CAST(NULL AS INTEGER) AS unhealthy_count,",
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

function statusOf(
  hasThreshold: boolean,
  unhealthyCount: number | null,
  dataType: ScoreConfigRow["dataType"],
  totalScores: number,
): { status: ConfigStatus; priority: number } {
  // No scores in the window — config exists but is dormant. Reported as a
  // distinct status (gray dot, dimmed row, sorted to bottom) so it doesn't
  // get mistaken for a "healthy" config that actually has passing scores.
  if (totalScores === 0) return { status: "noData", priority: 5 };
  if (!hasThreshold) return { status: "noThreshold", priority: 4 };
  if (unhealthyCount != null && unhealthyCount > 0) {
    return { status: "unhealthy", priority: 1 };
  }
  if (dataType === "boolean" && unhealthyCount == null) {
    return { status: "warn", priority: 2 };
  }
  return { status: "healthy", priority: 3 };
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
      const richSql = buildRichAggSql(scoreConfigs.value);
      const plainSql = buildPlainAggSql();
      const trendSql = buildTrendSql(interval);

      const runQuery = async <T>(sqlText: string, label: string): Promise<T[] | null> => {
        try {
          const hits = await executeQuery(sqlText, startUs, endUs, "logs");
          console.debug(`[Quality:${label}]`, { hitCount: hits.length });
          return hits as T[];
        } catch (err: any) {
          console.warn(`[Quality:${label}] query failed:`, err);
          return null;
        }
      };

      // Try the rich query first; if it errors (e.g. a CASE branch references
      // a `value_*` column whose data_type hasn't been written yet), retry
      // with the plain query so the table still shows totals.
      const richHits = await runQuery<AggRow>(richSql, "configs.agg.rich");
      const aggHits: AggRow[] =
        richHits ?? (await runQuery<AggRow>(plainSql, "configs.agg.plain")) ?? [];
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
      const unhealthy = toNumber(agg?.unhealthy_count);
      const lastUpdatedUs = toNumber(agg?.last_updated_us);
      const t = thresholdForConfig(config);
      const dataType = (dataTypeOf(config) as ScoreConfigRow["dataType"]) || "unknown";
      const { status, priority } = statusOf(t.unhealthyExpr != null, unhealthy, dataType, total);

      return {
        config,
        configId,
        name: config.name,
        description: config.description ?? "",
        dataType,
        totalScores: total,
        uniqueSpans,
        coveragePct: denom > 0 ? (uniqueSpans / denom) * 100 : null,
        unhealthyCount: unhealthy,
        unhealthyPct:
          unhealthy != null && total > 0 ? (unhealthy / total) * 100 : null,
        lastUpdatedMs: lastUpdatedUs != null ? Math.round(lastUpdatedUs / 1000) : null,
        hasThreshold: t.unhealthyExpr != null,
        thresholdLabel: t.label,
        status,
        statusPriority: priority,
        trendSparkline: trendByConfig.value[lookup] ?? [],
      };
    });

    out.sort((a, b) => {
      if (a.statusPriority !== b.statusPriority) return a.statusPriority - b.statusPriority;
      const aPct = a.unhealthyPct ?? -1;
      const bPct = b.unhealthyPct ?? -1;
      if (aPct !== bPct) return bPct - aPct;
      return a.name.localeCompare(b.name);
    });

    return out;
  });

  return { rows, isLoading, refresh };
}
