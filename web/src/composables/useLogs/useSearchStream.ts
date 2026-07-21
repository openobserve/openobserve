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

/**
 * Orchestrator that coordinates the split search composables:
 * - useSearchQuery - SQL query building and validation
 * - useSearchConnection - WebSocket/HTTP streaming connections
 * - useSearchResponseHandler - processes different response types
 * - useSearchHistogramManager - histogram-specific logic
 * - useSearchPagination - pagination calculations and state
 */

import { searchState } from "@/composables/useLogs/searchState";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useNotifications from "@/composables/useNotifications";

// Split composables
import useSearchQuery from "@/composables/useLogs/useSearchQuery";
import useSearchConnection from "@/composables/useLogs/useSearchConnection";
import useSearchResponseHandler from "@/composables/useLogs/useSearchResponseHandler";
import useSearchHistogramManager from "@/composables/useLogs/useSearchHistogramManager";
import useSearchPagination from "@/composables/useLogs/useSearchPagination";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

export const useSearchStream = () => {
  const { showErrorNotification } = useNotifications();
  const { addTraceId } = logsUtils();

  // Initialize all the split composables
  const queryBuilder = useSearchQuery();
  const connectionManager = useSearchConnection();
  const responseProcessor = useSearchResponseHandler();
  const histogramHandler = useSearchHistogramManager();
  const paginationManager = useSearchPagination();

  const { searchObj, resetQueryData } = searchState();

  /**
   * Main entry point for search operations
   * Delegates to appropriate split composables
   */
  const getDataThroughStream = (isPagination: boolean) => {
    try {
      if (!isPagination) resetQueryData();

      // 1. Build the query using the query composable
      const queryReq = queryBuilder.getQueryReq(isPagination);
      if (!queryReq) return;

      // 2. Set up response callbacks
      const callbacks = {
        onData: responseProcessor.handleSearchResponse,
        onError: responseProcessor.handleSearchError,
        onComplete: handleSearchComplete,
        onReset: handleSearchReset,
      };

      // 3. Execute the search through connection manager
      connectionManager.getDataThroughStream(queryReq, isPagination, callbacks);
    } catch (error: any) {
      console.error("Search operation failed:", error);
      searchObj.loading = false;
      showErrorNotification("Error occurred during the search operation.");
    }
  };

  const getHistogramData = (queryReq: any,meta: any) => {
    const histogramCallbacks = {
      onData: responseProcessor.handleSearchResponse,
      onError: responseProcessor.handleSearchError,
      onComplete: handleSearchComplete,
      onReset: handleSearchReset,
          };

    histogramHandler.processHistogramRequest(
      queryReq,
      connectionManager.buildWebSocketPayload,
      connectionManager.initializeSearchConnection,
      histogramCallbacks,
      meta
    );
  };

  /**
   * Handle search completion
   * Orchestrates histogram processing if needed
   */
  const handleSearchComplete = (payload: any, response: any) => {
    // Process histogram if needed
    if (
      payload.type === "search" &&
      !payload.isPagination &&
      searchObj.meta.refreshInterval == 0
    ) {
      getHistogramData(payload.queryReq,{
        clear_cache: payload.clear_cache
      });
    }

    // Update loading states. Reset streaming progress to 0 on completion so the
    // next search never starts from a stale percentage — the leftover value can
    // be anything the previous search ended at (e.g. 80, 90, 100), so gating on
    // a single magic number isn't enough.
    if (payload.type === "search") {
      searchObj.loading = false;
      searchObj.loadingProgressPercentage = 0;
    }
    if (payload.type === "histogram" || payload.type === "pageCount") {
      searchObj.loadingHistogram = false;
      searchObj.loadingHistogramProgressPercentage = 0;
    }

    if(searchObj.meta.clearCache){
      searchObj.meta.clearCache = false;
    }

    // Clean up connection
    connectionManager.cleanupConnection(payload.traceId);

  };

  /**
   * Handle search reset/retry
   */
  const handleSearchReset = (data: any, traceId?: string) => {
    try {
      if (data.type === "search") {
        if (!data.isPagination) {
          resetQueryData();
          searchObj.data.queryResults = {};
        }

        // Reset histogram if needed
        if (!data.isPagination) {
          searchObj.data.histogram = {
            xData: [],
            yData: [],
            breakdownField: null,
            breakdownSeries: null,
            chartParams: {
              title: "",
              unparsed_x_data: [],
              timezone: "",
            },
            errorCode: 0,
            errorMsg: "",
            errorDetail: "",
          };
        }

        // Rebuild payload and retry
        const payload = connectionManager.buildWebSocketPayload(
          data.queryReq,
          data.isPagination,
          "search",
        );

        connectionManager.initializeSearchConnection(payload);
        addTraceId(payload.traceId);
      }
    } catch (error: any) {
      console.error("Error during search reset:", error);
    }
  };

  /**
   * Expose the composable's public methods.
   */
  return {
    // Main search method
    getDataThroughStream,

    // Query building
    getQueryReq: queryBuilder.getQueryReq,
    buildSearch: queryBuilder.buildSearch,
    getSearchQueryPayload: queryBuilder.getSearchQueryPayload,

    // Connection management
    buildWebSocketPayload: connectionManager.buildWebSocketPayload,
    initializeSearchConnection: connectionManager.initializeSearchConnection,

    // Response handling
    handleSearchResponse: responseProcessor.handleSearchResponse,
    handleSearchError: responseProcessor.handleSearchError,
    handleFunctionError: responseProcessor.handleFunctionError,
    handleAggregation: responseProcessor.handleAggregation,

    // Histogram management
    shouldShowHistogram: histogramHandler.shouldShowHistogram,
    processHistogramRequest: histogramHandler.processHistogramRequest,
    isHistogramDataMissing: histogramHandler.isHistogramDataMissing,

    // Pagination
    refreshPagination: paginationManager.refreshPagination,
    updateResult: paginationManager.updateResult,
    chunkedAppend: paginationManager.chunkedAppend,
    shouldGetPageCount: paginationManager.shouldGetPageCount,

    // Utility methods
    validateFilterForMultiStream: queryBuilder.validateFilterForMultiStream,
    extractFilterColumns: queryBuilder.extractFilterColumns,
    constructErrorMessage: responseProcessor.constructErrorMessage,

    // Expose individual composables if needed
    queryBuilder,
    connectionManager,
    responseProcessor,
    histogramHandler,
    paginationManager,
    getHistogramData,
  };
};

export default useSearchStream;

