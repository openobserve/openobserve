// Copyright 2023 OpenObserve Inc.
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

interface StackFrame {
  line?: string;
  source?: string;
  source_line_start?: number;
  source_line_end?: number;
  stack_line?: number;
  stack_col?: number;
  source_info?: {
    source: string;
    source_line_start: number;
    source_line_end: number;
    stack_line: number;
    stack_col: number;
  };
}

interface StackTraceFrame {
  error: string;
  stack: StackFrame[];
}

interface CacheEntry {
  data: StackTraceFrame[];
  timestamp: number;
}

// Global cache for translated stack traces
// This persists across component mounts/unmounts
const translationCache = new Map<string, CacheEntry>();

// Cache duration: 10 minutes
const CACHE_DURATION = 10 * 60 * 1000;

// Generate a cache key from the stack trace and metadata
export const generateCacheKey = (
  stacktrace: string,
  orgIdentifier: string,
  service?: string,
  version?: string,
  env?: string
): string => {
  // Create a simple hash from the string
  const hashString = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  };

  const parts = [
    orgIdentifier,
    hashString(stacktrace),
    service || "",
    version || "",
    env || "",
  ];

  return parts.join("::");
};

// Get cached translation if available and not expired
export const getCachedTranslation = (
  cacheKey: string
): StackTraceFrame[] | null => {
  const cached = translationCache.get(cacheKey);
  if (cached) {
    const now = Date.now();
    if (now - cached.timestamp < CACHE_DURATION) {
      console.log("Using cached translation for key:", cacheKey);
      return cached.data;
    } else {
      // Cache expired, remove it
      console.log("Cache expired for key:", cacheKey);
      translationCache.delete(cacheKey);
    }
  }
  return null;
};

// Store translation in cache
export const setCachedTranslation = (
  cacheKey: string,
  data: StackTraceFrame[]
): void => {
  console.log("Caching translation for key:", cacheKey);
  translationCache.set(cacheKey, {
    data: data,
    timestamp: Date.now(),
  });

  // Clean up old cache entries (keep max 50 entries)
  if (translationCache.size > 50) {
    const entries = Array.from(translationCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    // Remove oldest 10 entries
    for (let i = 0; i < 10; i++) {
      translationCache.delete(entries[i][0]);
    }
  }
};

// Clear all cache entries (useful for testing or manual cache invalidation)
export const clearCache = (): void => {
  translationCache.clear();
};

// Get cache statistics
export const getCacheStats = () => {
  return {
    size: translationCache.size,
    entries: Array.from(translationCache.keys()),
  };
};
