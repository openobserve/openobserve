import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf } from "./evalEntity";
import { thresholdForConfig } from "./scoreThreshold";

export type QualityFormat = "number" | "percent" | "text";

export interface QualitySummary {
  qualityValue: number | string | null;
  qualityFormat: QualityFormat;
  qualityLabel: string;
}

export interface QualitySummaryAggregate {
  avgNumeric: number | null;
  numericValues: number;
  numericUnhealthy: number | null;
  trueScores: number;
  falseScores: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}

function valueOf<T = any>(
  row: any,
  camel: string,
  snake: string,
): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

export function healthyBooleanValue(config: ScoreConfig): boolean | null {
  const threshold = valueOf<any>(
    config,
    "healthyThreshold",
    "healthy_threshold",
  );
  const healthy = threshold?.healthy_value ?? threshold?.healthyValue;
  if (healthy === true || healthy === "true") return true;
  if (healthy === false || healthy === "false") return false;
  return null;
}

export function healthyCategories(config: ScoreConfig): string[] {
  const threshold = valueOf<any>(
    config,
    "healthyThreshold",
    "healthy_threshold",
  );
  const categories =
    threshold?.healthy_categories ?? threshold?.healthyCategories;
  return Array.isArray(categories) ? categories.map(String) : [];
}

export function qualitySummaryForConfig(
  config: ScoreConfig,
  aggregate: QualitySummaryAggregate,
  categoryCounts: CategoryCount[],
): QualitySummary {
  const type = dataTypeOf(config);

  if (type === "numeric") {
    const threshold = thresholdForConfig(config);
    const healthyRate =
      threshold.unhealthyExpr != null &&
      aggregate.numericUnhealthy != null &&
      aggregate.numericValues > 0
        ? ((aggregate.numericValues - aggregate.numericUnhealthy) /
            aggregate.numericValues) *
          100
        : null;
    return {
      qualityValue: aggregate.avgNumeric,
      qualityFormat: "number",
      qualityLabel:
        healthyRate == null
          ? "Average"
          : `Average · ${healthyRate.toFixed(1)}% healthy`,
    };
  }

  if (type === "boolean") {
    const expected = healthyBooleanValue(config);
    const total = aggregate.trueScores + aggregate.falseScores;
    const numerator =
      expected === true
        ? aggregate.trueScores
        : expected === false
          ? aggregate.falseScores
          : aggregate.trueScores;
    return {
      qualityValue: total > 0 ? (numerator / total) * 100 : null,
      qualityFormat: "percent",
      qualityLabel: expected == null ? "True rate" : "Healthy rate",
    };
  }

  if (type === "categorical") {
    const healthy = healthyCategories(config);
    const total = categoryCounts.reduce((sum, item) => sum + item.count, 0);
    if (healthy.length > 0) {
      const healthySet = new Set(healthy);
      const healthyCount = categoryCounts.reduce(
        (sum, item) => sum + (healthySet.has(item.category) ? item.count : 0),
        0,
      );
      return {
        qualityValue: total > 0 ? (healthyCount / total) * 100 : null,
        qualityFormat: "percent",
        qualityLabel: "Healthy rate",
      };
    }

    const top = [...categoryCounts].sort(
      (a, b) => b.count - a.count || a.category.localeCompare(b.category),
    )[0];
    return {
      qualityValue: top?.category ?? null,
      qualityFormat: "text",
      qualityLabel: "Top category",
    };
  }

  return {
    qualityValue: null,
    qualityFormat: "text",
    qualityLabel: "",
  };
}
