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

import http from "./http";
import type { Incident } from "./incidents";
import type { CaseStatus, CaseVerdict } from "@/utils/security/cases";

/** The open case a detection currently fires into. */
export interface CaseRef {
  id: string;
  title?: string | null;
  status: "open" | "acknowledged" | "resolved";
  severity: string;
}

export interface CaseSettings {
  /** Days without a firing before a case closes on its own; 0 never closes one. */
  auto_close_days: number;
  /** Minutes in which firings on one host or user join one case; 0 opens one case per detection. */
  group_window_minutes: number;
  /** P3/P4 firings join one case per detection; absent means true. */
  roll_up_low_priority?: boolean;
}

export interface PromoteFiring {
  alert_id: string;
  /** Microseconds. */
  fired_at: number;
}

/** One event to open a case from; its host, user or address becomes the case's entity. */
export interface PromoteEvent {
  stream: string;
  /** The event's `_timestamp`, in microseconds. */
  timestamp: number;
  fields: Record<string, unknown>;
}

export type CaseEntityKind = "user" | "host" | "ip";

/** What the analyst confirmed when opening a case from an event; all optional. */
export interface PromoteEventOptions {
  caseId?: string;
  title?: string;
  priority?: "P1" | "P2" | "P3" | "P4";
  entities?: { kind: CaseEntityKind; value: string }[];
  note?: string;
}

/** Most detection ids one lookup may send; the server refuses more. */
export const MAX_LOOKUP_IDS = 500;

/** Most cases one bulk update takes, and the cap on a "select all matching" id list. */
export const MAX_BULK_IDS = 1000;

/** Most cases one merge folds into its target. */
export const MAX_MERGE_SOURCES = 100;

export type CasePriority = "P1" | "P2" | "P3" | "P4";

/** Filters of the server-side case search; an absent filter matches every case. */
export interface CaseSearchFilters {
  status?: CaseStatus[];
  priority?: CasePriority[];
  /** Detection ids; a case matches any of them. */
  alert_id?: string[];
  /** Host, user or address value on the case. */
  entity?: string;
  /** Assignee email, or `none` for unassigned cases. */
  assignee?: string;
  q?: string;
}

export interface CaseSearchParams extends CaseSearchFilters {
  limit?: number;
  offset?: number;
  /** Also returns the id of every match, up to MAX_BULK_IDS. */
  select_all?: boolean;
}

export interface CaseEntity {
  kind: CaseEntityKind;
  value: string;
}

/** A search row: the case plus the entities and detection count the queue shows. */
export interface CaseRow extends Incident {
  /** The primary entity; null on a rolled-up case, whose absorbed entities are in `entities`. */
  entity?: string | null;
  entity_kind?: CaseEntityKind | null;
  /** Every entity the case holds, primary first. */
  entities?: CaseEntity[];
  /** Distinct detections that fired into the case. */
  detections?: number;
  /** When another detection last joined the case while someone worked it, in microseconds. */
  last_detection_at?: number | null;
}

/** A detection with cases matching the current filters, and how many. */
export interface DetectionFacet {
  alert_id: string;
  alert_name: string;
  title?: string | null;
  count: number;
}

export interface CaseSearchResult {
  incidents: CaseRow[];
  total: number;
  /** Every matching id, only when `select_all` was asked. */
  ids?: string[];
  /** True when `ids` stopped at the cap. */
  capped: boolean;
  /** Detections with cases under the filters other than `alert_id`; absent on older servers. */
  detection_facets?: DetectionFacet[];
}

export type BulkCaseAction = "close" | "assign" | "priority" | "status";

export interface BulkCaseUpdate {
  ids: string[];
  action: BulkCaseAction;
  verdict?: CaseVerdict;
  reason?: string;
  /** Empty string unassigns. */
  assigned_to?: string;
  severity?: CasePriority;
  status?: CaseStatus;
  /** Close only: P1/P2 cases are skipped unless this is set. */
  include_high?: boolean;
  /** Close as benign only: suppress similar firings for this long after closing. */
  suppress_minutes?: number;
}

export type BulkOutcome = "updated" | "failed" | "skipped";

