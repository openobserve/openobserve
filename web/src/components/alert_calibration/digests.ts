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

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";

export const DIGEST_STREAM = "_o2_alert_calibration_digests";
/** Every digest search asks for this many rows, and a full page means more may exist. */
export const SEARCH_SIZE = 100;
export const RUNS_LOOKBACK_DAYS = 14;

const MICROS_PER_DAY = 86_400_000_000;

export type RuleId =
  "failure" | "no_destination" | "noise" | "notify_failed" | "scheduler_health" | "silent";
export type Severity = "Info" | "Low" | "Medium" | "High";
export type Confidence = "Low" | "Medium" | "High";

export interface Coverage {
  coverage_unreadable_definitions: number;
  coverage_facts_without_definition: number;
  coverage_definitions_without_facts: number;
  coverage_transitions_truncated: boolean;
  coverage_counters_truncated: boolean;
  coverage_error_clusters_truncated: boolean;
  coverage_error_clusters_unattributed: number;
  coverage_stream_substrate_empty: boolean;
  coverage_meta_fallback_used: boolean;
}

/** One run as the timeline lists it; a run is identified by its window, not by an id. */
export interface RunRow extends Coverage {
  window_start: number;
  window_end: number;
  emitted_at: number;
  finding_count: number;
  skip_count: number;
  alerts_in_scope: number;
  coverage_gap: boolean;
}

/** One record of the digest stream; a run that found nothing writes one record with every finding column unset. */
export interface DigestRecord extends Omit<RunRow, "emitted_at"> {
  _timestamp: number;
  org: string;
  config_id: string;
  cluster?: string;
  rule_id?: RuleId;
  severity?: Severity;
  confidence?: Confidence;
  title?: string;
  actions?: string;
  alert_id?: string;
  alert_name?: string;
  [column: `evidence_${string}`]: number | string | undefined;
}

export type FindingRecord = DigestRecord &
  Required<Pick<DigestRecord, "rule_id" | "severity" | "confidence" | "title" | "actions">>;

export type CoverageVerdict = "none" | "gap" | "full";

/** One alert an org-wide finding lists; the digest stores the list as one JSON column. */
export interface AffectedAlert {
  alert_id: string;
  alert_name: string;
  skipped_windows: number;
  late_evaluations: number;
  evaluations: number;
}

const COVERAGE_COLUMNS: (keyof Coverage)[] = [
  "coverage_unreadable_definitions",
  "coverage_facts_without_definition",
  "coverage_definitions_without_facts",
  "coverage_transitions_truncated",
  "coverage_counters_truncated",
  "coverage_error_clusters_truncated",
  "coverage_error_clusters_unattributed",
  "coverage_stream_substrate_empty",
  "coverage_meta_fallback_used",
];

const SEVERITY_RANK: Record<Severity, number> = { High: 3, Medium: 2, Low: 1, Info: 0 };

const RUN_COLUMNS = [
  "window_start",
  "window_end",
  "finding_count",
  "skip_count",
  "alerts_in_scope",
  "coverage_gap",
  ...COVERAGE_COLUMNS,
];

/** One row per emission: a run pulled again writes a second emission with its own `_timestamp`. */
export const runsSql = () =>
  `SELECT DISTINCT ${RUN_COLUMNS.join(", ")}, _timestamp AS emitted_at\nFROM "${DIGEST_STREAM}"\nORDER BY emitted_at DESC`;

export const runRecordsSql = (windowStart: number, windowEnd: number) =>
  `SELECT *\nFROM "${DIGEST_STREAM}"\nWHERE window_start = ${Math.trunc(windowStart)} AND window_end = ${Math.trunc(windowEnd)}\nORDER BY _timestamp DESC`;

export const flaggedByRuleSql = () =>
  `SELECT rule_id, COUNT(DISTINCT alert_id) AS alerts_flagged, COUNT(DISTINCT window_end) AS runs_flagging\nFROM "${DIGEST_STREAM}"\nWHERE rule_id IS NOT NULL\nGROUP BY rule_id`;

/** The range the timeline and the dashboard read; a run emitted before it is not listed. */
export const lookbackRange = (nowMicros: number) => ({
  start_time: nowMicros - RUNS_LOOKBACK_DAYS * MICROS_PER_DAY,
  end_time: nowMicros,
});

export const runKey = (row: Pick<RunRow, "window_start" | "window_end">) =>
  `${row.window_start}:${row.window_end}`;

/** Keeps each window's latest emission, newest first: a re-pull re-reads alert state, so the newest wins. */
export function latestPerWindow(rows: RunRow[]): RunRow[] {
  const byWindow = new Map<string, RunRow>();
  for (const row of rows) {
    const seen = byWindow.get(runKey(row));
    if (!seen || row.emitted_at > seen.emitted_at) byWindow.set(runKey(row), row);
  }
  return [...byWindow.values()].sort((a, b) => b.emitted_at - a.emitted_at);
}

