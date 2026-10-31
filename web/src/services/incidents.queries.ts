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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import incidents, { type Incident } from "./incidents";
import type { AckAlertResponse, UnackAlertResponse } from "@/ts/interfaces/alert";
import { incidentKeys } from "./incidents.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

export const incidentsQuery = (org: string, status: string, limit: number, offset: number) =>
  queryOptions({
    queryKey: incidentKeys.list(org, status, limit, offset),
    queryFn: async () => (await incidents.list(org, status, limit, offset)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const incidentQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: incidentKeys.detail(org, id),
    queryFn: async () => (await incidents.get(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** What a status write answers: the incident when it could be read, and the one ack's answer. */
export interface IncidentStatusWrite {
  data?: Incident;
  ack?: AckAlertResponse | UnackAlertResponse;
}

/** Acknowledging, and reopening an acknowledged incident, go through the one ack; the rest is a PATCH. */
export const setIncidentStatus = (
  org: string,
  id: string,
  status: "open" | "acknowledged" | "resolved",
  from?: "open" | "acknowledged" | "resolved",
): Promise<IncidentStatusWrite> => {
  if (status === "acknowledged") return incidents.acknowledge(org, id);
  if (status === "open" && from === "acknowledged") return incidents.unacknowledge(org, id);
  return incidents.updateStatus(org, id, status);
};

/** Dropping the scope is what repaints the list: its `shouldRefresh` store flag only lands on a remount, which the drawer's back button often skips. */
export const updateIncidentStatusMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: {
      id: string;
      status: "open" | "acknowledged" | "resolved";
      from?: "open" | "acknowledged" | "resolved";
    }) => setIncidentStatus(org, vars.id, vars.status, vars.from),
    // The drawer reads the response to update its own header and toasts itself.
    meta: { invalidates: [incidentKeys.all(org)], silentError: true },
  });

export const updateIncidentMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; updates: { title?: string; severity?: string } }) =>
      incidents.updateIncident(org, vars.id, vars.updates),
    meta: { invalidates: [incidentKeys.all(org)], silentError: true },
  });
