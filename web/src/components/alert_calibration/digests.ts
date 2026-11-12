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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatSeconds } from "./format";
import { ADVICE_LABEL, LIMITATION_LABEL, QUALITY_REASON_LABEL } from "./rules";

export const DIGEST_STREAM = "_o2_alert_calibration_digests";
/** Every digest search asks for this many rows, and a full page means more may exist. */
export const SEARCH_SIZE = 100;
export const RUNS_LOOKBACK_DAYS = 14;

const MICROS_PER_DAY = 86_400_000_000;

export type RuleId =
  "failure" | "no_destination" | "noise" | "notify_failed" | "scheduler_health" | "silent";
export type Severity = "Info" | "Low" | "Medium" | "High";
export type Confidence = "Low" | "Medium" | "High";
/** Stamped from schema version 2 on; a version-1 record has no `kind`. */
export type RecordKind = "run" | "finding" | "skip";
/** How far the evidence goes: a confirmed condition, a narrowed cause, or an owner's call. */
export type Tier = "A" | "B" | "C";
export type Quality = "usable" | "partial" | "unavailable";
export type Audience = "owner" | "operator";
/** What a `review_alert` action opens the editor on (D:L298). */
export type ReviewFocus = "settings" | "threshold" | "query" | "grouping";
/** The typed actions this build renders (D:L287); any other type is dropped, never shown raw. */
export type InsightAction =
  | { type: "review_alert"; alert_id: string; focus?: ReviewFocus }
  | { type: "review_source"; stream_type: string; stream_name: string }
  | { type: "review_platform" };
/** Whether the run judged alert definitions; only `checked` means AutoObserve's findings are current (U2). */
export type DefinitionChecks = "checked" | "unavailable" | "not_yet" | "failed";

const REVIEW_FOCI: ReviewFocus[] = ["settings", "threshold", "query", "grouping"];

/** The counts are null for a scoped reader, since they count definitions it may not see. */
export interface Coverage {
  coverage_unreadable_definitions: number | null;
  coverage_facts_without_definition: number | null;
  coverage_definitions_without_facts: number | null;
  coverage_transitions_truncated: boolean;
  coverage_counters_truncated: boolean;
  coverage_error_clusters_truncated: boolean;
  coverage_error_clusters_unattributed: number | null;
  coverage_stream_substrate_empty: boolean;
  /** Written only when the org has alerts, and only from version 2. */
  coverage_definition_checks?: DefinitionChecks;
  coverage_definition_checks_truncated?: boolean;
  /** Failing alerts whose errors were not classified; absent before P7a, null for a scoped reader. */
  coverage_error_classes_unassessed?: number | null;
}

/** One run as the timeline lists it; a run is identified by its window, not by an id. */
export interface RunRow extends Coverage {
  window_start: number;
  window_end: number;
  emitted_at: number;
  /** Null on a scoped record whose emission's visible counts the read did not get. */
  finding_count: number | null;
  skip_count: number | null;
  /** Version 2 splits `skip_count` into the skips written as records and the routine ones only counted. */
  written_skip_count?: number | null;
  omitted_routine_skip_count?: number | null;
  /** Alert subjects the run left out as dismissed; absent before P4, null for a scoped reader. */
  dismissed_count?: number | null;
  /** Null for a scoped reader: the org's count is not one it may see. */
  alerts_in_scope: number | null;
  coverage_gap: boolean;
  /** The org-wide runs list does not select it; an emission's records and every scoped row carry it. */
  schema_version?: number;
  /** Set when the reader lacks org-wide alert read, so every count covers only its alerts. */
  visibility?: "scoped";
}

/** One record of the digest stream; a run that found nothing writes one record with every finding column unset. */
export interface DigestRecord extends Omit<RunRow, "emitted_at"> {
  _timestamp: number;
  org: string;
  config_id: string;
  cluster?: string;
  /** Absent on a version-1 record, which readers treat as version 1. */
  schema_version?: number;
  kind?: RecordKind;
  rule_id?: RuleId;
  severity?: Severity;
  confidence?: Confidence;
  title?: string;
  /** Version 1 only: action names, comma-joined. */
  actions?: string;
  /** Version 2: the typed actions as one JSON array, stringified whole by ingestion. */
  insight_actions?: string | unknown[];
  alert_id?: string;
  alert_name?: string;
  tier?: Tier;
  pattern?: string;
  detector_version?: number;
  quality?: Quality;
  /** Why the evidence is degraded, as one JSON array; written only when it is. */
  quality_reasons?: string | unknown[];
  audience?: Audience;
  /** Codes, as one JSON array stringified whole by ingestion. */
  limitations?: string;
  /** A code; the web holds its words. */
  advice?: string;
  scope_kind?: string;
  scope_key?: string;
  finding_id?: string;
  /** Skip records only: the reason's name, and its numbers as one JSON object. */
  skip_reason?: string;
  skip_detail?: string;
  [column: `evidence_${string}`]: number | string | undefined;
}

