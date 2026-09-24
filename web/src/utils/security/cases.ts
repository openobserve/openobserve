// Copyright 2026 OpenObserve Inc.
//
// cases.ts — incidents as the SIEM Cases page reads them.
//
// A case is an OpenObserve incident: correlated firings with a status an
// analyst moves along. The timeline arrives as serde-tagged events
// ({ timestamp, type, data }); this file turns each into one readable line.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { SeverityTone } from "./severity";

export type CaseStatus = "open" | "acknowledged" | "resolved";

export const CASE_STATUSES: CaseStatus[] = ["open", "acknowledged", "resolved"];

/** P1–P4 → tone, so a P1 case reads with the same red as a critical detection. */
export function toneOfPriority(priority: string | null | undefined): SeverityTone {
  switch (String(priority ?? "").toUpperCase()) {
    case "P1":
      return "critical";
    case "P2":
      return "high";
    case "P3":
      return "medium";
    case "P4":
      return "low";
    default:
      return "unknown";
  }
}

export const STATUS_VARIANT: Record<CaseStatus, BadgeVariant> = {
  open: "error-soft",
  acknowledged: "warning-soft",
  resolved: "success-soft",
};

/** Transitions offered from each status; mirrors the server's status enum. */
export const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  open: ["acknowledged", "resolved"],
  acknowledged: ["resolved", "open"],
  resolved: ["open"],
};

export interface IncidentEventRaw {
  timestamp: number;
  type?: string;
  data?: Record<string, any> | null;
  [key: string]: unknown;
}

export interface TimelineEntry {
  timestamp: number;
  kind:
    | "created"
    | "alert"
    | "severity"
    | "status"
    | "comment"
    | "title"
    | "assignment"
    | "analysis"
    | "other";
  icon: IconName;
  /** i18n key under siem.cases.event and its params. */
  key: string;
  params: Record<string, string | number>;
  /** Free text written by a person (comments), shown as-is. */
  body?: string;
  actor?: string;
}

/** One readable timeline line per server event; unknown types are kept, not dropped. */
export function toTimelineEntry(event: IncidentEventRaw): TimelineEntry {
  const d = (event.data ?? {}) as Record<string, any>;
  const base = {
    timestamp: Number(event.timestamp) || 0,
    params: {} as Record<string, string | number>,
  };
  switch (event.type) {
    case "Created":
      return { ...base, kind: "created", icon: "add-circle-outline", key: "created" };
    case "Alert":
      return {
        ...base,
        kind: "alert",
        icon: "notifications-active",
        key: "alert",
        params: { name: String(d.alert_name ?? ""), n: Number(d.count ?? 1) },
      };
    case "SeverityUpgrade":
      return {
        ...base,
        kind: "severity",
        icon: "trending-up",
        key: "severityUpgrade",
        params: {
          from: String(d.from ?? ""),
          to: String(d.to ?? ""),
          reason: String(d.reason ?? ""),
        },
      };
    case "SeverityOverride":
      return {
        ...base,
        kind: "severity",
        icon: "tune",
        key: "severityOverride",
        params: { from: String(d.from ?? ""), to: String(d.to ?? "") },
        actor: d.user_id,
      };
    case "Acknowledged":
      return { ...base, kind: "status", icon: "visibility", key: "acknowledged", actor: d.user_id };
    case "Resolved":
      return {
        ...base,
        kind: "status",
        icon: "task-alt",
        key: d.user_id ? "resolved" : "autoResolved",
        actor: d.user_id ?? undefined,
      };
    case "Reopened":
      return {
        ...base,
        kind: "status",
        icon: "replay",
        key: "reopened",
        params: { reason: String(d.reason ?? "") },
        actor: d.user_id,
      };
    case "TitleChanged":
      return {
        ...base,
        kind: "title",
        icon: "edit",
        key: "titleChanged",
        params: { to: String(d.to ?? "") },
        actor: d.user_id,
      };
    case "AssignmentChanged":
      return {
        ...base,
        kind: "assignment",
        icon: "person",
        key: d.to ? "assigned" : "unassigned",
        params: { to: String(d.to ?? "") },
      };
    case "Comment":
      return {
        ...base,
        kind: "comment",
        icon: "chat",
        key: "comment",
        body: String(d.comment ?? ""),
        actor: d.user_id,
      };
    case "ai_analysis_begin":
      return { ...base, kind: "analysis", icon: "psychology", key: "analysisBegin" };
    case "ai_analysis_complete":
      return { ...base, kind: "analysis", icon: "psychology", key: "analysisComplete" };
    case "ai_analysis_failed":
      return {
        ...base,
        kind: "analysis",
        icon: "error-outline",
        key: "analysisFailed",
        params: { reason: String(d.reason ?? "") },
      };
    case "ai_analysis_cancelled":
      return { ...base, kind: "analysis", icon: "cancel", key: "analysisCancelled" };
    default:
      return {
        ...base,
        kind: "other",
        icon: "info-outline",
        key: "other",
        params: { type: String(event.type ?? "") },
      };
  }
}

/** Newest first, the order a timeline is read in during an incident. */
export function toTimeline(events: IncidentEventRaw[] | null | undefined): TimelineEntry[] {
  return (events ?? []).map(toTimelineEntry).sort((a, b) => b.timestamp - a.timestamp);
}

/** Correlation dimensions as label/value pairs; the server stores them as a free-form object. */
export function groupValueRows(groupValues: unknown): { key: string; value: string }[] {
  if (!groupValues || typeof groupValues !== "object" || Array.isArray(groupValues)) return [];
  return Object.entries(groupValues as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([key, v]) => ({ key, value: typeof v === "object" ? JSON.stringify(v) : String(v) }));
}

/** The firing fields read from `IncidentWithAlerts.triggers`. */
export interface CaseTrigger {
  alert_name: string;
  alert_fired_at: number;
}

/**
 * Distinct detections behind a case, busiest first. Counted from `triggers`
 * (one entry per firing); the response's `alerts` are alert definitions and
 * carry no firing time, so they are not a firing count.
 */
export function caseDetections(
  triggers: CaseTrigger[] | null | undefined,
): { alertName: string; count: number; last: number }[] {
  const seen = new Map<string, { alertName: string; count: number; last: number }>();
  for (const t of triggers ?? []) {
    if (!t?.alert_name) continue;
    const entry = seen.get(t.alert_name) ?? { alertName: t.alert_name, count: 0, last: 0 };
    entry.count += 1;
    entry.last = Math.max(entry.last, Number(t.alert_fired_at) || 0);
    seen.set(t.alert_name, entry);
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

/** Firings newest first. */
export function caseFirings<T extends CaseTrigger>(triggers: T[] | null | undefined): T[] {
  return [...(triggers ?? [])].sort((a, b) => b.alert_fired_at - a.alert_fired_at);
}
