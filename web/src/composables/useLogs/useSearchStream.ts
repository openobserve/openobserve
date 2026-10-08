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
import { raw, type TranslateFn } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import {
  failPendingPageNavigation,
  notePageLoad,
  notePageRetry,
  notifyHitsComplete,
} from "@/composables/useLogs/logsRowNav";

export const useSearchStream = (t: TranslateFn) => {
  const { showErrorNotification } = useNotifications();
  const { addTraceId } = logsUtils();

  // Initialize all the split composables
  const queryBuilder = useSearchQuery(t);
  const connectionManager = useSearchConnection(t);
  const responseProcessor = useSearchResponseHandler();
  const histogramHandler = useSearchHistogramManager(t);
  const paginationManager = useSearchPagination(t);

  const { searchObj, resetQueryData } = searchState();

  // Responses of a replaced or cancelled generation never reach the UI (AC4.1).
  const onData = (payload: any, response: any) => {
    const autoRun = useLogsAutoRun();
    if (!autoRun.isPayloadCurrent(payload)) return;
    responseProcessor.handleSearchResponse(payload, response);
    autoRun.onPayloadData(payload, response?.type);
  };

  const onError = (payload: any, error: any) => {
    const autoRun = useLogsAutoRun();
    if (!autoRun.isPayloadCurrent(payload)) {
      autoRun.finishPayload(payload);
      return;
    }
    autoRun.onPayloadError(payload);
    responseProcessor.handleSearchError(payload, error);
  };

  const searchCallbacks = () => ({
    onData,
    onError,
    onComplete: handleSearchComplete,
    onReset: handleSearchReset,
  });

  /**
   * Main entry point for search operations
   * Delegates to appropriate split composables
   */
  const getDataThroughStream = (
    isPagination: boolean,
    generationId?: number,
    options: { reuseSchema?: boolean } = {},
  ) => {
    try {
      if (!isPagination) resetQueryData();

      // 1. Build the query using the query composable
      const queryReq = queryBuilder.getQueryReq(isPagination);
      if (!queryReq) {
        if (isPagination) failPendingPageNavigation(searchObj);
        return;
      }

      // 2. Execute the search through the connection manager
      connectionManager.getDataThroughStream(
        queryReq,
        isPagination,
        searchCallbacks(),
        generationId,
        options,
      );
    } catch (error: any) {
      console.error("Search operation failed:", error);
      searchObj.loading = false;
      if (isPagination) failPendingPageNavigation(searchObj, { quiet: true });
      showErrorNotification(t("toastMessages.useLogs.errorOccurredDuringTheSearchOperation"));
    }
  };

  const getHistogramData = (queryReq: any, meta: any = {}) => {
    const launch = histogramHandler.processHistogramRequest(
      queryReq,
      connectionManager.buildWebSocketPayload,
      connectionManager.initializeSearchConnection,
      searchCallbacks(),
      meta,
    );
    useLogsAutoRun().trackLaunch(meta?.generationId, launch);
    return launch;
  };

  /**
   * Handle search completion
   * Orchestrates histogram processing if needed
   */
  const handleSearchComplete = (payload: any) => {
    const autoRun = useLogsAutoRun();
    if (!autoRun.isPayloadCurrent(payload)) {
      autoRun.finishPayload(payload);
      connectionManager.cleanupConnection(payload.traceId);
      return;
    }
    autoRun.onPayloadComplete(payload);

    if (payload.type === "search" && !payload.isPagination && searchObj.meta.refreshInterval == 0) {
      analytics.track("logs_search_completed");
    }

    // Process histogram if needed
    if (payload.type === "search" && !payload.isPagination && searchObj.meta.refreshInterval == 0) {
      getHistogramData(payload.queryReq, {
        clear_cache: payload.clear_cache,
        generationId: payload.generationId,
      });
    }

    // Update loading states. Reset streaming progress to 0 on completion so the
    // next search never starts from a stale percentage — the leftover value can
    // be anything the previous search ended at (e.g. 80, 90, 100), so gating on
    // a single magic number isn't enough.
    if (payload.type === "search") {
      searchObj.loading = false;
      searchObj.loadingProgressPercentage = 0;
      if (payload.isPagination) notePageLoad(searchObj, payload.traceId, "done");
      notifyHitsComplete(payload);
    }
    if (payload.type === "histogram" || payload.type === "pageCount") {
      searchObj.loadingHistogram = false;
      searchObj.loadingHistogramProgressPercentage = 0;
    }

    if (searchObj.meta.clearCache) {
      searchObj.meta.clearCache = false;
    }

    // Clean up connection
    connectionManager.cleanupConnection(payload.traceId);
    autoRun.finishPayload(payload);
  };

  /**
   * Handle search reset/retry
   */
  const handleSearchReset = (data: any) => {
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
              title: raw(""),
              titleParts: null,
              unparsed_x_data: [],
              timezone: "",
            },
            errorCode: 0,
            errorMsg: "",
            errorDetail: "",
          };
        }

        if (data.isPagination) notePageRetry(searchObj, data.traceId);
        // Rebuild payload and retry
        const payload = connectionManager.buildWebSocketPayload(
          data.queryReq,
          data.isPagination,
          "search",
        );
        (payload as { generationId?: number }).generationId = data.generationId;
        (payload as { reuseSchema?: boolean }).reuseSchema = data.reuseSchema;

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
