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

import { nextTick } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import { searchState } from "@/composables/useLogs/searchState";
import useStreams from "@/composables/useStreams";
import useSqlSuggestions from "@/composables/useSuggestions";

import { INTERVAL_MAP, DEFAULT_LOGS_CONFIG } from "@/utils/logs/constants";

import {
  useLocalLogFilterField,
  b64EncodeUnicode,
  b64DecodeUnicode,
  formatSizeFromMB,
  timestampToTimezoneDate,
  histogramDateTimezone,
  useLocalWrapContent,
  useLocalTimezone,
  useLocalInterestingFields,
  useLocalSavedView,
  convertToCamelCase,
  getFunctionErrorMessage,
  getUUID,
  getWebSocketUrl,
  generateTraceContext,
  arraysMatch,
  isWebSocketEnabled,
  isStreamingEnabled,
  addSpacesToOperators,
  deepCopy,
} from "@/utils/zincutils";

import {
  logsUtils
} from "@/composables/useLogs/logsUtils";

export const histogramUtils = () => {
  const store = useStore();
  const router = useRouter();
  let {
    searchObj,
    searchObjDebug,
    fieldValues,
    notificationMsg,
    streamSchemaFieldsIndexMapping,
    histogramMappedData,
    histogramResults,
  } = searchState();
  const {
    getStreams,
    getStream,
    getMultiStreams,
    isStreamExists,
    isStreamFetched,
  } = useStreams();

  const {fnParsedSQL,
    fnUnparsedSQL,
    extractTimestamps,
    hasAggregation,
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    addTraceId,
    removeTraceId,
    addTransformToQuery,
    isActionsEnabled,
    getColumnWidth,} = logsUtils();

  const getHistogramTitle = () => {
    try {
      const currentPage = searchObj.data.resultGrid.currentPage - 1 || 0;
      const startCount = currentPage * searchObj.meta.resultGrid.rowsPerPage + 1;
      let endCount;

      let totalCount = Math.max(
        searchObj.data.queryResults.hits?.length,
        searchObj.data.queryResults.total,
      );

      if (!searchObj.meta.resultGrid.showPagination) {
        endCount = searchObj.data.queryResults.hits?.length;
        totalCount = searchObj.data.queryResults.hits?.length;
      } else {
        endCount = searchObj.meta.resultGrid.rowsPerPage * (currentPage + 1);
        if (
          currentPage >=
          (searchObj.communicationMethod === "ws" ||
          searchObj.communicationMethod === "streaming" ||
          searchObj.meta.jobId != ""
            ? searchObj.data.queryResults?.pagination?.length
            : searchObj.data.queryResults.partitionDetail?.paginations?.length ||
              0) -
            1
        ) {
          endCount = Math.min(
            startCount + searchObj.meta.resultGrid.rowsPerPage - 1,
            totalCount,
          );
        } else {
          endCount = searchObj.meta.resultGrid.rowsPerPage * (currentPage + 1);
        }
      }

      if (searchObj.meta.sqlMode && searchAggData.hasAggregation) {
        totalCount = searchAggData.total;
      }

      if (isNaN(totalCount)) {
        totalCount = 0;
      }

      if (isNaN(endCount)) {
        endCount = 0;
      }

      let plusSign: string = "";
      if (
        searchObj.data.queryResults?.partitionDetail?.partitions?.length > 1 &&
        endCount < totalCount &&
        searchObj.meta.showHistogram == false
      ) {
        plusSign = "+";
      }

      if (
        (searchObj.communicationMethod === "ws" ||
          searchObj.communicationMethod === "streaming") &&
        endCount < totalCount &&
        !searchObj.meta.showHistogram
      ) {
        plusSign = "+";
      }

      const scanSizeLabel =
        searchObj.data.queryResults.result_cache_ratio !== undefined &&
        searchObj.data.queryResults.result_cache_ratio > 0
          ? "Delta Scan Size"
          : "Scan Size";

      const title =
        "Showing " +
        startCount +
        " to " +
        endCount +
        " out of " +
        totalCount.toLocaleString() +
        plusSign +
        " events in " +
        searchObj.data.queryResults.took +
        " ms. (" +
        scanSizeLabel +
        ": " +
        formatSizeFromMB(searchObj.data.queryResults.scan_size) +
        plusSign +
        ")";
      return title;
    } catch (e: any) {
      console.log("Error while generating histogram title", e);
      notificationMsg.value = "Error while generating histogram title.";
      return "";
    }
  };

  const generateHistogramData = () => {
    try {
      // searchObj.data.histogram.chartParams.title = ""
      let num_records: number = 0;
      const unparsed_x_data: any[] = [];
      const xData: number[] = [];
      const yData: number[] = [];
      let hasAggregationFlag = false;

      const parsedSQL: any = fnParsedSQL();
      if (searchObj.meta.sqlMode && parsedSQL.hasOwnProperty("columns")) {
        hasAggregationFlag = hasAggregation(parsedSQL.columns);
      }

      if (
        searchObj.data.queryResults.hasOwnProperty("aggs") &&
        searchObj.data.queryResults.aggs
      ) {
        histogramMappedData = new Map(
          histogramResults.map((item: any) => [
            item.zo_sql_key,
            JSON.parse(JSON.stringify(item)),
          ]),
        );

        searchObj.data.queryResults.aggs.forEach((item: any) => {
          if (histogramMappedData.has(item.zo_sql_key)) {
            histogramMappedData.get(item.zo_sql_key).zo_sql_num +=
              item.zo_sql_num;
          } else {
            histogramMappedData.set(item.zo_sql_key, item);
          }
        });

        const mergedData: any = Array.from(histogramMappedData.values());
        mergedData.map(
          (bucket: {
            zo_sql_key: string | number | Date;
            zo_sql_num: string;
          }) => {
            num_records = num_records + parseInt(bucket.zo_sql_num, 10);
            unparsed_x_data.push(bucket.zo_sql_key);
            // const histDate = new Date(bucket.zo_sql_key);
            xData.push(
              histogramDateTimezone(bucket.zo_sql_key, store.state.timezone),
            );
            // xData.push(Math.floor(histDate.getTime()))
            yData.push(parseInt(bucket.zo_sql_num, 10));
          },
        );

        searchObj.data.queryResults.total = num_records;
      }

      const chartParams = {
        title: getHistogramTitle(),
        unparsed_x_data: unparsed_x_data,
        timezone: store.state.timezone,
      };
      searchObj.data.histogram = {
        xData,
        yData,
        chartParams,
        errorCode: 0,
        errorMsg: "",
        errorDetail: "",
      };
    } catch (e: any) {
      console.log("Error while generating histogram data", e);
      notificationMsg.value = "Error while generating histogram data.";
    }
  };

  const resetHistogramWithError = (
    errorMsg: string,
    errorCode: number = 0,
  ) => {
    searchObj.data.histogram = {
      xData: [],
      yData: [],
      chartParams: {
        title: getHistogramTitle(),
        unparsed_x_data: [],
        timezone: "",
      },
      errorCode,
      errorMsg,
      errorDetail: "",
    };
  };

  const generateHistogramSkeleton = () => {
    if (
      searchObj.data.queryResults.hasOwnProperty("aggs") &&
      searchObj.data.queryResults.aggs
    ) {
      histogramResults = [];
      histogramMappedData = [];
      const intervalMs: any =
        INTERVAL_MAP[searchObj.meta.resultGrid.chartInterval];
      if (!intervalMs) {
        throw new Error("Invalid interval");
      }
      searchObj.data.histogramInterval = searchObj.data.queryResults
        .histogram_interval
        ? searchObj.data.queryResults.histogram_interval * 1000000
        : intervalMs;
      const date = new Date();
      const startTimeDate = new Date(
        searchObj.data.customDownloadQueryObj.query.start_time / 1000,
      ); // Convert microseconds to milliseconds
      if (searchObj.meta.resultGrid.chartInterval.includes("second")) {
        startTimeDate.setSeconds(startTimeDate.getSeconds() > 30 ? 30 : 0, 0); // Round to the nearest whole minute
      } else if (searchObj.meta.resultGrid.chartInterval.includes("1 minute")) {
        startTimeDate.setSeconds(0, 0); // Round to the nearest whole minute
        // startTimeDate.setMinutes(0, 0); // Round to the nearest whole minute
      } else if (searchObj.meta.resultGrid.chartInterval.includes("minute")) {
        // startTimeDate.setSeconds(0, 0); // Round to the nearest whole minute
        startTimeDate.setMinutes(
          parseInt(
            searchObj.meta.resultGrid.chartInterval.replace(" minute", ""),
          ),
          0,
        ); // Round to the nearest whole minute
      } else if (searchObj.meta.resultGrid.chartInterval.includes("hour")) {
        startTimeDate.setHours(startTimeDate.getHours() + 1);
        startTimeDate.setUTCMinutes(0, 0); // Round to the nearest whole minute
      } else {
        startTimeDate.setMinutes(0, 0); // Round to the nearest whole minute
        startTimeDate.setUTCHours(0, 0, 0); // Round to the nearest whole minute
        startTimeDate.setDate(startTimeDate.getDate() + 1);
      }

      const startTime = startTimeDate.getTime() * 1000;
    }
  };

  const setMultiStreamHistogramQuery = (queryReq: any) => {
    let histogramQuery = `select histogram(${store.state.zoConfig.timestamp_column}, '${searchObj.meta.resultGrid.chartInterval}') AS zo_sql_key, count(*) AS zo_sql_num from "[INDEX_NAME]" [WHERE_CLAUSE] GROUP BY zo_sql_key`;
    let multiSql = [];

    for (const stream of searchObj.data.stream.selectedStream) {
      // one or more filter fields are missing in this stream so no need to include in histogram query
      // this is to avoid the issue of missing fields in multi stream histogram query
      if (searchObj.data.stream.missingStreamMultiStreamFilter.includes(stream)) {
        continue;
      }
      // Replace the index name and where clause in the histogram query for each stream
      multiSql.push(
        histogramQuery
          .replace("[INDEX_NAME]", stream)
          .replace(
            "[WHERE_CLAUSE]",
            searchObj.data.query ? "WHERE " + searchObj.data.query : "",
          ),
      );
    }

    return multiSql.join(" UNION ALL ");
  };

  // Bhargav Todo: duplicate function in index.vue
  const isHistogramEnabled = (searchObj: any) => {
    return (
      searchObj.meta.refreshHistogram &&
      !searchObj.loadingHistogram &&
      searchObj.meta.showHistogram
    );
  };

  return {
    getHistogramTitle,
    generateHistogramData,
    resetHistogramWithError,
    generateHistogramSkeleton,
    setMultiStreamHistogramQuery,
    isHistogramEnabled,
  };

};

export default histogramUtils;