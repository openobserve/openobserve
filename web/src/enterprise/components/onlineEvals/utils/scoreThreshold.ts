// Copyright 2026 OpenObserve Inc.
//
// A Score Config's healthy rule as text ("≥ 0.7", "true", "low, medium"), and the SQL escape the score queries share.

import { gt, raw, type I18nText } from "@/types/i18n";

import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, valueOf } from "./evalEntity";
import { formatNumber } from "./qualityFormat";

export function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/** The healthy rule as text; empty when the config has no usable threshold. */
/** A numeric config's threshold as a value and a direction, for the trend's threshold line; null otherwise. */
export function numericThreshold(
  config: ScoreConfig,
): { value: number; direction: "gte" | "lte" } | null {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  if (dataTypeOf(config) !== "numeric" || ht?.value == null || !ht.direction) return null;
  const value = Number(ht.value);
  return Number.isFinite(value)
    ? { value, direction: ht.direction === "gte" ? "gte" : "lte" }
    : null;
}

export function thresholdForConfig(config: ScoreConfig): { label: I18nText } {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  const type = dataTypeOf(config);
  if (!ht) return { label: raw("") };

  if (type === "numeric") {
    if (ht.value === undefined || ht.value === null || !ht.direction) return { label: raw("") };
    const value = Number(ht.value);
    const shown = Number.isFinite(value) ? formatNumber(value) : String(ht.value);
    return { label: raw(`${ht.direction === "gte" ? "≥" : "≤"} ${shown}`) };
  }

  if (type === "categorical") {
    const list: unknown = ht.healthy_categories ?? ht.healthyCategories;
    if (!Array.isArray(list)) return { label: raw("") };
    // A missing list means no threshold, but the backend marks every score unhealthy for an empty one, so the rule says so.
    return { label: list.length ? raw(list.join(", ")) : gt("onlineEvals.quality.noHealthyValue") };
  }

  if (type === "boolean") {
    const healthy = ht.healthy_value ?? ht.healthyValue;
    if (healthy === undefined || healthy === null) return { label: raw("") };
    return { label: raw(String(healthy === true || healthy === "true")) };
  }

  return { label: raw("") };
}