export function runIdentity(record: DigestRecord): RunRow {
  return {
    window_start: record.window_start,
    window_end: record.window_end,
    emitted_at: record._timestamp,
    finding_count: record.finding_count,
    skip_count: record.skip_count,
    alerts_in_scope: record.alerts_in_scope,
    coverage_gap: record.coverage_gap,
    coverage_unreadable_definitions: record.coverage_unreadable_definitions,
    coverage_facts_without_definition: record.coverage_facts_without_definition,
    coverage_definitions_without_facts: record.coverage_definitions_without_facts,
    coverage_transitions_truncated: record.coverage_transitions_truncated,
    coverage_counters_truncated: record.coverage_counters_truncated,
    coverage_error_clusters_truncated: record.coverage_error_clusters_truncated,
    coverage_error_clusters_unattributed: record.coverage_error_clusters_unattributed,
    coverage_stream_substrate_empty: record.coverage_stream_substrate_empty,
    coverage_meta_fallback_used: record.coverage_meta_fallback_used,
  };
}

/** Each emission stamps one `_timestamp` on all its records, so the newest emission is the run as it stands. */
export function latestEmission(records: DigestRecord[]): {
  run: RunRow | null;
  findings: FindingRecord[];
} {
  if (records.length === 0) return { run: null, findings: [] };
  const newest = Math.max(...records.map((r) => r._timestamp));
  const emission = records.filter((r) => r._timestamp === newest);
  return {
    run: runIdentity(emission[0]),
    findings: emission.filter((r): r is FindingRecord => !!r.rule_id).sort(findingOrder),
  };
}

/** One emission's records share a `_timestamp`, so the search returns them in no stable order. */
const findingOrder = (a: FindingRecord, b: FindingRecord) =>
  SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
  a.rule_id.localeCompare(b.rule_id) ||
  (a.alert_name ?? "").localeCompare(b.alert_name ?? "");

export const latestRun = (rows: RunRow[]): RunRow | null =>
  rows.reduce<RunRow | null>((a, b) => (!a || b.window_end > a.window_end ? b : a), null);

/** Clean needs full coverage and nothing declined as well as zero findings: a zero alone may mean nothing was judged. */
export const isClean = (row: RunRow) =>
  row.finding_count === 0 && !row.coverage_gap && row.skip_count === 0;

/** A missing or malformed column lists nothing, rather than failing the card. */
export function parseAffectedAlerts(value: unknown): AffectedAlert[] {
  if (typeof value !== "string" || value === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" &&
        item !== null &&
        typeof item.alert_name === "string" &&
        item.alert_name.trim() !== "",
    )
    .map((item) => ({
      alert_id: String(item.alert_id ?? ""),
      alert_name: String(item.alert_name),
      skipped_windows: Number(item.skipped_windows) || 0,
      late_evaluations: Number(item.late_evaluations) || 0,
      evaluations: Number(item.evaluations) || 0,
    }));
}

export function coverageVerdict(row: RunRow): CoverageVerdict {
  if (row.coverage_stream_substrate_empty) return "none";
  return row.coverage_gap ? "gap" : "full";
}

/** Every coverage column off its default, including the two `coverage_gap` does not count. */
export function coverageNotes(t: TranslateFn, row: RunRow): I18nText[] {
  const notes: I18nText[] = [];
  if (row.coverage_stream_substrate_empty)
    notes.push(t("alertCalibration.coverage.substrateEmpty"));
  const counts: [keyof Coverage, I18nKey][] = [
    ["coverage_unreadable_definitions", "alertCalibration.coverage.unreadableDefinitions"],
    ["coverage_facts_without_definition", "alertCalibration.coverage.factsWithoutDefinition"],
    ["coverage_error_clusters_unattributed", "alertCalibration.coverage.errorClustersUnattributed"],
    ["coverage_definitions_without_facts", "alertCalibration.coverage.definitionsWithoutFacts"],
  ];
  const flags: [keyof Coverage, I18nKey][] = [
    ["coverage_transitions_truncated", "alertCalibration.coverage.transitionsTruncated"],
    ["coverage_counters_truncated", "alertCalibration.coverage.countersTruncated"],
    ["coverage_error_clusters_truncated", "alertCalibration.coverage.errorClustersTruncated"],
    ["coverage_meta_fallback_used", "alertCalibration.coverage.metaFallbackUsed"],
  ];
  for (const [column, key] of counts) {
    const count = Number(row[column]);
    if (count > 0) notes.push(t(key, { count }, count));
  }
  for (const [column, key] of flags) {
    if (row[column]) notes.push(t(key));
  }
  return notes;
}
