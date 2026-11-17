// Copyright 2026 OpenObserve Inc.

import { isErrorOutcome, isFiringOutcome } from "@/utils/alerts/runOutcome";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { SeverityTone } from "./severity";
import type { HistoryRow } from "./history";
import type { NormalizedEvent } from "./ocsf";

export interface FiringRow extends HistoryRow {
  threshold_value?: number | null;
  group_label?: string | null;
  value_is_lower_bound?: boolean | null;
  dedup_suppressed?: boolean | null;
  query_took?: number | null;
  retries?: number | null;
}

export type FiringStatus = "firing" | "notify_failed" | "error" | "normal" | "skipped" | "other";

export function firingStatus(status: string | null | undefined): FiringStatus {
  const s = String(status ?? "").toLowerCase();
  if (s === "notify_failed") return "notify_failed";
  if (isFiringOutcome(s)) return "firing";
  if (isErrorOutcome(s)) return "error";
  if (s === "normal" || s === "succeeded" || s === "ok") return "normal";
  if (s === "skipped") return "skipped";
  return "other";
}

export const STATUS_VARIANT: Record<FiringStatus, BadgeVariant> = {
  firing: "error-soft",
  notify_failed: "orange-soft",
  error: "amber-soft",
  normal: "success-soft",
  skipped: "default-soft",
  other: "default-soft",
};

/** A row's `level` is the threshold that matched, the closest an ordinary alert has to a severity. */
export function toneOfHistoryLevel(level: string | null | undefined): SeverityTone {
  switch (String(level ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "warning":
      return "medium";
    default:
      return "unknown";
  }
}

/** "112 ≥ 100", "≥ 50" for a lower bound, or the bare value; "" when unknown. */
export function valueVsThreshold(row: FiringRow): string {
  if (row.actual_value === null || row.actual_value === undefined) return "";
  const value = `${row.value_is_lower_bound ? "≥ " : ""}${formatNumber(row.actual_value)}`;
  if (row.threshold_value === null || row.threshold_value === undefined) return value;
  const op = OPERATORS[String(row.threshold_operator ?? "")] ?? row.threshold_operator ?? "";
  return `${value} ${op} ${formatNumber(row.threshold_value)}`.replace(/\s+/g, " ").trim();
}

const OPERATORS: Record<string, string> = {
  ">=": "≥",
  "<=": "≤",
  ">": ">",
  "<": "<",
  "=": "=",
  "==": "=",
  "!=": "≠",
  GreaterThanEquals: "≥",
  LessThanEquals: "≤",
  GreaterThan: ">",
  LessThan: "<",
  Equal: "=",
  NotEqual: "≠",
};

function formatNumber(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Evaluation window length in whole minutes (µs inputs); null when unknown. */
export function windowMinutes(row: Pick<HistoryRow, "start_time" | "end_time">): number | null {
  if (!row.start_time || !row.end_time || row.end_time <= row.start_time) return null;
  return Math.max(1, Math.round((row.end_time - row.start_time) / 60_000_000));
}

/** Stable identity for a history row in a URL: name + timestamp is unique per evaluation. */
export function firingKey(row: Pick<HistoryRow, "alert_name" | "timestamp">): string {
  return `${row.timestamp}:${row.alert_name}`;
}

/** Notification failures embed a whole HTML error page; its tags and whitespace are noise. */
export function summarizeError(text: string | null | undefined, max = 280): string {
  const plain = String(text ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** The column a value-count rule counts distinct values of, read from its evidence SQL's `PARTITION BY`. */
export function evidenceValueField(sql: string | null | undefined): string | null {
  const match = /PARTITION BY\s+"((?:[^"]|"")+)"/i.exec(sql ?? "");
  return match ? match[1].replace(/""/g, '"') : null;
}

/** One evidence row as a line; a value-count rule's counted value (the country, for impossible travel) follows the actor. */
export function evidenceSummary(ev: NormalizedEvent, valueField: string | null = null): string {
  const counted = valueField ? ev.raw[valueField] : undefined;
  const parts = [
    ev.actor,
    counted == null ? "" : String(counted),
    ev.srcIp,
    ev.activity || ev.operation,
    ev.message,
  ];
  return [...new Set(parts.filter(Boolean))].join(" · ");
}

export type EvidenceFieldKey = "actor" | "counted" | "src" | "dst" | "action" | "object" | "host";

export interface EvidenceField {
  key: EvidenceFieldKey;
  /** The raw column the value came from, when read straight off the row. */
  column: string | null;
  value: string;
}

/** Raw column names that carry each key field across vendors, for rows no source mapping explains. */
const RAW_FIELD_PATTERNS: [Exclude<EvidenceFieldKey, "counted">, RegExp][] = [
  [
    "actor",
    /^(user(_?name|_?id|principalname)?|username|account(_?name)?|actor(_?\w+)?|principal(_?\w+)?|login|email|subject_?user_?name|target_?user_?name|useridentity_?arn)$/i,
  ],
  [
    "src",
    /^(src(_?ip|_?addr(ess)?)?|source(_?ip|_?address)?|client(_?ip|_?address)?|ip_?address|remote_?addr|c_?ip|callerip)$/i,
  ],
  ["dst", /^(dst(_?ip|_?addr(ess)?)?|dest(_?ip)?|destination(_?ip|_?address)?|server_?ip|s_?ip)$/i],
  [
    "action",
    /^(action|event_?name|operation(_?name)?|activity(_?name)?|event_?id|event_?type|method|verb|request_?method|result_?type)$/i,
  ],
  [
    "object",
    /^(resource(_?name|_?type)?|object(_?name)?|target(_?resource)?|url|uri|request_?uri|path|file_?name|target_?filename|process_?name|image|command_?line|query|query_?name)$/i,
  ],
  ["host", /^(host(_?name)?|computer(_?name)?|device(_?name)?|workstation(_?name)?)$/i],
];

const scalarText = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return "";
  return String(value);
};

