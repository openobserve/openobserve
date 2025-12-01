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
import { useHistogram } from "@/composables/useLogs/useHistogram";
import { useRouter } from "vue-router";
import { SearchRequestPayload } from "@/ts/interfaces/query";
import { convertDateToTimestamp } from "@/utils/date";

export const useSearchHistogramManager = () => {
  let histogramResults: any = [];
  const router = useRouter();

  const {
    fnParsedSQL,
    isDistinctQuery,
    isWithQuery,
    isLimitQuery,
    addTraceId,
    isNonAggregatedSQLMode,
  } = logsUtils();

  const {
    resetHistogramWithError,
    generateHistogramSkeleton,
    setMultiStreamHistogramQuery,
    isHistogramEnabled,
  } = useHistogram();

  const { searchObj, searchObjDebug, resetHistogramError } = searchState();

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

  const processHistogramRequest = async (
    queryReq: SearchRequestPayload,
    buildWebSocketPayload: Function,
    initializeSearchConnection: Function,
    callbacks?: {
      onData: (payload: any, response: any) => void;
      onError: (payload: any, error: any) => void;
      onComplete: (payload: any, response: any) => void;
      onReset: (data: any, traceId?: string) => void;
    },
    meta? : {
      clear_cache?: Boolean
    }
  ) => {
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
          {},
           meta?.clear_cache
        );

        if (callbacks) {
          payload.onData = callbacks.onData;
          payload.onError = callbacks.onError;
          payload.onComplete = callbacks.onComplete;
          payload.onReset = callbacks.onReset;
        }

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
          getPageCountThroughSocket(
            queryReq,
            buildWebSocketPayload,
            initializeSearchConnection,
            callbacks,
          );
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
          getPageCountThroughSocket(
            queryReq,
            buildWebSocketPayload,
            initializeSearchConnection,
            callbacks,
          );
          searchObjDebug["pagecountEndTime"] = performance.now();
        }, 0);
      }
    }
  };

  const handleHistogramResponse = (
    queryReq: SearchRequestPayload,
    traceId: string,
    response: any,
    meta?: any,
    refreshPagination?: Function,
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
      generateHistogramFillData(response);
    }

    searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;
    searchObj.data.queryResults.result_cache_ratio +=
      response.content.results.result_cache_ratio;

    (async () => {
      try {
        // generateHistogramData would need to be passed in or imported
        // generateHistogramData();
        if (!meta?.isHistogramOnly && refreshPagination)
          refreshPagination(true);
      } catch (error) {
        console.error("Error processing histogram data:", error);
        searchObj.loadingHistogram = false;
      }
    })();

    searchObjDebug["histogramProcessingEndTime"] = performance.now();
    searchObjDebug["histogramEndTime"] = performance.now();
  };

  const generateHistogramFillData = (response: any) => {
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
  };

  const getPageCountThroughSocket = async (
    queryReq: any,
    buildWebSocketPayload: Function,
    initializeSearchConnection: Function,
    callbacks?: {
      onData: (payload: any, response: any) => void;
      onError: (payload: any, error: any) => void;
      onComplete: (payload: any, response: any) => void;
      onReset: (data: any, traceId?: string) => void;
    },
  ) => {
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
    if (queryReq.query.action_id) delete queryReq.query.action_id;

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

    if (callbacks) {
      payload.onData = callbacks.onData;
      payload.onError = callbacks.onError;
      payload.onComplete = callbacks.onComplete;
      payload.onReset = callbacks.onReset;
    }

    searchObj.loadingHistogram = true;

    const requestId = initializeSearchConnection(payload);

    addTraceId(payload.traceId);
  };

  const isHistogramDataMissing = (searchObj: any) => {
    return !searchObj.data.queryResults?.aggs?.length;
  };

  const shouldGetPageCount = (queryReq: any, parsedSQL: any): boolean => {
    return shouldShowHistogram(parsedSQL) ||
      (searchObj.meta.sqlMode && isLimitQuery(parsedSQL))
      ? false
      : true;
  };

  const resetHistogramResults = () => {
    histogramResults = [];
  };

  const getHistogramResults = () => {
    return histogramResults;
  };

  return {
    shouldShowHistogram,
    processHistogramRequest,
    handleHistogramResponse,
    isHistogramDataMissing,
    shouldGetPageCount,
    getPageCountThroughSocket,
    resetHistogramResults,
    getHistogramResults,
  };
};

export default useSearchHistogramManager;
