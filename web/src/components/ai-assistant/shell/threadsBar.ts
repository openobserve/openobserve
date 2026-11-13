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

import type { AssistantSession } from "@/composables/assistant";
import type { Incident } from "@/services/incidents";

export type TrayState = "needsYou" | "working" | "failed" | "idle";

/** The chat's state: waiting for the person, answering, failed, or quiet. */
export function trayState(session: AssistantSession | undefined): TrayState {
  if (!session) return "idle";
  if (session.pendingApproval || session.pendingConsent) return "needsYou";
  const state = session.turn.state;
  if (state === "failed" || state === "refused") return "failed";
  if (state === "done" || state === "stopped") return "idle";
  return state === "idle" ? "idle" : "working";
}

/** The bar reads the first page of open incidents; the list API pages at this size. */
export const INCIDENT_PAGE = 50;

/** Pills shown for incidents with a live run; the rest sit behind "N more". */
export const INCIDENT_PILLS = 5;

/** Pills shown for the user's own threads. */
export const THREAD_PILLS = 5;

/** One own thread in the bar: running shows a spinner, unread a dot, waiting an approval badge. */
export interface ThreadPill {
  sid: string;
  title: string;
  signal: "running" | "unread" | "approval" | "idle";
}

export interface IncidentPills {
  shown: Incident[];
  /** Live runs past the shown pills. */
  more: number;
  /** The first page came back full, so there may be live runs past it. */
  pageFull: boolean;
}

/** Newest open incidents whose latest run is live, read from one page of the open list. */
export function liveIncidentPills(page: Incident[] | null | undefined): IncidentPills {
  const list = page ?? [];
  const live = list
    .filter((incident) => isLive(incident))
    .sort((a, b) => b.created_at - a.created_at);
  return {
    shown: live.slice(0, INCIDENT_PILLS),
    more: Math.max(live.length - INCIDENT_PILLS, 0),
    pageFull: list.length >= INCIDENT_PAGE,
  };
}

/** Waiting threads first, then running, then unread; minimised windows show in their own pills. */
export function threadPills(
  candidates: readonly ThreadPill[],
  minimised: readonly string[],
): ThreadPill[] {
  const rank = { approval: 0, running: 1, unread: 2, idle: 3 } as const;
  const seen = new Set(minimised);
  const out: ThreadPill[] = [];
  for (const pill of [...candidates].sort((a, b) => rank[a.signal] - rank[b.signal])) {
    if (seen.has(pill.sid)) continue;
    seen.add(pill.sid);
    out.push(pill);
  }
  return out.slice(0, THREAD_PILLS);
}

/** A run that is still working or waiting for a person; a stale one has stopped reporting. */
export function isLive(incident: Pick<Incident, "rca">): boolean {
  const rca = incident.rca;
  return !!rca && !rca.stale && (rca.state === "running" || rca.state === "waiting_input");
}