export type FindingRecord = DigestRecord &
  Required<Pick<DigestRecord, "rule_id" | "severity" | "confidence" | "title">>;

export type SkipRecord = DigestRecord &
  Required<Pick<DigestRecord, "rule_id" | "skip_reason">> & { kind: "skip" };

export const schemaVersion = (record: DigestRecord): number => record.schema_version ?? 1;

/** A version-1 record has no `kind`, so a rule with a severity is its finding. */
export const isFinding = (record: DigestRecord): record is FindingRecord =>
  record.kind === "finding" || (record.kind === undefined && !!record.rule_id);

export const isSkip = (record: DigestRecord): record is SkipRecord => record.kind === "skip";

/** An array column as ingestion stringified it, or already parsed; null for a string that is not JSON. */
export function arrayColumn(value: string | unknown[] | undefined): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

/** Text that is not JSON is kept as one line, since it is the rule's own words. */
function textItems(value: string | unknown[] | undefined): string[] {
  const items = arrayColumn(value);
  if (items === null) return typeof value === "string" ? [value] : [];
  return items.filter((item): item is string => typeof item === "string");
}

const isReviewFocus = (value: unknown): value is ReviewFocus =>
  typeof value === "string" && (REVIEW_FOCI as string[]).includes(value);

/** Codes this build can name; an unknown one shows nothing. */
export function limitationsOf(t: TranslateFn, record: DigestRecord): I18nText[] {
  return textItems(record.limitations).flatMap((code): I18nText[] => {
    if (!Object.hasOwn(LIMITATION_LABEL, code)) return [];
    if (code !== "searched_window") return [t(LIMITATION_LABEL[code])];
    // A window the record never stated is not guessed.
    const secs = Number(record.evidence_notworking_searched_secs);
    if (!(secs > 0)) return [];
    return [t(LIMITATION_LABEL[code], { window: formatSeconds(t, secs) })];
  });
}

export const qualityReasonsOf = (t: TranslateFn, record: DigestRecord): I18nText[] =>
  textItems(record.quality_reasons).flatMap((code) =>
    Object.hasOwn(QUALITY_REASON_LABEL, code) ? [t(QUALITY_REASON_LABEL[code])] : [],
  );

export const adviceOf = (t: TranslateFn, record: DigestRecord): I18nText | null =>
  record.advice && Object.hasOwn(ADVICE_LABEL, record.advice)
    ? t(ADVICE_LABEL[record.advice])
    : null;

/** Only actions this build can label survive, so a newer writer's type never reaches the screen. */
export function insightActionsOf(record: DigestRecord): InsightAction[] {
  return (arrayColumn(record.insight_actions) ?? []).flatMap((item): InsightAction[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const action: Record<string, unknown> = { ...item };
    if (action.type === "review_platform") return [{ type: "review_platform" }];
    if (action.type === "review_source") {
      const { stream_type, stream_name } = action;
      return typeof stream_type === "string" && typeof stream_name === "string"
        ? [{ type: "review_source", stream_type, stream_name }]
        : [];
    }
    if (action.type !== "review_alert" || typeof action.alert_id !== "string") return [];
    if (action.focus === undefined) return [{ type: "review_alert", alert_id: action.alert_id }];
    return isReviewFocus(action.focus)
      ? [{ type: "review_alert", alert_id: action.alert_id, focus: action.focus }]
      : [];
  });
}

export type CoverageVerdict = "none" | "gap" | "full";

/** One org or hour a cluster finding lists; the digest stores each list as one JSON column. */
export interface LagRow {
  key: string | number;
  skipped_windows: number;
  late_evaluations: number;
  evaluations: number;
}

