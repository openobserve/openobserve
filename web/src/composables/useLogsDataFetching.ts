/**
 * useLogsDataFetching.ts
 * 
 * Manages data fetching operations for the logs module.
 * Handles HTTP requests, query execution, data retrieval, and result processing.
 * Provides functionality for search queries, pagination, and job-based data fetching.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useStore } from 'vuex';
import searchService from '@/services/search';
import { useI18n } from 'vue-i18n';
import { logsErrorMessage } from '@/utils/common';
import type { 
  UseLogsDataFetching,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * Data Fetching Composable
 * 
 * Provides comprehensive data fetching functionality including:
 * - Query execution and result retrieval
 * - Pagination and job-based data fetching
 * - Error handling and retry mechanisms
 * - Response processing and transformation
 * - Search around functionality
 * - Partition and aggregate data fetching
 */
export default function useLogsDataFetching(
  searchObj: Ref<SearchObject>
): UseLogsDataFetching {
  const store = useStore();
  const { t } = useI18n();

  // ========================================
  // REACTIVE STATE
  // ========================================

  // Request tracking
  const currentSearchRequest = ref<any>(null);
  const requestId = ref<string>('');
  const abortController = ref<AbortController | null>(null);

  // Loading states
  const isSearchLoading = ref<boolean>(false);
  const isHistogramLoading = ref<boolean>(false);
  const isPageCountLoading = ref<boolean>(false);
  const isJobDataLoading = ref<boolean>(false);

  // Error tracking
  const lastError = ref<any>(null);
  const retryCount = ref<number>(0);
  const maxRetries = ref<number>(3);

  // Performance tracking
  const searchDebug = ref<{
    queryStartTime: number;
    queryEndTime: number;
    buildSearchTime: number;
    networkTime: number;
    processingTime: number;
  }>({
    queryStartTime: 0,
    queryEndTime: 0,
    buildSearchTime: 0,
    networkTime: 0,
    processingTime: 0,
  });

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const isLoading: ComputedRef<boolean> = computed(() => 
    isSearchLoading.value || 
    isHistogramLoading.value || 
    isPageCountLoading.value || 
    isJobDataLoading.value
  );

  const hasActiveRequest: ComputedRef<boolean> = computed(() => 
    currentSearchRequest.value !== null
  );

  const canRetry: ComputedRef<boolean> = computed(() => 
    retryCount.value < maxRetries.value
  );

  // ========================================
  // CORE DATA FETCHING FUNCTIONS
  // ========================================

  /**
   * Executes a search query and retrieves results
   * 
   * @param queryRequest The search query request payload
   * @param isPagination Whether this is a pagination request
   * @param appendResult Whether to append results to existing data
   * @returns Promise resolving to search response
   */
  const executeSearchQuery = async (
    queryRequest: any, 
    isPagination: boolean = false, 
    appendResult: boolean = false
  ): Promise<any> => {
    try {
      isSearchLoading.value = true;
      searchDebug.value.queryStartTime = performance.now();
      
      // Create new abort controller for this request
      abortController.value = new AbortController();
      currentSearchRequest.value = queryRequest;

      // Generate unique request ID
      requestId.value = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Add request metadata
      const enhancedRequest = {
        ...queryRequest,
        request_id: requestId.value,
        trace_id: generateTraceId(),
      };

      // Execute the search request
      const networkStartTime = performance.now();
      const response = await searchService.search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: enhancedRequest,
        },
        "logs",
        { signal: abortController.value.signal }
      );
      
      searchDebug.value.networkTime = performance.now() - networkStartTime;
      searchDebug.value.queryEndTime = performance.now();

      // Process the response
      const processedResponse = await processSearchResponse(response, isPagination, appendResult);
      
      // Reset retry count on successful request
      retryCount.value = 0;
      lastError.value = null;

      return processedResponse;

    } catch (error: any) {
      await handleSearchError(error, queryRequest, isPagination, appendResult);
      throw error;
    } finally {
      isSearchLoading.value = false;
      currentSearchRequest.value = null;
      abortController.value = null;
    }
  };

  /**
   * Processes search response and updates application state
   * 
   * @param response Raw API response
   * @param isPagination Whether this is pagination request
   * @param appendResult Whether to append to existing results
   * @returns Processed response data
   */
  const processSearchResponse = async (
    response: any, 
    isPagination: boolean = false, 
    appendResult: boolean = false
  ): Promise<any> => {
    const processingStartTime = performance.now();

    try {
      // Clear previous errors
      searchObj.value.data.errorMsg = '';
      searchObj.value.data.errorCode = 0;
      searchObj.value.data.additionalErrorMsg = '';

      // Extract response data
      const responseData = response.data;
      const hits = responseData.hits || [];
      const total = responseData.total || 0;
      const took = responseData.took || 0;
      const scanSize = responseData.scan_size || 0;

      // Update query results
      if (appendResult && isPagination) {
        // Append to existing results for pagination
        searchObj.value.data.queryResults.hits = [
          ...(searchObj.value.data.queryResults.hits || []),
          ...hits
        ];
      } else {
        // Replace existing results
        searchObj.value.data.queryResults.hits = hits;
      }

      // Update metadata
      searchObj.value.data.queryResults.total = total;
      searchObj.value.data.queryResults.took = took;
      searchObj.value.data.queryResults.scan_size = scanSize;
      searchObj.value.data.queryResults.columns = responseData.columns || [];

      // Process histogram data if available
      if (responseData.aggs && responseData.aggs.length > 0) {
        await processHistogramData(responseData.aggs);
      }

      // Update function/transform results if present
      if (responseData.function_error) {
        searchObj.value.data.functionErrorMsg = responseData.function_error;
      } else {
        searchObj.value.data.functionErrorMsg = '';
      }

      // Sort results if needed
      await sortQueryResults();

      // Update pagination state
      updatePaginationState(total, isPagination);

      searchDebug.value.processingTime = performance.now() - processingStartTime;

      return {
        hits,
        total,
        took,
        scan_size: scanSize,
        columns: responseData.columns,
        aggs: responseData.aggs,
      };

    } catch (error) {
      console.error('Error processing search response:', error);
      throw error;
    }
  };

  /**
   * Handles search errors with retry logic and user feedback
   */
  const handleSearchError = async (
    error: any, 
    queryRequest: any, 
    isPagination: boolean = false, 
    appendResult: boolean = false
  ): Promise<void> => {
    lastError.value = error;

    // Extract error information
    let errorMsg = 'An error occurred while searching.';
    let errorCode = 0;
    let traceId = '';

    if (error?.response?.data) {
      errorMsg = error.response.data.message || error.response.data.error || errorMsg;
      errorCode = error.response.data.code || error.response.status || 0;
      traceId = error.response.data.trace_id || '';
    } else if (error?.message) {
      errorMsg = error.message;
    }

    // Get custom error message if available
    const customMessage = logsErrorMessage(errorCode);
    if (customMessage) {
      errorMsg = customMessage;
    }

    // Update error state
    searchObj.value.data.errorMsg = errorMsg;
    searchObj.value.data.errorCode = errorCode;
    searchObj.value.data.errorDetail = error?.response?.data?.error_detail || '';

    if (traceId) {
      searchObj.value.data.additionalErrorMsg = `TraceID: ${traceId}`;
    }

    // Handle specific error types
    if (error?.name === 'AbortError') {
      searchObj.value.data.errorMsg = 'Search request was cancelled.';
      return;
    }

    // Implement retry logic for transient errors
    if (shouldRetryError(error) && canRetry.value) {
      retryCount.value++;
      console.log(`Retrying search request (attempt ${retryCount.value}/${maxRetries.value})`);
      
      // Exponential backoff delay
      const delay = Math.pow(2, retryCount.value) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Retry the request
      try {
        await executeSearchQuery(queryRequest, isPagination, appendResult);
      } catch (retryError) {
        console.error('Retry failed:', retryError);
      }
    }
  };

  /**
   * Determines if an error should trigger a retry
   */
  const shouldRetryError = (error: any): boolean => {
    const status = error?.response?.status;
    
    // Retry on network errors and certain HTTP status codes
    if (!status || status >= 500 || status === 429) {
      return true;
    }

    // Don't retry on client errors (4xx except 429)
    if (status >= 400 && status < 500 && status !== 429) {
      return false;
    }

    return false;
  };

  // ========================================
  // JOB-BASED DATA FETCHING
  // ========================================

  /**
   * Fetches job-based search results
   * 
   * @param jobId The job identifier
   * @param isPagination Whether this is pagination
   * @returns Promise resolving to job data
   */
  const fetchJobData = async (jobId: string, isPagination: boolean = false): Promise<any> => {
    try {
      isJobDataLoading.value = true;
      
      const response = await searchService.getJobResults(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          job_id: jobId,
        },
        "logs"
      );

      const processedResponse = await processSearchResponse(response, isPagination);
      return processedResponse;

    } catch (error) {
      console.error('Error fetching job data:', error);
      throw error;
    } finally {
      isJobDataLoading.value = false;
    }
  };

  // ========================================
  // SEARCH AROUND FUNCTIONALITY
  // ========================================

  /**
   * Executes search around functionality for a specific record
   * 
   * @param record The record to search around
   * @param size Number of records to retrieve
   * @returns Promise resolving to search around results
   */
  const executeSearchAround = async (record: any, size: number = 10): Promise<any> => {
    try {
      // Extract timestamp from record
      const timestamp = record[store.state.zoConfig.timestamp_column] || record._timestamp;
      if (!timestamp) {
        throw new Error('No timestamp found in record for search around');
      }

      // Build search around query
      const searchAroundRequest = {
        query: {
          sql: `SELECT * FROM "${searchObj.value.data.stream.selectedStream[0]}" WHERE ${store.state.zoConfig.timestamp_column} >= ${timestamp - (size * 1000)} AND ${store.state.zoConfig.timestamp_column} <= ${timestamp + (size * 1000)} ORDER BY ${store.state.zoConfig.timestamp_column}`,
          start_time: timestamp - (size * 1000000), // Convert to microseconds
          end_time: timestamp + (size * 1000000),
          size: size * 2,
          from: 0,
        },
        aggs: {
          histogram: `SELECT histogram(${store.state.zoConfig.timestamp_column}, '1 second') AS zo_sql_key, count(*) AS zo_sql_num FROM query GROUP BY zo_sql_key ORDER BY zo_sql_key`,
        },
      };

      const response = await executeSearchQuery(searchAroundRequest, false, false);

      // Update search around state
      searchObj.value.data.searchAround = {
        indexTimestamp: timestamp,
        size: response.hits?.length || 0,
        hits: response.hits || [],
      };

      return response;

    } catch (error) {
      console.error('Error in search around:', error);
      throw error;
    }
  };

  // ========================================
  // PAGINATION AND COUNT QUERIES
  // ========================================

  /**
   * Fetches page count for pagination
   * 
   * @param queryRequest Base query request
   * @returns Promise resolving to page count data
   */
  const fetchPageCount = async (queryRequest: any): Promise<number> => {
    try {
      isPageCountLoading.value = true;

      // Build count query by modifying the original request
      const countRequest = {
        ...queryRequest,
        query: {
          ...queryRequest.query,
          size: 0, // Only get count, no actual records
          from: 0,
        },
        aggs: {}, // Remove aggregations for count query
      };

      const response = await searchService.search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: countRequest,
        },
        "logs"
      );

      const total = response.data.total || 0;
      
      // Update pagination info
      searchObj.value.data.queryResults.total = total;
      
      return total;

    } catch (error) {
      console.error('Error fetching page count:', error);
      searchObj.value.data.countErrorMsg = 'Error retrieving total count';
      return 0;
    } finally {
      isPageCountLoading.value = false;
    }
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Generates a unique trace ID for request tracking
   */
  const generateTraceId = (): string => {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  /**
   * Cancels the current search request
   */
  const cancelCurrentRequest = (): void => {
    if (abortController.value) {
      abortController.value.abort();
      abortController.value = null;
    }
    
    currentSearchRequest.value = null;
    isSearchLoading.value = false;
    isHistogramLoading.value = false;
    isPageCountLoading.value = false;
    isJobDataLoading.value = false;
  };

  /**
   * Processes histogram data from search response
   */
  const processHistogramData = async (aggs: any[]): Promise<void> => {
    if (!aggs || aggs.length === 0) return;

    try {
      // Process histogram aggregation
      const histogramAgg = aggs[0];
      const buckets = histogramAgg.buckets || [];

      const xData: string[] = [];
      const yData: number[] = [];

      buckets.forEach((bucket: any) => {
        xData.push(bucket.key);
        yData.push(bucket.doc_count || 0);
      });

      // Update histogram state
      searchObj.value.data.histogram = {
        xData,
        yData,
        chartParams: {
          title: 'Event Distribution',
          unparsed_x_data: xData,
          timezone: store.state.timezone || 'UTC',
        },
        errorCode: 0,
        errorMsg: '',
        errorDetail: '',
      };

    } catch (error) {
      console.error('Error processing histogram data:', error);
      searchObj.value.data.histogram.errorMsg = 'Error processing histogram data';
    }
  };

  /**
   * Sorts query results based on current sort configuration
   */
  const sortQueryResults = async (): Promise<void> => {
    if (!searchObj.value.data.queryResults.hits) return;

    const sortBy = searchObj.value.data.resultGrid.sortBy;
    const sortOrder = searchObj.value.data.resultGrid.sortOrder || 'desc';

    if (!sortBy) return;

    try {
      searchObj.value.data.sortedQueryResults = [...searchObj.value.data.queryResults.hits].sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];

        // Handle different data types
        let comparison = 0;
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
    } catch (error) {
      console.error('Error sorting query results:', error);
      // Fall back to unsorted results
      searchObj.value.data.sortedQueryResults = searchObj.value.data.queryResults.hits;
    }
  };

  /**
   * Updates pagination state after data fetch
   */
  const updatePaginationState = (total: number, isPagination: boolean): void => {
    if (!isPagination) {
      // Reset to first page for new searches
      searchObj.value.data.resultGrid.currentPage = 1;
    }

    // Update total records
    searchObj.value.data.queryResults.total = total;
  };

  /**
   * Resets all loading states
   */
  const resetLoadingStates = (): void => {
    isSearchLoading.value = false;
    isHistogramLoading.value = false;
    isPageCountLoading.value = false;
    isJobDataLoading.value = false;
  };

  /**
   * Resets error state
   */
  const resetErrorState = (): void => {
    lastError.value = null;
    retryCount.value = 0;
    searchObj.value.data.errorMsg = '';
    searchObj.value.data.errorCode = 0;
    searchObj.value.data.errorDetail = '';
    searchObj.value.data.additionalErrorMsg = '';
  };

  /**
   * Gets current performance metrics
   */
  const getPerformanceMetrics = (): any => {
    return {
      ...searchDebug.value,
      totalTime: searchDebug.value.queryEndTime - searchDebug.value.queryStartTime,
    };
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // State
    isLoading,
    isSearchLoading,
    isHistogramLoading,
    isPageCountLoading,
    isJobDataLoading,
    hasActiveRequest,
    canRetry,
    lastError,
    requestId,
    retryCount,

    // Core Functions
    executeSearchQuery,
    processSearchResponse,
    handleSearchError,
    
    // Job Data
    fetchJobData,
    
    // Search Around
    executeSearchAround,
    
    // Pagination
    fetchPageCount,
    
    // Utility Functions
    cancelCurrentRequest,
    resetLoadingStates,
    resetErrorState,
    generateTraceId,
    getPerformanceMetrics,
    
    // Data Processing
    processHistogramData,
    sortQueryResults,
    updatePaginationState,

    // Debug Information
    searchDebug,
  };
}