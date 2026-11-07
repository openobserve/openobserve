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

import type { OverviewNowRow } from "@/composables/contextProviders/types";
import type { Incident } from "@/services/incidents";

/** The section lists at most this many changes. */
export const SINCE_LAST_VISIT_CAP = 6;

const THREAD_KIND = {
  done: "thread_finished",
  stopped: "thread_stopped",
  failed: "thread_failed",
  none: "thread_updated",
} as const;

export type SinceKind =
  | "incident_opened"
  | "incident_resolved"
  | "alert_fired"
  | "thread_finished"
  | "thread_stopped"
  | "thread_failed"
  | "thread_updated"
  | "approval_waiting";

/** How a thread's last turn ended; null when this tab never loaded it, so nothing is claimed. */
export type SinceThreadEnd = "done" | "stopped" | "failed" | null;

/** One change since the user last left Home; `at` is in milliseconds. */
export interface SinceItem {
  key: string;
  kind: SinceKind;
  title: string;
  at: number;
  /** The thread a thread item opens, or the incident an incident item opens. */
  target: string;
}

/** The fields of a history row the section reads. */
export interface SinceThread {
  sid: string;
  title: string;
  /** Milliseconds. */
  updatedAt: number;
  activeTurn: boolean;
  pendingApproval: boolean;
  ended: SinceThreadEnd;
}

export interface SinceInput {
  /** Milliseconds; null on the first visit, when nothing is compared. */
  since: number | null;
  incidents: { open: Incident[]; acknowledged: Incident[]; resolved: Incident[] } | null;
  rows: readonly OverviewNowRow[];
  threads: readonly SinceThread[];
}

/** Incidents opened or resolved, alerts that started firing, own threads that ended or changed, and approvals waiting. */
export function sinceLastVisit(input: SinceInput): SinceItem[] {
  const since = input.since;
  if (since === null) return [];
  const sinceUs = since * 1000;
  const items: SinceItem[] = [];
  const lists = input.incidents;
  for (const incident of [...(lists?.open ?? []), ...(lists?.acknowledged ?? [])]) {
    if (incident.created_at > sinceUs) items.push(incidentItem(incident, "incident_opened"));
  }
  for (const incident of lists?.resolved ?? []) {
    if ((incident.resolved_at ?? 0) > sinceUs)
      items.push(incidentItem(incident, "incident_resolved"));
  }
  for (const row of input.rows) {
    if (row.kind === "alert" && row.state === "firing" && row.lastAt > sinceUs) {
      items.push({
        key: `alert:${row.alertId}`,
        kind: "alert_fired",
        title: row.name,
        at: Math.floor(row.lastAt / 1000),
        target: row.alertId,
      });
    }
  }
  for (const thread of input.threads) {
    if (thread.pendingApproval) items.push(threadItem(thread, "approval_waiting"));
    else if (!thread.activeTurn && thread.updatedAt > since)
      items.push(threadItem(thread, THREAD_KIND[thread.ended ?? "none"]));
  }
  // Waiting approvals lead: they are the only items that block someone.
  return items
    .sort(
      (a, b) =>
        Number(b.kind === "approval_waiting") - Number(a.kind === "approval_waiting") ||
        b.at - a.at,
    )
    .slice(0, SINCE_LAST_VISIT_CAP);
}

function incidentItem(incident: Incident, kind: SinceKind): SinceItem {
  const atUs = kind === "incident_resolved" ? (incident.resolved_at ?? 0) : incident.created_at;
  return {
    key: `${kind}:${incident.id}`,
    kind,
    title: incident.title ?? incident.id,
    at: Math.floor(atUs / 1000),
    target: incident.id,
  };
}

function threadItem(thread: SinceThread, kind: SinceKind): SinceItem {
  return {
    key: `${kind}:${thread.sid}`,
    kind,
    title: thread.title,
    at: thread.updatedAt,
    target: thread.sid,
  };
}
