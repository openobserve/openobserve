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
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import { searchState } from "@/composables/useLogs/searchState";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import searchService from "@/services/search";
import { useHistogram } from "@/composables/useLogs/useHistogram";
import { logsErrorMessage } from "@/utils/common";

import {
  getFunctionErrorMessage,
  generateTraceContext,
} from "@/utils/zincutils";

import { logsUtils } from "@/composables/useLogs/logsUtils";
import useStreamFields from "@/composables/useLogs/useStreamFields";

export const usePagination = () => {
  const store = useStore();
  const router = useRouter();
  const { t } = useI18n();
  let { searchObj, searchObjDebug, searchAggData, notificationMsg } =
    searchState();

  const { getHistogramTitle } = useHistogram();
  const {
    updateFieldValues,
    extractFields,
    updateGridColumns,
    filterHitsColumns,
    resetFieldValues,
  } = useStreamFields();

  const {
    fnParsedSQL,
    hasAggregation,
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    addTraceId,
    removeTraceId,
    showCancelSearchNotification,
    updateUrlQueryParams,
  } = logsUtils();

  const { chunkedAppend } = useSearchStream();

  // Sorting function
  interface OrderByField {
    0: string;
    1: "asc" | "desc" | "ASC" | "DESC";
  }

  type OrderByArray = OrderByField[];

  interface RecordObject {
    [key: string]: any;
  }

  const getPaginatedData = async (
    queryReq: any,
    appendResult: boolean = false,
    isInitialRequest: boolean = true,
  ) => {
    return new Promise((resolve, reject) => {
      if (searchObj.data.isOperationCancelled) {
        notificationMsg.value = "Search operation is cancelled.";

        searchObj.loading = false;
        searchObj.data.isOperationCancelled = false;
        showCancelSearchNotification();
        return;
      }
      // if (searchObj.meta.jobId != "") {
      //   searchObj.meta.resultGrid.rowsPerPage = queryReq.query.size;
      // }
      const parsedSQL: any = fnParsedSQL(searchObj.data.query);

      if (isInitialRequest) {
        searchObj.meta.resultGrid.showPagination = true;
      }

      if (searchObj.meta.sqlMode == true && parsedSQL != undefined) {
        // if query has aggregation or groupby then we need to set size to -1 to get all records
        // issue #5432
        //here BE return all the records if we set the size to -1 and we are doing it as we dont support pagination for aggregation and groupby
        if (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null) {
          queryReq.query.size = -1;
        }
        //if the query has limit then we need to set the size to the limit and we are doing it as we also don't support pagination for limit
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

      const isAggregation =
        searchObj.meta.sqlMode &&
        parsedSQL != undefined &&
        (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null);

      if (searchObj.data.queryResults.histogram_interval) {
        queryReq.query.histogram_interval =
          searchObj.data.queryResults.histogram_interval;
      }

      const { traceparent, traceId } = generateTraceContext();
      addTraceId(traceId);
      //here we are deciding search because when we have jobID present (search schedule job ) then we need to call get_scheduled_search_result
      //else we will call search
      const decideSearch = searchObj.meta.jobId
        ? "get_scheduled_search_result"
        : "search";
      searchService[decideSearch](
        {
          org_identifier: searchObj.organizationIdentifier,
          query: queryReq,
          jobId: searchObj.meta.jobId ? searchObj.meta.jobId : "",
          page_type: searchObj.data.stream.streamType,
          traceparent,
        },
        "ui",
      )
        .then(async (res: any) => {
          if (
            res.data.hasOwnProperty("function_error") &&
            res.data.function_error != ""
          ) {
            searchObj.data.functionError = res.data.function_error;
          }

          if (
            res.data.hasOwnProperty("function_error") &&
            res.data.function_error != "" &&
            res.data.hasOwnProperty("new_start_time") &&
            res.data.hasOwnProperty("new_end_time")
          ) {
            res.data.function_error = getFunctionErrorMessage(
              res.data.function_error,
              res.data.new_start_time,
              res.data.new_end_time,
              store.state.timezone,
            );
            searchObj.data.datetime.startTime = res.data.new_start_time;
            searchObj.data.datetime.endTime = res.data.new_end_time;
            searchObj.data.datetime.type = "absolute";
            queryReq.query.start_time = res.data.new_start_time;
            queryReq.query.end_time = res.data.new_end_time;
            searchObj.data.histogramQuery.query.start_time =
              res.data.new_start_time;
            searchObj.data.histogramQuery.query.end_time =
              res.data.new_end_time;
            if (
              searchObj.data.queryResults.partitionDetail.partitions.length == 1
            ) {
              searchObj.data.queryResults.partitionDetail.partitions[0].start_time =
                res.data.new_start_time;
            }
            updateUrlQueryParams();
          }
          searchObjDebug["paginatedDataReceivedStartTime"] = performance.now();
          // check for total records update for the partition and update pagination accordingly
          // searchObj.data.queryResults.partitionDetail.partitions.forEach(
          //   (item: any, index: number) => {
          if (searchObj.meta.jobId == "") {
            //here we will check if the partitionTotal is -1 that means we havenot updated the particular partition yet
            //so we will check start_time of the query_req and compare it with the start_time of the partition
            //if it matches then we will update the partitionTotal with the total records in the partition
            //so here we will iterate over the partitions and update the partitionTotal
            //the structure of the partitions would look like this
            // [
            //   [1749627138202000, 1749627198202000],
            //   [1749624498202000, 1749627138202000]
            // ]
            for (const [
              index,
              item,
            ] of searchObj.data.queryResults.partitionDetail.partitions.entries()) {
              if (
                searchObj.data.queryResults.partitionDetail.partitionTotal[
                  index
                ] == -1 &&
                queryReq.query.start_time == item[0]
              ) {
                searchObj.data.queryResults.partitionDetail.partitionTotal[
                  index
                ] = res.data.total;
              }
            }
            //final outupt would look like this
            //if res.data.total = 2 like this it will loop over all partitions like
            // the whole function will be called with the updated queryReq with differnt partitions
            //partitionTotal = [2,-1]
          }

          searchAggData.total = 0;
          searchAggData.hasAggregation = false;

          if (isAggregation) {
            if (queryReq.query?.streaming_output) {
              searchAggData.total = res.data.total;
              searchAggData.hasAggregation = true;
            }
            searchObj.meta.resultGrid.showPagination = false;
          }

          let regeratePaginationFlag = false;
          if (res.data.hits.length != searchObj.meta.resultGrid.rowsPerPage) {
            regeratePaginationFlag = true;
          }
          // if total records in partition is greater than recordsPerPage then we need to update pagination
          // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
          if (
            searchObj.meta.jobId == "" &&
            !(queryReq.query?.streaming_output || isAggregation)
          ) {
            refreshPartitionPagination(regeratePaginationFlag);
          }
          // Scan-size and took time in histogram title
          // For the initial request, we get histogram and logs data. So, we need to sum the scan_size and took time of both the requests.
          // For the pagination request, we only get logs data. So, we need to consider scan_size and took time of only logs request.

          // Aggregation

          // Streaming Outout

          // Normal

          if (queryReq.query?.streaming_output) {
            searchObj.data.queryResults.total =
              searchObj.data.queryResults.hits.length;
            searchObj.data.queryResults.from = res.data.from;
            searchObj.data.queryResults.scan_size = isInitialRequest
              ? res.data.scan_size
              : (searchObj.data.queryResults.scan_size || 0) +
                res.data.scan_size;
            searchObj.data.queryResults.took = isInitialRequest
              ? res.data.took
              : (searchObj.data.queryResults.took || 0) + res.data.took;
            searchObj.data.queryResults.hits = res.data.hits;
            await processPostPaginationData();
            await fetchAllParitions(queryReq);
          } else if (isAggregation) {
            searchObj.data.queryResults.from = res.data.from;
            searchObj.data.queryResults.total = isInitialRequest
              ? res.data.total
              : (searchObj.data.queryResults.total || 0) + res.data.total;
            searchObj.data.queryResults.scan_size = isInitialRequest
              ? res.data.scan_size
              : (searchObj.data.queryResults.scan_size || 0) +
                res.data.scan_size;
            searchObj.data.queryResults.took = isInitialRequest
              ? res.data.took
              : (searchObj.data.queryResults.took || 0) + res.data.took;
            Object.hasOwn(searchObj.data.queryResults, "hits")
              ? searchObj.data.queryResults.hits.push(...res.data.hits)
              : (searchObj.data.queryResults["hits"] = res.data.hits);
            await processPostPaginationData();
            await fetchAllParitions(queryReq);
          } else if (
            res.data.from > 0 ||
            searchObj.data.queryResults.subpage > 1
          ) {
            if (appendResult && !queryReq.query?.streaming_output) {
              searchObj.data.queryResults.from += res.data.from;
              searchObj.data.queryResults.scan_size += res.data.scan_size;
              searchObj.data.queryResults.took += res.data.took;
              await chunkedAppend(
                searchObj.data.queryResults.hits,
                res.data.hits,
              );
            } else {
              // Replace result
              if (queryReq.query?.streaming_output) {
                searchObj.data.queryResults.total =
                  searchObj.data.queryResults.hits.length;
                searchObj.data.queryResults.from = res.data.from;
                searchObj.data.queryResults.scan_size += res.data.scan_size;
                searchObj.data.queryResults.took += res.data.took;
                searchObj.data.queryResults.hits = res.data.hits;
              } else {
                // Replace result
                searchObj.data.queryResults.from = res.data.from;
                searchObj.data.queryResults.scan_size = res.data.scan_size;
                searchObj.data.queryResults.took = res.data.took;
                searchObj.data.queryResults.hits = res.data.hits;
              }
            }
          } else {
            resetFieldValues();
            if (
              searchObj.meta.refreshInterval > 0 &&
              router.currentRoute.value.name == "logs" &&
              searchObj.data.queryResults.hasOwnProperty("hits") &&
              searchObj.data.queryResults.hits.length > 0
            ) {
              searchObj.data.queryResults.from = res.data.from;
              searchObj.data.queryResults.scan_size = res.data.scan_size;
              searchObj.data.queryResults.took = res.data.took;
              searchObj.data.queryResults.aggs = res.data.aggs;
              const lastRecordTimeStamp = parseInt(
                searchObj.data.queryResults.hits[0][
                  store.state.zoConfig.timestamp_column
                ],
              );
              searchObj.data.queryResults.hits = res.data.hits;
            } else {
              if (searchObj.meta.jobId != "") {
                searchObj.data.queryResults.total = res.data.total;
              }
              if (!queryReq.query.hasOwnProperty("track_total_hits")) {
                delete res.data.total;
              }
              searchObj.data.queryResults = {
                ...searchObj.data.queryResults,
                ...res.data,
              };
            }
          }

          // sort the hits based on timestamp column
          if (
            searchObj.data.queryResults.hits.length > 0 &&
            store.state.zoConfig.timestamp_column != "" &&
            res.data.hasOwnProperty("order_by_metadata") &&
            res.data.order_by_metadata.length > 0
          ) {
            sortResponse(
              searchObj.data.queryResults.hits,
              store.state.zoConfig.timestamp_column,
              res.data.order_by_metadata,
            );
          }

          //here also we are getting the is_histogram_eligible flag from the BE
          //so that we can use it whenever we might not send the partition call from here also it will get updated
          //this is coming as a part of data api call which is search call
          searchObj.data.queryResults.is_histogram_eligible =
            res.data.is_histogram_eligible;
          // check for pagination request for the partition and check for subpage if we have to pull data from multiple partitions
          // it will check for subpage and if subpage is present then it will send pagination request for next partition
          if (
            !(isAggregation && queryReq.query?.streaming_output) &&
            searchObj.meta.jobId == "" &&
            searchObj.data.queryResults.partitionDetail.paginations[
              searchObj.data.resultGrid.currentPage - 1
            ].length > searchObj.data.queryResults.subpage &&
            searchObj.data.queryResults.hits.length <
              searchObj.meta.resultGrid.rowsPerPage *
                searchObj.data.stream.selectedStream.length
          ) {
            queryReq.query.start_time =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][searchObj.data.queryResults.subpage].startTime;
            queryReq.query.end_time =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][searchObj.data.queryResults.subpage].endTime;
            queryReq.query.from =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][searchObj.data.queryResults.subpage].from;
            queryReq.query.size =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][searchObj.data.queryResults.subpage].size;

            searchObj.data.queryResults.subpage++;

            setTimeout(async () => {
              processPostPaginationData();

              // searchObj.data.functionError = "";
              // if (
              //   res.data.hasOwnProperty("function_error") &&
              //   res.data.function_error
              // ) {
              //   searchObj.data.functionError = res.data.function_error;
              // }
            }, 0);
            await getPaginatedData(queryReq, true, false);
          }
          if (searchObj.meta.jobId != "") {
            searchObj.meta.resultGrid.rowsPerPage = queryReq.query.size;
            searchObj.data.queryResults.pagination = [];
            refreshJobPagination(true);
          }

          await processPostPaginationData();

          // searchObj.data.functionError = "";
          // if (
          //   res.data.hasOwnProperty("function_error") &&
          //   res.data.function_error
          // ) {
          //   searchObj.data.functionError = res.data.function_error;
          // }

          searchObj.loading = false;
          searchObjDebug["paginatedDataReceivedEndTime"] = performance.now();

          resolve(true);
        })
        .catch((err) => {
          // TODO OK : create handleError function, which will handle error and return error message and detail

          searchObj.loading = false;

          // Reset cancel query on search error
          searchObj.data.isOperationCancelled = false;

          let trace_id = "";
          searchObj.data.errorMsg =
            typeof err == "string" && err
              ? err
              : "Error while processing histogram request.";
          if (err.response != undefined) {
            searchObj.data.errorMsg =
              err.response?.data?.error || err.response?.data?.message || "";
            if (err.response.data.hasOwnProperty("error_detail")) {
              searchObj.data.errorDetail =
                err.response?.data?.error_detail || "";
            }
            if (err.response.data.hasOwnProperty("trace_id")) {
              trace_id = err.response.data?.trace_id;
            }
          } else {
            searchObj.data.errorMsg = err?.message || "";
            if (err.hasOwnProperty("trace_id")) {
              trace_id = err?.trace_id;
            }
          }

          const customMessage = logsErrorMessage(
            err?.response?.data?.code || "",
          );
          searchObj.data.errorCode = err?.response?.data?.code || "";

          if (customMessage != "") {
            searchObj.data.errorMsg = t(customMessage);
          }

          notificationMsg.value = searchObj.data.errorMsg;

          if (err?.request?.status >= 429 || err?.request?.status == 400) {
            notificationMsg.value = err?.response?.data?.message || "";
            searchObj.data.errorMsg = err?.response?.data?.message || "";
            searchObj.data.errorDetail =
              err?.response?.data?.error_detail || "";
          }

          if (trace_id) {
            searchObj.data.errorMsg +=
              " <br><span class='text-subtitle1'>TraceID:" +
              trace_id +
              "</span>";
            notificationMsg.value += " TraceID:" + trace_id;
            trace_id = "";
          }

          reject(false);
        })
        .finally(() => {
          removeTraceId(traceId);
        });
    });
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

  const refreshPartitionPagination = (
    regenrateFlag: boolean = false,
    isStreamingOutput: boolean = false,
  ) => {
    if (searchObj.meta.jobId != "") {
      return;
    }
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;
      const partitionDetail = searchObj.data.queryResults.partitionDetail;
      let remainingRecords = rowsPerPage;
      let lastPartitionSize = 0;
      //we generally get the pagination upto 3 pages ahead of the current page
      if (
        partitionDetail.paginations.length <= currentPage + 3 ||
        regenrateFlag
      ) {
        partitionDetail.paginations = [];

        let pageNumber = 0;
        let partitionFrom = 0;
        let total = 0;
        let totalPages = 0;
        let recordSize = 0;
        let from = 0;
        let lastPage = 0;

        const parsedSQL: any = fnParsedSQL();

        if (
          (searchObj.data.queryResults.aggs !== undefined &&
            searchObj.data.resultGrid.currentPage == 1 &&
            searchObj.meta.showHistogram == true &&
            searchObj.data.stream.selectedStream.length <= 1 &&
            (!searchObj.meta.sqlMode ||
              (searchObj.meta.sqlMode &&
                !isLimitQuery(parsedSQL) &&
                !isDistinctQuery(parsedSQL) &&
                !isWithQuery(parsedSQL) &&
                searchObj.data.queryResults.is_histogram_eligible))) ||
          (searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true &&
            searchObj.data.stream.selectedStream.length <= 1 &&
            searchObj.meta.sqlMode == false &&
            searchObj.data.resultGrid.currentPage == 1)
        ) {
          if (
            searchObj.data.queryResults.hasOwnProperty("aggs") &&
            searchObj.data.queryResults.aggs != null
          ) {
          }
        } else {
          // if streaming output is enabled, then we need to update the total as the last partition total, as the last partition total is the total of all the records in case of streaming output
          if (isStreamingOutput) {
            if (
              partitionDetail.partitionTotal[
                partitionDetail.partitionTotal?.length - 1
              ] > -1
            )
              searchObj.data.queryResults.total =
                partitionDetail.partitionTotal[
                  partitionDetail.partitionTotal.length - 1
                ];
          } else {
            // if streaming output is disabled, then we need to update the total as the sum of all partition totals
            searchObj.data.queryResults.total =
              partitionDetail.partitionTotal.reduce(
                (accumulator: number, currentValue: number) =>
                  accumulator + Math.max(currentValue, 0),
                0,
              );
          }
        }
        // partitionDetail.partitions.forEach((item: any, index: number) => {
        for (const [index, item] of partitionDetail.partitions.entries()) {
          total = partitionDetail.partitionTotal[index];

          if (!partitionDetail.paginations[pageNumber]) {
            partitionDetail.paginations[pageNumber] = [];
          }

          totalPages = getPartitionTotalPages(total);

          if (totalPages > 0) {
            partitionFrom = 0;
            for (let i = 0; i < totalPages; i++) {
              remainingRecords = rowsPerPage;
              recordSize =
                i === totalPages - 1
                  ? total - partitionFrom || rowsPerPage
                  : rowsPerPage;
              from = partitionFrom;

              if (total < recordSize) {
                recordSize = total;
              }

              // if (i === 0 && partitionDetail.paginations.length > 0) {
              lastPartitionSize = 0;

              // if the pagination array is not empty, then we need to get the last page and add the size of the last page to the last partition size
              if (partitionDetail.paginations[pageNumber]?.length) {
                lastPage = partitionDetail.paginations.length - 1;

                // partitionDetail.paginations[lastPage].forEach((item: any) => {
                for (const item of partitionDetail.paginations[lastPage]) {
                  lastPartitionSize += item.size;
                }

                if (lastPartitionSize != rowsPerPage) {
                  recordSize = rowsPerPage - lastPartitionSize;
                }

                if (total == 0) {
                  recordSize = 0;
                }

                if (total !== -1 && total < recordSize) {
                  recordSize = total;
                }
              }

              if (!partitionDetail.paginations[pageNumber]) {
                partitionDetail.paginations[pageNumber] = [];
              }

              partitionDetail.paginations[pageNumber].push({
                startTime: item[0],
                endTime: item[1],
                from,
                size: Math.abs(Math.min(recordSize, rowsPerPage)),
              });

              partitionFrom += recordSize;

              if (
                recordSize == rowsPerPage ||
                lastPartitionSize + recordSize == rowsPerPage
              ) {
                pageNumber++;
              }

              if (
                partitionDetail.paginations.length >
                searchObj.data.resultGrid.currentPage + 10
              ) {
                return true;
              }
            }
          } else {
            lastPartitionSize = 0;
            recordSize = rowsPerPage;
            lastPage = partitionDetail.paginations.length - 1;

            // partitionDetail.paginations[lastPage].forEach((item: any) => {
            for (const item of partitionDetail.paginations[lastPage]) {
              lastPartitionSize += item.size;
            }

            if (lastPartitionSize != rowsPerPage) {
              recordSize = rowsPerPage - lastPartitionSize;
            }
            from = 0;

            if (total == 0) {
              recordSize = 0;
            }

            if (total !== -1 && total < recordSize) {
              recordSize = total;
            }

            partitionDetail.paginations[pageNumber].push({
              startTime: item[0],
              endTime: item[1],
              from,
              size: Math.abs(recordSize),
            });

            if (partitionDetail.paginations[pageNumber].size > 0) {
              pageNumber++;
              remainingRecords =
                rowsPerPage - partitionDetail.paginations[pageNumber].size;
            } else {
              remainingRecords = rowsPerPage;
            }
          }

          if (
            partitionDetail.paginations.length >
            searchObj.data.resultGrid.currentPage + 10
          ) {
            return true;
          }
        }

        searchObj.data.queryResults.partitionDetail = partitionDetail;
      }
    } catch (e: any) {
      console.log("Error while refreshing partition pagination", e);
      notificationMsg.value = "Error while refreshing partition pagination.";
      return false;
    }
  };

  /**
   * This function is used to get the total pages for the single partition
   * This method handles the case where previous partition is not fully loaded and we are loading the next partition
   * In this case, we need to add the size of the previous partition to the total size of the current partition for accurate total pages
   * @param total - The total number of records in the partition
   * @returns The total number of pages for the partition
   */
  const getPartitionTotalPages = (total: number) => {
    const lastPage =
      searchObj.data.queryResults.partitionDetail.paginations?.length - 1;

    let lastPartitionSize = 0;
    let partitionTotal = 0;
    for (const item of searchObj.data.queryResults.partitionDetail.paginations[
      lastPage
    ]) {
      lastPartitionSize += item.size;
    }

    if (lastPartitionSize < searchObj.meta.resultGrid.rowsPerPage) {
      partitionTotal = total + lastPartitionSize;
    }

    return Math.ceil(partitionTotal / searchObj.meta.resultGrid.rowsPerPage);
  };

  function sortResponse(
    responseObj: RecordObject[],
    tsColumn: string,
    orderBy: OrderByArray,
  ): void {
    if (!Array.isArray(orderBy) || orderBy.length === 0) return;

    responseObj.sort((a: RecordObject, b: RecordObject) => {
      for (const entry of orderBy) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [field, order] = entry;
        let cmp = 0;

        if (field === tsColumn) {
          const aTs = getTsValue(tsColumn, a);
          const bTs = getTsValue(tsColumn, b);
          cmp = aTs - bTs;
        } else {
          const aVal = a[field] ?? null;
          const bVal = b[field] ?? null;

          if (typeof aVal === "string" && typeof bVal === "string") {
            cmp = aVal.localeCompare(bVal);
          } else if (typeof aVal === "number" && typeof bVal === "number") {
            cmp = aVal - bVal;
          } else if (typeof aVal === "string" && typeof bVal === "number") {
            cmp = -1;
          } else if (typeof aVal === "number" && typeof bVal === "string") {
            cmp = 1;
          } else {
            cmp = 0;
          }
        }

        const finalCmp = order === "desc" ? -cmp : cmp;
        if (finalCmp !== 0) return finalCmp;
      }
      return 0;
    });
  }

  const fetchAllParitions = async (queryReq: any) => {
    return new Promise(async (resolve) => {
      if (
        searchObj.data.queryResults.partitionDetail.partitions[
          searchObj.data.queryResults.subpage
        ]?.length
      ) {
        queryReq.query.start_time =
          searchObj.data.queryResults.partitionDetail.partitions[
            searchObj.data.queryResults.subpage
          ][0];
        queryReq.query.end_time =
          searchObj.data.queryResults.partitionDetail.partitions[
            searchObj.data.queryResults.subpage
          ][1];
        queryReq.query.from = 0;
        queryReq.query.size = -1;
        searchObj.data.queryResults.subpage++;
        await getPaginatedData(queryReq, true, false);
        resolve(true);
      }
      resolve(true);
    });
  };

  const refreshJobPagination = (regenrateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;

      if (searchObj.meta.jobId != "") {
        // searchObj.meta.resultGrid.rowsPerPage = 100;
      }

      let totalPages = 0;

      searchObj.data.queryResults.pagination = [];

      totalPages = Math.ceil(searchObj.data.queryResults.total / rowsPerPage);

      for (let i = 0; i < totalPages; i++) {
        if (i + 1 > currentPage + 10) {
          break;
        }
        searchObj.data.queryResults.pagination.push({
          from: i * rowsPerPage + 1,
          size: rowsPerPage,
        });
      }
      // console.log("searchObj.data.queryResults.pagination", searchObj.data.queryResults.pagination);
    } catch (e: any) {
      console.log("Error while refreshing pagination", e);
      notificationMsg.value = "Error while refreshing pagination.";
      return false;
    }
  };

  // Convert timestamp to microseconds
  interface RecordWithTimestamp {
    [key: string]: any;
  }
  function getTsValue(tsColumn: string, record: RecordWithTimestamp): number {
    const ts = record[tsColumn];

    if (ts === undefined || ts === null) return 0;

    if (typeof ts === "string") {
      const timestamp = Date.parse(ts);
      return timestamp * 1000;
    }

    if (typeof ts === "number") return ts;

    return 0;
  }

  return {
    getPaginatedData,
    refreshPartitionPagination,
    refreshJobPagination,
  };
};

export default usePagination;
