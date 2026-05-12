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

import { ref, computed, watch, onUnmounted } from "vue";
import { useStore } from "vuex";
import type { StreamInfo } from "@/services/service_streams";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { generateTraceContext } from "@/utils/zincutils";
import useHttpStreamingSearch from "@/composables/useStreamingSearch";

export interface TimeRange {
  startTime: number;
  endTime: number;
}

export interface CorrelatedLogsProps {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  additionalDimensions?: Record<string, string>;
  logStreams: StreamInfo[];
  sourceStream: string;
  sourceType: string;
  availableDimensions?: Record<string, any>;
  ftsFields?: string[];
  timeRange: TimeRange;
  hideViewRelatedButton?: boolean;
  hideSearchTermActions?: boolean;
  hideDimensionFilters?: boolean;
  hideResetFiltersButton?: boolean;
}

export interface LogEntry {
  _timestamp: number;
  [key: string]: any;
}

export interface SearchResponse {
  hits: LogEntry[];
  total: {
    value: number;
  };
  took: number;
}

/**
 * Composable for managing correlated logs data and state
 *
 * Responsibilities:
 * - Fetch logs from search API using correlation filters
 * - Build SQL queries with proper escaping
 * - Manage loading, error, and data states
 * - Handle filter updates and refetching
 * - Cancel in-flight requests on component unmount
 */
