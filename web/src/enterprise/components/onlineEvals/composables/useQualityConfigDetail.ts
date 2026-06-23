// Per-config detail composable for the Tier-2 selected state.
// Runs a data_type-specific aggregate against `_llm_scores` filtered to one
// score_config_id, plus a uniqueness/total query so KPI cards can render.

import { computed, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import type { DateWindow } from "./useQualityData";

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
  total?: number | string;
  unique_spans?: number | string;
  avg_v?: number | string | null;
  p50_v?: number | string | null;
  p95_v?: number | string | null;
  unhealthy?: number | string | null;
}

export interface BooleanAggRow {
  total?: number | string;
  unique_spans?: number | string;
  trues?: number | string;
  falses?: number | string;
}

export interface CategoricalAggRow {
  total?: number | string;
  unique_spans?: number | string;
  value_categorical?: string | null;
  c?: number | string;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

interface UnhealthyExpr {
  expr: string | null;
  contextLabel: string;
}

function unhealthyExprFor(config: ScoreConfig): UnhealthyExpr {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  const type = dataTypeOf(config);
  if (!ht) return { expr: null, contextLabel: "" };

  if (type === "numeric") {
    if (ht.value === undefined || ht.value === null || !ht.direction) {
      return { expr: null, contextLabel: "" };
    }
    const op = ht.direction === "gte" ? "<" : ">";
    const sym = ht.direction === "gte" ? "≥" : "≤";
    return {
      expr: `value_numeric ${op} ${Number(ht.value)}`,
      contextLabel: `Healthy ${sym} ${ht.value}`,
    };
  }

  if (type === "categorical") {
    const list: string[] = ht.healthy_categories || ht.healthyCategories || [];
    if (!Array.isArray(list) || list.length === 0) {
      return { expr: null, contextLabel: "" };
    }
    const inList = list.map((c) => `'${escapeSqlString(String(c))}'`).join(", ");
    return {
      expr: `value_categorical NOT IN (${inList})`,
      contextLabel: `Healthy ∈ {${list.join(", ")}}`,
    };
  }

  if (type === "boolean") {
    const healthy = ht.healthy_value ?? ht.healthyValue;
    if (healthy === undefined || healthy === null) {
      return { expr: null, contextLabel: "" };
    }
    const expected = healthy === true || healthy === "true";
    return {
      expr: `value_boolean = ${!expected}`,
      contextLabel: `Healthy = ${expected}`,
    };
  }

  return { expr: null, contextLabel: "" };
}

function numericSql(configIdEscaped: string, unhealthy: string | null): string {
  return [
    "SELECT",
    "  COUNT(*) AS total,",
    "  COUNT(DISTINCT span_id) AS unique_spans,",
    "  AVG(value_numeric) AS avg_v,",
    "  approx_percentile_cont(value_numeric, 0.5) AS p50_v,",
    "  approx_percentile_cont(value_numeric, 0.95) AS p95_v,",
    `  ${unhealthy ? `COUNT(CASE WHEN ${unhealthy} THEN 1 END)` : "CAST(NULL AS INTEGER)"} AS unhealthy`,
    'FROM "_llm_scores"',
    `WHERE CAST(score_config_id AS VARCHAR) = '${configIdEscaped}'`,
  ].join("\n");
}

function booleanSql(configIdEscaped: string): string {
  return [
    "SELECT",
    "  COUNT(*) AS total,",
    "  COUNT(DISTINCT span_id) AS unique_spans,",
    "  COUNT(CASE WHEN value_boolean = true THEN 1 END) AS trues,",
    "  COUNT(CASE WHEN value_boolean = false THEN 1 END) AS falses",
    'FROM "_llm_scores"',
    `WHERE CAST(score_config_id AS VARCHAR) = '${configIdEscaped}'`,
  ].join("\n");
}

function categoricalSql(configIdEscaped: string): string {
  return [
    "SELECT",
    "  value_categorical,",
    "  COUNT(*) AS c",
    'FROM "_llm_scores"',
    `WHERE CAST(score_config_id AS VARCHAR) = '${configIdEscaped}'`,
    "  AND value_categorical IS NOT NULL",
    "GROUP BY value_categorical",
    "ORDER BY c DESC",
  ].join("\n");
}

export function useQualityConfigDetail(
  selectedConfig: Ref<ScoreConfig | null>,
  dateWindow: Ref<DateWindow>,
) {
  const { executeQuery } = useLLMStreamQuery();
  const isLoading = ref(false);
  const numericAgg = ref<NumericAggRow | null>(null);
  const booleanAgg = ref<BooleanAggRow | null>(null);
  const categoricalRows = ref<CategoricalAggRow[]>([]);

  async function runQuery<T>(sqlText: string, label: string, startUs: number, endUs: number) {
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
    const cfg = selectedConfig.value;
    if (!cfg) {
      numericAgg.value = null;
      booleanAgg.value = null;
      categoricalRows.value = [];
      return;
    }

    isLoading.value = true;
    try {
      const { startUs, endUs } = dateWindow.value;
      // `score_config_id` on `_llm_scores` is the entity_id, not the
      // per-version row id — join on entity_id so cross-version edits don't
      // break the detail panel.
      const configId = escapeSqlString(entityId(cfg));
      const type = dataTypeOf(cfg);
      const unhealthy = unhealthyExprFor(cfg);

      if (type === "numeric") {
        const hits = await runQuery<NumericAggRow>(
          numericSql(configId, unhealthy.expr),
          "numeric",
          startUs,
          endUs,
        );
        numericAgg.value = hits[0] ?? null;
        booleanAgg.value = null;
        categoricalRows.value = [];
      } else if (type === "boolean") {
        const hits = await runQuery<BooleanAggRow>(
          booleanSql(configId),
          "boolean",
          startUs,
          endUs,
        );
        booleanAgg.value = hits[0] ?? null;
        numericAgg.value = null;
        categoricalRows.value = [];
      } else if (type === "categorical") {
        const hits = await runQuery<CategoricalAggRow>(
          categoricalSql(configId),
          "categorical",
          startUs,
          endUs,
        );
        categoricalRows.value = hits;
        numericAgg.value = null;
        booleanAgg.value = null;
      }
    } finally {
      isLoading.value = false;
    }
  }

  watch(
    [selectedConfig, dateWindow],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  const dataType = computed<"numeric" | "boolean" | "categorical" | "unknown">(() => {
    if (!selectedConfig.value) return "unknown";
    const t = dataTypeOf(selectedConfig.value);
    if (t === "numeric" || t === "boolean" || t === "categorical") return t;
    return "unknown";
  });

  const kpis = computed<DetailKpi[]>(() => {
    const cfg = selectedConfig.value;
    if (!cfg) return [];
    const u = unhealthyExprFor(cfg);

    if (dataType.value === "numeric") {
      const agg = numericAgg.value;
      const total = toNumber(agg?.total) ?? 0;
      const unhealthy = toNumber(agg?.unhealthy);
      const range = valueOf<any>(cfg, "numericRange", "numeric_range");
      const rangeText =
        range && range.min != null && range.max != null
          ? `Range ${range.min}–${range.max}`
          : "";
      const cards: DetailKpi[] = [
        { id: "avg", titleKey: "average", value: toNumber(agg?.avg_v), context: rangeText, format: "number" },
        { id: "p50", titleKey: "p50", value: toNumber(agg?.p50_v), context: "", format: "number" },
        { id: "p95", titleKey: "p95", value: toNumber(agg?.p95_v), context: "", format: "number" },
      ];
      if (u.expr != null) {
        cards.push({
          id: "unhealthy",
          titleKey: "unhealthy",
          value: total > 0 && unhealthy != null ? (unhealthy / total) * 100 : null,
          context: u.contextLabel,
          format: "percent",
        });
      }
      cards.push({
        id: "coverage",
        titleKey: "coverage",
        value: toNumber(agg?.unique_spans),
        context: `of ${total} scores`,
        format: "count",
      });
      return cards;
    }

    if (dataType.value === "boolean") {
      const agg = booleanAgg.value;
      const total = toNumber(agg?.total) ?? 0;
      const trues = toNumber(agg?.trues) ?? 0;
      const falses = toNumber(agg?.falses) ?? 0;
      return [
        {
          id: "healthy",
          titleKey: "healthy",
          value: total > 0 ? (trues / total) * 100 : null,
          context: "= true",
          format: "percent",
        },
        {
          id: "unhealthy",
          titleKey: "unhealthy",
          value: total > 0 ? (falses / total) * 100 : null,
          context: "= false",
          format: "percent",
        },
        {
          id: "coverage",
          titleKey: "coverage",
          value: toNumber(agg?.unique_spans),
          context: `of ${total} scores`,
          format: "count",
        },
      ];
    }

    if (dataType.value === "categorical") {
      const total = categoricalRows.value.reduce((s, r) => s + (toNumber(r.c) ?? 0), 0);
      const ht = valueOf<any>(cfg, "healthyThreshold", "healthy_threshold");
      const healthyCats: string[] = ht?.healthy_categories || ht?.healthyCategories || [];
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
      return [
        {
          id: "healthy",
          titleKey: "healthy",
          value: total > 0 ? (healthyCount / total) * 100 : null,
          context: healthyCats.length > 0 ? healthyCats.join(" · ") : "no threshold",
          format: "percent",
        },
        {
          id: "unhealthy",
          titleKey: "unhealthy",
          value: total > 0 ? (unhealthyCount / total) * 100 : null,
          context: "rest of categories",
          format: "percent",
        },
        {
          id: "coverage",
          titleKey: "coverage",
          value: total,
          context: `scores in ${categoricalRows.value.length} categories`,
          format: "count",
        },
      ];
    }

    return [];
  });

  // True when at least one score landed for this config in the window. Drives
  // the detail panel's empty state so a freshly-created (but never-scored)
  // config reads as "waiting for scores" instead of a wall of dashes.
  const hasScores = computed<boolean>(() => {
    if (dataType.value === "numeric")
      return (toNumber(numericAgg.value?.total) ?? 0) > 0;
    if (dataType.value === "boolean")
      return (toNumber(booleanAgg.value?.total) ?? 0) > 0;
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
