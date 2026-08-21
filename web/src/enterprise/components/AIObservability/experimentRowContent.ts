// Copyright 2026 OpenObserve Inc.

// Content helpers shared by the two experiment row drawers, so a row reads the
// same whether it is opened from a single run or from a comparison.

import { gt, raw, type I18nText } from "@/types/i18n";
import type { ExperimentComparisonDimension } from "@/services/llm-experiments.service";

/** Treats blank strings, the literal "null", and empty containers as absent. */
export function hasContent(content: unknown): boolean {
  if (content === null || content === undefined) return false;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "null") return false;
  }
  if (Array.isArray(content) && content.length === 0) return false;
  if (typeof content === "object" && !Array.isArray(content) && Object.keys(content).length === 0) {
    return false;
  }
  const stringified = JSON.stringify(content);
  return !(stringified === "null" || stringified === "{}" || stringified === "[]");
}

/** A string that is NOT JSON — the only shape LLMContentRenderer renders. */
export function isPlainText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}

export function pretty(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function dimensionLabel(
  dimension: Pick<
    ExperimentComparisonDimension,
    "name" | "kind" | "scoreConfigName" | "scoreConfigVersion"
  >,
): I18nText {
  if (dimension.kind !== "score") return raw(dimension.name);
  if (!dimension.scoreConfigName) {
    return gt("aiObservability.experiments.comparePage.panel.unknownScoreDimension");
  }
  const version = dimension.scoreConfigVersion?.replace(/^v/i, "");
  return raw(version ? `${dimension.scoreConfigName} · v${version}` : dimension.scoreConfigName);
}

export function dimensionIdentity(
  dimension: Pick<
    ExperimentComparisonDimension,
    "name" | "kind" | "scoreConfigId" | "scoreConfigVersion"
  >,
): string {
  return [dimension.kind, dimension.name, dimension.scoreConfigId, dimension.scoreConfigVersion]
    .map((part) => part ?? "")
    .join(":");
}

/** Trailing zeros carry no information — `34.0000` is just `34`. */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function signedNumber(value: number | null): I18nText {
  if (value === null) return raw("—");
  return raw(`${value > 0 ? "+" : ""}${formatNumber(value)}`);
}
