// Copyright 2026 OpenObserve Inc.

// Timeline events arrive serde-tagged ({ timestamp, type, data }); each becomes one readable line.

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { securityTime } from "@/utils/security/time";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { SeverityTone } from "./severity";

export type CaseStatus = "open" | "acknowledged" | "resolved";

export const CASE_STATUSES: CaseStatus[] = ["open", "acknowledged", "resolved"];

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

/** Closing verdicts the server accepts for a case; mirrors `CaseVerdict`. */
export const CASE_VERDICTS = [
  "true_positive",
  "false_positive",
  "benign",
  "duplicate",
  "stale",
] as const;
export type CaseVerdict = (typeof CASE_VERDICTS)[number];

/** The account the server closes cases as when no person did. */
export const SYSTEM_USER = "system@openobserve.ai";

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
    | "evidence"
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
        key: d.user_id && d.user_id !== SYSTEM_USER ? "resolved" : "autoResolved",
        actor: d.user_id && d.user_id !== SYSTEM_USER ? d.user_id : undefined,
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
        actor: d.user_id ?? undefined,
      };
    case "Verdict":
      return {
        ...base,
        kind: "status",
        icon: "fact-check",
        key: `verdict.${String(d.verdict ?? "")}`,
        body: String(d.reason ?? ""),
        actor: d.user_id,
      };
    case "DetectionJoined": {
      const from = String(d.from_severity ?? "");
      const to = String(d.to_severity ?? "");
      return {
        ...base,
        kind: "alert",
        icon: "data-info-alert",
        key: from && to && from !== to ? "detectionJoinedRaised" : "detectionJoined",
        params: {
          rule: String(d.rule || d.alert_name || ""),
          level: String(d.level || "—"),
          from,
          to,
        },
      };
    }
    case "AlertsAttached":
      return {
        ...base,
        kind: "alert",
        icon: "library-add",
        key: "alertsAttached",
        params: { names: (Array.isArray(d.alert_names) ? d.alert_names : []).join(", ") },
        actor: d.user_id,
      };
    case "EventAttached":
      return {
        ...base,
        kind: "evidence",
        icon: "manage-search",
        key: "eventAttached",
        params: {
          stream: String(d.stream ?? ""),
          at: d.event_at ? securityTime(Number(d.event_at) / 1000) : "",
        },
        actor: d.user_id,
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

/** Case-key field holding the detection id a case was opened for; it is not an entity. */
export const CASE_DETECTION_KEY = "security_detection";

/** The detection id in a case's key, if the case was opened for one detection. */
export function caseDetectionId(groupValues: unknown): string | null {
  if (!groupValues || typeof groupValues !== "object" || Array.isArray(groupValues)) return null;
  const id = (groupValues as Record<string, unknown>)[CASE_DETECTION_KEY];
  return typeof id === "string" && id ? id : null;
}

/** Correlation dimensions as label/value pairs; the server stores them as a free-form object. */
export function groupValueRows(groupValues: unknown): { key: string; value: string }[] {
  if (!groupValues || typeof groupValues !== "object" || Array.isArray(groupValues)) return [];
  return Object.entries(groupValues as Record<string, unknown>)
    .filter(([k, v]) => k !== CASE_DETECTION_KEY && v !== null && v !== undefined && v !== "")
    .map(([key, v]) => ({ key, value: typeof v === "object" ? JSON.stringify(v) : String(v) }));
}

export type CaseEntityKind = "host" | "user" | "ip";

/** The fields of a case row the queue reads its entities from. */
export interface CaseEntitySource {
  group_values?: unknown;
  entity?: string | null;
  entity_kind?: CaseEntityKind | null;
  entities?: { kind: CaseEntityKind; value: string }[];
}

export const ENTITY_ICON: Record<CaseEntityKind, IconName> = {
  host: "computer",
  user: "person",
  ip: "lan",
};

const ENTITY_KEY_ORDER: CaseEntityKind[] = ["host", "user", "ip"];

/** Every entity on a case, primary first; reads the server's list, else the case key's `security_<kind>` values. */
export function caseEntities(row: CaseEntitySource): { kind: CaseEntityKind; value: string }[] {
  const out: { kind: CaseEntityKind; value: string }[] = [];
  const add = (kind: CaseEntityKind, value: unknown) => {
    const v = typeof value === "string" ? value.trim() : "";
    if (v && !out.some((e) => e.kind === kind && e.value === v)) out.push({ kind, value: v });
  };
  if (row.entity && row.entity_kind) add(row.entity_kind, row.entity);
  for (const e of row.entities ?? []) add(e.kind, e.value);
  const gv = row.group_values;
  if (!out.length && gv && typeof gv === "object" && !Array.isArray(gv)) {
    for (const kind of ENTITY_KEY_ORDER)
      add(kind, (gv as Record<string, unknown>)[`security_${kind}`]);
  }
  return out;
}

/** The firing fields read from `IncidentWithAlerts.triggers`. */
export interface CaseTrigger {
  alert_id?: string;
  alert_name: string;
  alert_fired_at: number;
}

/** Counted from `triggers`; the response's `alerts` are definitions with no firing time. */
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

/** Span of the case's activity in microseconds; `null` when it is one moment. */
export function activitySpan(c: {
  first_alert_at?: number;
  last_alert_at?: number;
}): number | null {
  const first = Number(c.first_alert_at) || 0;
  const last = Number(c.last_alert_at) || 0;
  return first && last > first ? last - first : null;
}

/** How long the case stayed open before it was closed, in microseconds. */
export function timeToClose(c: { created_at?: number; resolved_at?: number }): number | null {
  const opened = Number(c.created_at) || 0;
  const closed = Number(c.resolved_at) || 0;
  return opened && closed > opened ? closed - opened : null;
}

/** The firing-time range to search history in: case first/last are event time, not firing time. */
export function firingRange(
  triggers: CaseTrigger[] | null | undefined,
  c: { created_at?: number; updated_at?: number; resolved_at?: number },
  slackUs: number,
): { from: string; to: string } | null {
  const fired = (triggers ?? []).map((t) => Number(t.alert_fired_at)).filter((n) => n > 0);
  const from = fired.length ? Math.min(...fired) : Number(c.created_at) || 0;
  const to = fired.length
    ? Math.max(...fired)
    : Number(c.resolved_at ?? c.updated_at ?? c.created_at) || 0;
  if (!from || !to) return null;
  return { from: String(from - slackUs), to: String(to + slackUs) };
}

/** Firings newest first. */
export function caseFirings<T extends CaseTrigger>(triggers: T[] | null | undefined): T[] {
  return [...(triggers ?? [])].sort((a, b) => b.alert_fired_at - a.alert_fired_at);
}
