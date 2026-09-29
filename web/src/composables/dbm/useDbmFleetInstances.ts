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
 * The six DBM views are separate routes rendering the same strip, so a
 * per-page fetch would issue the same read six times to answer one question.
 * The cache entry is what collapses them; its key buckets the window, because
 * every page re-pins its anchor to the microsecond on load and an unbucketed
 * key could never hit.
 */

import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import { type DbmInstanceHit } from "@/services/db_monitoring";
import { dbmInstancesQuery } from "@/services/db_monitoring.queries";

export interface DbmFleetRequest {
  org: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Fetch the fleet for one window. Identical keys share one in-flight request,
 * so the six DBM routes still cost a single read between them.
 *
 * A FAILED read resolves to an empty list and is NOT cached: an empty picker
 * and a failed one look identical to the reader, so the next tab must get a
 * fresh attempt rather than inherit a failure as though it were an answer. The
 * caller has no error surface — the picker falls back to the rows-derived list.
 */
export const loadDbmFleetInstances = (req: DbmFleetRequest): Promise<DbmInstanceHit[]> =>
  queryClient
    .fetchQuery(dbmInstancesQuery(req.org, req.startTime, req.endTime))
    .catch(() => [] as DbmInstanceHit[]);

export interface DbmFleetInstancesReturn {
  hits: Ref<DbmInstanceHit[]>;
  load: (req: DbmFleetRequest) => Promise<void>;
}

// Every mounted picker, so a page's Refresh can reach a read it does not own.
const mounted = new Set<() => void>();

/// What the DBM Refresh button calls: every mounted picker re-reads its fleet from the server.
export const refreshDbmFleet = (): void => {
  for (const rerun of mounted) rerun();
};

export function useDbmFleetInstances(): DbmFleetInstancesReturn {
  const hits = ref<DbmInstanceHit[]>([]);
  let lastRequest: DbmFleetRequest | null = null;
  const load = async (req: DbmFleetRequest, force = false): Promise<void> => {
    if (!req.org) return;
    lastRequest = req;
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: dbmInstancesQuery(req.org, req.startTime, req.endTime).queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    hits.value = await loadDbmFleetInstances(req);
  };
  const rerun = () => {
    if (lastRequest) void load(lastRequest, true);
  };
  // Only inside a scope, so an entry is guaranteed to leave the set when its page unmounts.
  if (getCurrentScope()) {
    mounted.add(rerun);
    onScopeDispose(() => mounted.delete(rerun));
  }
  return { hits, load };
}
