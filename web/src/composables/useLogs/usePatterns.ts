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

import { ref } from "vue";
import patternsService from "@/services/patterns";
import type { SearchRequestPayload } from "@/ts/interfaces";

// A single UI-shaped pattern (raw backend fields + values derived in extractPatterns)
export interface TransformedPattern {
  template: string;
  percentage: number;
  count: number;
  sample_logs: unknown[];
  z_score: number;
  avg_frequency: number;
  wildcard_values: unknown[];
  // preserves any additional raw backend fields spread onto the pattern
  [key: string]: unknown;
}

// Aggregate stats returned alongside the extracted patterns
export interface PatternStatistics {
  total_patterns_found?: number;
  total_logs_analyzed?: number;
  extraction_time_ms?: number;
  [key: string]: unknown;
}

// Full patterns payload stored in state: backend response.data plus transformed patterns
export interface PatternsResult {
  patterns: TransformedPattern[];
  statistics?: PatternStatistics;
  // response.data may carry extra fields beyond patterns/statistics
  [key: string]: unknown;
}

// Separate state for patterns (completely isolated from logs state)
export const patternsState = ref<{
  patterns: PatternsResult | null;
  loading: boolean;
  error: string | null;
  lastQuery: SearchRequestPayload | null;
  // Configurable pattern-extraction scan size; may be absent until set by UI
  scanSize?: number;
}>({
  patterns: null,
  loading: false,
  error: null as string | null,
  lastQuery: null as SearchRequestPayload | null,
});

// Module-level abort controller — one in-flight request at a time
let patternAbortController: AbortController | null = null;

/**
 * Composable for pattern extraction - completely separate from logs flow
 */
export default function usePatterns() {
  /**
   * Extract patterns using the dedicated patterns API
   */
  const extractPatterns = async (
    org_identifier: string,
    stream_name: string,
    queryReq: SearchRequestPayload,
  ) => {
    // Prevent duplicate calls
    if (patternsState.value.loading) {
      // console.log("[Patterns] Already loading, skipping duplicate call");
      return;
    }

    patternAbortController = new AbortController();

    try {
      patternsState.value.loading = true;
      patternsState.value.error = null;
      patternsState.value.lastQuery = queryReq;

      // console.log("[Patterns] Extracting patterns for stream:", stream_name);

      const response = await patternsService.extractPatterns({
        org_identifier,
        stream_name,
        query: queryReq,
        signal: patternAbortController.signal,
      });

      // console.log("[Patterns] API Response:", response.data);

      // Transform patterns to match UI expectations
      const transformedPatterns = response.data.patterns.map((pattern: any) => ({
        ...pattern,
        // Use the actual template field from backend (with SDR types like <:IP>, <:NUM>)
        // description field is the simplified, human-readable version
        template: pattern.template || pattern.description,
        // Calculate percentage if not present
        percentage:
          pattern.percentage ||
          (pattern.frequency / response.data.statistics.total_logs_analyzed) * 100,
        // Ensure count is available (same as frequency)
        count: pattern.frequency,
        // Ensure sample_logs maps to examples
        sample_logs: pattern.examples?.map((ex: any) => ex.log || ex) || [],
        // Statistical context for anomaly explanation tooltips
        z_score: pattern.z_score ?? 0,
        avg_frequency: pattern.avg_frequency ?? 0,
        // Per-wildcard value distributions for hover tooltips
        wildcard_values: pattern.wildcard_values ?? [],
        // Per-pattern volume sparkline + dominant service (enterprise backend;
        // absent on older backends → safe empty defaults).
        time_buckets: pattern.time_buckets ?? [],
        service: pattern.service ?? null,
        service_other_count: pattern.service_other_count ?? 0,
        // Dominant status/level read from the log's severity/level field.
        level: pattern.level ?? null,
      }));

      // Store transformed patterns
      patternsState.value.patterns = {
        ...response.data,
        patterns: transformedPatterns,
      };

      // console.log(
      //   "[Patterns] Extraction complete:",
      //   transformedPatterns.length,
      //   "patterns found",
      // );
    } catch (error: any) {
      // Axios wraps AbortSignal cancellations as CanceledError
      if (error?.name === "CanceledError" || error?.name === "AbortError") {
        return;
      }
      console.error("[Patterns] Error extracting patterns:", error);
      patternsState.value.error =
        error?.response?.data?.message || "Error extracting patterns. Please try again.";
      throw error;
    } finally {
      patternsState.value.loading = false;
      patternAbortController = null;
    }
  };

  /**
   * Cancel an in-flight pattern extraction request
   */
  const cancelPatterns = () => {
    if (patternAbortController) {
      patternAbortController.abort();
      patternAbortController = null;
    }
    patternsState.value.loading = false;
  };

  /**
   * Clear patterns data
   */
  const clearPatterns = () => {
    patternsState.value.patterns = null;
    patternsState.value.error = null;
    patternsState.value.lastQuery = null;
    // console.log("[Patterns] Cleared patterns state");
  };

  /**
   * Check if patterns exist
   */
  const hasPatterns = () => {
    return (patternsState.value.patterns?.patterns?.length ?? 0) > 0;
  };

  return {
    patternsState,
    extractPatterns,
    clearPatterns,
    hasPatterns,
    cancelPatterns,
  };
}
