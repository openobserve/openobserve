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

  // Get metadata
  // Update metadata
  // Update results

  const handleStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    // Scan-size and took time in histogram title
    // For the initial request, we get histogram and logs data. So, we need to sum the scan_size and took time of both the requests.
    // For the pagination request, we only get logs data. So, we need to consider scan_size and took time of only logs request.
    if (
      (isPagination && searchPartitionMap[payload.traceId].partition === 1) ||
      !appendResult
    ) {
      searchObj.data.queryResults.hits = response.content.results.hits;
    } else if (appendResult) {
      searchObj.data.queryResults.hits.push(...response.content.results.hits);
    }

    if (searchObj.meta.refreshInterval == 0) {
      updatePageCountTotal(
        payload.queryReq,
        response.content.results.hits.length,
        searchObj.data.queryResults.hits.length,
      );
      trimPageCountExtraHit(
        payload.queryReq,
        searchObj.data.queryResults.hits.length,
      );
    }

    refreshPagination(true);

    processPostPaginationData();
  };

  const processPostPaginationData = () => {
    updateFieldValues();

    //extract fields from query response
    extractFields();

    //update grid columns
    updateGridColumns();

    filterHitsColumns();
    searchObj.data.histogram.chartParams.title = getHistogramTitle();
  };

  const handleStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    // check if histogram interval is undefined, then set current response as histogram response
    // for visualization, will require to set histogram interval to fill missing values
    // Using same histogram interval attribute creates pagination issue(showing 1 to 50 out of .... was not shown on page change)
    // created new attribute visualization_histogram_interval to avoid this issue
    if (
      !searchObj.data.queryResults.visualization_histogram_interval &&
      response.content?.results?.histogram_interval
    ) {
      searchObj.data.queryResults.visualization_histogram_interval =
        response.content?.results?.histogram_interval;
    }

    ////// Handle function error ///////
    handleFunctionError(payload.queryReq, response);

    ////// Handle aggregation ///////
    handleAggregation(payload.queryReq, response);

    ////// Handle reset field values ///////
    resetFieldValues();

    // In page count we set track_total_hits
    if (!payload.queryReq.query.hasOwnProperty("track_total_hits")) {
      delete response.content.total;
    }
    // Scan-size and took time in histogram title
    // For the initial request, we get histogram and logs data. So, we need to sum the scan_size and took time of both the requests.
    // For the pagination request, we only get logs data. So, we need to consider scan_size and took time of only logs request.
    if (appendResult) {
      searchObj.data.queryResults.total += response.content.results.total;
      searchObj.data.queryResults.took += response.content.results.took;
      searchObj.data.queryResults.scan_size +=
        response.content.results.scan_size;
    } else {
      if (isPagination && response.content?.streaming_aggs) {
        searchObj.data.queryResults.from = response.content.results.from;
        searchObj.data.queryResults.scan_size =
          response.content.results.scan_size;
        searchObj.data.queryResults.took = response.content.results.took;
      } else if (response.content?.streaming_aggs) {
        searchObj.data.queryResults = {
          ...response.content.results,
          took:
            (searchObj.data?.queryResults?.took || 0) +
            response.content.results.took,
          scan_size:
            (searchObj.data?.queryResults?.scan_size || 0) +
            response.content.results.scan_size,
          hits: searchObj.data?.queryResults?.hits || [],
          streaming_aggs: response.content?.streaming_aggs,
        };
      } else if (isPagination) {
        searchObj.data.queryResults.from = response.content.results.from;
        searchObj.data.queryResults.scan_size =
          response.content.results.scan_size;
        searchObj.data.queryResults.took = response.content.results.took;
        searchObj.data.queryResults.total = response.content.results.total;
      } else {
        searchObj.data.queryResults = response.content.results;
      }
    }
    //check if the histogram is
    //here we add the is_histogram_eligible flag to the query results so that we can use it in the FE side
    //to decide whether to call histogram or not
    if (response.content.results.hasOwnProperty("is_histogram_eligible")) {
      searchObj.data.queryResults.is_histogram_eligible =
        response.content.results.is_histogram_eligible;
    }

    if (searchObj.meta.refreshInterval == 0) {
      if (
        shouldGetPageCount(payload.queryReq, fnParsedSQL()) &&
        response.content.results.total === payload.queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          payload.queryReq.query.size * searchObj.data.resultGrid.currentPage;
      } else if (
        shouldGetPageCount(payload.queryReq, fnParsedSQL()) &&
        response.content.results.total != payload.queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          payload.queryReq.query.size *
            Math.max(searchObj.data.resultGrid.currentPage - 1, 0) +
          response.content.results.total;
      }
    }

    // We are storing time_offset for the context of pagecount, to get the partial pagecount
    if (searchObj.data.queryResults) {
      searchObj.data.queryResults.time_offset = response.content?.time_offset;
    }

    // If its a pagination request, then append
    if (!isPagination) {
      searchObj.data.queryResults.pagination = [];
    }

    if (isPagination) refreshPagination(true);
  };

  const updatePageCountTotal = (
    queryReq: SearchRequestPayload,
    currentHits: number,
    total: any,
  ) => {
    try {
      if (
        shouldGetPageCount(queryReq, fnParsedSQL()) &&
        total === queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          searchObj.meta.resultGrid.rowsPerPage *
            searchObj.data.resultGrid.currentPage +
          1;
      } else if (
        shouldGetPageCount(queryReq, fnParsedSQL()) &&
        total !== queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          searchObj.meta.resultGrid.rowsPerPage *
            Math.max(searchObj.data.resultGrid.currentPage - 1, 0) +
          currentHits;
      }
    } catch (e: any) {
      console.error("Error while updating page count total", e);
    }
  };

  const trimPageCountExtraHit = (
    queryReq: SearchRequestPayload,
    total: any,
  ) => {
    try {
      if (
        shouldGetPageCount(queryReq, fnParsedSQL()) &&
        total === queryReq.query.size
      ) {
        searchObj.data.queryResults.hits =
          searchObj.data.queryResults.hits.slice(
            0,
            searchObj.data.queryResults.hits.length - 1,
          );
      }
    } catch (e: any) {
      console.error("Error while trimming page count extra hit", e);
    }
  };

  const handleHistogramStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    searchObj.loading = false;

    if (!searchObj.data.queryResults.aggs) {
      searchObj.data.queryResults.aggs = [];
    }

    if (
      searchObj.data.queryResults.aggs.length == 0 &&
      response.content.results.hits.length > 0
    ) {
      let date = new Date();

      const startDateTime =
        searchObj.data.customDownloadQueryObj.query.start_time / 1000;

      const endDateTime =
        searchObj.data.customDownloadQueryObj.query.end_time / 1000;

      const nowString = response.content.results.hits[0].zo_sql_key;
      const now = new Date(nowString);

      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = now.getFullYear();

      const dateToBePassed = `${day}-${month}-${year}`;
      const hours = String(now.getHours()).padStart(2, "0");
      let minutes = String(now.getMinutes()).padStart(2, "0");
      if (searchObj.data.histogramInterval / 1000 <= 9999) {
        minutes = String(now.getMinutes() + 1).padStart(2, "0");
      }

      const time = `${hours}:${minutes}`;

      const currentTimeToBePassed = convertDateToTimestamp(
        dateToBePassed,
        time,
        "UTC",
      );

      if (!searchObj.data.histogramInterval) {
        console.error(
          "Error processing histogram data:",
          "histogramInterval is not set",
        );
        searchObj.loadingHistogram = false;
        return;
      }

      for (
        let currentTime: any = currentTimeToBePassed.timestamp / 1000;
        currentTime < endDateTime;
        currentTime += searchObj.data.histogramInterval / 1000
      ) {
        date = new Date(currentTime);
        histogramResults.value.push({
          zo_sql_key: date.toISOString().slice(0, 19),
          zo_sql_num: 0,
        });
      }
      for (
        let currentTime: any = currentTimeToBePassed.timestamp / 1000;
        currentTime > startDateTime;
        currentTime -= searchObj.data.histogramInterval / 1000
      ) {
        date = new Date(currentTime);
        histogramResults.value.push({
          zo_sql_key: date.toISOString().slice(0, 19),
          zo_sql_num: 0,
        });
      }
    }

    // if order by is desc, append new partition response at end
    if (searchObj.data.queryResults.order_by?.toLowerCase() === "desc") {
      searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    } else {
      // else append new partition response at start
      searchObj.data.queryResults.aggs.unshift(
        ...response.content.results.hits,
      );
    }

    (async () => {
      try {
        generateHistogramData();
        if (!payload.meta?.isHistogramOnly) refreshPagination(true);
      } catch (error) {
        console.error("Error processing histogram data:", error);

        searchObj.loadingHistogram = false;
      }
    })();

    // queryReq.query.start_time =
    //   searchObj.data.queryResults.partitionDetail.paginations[
    //     searchObj.data.resultGrid.currentPage - 1
    //   ][0].startTime;
    // queryReq.query.end_time =
    //   searchObj.data.queryResults.partitionDetail.paginations[
    //     searchObj.data.resultGrid.currentPage - 1
    //   ][0].endTime;

    // if (hasAggregationFlag) {
    //   searchObj.data.queryResults.total = res.data.total;
    // }

    if (!payload.meta?.isHistogramOnly)
      searchObj.data.histogram.chartParams.title = getHistogramTitle();

    searchObjDebug["histogramProcessingEndTime"] = performance.now();
    searchObjDebug["histogramEndTime"] = performance.now();
  };

  const handleHistogramStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    searchObjDebug["histogramProcessingStartTime"] = performance.now();

    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;
    searchObj.data.queryResults.result_cache_ratio +=
      response.content.results.result_cache_ratio;
    searchObj.data.queryResults.histogram_interval =
      response.content.results.histogram_interval;
    if (searchObj.data.queryResults.histogram_interval)
      searchObj.data.histogramInterval =
        searchObj.data.queryResults.histogram_interval * 1000000;
    searchObj.data.queryResults.order_by =
      response?.content?.results?.order_by ?? "desc";

    // copy converted_histogram_query to queryResults
    searchObj.data.queryResults.converted_histogram_query =
      response?.content?.results?.converted_histogram_query ?? "";

    // check if histogram interval is undefined, then set current response as histogram response
    // for visualization, will require to set histogram interval to fill missing values
    // Using same histogram interval attribute creates pagination issue(showing 1 to 50 out of .... was not shown on page change)
    // created new attribute visualization_histogram_interval to avoid this issue
    if (
      !searchObj.data.queryResults.visualization_histogram_interval &&
      response.content?.results?.histogram_interval
    ) {
      searchObj.data.queryResults.visualization_histogram_interval =
        response.content?.results?.histogram_interval;
    }
  };

  const handlePageCountStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    let regeratePaginationFlag = false;
    if (
      response.content.results.hits.length !=
      searchObj.meta.resultGrid.rowsPerPage
    ) {
      regeratePaginationFlag = true;
    }

    if (
      response.content?.streaming_aggs ||
      searchObj.data.queryResults.streaming_aggs
    ) {
      searchObj.data.queryResults.aggs = response.content.results.hits;
    } else {
      searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    }

    // if total records in partition is greater than recordsPerPage then we need to update pagination
    // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
    refreshPagination(regeratePaginationFlag);

    searchObj.data.histogram.chartParams.title = getHistogramTitle();
  };

  const handlePageCountStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    removeTraceId(response.content.trace_id);

    if (searchObj.data.queryResults.aggs == null) {
      searchObj.data.queryResults.aggs = [];
    }

    searchObj.data.queryResults.streaming_aggs =
      response?.content?.streaming_aggs;

    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;
  };

  //indexList.vue
  // Limit, aggregation, vrl function, pagination, function error and query error
  const handleSearchResponse = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
  ) => {
    if (
      payload.type === "search" &&
      response?.type === "search_response_hits"
    ) {
      const isStreamingAggs =
        response.content?.streaming_aggs ||
        searchObj.data.queryResults.streaming_aggs;
      const shouldAppendStreamingResults = isStreamingAggs
        ? !response.content?.results?.hits?.length
        : true;
      searchPartitionMap[payload.traceId].chunks[
        searchPartitionMap[payload.traceId].partition
      ]++;
      // If single partition has more than 1 chunk, then we need to append the results
      const isChunkedHits =
        searchPartitionMap[payload.traceId].chunks[
          searchPartitionMap[payload.traceId].partition
        ] > 1;

      handleStreamingHits(
        payload,
        response,
        payload.isPagination,
        shouldAppendStreamingResults &&
          (searchPartitionMap[payload.traceId].partition > 1 || isChunkedHits),
      );
      return;
    }

    if (
      payload.type === "search" &&
      response?.type === "search_response_metadata"
    ) {
      searchPartitionMap[payload.traceId] = searchPartitionMap[payload.traceId]
        ? searchPartitionMap[payload.traceId]
        : {
            partition: 0,
            chunks: {},
          };

      const isStreamingAggs = response.content?.streaming_aggs;
      const shouldAppendStreamingResults = isStreamingAggs
        ? !response.content?.results?.hits?.length
        : true;

      searchPartitionMap[payload.traceId].partition++;
      searchPartitionMap[payload.traceId].chunks[
        searchPartitionMap[payload.traceId].partition
      ] = 0;

      handleStreamingMetadata(
        payload,
        response,
        payload.isPagination,
        shouldAppendStreamingResults &&
          searchPartitionMap[payload.traceId].partition > 1,
      );
      return;
    }

    if (
      payload.type === "histogram" &&
      response?.type === "search_response_hits"
    ) {
      handleHistogramStreamingHits(payload, response, payload.isPagination);
      return;
    }

    if (
      payload.type === "histogram" &&
      response?.type === "search_response_metadata"
    ) {
      handleHistogramStreamingMetadata(payload, response, payload.isPagination);
      return;
    }

    if (
      payload.type === "pageCount" &&
      response?.type === "search_response_hits"
    ) {
      handlePageCountStreamingHits(payload, response, payload.isPagination);
      return;
    }

    if (
      payload.type === "pageCount" &&
      response?.type === "search_response_metadata"
    ) {
      handlePageCountStreamingMetadata(payload, response, payload.isPagination);
      return;
    }

    if (response.type === "search_response") {
      searchPartitionMap[payload.traceId] = searchPartitionMap[payload.traceId]
        ? searchPartitionMap[payload.traceId]
        : {
            partition: 0,
            chunks: {},
          };

      searchPartitionMap[payload.traceId].partition++;
      const isStreamingAggs = response.content?.streaming_aggs;
      const shouldAppendStreamingResults = isStreamingAggs
        ? !response.content?.results?.hits?.length
        : true;

      if (payload.type === "search") {
        handleLogsResponse(
          payload.queryReq,
          payload.isPagination,
          payload.traceId,
          response,
          shouldAppendStreamingResults &&
            searchPartitionMap[payload.traceId].partition > 1,
        );
      }

      if (payload.type === "histogram") {
        handleHistogramResponse(
          payload.queryReq,
          payload.traceId,
          response,
          payload.meta,
        );
      }

      if (payload.type === "pageCount") {
        handlePageCountResponse(payload.queryReq, payload.traceId, response);
      }
    }

    // if (response.type === "error") {
    //   handleSearchError(payload.traceId, response);
    // }

    if (response.type === "cancel_response") {
      searchObj.loading = false;
      searchObj.loadingHistogram = false;
      searchObj.data.isOperationCancelled = false;

      showCancelSearchNotification();
      setCancelSearchError();
    }
  };

  // AddFunction.vue
  const handleFunctionError = (
    queryReq: SearchRequestPayload,
    response: any,
  ) => {
    if (
      response.content.results.hasOwnProperty("function_error") &&
      response.content.results.function_error != ""
    ) {
      searchObj.data.functionError = response.content.results.function_error;
    }

    if (
      response.content.results.hasOwnProperty("function_error") &&
      response.content.results.function_error != "" &&
      response.content.results.hasOwnProperty("new_start_time") &&
      response.content.results.hasOwnProperty("new_end_time")
    ) {
      response.content.results.function_error = getFunctionErrorMessage(
        response.content.results.function_error,
        response.content.results.new_start_time,
        response.content.results.new_end_time,
        store.state.timezone,
      );
      searchObj.data.datetime.startTime =
        response.content.results.new_start_time;
      searchObj.data.datetime.endTime = response.content.results.new_end_time;
      searchObj.data.datetime.type = "absolute";
      queryReq.query.start_time = response.content.results.new_start_time;
      queryReq.query.end_time = response.content.results.new_end_time;
      searchObj.data.histogramQuery.query.start_time =
        response.content.results.new_start_time;
      searchObj.data.histogramQuery.query.end_time =
        response.content.results.new_end_time;

      updateUrlQueryParams();
    }
  };

  const handleAggregation = (queryReq: SearchRequestPayload, response: any) => {
    const parsedSQL = fnParsedSQL();

    if (searchObj.meta.sqlMode) {
      if (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null) {
        searchAggData.hasAggregation = true;
        searchObj.meta.resultGrid.showPagination = false;

        if (
          response.content?.streaming_aggs &&
          response.content?.results?.total
        ) {
          searchAggData.total = response.content?.results?.total;
        } else {
          searchAggData.total =
            searchAggData.total + response.content?.results?.total;
        }
      }
    }
  };

  const updateResult = async (
    queryReq: SearchRequestPayload,
    response: any,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    if (
      searchObj.meta.refreshInterval > 0 &&
      router.currentRoute.value.name == "logs"
    ) {
      searchObj.data.queryResults.from = response.content.results.from;
      searchObj.data.queryResults.scan_size =
        response.content.results.scan_size;
      searchObj.data.queryResults.took = response.content.results.took;
      searchObj.data.queryResults.aggs = response.content.results.aggs;
      searchObj.data.queryResults.hits = response.content.results.hits;
    }

    if (searchObj.meta.refreshInterval == 0) {
      // In page count we set track_total_hits
      if (!queryReq.query.hasOwnProperty("track_total_hits")) {
        delete response.content.total;
      }

      // Scan-size and took time in histogram title
      // For the initial request, we get histogram and logs data. So, we need to sum the scan_size and took time of both the requests.
      // For the pagination request, we only get logs data. So, we need to consider scan_size and took time of only logs request.
      if (appendResult) {
        await chunkedAppend(
          searchObj.data.queryResults.hits,
          response.content.results.hits,
        );

        searchObj.data.queryResults.total += response.content.results.total;
        searchObj.data.queryResults.took += response.content.results.took;
        searchObj.data.queryResults.scan_size +=
          response.content.results.scan_size;
      } else {
        if (response.content?.streaming_aggs) {
          searchObj.data.queryResults = {
            ...response.content.results,
            took:
              (searchObj.data?.queryResults?.took || 0) +
              response.content.results.took,
            scan_size:
              (searchObj.data?.queryResults?.scan_size || 0) +
              response.content.results.scan_size,
          };
        } else if (isPagination) {
          searchObj.data.queryResults.hits = response.content.results.hits;
          searchObj.data.queryResults.from = response.content.results.from;
          searchObj.data.queryResults.scan_size =
            response.content.results.scan_size;
          searchObj.data.queryResults.took = response.content.results.took;
          searchObj.data.queryResults.total = response.content.results.total;
        } else {
          searchObj.data.queryResults = response.content.results;
        }
      }
    }

    // We are storing time_offset for the context of pagecount, to get the partial pagecount
    if (searchObj.data.queryResults) {
      searchObj.data.queryResults.time_offset = response.content?.time_offset;
    }
  };

  const handleLogsResponse = async (
    queryReq: SearchRequestPayload,
    isPagination: boolean,
    traceId: string,
    response: any,
    appendResult: boolean = false,
  ) => {
    try {
      ////// Handle function error ///////
      handleFunctionError(queryReq, response);

      ////// Handle aggregation ///////
      handleAggregation(queryReq, response);

      ////// Handle reset field values ///////
      resetFieldValues();

      ////// Update results ///////
      updateResult(queryReq, response, isPagination, appendResult);

      // If its a pagination request, then append
      if (!isPagination) {
        searchObj.data.queryResults.pagination = [];
      }

      if (isPagination) refreshPagination(true);

      processPostPaginationData();

      searchObjDebug["paginatedDataReceivedEndTime"] = performance.now();
    } catch (e: any) {
      searchObj.loading = false;
      console.log(e);
      showErrorNotification(
        notificationMsg.value || "Error occurred while handling logs response.",
      );
      notificationMsg.value = "";
    }
  };

  //useLogs.ts
  const chunkedAppend = async (target: any, source: any, chunkSize = 5000) => {
    for (let i = 0; i < source.length; i += chunkSize) {
      target.push.apply(target, source.slice(i, i + chunkSize));
      await new Promise((resolve) => setTimeout(resolve, 0)); // Let UI update
    }
  };

  const handlePageCountResponse = (
    queryReq: SearchRequestPayload,
    traceId: string,
    response: any,
  ) => {
    removeTraceId(traceId);

    if (searchObj.data.queryResults.aggs == null) {
      searchObj.data.queryResults.aggs = [];
    }

    let regeratePaginationFlag = false;
    if (
      response.content.results.hits.length !=
      searchObj.meta.resultGrid.rowsPerPage
    ) {
      regeratePaginationFlag = true;
    }

    searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;

    // if total records in partition is greater than recordsPerPage then we need to update pagination
    // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
    refreshPagination(regeratePaginationFlag);

    searchObj.data.histogram.chartParams.title = getHistogramTitle();
  };

  const handleHistogramResponse = (
    queryReq: SearchRequestPayload,
    traceId: string,
    response: any,
    meta?: any,
  ) => {
    searchObjDebug["histogramProcessingStartTime"] = performance.now();

    searchObj.loading = false;

    if (searchObj.data.queryResults.aggs == null) {
      searchObj.data.queryResults.aggs = [];
    }

    if (
      searchObj.data.queryResults.aggs.length == 0 &&
      response.content.results.hits.length > 0
    ) {
      let date = new Date();

      const startDateTime =
        searchObj.data.customDownloadQueryObj.query.start_time / 1000;

      const endDateTime =
        searchObj.data.customDownloadQueryObj.query.end_time / 1000;

      const nowString = response.content.results.hits[0].zo_sql_key;
      const now = new Date(nowString);

      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = now.getFullYear();

      const dateToBePassed = `${day}-${month}-${year}`;
      const hours = String(now.getHours()).padStart(2, "0");
      let minutes = String(now.getMinutes()).padStart(2, "0");
      if (response.content.results.histogram_interval / 1000 <= 9999) {
        minutes = String(now.getMinutes() + 1).padStart(2, "0");
      }

      const time = `${hours}:${minutes}`;

      const currentTimeToBePassed = convertDateToTimestamp(
        dateToBePassed,
        time,
        "UTC",
      );
      for (
        let currentTime: any = currentTimeToBePassed.timestamp / 1000;
        currentTime < endDateTime;
        currentTime += searchObj.data.histogramInterval / 1000
      ) {
        date = new Date(currentTime);
        histogramResults.value.push({
          zo_sql_key: date.toISOString().slice(0, 19),
          zo_sql_num: 0,
        });
      }
      for (
        let currentTime: any = currentTimeToBePassed.timestamp / 1000;
        currentTime > startDateTime;
        currentTime -= searchObj.data.histogramInterval / 1000
      ) {
        date = new Date(currentTime);
        histogramResults.value.push({
          zo_sql_key: date.toISOString().slice(0, 19),
          zo_sql_num: 0,
        });
      }
    }

    searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;
    searchObj.data.queryResults.result_cache_ratio +=
      response.content.results.result_cache_ratio;

    (async () => {
      try {
        generateHistogramData();
        if (!meta?.isHistogramOnly) refreshPagination(true);
      } catch (error) {
        console.error("Error processing histogram data:", error);

        searchObj.loadingHistogram = false;
      }
    })();

    // queryReq.query.start_time =
    //   searchObj.data.queryResults.partitionDetail.paginations[
    //     searchObj.data.resultGrid.currentPage - 1
    //   ][0].startTime;
    // queryReq.query.end_time =
    //   searchObj.data.queryResults.partitionDetail.paginations[
    //     searchObj.data.resultGrid.currentPage - 1
    //   ][0].endTime;

    // if (hasAggregationFlag) {
    //   searchObj.data.queryResults.total = res.data.total;
    // }

    if (!meta?.isHistogramOnly)
      searchObj.data.histogram.chartParams.title = getHistogramTitle();

    searchObjDebug["histogramProcessingEndTime"] = performance.now();
    searchObjDebug["histogramEndTime"] = performance.now();
  };

  const shouldShowHistogram = (parsedSQL: any) => {
    return (
      ((isHistogramDataMissing(searchObj) &&
        isHistogramEnabled(searchObj) &&
        (!searchObj.meta.sqlMode ||
          isNonAggregatedSQLMode(searchObj, parsedSQL))) ||
        (isHistogramEnabled(searchObj) && !searchObj.meta.sqlMode)) &&
      (searchObj.data.stream.selectedStream.length === 1 ||
        (searchObj.data.stream.selectedStream.length > 1 &&
          !searchObj.meta.sqlMode))
    );
  };

  const processHistogramRequest = async (queryReq: SearchRequestPayload) => {
    const parsedSQL: any = fnParsedSQL();

    if (
      searchObj.data.stream.selectedStream.length > 1 &&
      searchObj.meta.sqlMode == true
    ) {
      const errMsg =
        "Histogram is not available for multi-stream SQL mode search.";
      resetHistogramWithError(errMsg, 0);
    }

    if (!searchObj.data.queryResults?.hits?.length) {
      return;
    }

    const isFromZero =
      queryReq.query.from == 0 && searchObj.data.queryResults.hits?.length > 0;

    const _shouldShowHistogram = shouldShowHistogram(parsedSQL);

    searchObj.data.queryResults.aggs = [];
    searchObj.data.queryResults.histogram_interval = 0;
    if (_shouldShowHistogram) {
      searchObj.meta.refreshHistogram = false;
      if (searchObj.data.queryResults.hits?.length > 0) {
        searchObjDebug["histogramStartTime"] = performance.now();
        resetHistogramError();

        searchObj.loadingHistogram = true;

        await generateHistogramSkeleton();

        histogramResults.value = [];

        const payload = buildWebSocketPayload(
          searchObj.data.histogramQuery,
          false,
          "histogram",
        );

        if (
          searchObj.data.stream.selectedStream.length > 1 &&
          searchObj.meta.sqlMode == false
        ) {
          payload.queryReq.query.sql = setMultiStreamHistogramQuery(
            searchObj.data.histogramQuery.query,
          );
        } else {
          payload.queryReq.query.sql =
            searchObj.data.histogramQuery.query.sql.replace(
              "[INTERVAL]",
              searchObj.meta.resultGrid.chartInterval,
            );
        }

        payload.meta = {
          isHistogramOnly: searchObj.meta.histogramDirtyFlag,
          is_ui_histogram: true,
        };

        const requestId = initializeSearchConnection(payload);

        addTraceId(payload.traceId);
      }
    } else if (searchObj.meta.sqlMode && isLimitQuery(parsedSQL)) {
      resetHistogramWithError(
        "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
        -1,
      );
      searchObj.meta.histogramDirtyFlag = false;
    } else if (
      searchObj.meta.sqlMode &&
      (isDistinctQuery(parsedSQL) ||
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible)
    ) {
      if (shouldGetPageCount(queryReq, parsedSQL) && isFromZero) {
        setTimeout(async () => {
          searchObjDebug["pagecountStartTime"] = performance.now();
          getPageCountThroughSocket(queryReq);
          searchObjDebug["pagecountEndTime"] = performance.now();
        }, 0);
      }
      if (
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible
      ) {
        resetHistogramWithError(
          "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
          -1,
        );
        searchObj.meta.histogramDirtyFlag = false;
      } else {
        resetHistogramWithError(
          "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
          -1,
        );
      }
      searchObj.meta.histogramDirtyFlag = false;
    } else {
      if (shouldGetPageCount(queryReq, parsedSQL) && isFromZero) {
        setTimeout(async () => {
          searchObjDebug["pagecountStartTime"] = performance.now();
          getPageCountThroughSocket(queryReq);
          searchObjDebug["pagecountEndTime"] = performance.now();
        }, 0);
      }
    }
  };

  function isHistogramDataMissing(searchObj: any) {
    return !searchObj.data.queryResults?.aggs?.length;
  }

  // indexList.vue
  const handleSearchClose = (payload: any, response: any) => {
    if (payload.traceId) removeTraceId(payload.traceId);

    // Any case where below logic may end in recursion
    if (payload.traceId) delete searchPartitionMap[payload.traceId];

    if (searchObj.data.isOperationCancelled) {
      searchObj.loading = false;
      searchObj.loadingHistogram = false;
      searchObj.data.isOperationCancelled = false;

      showCancelSearchNotification();
      setCancelSearchError();
      return;
    }

    //TODO Omkar: Remove the duplicate error codes, are present same in useSearchWebSocket.ts
    const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

    if (errorCodes.includes(response.code)) {
      handleSearchError(payload, {
        content: {
          message:
            "WebSocket connection terminated unexpectedly. Please check your network and try again",
          trace_id: payload.traceId,
          code: response.code,
          error_detail: "",
        },
        type: "error",
      });
    }

    // if (searchObj.data.searchRetriesCount[payload.traceId]) {
    //   delete searchObj.data.searchRetriesCount[payload.traceId];
    // }

    if (payload.traceId) removeTraceId(payload.traceId);

    if (!searchObj.data.queryResults.hasOwnProperty("hits")) {
      searchObj.data.queryResults.hits = [];
    }

    if (
      payload.type === "search" &&
      !payload.isPagination &&
      searchObj.meta.refreshInterval == 0
    ) {
      const histogramCallbacks = {
        onData: responseProcessor.handleSearchResponse,
        onError: responseProcessor.handleSearchError,
        onComplete: handleSearchComplete,
        onReset: handleSearchReset,
      };

      histogramHandler.processHistogramRequest(
        payload.queryReq,
        connectionManager.buildWebSocketPayload,
        connectionManager.initializeSearchConnection,
        histogramCallbacks,
      );
    }

    console.log("Search Complete", payload);
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

export default useSearchStream;
