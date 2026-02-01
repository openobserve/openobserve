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
import type { StreamInfo, SemanticFieldGroup } from "@/services/service_streams";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { generateTraceContext } from "@/utils/zincutils";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
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
  const { loadSemanticGroups } = useServiceCorrelation();
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

  // Cache for semantic patterns (loaded once per component instance)
  let semanticPatternsCache: Record<string, string[]> | null = null;

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
   * Get default semantic patterns as fallback
   * These are common patterns that work for standard K8s/AWS/GCP setups
   */
  const getDefaultSemanticPatterns = (): Record<string, string[]> => {
    return {
      'k8s-namespace': ['k8s_namespace_name', 'k8s.namespace.name', 'namespace'],
      'k8s-deployment': ['k8s_deployment_name', 'k8s.deployment.name', 'deployment'],
      'k8s-pod': ['k8s_pod_name', 'k8s.pod.name', 'pod_name', 'pod'],
      'k8s-container': ['k8s_container_name', 'k8s.container.name', 'container_name', 'container'],
      'k8s-statefulset': ['k8s_statefulset_name', 'k8s.statefulset.name', 'statefulset'],
      'k8s-daemonset': ['k8s_daemonset_name', 'k8s.daemonset.name', 'daemonset'],
      'k8s-replicaset': ['k8s_replicaset_name', 'k8s.replicaset.name', 'replicaset'],
      'k8s-job': ['k8s_job_name', 'k8s.job.name', 'job'],
      'k8s-cronjob': ['k8s_cronjob_name', 'k8s.cronjob.name', 'cronjob'],
      'k8s-node': ['k8s_node_name', 'k8s.node.name', 'node_name', 'node'],
      'k8s-cluster': ['k8s_cluster_name', 'k8s.cluster.name', 'cluster'],
      'host-name': ['host_name', 'host.name', 'hostname'],
      'cloud-region': ['cloud_region', 'cloud.region', 'region'],
      'cloud-availability-zone': ['cloud_availability_zone', 'cloud.availability_zone', 'availability_zone', 'zone'],
      'container-name': ['container_name', 'container.name'],
      'container-id': ['container_id', 'container.id'],
      'service-name': ['service_name', 'service.name', 'service', 'svc'],
    };
  };

  /**
   * Load semantic patterns from backend or use defaults
   * Converts SemanticFieldGroup[] to pattern format: { id: string[] }
   *
   * @returns Promise resolving to semantic patterns
   */
  const loadSemanticPatterns = async (): Promise<Record<string, string[]>> => {
    // Return cached patterns if available
    if (semanticPatternsCache) {
      console.log('[useCorrelatedLogs] Using cached semantic patterns');
      return semanticPatternsCache;
    }

    try {
      // Load semantic groups from backend (uses global cache in useServiceCorrelation)
      console.log('[useCorrelatedLogs] Loading semantic groups from backend...');
      const semanticGroups: SemanticFieldGroup[] = await loadSemanticGroups();

      if (semanticGroups && semanticGroups.length > 0) {
        // Convert SemanticFieldGroup[] to pattern format
        const patterns: Record<string, string[]> = {};
        for (const group of semanticGroups) {
          patterns[group.id] = group.fields;
        }

        console.log(`[useCorrelatedLogs] Loaded ${Object.keys(patterns).length} semantic patterns from backend`);
        semanticPatternsCache = patterns;
        return patterns;
      } else {
        console.warn('[useCorrelatedLogs] No semantic groups returned from backend, using defaults');
        const defaults = getDefaultSemanticPatterns();
        semanticPatternsCache = defaults;
        return defaults;
      }
    } catch (err) {
      console.error('[useCorrelatedLogs] Failed to load semantic groups, using defaults:', err);
      const defaults = getDefaultSemanticPatterns();
      semanticPatternsCache = defaults;
      return defaults;
    }
  };

  /**
   * Create reverse mapping from semantic dimension names to actual field names
   * This is critical for building SQL queries with correct field names
   *
   * Example:
   * - Semantic name: "k8s-statefulset"
   * - Actual field names: "k8s_statefulset_name", "k8s.statefulset.name"
   * - We check availableDimensions to find which actual field name exists
   *
   * @returns Map of semantic dimension name → actual field name
   */
  const getSemanticToFieldMapping = async (): Promise<Record<string, string>> => {
    const mapping: Record<string, string> = {};

    // If no availableDimensions provided, we can't do reverse mapping
    if (!props.availableDimensions) {
      console.warn('[useCorrelatedLogs] No availableDimensions provided for field name mapping');
      return mapping;
    }

    // Load semantic patterns (from backend or defaults)
    const semanticPatterns = await loadSemanticPatterns();

    // For each semantic dimension, find the first matching field name in availableDimensions
    for (const [semanticName, possibleFieldNames] of Object.entries(semanticPatterns)) {
      for (const fieldName of possibleFieldNames) {
        if (fieldName in props.availableDimensions) {
          mapping[semanticName] = fieldName;
          console.log(`[useCorrelatedLogs] Mapped semantic dimension "${semanticName}" → field "${fieldName}"`);
          break;
        }
      }
    }

    return mapping;
  };

  /**
   * Build SQL query with proper escaping for special characters and SQL injection prevention
   * Note: Time range is handled by the search API's start_time/end_time parameters, not in SQL WHERE clause
   */
  const buildSQLQuery = async (
    streamName: string,
    filters: Record<string, string>,
    _timeRange: TimeRange, // Unused: time range handled by API parameters
    limit: number = 100
  ): Promise<string> => {
    const conditions: string[] = [];

    // Get mapping from semantic dimension names to actual field names (async now)
    const semanticToFieldMap = await getSemanticToFieldMapping();

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

      // Map semantic dimension name to actual field name if available
      // This is the critical fix: convert "k8s-statefulset" → "k8s_statefulset_name"
      const actualFieldName = semanticToFieldMap[field] || field;

      // Log the mapping for debugging
      if (semanticToFieldMap[field]) {
        console.log(`[useCorrelatedLogs] Using field "${actualFieldName}" for semantic dimension "${field}"`);
      }

      // Quote field names if they contain special characters (dots, hyphens, etc.)
      const quotedField = /[^a-zA-Z0-9_]/.test(actualFieldName)
        ? `"${actualFieldName.replace(/"/g, '""')}"`
        : actualFieldName;

      // Escape single quotes in values
      const escapedValue = String(value).replace(/'/g, "''");

      conditions.push(`${quotedField} = '${escapedValue}'`);
    }

    // Always quote stream name to match dashboard behavior
    // This ensures consistency with working queries
    const quotedStream = `"${streamName.replace(/"/g, '""')}"`;

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sqlQuery = `SELECT * FROM ${quotedStream} ${whereClause} ORDER BY _timestamp DESC LIMIT ${limit}`;

    console.log('[useCorrelatedLogs] Generated SQL query:', sqlQuery);

    return sqlQuery;
  };

  /**
   * Fetch correlated logs from search API using HTTP streaming
   */
  const fetchCorrelatedLogs = async () => {
    // Cancel previous request if exists
    if (currentTraceId) {
      cancelStreamQueryBasedOnRequestId({
        trace_id: currentTraceId,
        org_id: store.state.selectedOrganization.identifier,
      });
    }

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
    searchResults.value = []; // Clear previous results

    try {
      // Build SQL query (now async to support dynamic semantic group loading)
      const sqlQuery = await buildSQLQuery(
        primaryStream.value,
        currentFilters.value,
        currentTimeRange.value,
        pageSize.value
      );

      console.log('[useCorrelatedLogs] SQL Query:', sqlQuery);

      // Prepare search query
      // Note: timestamps in timeRange are in microseconds
      // API expects microseconds, so NO conversion needed
      const startTimeMicros = currentTimeRange.value.startTime;
      const endTimeMicros = currentTimeRange.value.endTime;

      console.log('[useCorrelatedLogs] Time range (microseconds):', {
        startTimeMicros,
        endTimeMicros
      });

      // Generate trace context for streaming
      const traceContext = generateTraceContext();
      const traceId = traceContext?.traceId || '';
      currentTraceId = traceId;

      // Build search query - clean structure matching logs page format
      const searchQuery = {
        query: {
          sql: sqlQuery,
          sql_mode: 'full',
          start_time: startTimeMicros,
          end_time: endTimeMicros,
          size: pageSize.value,
        },
      };

      console.log('[useCorrelatedLogs] Search query:', JSON.stringify(searchQuery, null, 2));
      console.log('[useCorrelatedLogs] Trace ID:', traceId);

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
            console.log('[useCorrelatedLogs] ===== Stream data event =====');
            console.log('[useCorrelatedLogs] Event type:', response.type);
            console.log('[useCorrelatedLogs] Full response:', JSON.stringify(response, null, 2));

            // Handle metadata event
            if (response.type === 'search_response_metadata') {
              const results = response.content?.results;
              if (results) {
                totalHits.value = results.total || 0;
                took.value = results.took || 0;
                console.log(`[useCorrelatedLogs] Metadata: ${totalHits.value} total hits, ${took.value}ms`);
              }
            }

            // Handle hits event (this has the actual data)
            // Raw backend response: {"hits": [{...}, {...}]}
            // After wsMapper: response.content.results = {"hits": [{...}, {...}]}
            if (response.type === 'search_response_hits') {
              console.log('[useCorrelatedLogs] Hits response.content:', response.content);
              console.log('[useCorrelatedLogs] Hits response.content.results:', response.content?.results);

              // The results object IS the hits container {"hits": [...]}
              const resultsObj = response.content?.results;
              const hits = resultsObj?.hits || [];

              console.log(`[useCorrelatedLogs] Extracted hits array:`, hits);
              console.log(`[useCorrelatedLogs] Received ${hits.length} hits`);

              // Append hits (streaming can send multiple chunks)
              if (hits.length > 0) {
                searchResults.value.push(...hits);
                console.log(`[useCorrelatedLogs] Total accumulated: ${searchResults.value.length} logs`);
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
            console.log('[useCorrelatedLogs] ===== Stream complete =====');
            console.log('[useCorrelatedLogs] Final searchResults count:', searchResults.value.length);
            console.log('[useCorrelatedLogs] Final totalHits:', totalHits.value);
            console.log('[useCorrelatedLogs] hasResults:', hasResults.value);
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
