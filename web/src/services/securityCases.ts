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
import type { CaseVerdict } from "@/utils/security/cases";

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

/** Most detection ids one lookup may send; the server refuses more. */
export const MAX_LOOKUP_IDS = 500;

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
  promoteEvent: (org: string, event: PromoteEvent, caseId?: string) =>
    http().post<Incident>(`/api/${org}/security/cases`, {
      event,
      ...(caseId ? { case_id: caseId } : {}),
    }),
  getSettings: (org: string) => http().get<CaseSettings>(`/api/${org}/security/cases/settings`),
  updateSettings: (org: string, settings: CaseSettings) =>
    http().put<CaseSettings>(`/api/${org}/security/cases/settings`, settings),
};

export default securityCases;
