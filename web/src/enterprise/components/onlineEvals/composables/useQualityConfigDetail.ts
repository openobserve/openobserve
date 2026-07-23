// Per-config detail composable for the Tier-2 selected state.
// Runs a data_type-specific aggregate against `_llm_scores` filtered to one
// score_config_id, plus a uniqueness/total query so KPI cards can render.

import { computed, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import type { DateWindow } from "./useQualityData";
import {
  buildScoresAgentFilterWhere,
  combineWhere,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";
import { latestScoresFromSql } from "../utils/latestScoreSql";
import { qualityScopeWhere, type QualityScope } from "../utils/qualityScope";
import { escapeSqlString, thresholdForConfig } from "../utils/scoreThreshold";
import {
  healthyBooleanValue,
  healthyCategories,
} from "../utils/qualitySummary";

export interface DetailKpi {
  id: string;
  /** Localised title — falls back to plain text when no i18n key matches */
  titleKey: string;
  value: number | string | null;
  /** Right-aligned secondary context line (`Range 0-1`, `= true`, etc.) */
  context: string;
  /** How to format the value when it's a number */
  format: "number" | "percent" | "count" | "raw";
}

interface NumericAggRow {
  numeric_values?: number | string;
  avg_v?: number | string | null;
  p50_v?: number | string | null;
  p95_v?: number | string | null;
  unhealthy?: number | string | null;
}

export interface BooleanAggRow {
  trues?: number | string;
  falses?: number | string;
}

export interface CategoricalAggRow {
  value_categorical?: string | null;
  c?: number | string;
}

interface VolumeAggRow {
  score_results?: number | string;
  targets_scored?: number | string;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function valueOf<T = any>(
  row: any,
  camel: string,
  snake: string,
): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

function numericSql(where: string, unhealthy: string | null): string {
  return [
    "SELECT",
    "  COUNT(value_numeric) AS numeric_values,",
    "  AVG(value_numeric) AS avg_v,",
    "  approx_percentile_cont(value_numeric, 0.5) AS p50_v,",
    "  approx_percentile_cont(value_numeric, 0.95) AS p95_v,",
    `  ${unhealthy ? `COUNT(CASE WHEN ${unhealthy} THEN 1 END)` : "CAST(NULL AS INTEGER)"} AS unhealthy`,
    `FROM ${latestScoresFromSql(where)}`,
  ].join("\n");
}

function booleanSql(where: string): string {
  return [
    "SELECT",
    "  COUNT(CASE WHEN value_boolean = true THEN 1 END) AS trues,",
    "  COUNT(CASE WHEN value_boolean = false THEN 1 END) AS falses",
    `FROM ${latestScoresFromSql(where)}`,
  ].join("\n");
}

function volumeSql(where: string): string {
  return [
    "SELECT",
    "  COUNT(*) AS score_results,",
    "  COUNT(DISTINCT CASE",
    "    WHEN _target_id IS NOT NULL AND _target_id <> ''",
    "      THEN CONCAT(_target_scope, ':', _target_id)",
    "  END) AS targets_scored",
    `FROM ${latestScoresFromSql(where)}`,
  ].join("\n");
}

function categoricalSql(where: string): string {
  return [
    "SELECT",
    "  value_categorical,",
    "  COUNT(*) AS c",
    `FROM ${latestScoresFromSql(where)}`,
    "WHERE value_categorical IS NOT NULL",
    "GROUP BY value_categorical",
    "ORDER BY c DESC",
  ].join("\n");
}

export function useQualityConfigDetail(
  selectedConfig: Ref<ScoreConfig | null>,
  dateWindow: Ref<DateWindow>,
  agentFilter: Ref<AgentFilterSelection | null | undefined>,
  qualityScope: Ref<QualityScope>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const isLoading = ref(false);
  const numericAgg = ref<NumericAggRow | null>(null);
  const booleanAgg = ref<BooleanAggRow | null>(null);
  const categoricalRows = ref<CategoricalAggRow[]>([]);
  const volumeAgg = ref<VolumeAggRow | null>(null);
  let refreshGeneration = 0;

  function clearData() {
    numericAgg.value = null;
    booleanAgg.value = null;
    categoricalRows.value = [];
    volumeAgg.value = null;
  }

  async function runQuery<T>(
    sqlText: string,
    label: string,
    startUs: number,
    endUs: number,
  ) {
    try {
      const hits = await executeQuery(sqlText, startUs, endUs, "logs");
      console.debug(`[QualityDetail:${label}]`, { hitCount: hits.length });
      return hits as T[];
    } catch (err: any) {
      console.warn(`[QualityDetail:${label}] query failed:`, err);
      return [] as T[];
    }
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const cfg = selectedConfig.value;
    clearData();
    if (!cfg) {
      isLoading.value = false;
      return;
    }

    isLoading.value = true;
    try {
      const { startUs, endUs } = dateWindow.value;
      // `score_config_id` on `_llm_scores` is the entity_id, not the
      // per-version row id — join on entity_id so cross-version edits don't
      // break the detail panel.
      const configId = escapeSqlString(entityId(cfg));
      const where = combineWhere(
        `CAST(score_config_id AS VARCHAR) = '${configId}'`,
        buildScoresAgentFilterWhere(agentFilter.value ?? null),
        qualityScopeWhere(qualityScope.value),
      )!;
      const type = dataTypeOf(cfg);
      const threshold = thresholdForConfig(cfg);
      const volumePromise = runQuery<VolumeAggRow>(
        volumeSql(where),
        "volume",
        startUs,
        endUs,
      );

      if (type === "numeric") {
        const [volumeHits, hits] = await Promise.all([
          volumePromise,
          runQuery<NumericAggRow>(
            numericSql(where, threshold.unhealthyExpr),
            "numeric",
            startUs,
            endUs,
          ),
        ]);
        if (generation !== refreshGeneration) return;
        volumeAgg.value = volumeHits[0] ?? null;
        numericAgg.value = hits[0] ?? null;
      } else if (type === "boolean") {
        const [volumeHits, hits] = await Promise.all([
          volumePromise,
          runQuery<BooleanAggRow>(booleanSql(where), "boolean", startUs, endUs),
        ]);
        if (generation !== refreshGeneration) return;
        volumeAgg.value = volumeHits[0] ?? null;
        booleanAgg.value = hits[0] ?? null;
      } else if (type === "categorical") {
        const [volumeHits, hits] = await Promise.all([
          volumePromise,
          runQuery<CategoricalAggRow>(
            categoricalSql(where),
            "categorical",
            startUs,
            endUs,
          ),
        ]);
        if (generation !== refreshGeneration) return;
        volumeAgg.value = volumeHits[0] ?? null;
        categoricalRows.value = hits;
      }
    } finally {
      if (generation === refreshGeneration) isLoading.value = false;
    }
  }

  // Opening a row or changing the detail scope refreshes here. Date-window /
  // agent-filter changes are driven by the page's
  // refreshAll(), so watching them here would double-fire the detail query
  // alongside the KPI/table reload. No `immediate`: the initial load is
  // covered by refreshAll() too.
  watch(
    () => [selectedConfig.value, qualityScope.value] as const,
    () => {
      void refresh();
    },
  );

  const dataType = computed<"numeric" | "boolean" | "categorical" | "unknown">(
    () => {
      if (!selectedConfig.value) return "unknown";
      const t = dataTypeOf(selectedConfig.value);
      if (t === "numeric" || t === "boolean" || t === "categorical") return t;
      return "unknown";
    },
  );

  const kpis = computed<DetailKpi[]>(() => {
    const cfg = selectedConfig.value;
    if (!cfg) return [];
    const threshold = thresholdForConfig(cfg);
    const scoreResults = toNumber(volumeAgg.value?.score_results) ?? 0;
    const targetsScored = toNumber(volumeAgg.value?.targets_scored);
    const targetCard: DetailKpi = {
      id: "targetsScored",
      titleKey: "targetsScored",
      value: targetsScored,
      context: `of ${scoreResults} score results`,
      format: "count",
    };

    if (dataType.value === "numeric") {
      const agg = numericAgg.value;
      const total = toNumber(agg?.numeric_values) ?? 0;
      const unhealthy = toNumber(agg?.unhealthy);
      const range = valueOf<any>(cfg, "numericRange", "numeric_range");
      const rangeText =
        range && range.min != null && range.max != null
          ? `Range ${range.min}–${range.max}`
          : "";
      const cards: DetailKpi[] = [
        {
          id: "avg",
          titleKey: "average",
          value: toNumber(agg?.avg_v),
          context: rangeText,
          format: "number",
        },
        {
          id: "p50",
          titleKey: "p50",
          value: toNumber(agg?.p50_v),
          context: "",
          format: "number",
        },
        {
          id: "p95",
          titleKey: "p95",
          value: toNumber(agg?.p95_v),
          context: "",
          format: "number",
        },
      ];
      if (threshold.unhealthyExpr != null) {
        cards.push({
          id: "unhealthy",
          titleKey: "unhealthy",
          value:
            total > 0 && unhealthy != null ? (unhealthy / total) * 100 : null,
          context: threshold.label ? `Healthy ${threshold.label}` : "",
          format: "percent",
        });
      }
      cards.push(targetCard);
      return cards;
    }

    if (dataType.value === "boolean") {
      const agg = booleanAgg.value;
      const trues = toNumber(agg?.trues) ?? 0;
      const falses = toNumber(agg?.falses) ?? 0;
      const typedTotal = trues + falses;
      const expected = healthyBooleanValue(cfg);
      if (expected == null) {
        return [
          {
            id: "trueRate",
            titleKey: "trueRate",
            value: typedTotal > 0 ? (trues / typedTotal) * 100 : null,
            context: "= true",
            format: "percent",
          },
          {
            id: "falseRate",
            titleKey: "falseRate",
            value: typedTotal > 0 ? (falses / typedTotal) * 100 : null,
            context: "= false",
            format: "percent",
          },
          targetCard,
        ];
      }
      const healthyCount = expected ? trues : falses;
      const unhealthyCount = expected ? falses : trues;
      return [
        {
          id: "healthy",
          titleKey: "healthy",
          value: typedTotal > 0 ? (healthyCount / typedTotal) * 100 : null,
          context: `= ${expected}`,
          format: "percent",
        },
        {
          id: "unhealthy",
          titleKey: "unhealthy",
          value: typedTotal > 0 ? (unhealthyCount / typedTotal) * 100 : null,
          context: `= ${!expected}`,
          format: "percent",
        },
        targetCard,
      ];
    }

    if (dataType.value === "categorical") {
      const total = categoricalRows.value.reduce(
        (s, r) => s + (toNumber(r.c) ?? 0),
        0,
      );
      const healthyCats = healthyCategories(cfg);
      let healthyCount = 0;
      let unhealthyCount = 0;
      for (const r of categoricalRows.value) {
        const c = toNumber(r.c) ?? 0;
        if (r.value_categorical && healthyCats.includes(r.value_categorical)) {
          healthyCount += c;
        } else {
          unhealthyCount += c;
        }
      }
      const cards: DetailKpi[] = [];
      if (healthyCats.length > 0) {
        cards.push(
          {
            id: "healthy",
            titleKey: "healthy",
            value: total > 0 ? (healthyCount / total) * 100 : null,
            context: healthyCats.join(" · "),
            format: "percent",
          },
          {
            id: "unhealthy",
            titleKey: "unhealthy",
            value: total > 0 ? (unhealthyCount / total) * 100 : null,
            context: "rest of categories",
            format: "percent",
          },
        );
      }
      cards.push(targetCard);
      return cards;
    }

    return [];
  });

  // True when at least one score landed for this config in the window. Drives
  // the detail panel's empty state so a freshly-created (but never-scored)
  // config reads as "waiting for scores" instead of a wall of dashes.
  const hasScores = computed<boolean>(() => {
    if (dataType.value === "numeric")
      return (toNumber(numericAgg.value?.numeric_values) ?? 0) > 0;
    if (dataType.value === "boolean") {
      const trues = toNumber(booleanAgg.value?.trues) ?? 0;
      const falses = toNumber(booleanAgg.value?.falses) ?? 0;
      return trues + falses > 0;
    }
    if (dataType.value === "categorical")
      return (
        categoricalRows.value.reduce((s, r) => s + (toNumber(r.c) ?? 0), 0) > 0
      );
    return false;
  });

  return {
    isLoading,
    dataType,
    kpis,
    hasScores,
    booleanAgg,
    categoricalRows,
    refresh,
  };
}
