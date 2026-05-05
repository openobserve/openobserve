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

import { ref, computed } from "vue";
import { useStore } from "vuex";
import serviceStreamsApi from "@/services/service_streams";
import settingsApi from "@/services/settings";
import type {
  ServiceMetadata,
  FieldAlias,
  CorrelationResponse,
  StreamInfo,
  ServiceIdentityConfig,
} from "@/services/service_streams";
import type { TelemetryContext, TelemetryType, CorrelationResult } from "@/utils/telemetryCorrelation";
import {
  extractSemanticDimensions,
  generateCorrelationQueries,
  findMatchingService,
  filterDimensionsForCorrelation,
} from "@/utils/telemetryCorrelation";
import { loadIdentityConfig, clearIdentityConfigCache, clearAllIdentityConfigCache } from "@/utils/identityConfig";

// Cache TTL in milliseconds (5 minutes)
const SEMANTIC_GROUPS_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache entry with timestamp for TTL support
interface SemanticGroupsCacheEntry {
  data: FieldAlias[];
  timestamp: number;
}

// Global cache for semantic groups (shared across all instances)
// Key: org_identifier, Value: cache entry with TTL
const semanticGroupsGlobalCache = new Map<string, SemanticGroupsCacheEntry>();
const pendingSemanticGroupsRequests = new Map<string, Promise<FieldAlias[]>>();

// ---------------------------------------------------------------------------
// Key fields config — per-stream-type pinned fields (fields + groups)
// ---------------------------------------------------------------------------

export interface KeyFieldsSpec {
  fields: string[];
  groups: string[];
}
export type KeyFieldsConfig = Record<string, KeyFieldsSpec>;

export interface FieldGroupingConfig {
  prefix_aliases: Record<string, string>;
  group_labels: Record<string, string>;
}

interface KeyFieldsCacheEntry {
  data: KeyFieldsConfig;
  timestamp: number;
}

interface FieldGroupingCacheEntry {
  data: FieldGroupingConfig;
  timestamp: number;
}

const keyFieldsGlobalCache = new Map<string, KeyFieldsCacheEntry>();
const pendingKeyFieldsRequests = new Map<string, Promise<KeyFieldsConfig>>();

const fieldGroupingGlobalCache = new Map<string, FieldGroupingCacheEntry>();
const pendingFieldGroupingRequests = new Map<string, Promise<FieldGroupingConfig>>();


/**
 * Composable for telemetry correlation using service_streams
 *
 * Provides functionality to find related logs, traces, and metrics
 * based on service discovery data
 */
