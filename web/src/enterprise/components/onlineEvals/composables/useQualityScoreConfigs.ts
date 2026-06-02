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
import { chooseBucketInterval, type DateWindow } from "./useQualityData";

export type ConfigStatus = "unhealthy" | "warn" | "healthy" | "noThreshold";

export interface ScoreConfigRow {
  config: ScoreConfig;
  configId: string;
  name: string;
  description: string;
  dataType: "numeric" | "categorical" | "boolean" | "unknown";
  totalScores: number;
  uniqueTraces: number;
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
  unique_traces?: number | string;
  unhealthy_count?: number | string;
  last_updated_us?: number | string | null;
}

interface TrendRow {
  score_config_id?: string | null;
  bucket?: string | number;
  c?: number | string;
}

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

interface ThresholdSql {
  /** SQL fragment evaluating to truthy when the score is unhealthy */
  unhealthyExpr: string | null;
  /** Display label for the threshold ("≥ 0.7", "true", "good · great") */
  label: string;
}

function thresholdForConfig(config: ScoreConfig): ThresholdSql {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  const type = dataTypeOf(config);
  if (!ht) return { unhealthyExpr: null, label: "" };

  if (type === "numeric") {
    if (ht.value === undefined || ht.value === null || !ht.direction) {
      return { unhealthyExpr: null, label: "" };
    }
    const op = ht.direction === "gte" ? "<" : ">";
    const sym = ht.direction === "gte" ? "≥" : "≤";
    return {
      unhealthyExpr: `value_numeric ${op} ${Number(ht.value)}`,
      label: `${sym} ${ht.value}`,
    };
  }

  if (type === "categorical") {
    const list: string[] = ht.healthy_categories || ht.healthyCategories || [];
    if (!Array.isArray(list) || list.length === 0) {
      return { unhealthyExpr: null, label: "" };
    }
    const inList = list.map((c) => `'${escapeSqlString(String(c))}'`).join(", ");
    return {
      unhealthyExpr: `value_categorical NOT IN (${inList})`,
      label: list.join(" · "),
    };
  }

  if (type === "boolean") {
    const healthy = ht.healthy_value ?? ht.healthyValue;
    if (healthy === undefined || healthy === null) {
      return { unhealthyExpr: null, label: "" };
    }
    const expected = healthy === true || healthy === "true";
    return {
      unhealthyExpr: `value_boolean = ${!expected}`,
      label: String(expected),
    };
  }

  return { unhealthyExpr: null, label: "" };
}

/** Rich aggregate SQL with per-config unhealthy CASE. Fails at parse time if
 * any branch references a `value_*` column whose data_type has not yet been
 * written to `_llm_scores`. */
/** The ID stored on score records under `score_config_id` is the row `id`
 * of the Score Config (per-version), not its `entity_id`. See backend
 * `prepared_scorers.rs`. */
function joinId(config: ScoreConfig): string {
  return String(config.id);
}

function buildRichAggSql(configs: ScoreConfig[]): string {
  const caseBranches: string[] = [];
  for (const cfg of configs) {
    const cfgId = joinId(cfg);
    if (!cfgId) continue;
    const t = thresholdForConfig(cfg);
    if (!t.unhealthyExpr) continue;
    caseBranches.push(
      `    WHEN CAST(score_config_id AS VARCHAR) = '${escapeSqlString(cfgId)}' AND (${t.unhealthyExpr}) THEN 1`,
    );
  }

  const unhealthyExpr =
    caseBranches.length > 0
      ? [
          "  COUNT(CASE",
          ...caseBranches,
          "  END) AS unhealthy_count,",
        ].join("\n")
      : "  CAST(NULL AS INTEGER) AS unhealthy_count,";

  return [
    "SELECT",
    "  CAST(score_config_id AS VARCHAR) AS score_config_id,",
    "  COUNT(*) AS total_scores,",
    "  COUNT(DISTINCT trace_id) AS unique_traces,",
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
    "  COUNT(DISTINCT trace_id) AS unique_traces,",
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
): { status: ConfigStatus; priority: number } {
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
  const totalUniqueTracesAcrossConfigs = ref<number>(0);

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
          const u = toNumber(hit.unique_traces) ?? 0;
          if (u > maxUnique) maxUnique = u;
        }
      }
      aggByConfig.value = byId;
      totalUniqueTracesAcrossConfigs.value = maxUnique;

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
    const denom = totalUniqueTracesAcrossConfigs.value;
    const out: ScoreConfigRow[] = scoreConfigs.value.map((config) => {
      const configId = entityId(config); // stable cross-version id for the row key
      const lookup = joinId(config); // per-version id that matches score_config_id
      const agg = aggByConfig.value[lookup];
      const total = toNumber(agg?.total_scores) ?? 0;
      const uniqueTraces = toNumber(agg?.unique_traces) ?? 0;
      const unhealthy = toNumber(agg?.unhealthy_count);
      const lastUpdatedUs = toNumber(agg?.last_updated_us);
      const t = thresholdForConfig(config);
      const dataType = (dataTypeOf(config) as ScoreConfigRow["dataType"]) || "unknown";
      const { status, priority } = statusOf(t.unhealthyExpr != null, unhealthy, dataType);

      return {
        config,
        configId,
        name: config.name,
        description: config.description ?? "",
        dataType,
        totalScores: total,
        uniqueTraces,
        coveragePct: denom > 0 ? (uniqueTraces / denom) * 100 : null,
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