const isInternal = (column: string) => column.startsWith("_") || column.startsWith("zo_");

/** A row's key fields for its source (actor, src → dst, action, object), falling back to its raw column names. */
export function evidenceKeyFields(
  ev: NormalizedEvent,
  valueField: string | null = null,
): EvidenceField[] {
  const counted = valueField ? scalarText(ev.raw[valueField]) : "";
  const join = (ip: string, port: string) => (ip && port ? `${ip}:${port}` : ip);
  const mapped: EvidenceField[] = [
    { key: "actor" as const, column: null, value: ev.actor },
    { key: "counted" as const, column: valueField, value: counted },
    { key: "src" as const, column: null, value: join(ev.srcIp, ev.srcPort) },
    { key: "dst" as const, column: null, value: join(ev.dstIp, ev.dstPort) },
    { key: "action" as const, column: null, value: ev.activity || ev.operation },
    { key: "object" as const, column: null, value: ev.resource || ev.process },
    { key: "host" as const, column: null, value: ev.host },
  ].filter((f) => f.value);
  const have = new Set(mapped.map((f) => f.key));
  const columns = Object.keys(ev.raw).filter((c) => !isInternal(c) && c !== valueField);
  for (const [key, pattern] of RAW_FIELD_PATTERNS) {
    if (have.has(key)) continue;
    const column = columns.find((c) => pattern.test(c) && scalarText(ev.raw[c]));
    if (column) {
      mapped.push({ key, column, value: scalarText(ev.raw[column]) });
      have.add(key);
    }
  }
  const order: EvidenceFieldKey[] = ["actor", "counted", "src", "dst", "action", "object", "host"];
  return mapped.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** Up to `limit` populated columns, for a row neither the source map nor the name patterns explain. */
export function evidenceFallbackFields(
  raw: Record<string, unknown>,
  limit = 4,
): { column: string; value: string }[] {
  return Object.keys(raw)
    .filter((c) => !isInternal(c) && scalarText(raw[c]))
    .slice(0, limit)
    .map((column) => ({ column, value: scalarText(raw[column]) }));
}
