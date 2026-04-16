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
import serviceStreamsApi from "@/services/service_streams";

/**
 * Shared Identity Config Cache
 *
 * Provides a single cache for service identity configurations to avoid
 * duplicate API calls across different modules (composables, incidents, etc.)
 *
 * Cache entries include TTL to prevent serving stale data when server-side
 * config changes during a session.
 */

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Cache entry with timestamp for TTL support
interface CacheEntry {
  data: ServiceIdentityConfig;
  timestamp: number;
}

// Global cache for identity configurations (keyed by org_identifier)
const identityConfigCache = new Map<string, CacheEntry>();

// Track pending requests to avoid duplicate concurrent API calls
const pendingIdentityConfigRequests = new Map<string, Promise<ServiceIdentityConfig>>();

/**
 * Load service identity configuration with shared caching
 *
 * @param orgIdentifier - Organization identifier
 * @returns Promise resolving to ServiceIdentityConfig
 */
export async function loadIdentityConfig(orgIdentifier: string): Promise<ServiceIdentityConfig> {
  // Check global cache first and verify TTL
  if (identityConfigCache.has(orgIdentifier)) {
    const cached = identityConfigCache.get(orgIdentifier)!;
    const age = Date.now() - cached.timestamp;

    if (age < CACHE_TTL_MS) {
      console.log(`[identityConfig] Using cached identity config for org '${orgIdentifier}' (age: ${Math.round(age / 1000)}s)`);
      return cached.data;
    } else {
      console.log(`[identityConfig] Cache expired for org '${orgIdentifier}' (age: ${Math.round(age / 1000)}s), fetching fresh data`);
      identityConfigCache.delete(orgIdentifier);
    }
  }

  // Check if there's already a pending request for this org
  if (pendingIdentityConfigRequests.has(orgIdentifier)) {
    console.log(`[identityConfig] Already loading identity config for org '${orgIdentifier}', awaiting existing request...`);
    // Await the existing promise directly - no polling or recursion needed
    return await pendingIdentityConfigRequests.get(orgIdentifier)!;
  }

  // Create and store the promise for this request
  const requestPromise = (async (): Promise<ServiceIdentityConfig> => {
    try {
      const response = await serviceStreamsApi.getIdentityConfig(orgIdentifier);
      const cacheEntry: CacheEntry = {
        data: response.data,
        timestamp: Date.now()
      };
      identityConfigCache.set(orgIdentifier, cacheEntry);
      console.log(`[identityConfig] Loaded identity config for org '${orgIdentifier}':`, {
        sets: response.data.sets?.length || 0,
        tracked_alias_ids: response.data.tracked_alias_ids?.length || 0
      });
      return response.data;
    } catch (err: any) {
      console.warn("[identityConfig] Failed to load identity config, using fallback:", err);
      // Return empty fallback config on error but don't cache it
      // This allows retries on subsequent calls instead of permanently suppressing them
      const fallback: ServiceIdentityConfig = { sets: [], tracked_alias_ids: [] };
      return fallback;
    } finally {
      // Clean up: remove the promise from pending requests
      pendingIdentityConfigRequests.delete(orgIdentifier);
    }
  })();

  // Store the promise so concurrent requests can await it
  pendingIdentityConfigRequests.set(orgIdentifier, requestPromise);

  return await requestPromise;
}

/**
 * Clear cached identity config for a specific organization
 * Useful when organization settings change
 */
export function clearIdentityConfigCache(orgIdentifier: string): void {
  identityConfigCache.delete(orgIdentifier);
  pendingIdentityConfigRequests.delete(orgIdentifier);
  console.log(`[identityConfig] Cleared identity config cache for org '${orgIdentifier}'`);
}

/**
 * Clear all cached identity configurations
 * Useful for cleanup or when switching contexts
 */
export function clearAllIdentityConfigCache(): void {
  identityConfigCache.clear();
  pendingIdentityConfigRequests.clear();
  console.log(`[identityConfig] Cleared all identity config caches`);
}

/**
 * Get cache status for debugging purposes
 * Returns information about cached entries and their ages
 */
export function getCacheStatus(): Record<string, { age_seconds: number; expired: boolean }> {
  const status: Record<string, { age_seconds: number; expired: boolean }> = {};
  const now = Date.now();

  for (const [orgIdentifier, entry] of identityConfigCache.entries()) {
    const age = now - entry.timestamp;
    status[orgIdentifier] = {
      age_seconds: Math.round(age / 1000),
      expired: age >= CACHE_TTL_MS
    };
  }

  return status;
}