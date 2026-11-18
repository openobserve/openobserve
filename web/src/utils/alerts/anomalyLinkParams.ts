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

import type { AnomalySummaryKind } from "@/types/anomalyExplore";

/** The parameter that marks a Logs, Traces or Metrics URL as opened from an anomaly link. */
export const FROM_ANOMALY_PARAM = "from_anomaly";

const ANOMALY_PARAM_PREFIX = "anomaly_";

const SUMMARY_KINDS: ReadonlySet<string> = new Set(["value", "absence", "partial_drop"]);

/** The snapshot an anomaly link carries; values are the alert's, never re-read. */
export interface AnomalyLinkInfo {
  anomalyId: string;
  filterApplied: boolean;
  startUs: number | null;
  endUs: number | null;
  kind: AnomalySummaryKind | null;
  measure: string;
  actual: number | null;
  lower: number | null;
  upper: number | null;
  /** Baseline of a partial drop, which has no range. */
  expected: number | null;
}

type QueryLike = Record<string, unknown>;

export function isAnomalyLinkParam(key: string): boolean {
  return key === FROM_ANOMALY_PARAM || key.startsWith(ANOMALY_PARAM_PREFIX);
}

/** Copies the banner parameters into a rebuilt page query, so they survive a search and a refresh. */
export function copyAnomalyLinkParams<T extends QueryLike>(
  from: QueryLike | null | undefined,
  into: T,
): T {
  if (!from) return into;
  for (const [key, value] of Object.entries(from)) {
    if (isAnomalyLinkParam(key) && value !== undefined && value !== null) {
      (into as QueryLike)[key] = value;
    }
  }
  return into;
}

export function withoutAnomalyLinkParams<T extends QueryLike>(query: T): T {
  const next: QueryLike = {};
  for (const [key, value] of Object.entries(query)) {
    if (!isAnomalyLinkParam(key)) next[key] = value;
  }
  return next as T;
}

function first(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numberParam(value: unknown): number | null {
  const s = first(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseAnomalyLink(query: QueryLike | null | undefined): AnomalyLinkInfo | null {
  const anomalyId = first(query?.[FROM_ANOMALY_PARAM]);
  if (!query || !anomalyId) return null;
  const kind = first(query.anomaly_kind);
  return {
    anomalyId,
    filterApplied: first(query.anomaly_filter_applied) !== "0",
    startUs: numberParam(query.anomaly_start),
    endUs: numberParam(query.anomaly_end),
    kind: kind && SUMMARY_KINDS.has(kind) ? (kind as AnomalySummaryKind) : null,
    measure: first(query.anomaly_measure) ?? "",
    actual: numberParam(query.anomaly_actual),
    lower: numberParam(query.anomaly_lower),
    upper: numberParam(query.anomaly_upper),
    expected: numberParam(query.anomaly_expected),
  };
}
