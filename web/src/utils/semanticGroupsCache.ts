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

// The org's semantic field groups, fetched once and shared. Correlation reads
// them through useServiceCorrelation; chart code reads them directly, so the
// fetch, its TTL and its in-flight dedupe live here rather than inside a
// composable neither caller can reach.

import serviceStreamsApi from "@/services/service_streams";
import type { FieldAlias } from "@/services/service_streams";

/** Also the TTL the sibling key-fields / field-grouping caches age against. */
export const SEMANTIC_GROUPS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: FieldAlias[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<FieldAlias[]>>();

/**
 * Whatever groups are held for an org, without fetching and without evicting —
 * a read, safe inside a computed. Age is deliberately ignored: a caller that
 * only decorates (a legend name) is better off with stale rules than none, and
 * `loadSemanticGroups` does its own freshness check before serving the cache.
 */
export function getCachedSemanticGroups(org: string): FieldAlias[] | null {
  return cache.get(org)?.data ?? null;
}

/** Fresh within the TTL, or null — what `loadSemanticGroups` serves from. */
function getFreshSemanticGroups(org: string): FieldAlias[] | null {
  const entry = cache.get(org);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= SEMANTIC_GROUPS_CACHE_TTL_MS) {
    cache.delete(org);
    return null;
  }
  return entry.data;
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
  const cached = getFreshSemanticGroups(org);
  if (cached) return cached;

  const inFlight = pending.get(org);
  if (inFlight) return await inFlight;

  // Deferred so the body cannot run before `pending` holds it: a synchronous
  // throw from the service would otherwise reach `finally` first, delete nothing,
  // and let the `set` below pin an already-settled `[]` for this org forever.
  const request = Promise.resolve().then(async (): Promise<FieldAlias[]> => {
    try {
      const response = await serviceStreamsApi.getSemanticGroups(org);
      cache.set(org, { data: response.data, timestamp: Date.now() });
      return response.data;
    } catch (err: any) {
      onError?.(err);
      console.error("Error loading semantic groups:", err);
      return [];
    } finally {
      pending.delete(org);
    }
  });

  pending.set(org, request);
  return await request;
}

/** Drop one org's cached groups — after settings change them, say. */
export function clearSemanticGroupsCacheForOrg(org: string) {
  cache.delete(org);
  pending.delete(org);
}

/** Drop every cached org — org switch, logout, tests. */
export function clearSemanticGroupsCache() {
  cache.clear();
  pending.clear();
}

/** Per-org cache ages, for debugging. */
export function getSemanticGroupsCacheStatus(): Record<
  string,
  { age_seconds: number; expired: boolean; groups_count: number }
> {
  const status: Record<string, { age_seconds: number; expired: boolean; groups_count: number }> =
    {};
  const now = Date.now();

  for (const [org, entry] of cache.entries()) {
    const age = now - entry.timestamp;
    status[org] = {
      age_seconds: Math.round(age / 1000),
      expired: age >= SEMANTIC_GROUPS_CACHE_TTL_MS,
      groups_count: entry.data.length,
    };
  }

  return status;
}
