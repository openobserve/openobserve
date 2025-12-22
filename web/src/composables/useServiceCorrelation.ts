// Copyright 2025 OpenObserve Inc.
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
import type {
  ServiceMetadata,
  SemanticFieldGroup,
  CorrelationResponse,
  StreamInfo,
} from "@/services/service_streams";
import type { TelemetryContext, TelemetryType, CorrelationResult } from "@/utils/telemetryCorrelation";
import {
  extractSemanticDimensions,
  generateCorrelationQueries,
  findMatchingService,
} from "@/utils/telemetryCorrelation";

// Global cache for semantic groups (shared across all instances)
// Key: org_identifier, Value: semantic groups
const semanticGroupsGlobalCache = new Map<string, SemanticFieldGroup[]>();
const isLoadingSemanticGroupsGlobal = new Map<string, boolean>();

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
   * Load semantic field groups (once per organization per session)
   * Uses a global cache to avoid redundant API calls across all composable instances
   */
  async function loadSemanticGroups(): Promise<SemanticFieldGroup[]> {
    const org = orgIdentifier.value;

    // Check global cache first
    if (semanticGroupsGlobalCache.has(org)) {
      const cached = semanticGroupsGlobalCache.get(org)!;
      if (cached.length > 0) {
        console.log(`[useServiceCorrelation] Using cached semantic groups for org '${org}' (${cached.length} groups)`);
        return cached;
      }
    }

    // Check if already loading for this org (prevent duplicate requests)
    if (isLoadingSemanticGroupsGlobal.get(org)) {
      console.log(`[useServiceCorrelation] Already loading semantic groups for org '${org}', waiting...`);
      // Wait for the existing request to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      return loadSemanticGroups(); // Retry (will hit cache)
    }

    // Mark as loading
    isLoadingSemanticGroupsGlobal.set(org, true);
    error.value = null;

    try {
      console.log(`[useServiceCorrelation] Loading semantic groups for org '${org}'...`);
      const response = await serviceStreamsApi.getSemanticGroups(org);
      semanticGroupsGlobalCache.set(org, response.data);
      console.log(`[useServiceCorrelation] Loaded ${response.data.length} semantic groups for org '${org}'`);
      return response.data;
    } catch (err: any) {
      error.value = `Failed to load semantic groups: ${err.message || err}`;
      console.error("Error loading semantic groups:", err);
      return [];
    } finally {
      isLoadingSemanticGroupsGlobal.set(org, false);
    }
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

      // Load semantic groups
      const semanticGroups = await loadSemanticGroups();

      if (semanticGroups.length === 0) {
        error.value = "No semantic groups available";
        return null;
      }

      // Extract ALL semantic dimensions from context (stable + unstable)
      // Backend will categorize them into matched_dimensions (stable) and additional_dimensions (unstable)
      // UI will use matched_dimensions with actual values, additional_dimensions with _o2_all wildcard
      const dimensions = extractSemanticDimensions(context, semanticGroups, false);

      console.log("[useServiceCorrelation] Context fields:", Object.keys(context.fields));
      console.log("[useServiceCorrelation] Extracted dimensions:", dimensions);

      if (Object.keys(dimensions).length === 0) {
        error.value = "No recognizable dimensions found in context for correlation";
        console.error("[useServiceCorrelation] No dimensions extracted. Check semantic groups configuration.");
        return null;
      }

      // Call the new _correlate API
      const correlationRequest = {
        source_stream: currentStream,
        source_type: sourceType,
        available_dimensions: dimensions,
      };

      console.log("[useServiceCorrelation] Correlation request:", correlationRequest);

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
   * Clear semantic groups cache for current org
   * Call this when semantic groups are updated in settings
   */
  function clearCache() {
    const org = orgIdentifier.value;
    semanticGroupsGlobalCache.delete(org);
    console.log(`[useServiceCorrelation] Cleared semantic groups cache for org '${org}'`);
  }

  /**
   * Clear semantic groups cache for all organizations
   * Use when switching organizations or on logout
   */
  function clearAllCaches() {
    semanticGroupsGlobalCache.clear();
    isLoadingSemanticGroupsGlobal.clear();
    console.log(`[useServiceCorrelation] Cleared all semantic groups caches`);
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

  return {
    // State
    error,
    semanticGroups: computed(() => semanticGroupsGlobalCache.get(orgIdentifier.value) || []),

    // Methods
    findRelatedTelemetry,
    loadSemanticGroups,
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
  isLoadingSemanticGroupsGlobal.clear();
}
