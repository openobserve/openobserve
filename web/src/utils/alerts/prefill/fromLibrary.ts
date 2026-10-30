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

/**
 * A library alert → AlertPrefill ("Customize in editor").
 *
 * This is the tier-2 path of the settled tunables decision: the drawer edits the
 * structured fields, and anything deeper — a `HAVING … > N` living inside the
 * SQL text — is edited in the alert editor the user already knows.
 *
 * The other adapters *derive* a query from what a surface is showing. This one
 * carries an existing query across UNCHANGED, and that is the whole point: the
 * library stores exports of real alerts, so there is nothing to substitute and
 * any rewriting here would be a bug rather than a feature.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillAggregation,
  type AlertPrefillThresholdCondition,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { MAX_PERIOD_MINUTES, clampPeriodMinutes, warn } from "../alertPrefill";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

export interface LibraryPrefillInput {
  /** The manifest row — provenance, and the fallback for stream/query type. */
  entry: AlertLibraryEntry;
  /**
   * The fetched alert file, after the drawer's tunables have been applied. The
   * file wins over the entry wherever both speak: the entry is an index, the
   * file is what would actually run.
   */
  file: AlertLibraryFile;
}

/** Fetched documents are untrusted — read through, never index blind. */
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const buildPrefillFromLibrary = (input: LibraryPrefillInput): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];

  const entry = (input?.entry ?? {}) as Partial<AlertLibraryEntry>;
  const file = asRecord(input?.file);
  const queryCondition = asRecord(file.query_condition);
  const trigger = asRecord(file.trigger_condition);

  // Only "promql" is a distinct path; everything else lands on SQL, which is
  // what the form defaults to anyway.
  const declaredType = asText(queryCondition.type) ?? entry.query_type;
  const isPromql = declaredType === "promql";

  const promqlCondition = asRecord(queryCondition.promql_condition);
  // Rebuilt field by field rather than spread: the file's condition also carries
  // `ignore_case`, which is a string test and meaningless on a metric value.
  const condition: AlertPrefillThresholdCondition | null = isPromql
    ? {
        column: asText(promqlCondition.column) ?? "value",
        operator: asText(promqlCondition.operator) ?? ">=",
        value: asFiniteNumber(promqlCondition.value) ?? 0,
      }
    : null;

  // A window longer than the form accepts is clamped and said out loud —
  // invariant 4. No library alert is anywhere near this today.
  const rawPeriod = asFiniteNumber(trigger.period);
  const periodMinutes = rawPeriod === undefined ? undefined : clampPeriodMinutes(rawPeriod);
  if (rawPeriod !== undefined && Math.round(rawPeriod) > MAX_PERIOD_MINUTES) {
    warnings.push(warn("periodClamped", "warning", { minutes: periodMinutes as number }));
  }

  const aggregation = queryCondition.aggregation;

  return {
    version: ALERT_PREFILL_VERSION,
    source: "library",
    // The curated title, not the filename stem — this is what the toast says.
    sourceLabel: entry.title ?? entry.name ?? "",
    name: asText(file.name) ?? entry.name,
    streamType: asText(file.stream_type) ?? entry.stream_type ?? "",
    streamName: asText(file.stream_name) ?? entry.stream ?? "",
    queryType: isPromql ? "promql" : "sql",
    // Byte-for-byte, both ways. There are no placeholders in a library alert, so
    // a query that changed on the way to the editor changed by accident.
    ...(isPromql ? { promql: asText(queryCondition.promql) } : { sql: asText(queryCondition.sql) }),
    promqlCondition: condition,
    ...(asRecord(aggregation).function
      ? { aggregation: aggregation as AlertPrefillAggregation }
      : {}),
    vrlFunction: asText(queryCondition.vrl_function) ?? null,
    // The whole trigger travels, not just the window. A library alert is an
    // export of a real one and the drawer's tunables edit these very fields —
    // dropping them means the editor silently contradicts both the file and
    // the tuning the user just did in the drawer.
    triggerThreshold: asFiniteNumber(trigger.threshold),
    triggerOperator: asText(trigger.operator),
    periodMinutes,
    frequencyMinutes: asFiniteNumber(trigger.frequency),
    silenceMinutes: asFiniteNumber(trigger.silence),
    timezone: asText(trigger.timezone),
    warnings,
    meta: {
      libraryId: entry.id,
      contentHash: entry.content_hash,
      pack: entry.pack,
    },
  };
};
