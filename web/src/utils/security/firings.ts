// Copyright 2026 OpenObserve Inc.
//
// firings.ts — how one alert-history row reads on the SIEM Alerts page.
//
// The history API normalises `status`; everything here only decides how that
// verdict is labelled and coloured, and how the evidence window is described.

import { isErrorOutcome, isFiringOutcome } from "@/utils/alerts/runOutcome";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { SeverityTone } from "./severity";
import type { HistoryRow } from "./history";

/** A history row with the optional fields the Alerts page reads. */
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

/** OTag variant per status: a firing is the loud one, a normal run the calm one. */
export const STATUS_VARIANT: Record<FiringStatus, BadgeVariant> = {
  firing: "error-soft",
  notify_failed: "orange-soft",
  error: "amber-soft",
  normal: "success-soft",
  skipped: "default-soft",
  other: "default-soft",
};

/**
 * Tone for a row with no SIEM detection behind it. The row's own `level` is
 * the threshold that matched ("critical" | "warning" | "ok"), which is the
 * closest thing an ordinary alert has to a severity.
 */
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

/**
 * A readable one-paragraph version of a scheduler error. Notification failures
 * embed the destination's whole HTML error page; the tags and whitespace are
 * noise, and the full text stays available in the raw history row.
 */
export function summarizeError(text: string | null | undefined, max = 280): string {
  const plain = String(text ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
