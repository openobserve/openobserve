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

/**
 * Frontend cache for built-in LLM model pricing
 * Caches pricing data in sessionStorage with 24-hour TTL
 */

interface CachedData<T> {
  data: T;
  timestamp: number;
  ttl: number; // in milliseconds
}

const CACHE_KEY_PREFIX = "model_pricing_cache_";
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export class ModelPricingCache {
  /**
   * Get data from cache if it exists and is not expired
   */
  static get<T>(orgId: string): T | null {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${orgId}`;
      const cachedItem = sessionStorage.getItem(cacheKey);

      if (!cachedItem) {
        console.debug(`[ModelPricingCache] Cache miss for org: ${orgId}`);
        return null;
      }

      const cached: CachedData<T> = JSON.parse(cachedItem);
      const now = Date.now();

      // Check if expired
      if (now - cached.timestamp > cached.ttl) {
        console.debug(
          `[ModelPricingCache] Cache expired for org: ${orgId} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`
        );
        this.clear(orgId);
        return null;
      }

      console.debug(
        `[ModelPricingCache] Cache hit for org: ${orgId} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`
      );
      return cached.data;
    } catch (error) {
      console.error("[ModelPricingCache] Error reading cache:", error);
      return null;
    }
  }

  /**
   * Store data in cache with TTL
   */
  static set<T>(orgId: string, data: T, ttl: number = DEFAULT_TTL): void {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${orgId}`;
      const cached: CachedData<T> = {
        data,
        timestamp: Date.now(),
        ttl,
      };

      sessionStorage.setItem(cacheKey, JSON.stringify(cached));
      console.debug(
        `[ModelPricingCache] Cached data for org: ${orgId} (TTL: ${ttl / 1000}s)`
      );
    } catch (error) {
      console.error("[ModelPricingCache] Error writing cache:", error);
      // Don't fail the request if caching fails (e.g., quota exceeded)
    }
  }

  /**
   * Clear cache for specific organization
   */
  static clear(orgId: string): void {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${orgId}`;
      sessionStorage.removeItem(cacheKey);
      console.debug(`[ModelPricingCache] Cleared cache for org: ${orgId}`);
    } catch (error) {
      console.error("[ModelPricingCache] Error clearing cache:", error);
    }
  }

  /**
   * Clear all model pricing caches
   */
  static clearAll(): void {
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach((key) => {
        if (key.startsWith(CACHE_KEY_PREFIX)) {
          sessionStorage.removeItem(key);
        }
      });
      console.debug("[ModelPricingCache] Cleared all caches");
    } catch (error) {
      console.error("[ModelPricingCache] Error clearing all caches:", error);
    }
  }

  /**
   * Get cache statistics
   */
  static getStats(orgId: string): { exists: boolean; age: number; ttl: number } | null {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${orgId}`;
      const cachedItem = sessionStorage.getItem(cacheKey);

      if (!cachedItem) {
        return null;
      }

      const cached: CachedData<any> = JSON.parse(cachedItem);
      const now = Date.now();
      const age = now - cached.timestamp;

      return {
        exists: true,
        age: Math.round(age / 1000), // in seconds
        ttl: Math.round(cached.ttl / 1000), // in seconds
      };
    } catch (error) {
      console.error("[ModelPricingCache] Error getting stats:", error);
      return null;
    }
  }
}
