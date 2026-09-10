// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Content helpers shared by the two experiment row drawers, so a row reads the
// same whether it is opened from a single run or from a comparison.

import { gt, raw, type I18nText } from "@/types/i18n";
import type {
  ExperimentComparisonDimension,
  ExperimentComparisonRow,
} from "@/services/llm-experiments.service";

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

/**
 * What a side actually reads as. A categorical score is a policy-derived rank on
 * the wire and a boolean is 0/1, so rendering the raw scalar makes `0 → 1` mean
 * three different things with no way to tell them apart.
 */
export function dimensionSideValue(
  dimension: Pick<
    ExperimentComparisonDimension,
    "dataType" | "baseline" | "candidate" | "baselineLabel" | "candidateLabel"
  >,
  side: "baseline" | "candidate",
): I18nText {
  const label = side === "baseline" ? dimension.baselineLabel : dimension.candidateLabel;
  if (label) return raw(label);
  const value = side === "baseline" ? dimension.baseline : dimension.candidate;
  if (value === null || value === undefined) return raw("—");
  if (dimension.dataType === "boolean") return raw(value ? "true" : "false");
  return raw(formatNumber(value));
}

/** Null for cost and latency, which are units rather than a score type. */
export function dataTypeLabel(
  dimension: Pick<ExperimentComparisonDimension, "dataType">,
): I18nText | null {
  switch (dimension.dataType) {
    case "numeric":
      return gt("aiObservability.experiments.comparePage.panel.typeNumeric");
    case "categorical":
      return gt("aiObservability.experiments.comparePage.panel.typeCategorical");
    case "boolean":
      return gt("aiObservability.experiments.comparePage.panel.typeBoolean");
    default:
      return null;
  }
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

export interface DimensionMovementCounts {
  improved: number;
  unchanged: number;
  regressed: number;
}

/**
 * How many rows moved each way ON THIS DIMENSION.
 *
 * Read from the server's own per-row `assignment`, never re-derived from the
 * deltas: the threshold and comparison policy that decided each assignment live
 * server-side, so recomputing here would let a column header disagree with the
 * bucket the same row is filed under. Rows measured on one side only count
 * toward nothing — there is no movement to attribute.
 */
export function dimensionMovementCounts(
  rows: ExperimentComparisonRow[],
  dimension: Pick<
    ExperimentComparisonDimension,
    "name" | "kind" | "scoreConfigId" | "scoreConfigVersion"
  >,
): DimensionMovementCounts {
  const identity = dimensionIdentity(dimension);
  const counts: DimensionMovementCounts = { improved: 0, unchanged: 0, regressed: 0 };
  for (const row of rows) {
    const found = row.dimensions.find((entry) => dimensionIdentity(entry) === identity);
    if (found?.assignment === "improved") counts.improved += 1;
    else if (found?.assignment === "regressed") counts.regressed += 1;
    else if (found?.assignment === "unchanged") counts.unchanged += 1;
  }
  return counts;
}

/** Trailing zeros carry no information — `34.0000` is just `34`. */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function signedNumber(value: number | null): I18nText {
  if (value === null) return raw("—");
  return raw(`${value > 0 ? "+" : ""}${formatNumber(value)}`);
}

const SECOND_MS = 1000;

/**
 * The unit a set of latencies SHARE. Chosen once from the largest, never per
 * value: `1.2 s → 800 ms` puts two scales inside one comparison and makes the
 * smaller number look bigger.
 */
export function durationUnit(...values: Array<number | null | undefined>): "ms" | "s" {
  const largest = Math.max(0, ...values.map((value) => Math.abs(value ?? 0)));
  return largest >= SECOND_MS ? "s" : "ms";
}

/**
 * A mean latency to four decimal places ("10449.4821") is noise that costs the
 * reader the magnitude. Whole milliseconds below a second; seconds above it,
 * where the digits that matter are the first two or three.
 */
export function formatDuration(value: number, unit: "ms" | "s"): string {
  if (unit === "ms") return Math.round(value).toLocaleString();
  const seconds = value / SECOND_MS;
  return seconds.toFixed(seconds >= 10 ? 1 : 2);
}

/** A lone latency with its own unit — nothing to share a scale with. */
export function durationLabel(value: number | null | undefined): string {
  if (value == null) return "—";
  const unit = durationUnit(value);
  return `${formatDuration(value, unit)} ${unit}`;
}