export function useServiceCorrelation() {
  const store = useStore();
  const orgIdentifier = computed(() => store.state.selectedOrganization.identifier);

  const error = ref<string | null>(null);

  /**
   * Load semantic field groups with TTL-based caching
   * Uses a global cache to avoid redundant API calls across all composable instances
   */
  async function loadSemanticGroups(): Promise<FieldAlias[]> {
    const org = orgIdentifier.value;

    // Check global cache first and verify TTL
    if (semanticGroupsGlobalCache.has(org)) {
      const cached = semanticGroupsGlobalCache.get(org)!;
      const age = Date.now() - cached.timestamp;

      if (age < SEMANTIC_GROUPS_CACHE_TTL_MS) {
        console.log(`[useServiceCorrelation] Using cached semantic groups for org '${org}' (${cached.data.length} groups, age: ${Math.round(age / 1000)}s)`);
        return cached.data;
      } else {
        console.log(`[useServiceCorrelation] Semantic groups cache expired for org '${org}' (age: ${Math.round(age / 1000)}s), fetching fresh data`);
        semanticGroupsGlobalCache.delete(org);
      }
    }

    // Check if there's already a pending request for this org
    if (pendingSemanticGroupsRequests.has(org)) {
      console.log(`[useServiceCorrelation] Already loading semantic groups for org '${org}', awaiting existing request...`);
      // Await the existing promise directly - no polling or recursion needed
      return await pendingSemanticGroupsRequests.get(org)!;
    }

    // Create and store the promise for this request
    const requestPromise = (async (): Promise<FieldAlias[]> => {
      error.value = null;
      try {
        const response = await serviceStreamsApi.getSemanticGroups(org);
        const cacheEntry: SemanticGroupsCacheEntry = {
          data: response.data,
          timestamp: Date.now()
        };
        semanticGroupsGlobalCache.set(org, cacheEntry);
        return response.data;
      } catch (err: any) {
        error.value = `Failed to load semantic groups: ${err.message || err}`;
        console.error("Error loading semantic groups:", err);
        return [];
      } finally {
        // Clean up: remove the promise from pending requests
        pendingSemanticGroupsRequests.delete(org);
      }
    })();

    // Store the promise so concurrent requests can await it
    pendingSemanticGroupsRequests.set(org, requestPromise);

    return await requestPromise;
  }


  /**
   * Find related telemetry for a given context using the new _correlate API
   *
   * This is the main correlation function that:
   * 1. Extracts semantic dimensions from the context
   * 2. Calls the _correlate API which handles:
   *    - Finding the service using stream name + minimal dimensions
   *    - Categorizing dimensions (matched vs additional)
   *    - Returning all related streams
   * 3. Returns the correlation response for UI display
   */
  async function findRelatedTelemetry(
    context: TelemetryContext,
    sourceType: TelemetryType,
    timeWindowMinutes: number = 5,
    currentStream?: string
  ): Promise<CorrelationResult | null> {
    error.value = null;

    try {
      // Validate inputs
      if (!currentStream) {
        error.value = "Stream name is required for correlation";
        return null;
      }

      // Load semantic groups and identity config
      const [semanticGroups, identityConfig] = await Promise.all([
        loadSemanticGroups(),
        loadIdentityConfig(orgIdentifier.value)
      ]);

      if (semanticGroups.length === 0) {
        error.value = "No semantic groups available";
        return null;
      }

      // Extract ALL semantic dimensions from context (stable + unstable)
      // Backend will categorize them into matched_dimensions (stable) and additional_dimensions (unstable)
      // UI will use matched_dimensions with actual values, additional_dimensions with _o2_all wildcard
      const allDimensions = extractSemanticDimensions(context, semanticGroups, false);

      if (Object.keys(allDimensions).length === 0) {
        error.value = "No recognizable dimensions found in context for correlation";
        console.error("[useServiceCorrelation] No dimensions extracted. Check semantic groups configuration.");
        return null;
      }

      // Filter dimensions to only include fields that are used for disambiguation
      // This matches the backend logic and reduces unnecessary data sent to API
      const dimensions = filterDimensionsForCorrelation(allDimensions, identityConfig);

      console.log("[useServiceCorrelation] Dimension filtering:", {
        original_count: Object.keys(allDimensions).length,
        filtered_count: Object.keys(dimensions).length,
        original: allDimensions,
        filtered: dimensions,
        identity_config: {
          sets: identityConfig.sets?.length || 0,
          tracked_alias_ids: identityConfig.tracked_alias_ids?.length || 0
        }
      });


      // Call the new _correlate API
      const correlationRequest = {
        source_stream: currentStream,
        source_type: sourceType,
        available_dimensions: dimensions,
      };

      const response = await serviceStreamsApi.correlate(orgIdentifier.value, correlationRequest);

      const correlationData: CorrelationResponse | null = response.data;

      // Check if API returned null (no matching service found)
      if (!correlationData) {
        error.value = "No matching service found for this stream with the provided dimensions.";
        console.warn("[useServiceCorrelation] Correlation API returned null - no matching service found");
        return null;
      }

      console.log("[useServiceCorrelation] Correlation response:", {
        service_name: correlationData.service_name,
        matched_dimensions: correlationData.matched_dimensions,
        metrics_count: correlationData.related_streams.metrics.length,
        logs_count: correlationData.related_streams.logs.length,
        traces_count: correlationData.related_streams.traces.length,
      });

      // Convert correlation response to the format expected by the UI
      // Create a "virtual" ServiceMetadata from the correlation result
      // IMPORTANT: Only use matched_dimensions for SQL queries (they are the stable dimensions)
      // Additional dimensions are transient and should not be used for correlation
      const service: ServiceMetadata = {
        service_name: correlationData.service_name,
        dimensions: correlationData.matched_dimensions, // Only stable dimensions for SQL WHERE clause
        streams: {
          logs: correlationData.related_streams.logs.map((s: StreamInfo) => s.stream_name),
          traces: correlationData.related_streams.traces.map((s: StreamInfo) => s.stream_name),
          metrics: correlationData.related_streams.metrics.map((s: StreamInfo) => s.stream_name),
        },
        first_seen: 0,
        last_seen: 0,
      };

      // Generate correlation queries using the existing utility
      // Pass correlationData so it uses exact field names from StreamInfo.filters
      const queries = generateCorrelationQueries(
        service,
        context,
        sourceType,
        semanticGroups,
        timeWindowMinutes,
        correlationData
      );

      return {
        service,
        queries,
        // Add the new correlation data for enhanced UI
        correlationData,
      };
    } catch (err: any) {
      // Provide user-friendly error messages
      if (err.response?.status === 403) {
        error.value = "Service Discovery is not enabled. This is an enterprise feature.";
      } else if (err.response?.status === 404) {
        error.value = "No matching service found for this stream with the provided dimensions.";
      } else if (err.message?.includes("host") || err.code === "ERR_NETWORK") {
        error.value = "Unable to connect to server. Please check if the application is running.";
      } else if (!error.value) {
        error.value = `Correlation failed: ${err.message || err}`;
      }
      console.error("Error finding related telemetry:", err);
      return null;
    }
  }

  /**
   * Clear caches for current org
   * Call this when semantic groups or identity config are updated in settings
   */
  function clearCache() {
    const org = orgIdentifier.value;
    semanticGroupsGlobalCache.delete(org);
    pendingSemanticGroupsRequests.delete(org);
    keyFieldsGlobalCache.delete(org);
    pendingKeyFieldsRequests.delete(org);
    fieldGroupingGlobalCache.delete(org);
    pendingFieldGroupingRequests.delete(org);
    clearIdentityConfigCache(org);
    console.log(`[useServiceCorrelation] Cleared caches for org '${org}'`);
  }

  /**
   * Clear all caches for all organizations
   * Use when switching organizations or on logout
   */
  function clearAllCaches() {
    semanticGroupsGlobalCache.clear();
    pendingSemanticGroupsRequests.clear();
    keyFieldsGlobalCache.clear();
    pendingKeyFieldsRequests.clear();
    fieldGroupingGlobalCache.clear();
    pendingFieldGroupingRequests.clear();
    clearAllIdentityConfigCache();
    console.log(`[useServiceCorrelation] Cleared all caches`);
  }

  /**
   * Check if correlation is available (semantic groups loaded)
   */
  async function isCorrelationAvailable(): Promise<boolean> {
    try {
      const groups = await loadSemanticGroups();
      return groups.length > 0;
    } catch {
      return false;
    }
  }

  async function loadKeyFields(): Promise<KeyFieldsConfig> {
    const org = orgIdentifier.value;

    if (keyFieldsGlobalCache.has(org)) {
      const cached = keyFieldsGlobalCache.get(org)!;
      if (Date.now() - cached.timestamp < SEMANTIC_GROUPS_CACHE_TTL_MS) {
        return cached.data;
      }
      keyFieldsGlobalCache.delete(org);
    }

    if (pendingKeyFieldsRequests.has(org)) {
      return pendingKeyFieldsRequests.get(org)!;
    }

    const requestPromise = (async (): Promise<KeyFieldsConfig> => {
      try {
        const response = await settingsApi.getSetting(org, "key_fields");
        const data: KeyFieldsConfig = response.data?.setting_value ?? {};
        keyFieldsGlobalCache.set(org, { data, timestamp: Date.now() });
        return data;
      } catch {
        return {};
      } finally {
        pendingKeyFieldsRequests.delete(org);
      }
    })();

    pendingKeyFieldsRequests.set(org, requestPromise);
    return requestPromise;
  }

  async function loadFieldGrouping(): Promise<FieldGroupingConfig> {
    const org = orgIdentifier.value;
    const empty: FieldGroupingConfig = { prefix_aliases: {}, group_labels: {} };

    if (fieldGroupingGlobalCache.has(org)) {
      const cached = fieldGroupingGlobalCache.get(org)!;
      if (Date.now() - cached.timestamp < SEMANTIC_GROUPS_CACHE_TTL_MS) {
        return cached.data;
      }
      fieldGroupingGlobalCache.delete(org);
    }

    if (pendingFieldGroupingRequests.has(org)) {
      return pendingFieldGroupingRequests.get(org)!;
    }

    const requestPromise = (async (): Promise<FieldGroupingConfig> => {
      try {
        const response = await settingsApi.getSetting(org, "field_grouping");
        const data: FieldGroupingConfig = response.data?.setting_value ?? empty;
        fieldGroupingGlobalCache.set(org, { data, timestamp: Date.now() });
        return data;
      } catch {
        return empty;
      } finally {
        pendingFieldGroupingRequests.delete(org);
      }
    })();

    pendingFieldGroupingRequests.set(org, requestPromise);
    return requestPromise;
  }

  return {
    // State
    error,
    semanticGroups: computed(() => {
      const cached = semanticGroupsGlobalCache.get(orgIdentifier.value);
      return cached?.data || [];
    }),

    // Methods
    findRelatedTelemetry,
    loadSemanticGroups,
    loadKeyFields,
    loadFieldGrouping,
    loadIdentityConfig,
    clearCache,
    clearAllCaches,
    isCorrelationAvailable,
  };
}

/**
 * Export utility to clear all caches (for use outside composable)
 * Useful for logout or org switching
 */
export function clearSemanticGroupsCaches() {
  semanticGroupsGlobalCache.clear();
  pendingSemanticGroupsRequests.clear();
  clearAllIdentityConfigCache();
}

/**
 * Get semantic groups cache status for debugging purposes
 * Returns information about cached entries and their ages
 */
export function getSemanticGroupsCacheStatus(): Record<string, { age_seconds: number; expired: boolean; groups_count: number }> {
  const status: Record<string, { age_seconds: number; expired: boolean; groups_count: number }> = {};
  const now = Date.now();

  for (const [orgIdentifier, entry] of semanticGroupsGlobalCache.entries()) {
    const age = now - entry.timestamp;
    status[orgIdentifier] = {
      age_seconds: Math.round(age / 1000),
      expired: age >= SEMANTIC_GROUPS_CACHE_TTL_MS,
      groups_count: entry.data.length
    };
  }

  return status;
}
