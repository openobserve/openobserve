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

import { ref, reactive } from "vue";
import { useStore } from "vuex";
import { useLogsState } from "@/composables/useLogsState";
import useWebSocket from "@/composables/useWebSocket";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useStreamingSearch from "@/composables/useStreamingSearch";
import { useNotifications } from "@/composables/useNotifications";
import {
  isWebSocketEnabled,
  isStreamingEnabled,
  generateTraceContext,
  getUUID
} from "@/utils/zincutils";
import {
  buildWebSocketPayload as buildWebSocketPayloadUtil,
  type WebSocketPayloadParams
} from "@/utils/logs/transformers";
import {
  type SearchRequestPayload,
  type WebSocketSearchResponse,
  type WebSocketSearchPayload,
  type WebSocketErrorResponse
} from "@/ts/interfaces/query";

type CommunicationMethod = "http" | "ws" | "streaming";

interface WebSocketHandlers {
  open: (payload: any) => void;
  close: (payload: any, response: any) => void;
  error: (payload: any, error: WebSocketErrorResponse) => void;
  message: (payload: WebSocketSearchPayload, response: WebSocketSearchResponse) => void;
  reset: (data: any, traceId?: string) => void;
}

interface StreamingHandlers {
  data: (payload: WebSocketSearchPayload, response: WebSocketSearchResponse) => void;
  error: (payload: any, error: WebSocketErrorResponse) => void;
  complete: (payload: any, response: any) => void;
  reset: (data: any, traceId?: string) => void;
}

/**
 * WebSocket and streaming communication management composable for logs functionality
 * Contains all WebSocket connection handling, message processing, and streaming operations
 */
