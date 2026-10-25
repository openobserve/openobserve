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

import type { AlertLibraryEntry, AlertLibraryFile, StreamsByType } from "@/types/alertLibrary";
import { backtest, type Bucket } from "@/utils/alerts/backtest";

import { buildInstallPayload, type InstallPayloadInput } from "./libraryInstall";
import { readTunables } from "./libraryTunables";

/** Above this many fires in the last 24 h, a one-click add installs paused. */
export const NOISY_FIRE_LIMIT = 10;

/** How many rules "Start with these" offers. */
export const START_WITH_LIMIT = 6;

const PACK_TAG = "pack:";

const PROMQL_OPERATORS: Record<string, string> = {
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  "=": "==",
  "==": "==",
  "!=": "!=",
};

/** The PromQL estimate's inputs: the expression whose non-empty instants are fires. */
export interface EstimateQuery {
  expression: string;
  frequencyMinutes: number;
  silenceMinutes: number;
}

/** One `query_range` matrix series. */
export interface RangeSeries {
  values?: unknown[];
}

/** What the org already has from the library, read off its alert list. */
export interface LibraryMarks {
  entryIds: Set<string>;
  packs: Set<string>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The PromQL expression to range-query for the 24 h estimate; null for a SQL rule. */
export const estimateQuery = (file: AlertLibraryFile): EstimateQuery | null => {
  const query = asRecord(file.query_condition);
  const promql = typeof query.promql === "string" ? query.promql.trim() : "";
  if (query.type !== "promql" || !promql) return null;
  const { frequency, silence } = readTunables(file);
  const condition = asRecord(query.promql_condition);
  const operator =
    typeof condition.operator === "string" ? PROMQL_OPERATORS[condition.operator] : undefined;
  const value = Number(condition.value);
  // Rule mode and a missing condition both mean the expression already selects the firing series.
  const expression =
    query.promql_rule_mode !== true &&
    operator &&
    condition.value !== null &&
    Number.isFinite(value)
      ? `(${promql}) ${operator} ${value}`
      : promql;
  return { expression, frequencyMinutes: frequency, silenceMinutes: silence };
};

/** Fires the rule would have sent: instants with any series, merged by the silence window. */
export const countEstimatedFires = (
  result: RangeSeries[],
  frequencyMinutes: number,
  silenceMinutes: number,
): number => {
  const instants = new Set<number>();
  for (const series of result) {
    for (const point of Array.isArray(series?.values) ? series.values : []) {
      const seconds = Number(Array.isArray(point) ? point[0] : NaN);
      if (Number.isFinite(seconds)) instants.add(seconds * 1000);
    }
  }
  const buckets: Bucket[] = [...instants].map((time) => ({ time, value: 1 }));
  return backtest(buckets, ">=", 1, silenceMinutes, frequencyMinutes).episodes;
};

/** The library install body, paused when the estimate says the rule is noisy. */
export const buildQuickAddPayload = (
  input: InstallPayloadInput,
  estimatedFires: number | null,
): Record<string, unknown> => {
  const payload = buildInstallPayload(input);
  if (estimatedFires !== null && estimatedFires > NOISY_FIRE_LIMIT) payload.enabled = false;
  return payload;
};

/** Required streams the org lacks, of the entry's stream type. */
export const missingStreams = (
  entry: AlertLibraryEntry,
  streamsByType: StreamsByType,
): string[] => {
  const required = Array.isArray(entry?.required_streams) ? entry.required_streams : [];
  const available = Object.hasOwn(streamsByType ?? {}, entry?.stream_type)
    ? streamsByType[entry.stream_type]
    : undefined;
  return required.filter((name) => !(available instanceof Map) || !available.has(name));
};

/** Up to six critical rules that fit, one per pack-scoped category, in the order given. */
export const pickStartWithThese = (
  entries: readonly AlertLibraryEntry[],
  fits: (entry: AlertLibraryEntry) => boolean,
): AlertLibraryEntry[] => {
  const picked: AlertLibraryEntry[] = [];
  const categories = new Set<string>();
  for (const entry of entries) {
    if (picked.length >= START_WITH_LIMIT) break;
    const key = `${entry.pack}/${entry.category}`;
    if (entry.severity !== "critical" || categories.has(key) || !fits(entry)) continue;
    categories.add(key);
    picked.push(entry);
  }
  return picked;
};

/** Per-rule marks from `library_id`, per-pack marks from the `pack:` tag. */
export const libraryMarks = (alerts: readonly unknown[]): LibraryMarks => {
  const marks: LibraryMarks = { entryIds: new Set(), packs: new Set() };
  for (const item of alerts) {
    const alert = asRecord(item);
    if (typeof alert.library_id === "string" && alert.library_id) {
      marks.entryIds.add(alert.library_id);
    }
    for (const tag of Array.isArray(alert.tags) ? alert.tags : []) {
      if (typeof tag === "string" && tag.startsWith(PACK_TAG) && tag.length > PACK_TAG.length) {
        marks.packs.add(tag.slice(PACK_TAG.length));
      }
    }
  }
  return marks;
};
