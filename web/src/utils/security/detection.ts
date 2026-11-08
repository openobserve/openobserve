// Copyright 2026 OpenObserve Inc.

// A detection IS an alert, tagged via `context_attributes`, so the SIEM needs no migration or second scheduler.

import type { SigmaLevel, SigmaRule } from "./sigma";
import { parseSigmaRule, sigmaLevelToSeverity } from "./sigma";
import { quoteIdent } from "./sql";

/** The key that marks an alert as belonging to the SIEM. */
export const SIEM_MARKER = "siem";

export interface DetectionMeta {
  isSiem: boolean;
  /** The rule's own title; the alert name is a sanitised copy, so pages show this instead. */
  title: string;
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

const titleCache = new Map<string, string>();
function sigmaTitle(yaml: string): string {
  if (!yaml) return "";
  let title = titleCache.get(yaml);
  if (title === undefined) {
    const parsed = parseSigmaRule(yaml);
    title = parsed.ok ? parsed.rule.title : "";
    titleCache.set(yaml, title);
  }
  return title;
}

/** Best readable name for an alert: its Sigma title, else the name with underscores as spaces. */
export function readableAlertName(name: string, sigmaYaml = ""): string {
  return sigmaTitle(sigmaYaml) || name.replace(/_+/g, " ").trim();
}

/** Tolerant on purpose: these attributes can be hand-edited through the alerts UI or the API. */
export function detectionMetaOf(alert: Record<string, any> | null | undefined): DetectionMeta {
  const attributes = (alert?.context_attributes ?? {}) as Record<string, unknown>;
  const marker = attributes[SIEM_MARKER];
  const level = String(attributes.sigma_level ?? "").toLowerCase();

  return {
    isSiem: marker === true || marker === "true",
    title:
      String(attributes.sigma_title ?? "") ||
      readableAlertName(String(alert?.name ?? ""), String(attributes.sigma_yaml ?? "")),
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

/** Mirrors the backend's `RE_OFGA_UNSUPPORTED_NAME` substitution so the stored name matches API paths. */
export function detectionName(title: string): string {
  const cleaned = title
    .replace(/[:#?\s'"%&/\\]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return cleaned || "Untitled_detection";
}

/** Alert history carries only the name, so the same rule on two streams must not share one. */
export function detectionAlertName(title: string, stream: string): string {
  const suffix = `__${detectionName(stream)}`;
  return `${detectionName(title).slice(0, 100 - suffix.length)}${suffix}`;
}

export interface BuildDetectionInput {
  rule: SigmaRule;
  /** The compiled predicate. Must be runnable; this does not compile. */
  where: string;
  /** Columns the predicate touches, projected so a firing carries its evidence. */
  fields?: string[];
  stream: string;
  streamType?: string;
  /** The alerts API requires at least one, so the UI must ask rather than default to none. */
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

/** Fires on any matching row; a count on top would be a threshold the Sigma rule's author never wrote. */
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
    name: input.name ?? detectionAlertName(rule.title, stream),
    description: rule.description?.trim() ?? "",
    stream_type: streamType,
    stream_name: stream,
    is_real_time: false,
    enabled,
    destinations,
    // Incident correlation is enterprise-only; without it the flag is inert and firings notify directly.
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
      sigma_title: rule.title,
      sigma_yaml: rule.yaml,
      sigma_level: rule.level ?? "medium",
      sigma_logsource: logsource,
      mitre_techniques: rule.techniques.join(","),
      mitre_tactics: rule.tactics.join(","),
      source_type: sourceType,
    },
  };
}

/** No time bound here: the scheduler applies the window from `trigger_condition.period`. */
export function detectionSql(stream: string, where: string, fields: string[] = []): string {
  const columns = ["_timestamp", ...fields.filter((field) => field !== "_timestamp")];
  const projection = [...new Set(columns)].map(quoteIdent).join(", ");
  return `SELECT ${projection} FROM ${quoteIdent(stream)} WHERE ${where}`;
}

/** Lets the Events page re-run a stored detection over an arbitrary window. */
export function whereOfDetectionSql(sql: string | null | undefined): string {
  if (!sql) return "";
  // Quoted names and literals are blanked first so a 'where' inside them is never taken for the clause.
  let masked = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      masked += " ";
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      masked += " ";
    } else {
      masked += ch;
    }
  }
  const match = /\swhere\s/i.exec(masked);
  return match ? sql.slice(match.index + match[0].length).trim() : "";
}
