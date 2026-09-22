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

// The fetch lives here rather than in a composable because chart code, which reads these directly, cannot reach one.

import { queryClient } from "@/composables/query/queryClient";
import { semanticGroupsQuery } from "@/services/service_streams.queries";
import { isServiceStreamKey, serviceStreamKeys } from "@/services/service_streams.querykeys";
import type { FieldAlias } from "@/services/service_streams";

/** Also the TTL the sibling key-fields / field-grouping caches age against. */
export const SEMANTIC_GROUPS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Whatever groups are held for an org, without fetching and without evicting —
 * a read, safe inside a computed. Age is deliberately ignored: a caller that
 * only decorates (a legend name) is better off with stale rules than none.
 */
export function getCachedSemanticGroups(org: string): FieldAlias[] | null {
  return queryClient.getQueryData<FieldAlias[]>(serviceStreamKeys.semanticGroups(org)) ?? null;
}

/**
 * The org's semantic groups, from cache when fresh. Concurrent callers share
 * one request. `onError` lets a caller surface the failure; the groups
 * themselves resolve to `[]` so a caller can always keep going without them.
 */
export async function loadSemanticGroups(
  org: string,
  onError?: (err: any) => void,
): Promise<FieldAlias[]> {
  // Fresh-hit fast path: `fetchQuery` resolves only after the client's own scheduling, and the traces field pipeline awaits this inline.
  const state = queryClient.getQueryState<FieldAlias[]>(serviceStreamKeys.semanticGroups(org));
  if (
    state?.data !== undefined &&
    Date.now() - state.dataUpdatedAt < SEMANTIC_GROUPS_CACHE_TTL_MS
  ) {
    return state.data;
  }
  try {
    return await queryClient.fetchQuery(semanticGroupsQuery(org));
  } catch (err: any) {
    onError?.(err);
    console.error("Error loading semantic groups:", err);
    return [];
  }
}

/** Drop one org's cached groups — after settings change them, say. */
export function clearSemanticGroupsCacheForOrg(org: string) {
  queryClient.removeQueries({ queryKey: serviceStreamKeys.semanticGroups(org), exact: true });
}

/** Drop every cached org — org switch, logout, tests. */
export function clearSemanticGroupsCache() {
  queryClient.removeQueries({
    predicate: (query) => isServiceStreamKey(query.queryKey, "semanticGroups"),
  });
}

/** Per-org cache ages, for debugging. */
export function getSemanticGroupsCacheStatus(): Record<
  string,
  { age_seconds: number; expired: boolean; groups_count: number }
> {
  const status: Record<string, { age_seconds: number; expired: boolean; groups_count: number }> =
    {};
  const now = Date.now();

  for (const query of queryClient.getQueryCache().getAll()) {
    if (!isServiceStreamKey(query.queryKey, "semanticGroups")) continue;
    const data = query.state.data as FieldAlias[] | undefined;
    if (data === undefined) continue;
    const age = now - query.state.dataUpdatedAt;
    status[String(query.queryKey[1])] = {
      age_seconds: Math.round(age / 1000),
      expired: age >= SEMANTIC_GROUPS_CACHE_TTL_MS,
      groups_count: data.length,
    };
  }

  return status;
}
