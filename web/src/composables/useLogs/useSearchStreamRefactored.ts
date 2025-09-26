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

/**
 * REFACTORED VERSION OF useSearchStream
 *
 * This is a refactored version that demonstrates how to split the large useSearchStream
 * composable into smaller, more focused composables. The original file had 2100+ lines
 * and handled multiple responsibilities.
 *
 * STRUCTURE:
 * - Main orchestrator (this file) - coordinates between split composables
 * - useSearchQuery - handles SQL query building and validation
 * - useSearchConnection - manages WebSocket/HTTP streaming connections
 * - useSearchResponseHandler - processes different response types
 * - useSearchHistogramManager - histogram-specific logic
 * - useSearchPagination - pagination calculations and state
 *
 * BENEFITS:
 * - Better separation of concerns
 * - Easier testing of individual components
 * - Improved maintainability
 * - Cleaner code organization
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

export const useSearchStreamRefactored = () => {
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
      histogramHandler.processHistogramRequest(
        payload.queryReq,
        connectionManager.buildWebSocketPayload,
        connectionManager.initializeSearchConnection,
      );
    }

    // Update loading states
    if (payload.type === "search") {
      searchObj.loading = false;
    }
    if (payload.type === "histogram" || payload.type === "pageCount") {
      searchObj.loadingHistogram = false;
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
   * Expose the necessary methods for backward compatibility
   * This maintains the same interface as the original composable
   */
  return {
    // Main search method
    getDataThroughStream,

    // Query building
    getQueryReq: queryBuilder.getQueryReq,
    buildSearch: queryBuilder.buildSearch,

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

    // Backward compatibility - expose individual composables if needed
    queryBuilder,
    connectionManager,
    responseProcessor,
    histogramHandler,
    paginationManager,
  };
};

/**
 * How to migrate to the refactored version:
 *
 * 1. Replace imports:
 *    - Change: import useSearchStream from "@/composables/useLogs/useSearchStream";
 *    - To: import { useSearchStreamRefactored } from "@/composables/useLogs/useSearchStreamRefactored";
 *
 * 2. Update usage:
 *    - Change: const { getDataThroughStream } = useSearchStream();
 *    - To: const { getDataThroughStream } = useSearchStreamRefactored();
 *
 * 3. Test thoroughly to ensure all functionality works
 *
 * 4. If needed, access individual composables:
 *    - const { queryBuilder, connectionManager } = useSearchStreamRefactored();
 *
 * MIGRATION STRATEGY:
 * - Start with components that use simple methods from useSearchStream
 * - Gradually migrate more complex usage
 * - Keep the original file until all migrations are complete
 * - Add comprehensive tests for each split composable
 */

export default useSearchStreamRefactored;
