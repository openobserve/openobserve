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

/**
 * useDbmFleetInstances — the identity list every DBM scope picker offers.
 *
 * ## Why this is not derived from the page's rows
 *
 * Each DBM tab renders one FEED; the org has a FLEET. Building a tab's
 * instance picker from the rows that tab loaded is the bug this composable
 * removes, and it failed in three distinct ways, all of which read to a user
 * as "the filter is broken":
 *
 *   * An engine with no rows on THIS tab became unselectable. SQL Server has
 *     no session sampler, so Activity's picker omitted `mssql-prod-1` — while
 *     a chip set on Deadlocks still displayed it. The reader was left in a
 *     scope they could neither choose nor clear.
 *   * A feed that names no instance produced an EMPTY picker. Measured on the
 *     rig, the deadlocks slice named 0 of 4 engines.
 *   * A CAPPED read made the list first-page-local: activity stops at 100
 *     sampled sessions, so the offered instances were those in the first page
 *     of results, not those in the window.
 *
 * `/databases` cannot stand in for this: it is the CLIENT vantage (spans), so
 * a zero-trace org gets nothing from it while server-vantage data sits one tab
 * away. Measured across the rig orgs, `/databases` saw 2 of 4 engines on the
 * combined org and 0 of 1 on every zero-trace org.
 *
 * `/instances` is one DISTINCT over the identity columns with no kind
 * predicate, so it is complete BY CONSTRUCTION — a new feed is included
 * because it writes those columns, not because someone remembered to add it
 * to a client-side merge.
 *
 * ## One request per (org, window), shared by every tab
 *
 * Module-scoped cache, exactly like `useDbmTabCounts`: the six DBM views are
 * separate routes rendering the same strip, so a per-page fetch would issue
 * the same read six times to answer one question. The key is the org plus the
 * window the reader CHOSE (not the resolved timestamps, which move every
 * render and could never hit).
 */

import { ref, type Ref } from "vue";

import dbMonitoringService, { type DbmInstanceHit } from "@/services/db_monitoring";

/** Resolved identities, newest read wins. */
const settled = new Map<string, DbmInstanceHit[]>();
const inFlight = new Map<string, Promise<DbmInstanceHit[]>>();

/** Drop everything. For tests, so one cannot seed the next. */
export const clearDbmFleetInstances = () => {
  settled.clear();
  inFlight.clear();
};

export const dbmFleetKey = (org: string, startTime?: number, endTime?: number): string =>
  `${org}|${startTime ?? ""}|${endTime ?? ""}`;

export interface DbmFleetRequest {
  org: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Fetch the fleet for one window, joining an in-flight read for the same key
 * rather than issuing a second.
 *
 * A FAILED read resolves to an empty list and is NOT cached: an empty picker
 * and a failed one look identical to the reader, so the next tab must get a
 * fresh attempt rather than inherit a failure as though it were an answer.
 */
export const loadDbmFleetInstances = (req: DbmFleetRequest): Promise<DbmInstanceHit[]> => {
  const key = dbmFleetKey(req.org, req.startTime, req.endTime);
  const held = settled.get(key);
  if (held) return Promise.resolve(held);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = dbMonitoringService
    .getInstances(req.org, { startTime: req.startTime, endTime: req.endTime })
    .then((res) => {
      const hits = res?.data?.hits ?? [];
      settled.set(key, hits);
      return hits;
    })
    .catch(() => [] as DbmInstanceHit[])
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
};

export interface DbmFleetInstancesReturn {
  hits: Ref<DbmInstanceHit[]>;
  load: (req: DbmFleetRequest) => Promise<void>;
}

export function useDbmFleetInstances(): DbmFleetInstancesReturn {
  const hits = ref<DbmInstanceHit[]>([]);
  const load = async (req: DbmFleetRequest): Promise<void> => {
    if (!req.org) return;
    hits.value = await loadDbmFleetInstances(req);
  };
  return { hits, load };
}
