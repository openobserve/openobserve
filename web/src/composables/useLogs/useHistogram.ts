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

import { useStore } from "vuex";

import { searchState } from "@/composables/useLogs/searchState";

import { INTERVAL_MAP } from "@/utils/logs/constants";

import { formatSizeFromMB, histogramDateTimezone } from "@/utils/zincutils";

import { logsUtils } from "@/composables/useLogs/logsUtils";

export const useHistogram = () => {
  const store = useStore();
  let {
    searchObj,
    notificationMsg,
    histogramMappedData,
    histogramResults,
    searchAggData,
  } = searchState();

  const { fnParsedSQL, hasAggregation } = logsUtils();

  const getHistogramTitle = () => {
    try {
      const currentPage = searchObj.data.resultGrid.currentPage - 1 || 0;
      const startCount =
        currentPage * searchObj.meta.resultGrid.rowsPerPage + 1;
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
          (searchObj.communicationMethod === "streaming" ||
          searchObj.meta.jobId != ""
            ? searchObj.data.queryResults?.pagination?.length
            : searchObj.data.queryResults.partitionDetail?.paginations
                ?.length || 0) -
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
        searchObj.communicationMethod === "streaming" &&
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

      let title =
        "Showing " +
        startCount +
        " to " +
        endCount +
        " out of " +
        totalCount.toLocaleString() +
        plusSign +
        " events in " +
        searchObj.data.queryResults.took +
        " ms.";

      if (searchObj.meta.logsVisualizeToggle === "logs") {
        title +=
          " (" +
          scanSizeLabel +
          ": " +
          formatSizeFromMB(searchObj.data.queryResults.scan_size) +
          plusSign +
          ")";
      }
      return title;
    } catch (e: any) {
      console.error("Error while generating histogram title", e);
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
          histogramResults.value.map((item: any) => [
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
      console.error("Error while generating histogram data", e);
      notificationMsg.value = "Error while generating histogram data.";
    }
  };

  const resetHistogramWithError = (errorMsg: string, errorCode: number = 0) => {
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
      histogramResults.value = [];
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
      if (
        searchObj.data.stream.missingStreamMultiStreamFilter.includes(stream)
      ) {
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

  // const getHistogramQueryData = (queryReq: any) => {
  //   return new Promise((resolve, reject) => {
  //     if (searchObj.data.isOperationCancelled) {
  //       searchObj.loadingHistogram = false;
  //       searchObj.data.isOperationCancelled = false;

  //       if (!searchObj.data.histogram?.xData?.length) {
  //         notificationMsg.value = "Search query was cancelled";
  //         searchObj.data.histogram.errorMsg = "Search query was cancelled";
  //         searchObj.data.histogram.errorDetail = "Search query was cancelled";
  //       }

  //       showCancelSearchNotification();
  //       return;
  //     }

  //     const dismiss = () => {};
  //     try {
  //       // Set histogram interval
  //       if (searchObj.data.queryResults.histogram_interval) {
  //         //1. here we need to send the histogram interval to the BE so that it will honor this we get this from the search partition response
  //         //2. if user passes the histogram interval in the query BE will honor that and give us histogram interval in the parition response
  //         searchObj.data.histogramInterval =
  //           searchObj.data.queryResults.histogram_interval * 1000000;
  //         queryReq.query.histogram_interval =
  //           searchObj.data.queryResults.histogram_interval;
  //       }

  //       if (!searchObj.data.histogramInterval) {
  //         console.error(
  //           "Error processing histogram data:",
  //           "histogramInterval is not set",
  //         );
  //         searchObj.loadingHistogram = false;
  //         return;
  //       }
  //       const { traceparent, traceId } = generateTraceContext();
  //       addTraceId(traceId);
  //       queryReq.query.size = -1;
  //       searchService
  //         .search(
  //           {
  //             org_identifier: searchObj.organizationIdentifier,
  //             query: queryReq,
  //             page_type: searchObj.data.stream.streamType,
  //             traceparent,
  //             is_ui_histogram: true,
  //           },
  //           "ui",
  //           searchObj.data.stream.selectedStream.length > 1 &&
  //             searchObj.meta.sqlMode == false
  //             ? true
  //             : false,
  //         )
  //         .then(async (res: any) => {
  //           removeTraceId(traceId);
  //           searchObjDebug["histogramProcessingStartTime"] = performance.now();

  //           searchObj.loading = false;
  //           if (searchObj.data.queryResults.aggs == null) {
  //             searchObj.data.queryResults.aggs = [];
  //           }

  //           // copy converted_histogram_query to queryResults
  //           searchObj.data.queryResults.converted_histogram_query =
  //             res?.data?.converted_histogram_query ?? "";

  //           const parsedSQL: any = fnParsedSQL();
  //           const partitions = JSON.parse(
  //             JSON.stringify(
  //               searchObj.data.queryResults.partitionDetail.partitions,
  //             ),
  //           );

  //           // is _timestamp orderby ASC then reverse the partition array
  //           if (isTimestampASC(parsedSQL?.orderby) && partitions.length > 1) {
  //             partitions.reverse();
  //           }

  //           if (
  //             searchObj.data.queryResults.aggs.length == 0 &&
  //             res.data.hits.length > 0
  //           ) {
  //             for (const partition of partitions) {
  //               if (
  //                 partition[0] == queryReq.query.start_time &&
  //                 partition[1] == queryReq.query.end_time
  //               ) {
  //                 histogramResults = [];
  //                 let date = new Date();
  //                 const startDateTime =
  //                   searchObj.data.customDownloadQueryObj.query.start_time /
  //                   1000;

  //                 const endDateTime =
  //                   searchObj.data.customDownloadQueryObj.query.end_time / 1000;

  //                 const nowString = res.data.hits[0].zo_sql_key;
  //                 const now = new Date(nowString);

  //                 const day = String(now.getDate()).padStart(2, "0");
  //                 const month = String(now.getMonth() + 1).padStart(2, "0");
  //                 const year = now.getFullYear();

  //                 const dateToBePassed = `${day}-${month}-${year}`;
  //                 const hours = String(now.getHours()).padStart(2, "0");
  //                 let minutes = String(now.getMinutes()).padStart(2, "0");
  //                 if (searchObj.data.histogramInterval / 1000 <= 9999) {
  //                   minutes = String(now.getMinutes() + 1).padStart(2, "0");
  //                 }

  //                 const time = `${hours}:${minutes}`;

  //                 const currentTimeToBePassed = convertDateToTimestamp(
  //                   dateToBePassed,
  //                   time,
  //                   "UTC",
  //                 );
  //                 for (
  //                   let currentTime: any =
  //                     currentTimeToBePassed.timestamp / 1000;
  //                   currentTime < endDateTime;
  //                   currentTime += searchObj.data.histogramInterval / 1000
  //                 ) {
  //                   date = new Date(currentTime);
  //                   histogramResults.push({
  //                     zo_sql_key: date.toISOString().slice(0, 19),
  //                     zo_sql_num: 0,
  //                   });
  //                 }
  //                 for (
  //                   let currentTime: any =
  //                     currentTimeToBePassed.timestamp / 1000;
  //                   currentTime > startDateTime;
  //                   currentTime -= searchObj.data.histogramInterval / 1000
  //                 ) {
  //                   date = new Date(currentTime);
  //                   histogramResults.push({
  //                     zo_sql_key: date.toISOString().slice(0, 19),
  //                     zo_sql_num: 0,
  //                   });
  //                 }
  //               }
  //             }
  //           }

  //           const order_by = res?.data?.order_by ?? "desc";

  //           if (order_by?.toLowerCase() === "desc") {
  //             searchObj.data.queryResults.aggs.push(...res.data.hits);
  //           } else {
  //             searchObj.data.queryResults.aggs.unshift(...res.data.hits);
  //           }

  //           searchObj.data.queryResults.scan_size += res.data.scan_size;
  //           searchObj.data.queryResults.took += res.data.took;
  //           searchObj.data.queryResults.result_cache_ratio +=
  //             res.data.result_cache_ratio;
  //           const currentStartTime = queryReq.query.start_time;
  //           const currentEndTime = queryReq.query.end_time;
  //           let totalHits = 0;
  //           searchObj.data.queryResults.partitionDetail.partitions.map(
  //             (item: any, index: any) => {
  //               if (item[0] == currentStartTime && item[1] == currentEndTime) {
  //                 totalHits = res.data.hits.reduce(
  //                   (accumulator: number, currentValue: any) =>
  //                     accumulator +
  //                     Math.max(parseInt(currentValue.zo_sql_num, 10), 0),
  //                   0,
  //                 );

  //                 searchObj.data.queryResults.partitionDetail.partitionTotal[
  //                   index
  //                 ] = totalHits;

  //                 return;
  //               }
  //             },
  //           );

  //           queryReq.query.start_time =
  //             searchObj.data.queryResults.partitionDetail.paginations[
  //               searchObj.data.resultGrid.currentPage - 1
  //             ][0].startTime;
  //           queryReq.query.end_time =
  //             searchObj.data.queryResults.partitionDetail.paginations[
  //               searchObj.data.resultGrid.currentPage - 1
  //             ][0].endTime;

  //           // check if histogram interval is undefined, then set current response as histogram response
  //           // for visualization, will require to set histogram interval to fill missing values
  //           // Using same histogram interval attribute creates pagination issue(showing 1 to 50 out of .... was not shown on page change)
  //           // created new attribute visualization_histogram_interval to avoid this issue
  //           if (
  //             !searchObj.data.queryResults.visualization_histogram_interval &&
  //             res.data?.histogram_interval
  //           ) {
  //             searchObj.data.queryResults.visualization_histogram_interval =
  //               res.data?.histogram_interval;
  //           }

  //           // if (hasAggregationFlag) {
  //           //   searchObj.data.queryResults.total = res.data.total;
  //           // }

  //           // searchObj.data.histogram.chartParams.title = getHistogramTitle();

  //           searchObjDebug["histogramProcessingEndTime"] = performance.now();
  //           searchObjDebug["histogramEndTime"] = performance.now();

  //           dismiss();
  //           resolve(true);
  //         })
  //         .catch((err) => {
  //           searchObj.loadingHistogram = false;

  //           // Reset cancel query on search error
  //           searchObj.data.isOperationCancelled = false;

  //           let trace_id = "";

  //           if (err?.request?.status != 429) {
  //             searchObj.data.histogram.errorMsg =
  //               typeof err == "string" && err
  //                 ? err
  //                 : "Error while processing histogram request.";
  //             if (err.response != undefined) {
  //               searchObj.data.histogram.errorMsg = err.response.data.error;
  //               if (err.response.data.hasOwnProperty("trace_id")) {
  //                 trace_id = err.response.data?.trace_id;
  //               }
  //             } else {
  //               searchObj.data.histogram.errorMsg = err.message;
  //               if (err.hasOwnProperty("trace_id")) {
  //                 trace_id = err?.trace_id;
  //               }
  //             }

  //             const customMessage = logsErrorMessage(err?.response?.data.code);
  //             searchObj.data.histogram.errorCode = err?.response?.data.code;
  //             searchObj.data.histogram.errorDetail =
  //               err?.response?.data?.error_detail;

  //             if (customMessage != "") {
  //               searchObj.data.histogram.errorMsg = t(customMessage);
  //             }

  //             notificationMsg.value = searchObj.data.histogram.errorMsg;

  //             if (trace_id) {
  //               searchObj.data.histogram.errorMsg +=
  //                 " <br><span class='text-subtitle1'>TraceID:" +
  //                 trace_id +
  //                 "</span>";
  //               notificationMsg.value += " TraceID:" + trace_id;
  //               trace_id = "";
  //             }
  //           }

  //           reject(false);
  //         })
  //         .finally(() => {
  //           removeTraceId(traceId);
  //         });
  //     } catch (e: any) {
  //       dismiss();
  //       // searchObj.data.histogram.errorMsg = e.message;
  //       // searchObj.data.histogram.errorCode = e.code;
  //       searchObj.loadingHistogram = false;
  //       notificationMsg.value = searchObj.data.histogram.errorMsg;
  //       showErrorNotification("Error while fetching histogram data");

  //       reject(false);
  //     }
  //   });
  // };

  return {
    getHistogramTitle,
    generateHistogramData,
    resetHistogramWithError,
    generateHistogramSkeleton,
    setMultiStreamHistogramQuery,
    isHistogramEnabled,
  };
};

export default useHistogram;