export const useLogsWebSocket = () => {
  const store = useStore();
  const { searchObj, searchAggData } = useLogsState();
  const { showErrorNotification, showCancelSearchNotification } = useNotifications();

  // WebSocket service composables
  const {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
    closeSocketBasedOnRequestId,
  } = useSearchWebSocket();

  const {
    fetchQueryDataWithHttpStream,
  } = useStreamingSearch();

  // State for tracking partitions and WebSocket connections
  const searchPartitionMap = reactive<{ [key: string]: number }>({});

  /**
   * Determine the appropriate communication method based on configuration
   */
  const setCommunicationMethod = (): CommunicationMethod => {
    try {
      const shouldUseWebSocket = isWebSocketEnabled(store.state);
      const shouldUseStreaming = isStreamingEnabled(store.state);
      const isMultiStreamSearch = searchObj.data.stream.selectedStream.length > 1 && !searchObj.meta.sqlMode;

      if (shouldUseStreaming && !isMultiStreamSearch) {
        searchObj.communicationMethod = "streaming";
        return "streaming";
      } else if (shouldUseWebSocket && !isMultiStreamSearch) {
        searchObj.communicationMethod = "ws";
        return "ws";
      } else {
        searchObj.communicationMethod = "http";
        return "http";
      }
    } catch (error: any) {
      console.error("Error setting communication method:", error);
      searchObj.communicationMethod = "http";
      return "http";
    }
  };

  /**
   * Build WebSocket payload for different request types
   */
  const buildWebSocketPayload = (
    queryReq: SearchRequestPayload,
    isPagination: boolean,
    type: "search" | "histogram" | "pageCount" | "values",
    meta?: any,
  ) => {
    try {
      if (!queryReq) {
        console.error("Error building WebSocket payload: queryReq is required");
        return null;
      }
      
      const params: WebSocketPayloadParams = {
        queryReq,
        isPagination,
        type,
        searchObj,
        meta
      };
      
      const { payload, traceId } = buildWebSocketPayloadUtil(params);
      addTraceId(traceId);

      return payload;
    } catch (error: any) {
      console.error("Error building WebSocket payload:", error);
      return null;
    }
  };

  /**
   * Initialize search connection using appropriate method (WebSocket or Streaming)
   */
  const initializeSearchConnection = (payload: any): string | Promise<void> | null => {
    try {
      // Use the appropriate method to fetch data
      if (searchObj.communicationMethod === "ws") {
        return fetchQueryDataWithWebSocket(payload, {
          open: sendSearchMessage,
          close: handleSearchClose,
          error: handleSearchError,
          message: handleSearchResponse,
          reset: handleSearchReset,
        }) as string;
      } else if (searchObj.communicationMethod === "streaming") {
        payload.searchType = "ui";
        payload.pageType = searchObj.data.stream.streamType;
        return fetchQueryDataWithHttpStream(payload, {
          data: handleSearchResponse,
          error: handleSearchError,
          complete: handleSearchClose,
          reset: handleSearchReset,
        }) as Promise<void>;
      }

      return null;
    } catch (error: any) {
      console.error("Error initializing search connection:", error);
      throw error;
    }
  };

  /**
   * Add trace ID to tracking arrays
   */
  const addTraceId = (traceId: string) => {
    try {
      if (searchObj.communicationMethod === "http") {
        if (searchObj.data.searchRequestTraceIds.includes(traceId)) {
          return;
        }
        searchObj.data.searchRequestTraceIds.push(traceId);
      } else {
        if (searchObj.data.searchWebSocketTraceIds.includes(traceId)) {
          return;
        }
        searchObj.data.searchWebSocketTraceIds.push(traceId);
      }
    } catch (error: any) {
      console.error("Error adding trace ID:", error);
    }
  };

  /**
   * Remove trace ID from tracking arrays
   */
  const removeTraceId = (traceId: string) => {
    try {
      if (searchObj.communicationMethod === "http") {
        searchObj.data.searchRequestTraceIds = searchObj.data.searchRequestTraceIds.filter(
          (id: string) => id !== traceId,
        );
      } else {
        searchObj.data.searchWebSocketTraceIds = searchObj.data.searchWebSocketTraceIds.filter(
          (_traceId: string) => _traceId !== traceId,
        );
      }
    } catch (error: any) {
      console.error("Error removing trace ID:", error);
    }
  };

  /**
   * Send search message via WebSocket
   */
  const sendSearchMessage = (queryReq: any) => {
    try {
      if (!queryReq) {
        console.error("Error sending search message: queryReq is null or undefined");
        return;
      }
      
      if (searchObj.data.isOperationCancelled) {
        closeSocketBasedOnRequestId(queryReq.traceId);
        return;
      }

      const payload = {
        type: "search",
        content: {
          trace_id: queryReq.traceId,
          payload: {
            query: queryReq.queryReq.query,
            // Pass encoding if enabled
            ...(store.state.zoConfig.sql_base64_enabled
              ? { encoding: queryReq.queryReq.encoding }
              : {}),
          },
        },
      };

      sendSearchMessageBasedOnRequestId(payload);
    } catch (error: any) {
      searchObj.loading = false;
      showErrorNotification("Error occurred while sending socket message.");
      console.error("Error sending search message:", error);
    }
  };

  /**
   * Send cancel search message via WebSocket
   */
  const sendCancelSearchMessage = (searchRequests: any[]) => {
    try {
      if (!searchRequests || !searchRequests.length) {
        searchObj.data.isOperationCancelled = false;
        return;
      }

      searchObj.data.isOperationCancelled = true;

      // Cancel all requests by trace ID
      searchRequests.forEach((traceId) => {
        cancelSearchQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: store?.state?.selectedOrganization?.identifier,
        });
      });
    } catch (error: any) {
      console.error("Error sending cancel search message:", error);
      searchObj.data.isOperationCancelled = false;
    }
  };

  /**
   * Handle search reset event
   */
  const handleSearchReset = async (data: any, traceId?: string) => {
    try {
      if (data.type === "search") {
        if (!data.isPagination) {
          // Reset query data for new searches
          searchObj.data.queryResults = {};
          searchObj.data.sortedQueryResults = [];
        }

        // Reset aggregation data
        searchAggData.total = 0;
        searchAggData.hasAggregation = false;
        searchObj.meta.showDetailTab = false;
        searchObj.meta.searchApplied = true;
        searchObj.data.functionError = "";

        // Reset histogram error
        if (searchObj.data.histogram) {
          searchObj.data.histogram.errorMsg = "";
          searchObj.data.histogram.errorCode = 0;
          searchObj.data.histogram.errorDetail = "";
        }

        const payload = buildWebSocketPayload(data.queryReq, data.isPagination, "search");
        initializeSearchConnection(payload);
        addTraceId(payload.traceId);
      }

      if (data.type === "histogram" || data.type === "pageCount") {
        searchObj.data.queryResults.aggs = [];

        // Reset histogram error
        if (searchObj.data.histogram) {
          searchObj.data.histogram.errorMsg = "";
          searchObj.data.histogram.errorCode = 0;
          searchObj.data.histogram.errorDetail = "";
        }

        searchObj.loadingHistogram = true;

        const payload = buildWebSocketPayload(
          data.queryReq,
          false,
          data.type,
        );

        initializeSearchConnection(payload);
        addTraceId(payload.traceId);
      }
    } catch (error: any) {
      console.error("Error handling search reset:", error);
      searchObj.loading = false;
      showErrorNotification("Error occurred during search reset.");
    }
  };

  /**
   * Handle WebSocket search response
   */
  const handleSearchResponse = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
  ) => {
    try {
      if (!payload || !response) {
        console.error("Error handling search response: payload or response is null");
        return;
      }
      
      // Handle search hits response
      if (payload.type === "search" && response?.type === "search_response_hits") {
        handleStreamingHits(payload, response, payload.isPagination, 
          !(response.content?.streaming_aggs || searchObj.data.queryResults.streaming_aggs) && 
          searchPartitionMap[payload.traceId] > 1
        );
        return;
      }

      // Handle search metadata response
      if (payload.type === "search" && response?.type === "search_response_metadata") {
        searchPartitionMap[payload.traceId] = searchPartitionMap[payload.traceId] || 0;
        searchPartitionMap[payload.traceId]++;
        handleStreamingMetadata(payload, response, payload.isPagination, 
          !response.content?.streaming_aggs && searchPartitionMap[payload.traceId] > 1
        );
        return;
      }

      // Handle histogram responses
      if (payload.type === "histogram" && response?.type === "search_response_hits") {
        handleHistogramStreamingHits(payload, response, payload.isPagination);
        return;
      }

      if (payload.type === "histogram" && response?.type === "search_response_metadata") {
        handleHistogramStreamingMetadata(payload, response, payload.isPagination);
        return;
      }

      // Handle page count responses
      if (payload.type === "pageCount" && response?.type === "search_response_hits") {
        handlePageCountStreamingHits(payload, response, payload.isPagination);
        return;
      }

      if (payload.type === "pageCount" && response?.type === "search_response_metadata") {
        handlePageCountStreamingMetadata(payload, response, payload.isPagination);
        return;
      }

      // Handle cancel response
      if (response.type === "cancel_response") {
        searchObj.loading = false;
        searchObj.loadingHistogram = false;
        searchObj.data.isOperationCancelled = false;
        showCancelSearchNotification();
        setCancelSearchError();
      }
    } catch (error: any) {
      console.error("Error handling search response:", error);
      handleSearchError(payload, {
        content: {
          message: "Error processing search response",
          trace_id: payload.traceId,
          error: error.message
        },
        type: "error"
      });
    }
  };

  /**
   * Handle streaming hits data
   */
  const handleStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      searchObj.loading = false;

      // Update scan size and timing
      if (isPagination) {
        searchObj.data.queryResults.scan_size += response.content.results.scan_size;
        searchObj.data.queryResults.took += response.content.results.took;
      } else {
        searchObj.data.queryResults.scan_size = response.content.results.scan_size;
        searchObj.data.queryResults.took = response.content.results.took;
      }

      // Process hits data
      if (appendResult && searchObj.data.queryResults.hits) {
        searchObj.data.queryResults.hits.push(...response.content.results.hits);
      } else {
        searchObj.data.queryResults.hits = response.content.results.hits;
      }

      // Process post pagination data
      processPostPaginationData();
    } catch (error: any) {
      console.error("Error handling streaming hits:", error);
    }
  };

  /**
   * Handle streaming metadata
   */
  const handleStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      // Handle function errors
      handleFunctionError(payload.queryReq, response);
      
      // Update metadata based on response type
      if (!isPagination) {
        searchObj.data.queryResults.total = response.content.results.total;
        searchObj.data.queryResults.from = response.content.results.from || 0;
        searchObj.data.queryResults.scan_size += response.content.results.scan_size;
        searchObj.data.queryResults.took += response.content.results.took;
      } else {
        if (isPagination && response.content?.streaming_aggs) {
          searchObj.data.queryResults.from = response.content.results.from;
          searchObj.data.queryResults.scan_size = response.content.results.scan_size;
          searchObj.data.queryResults.took = response.content.results.took;
        } else if (response.content?.streaming_aggs) {
          searchObj.data.queryResults = {
            ...response.content.results,
            took: (searchObj.data?.queryResults?.took || 0) + response.content.results.took,
            scan_size: (searchObj.data?.queryResults?.scan_size || 0) + response.content.results.scan_size,
            hits: searchObj.data?.queryResults?.hits || [],
            streaming_aggs: response.content?.streaming_aggs,
          };
        } else if (isPagination) {
          searchObj.data.queryResults.from = response.content.results.from;
          searchObj.data.queryResults.scan_size = response.content.results.scan_size;
          searchObj.data.queryResults.took = response.content.results.took;
        }
      }

      // Handle streaming aggregations
      searchObj.data.queryResults.streaming_aggs = response?.content?.streaming_aggs;

      // Remove trace ID when complete
      removeTraceId(response.content.traceId);

      // Process aggregations if present
      if (response.content.results.aggs) {
        if (searchObj.data.queryResults.aggs == null) {
          searchObj.data.queryResults.aggs = [];
        }
        
        if (appendResult) {
          searchObj.data.queryResults.aggs.push(...response.content.results.aggs);
        } else {
          searchObj.data.queryResults.aggs = response.content.results.aggs;
        }
      }
    } catch (error: any) {
      console.error("Error handling streaming metadata:", error);
    }
  };

  /**
   * Handle histogram streaming hits
   */
  const handleHistogramStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      searchObj.loading = false;

      // Process histogram aggregation data
      if (response.content.results.aggs) {
        if (searchObj.data.queryResults.aggs == null) {
          searchObj.data.queryResults.aggs = [];
        }
        
        if (appendResult) {
          searchObj.data.queryResults.aggs.push(...response.content.results.aggs);
        } else {
          searchObj.data.queryResults.aggs = response.content.results.aggs;
        }
      }
    } catch (error: any) {
      console.error("Error handling histogram streaming hits:", error);
      searchObj.loadingHistogram = false;
    }
  };

  /**
   * Handle histogram streaming metadata
   */
  const handleHistogramStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      searchObj.data.queryResults.scan_size += response.content.results.scan_size;
      searchObj.data.queryResults.took += response.content.results.took;

      // Handle streaming aggregations
      searchObj.data.queryResults.streaming_aggs = response?.content?.streaming_aggs;

      removeTraceId(response.content.traceId);

      if (response.content.results.aggs) {
        if (searchObj.data.queryResults.aggs == null) {
          searchObj.data.queryResults.aggs = [];
        }
        searchObj.data.queryResults.aggs.push(...response.content.results.aggs);
      }

      searchObj.loadingHistogram = false;
    } catch (error: any) {
      console.error("Error handling histogram streaming metadata:", error);
      searchObj.loadingHistogram = false;
    }
  };

  /**
   * Handle page count streaming hits
   */
  const handlePageCountStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      // Check if pagination regeneration is needed
      let regeneratePaginationFlag = false;
      if (response.content.results.hits.length != searchObj.meta.resultGrid.rowsPerPage) {
        regeneratePaginationFlag = true;
      }
    
      // Handle streaming aggregations
      if (response.content?.streaming_aggs || searchObj.data.queryResults.streaming_aggs) {
        searchObj.data.queryResults.aggs = response.content.results.hits;
      } else {
        searchObj.data.queryResults.aggs.push(...response.content.results.hits);
      }

      searchObj.loadingCounter = false;
    } catch (error: any) {
      console.error("Error handling page count streaming hits:", error);
      searchObj.loadingCounter = false;
    }
  };

  /**
   * Handle page count streaming metadata
   */
  const handlePageCountStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false
  ) => {
    try {
      removeTraceId(response.content.traceId);

      if (searchObj.data.queryResults.aggs == null) {
        searchObj.data.queryResults.aggs = [];
      }

      searchObj.data.queryResults.streaming_aggs = response?.content?.streaming_aggs;
      searchObj.data.queryResults.scan_size += response.content.results.scan_size;
      searchObj.data.queryResults.took += response.content.results.took;
    } catch (error: any) {
      console.error("Error handling page count streaming metadata:", error);
    }
  };

  /**
   * Handle search connection close
   */
  const handleSearchClose = (payload: any, response: any) => {
    try {
      if (payload.traceId) removeTraceId(payload.traceId);

      // Clean up partition map
      if (payload.traceId) delete searchPartitionMap[payload.traceId];

      if (searchObj.data.isOperationCancelled) {
        searchObj.loading = false;
        searchObj.loadingHistogram = false;
        searchObj.data.isOperationCancelled = false;
        showCancelSearchNotification();
        setCancelSearchError();
        return;
      }

      // Handle unexpected disconnections
      if (response && response.code !== 1000) {
        handleSearchError(payload, {
          content: {
            message: "WebSocket connection terminated unexpectedly. Please check your network and try again",
            trace_id: payload.traceId,
            code: response.code,
            error_detail: "",
          },
          type: "error",
        });
      }
    } catch (error: any) {
      console.error("Error handling search close:", error);
    }
  };

  /**
   * Handle search errors
   */
  const handleSearchError = (request: any, err: WebSocketErrorResponse) => {
    try {
      searchObj.loading = false;
      searchObj.loadingHistogram = false;

      const { message, trace_id, code, error_detail, error } = err.content;

      // Handle query cancelled error (code 20009)
      if (code === 20009) {
        showCancelSearchNotification();
        setCancelSearchError();
      }

      if (trace_id) removeTraceId(trace_id);

      // Construct error message
      const errorMsg = constructErrorMessage({
        message,
        code,
        error_detail,
        error
      });

      // Show error notification
      showErrorNotification(errorMsg);

      // Handle specific error cases
      if (message && message.includes("function")) {
        searchObj.data.functionError = message;
      }

      searchObj.data.errorCode = code || 0;
      searchObj.data.errorMsg = message || "";
      searchObj.data.errorDetail = error_detail || "";
    } catch (error: any) {
      console.error("Error handling search error:", error);
      showErrorNotification("An unexpected error occurred during search.");
    }
  };

  /**
   * Handle function errors in response
   */
  const handleFunctionError = (queryReq: SearchRequestPayload, response: any) => {
    try {
      if (
        response.content.results.hasOwnProperty("function_error") &&
        response.content.results.function_error != null
      ) {
        searchObj.data.functionError = response.content.results.function_error;
      }
    } catch (error: any) {
      console.error("Error handling function error:", error);
    }
  };

  /**
   * Set cancel search error state
   */
  const setCancelSearchError = () => {
    try {
      searchObj.data.histogram = {
        xData: [],
        yData: [],
        chartParams: {
          title: "",
          unparsed_x_data: [],
          timezone: "",
        },
        errorCode: 0,
        errorMsg: "Search query was cancelled",
        errorDetail: "Search query was cancelled",
      };
    } catch (error: any) {
      console.error("Error setting cancel search error:", error);
    }
  };

  /**
   * Process post pagination data
   */
  const processPostPaginationData = () => {
    try {
      // Implementation for post pagination processing
      // This would typically involve updating UI state after data is loaded
    } catch (error: any) {
      console.error("Error processing post pagination data:", error);
    }
  };

  /**
   * Construct error message from error components
   */
  const constructErrorMessage = (errorComponents: {
    message?: string;
    code?: number;
    error_detail?: string;
    error?: string;
  }) => {
    try {
      const { message, code, error_detail, error } = errorComponents;
      
      let errorMsg = message || "An error occurred";
      
      if (code) {
        errorMsg += ` (Code: ${code})`;
      }
      
      if (error_detail) {
        errorMsg += ` - ${error_detail}`;
      }
      
      if (error && error !== message) {
        errorMsg += ` - ${error}`;
      }
      
      return errorMsg;
    } catch (error: any) {
      console.error("Error constructing error message:", error);
      return "An unexpected error occurred";
    }
  };

  /**
   * Cancel query operations
   */
  const cancelQuery = () => {
    return new Promise((resolve) => {
      try {
        if (searchObj.communicationMethod === "ws") {
          sendCancelSearchMessage([...searchObj.data.searchWebSocketTraceIds]);
          resolve(true);
          return;
        }

        const tracesIds = [...searchObj.data.searchRequestTraceIds];
        
        if (!searchObj.data.searchRequestTraceIds.length) {
          searchObj.data.isOperationCancelled = false;
          resolve(true);
          return;
        }

        searchObj.data.isOperationCancelled = true;
        // Implementation for HTTP request cancellation would go here
        resolve(true);
      } catch (error: any) {
        console.error("Error cancelling query:", error);
        resolve(false);
      }
    });
  };

  /**
   * Get WebSocket connection statistics
   */
  const getConnectionStats = () => {
    try {
      return {
        communicationMethod: searchObj.communicationMethod,
        activeTraceIds: searchObj.communicationMethod === "ws" 
          ? searchObj.data.searchWebSocketTraceIds.length
          : searchObj.data.searchRequestTraceIds.length,
        activePartitions: Object.keys(searchPartitionMap).length,
        isOperationCancelled: searchObj.data.isOperationCancelled,
        isLoading: searchObj.loading,
        isHistogramLoading: searchObj.loadingHistogram
      };
    } catch (error: any) {
      console.error("Error getting connection stats:", error);
      return null;
    }
  };

  return {
    // Core WebSocket operations
    setCommunicationMethod,
    initializeSearchConnection,
    buildWebSocketPayload,
    
    // Message handling
    sendSearchMessage,
    sendCancelSearchMessage,
    handleSearchResponse,
    handleSearchClose,
    handleSearchError,
    handleSearchReset,
    
    // Streaming handlers
    handleStreamingHits,
    handleStreamingMetadata,
    handleHistogramStreamingHits,
    handleHistogramStreamingMetadata,
    handlePageCountStreamingHits,
    handlePageCountStreamingMetadata,
    
    // Trace ID management
    addTraceId,
    removeTraceId,
    
    // Utility functions
    cancelQuery,
    getConnectionStats,
    handleFunctionError,
    setCancelSearchError,
    processPostPaginationData,
    constructErrorMessage,
    
    // State references
    searchPartitionMap,
  };
};

export default useLogsWebSocket;