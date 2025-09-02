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

import { searchState } from "@/composables/useLogs/searchState";
import {
  fnParsedSQL,
  hasAggregation,
  isDistinctQuery,
  isWithQuery,
  isLimitQuery,
} from "@/composables/useLogs/logsUtils";
import { generateTraceContext } from "@/utils/zincutils";
import { logsErrorMessage } from "@/utils/common";
import useLogs from "@/composables/useLogs";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import {
  SearchRequestPayload,
  WebSocketSearchResponse,
  WebSocketSearchPayload,
  WebSocketErrorResponse,
} from "@/ts/interfaces/query";

export const searchStream = () => {
  let histogramResults: any = [];

  const store = useStore();
  const router = useRouter();
  let {
    searchObj,
    searchAggData,
    resetQueryData,
    notificationMsg,
    initialQueryPayload,
  } = searchState();
  const { buildSearch, addTransformToQuery, setDateTime } = useLogs();

  const getQueryReq = (isPagination: boolean) => {
    if (!isPagination) {
      resetQueryData();
      searchObj.data.queryResults = {};
    }

    // reset searchAggData
    searchAggData.total = 0;
    searchAggData.hasAggregation = false;

    searchObj.meta.showDetailTab = false;
    searchObj.meta.searchApplied = true;
    searchObj.data.functionError = "";
    if (
      !searchObj.data.stream.streamLists?.length ||
      searchObj.data.stream.selectedStream.length == 0
    ) {
      searchObj.loading = false;
      return;
    }

    if (
      Number.isNaN(searchObj.data.datetime.endTime) ||
      Number.isNaN(searchObj.data.datetime.startTime)
    ) {
      setDateTime(
        (router.currentRoute.value?.query?.period as string) || "15m",
      );
    }

    const queryReq: SearchRequestPayload = buildSearch();

    if (queryReq === null) {
      searchObj.loading = false;
      if (!notificationMsg.value) {
        notificationMsg.value = "Search query is empty or invalid.";
      }
      return;
    }

    if (!queryReq) {
      searchObj.loading = false;
      throw new Error(
        notificationMsg.value ||
          "Something went wrong while creating Search Request.",
      );
    }

    // get function definition
    addTransformToQuery(queryReq);

    // Add action ID if it exists
    if (searchObj.data.actionId && searchObj.data.transformType === "action") {
      queryReq.query["action_id"] = searchObj.data.actionId;
    }

    if (searchObj.data.datetime.type === "relative") {
      if (!isPagination) initialQueryPayload.value = cloneDeep(queryReq);
      else {
        if (
          searchObj.meta.refreshInterval == 0 &&
          router.currentRoute.value.name == "logs" &&
          searchObj.data.queryResults.hasOwnProperty("hits")
        ) {
          const start_time: number =
            initialQueryPayload.value?.query?.start_time || 0;
          const end_time: number =
            initialQueryPayload.value?.query?.end_time || 0;
          queryReq.query.start_time = start_time;
          queryReq.query.end_time = end_time;
        }
      }
    }

    // copy query request for histogram query and same for customDownload
    searchObj.data.histogramQuery = JSON.parse(JSON.stringify(queryReq));

    // reset errorCode
    searchObj.data.errorCode = 0;

    //here we need to send the actual sql query for histogram
    searchObj.data.histogramQuery.query.sql = queryReq.query.sql;
    searchObj.data.histogramQuery.query.size = -1;
    delete searchObj.data.histogramQuery.query.quick_mode;
    delete searchObj.data.histogramQuery.query.from;
    delete searchObj.data.histogramQuery.aggs;
    delete queryReq.aggs;
    if (searchObj.data.histogramQuery.query.action_id)
      delete searchObj.data.histogramQuery.query.action_id;

    searchObj.data.customDownloadQueryObj = JSON.parse(
      JSON.stringify(queryReq),
    );

    queryReq.query.from =
      (searchObj.data.resultGrid.currentPage - 1) *
      searchObj.meta.resultGrid.rowsPerPage;
    queryReq.query.size = searchObj.meta.resultGrid.rowsPerPage;

    const parsedSQL: any = fnParsedSQL();

    searchObj.meta.resultGrid.showPagination = true;

    if (searchObj.meta.sqlMode == true) {
      // if query has aggregation or groupby then we need to set size to -1 to get all records
      // issue #5432
      if (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null) {
        queryReq.query.size = -1;
      }

      if (isLimitQuery(parsedSQL)) {
        queryReq.query.size = parsedSQL.limit.value[0].value;
        searchObj.meta.resultGrid.showPagination = false;
        //searchObj.meta.resultGrid.rowsPerPage = queryReq.query.size;

        if (parsedSQL.limit.separator == "offset") {
          queryReq.query.from = parsedSQL.limit.value[1].value || 0;
        }
        delete queryReq.query.track_total_hits;
      }

      if (
        isDistinctQuery(parsedSQL) ||
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible
      ) {
        delete queryReq.query.track_total_hits;
      }
    }

    return queryReq;
  };

  //useLogs
  const getDataThroughStream = (isPagination: boolean) => {
    try {
      const queryReq = getQueryReq(isPagination) as SearchRequestPayload;

      if (!queryReq) return;

      if (!isPagination && searchObj.meta.refreshInterval == 0) {
        resetQueryData();
        histogramResults = [];
        searchObj.data.queryResults.hits = [];
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

      const payload = buildWebSocketPayload(queryReq, isPagination, "search");

      if (
        shouldGetPageCount(queryReq, fnParsedSQL()) &&
        searchObj.meta.refreshInterval == 0
      ) {
        queryReq.query.size = queryReq.query.size + 1;
      }

      // in case of live refresh, reset from to 0
      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "logs"
      ) {
        queryReq.query.from = 0;
        searchObj.meta.refreshHistogram = false;
      }

      const requestId = initializeSearchConnection(payload);

      if (!requestId) {
        throw new Error(
          `Failed to initialize ${searchObj.communicationMethod} connection`,
        );
      }

      addTraceId(payload.traceId);
    } catch (e: any) {
      console.error(
        `Error while getting data through ${searchObj.communicationMethod}`,
        e,
      );
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      notificationMsg.value = "";
    }
  };

  //index.vue
  const buildWebSocketPayload = (
    queryReq: SearchRequestPayload,
    isPagination: boolean,
    type: "search" | "histogram" | "pageCount" | "values",
    meta?: any,
  ) => {
    const { traceId } = generateTraceContext();
    addTraceId(traceId);

    const payload: {
      queryReq: SearchRequestPayload;
      type: "search" | "histogram" | "pageCount" | "values";
      isPagination: boolean;
      traceId: string;
      org_id: string;
      meta?: any;
    } = {
      queryReq,
      type,
      isPagination,
      traceId,
      org_id: searchObj.organizationIdentifier,
      meta,
    };

    return payload;
  };

  //index.vue
  const initializeSearchConnection = (
    payload: any,
  ): string | Promise<void> | null => {
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
  };

  // Bhargav Todo: this is duplicate in indexList.vue file
  const sendSearchMessage = (queryReq: any) => {
    try {
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
            // pass encodig if enabled,
            // make sure that `encoding: null` is not being passed, that's why used object extraction logic
            ...(store.state.zoConfig.sql_base64_enabled
              ? { encoding: "base64" }
              : {}),
          } as SearchRequestPayload,
          stream_type: searchObj.data.stream.streamType,
          search_type: "ui",
          use_cache: (window as any).use_cache ?? true,
          org_id: searchObj.organizationIdentifier,
        },
      };

      if (
        Object.hasOwn(queryReq.queryReq, "regions") &&
        Object.hasOwn(queryReq.queryReq, "clusters")
      ) {
        payload.content.payload["regions"] = queryReq.queryReq.regions;
        payload.content.payload["clusters"] = queryReq.queryReq.clusters;
      }

      sendSearchMessageBasedOnRequestId(payload);
    } catch (e: any) {
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred while sending socket message.",
      );
      notificationMsg.value = "";
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
      (isPagination && searchPartitionMap[payload.traceId] === 1) ||
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

  const handleStreamingMetadata = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
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
        histogramResults.push({
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
        histogramResults.push({
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
    removeTraceId(response.content.traceId);

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
      handleStreamingHits(
        payload,
        response,
        payload.isPagination,
        !(
          response.content?.streaming_aggs ||
          searchObj.data.queryResults.streaming_aggs
        ) && searchPartitionMap[payload.traceId] > 1,
      );
      return;
    }

    if (
      payload.type === "search" &&
      response?.type === "search_response_metadata"
    ) {
      searchPartitionMap[payload.traceId] = searchPartitionMap[payload.traceId]
        ? searchPartitionMap[payload.traceId]
        : 0;
      searchPartitionMap[payload.traceId]++;
      handleStreamingMetadata(
        payload,
        response,
        payload.isPagination,
        !response.content?.streaming_aggs &&
          searchPartitionMap[payload.traceId] > 1,
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
        : 0;
      searchPartitionMap[payload.traceId]++;

      if (payload.type === "search") {
        handleLogsResponse(
          payload.queryReq,
          payload.isPagination,
          payload.traceId,
          response,
          !response.content?.streaming_aggs &&
            searchPartitionMap[payload.traceId] > 1, // In aggregation query, we need to replace the results instead of appending
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

        if (response.content?.streaming_aggs) {
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
      if (searchObj.data.histogramInterval / 1000 <= 9999) {
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
        histogramResults.push({
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
        histogramResults.push({
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

        histogramResults = [];

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

  // Bhargav Todo: duplicate function in index.vue
  function isHistogramEnabled(searchObj: any) {
    return (
      searchObj.meta.refreshHistogram &&
      !searchObj.loadingHistogram &&
      searchObj.meta.showHistogram
    );
  }

  // useLogs.ts
  function isNonAggregatedSQLMode(searchObj: any, parsedSQL: any) {
    return !(
      searchObj.meta.sqlMode &&
      (isLimitQuery(parsedSQL) ||
        isDistinctQuery(parsedSQL) ||
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible)
    );
  }

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
      searchObj.meta.resetPlotChart = true;
    }
    if (
      payload.type === "search" &&
      !payload.isPagination &&
      !searchObj.data.isOperationCancelled
    ) {
      processHistogramRequest(payload.queryReq);
    }

    if (payload.type === "search" && !response?.content?.should_client_retry)
      searchObj.loading = false;
    if (
      (payload.type === "histogram" || payload.type === "pageCount") &&
      !response?.content?.should_client_retry
    ) {
      searchObj.loadingHistogram = false;
    }

    searchObj.data.isOperationCancelled = false;
  };

  // indexList.vue
  const handleSearchError = (request: any, err: WebSocketErrorResponse) => {
    searchObj.loading = false;
    searchObj.loadingHistogram = false;

    const { message, trace_id, code, error_detail, error } = err.content;

    // 20009 is the code for query cancelled
    if (code === 20009) {
      showCancelSearchNotification();
      setCancelSearchError();
    }

    if (trace_id) removeTraceId(trace_id);

    let errorMsg = constructErrorMessage({
      message,
      code,
      trace_id,
      defaultMessage: "Error while processing request",
    });

    if (error === "rate_limit_exceeded") {
      errorMsg = message;
    }

    if (request.type === "pageCount") {
      searchObj.data.countErrorMsg = "Error while retrieving total events: ";
      if (trace_id) searchObj.data.countErrorMsg += " TraceID: " + trace_id;
      notificationMsg.value = searchObj.data.countErrorMsg;
    } else {
      if (request.type === "pageCount") {
        searchObj.data.countErrorMsg = "Error while retrieving total events: ";
        if (trace_id) searchObj.data.countErrorMsg += " TraceID: " + trace_id;
        notificationMsg.value = searchObj.data.countErrorMsg;
      } else {
        searchObj.data.errorDetail = error_detail || "";
        searchObj.data.errorMsg = errorMsg;
        notificationMsg.value = errorMsg;
      }
    }
  };

  const constructErrorMessage = ({
    message,
    code,
    trace_id,
    defaultMessage,
  }: {
    message?: string;
    code?: number;
    trace_id?: string;
    defaultMessage: string;
  }): string => {
    let errorMsg = message || defaultMessage;

    const customMessage = logsErrorMessage(code || 0);
    if (customMessage) {
      errorMsg = t(customMessage);
    }

    if (trace_id) {
      errorMsg += ` <br><span class='text-subtitle1'>TraceID: ${trace_id}</span>`;
    }

    return errorMsg;
  };

  const getAggsTotal = () => {
    return (searchObj.data.queryResults.aggs || []).reduce(
      (acc: number, item: { zo_sql_num: number }) => acc + item.zo_sql_num,
      0,
    );
  };

  // searchResult.vue
  const refreshPagination = (regenrateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;

      if (searchObj.meta.jobId != "")
        searchObj.meta.resultGrid.rowsPerPage = 100;

      let total = 0;
      let totalPages = 0;

      total = getAggsTotal();

      if ((searchObj.data.queryResults.pageCountTotal || -1) > total) {
        total = searchObj.data.queryResults.pageCountTotal;
      }

      searchObj.data.queryResults.total = total;
      searchObj.data.queryResults.pagination = [];

      totalPages = Math.ceil(total / rowsPerPage);

      for (let i = 0; i < totalPages; i++) {
        if (i + 1 > currentPage + 10) {
          break;
        }
        searchObj.data.queryResults.pagination.push({
          from: i * rowsPerPage + 1,
          size: rowsPerPage,
        });
      }
    } catch (e: any) {
      console.log("Error while refreshing partition pagination", e);
      notificationMsg.value = "Error while refreshing partition pagination.";
      return false;
    }
  };

  const shouldGetPageCount = (queryReq: any, parsedSQL: any) => {
    if (
      shouldShowHistogram(parsedSQL) ||
      (searchObj.meta.sqlMode && isLimitQuery(parsedSQL))
    ) {
      return false;
    }
    let aggFlag = false;
    if (parsedSQL) {
      aggFlag = hasAggregation(parsedSQL?.columns);
    }
    if (!aggFlag) {
      return true;
    }
    return false;
  };

  const getPageCountThroughSocket = async (queryReq: any) => {
    if (
      searchObj.data.queryResults.total >
      queryReq.query.from + queryReq.query.size
    ) {
      return;
    }

    searchObj.data.countErrorMsg = "";
    queryReq.query.size = 0;
    delete queryReq.query.from;
    delete queryReq.query.quick_mode;
    if (delete queryReq.query.action_id) delete queryReq.query.action_id;

    queryReq.query.track_total_hits = true;

    if (
      searchObj.data?.queryResults?.time_offset?.start_time &&
      searchObj.data?.queryResults?.time_offset?.end_time
    ) {
      queryReq.query.start_time =
        searchObj.data.queryResults.time_offset.start_time;
      queryReq.query.end_time =
        searchObj.data.queryResults.time_offset.end_time;
    }

    const payload = buildWebSocketPayload(queryReq, false, "pageCount");

    searchObj.loadingHistogram = true;

    const requestId = initializeSearchConnection(payload);

    addTraceId(payload.traceId);
  };

  const setCancelSearchError = () => {
    if (!searchObj.data?.queryResults.hasOwnProperty("hits")) {
      searchObj.data.queryResults.hits = [];
    }

    if (!searchObj.data?.queryResults?.hits?.length) {
      searchObj.data.errorMsg = "";
      searchObj.data.errorCode = 0;
    }

    if (
      searchObj.data?.queryResults?.hasOwnProperty("hits") &&
      searchObj.data.queryResults?.hits?.length &&
      !searchObj.data.queryResults?.aggs?.length
    ) {
      searchObj.data.histogram.errorMsg =
        "Histogram search query was cancelled";
    }
  };

  return {
    getDataThroughStream,
    initializeSearchConnection,
    buildWebSocketPayload,
  };
};