export function useCorrelatedLogs(props: CorrelatedLogsProps) {
  const store = useStore();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreamingSearch();

  // State
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchResults = ref<LogEntry[]>([]);
  const totalHits = ref(0);
  const took = ref(0);

  // Current filters (combined matched + additional dimensions)
  const currentFilters = ref<Record<string, string>>({
    ...props.matchedDimensions,
    ...props.additionalDimensions,
  });

  // Current time range
  const currentTimeRange = ref<TimeRange>({ ...props.timeRange });

  // Pagination state
  const currentPage = ref(1);
  const pageSize = ref(100);

  // Current trace ID for request cancellation
  let currentTraceId: string | null = null;

  // Computed
  const hasResults = computed(() => searchResults.value.length > 0);
  const isLoading = computed(() => loading.value);
  const hasError = computed(() => !!error.value);
  const isEmpty = computed(() => !loading.value && !error.value && !hasResults.value);

  // Number of correlated log streams available
  const logStreamsCount = computed(() => props.logStreams.length);

  // REMOVED: getDefaultSemanticPatterns() function
  // No longer needed - we use exact field names from StreamInfo.filters

  // REMOVED: loadSemanticPatterns() function
  // No longer needed - we use exact field names from StreamInfo.filters

  // REMOVED: getSemanticToFieldMapping() function
  // No longer needed - we use exact field names from StreamInfo.filters
  // The /_correlate API (or fallback) provides the correct field names for each stream

  /**
   * Build SQL queries for ALL correlated log streams.
   * Each stream gets its own independent query using its exact field names from StreamInfo.filters.
   * Time range is handled by the search API's start_time/end_time parameters, not in SQL WHERE clause.
   *
   * IMPORTANT: Uses exact field names from each StreamInfo.filters (provided by /_correlate API or fallback).
   * Since each stream has its own field names, we CANNOT use a SQL UNION — the column sets may differ.
   * Instead, independent queries are sent to _search_multi_stream which executes them in parallel.
   */
  const buildSQLQueries = (limit: number = 100): string[] => {
    const queries: string[] = [];

    for (const streamInfo of props.logStreams) {
      const conditions: string[] = [];

      // ALWAYS use the exact filters from StreamInfo - the /_correlate API has the correct field names
      // Note: backend omits `filters` when empty (skip_serializing_if = "HashMap::is_empty"), so default to {}
      const exactFilters = streamInfo.filters ?? {};

      // Add dimension filters using exact field names from StreamInfo
      for (const [field, value] of Object.entries(exactFilters)) {
        // Skip wildcard values (SELECT_ALL_VALUE = "_o2_all_")
        if (value === SELECT_ALL_VALUE) {
          continue;
        }

        // Skip internal fields (start with underscore)
        if (field.startsWith('_')) {
          continue;
        }

        // Skip null/undefined values
        if (value === null || value === undefined || value === '') {
          continue;
        }

        // Quote field names if they contain special characters (dots, hyphens, etc.)
        const quotedField = /[^a-zA-Z0-9_]/.test(field)
          ? `"${field.replace(/"/g, '""')}"`
          : field;

        // Escape single quotes in values
        const escapedValue = String(value).replace(/'/g, "''");

        conditions.push(`${quotedField} = '${escapedValue}'`);
      }

      // Always quote stream name to match dashboard behavior
      const quotedStream = `"${streamInfo.stream_name.replace(/"/g, '""')}"`;

      // Build WHERE clause
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      queries.push(`SELECT '${streamInfo.stream_name}' as stream_name,* FROM ${quotedStream} ${whereClause} ORDER BY ${store.state.zoConfig.timestamp_column || '_timestamp'} DESC limit ${limit}`);
    }

    return queries;
  };

  /**
   * Fetch correlated logs from all correlated streams using multi-stream search API
   * Sends independent SQL queries for each stream to _search_multi_stream
   * Results are sorted by _timestamp descending on complete
   */
  const fetchCorrelatedLogs = async () => {
    // Cancel previous request if exists
    if (currentTraceId) {
      cancelStreamQueryBasedOnRequestId({
        trace_id: currentTraceId,
        org_id: store.state.selectedOrganization.identifier,
      });
    }

    // Validate that we have log streams
    if (!props.logStreams || props.logStreams.length === 0) {
      console.error('[useCorrelatedLogs] No log streams available');
      error.value = 'No log stream available for correlation';
      return;
    }

    loading.value = true;
    error.value = null;
    searchResults.value = []; // Clear previous results
    totalHits.value = 0; // Reset before accumulating multi-stream results
    took.value = 0;

    try {
      const limitPerStream = Math.floor(pageSize.value / logStreamsCount.value);
      // Build SQL queries for ALL correlated log streams
      const sqlQueries = buildSQLQueries(limitPerStream);

      // Prepare search query
      // Note: timestamps in timeRange are in microseconds
      // API expects microseconds, so NO conversion needed
      const startTimeMicros = currentTimeRange.value.startTime;
      const endTimeMicros = currentTimeRange.value.endTime;

      // Generate trace context for streaming
      const traceContext = generateTraceContext();
      const traceId = traceContext?.traceId || '';
      currentTraceId = traceId;

      // Build search query with array of SQL queries
      // The streaming composable auto-detects multi-stream mode when sql is an array (not a string)
      // and routes to _search_multi_stream endpoint
      const searchQuery = {
        query: {
          sql: sqlQueries, // string[] — triggers multi-stream mode in useHttpStreaming
          sql_mode: 'full',
          start_time: startTimeMicros,
          end_time: endTimeMicros,
          size: pageSize.value,
        },
      };

      // Execute streaming search with handlers
      await fetchQueryDataWithHttpStream(
        {
          queryReq: searchQuery,
          type: 'search',
          traceId: traceId,
          org_id: store.state.selectedOrganization.identifier,
          pageType: 'logs',
          searchType: 'UI',
        },
        {
          data: (_data: any, response: any) => {
            // Handle metadata event
            if (response.type === 'search_response_metadata') {
              const results = response.content?.results;
              if (results) {
                // Accumulate across multi-stream metadata events
                // Each correlated stream emits its own metadata, so we sum totals and took
                totalHits.value += results.total || 0;
                took.value += results.took || 0;
              }
            }

            // Handle hits event (this has the actual data)
            // Raw backend response: {"hits": [{...}, {...}]}
            // After wsMapper: response.content.results = {"hits": [{...}, {...}]}
            if (response.type === 'search_response_hits') {
              // The results object IS the hits container {"hits": [...]}
              const resultsObj = response.content?.results;
              const hits = resultsObj?.hits || [];

              // Append hits from any stream (streaming can send multiple chunks)
              if (hits.length > 0) {
                searchResults.value.push(...hits);
              } else {
                console.warn('[useCorrelatedLogs] No hits found in response!');
              }
            }
          },
          error: (_data: any, response: any) => {
            console.error('[useCorrelatedLogs] Stream error:', response);
            error.value = response.content?.message || 'Failed to fetch correlated logs';
            loading.value = false;
            searchResults.value = [];
            totalHits.value = 0;
          },
          complete: (_data: any) => {
            // Sort merged results from all streams by _timestamp descending
            // _search_multi_stream streams results per-query as they complete,
            // so hits arrive in arbitrary order and need a final global sort
            const timestamp = store.state.zoConfig.timestamp_column || '_timestamp';
            searchResults.value.sort((a, b) => b[timestamp] - a[timestamp]);
            loading.value = false;
            currentTraceId = null;
          },
          reset: (_data: any, response: any) => {
            console.log('[useCorrelatedLogs] Stream reset:', response);
          },
        }
      );
    } catch (e: any) {
      console.error('[useCorrelatedLogs] Failed to fetch logs:', e);
      console.error('[useCorrelatedLogs] Error details:', {
        message: e.message,
        response: e?.response?.data,
        status: e?.response?.status
      });
      error.value = e?.response?.data?.message || e.message || 'Failed to fetch correlated logs';

      // Clear results on error
      searchResults.value = [];
      totalHits.value = 0;
      loading.value = false;
    }
  };

  /**
   * Update a single dimension filter
   */
  const updateFilter = (key: string, value: string) => {
    currentFilters.value = {
      ...currentFilters.value,
      [key]: value,
    };

    // Reset to first page
    currentPage.value = 1;

    // Refetch with new filters
    fetchCorrelatedLogs();
  };

  /**
   * Update multiple filters at once
   */
  const updateFilters = (newFilters: Record<string, string>) => {
    currentFilters.value = { ...newFilters };
    currentPage.value = 1;
    fetchCorrelatedLogs();
  };

  /**
   * Remove a filter dimension
   */
  const removeFilter = (key: string) => {
    const updatedFilters = { ...currentFilters.value };
    delete updatedFilters[key];
    currentFilters.value = updatedFilters;

    currentPage.value = 1;
    fetchCorrelatedLogs();
  };

  /**
   * Reset filters to initial matched dimensions only
   */
  const resetFilters = () => {
    currentFilters.value = { ...props.matchedDimensions };
    currentPage.value = 1;
    fetchCorrelatedLogs();
  };

  /**
   * Update time range
   */
  const updateTimeRange = (startTime: number, endTime: number) => {
    currentTimeRange.value = { startTime, endTime };
    currentPage.value = 1;
    fetchCorrelatedLogs();
  };

  /**
   * Refresh data (re-fetch with current filters)
   */
  const refresh = () => {
    return fetchCorrelatedLogs();
  };

  /**
   * Check if a dimension is a matched dimension (stable)
   */
  const isMatchedDimension = (key: string): boolean => {
    return key in props.matchedDimensions;
  };

  /**
   * Check if a dimension is an additional dimension (unstable)
   */
  const isAdditionalDimension = (key: string): boolean => {
    return props.additionalDimensions ? key in props.additionalDimensions : false;
  };

  // Watch for prop changes and refetch
  watch(() => props.timeRange, (newRange) => {
    currentTimeRange.value = { ...newRange };
    fetchCorrelatedLogs();
  }, { deep: true });

  watch(() => props.matchedDimensions, (newDimensions) => {
    // Merge with existing additional dimensions
    currentFilters.value = {
      ...newDimensions,
      ...currentFilters.value,
    };
    fetchCorrelatedLogs();
  }, { deep: true });

  // Cleanup on unmount
  onUnmounted(() => {
    if (currentTraceId) {
      cancelStreamQueryBasedOnRequestId({
        trace_id: currentTraceId,
        org_id: store.state.selectedOrganization.identifier,
      });
    }

    // Clear large datasets to free memory
    searchResults.value = [];
  });

  return {
    // State
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    searchResults: computed(() => searchResults.value),
    totalHits: computed(() => totalHits.value),
    took: computed(() => took.value),
    currentFilters: computed(() => currentFilters.value),
    currentTimeRange: computed(() => currentTimeRange.value),
    currentPage: computed(() => currentPage.value),
    pageSize: computed(() => pageSize.value),
    logStreamsCount: computed(() => logStreamsCount.value),

    // Computed
    hasResults,
    isLoading,
    hasError,
    isEmpty,

    // Methods
    fetchCorrelatedLogs,
    updateFilter,
    updateFilters,
    removeFilter,
    resetFilters,
    updateTimeRange,
    refresh,
    isMatchedDimension,
    isAdditionalDimension,
  };
}
