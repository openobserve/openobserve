// Copyright 2026 OpenObserve Inc.
//
// A Score Config's healthy rule as text ("≥ 0.7", "true", "low, medium"), and the SQL escape the score queries share.

import { raw, type I18nText } from "@/types/i18n";

import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, valueOf } from "./evalEntity";

export function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/** The healthy rule as text; empty when the config has no usable threshold. */
export function thresholdForConfig(config: ScoreConfig): { label: I18nText } {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  const type = dataTypeOf(config);
  if (!ht) return { label: raw("") };

  if (type === "numeric") {
    if (ht.value === undefined || ht.value === null || !ht.direction) return { label: raw("") };
    return { label: raw(`${ht.direction === "gte" ? "≥" : "≤"} ${ht.value}`) };
  }

  if (type === "categorical") {
    const list: string[] = ht.healthy_categories || ht.healthyCategories || [];
    return { label: raw(Array.isArray(list) ? list.join(", ") : "") };
  }

  if (type === "boolean") {
    const healthy = ht.healthy_value ?? ht.healthyValue;
    if (healthy === undefined || healthy === null) return { label: raw("") };
    return { label: raw(String(healthy === true || healthy === "true")) };
  }

  return { label: raw("") };
}
