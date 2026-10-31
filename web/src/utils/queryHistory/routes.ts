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

import type { Router } from "vue-router";
import type { HistorySource, QueryHistoryEntry } from "@/services/query_history";
import { logsRouteQuery } from "./logs";
import { metricsRouteQuery } from "./metrics";
import { tracesRouteQuery } from "./traces";
import type { RestoreTime } from "./recentSearches";

export interface RecentSearchRoute {
  path: string;
  query: Record<string, string>;
}

/** `run` and `load` restore the row on its page; `link` is a shareable URL the page opens as any landing. */
export type RecentRouteMode = "run" | "load" | "link";

// History state, not the URL, so a copied or shared link never carries the restore.
const LANDING_STATE_KEY = "recentRestore";
const LANDING_TTL_MS = 30_000;

interface RecentLanding {
  source: HistorySource;
  run: boolean;
  at: number;
}

// In memory, so a reload, a bookmark or a shared link never repeats a restore or records a run.
const pendingLandings = new Map<string, RecentLanding>();
let landingSeq = 0;

/** Where a row reopens; a restore also replaces whatever the page had cached. */
export const recentSearchRoute = (
  entry: QueryHistoryEntry,
  when: RestoreTime,
  orgId: string,
  mode: RecentRouteMode,
): RecentSearchRoute | null => {
  if (entry.source === "logs") {
    return { path: "/logs", query: logsRouteQuery(entry, when, orgId, mode !== "link") };
  }
  if (entry.source === "traces") {
    return { path: "/traces", query: { ...tracesRouteQuery(entry, when, orgId), reload: "true" } };
  }
  if (entry.source === "metrics") {
    const query = metricsRouteQuery(entry, when, orgId);
    return query ? { path: "/metrics", query } : null;
  }
  return null;
};

/** Opens another page's row on that page, which runs it only when `run` is set. */
export const openRecentOnItsPage = (
  router: Router,
  entry: QueryHistoryEntry,
  when: RestoreTime,
  orgId: string,
  run: boolean,
) => {
  const route = recentSearchRoute(entry, when, orgId, run ? "run" : "load");
  if (!route) return;
  landingSeq += 1;
  const nonce = `${Date.now()}-${landingSeq}`;
  pendingLandings.set(nonce, { source: entry.source, run, at: Date.now() });
  const drop = () => pendingLandings.delete(nonce);
  return router.push({ ...route, state: { [LANDING_STATE_KEY]: nonce } }).then((failure) => {
    if (failure) drop();
  }, drop);
};

/** The restore this navigation was pushed for, once; null for any other landing, which leaves other restores pending. */
export const takeRecentLanding = (source: HistorySource): { run: boolean } | null => {
  const now = Date.now();
  for (const [nonce, landing] of pendingLandings) {
    if (now - landing.at > LANDING_TTL_MS) pendingLandings.delete(nonce);
  }
  const nonce: unknown = window.history.state?.[LANDING_STATE_KEY];
  const landing = typeof nonce === "string" ? pendingLandings.get(nonce) : undefined;
  if (!landing || landing.source !== source) return null;
  pendingLandings.delete(nonce as string);
  return { run: landing.run };
};
