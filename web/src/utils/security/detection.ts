// Copyright 2026 OpenObserve Inc.
//
// detection.ts — a Sigma rule as an OpenObserve alert, and back again.
//
// A detection and an alert are the same object here, deliberately. OpenObserve
// already has a scheduled-query engine that runs SQL on a cadence, records every
// firing, deduplicates, and rolls firings up into incidents. A SIEM needs
// exactly that. Building a second one beside it would mean a second scheduler, a
// second history table and a second definition of "did this fire", which is how
// products end up with a detections page and an alerts page that disagree.
//
// So a detection IS an alert:
//
//   detection rule   → alert with query_condition.sql compiled from Sigma
//   detection fired  → a row in alert history
//   related firings  → an incident, which the SOC calls a case
//
// What makes it a SIEM detection rather than an ordinary alert is metadata,
// carried in `context_attributes` — a string map the alert schema already has.
// Nothing here needs a migration, a new table or a new column, which was the
// constraint: the SIEM rides on the alerting substrate rather than beside it.
//
// The one place the shape leaks is that context_attributes values are strings,
// so lists are stored comma-separated and parsed back on read. That is worth the
// zero-migration property.

import type { SigmaLevel, SigmaRule } from "./sigma";
import { sigmaLevelToSeverity } from "./sigma";

/** The key that marks an alert as belonging to the SIEM. */
export const SIEM_MARKER = "siem";

/** How a detection is described once read back off an alert. */
export interface DetectionMeta {
  isSiem: boolean;
  sigmaId: string;
  sigmaYaml: string;
  level: SigmaLevel;
  /** OCSF severity, so a detection sorts against events on one scale. */
  severityId: number;
  techniques: string[];
  tactics: string[];
  logsource: string;
  /** The classifier's source id the rule was compiled against. */
  sourceType: string;
}

const LEVELS: SigmaLevel[] = ["informational", "low", "medium", "high", "critical"];

const splitList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/**
 * Reads the SIEM metadata off an alert.
 *
 * Tolerant on purpose. These attributes can be edited by hand through the alerts
 * UI or an API client, so every field is treated as possibly absent or the wrong
 * shape rather than assumed to be what this file wrote.
 */
export function detectionMetaOf(alert: Record<string, any> | null | undefined): DetectionMeta {
  const attributes = (alert?.context_attributes ?? {}) as Record<string, unknown>;
  const marker = attributes[SIEM_MARKER];
  const level = String(attributes.sigma_level ?? "").toLowerCase();

  return {
    isSiem: marker === true || marker === "true",
    sigmaId: String(attributes.sigma_id ?? ""),
    sigmaYaml: String(attributes.sigma_yaml ?? ""),
    level: (LEVELS as string[]).includes(level) ? (level as SigmaLevel) : "medium",
    severityId: sigmaLevelToSeverity(
      (LEVELS as string[]).includes(level) ? (level as SigmaLevel) : undefined,
    ),
    techniques: splitList(attributes.mitre_techniques),
    tactics: splitList(attributes.mitre_tactics),
    logsource: String(attributes.sigma_logsource ?? ""),
    sourceType: String(attributes.source_type ?? ""),
  };
}

export function isSiemDetection(alert: Record<string, any> | null | undefined): boolean {
  return detectionMetaOf(alert).isSiem;
}

/**
 * An alert name derived from a rule title.
 *
 * An alert name becomes an authorization object id, so the API rejects
 * whitespace and `: # ? ' " % &`, and separately rejects `/`. Sigma titles are
 * written as prose and contain most of those, which means a title can never be
 * used verbatim — every rule in the shipped pack would fail to save.
 *
 * The substitution mirrors the backend's own (`RE_OFGA_UNSUPPORTED_NAME` in
 * src/core/src/auth.rs, `[:#?\s'"%&]+` → `_`) so the name that comes back is the
 * name that was sent. Letting the server rewrite it instead would silently
 * detach the stored name from the one used to build API paths.
 */