export interface BulkCaseResult {
  updated: string[];
  failed: { id: string; error: string }[];
  /** P1/P2 cases a close left open because `include_high` was not set. */
  skipped?: { id: string; priority: CasePriority; entity?: string | null; reason: string }[];
  /** Per-case outcome; a suppression failure is an `error` on an updated row. */
  results?: { id: string; outcome: BulkOutcome; priority?: CasePriority; error?: string }[];
}

export interface CaseMerge {
  target_id: string;
  source_ids: string[];
  reason?: string;
}

/** "Suppress similar": the server derives the detections and entity from the case. */
export interface SuppressFromCase {
  case_id: string;
  duration_minutes: number;
  reason: string;
  close_case: boolean;
}

export interface Suppression {
  id: string;
  alert_id: string | null;
  entity_kind: "host" | "user" | "ip";
  entity_value: string;
  /** Microseconds. */
  until: number;
  reason: string;
  created_by: string;
  created_at: number;
  case_id?: string;
}

/** Query-string form of a search: lists comma-joined, empty filters left out. */
export function searchQueryOf(params: CaseSearchParams): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (params.status?.length) out.status = params.status.join(",");
  if (params.priority?.length) out.priority = params.priority.join(",");
  if (params.alert_id?.length) out.alert_id = params.alert_id.join(",");
  for (const key of ["entity", "assignee", "q"] as const) {
    const value = params[key]?.trim();
    if (value) out[key] = value;
  }
  if (params.limit !== undefined) out.limit = params.limit;
  if (params.offset !== undefined) out.offset = params.offset;
  if (params.select_all) out.select_all = true;
  return out;
}

const securityCases = {
  close: (org: string, id: string, verdict: CaseVerdict, reason: string) =>
    http().patch<Incident>(`/api/v2/${org}/alerts/incidents/${id}/update`, {
      status: "resolved",
      verdict,
      reason,
    }),
  assign: (org: string, id: string, assignedTo: string) =>
    http().patch<Incident>(`/api/v2/${org}/alerts/incidents/${id}/update`, {
      assigned_to: assignedTo,
    }),
  lookup: (org: string, alertIds: string[]) =>
    http().get<{ cases: Record<string, CaseRef> }>(`/api/${org}/security/cases/by_alert`, {
      params: { alert_ids: alertIds.slice(0, MAX_LOOKUP_IDS).join(",") },
    }),
  promote: (org: string, firings: PromoteFiring[], caseId?: string, title?: string) =>
    http().post<Incident>(`/api/${org}/security/cases`, {
      firings,
      ...(caseId ? { case_id: caseId } : {}),
      ...(title ? { title } : {}),
    }),
  promoteEvent: (org: string, event: PromoteEvent, options: PromoteEventOptions = {}) =>
    http().post<Incident>(`/api/${org}/security/cases`, {
      event,
      ...(options.caseId ? { case_id: options.caseId } : {}),
      ...(options.title?.trim() ? { title: options.title.trim() } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
      ...(options.entities?.length ? { entities: options.entities } : {}),
      ...(options.note?.trim() ? { note: options.note.trim() } : {}),
    }),
  searchCases: (org: string, params: CaseSearchParams) =>
    http().get<CaseSearchResult>(`/api/${org}/security/cases/search`, {
      params: searchQueryOf(params),
    }),
  bulkUpdate: (org: string, body: BulkCaseUpdate) =>
    http().post<BulkCaseResult>(`/api/${org}/security/cases/bulk`, {
      ...body,
      ids: body.ids.slice(0, MAX_BULK_IDS),
    }),
  mergeCases: (org: string, body: CaseMerge) =>
    http().post<Incident>(`/api/${org}/security/cases/merge`, body),
  suppress: (org: string, body: SuppressFromCase) =>
    http().post<{ suppressions: Suppression[] }>(`/api/${org}/security/suppressions`, body),
  listSuppressions: (org: string) =>
    http().get<{ suppressions: Suppression[] }>(`/api/${org}/security/suppressions`),
  deleteSuppression: (org: string, id: string) =>
    http().delete(`/api/${org}/security/suppressions/${encodeURIComponent(id)}`),
  getSettings: (org: string) => http().get<CaseSettings>(`/api/${org}/security/cases/settings`),
  updateSettings: (org: string, settings: CaseSettings) =>
    http().put<CaseSettings>(`/api/${org}/security/cases/settings`, settings),
};

export default securityCases;
