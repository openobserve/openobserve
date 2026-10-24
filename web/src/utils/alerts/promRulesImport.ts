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

import yaml from "js-yaml";

import { priorityForSeverity } from "@/constants/alertLibrary";

const GROUPS_LINE = /^groups\s*:/;
const DURATION = /^(?:(\d+)y)?(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/;
const DURATION_UNIT_SECS = [31536000, 604800, 86400, 3600, 60, 1, 0.001];
const ANY_TEMPLATE = /\{\{[\s\S]*?\}\}/g;
const DEFAULT_SILENCE_MINUTES = 10;
const FALLBACK_NAME = "prometheus_alert";

/** A minimal OpenObserve alert the import accepts as is. */
export const ALERT_JSON_SAMPLE = JSON.stringify(
  {
    name: "error_logs_spike",
    org_id: "default",
    stream_type: "logs",
    stream_name: "default",
    is_real_time: false,
    query_condition: {
      type: "sql",
      sql: "SELECT count(*) AS errors FROM \"default\" WHERE level = 'error'",
    },
    trigger_condition: {
      period: 10,
      operator: ">=",
      threshold: 1,
      frequency: 10,
      frequency_type: "minutes",
      silence: 10,
    },
    destinations: [],
    enabled: true,
  },
  null,
  2,
);

/** A minimal Prometheus rule file the import converts. */
export const PROM_RULES_SAMPLE = `groups:
  - name: node
    rules:
      - alert: InstanceDown
        expr: up == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Instance {{ $labels.instance }} is down"
`;

export type PromRulesImportErrorCode = "invalid_yaml" | "no_groups";

/** Why a rule file could not be read at all; resolved to copy by the caller. */
export class PromRulesImportError extends Error {
  readonly code: PromRulesImportErrorCode;

  constructor(code: PromRulesImportErrorCode) {
    super(code);
    this.name = "PromRulesImportError";
    this.code = code;
  }
}

/** One per-rule note; `alert` is the final (sanitised) alert name. */
export type PromRulesImportWarning =
  | { code: "renamed"; alert: string; from: string }
  | { code: "unknown_severity"; alert: string; severity: string }
  | { code: "invalid_duration"; alert: string; field: "for" | "keep_firing_for"; value: string }
  | { code: "unmapped_template"; alert: string; text: string }
  | { code: "invalid_rule"; group: string; index: number };

export interface PromRulesImportResult {
  alerts: Record<string, unknown>[];
  /** Recording rules, which have no alert equivalent. */
  skipped: number;
  warnings: PromRulesImportWarning[];
}

export interface PromRulesImportOptions {
  orgId?: string;
}

export type ImportFormat = "json" | "yaml" | "terraform" | "unknown";

interface PendingAlert {
  base: string;
  group: string;
  source: string;
  rule: Record<string, unknown>;
  frequency: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isFiller = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === "" || trimmed === "---" || trimmed.startsWith("#");
};

const firstContentLine = (text: string): string =>
  text.split(/\r?\n/).find((line) => !isFiller(line)) ?? "";

/** A Prometheus rule file starts with a top-level `groups:` key. */
export const isPromRulesYaml = (text: string): boolean =>
  typeof text === "string" && GROUPS_LINE.test(firstContentLine(text));

/** Whole seconds in a Prometheus duration, 0 when absent, or null when unreadable. */
export const parsePromDuration = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return 0;
  // Prometheus reads a bare number only as 0; any other unitless value is an error there too.
  if (typeof value === "number") return value === 0 ? 0 : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "0") return 0;
  const match = DURATION.exec(text);
  if (!match || text === "") return null;
  const seconds = match
    .slice(1)
    .reduce((sum, part, i) => sum + (part ? Number(part) * DURATION_UNIT_SECS[i] : 0), 0);
  return Math.round(seconds);
};

// Snake case in `[a-z0-9_]`, which every alert-name rule accepts.
const toAlertName = (raw: string): string =>
  raw
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