export function detectionName(title: string): string {
  const cleaned = title
    .replace(/[:#?\s'"%&/\\]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return cleaned || "Untitled_detection";
}

export interface BuildDetectionInput {
  rule: SigmaRule;
  /** The compiled predicate. Must be runnable; this does not compile. */
  where: string;
  /** Columns the predicate touches, projected so a firing carries its evidence. */
  fields?: string[];
  stream: string;
  streamType?: string;
  /**
   * Where a firing notifies. At least one is required by the alerts API, which
   * is why the UI has to ask for it rather than defaulting to none.
   */
  destinations: string[];
  /** The classifier's source id, recorded so the rule can be recompiled later. */
  sourceType?: string;
  /** Minutes of data each evaluation looks at. */
  period?: number;
  /** Minutes between evaluations. */
  frequency?: number;
  /** Minutes to stay quiet after firing. */
  silence?: number;
  enabled?: boolean;
  /** Overrides the name derived from the rule title. */
  name?: string;
}

/**
 * Builds the alert payload for a detection.
 *
 * The trigger is "one or more matching rows in the window". A Sigma rule already
 * encodes what is suspicious in its own logic, so counting occurrences on top of
 * it would be a second, invisible threshold that the rule's author never wrote.
 * Rules that genuinely need a count carry an aggregation condition, and those do
 * not compile to a bare predicate at all.
 */
export function buildDetectionAlert(input: BuildDetectionInput): Record<string, any> {
  const {
    rule,
    where,
    fields = [],
    stream,
    streamType = "logs",
    destinations,
    sourceType = "",
    period = 15,
    frequency = 15,
    silence = 30,
    enabled = true,
  } = input;

  const logsource = [
    rule.logsource.category && `category=${rule.logsource.category}`,
    rule.logsource.product && `product=${rule.logsource.product}`,
    rule.logsource.service && `service=${rule.logsource.service}`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    name: input.name ?? detectionName(rule.title),
    description: rule.description?.trim() ?? "",
    stream_type: streamType,
    stream_name: stream,
    is_real_time: false,
    enabled,
    destinations,
    // Firings correlate into an incident, which the SOC reads as a case. This is
    // what connects Detections to Cases without a second correlation engine.
    // Incident correlation is an enterprise feature; on a build without it the
    // flag is inert and firings simply notify directly.
    creates_incident: true,
    query_condition: {
      type: "sql",
      sql: detectionSql(stream, where, fields),
      conditions: [],
      aggregation: null,
      promql_condition: null,
      vrl_function: null,
    },
    trigger_condition: {
      period,
      operator: ">=",
      threshold: 1,
      frequency,
      frequency_type: "minutes",
      silence,
    },
    context_attributes: {
      [SIEM_MARKER]: "true",
      sigma_id: rule.id ?? "",
      sigma_yaml: rule.yaml,
      sigma_level: rule.level ?? "medium",
      sigma_logsource: logsource,
      mitre_techniques: rule.techniques.join(","),
      mitre_tactics: rule.tactics.join(","),
      source_type: sourceType,
    },
  };
}

/**
 * The query a detection runs.
 *
 * Two things are load-bearing here.
 *
 * The projection is explicit because the alerts API rejects `SELECT *`. That
 * turns out to be the better query anyway: the columns worth carrying into a
 * notification are the ones the rule actually matched on, which is exactly what
 * the compiler reports in `fields`. An analyst reading the alert sees the
 * evidence rather than the whole row or none of it.
 *
 * No time bound appears, because the scheduler applies the window from
 * `trigger_condition.period`. A rule that pinned its own range would evaluate
 * the same minutes forever.
 */
export function detectionSql(stream: string, where: string, fields: string[] = []): string {
  const quoted = stream.replace(/"/g, '""');
  const columns = ["_timestamp", ...fields.filter((field) => field !== "_timestamp")];
  const projection = [...new Set(columns)]
    .map((field) => `"${field.replace(/"/g, '""')}"`)
    .join(", ");
  return `SELECT ${projection} FROM "${quoted}" WHERE ${where}`;
}

/**
 * The predicate back out of a detection's SQL.
 *
 * Used to re-run a stored detection over an arbitrary window from the Events
 * page, where the question is "what would this have caught yesterday" rather
 * than "is it firing now".
 */
export function whereOfDetectionSql(sql: string | null | undefined): string {
  if (!sql) return "";
  const match = /\bwhere\b/i.exec(sql);
  return match ? sql.slice(match.index + match[0].length).trim() : "";
}
