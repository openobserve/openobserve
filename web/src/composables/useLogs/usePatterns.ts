// Copyright 2025 OpenObserve Inc.
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

// Separate state for patterns (completely isolated from logs state)
export const patternsState = ref({
  patterns: null as any,
  loading: false,
  error: null as string | null,
  lastQuery: null as SearchRequestPayload | null,
});

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

    try {
      patternsState.value.loading = true;
      patternsState.value.error = null;
      patternsState.value.lastQuery = queryReq;

      // console.log("[Patterns] Extracting patterns for stream:", stream_name);

      const response = await patternsService.extractPatterns({
        org_identifier,
        stream_name,
        query: queryReq,
      });

      // console.log("[Patterns] API Response:", response.data);

      // Transform patterns to match UI expectations
      const transformedPatterns = response.data.patterns.map(
        (pattern: any) => ({
          ...pattern,
          // Use the actual template field from backend (with SDR types like <:IP>, <:NUM>)
          // description field is the simplified, human-readable version
          template: pattern.template || pattern.description,
          // Calculate percentage if not present
          percentage:
            pattern.percentage ||
            (pattern.frequency / response.data.statistics.total_logs_analyzed) *
              100,
          // Ensure count is available (same as frequency)
          count: pattern.frequency,
          // Ensure sample_logs maps to examples
          sample_logs: pattern.examples?.map((ex: any) => ex.log || ex) || [],
        }),
      );

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
      console.error("[Patterns] Error extracting patterns:", error);
      patternsState.value.error =
        error?.response?.data?.message ||
        "Error extracting patterns. Please try again.";
      throw error;
    } finally {
      patternsState.value.loading = false;
    }
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
    return patternsState.value.patterns?.patterns?.length > 0;
  };

  return {
    patternsState,
    extractPatterns,
    clearPatterns,
    hasPatterns,
  };
}