const SEVERITY_RANK: Record<Severity, number> = { High: 3, Medium: 2, Low: 1, Info: 0 };

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
    written_skip_count: record.written_skip_count,
    omitted_routine_skip_count: record.omitted_routine_skip_count,
    dismissed_count: record.dismissed_count,
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
    coverage_definition_checks: record.coverage_definition_checks,
    coverage_definition_checks_truncated: record.coverage_definition_checks_truncated,
    coverage_error_classes_unassessed: record.coverage_error_classes_unassessed,
    schema_version: record.schema_version,
    visibility: record.visibility,
  };
}

/** Each emission stamps one `_timestamp` on all its records, so the newest emission is the run as it stands. */
export function latestEmission(records: DigestRecord[]): {
  run: RunRow | null;
  findings: FindingRecord[];
  /** The skips a version-2 run wrote as records: a rule that could not run, or looked and declined. */
  skips: SkipRecord[];
} {
  if (records.length === 0) return { run: null, findings: [], skips: [] };
  const newest = Math.max(...records.map((r) => r._timestamp));
  const emission = records.filter((r) => r._timestamp === newest);
  return {
    run: runIdentity(emission[0]),
    findings: emission.filter(isFinding).sort(findingOrder),
    skips: emission.filter(isSkip).sort(skipOrder),
  };
}

/** The rows the record search returned, without the run rows the server adds for a scoped reader. */
export const recordHits = (records: DigestRecord[]): number =>
  records.filter((r) => !(r.kind === "run" && isScoped(r))).length;

const skipOrder = (a: SkipRecord, b: SkipRecord) =>
  a.rule_id.localeCompare(b.rule_id) || (a.alert_name ?? "").localeCompare(b.alert_name ?? "");

/** One emission's records share a `_timestamp`, so the search returns them in no stable order. */
const findingOrder = (a: FindingRecord, b: FindingRecord) =>
  SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
  a.rule_id.localeCompare(b.rule_id) ||
  (a.alert_name ?? "").localeCompare(b.alert_name ?? "");

export interface RuleGroup {
  rule_id: RuleId;
  /** In severity order, as `latestEmission` sorts them. */
  findings: FindingRecord[];
  severity: Severity | null;
}

/** Every rule, worst first, so a rule that flagged nothing still shows as clear rather than missing. */
export function findingsByRule(rules: RuleId[], findings: FindingRecord[]): RuleGroup[] {
  const rank = (s: Severity | null) => (s ? SEVERITY_RANK[s] + 1 : 0);
  return rules
    .map((rule_id) => {
      const mine = findings.filter((f) => f.rule_id === rule_id);
      return { rule_id, findings: mine, severity: mine[0]?.severity ?? null };
    })
    .sort((a, b) => rank(b.severity) - rank(a.severity) || b.findings.length - a.findings.length);
}

/** A title restates the alert's name, which a row that already shows the name can drop. */
export const titleAfterName = (f: FindingRecord): string =>
  f.alert_name && f.title.startsWith(f.alert_name)
    ? f.title.slice(f.alert_name.length).trimStart()
    : f.title;

export const latestRun = (rows: RunRow[]): RunRow | null =>
  rows.reduce<RunRow | null>((a, b) => (!a || b.window_end > a.window_end ? b : a), null);

export const isScoped = (row: Pick<RunRow, "visibility">) => row.visibility === "scoped";

/** A count the read did not get is a dash, never a zero that would read as nothing found. */
export const countOrDash = (count: number | null | undefined, locale: string): I18nText =>
  typeof count === "number" ? raw(new Intl.NumberFormat(locale).format(count)) : raw("—");

/** No finding, no gap and nothing declined, over the alerts the reader can see. */
export const isQuiet = (row: RunRow) =>
  row.finding_count === 0 && !row.coverage_gap && row.skip_count === 0;

/** Clean needs full coverage and nothing declined as well as zero findings: a zero alone may mean nothing was judged. */
export const isClean = (row: RunRow) => isQuiet(row) && !isScoped(row);

export interface VisibilityCopy {
  allClear: I18nText;
  nothingDescription: I18nText;
  alertsInScope: { count: number | null; sub?: I18nText; subIcon?: IconName };
  pending: { banner: I18nText; badge: I18nText };
}

