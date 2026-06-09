// Copyright 2026 OpenObserve Inc.
//
// Shared helpers that translate a Score Config's `healthy_threshold` into the
// SQL fragments needed to flag unhealthy rows on `_llm_scores`.
//
// Quality page composables — `useQualityData` (org-wide KPI), `useQualityScoreConfigs`
// (per-config table) and `useQualityConfigDetail` (single-config drill-in) — all need
// the exact same threshold semantics. Keeping the translation in one place ensures
// the "unhealthy" count on the KPI tile, the per-config row, and the detail panel
// agree across data types (numeric / categorical / boolean).

import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "./evalEntity";

export interface ThresholdSql {
  /** SQL fragment evaluating to truthy when the row is unhealthy under this
   *  config's `healthy_threshold`. `null` when the config has no threshold
   *  defined (we can't classify the row). */
  unhealthyExpr: string | null;
  /** Human label for the threshold, e.g. "≥ 0.7", "true", "good · great". */
  label: string;
}

export function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

export function thresholdForConfig(config: ScoreConfig): ThresholdSql {
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
    const inList = list
      .map((c) => `'${escapeSqlString(String(c))}'`)
      .join(", ");
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

/** Build the per-config CASE branches that flag a `_llm_scores` row as
 *  unhealthy. The caller decides what each branch returns — `1` for
 *  total-row counts (`COUNT(CASE ... END)`) or `span_id` for distinct-span
 *  counts (`COUNT(DISTINCT CASE ... END)`).
 *
 *  Returns `null` when no config in the list has a usable threshold; the
 *  caller should fall back to `CAST(NULL AS INTEGER)` so the column still
 *  exists in the result set. */
export function buildUnhealthyCaseBranches(
  configs: ScoreConfig[],
  thenExpr: string,
): string | null {
  const branches: string[] = [];
  for (const cfg of configs) {
    const cfgId = entityId(cfg);
    if (!cfgId) continue;
    const t = thresholdForConfig(cfg);
    if (!t.unhealthyExpr) continue;
    branches.push(
      `    WHEN CAST(score_config_id AS VARCHAR) = '${escapeSqlString(cfgId)}' AND (${t.unhealthyExpr}) THEN ${thenExpr}`,
    );
  }
  if (branches.length === 0) return null;
  return ["CASE", ...branches, "  END"].join("\n");
}
