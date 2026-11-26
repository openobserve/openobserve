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
import incidents, { type Incident, type IncidentListParams } from "./incidents";
import type { AckAlertResponse, UnackAlertResponse } from "@/ts/interfaces/alert";
import { incidentKeys } from "./incidents.querykeys";
import { oneAckScopes } from "./alerts.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

export const incidentsQuery = (org: string, status: string, limit: number, offset: number) =>
  queryOptions({
    queryKey: incidentKeys.list(org, status, limit, offset),
    queryFn: async () => (await incidents.list(org, status, limit, offset)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const incidentListQuery = (org: string, params: IncidentListParams) =>
  queryOptions({
    queryKey: incidentKeys.page(org, params),
    queryFn: async () => (await incidents.listPage(org, params)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const incidentQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: incidentKeys.detail(org, id),
    queryFn: async () => (await incidents.get(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

/** One incident's events, oldest first: alerts, acknowledges, resolves, comments, analyses. */
export interface IncidentEvent {
  timestamp: number;
  /** The timeline's `seq` after the write that added this event; absent on older events. */
  seq?: number;
  type: string;
  data?: { user_id?: string | null; reason?: string | null } & Record<string, unknown>;
}

/** The cached page: the events and the `seq` they were read at, sent back as `If-None-Match`. */
interface IncidentEventsPage {
  events: IncidentEvent[];
  seq?: number;
}

/** How often an open drawer re-reads the timeline; TanStack skips the tick while the tab is hidden. */
export const INCIDENT_EVENTS_POLL_MS = 30_000;

export const incidentEventsQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: incidentKeys.events(org, id),
    queryFn: async ({ client, queryKey }): Promise<IncidentEventsPage> => {
      const cached = client.getQueryData<IncidentEventsPage>(queryKey);
      const res = await incidents.getEvents(org, id, cached?.seq);
      if (res.status === 304 && cached) return cached;
      return { events: res.data?.events ?? [], seq: res.data?.seq };
    },
    // A removal (an alert moved out) has no cursor, so the list is replaced on every 200.
    select: (page): IncidentEvent[] => page.events,
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
    meta: { invalidates: oneAckScopes(org), silentError: true },
  });

export const updateIncidentMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; updates: { title?: string; severity?: string } }) =>
      incidents.updateIncident(org, vars.id, vars.updates),
    meta: { invalidates: [incidentKeys.all(org)], silentError: true },
  });
