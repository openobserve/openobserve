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
import streamingSearch from "@/services/streaming_search";
import type { StreamInfo } from "@/services/service_streams";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import type { AxiosRequestConfig, CancelTokenSource } from "axios";
import axios from "axios";
import { generateTraceContext } from "@/utils/zincutils";

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

  // Cancel token for request cancellation
  let cancelTokenSource: CancelTokenSource | null = null;

  // Computed
  const hasResults = computed(() => searchResults.value.length > 0);
  const isLoading = computed(() => loading.value);
  const hasError = computed(() => !!error.value);
  const isEmpty = computed(() => !loading.value && !error.value && !hasResults.value);

  // Get the primary stream to query
  const primaryStream = computed(() => {
    // Use sourceStream if it's a logs stream
    if (props.sourceStream && props.sourceType === 'logs') {
      return props.sourceStream;
    }

    // Otherwise, use first log stream from correlation response
    if (props.logStreams && props.logStreams.length > 0) {
      return props.logStreams[0].stream_name;
    }

    return '';
  });

  /**
   * Build SQL query with proper escaping for special characters and SQL injection prevention
   * Note: Time range is handled by the search API's start_time/end_time parameters, not in SQL WHERE clause
   */
  const buildSQLQuery = (
    streamName: string,
    filters: Record<string, string>,
    timeRange: TimeRange,
    limit: number = 100
  ): string => {
    const conditions: string[] = [];

    // Add dimension filters
    for (const [field, value] of Object.entries(filters)) {
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

      // Quote field names if they contain special characters
      const quotedField = /[^a-zA-Z0-9_]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;

      // Escape single quotes in values
      const escapedValue = String(value).replace(/'/g, "''");

      conditions.push(`${quotedField} = '${escapedValue}'`);
    }

    // Quote stream name if it contains special characters
    const quotedStream = /[^a-zA-Z0-9_]/.test(streamName) ? `"${streamName.replace(/"/g, '""')}"` : streamName;

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return `SELECT * FROM ${quotedStream} ${whereClause} ORDER BY _timestamp DESC LIMIT ${limit}`;
  };

  /**
   * Fetch correlated logs from search API
   */
  const fetchCorrelatedLogs = async () => {
    // Cancel previous request if exists
    if (cancelTokenSource) {
      cancelTokenSource.cancel('New request initiated');
    }

    // Create new cancel token
    cancelTokenSource = axios.CancelToken.source();

    // Validate stream name
    if (!primaryStream.value) {
      console.error('[useCorrelatedLogs] No primary stream available');
      console.log('[useCorrelatedLogs] Props:', {
        sourceStream: props.sourceStream,
        sourceType: props.sourceType,
        logStreams: props.logStreams
      });
      error.value = 'No log stream available for correlation';
      return;
    }

    console.log('[useCorrelatedLogs] Starting fetch with:', {
      primaryStream: primaryStream.value,
      filters: currentFilters.value,
      timeRange: currentTimeRange.value
    });

    loading.value = true;
    error.value = null;

    try {
      // Build SQL query
      const sqlQuery = buildSQLQuery(
        primaryStream.value,
        currentFilters.value,
        currentTimeRange.value,
        pageSize.value
      );

      console.log('[useCorrelatedLogs] SQL Query:', sqlQuery);

      // Prepare search query
      // Note: timestamps in timeRange are in microseconds, need to convert to milliseconds for the API
      const startTimeMs = Math.floor(currentTimeRange.value.startTime / 1000);
      const endTimeMs = Math.floor(currentTimeRange.value.endTime / 1000);

      console.log('[useCorrelatedLogs] Time range conversion:', {
        startTimeMicros: currentTimeRange.value.startTime,
        endTimeMicros: currentTimeRange.value.endTime,
        startTimeMs,
        endTimeMs
      });

      // Generate trace context for streaming
      const traceContext = generateTraceContext();
      const traceId = traceContext?.traceId || '';

      // Build search query - clean structure matching logs page format
      const searchQuery = {
        query: {
          sql: sqlQuery,
          sql_mode: 'full',
          track_total_hits: true,
          start_time: startTimeMs,
          end_time: endTimeMs,
          size: pageSize.value,
        },
      };

      console.log('[useCorrelatedLogs] Search query:', JSON.stringify(searchQuery, null, 2));
      console.log('[useCorrelatedLogs] Trace ID:', traceId);

      // Execute streaming search
      const response = await streamingSearch.search({
        org_identifier: store.state.selectedOrganization.identifier,
        query: searchQuery,
        page_type: 'logs',
        search_type: 'dashboards',
        traceId: traceId,
      });

      console.log('[useCorrelatedLogs] Response:', response);

      // Update state with results
      searchResults.value = response.data?.hits || [];
      totalHits.value = response.data?.total?.value || response.data?.total || 0;
      took.value = response.data?.took || 0;

      console.log(`[useCorrelatedLogs] Found ${totalHits.value} logs in ${took.value}ms`, searchResults.value);
    } catch (e: any) {
      // Handle cancellation (don't show error)
      if (axios.isCancel(e)) {
        console.log('[useCorrelatedLogs] Request cancelled');
        return;
      }

      console.error('[useCorrelatedLogs] Failed to fetch logs:', e);
      console.error('[useCorrelatedLogs] Error details:', {
        message: e.message,
        response: e.response?.data,
        status: e.response?.status
      });
      error.value = e.response?.data?.message || e.message || 'Failed to fetch correlated logs';

      // Clear results on error
      searchResults.value = [];
      totalHits.value = 0;
    } finally {
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
    fetchCorrelatedLogs();
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
    if (cancelTokenSource) {
      cancelTokenSource.cancel('Component unmounted');
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
    primaryStream: computed(() => primaryStream.value),

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