/** Names the format a pasted text looks like, for a parse error the user can act on. */
export const detectImportFormat = (text: string): ImportFormat => {
  const head = firstContentLine(text).trim();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (/^(resource|terraform|provider|variable)\s+["{]/.test(head)) return "terraform";
  try {
    const parsed = yaml.load(text);
    if (typeof parsed === "object" && parsed !== null) return "yaml";
  } catch {
    return "unknown";
  }
  return "unknown";
};

const durationSecs = (
  rule: Record<string, unknown>,
  field: "for" | "keep_firing_for",
  alert: string,
  warnings: PromRulesImportWarning[],
): number => {
  const secs = parsePromDuration(rule[field]);
  if (secs !== null) return secs;
  warnings.push({ code: "invalid_duration", alert, field, value: String(rule[field]) });
  return 0;
};

const descriptionFor = (
  rule: Record<string, unknown>,
  alert: string,
  warnings: PromRulesImportWarning[],
): string => {
  const annotations = asRecord(rule.annotations);
  const parts = [annotations.summary, annotations.description]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim());
  // Kept verbatim: the description reaches notifications as written, never expanded per series.
  for (const snippet of parts.join("\n").match(ANY_TEMPLATE) ?? []) {
    warnings.push({ code: "unmapped_template", alert, text: snippet });
  }
  return parts.join("\n");
};

const buildAlert = (
  pending: PendingAlert,
  name: string,
  orgId: string,
  warnings: PromRulesImportWarning[],
): Record<string, unknown> => {
  const { rule, frequency } = pending;
  const alert: Record<string, unknown> = {
    name,
    org_id: orgId,
    stream_type: "metrics",
    // Empty on purpose: rule mode lets the backend infer the stream from the expression.
    stream_name: "",
    is_real_time: false,
    enabled: false,
    query_condition: {
      type: "promql",
      promql: String(rule.expr),
      promql_rule_mode: true,
      promql_multi_alert: true,
      promql_condition: null,
      conditions: null,
      sql: "",
      aggregation: null,
      vrl_function: null,
      multi_time_range: [],
    },
    trigger_condition: {
      period: frequency,
      operator: ">=",
      threshold: 1,
      frequency,
      frequency_type: "minutes",
      cron: "",
      silence: DEFAULT_SILENCE_MINUTES,
    },
    pending_period_sec: durationSecs(rule, "for", name, warnings),
    keep_firing_for: durationSecs(rule, "keep_firing_for", name, warnings),
    destinations: [],
    context_attributes: {},
    description: descriptionFor(rule, name, warnings),
  };
  const severity = asRecord(rule.labels).severity;
  if (typeof severity === "string" && severity !== "") {
    const priority = priorityForSeverity(severity.toLowerCase());
    if (priority === null) warnings.push({ code: "unknown_severity", alert: name, severity });
    else alert.priority = priority;
  }
  return alert;
};

const finalNames = (pending: PendingAlert[]): string[] => {
  const counts = new Map<string, number>();
  for (const p of pending) counts.set(p.base, (counts.get(p.base) ?? 0) + 1);
  const taken = new Set<string>();
  return pending.map((p) => {
    const suffix = toAlertName(p.group);
    const grouped = (counts.get(p.base) ?? 0) > 1 && suffix ? `${p.base}_${suffix}` : p.base;
    let name = grouped;
    for (let n = 2; taken.has(name); n++) name = `${grouped}_${n}`;
    taken.add(name);
    return name;
  });
};

const loadGroups = (text: string): unknown[] => {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    throw new PromRulesImportError("invalid_yaml");
  }
  const groups = asRecord(doc).groups;
  if (!Array.isArray(groups)) throw new PromRulesImportError("no_groups");
  return groups;
};

/** Converts a Prometheus rule file into paused rule-mode alert payloads. */
export const convertPromRules = (
  text: string,
  options: PromRulesImportOptions = {},
): PromRulesImportResult => {
  const warnings: PromRulesImportWarning[] = [];
  const pending: PendingAlert[] = [];
  let skipped = 0;

  for (const rawGroup of loadGroups(text)) {
    const group = asRecord(rawGroup);
    const groupName = typeof group.name === "string" ? group.name : "";
    const intervalSecs = parsePromDuration(group.interval) || 60;
    const frequency = Math.max(1, Math.ceil(intervalSecs / 60));
    const rules = Array.isArray(group.rules) ? group.rules : [];
    rules.forEach((rawRule, i) => {
      const rule = asRecord(rawRule);
      if (rule.record !== undefined && rule.alert === undefined) {
        skipped++;
        return;
      }
      const source = rule.alert === undefined || rule.alert === null ? "" : String(rule.alert);
      const hasExpr = rule.expr !== undefined && rule.expr !== null && String(rule.expr) !== "";
      if (source.trim() === "" || !hasExpr) {
        warnings.push({ code: "invalid_rule", group: groupName, index: i + 1 });
        return;
      }
      pending.push({
        base: toAlertName(source) || FALLBACK_NAME,
        group: groupName,
        source,
        rule,
        frequency,
      });
    });
  }

  const names = finalNames(pending);
  const alerts = pending.map((p, i) => {
    if (names[i] !== p.base) warnings.push({ code: "renamed", alert: names[i], from: p.source });
    return buildAlert(p, names[i], options.orgId ?? "", warnings);
  });
  return { alerts, skipped, warnings };
};