/** A scoped zero says nothing about the alerts the reader cannot access, so its copy never claims the org. */
export function visibilityCopy(t: TranslateFn, row: RunRow): VisibilityCopy {
  const pending = {
    banner: t("alertCalibration.visibility.countsPending"),
    badge: t("alertCalibration.visibility.countsPendingBadge"),
  };
  if (!isScoped(row)) {
    return {
      allClear: t("alertCalibration.dashboard.allClear"),
      nothingDescription: t("alertCalibration.detail.nothingDescription", {
        count: row.alerts_in_scope ?? 0,
      }),
      alertsInScope: { count: row.alerts_in_scope ?? null },
      pending,
    };
  }
  return {
    allClear: t("alertCalibration.visibility.allClear"),
    nothingDescription: t("alertCalibration.visibility.nothingDescription"),
    alertsInScope: {
      count: null,
      sub: t("alertCalibration.visibility.orgTotalHidden"),
      subIcon: "info-outline",
    },
    pending,
  };
}

/** A missing or malformed column lists nothing, and a row without a usable key is dropped. */
export function parseLagRows(value: unknown, keyField: "org_id" | "hour_start_micros"): LagRow[] {
  if (typeof value !== "string" || value === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) =>
      keyField === "org_id"
        ? typeof item.org_id === "string" && item.org_id.trim() !== ""
        : Number.isFinite(item.hour_start_micros),
    )
    .map((item) => ({
      key: item[keyField] as string | number,
      skipped_windows: Number(item.skipped_windows) || 0,
      late_evaluations: Number(item.late_evaluations) || 0,
      evaluations: Number(item.evaluations) || 0,
    }));
}

export function coverageVerdict(row: RunRow): CoverageVerdict {
  if (row.coverage_stream_substrate_empty) return "none";
  return row.coverage_gap ? "gap" : "full";
}

export interface CoverageNote {
  text: I18nText;
  /** Counted by the run's `coverage_gap`, so it is shown as a warning, never as neutral meta. */
  gap: boolean;
}

/** AutoObserve off is configuration, not a blind spot of the run, so its note alone is neutral (U2). */
const DEFINITION_CHECK_NOTE: Record<DefinitionChecks, { key: I18nKey; gap: boolean } | null> = {
  checked: null,
  unavailable: { key: "alertCalibration.coverage.definitionChecksUnavailable", gap: false },
  not_yet: { key: "alertCalibration.coverage.definitionChecksNotYet", gap: true },
  failed: { key: "alertCalibration.coverage.definitionChecksFailed", gap: true },
};

/** Every coverage column off its default, including the ones `coverage_gap` does not count. */
export function coverageNoteRows(t: TranslateFn, row: RunRow): CoverageNote[] {
  const notes: CoverageNote[] = [];
  if (row.coverage_stream_substrate_empty)
    notes.push({ text: t("alertCalibration.coverage.substrateEmpty"), gap: true });
  const counts: [keyof Coverage, I18nKey, boolean][] = [
    ["coverage_unreadable_definitions", "alertCalibration.coverage.unreadableDefinitions", true],
    [
      "coverage_facts_without_definition",
      "alertCalibration.coverage.factsWithoutDefinition",
      false,
    ],
    [
      "coverage_error_clusters_unattributed",
      "alertCalibration.coverage.errorClustersUnattributed",
      true,
    ],
    [
      "coverage_definitions_without_facts",
      "alertCalibration.coverage.definitionsWithoutFacts",
      false,
    ],
    ["coverage_error_classes_unassessed", "alertCalibration.coverage.errorClassesUnassessed", true],
  ];
  const flags: [keyof Coverage, I18nKey][] = [
    ["coverage_transitions_truncated", "alertCalibration.coverage.transitionsTruncated"],
    ["coverage_counters_truncated", "alertCalibration.coverage.countersTruncated"],
    ["coverage_error_clusters_truncated", "alertCalibration.coverage.errorClustersTruncated"],
    ["coverage_definition_checks_truncated", "alertCalibration.coverage.definitionChecksTruncated"],
  ];
  for (const [column, key, gap] of counts) {
    const count = Number(row[column]);
    if (count > 0) notes.push({ text: t(key, { count }, count), gap });
  }
  for (const [column, key] of flags) {
    if (row[column]) notes.push({ text: t(key), gap: true });
  }
  const checks = row.coverage_definition_checks;
  const definitionNote =
    checks && Object.hasOwn(DEFINITION_CHECK_NOTE, checks) ? DEFINITION_CHECK_NOTE[checks] : null;
  if (definitionNote) notes.push({ text: t(definitionNote.key), gap: definitionNote.gap });
  return notes;
}

export const coverageNotes = (t: TranslateFn, row: RunRow): I18nText[] =>
  coverageNoteRows(t, row).map((note) => note.text);
