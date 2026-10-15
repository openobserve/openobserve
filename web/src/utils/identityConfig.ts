// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { ServiceIdentityConfig } from "@/services/service_streams";
import { queryClient } from "@/composables/query/queryClient";
import { identityConfigQuery } from "@/services/service_streams.queries";
import { isServiceStreamKey, serviceStreamKeys } from "@/services/service_streams.querykeys";

// Storage is the shared query client so the org-switch and logout purges see this config too.
const CACHE_TTL_MS = 5 * 60 * 1000;

const EMPTY: ServiceIdentityConfig = { sets: [], tracked_alias_ids: [] };

/** A failure resolves to the empty fallback and is NOT cached, so the next caller retries instead of being served an empty config forever. */
export async function loadIdentityConfig(orgIdentifier: string): Promise<ServiceIdentityConfig> {
  // Fresh-hit fast path — see the note in semanticGroupsCache.ts.
  const state = queryClient.getQueryState<ServiceIdentityConfig>(
    serviceStreamKeys.identityConfig(orgIdentifier),
  );
  // An invalidated entry is stale whatever its age, or a config save's invalidation never reaches this path.
  if (
    state?.data !== undefined &&
    !state.isInvalidated &&
    Date.now() - state.dataUpdatedAt < CACHE_TTL_MS
  ) {
    return state.data;
  }
  try {
    return await queryClient.fetchQuery(identityConfigQuery(orgIdentifier));
  } catch (err: any) {
    console.warn("[identityConfig] Failed to load identity config, using fallback:", err);
    return EMPTY;
  }
}

/**
 * Clear cached identity config for a specific organization
 * Useful when organization settings change
 */
export function clearIdentityConfigCache(orgIdentifier: string): void {
  queryClient.removeQueries({
    queryKey: serviceStreamKeys.identityConfig(orgIdentifier),
    exact: true,
  });
}

/**
 * Clear all cached identity configurations
 * Useful for cleanup or when switching contexts
 */
export function clearAllIdentityConfigCache(): void {
  queryClient.removeQueries({
    predicate: (query) => isServiceStreamKey(query.queryKey, "identityConfig"),
  });
}

/**
 * Get cache status for debugging purposes
 * Returns information about cached entries and their ages
 */
export function getCacheStatus(): Record<string, { age_seconds: number; expired: boolean }> {
  const status: Record<string, { age_seconds: number; expired: boolean }> = {};
  const now = Date.now();

  for (const query of queryClient.getQueryCache().getAll()) {
    if (!isServiceStreamKey(query.queryKey, "identityConfig")) continue;
    if (query.state.data === undefined) continue;
    const age = now - query.state.dataUpdatedAt;
    status[String(query.queryKey[1])] = {
      age_seconds: Math.round(age / 1000),
      expired: age >= CACHE_TTL_MS,
    };
  }

  return status;
}
