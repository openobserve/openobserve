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
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useNotifications from "@/composables/useNotifications";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import { useHistogram } from "@/composables/useLogs/useHistogram";
import useSearchPagination from "@/composables/useLogs/useSearchPagination";
import { useStore } from "vuex";
import {
  SearchRequestPayload,
  WebSocketSearchPayload,
  WebSocketSearchResponse,
  WebSocketErrorResponse,
} from "@/ts/interfaces/query";
import { logsErrorMessage } from "@/utils/common";
import { getFunctionErrorMessage } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import { convertDateToTimestamp } from "@/utils/date";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

export const useSearchResponseHandler = () => {
  const { showErrorNotification, showCancelSearchNotification } =
    useNotifications();
  const { fnParsedSQL, hasAggregation, removeTraceId, updateUrlQueryParams } =
    logsUtils();

  const { getHistogramTitle, generateHistogramData, resetHistogramWithError } =
    useHistogram();

  const { refreshPagination } = useSearchPagination();

  const { clearCache } = useLogsHighlighter();

  const store = useStore();
  const { t } = useI18n();

  const {
    searchObj,
    searchObjDebug,
    searchAggData,
    resetQueryData,
    notificationMsg,
    searchPartitionMap,
    resetHistogramError,
    histogramResults
  } = searchState();

  const {
    updateFieldValues,
    extractFields,
    updateGridColumns,
    filterHitsColumns,
    resetFieldValues,
  } = useStreamFields();

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

    if (response.type === "cancel_response") {
      searchObj.loading = false;
      searchObj.loadingHistogram = false;
      searchObj.data.isOperationCancelled = false;

      showCancelSearchNotification();
      setCancelSearchError();
    }
  };

  const handleStreamingHits = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
    isPagination: boolean,
    appendResult: boolean = false,
  ) => {
    if (
      (isPagination && searchPartitionMap[payload.traceId].partition === 1) ||
      !appendResult
    ) {
      clearCache();
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
    extractFields();
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
    handleFunctionError(payload.queryReq, response);
    handleAggregation(payload.queryReq, response);
    resetFieldValues();

    if (!payload.queryReq.query.hasOwnProperty("track_total_hits")) {
      delete response.content.total;
    }

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

    if (response.content.results.hasOwnProperty("is_histogram_eligible")) {
      searchObj.data.queryResults.is_histogram_eligible =
        response.content.results.is_histogram_eligible;
    }

    if (searchObj.meta.refreshInterval == 0) {
      const parsedSQL = fnParsedSQL();
      if (
        shouldGetPageCount(payload.queryReq, parsedSQL) &&
        response.content.results.total === payload.queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          payload.queryReq.query.size * searchObj.data.resultGrid.currentPage;
      } else if (
        shouldGetPageCount(payload.queryReq, parsedSQL) &&
        response.content.results.total != payload.queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          payload.queryReq.query.size *
            Math.max(searchObj.data.resultGrid.currentPage - 1, 0) +
          response.content.results.total;
      }
    }

    if (searchObj.data.queryResults) {
      searchObj.data.queryResults.time_offset = response.content?.time_offset;
    }

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
      const parsedSQL = fnParsedSQL();
      if (
        shouldGetPageCount(queryReq, parsedSQL) &&
        total === queryReq.query.size
      ) {
        searchObj.data.queryResults.pageCountTotal =
          searchObj.meta.resultGrid.rowsPerPage *
            searchObj.data.resultGrid.currentPage +
          1;
      } else if (
        shouldGetPageCount(queryReq, parsedSQL) &&
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
      const parsedSQL = fnParsedSQL();
      if (
        shouldGetPageCount(queryReq, parsedSQL) &&
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


    if (searchObj.data.queryResults.order_by?.toLowerCase() === "desc") {
      searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    } else {
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

    searchObj.data.queryResults.converted_histogram_query =
      response?.content?.results?.converted_histogram_query ?? "";

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

  const handleSearchError = (request: any, err: WebSocketErrorResponse) => {
    searchObj.loading = false;
    searchObj.loadingHistogram = false;

    const { message, trace_id, code, error_detail, error } = err.content;

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
    } else if (request.type === "histogram") {
      searchObj.data.histogram.errorMsg = errorMsg;
      searchObj.data.histogram.errorCode = code || 0;
      searchObj.data.histogram.errorDetail = error_detail || "";
      notificationMsg.value = errorMsg;
    } else {
      searchObj.data.errorDetail = error_detail || "";
      searchObj.data.errorMsg = errorMsg;
      notificationMsg.value = errorMsg;
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

  const shouldGetPageCount = (queryReq: any, parsedSQL: any): boolean => {
    // Simplified version - implement full logic as needed
    return (
      !queryReq.query.sql?.includes("LIMIT") &&
      !queryReq.query.sql?.includes("DISTINCT")
    );
  };

  // const refreshPagination = (regenerateFlag: boolean = false) => {
  //   // This would typically call a pagination composable
  //   // For now, it's a placeholder
  //   console.log("Refreshing pagination", regenerateFlag);
  // };

  return {
    handleSearchResponse,
    handleStreamingHits,
    handleStreamingMetadata,
    handleHistogramStreamingHits,
    handleHistogramStreamingMetadata,
    handlePageCountStreamingHits,
    handlePageCountStreamingMetadata,
    handleFunctionError,
    handleAggregation,
    handleSearchError,
    constructErrorMessage,
    setCancelSearchError,
    updatePageCountTotal,
    trimPageCountExtraHit,
  };
};

export default useSearchResponseHandler;
