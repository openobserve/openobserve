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

import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import { searchState } from "@/composables/useLogs/searchState";
import useStreams from "@/composables/useStreams";
import savedviewsService from "@/services/saved_views";
import searchService from "@/services/search";

import { arraysMatch } from "@/utils/zincutils";

import { logsUtils } from "@/composables/useLogs/logsUtils";

import useActions from "@/composables/useActions";
import useFunctions from "@/composables/useFunctions";
import useNotifications from "@/composables/useNotifications";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useSearchStream from "@/composables/useLogs/useSearchStream";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import config from "@/aws-exports";

export const useSearchBar = () => {
  const { getStream, isStreamExists, isStreamFetched } = useStreams();


  let { searchObj, searchObjDebug, notificationMsg } = searchState();

  const store = useStore();
  const router = useRouter();
  const $q = useQuasar();

  const { fnParsedSQL, extractTimestamps } = logsUtils();

  const { getDataThroughStream } = useSearchStream();

  const { getAllFunctions } = useFunctions();
  const { getAllActions } = useActions();
  const { showErrorNotification } = useNotifications();

  const { cancelSearchQueryBasedOnRequestId } = useSearchWebSocket();

  const { extractFields } = useStreamFields();

  const getFunctions = async () => {
    try {
      if (store.state.organizationData.functions.length == 0) {
        await getAllFunctions();
      }

      store.state.organizationData.functions.map((data: any) => {
        const args: any = [];
        for (let i = 0; i < parseInt(data.num_args); i++) {
          args.push("'${1:value}'");
        }

        const itemObj: {
          name: any;
          args: string;
        } = {
          name: data.name,
          args: "(" + args.join(",") + ")",
        };
        searchObj.data.transforms.push({
          name: data.name,
          function: data.function,
        });
        if (!data.stream_name) {
          searchObj.data.stream.functions.push(itemObj);
        }
      });
      return;
    } catch (e) {
      showErrorNotification("Error while fetching functions");
    }
  };

  const getActions = async () => {
    try {
      searchObj.data.actions = [];

      if (store.state.organizationData.actions.length == 0) {
        await getAllActions();
      }

      store.state.organizationData.actions.forEach((data: any) => {
        if (data.execution_details_type === "service") {
          searchObj.data.actions.push({
            name: data.name,
            id: data.id,
          });
        }
      });
      return;
    } catch (e) {
      showErrorNotification("Error while fetching actions");
    }
  };

  const getSavedViews = async () => {
    try {
      searchObj.loadingSavedView = true;
      const favoriteViews: any = [];
      savedviewsService
        .get(store.state.selectedOrganization.identifier)
        .then((res) => {
          searchObj.loadingSavedView = false;
          searchObj.data.savedViews = res.data.views;
        })
        .catch((err) => {
          searchObj.loadingSavedView = false;
          console.log(err);
        });
    } catch (e: any) {
      searchObj.loadingSavedView = false;
      console.log("Error while getting saved views", e);
    }
  };

  const getRegionInfo = () => {
    searchService.get_regions().then((res) => {
      const clusterData = [];
      let regionObj: any = {};
      const apiData = res.data;
      for (const region in apiData) {
        regionObj = {
          label: region,
          children: [],
        };
        for (const cluster of apiData[region]) {
          regionObj.children.push({ label: cluster });
        }
        clusterData.push(regionObj);
      }

      store.dispatch("setRegionInfo", clusterData);
    });
  };

  const setSelectedStreams = (value: string) => {
    try {
      const parsedSQL = fnParsedSQL();

      if (
        !Object.hasOwn(parsedSQL, "from") ||
        parsedSQL?.from == null ||
        parsedSQL?.from?.length == 0
      ) {
        console.info("Failed to parse SQL query:", value);
        return;
        // throw new Error("Invalid SQL syntax");
      }

      const newSelectedStreams: string[] = [];

      // handled WITH query
      if (parsedSQL?.with) {
        let withObj = parsedSQL.with;
        withObj.forEach((obj: any) => {
          // Recursively extract table names from the WITH statement with depth protection
          const MAX_RECURSION_DEPTH = 50; // Prevent stack overflow
          const visitedNodes = new WeakSet(); // Prevent circular references - more efficient for objects

          const extractTablesFromNode = (node: any, depth: number = 0) => {
            if (!node || depth > MAX_RECURSION_DEPTH) {
              if (depth > MAX_RECURSION_DEPTH) {
                console.warn(
                  "Maximum recursion depth reached while parsing SQL query",
                );
              }
              return;
            }

            // Use WeakSet for efficient circular reference detection
            if (typeof node === "object" && node !== null) {
              if (visitedNodes.has(node)) {
                return; // Skip already visited nodes
              }
              visitedNodes.add(node);
            }

            // Check if current node has a from clause
            if (node.from && Array.isArray(node.from)) {
              node.from.forEach((stream: any) => {
                if (stream.table) {
                  newSelectedStreams.push(stream.table);
                }
                // Handle subquery in FROM clause
                if (stream.expr && stream.expr.ast) {
                  extractTablesFromNode(stream.expr.ast, depth + 1);
                }
              });
            }

            // Check for nested subqueries in WHERE clause
            if (node.where && node.where.right && node.where.right.ast) {
              extractTablesFromNode(node.where.right.ast, depth + 1);
            }

            // Check for nested subqueries in SELECT expressions
            if (node.columns && Array.isArray(node.columns)) {
              node.columns.forEach((col: any) => {
                if (col.expr && col.expr.ast) {
                  extractTablesFromNode(col.expr.ast, depth + 1);
                }
              });
            }
          };

          // Start extraction from the WITH statement
          extractTablesFromNode(obj?.stmt);
        });
      }
      // additionally, if union is there then it will have _next object which will have the table name it should check recursuvely as user can write multiple union
      else if (parsedSQL?._next) {
        //get the first table if it is next
        //this is to handle the union queries when user selects the multi stream selection the first table will be there in from array
        newSelectedStreams.push(
          ...parsedSQL.from.map((stream: any) => {
            return stream.table;
          }),
        );
        let nextTable = parsedSQL._next;
        //this will handle the union queries
        while (nextTable) {
          // Map through each "from" array in the _next object, as it can contain multiple tables
          if (nextTable.from) {
            nextTable.from.forEach((stream: { table: string }) =>
              newSelectedStreams.push(stream.table),
            );
          }
          nextTable = nextTable._next;
        }
      }
      //for simple query get the table name from the parsedSQL object
      // this will handle joins as well
      else if (parsedSQL?.from) {
        parsedSQL.from.map((stream: any) => {
          // Check if 'expr' and 'ast' exist, then access 'from' to get the table
          if (stream.expr?.ast?.from) {
            stream.expr.ast.from.forEach((subStream: any) => {
              if (subStream.table != undefined) {
                newSelectedStreams.push(subStream.table);
              }
            });
          }
          // Otherwise, return the table name directly
          if (stream.table != undefined) {
            newSelectedStreams.push(stream.table);
          }
        });
      }

      if (
        !arraysMatch(
          searchObj.data.stream.selectedStream,
          newSelectedStreams,
        ) &&
        isStreamFetched(searchObj.data.stream.streamType) &&
        isStreamExists(
          newSelectedStreams[newSelectedStreams.length - 1],
          searchObj.data.stream.streamType,
        )
      ) {
        searchObj.data.stream.selectedStream = newSelectedStreams;
        onStreamChange(value);
      }
    } catch (error) {
      console.error("Error in setSelectedStreams:", {
        error,
        query: value,
        currentStreams: searchObj.data.stream.selectedStream,
      });
      throw error;
    }
  };

  const onStreamChange = async (queryStr: string) => {
    try {
      searchObj.loadingStream = true;

      await cancelQuery();

      // Reset query results
      searchObj.data.queryResults = { hits: [] };

      // Build UNION query once
      const streams = searchObj.data.stream.selectedStream;
      const unionquery = streams
        .map((stream: string) => `SELECT [FIELD_LIST] FROM "${stream}"`)
        .join(" UNION ALL BY NAME ");

      const query = searchObj.meta.sqlMode ? queryStr || unionquery : "";

      // Fetch all stream data in parallel
      const streamDataPromises = streams.map((stream: string) =>
        getStream(stream, searchObj.data.stream.streamType || "logs", true),
      );

      const streamDataResults = await Promise.all(streamDataPromises);

      // TODO : We can optimize filter + flatMap using a single reducer function
      // Collect all schema fields
      const allStreamFields = streamDataResults
        .filter((data) => data?.schema)
        .flatMap((data) => data.schema);

      // Update selectedStreamFields once
      searchObj.data.stream.selectedStreamFields = allStreamFields;
      //check if allStreamFields is empty or not
      //if empty then we are displaying no events found... message on the UI instead of throwing in an error format
      if (!allStreamFields.length) {
        // searchObj.data.errorMsg = t("search.noFieldFound");
        return;
      }

      // Update selected fields if needed
      const streamFieldNames = new Set(
        allStreamFields.map((item) => item.name),
      );
      if (searchObj.data.stream.selectedFields.length > 0) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter((fieldName: string) =>
            streamFieldNames.has(fieldName),
          );
      }

      // Update interesting fields list
      searchObj.data.stream.interestingFieldList =
        searchObj.data.stream.interestingFieldList.filter((fieldName: string) =>
          streamFieldNames.has(fieldName),
        );

      // Replace field list in query
      const fieldList =
        searchObj.meta.quickMode &&
        searchObj.data.stream.interestingFieldList.length > 0
          ? searchObj.data.stream.interestingFieldList.join(",")
          : "*";

      const finalQuery = query.replace(/\[FIELD_LIST\]/g, fieldList);

      // Update query related states
      searchObj.data.editorValue = finalQuery;
      searchObj.data.query = finalQuery;
      searchObj.data.tempFunctionContent = "";
      searchObj.meta.searchApplied = false;

      // Update histogram visibility
      if (streams.length > 1 && searchObj.meta.sqlMode == true) {
        searchObj.meta.showHistogram = false;
      }

      if (!store.state.zoConfig.query_on_stream_selection) {
        await handleQueryData();
      } else {
        // Reset states when query on selection is disabled
        searchObj.data.sortedQueryResults = [];
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
        extractFields();
      }
    } catch (e: any) {
      console.info("Error while getting stream data:", e);
    } finally {
      searchObj.loadingStream = false;
    }
  };

  const handleQueryData = async () => {
    try {
      searchObj.data.tempFunctionLoading = false;
      searchObj.data.tempFunctionName = "";
      searchObj.data.tempFunctionContent = "";
      searchObj.loading = true;
      await getQueryData();
    } catch (e: any) {
      console.log("Error while loading logs data");
    }
  };

  const getQueryData = async (isPagination = false) => {
    try {
      //remove any data that has been cached
      if (Object.keys(searchObj.data.originalDataCache).length > 0) {
        searchObj.data.originalDataCache = {};
      }
      // Reset cancel query on new search request initation
      searchObj.data.isOperationCancelled = false;

      // window will have more priority
      // if window has use_web_socket property then use that
      // else use organization settings
      searchObj.meta.jobId = "";

      // setCommunicationMethod();

      // searchObj.data.histogram.chartParams.title = "";
      searchObjDebug["queryDataStartTime"] = performance.now();
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

      // if (
      //   isNaN(searchObj.data.datetime.endTime) ||
      //   isNaN(searchObj.data.datetime.startTime)
      // ) {
      //   setDateTime(
      //     (router.currentRoute.value?.query?.period as string) || "15m",
      //   );
      // }

      // Use the appropriate method to fetch data
      getDataThroughStream(isPagination);

      // searchObjDebug["buildSearchStartTime"] = performance.now();
      // const queryReq: any = buildSearch();
      // searchObjDebug["buildSearchEndTime"] = performance.now();
      // if (queryReq == false) {
      //   throw new Error(notificationMsg.value || "Something went wrong.");
      // }
      // // reset query data and get partition detail for given query.
      // if (!isPagination) {
      //   resetQueryData();
      //   searchObjDebug["partitionStartTime"] = performance.now();
      //   await getQueryPartitions(queryReq);
      //   searchObjDebug["partitionEndTime"] = performance.now();
      // }

      //reset the plot chart when the query is run
      //this is to avoid the issue of chart not updating when histogram is disabled and enabled and clicking the run query button
      //only reset the plot chart when the query is not run for pagination
      // if(!isPagination && searchObj.meta.refreshInterval == 0) searchObj.meta.resetPlotChart = true;

      // if (queryReq != null) {
      //   // in case of live refresh, reset from to 0
      //   if (
      //     searchObj.meta.refreshInterval > 0 &&
      //     router.currentRoute.value.name == "logs"
      //   ) {
      //     queryReq.query.from = 0;
      //     searchObj.meta.refreshHistogram = true;
      //   }

      //   // update query with function or action
      //   addTransformToQuery(queryReq);

      //   // in case of relative time, set start_time and end_time to query
      //   // it will be used in pagination request
      //   if (searchObj.data.datetime.type === "relative") {
      //     if (!isPagination) initialQueryPayload.value = cloneDeep(queryReq);
      //     else {
      //       if (
      //         searchObj.meta.refreshInterval == 0 &&
      //         router.currentRoute.value.name == "logs" &&
      //         searchObj.data.queryResults.hasOwnProperty("hits")
      //       ) {
      //         const start_time: number =
      //           initialQueryPayload.value?.query?.start_time || 0;
      //         const end_time: number =
      //           initialQueryPayload.value?.query?.end_time || 0;
      //         queryReq.query.start_time = start_time;
      //         queryReq.query.end_time = end_time;
      //       }
      //     }
      //   }

      //   // reset errorCode
      //   searchObj.data.errorCode = 0;

      //   // copy query request for histogram query and same for customDownload
      //   searchObj.data.histogramQuery = JSON.parse(JSON.stringify(queryReq));

      //   //here we need to send the actual sql query for histogram
      //   searchObj.data.histogramQuery.query.sql = queryReq.query.sql;

      //   // searchObj.data.histogramQuery.query.start_time =
      //   //   queryReq.query.start_time;

      //   // searchObj.data.histogramQuery.query.end_time =
      //   //   queryReq.query.end_time;

      //   delete searchObj.data.histogramQuery.query.quick_mode;
      //   delete searchObj.data.histogramQuery.query.from;
      //   if (searchObj.data.histogramQuery.query.action_id)
      //     delete searchObj.data.histogramQuery.query.action_id;

      //   delete searchObj.data.histogramQuery.aggs;
      //   searchObj.data.customDownloadQueryObj = JSON.parse(
      //     JSON.stringify(queryReq),
      //   );

      //   // get the current page detail and set it into query request
      //   queryReq.query.start_time =
      //     searchObj.data.queryResults.partitionDetail.paginations[
      //       searchObj.data.resultGrid.currentPage - 1
      //     ][0].startTime;
      //   queryReq.query.end_time =
      //     searchObj.data.queryResults.partitionDetail.paginations[
      //       searchObj.data.resultGrid.currentPage - 1
      //     ][0].endTime;
      //   queryReq.query.from =
      //     searchObj.data.queryResults.partitionDetail.paginations[
      //       searchObj.data.resultGrid.currentPage - 1
      //     ][0].from;
      //   queryReq.query.size =
      //     searchObj.data.queryResults.partitionDetail.paginations[
      //       searchObj.data.resultGrid.currentPage - 1
      //     ][0].size;
      //   queryReq.query.streaming_output =
      //     searchObj.data.queryResults.partitionDetail.paginations[
      //       searchObj.data.resultGrid.currentPage - 1
      //     ][0].streaming_output;
      //   queryReq.query.streaming_id =
      //     searchObj.data.queryResults.partitionDetail.paginations[
      //       searchObj.data.resultGrid.currentPage - 1
      //     ][0].streaming_id;

      //   // for custom download we need to set the streaming_output and streaming_id
      //   searchObj.data.customDownloadQueryObj.query.streaming_output =
      //     queryReq.query.streaming_output;
      //   searchObj.data.customDownloadQueryObj.query.streaming_id =
      //     queryReq.query.streaming_id;
      //   // setting subpage for pagination to handle below scenario
      //   // for one particular page, if we have to fetch data from multiple partitions in that case we need to set subpage
      //   // in below example we have 2 partitions and we need to fetch data from both partitions for page 2 to match recordsPerPage
      //   /*
      //        [
      //           {
      //               "startTime": 1704869331795000,
      //               "endTime": 1705474131795000,
      //               "from": 500,
      //               "size": 34
      //           },
      //           {
      //               "startTime": 1705474131795000,
      //               "endTime": 1706078931795000,
      //               "from": 0,
      //               "size": 216
      //           }
      //         ],
      //         [
      //           {
      //               "startTime": 1706078931795000,
      //               "endTime": 1706683731795000,
      //               "from": 0,
      //               "size": 250
      //           }
      //         ]
      //       */
      //   searchObj.data.queryResults.subpage = 1;

      //   // based on pagination request, get the data
      //   searchObjDebug["paginatedDatawithAPIStartTime"] = performance.now();
      //   await getPaginatedData(queryReq);
      //   if (
      //     !isPagination &&
      //     searchObj.meta.refreshInterval == 0 &&
      //     searchObj.data.queryResults.hits.length > 0
      //   )
      //     searchObj.meta.resetPlotChart = true;
      //   searchObjDebug["paginatedDatawithAPIEndTime"] = performance.now();
      //   const parsedSQL: any = fnParsedSQL();

      //   if (
      //     (searchObj.data.queryResults.aggs == undefined &&
      //       searchObj.meta.refreshHistogram == true &&
      //       searchObj.loadingHistogram == false &&
      //       searchObj.meta.showHistogram == true &&
      //       (!searchObj.meta.sqlMode ||
      //         isNonAggregatedSQLMode(searchObj, parsedSQL))) ||
      //     (searchObj.loadingHistogram == false &&
      //       searchObj.meta.showHistogram == true &&
      //       searchObj.meta.sqlMode == false &&
      //       searchObj.meta.refreshHistogram == true)
      //   ) {
      //     searchObj.meta.refreshHistogram = false;
      //     if (searchObj.data.queryResults.hits.length > 0) {
      //       if (
      //         searchObj.data.stream.selectedStream.length > 1 &&
      //         searchObj.meta.sqlMode == true
      //       ) {
      //         searchObj.data.histogram = {
      //           xData: [],
      //           yData: [],
      //           chartParams: {
      //             title: getHistogramTitle(),
      //             unparsed_x_data: [],
      //             timezone: "",
      //           },
      //           errorCode: 0,
      //           errorMsg:
      //             "Histogram is not available for multi-stream SQL mode search.",
      //           errorDetail: "",
      //         };

      //         // get page count for multi stream sql mode search
      //         setTimeout(async () => {
      //           getPageCount(queryReq);
      //         }, 0);
      //         searchObj.meta.histogramDirtyFlag = false;
      //       } else {
      //         if (
      //           searchObj.data.stream.selectedStream.length > 1 &&
      //           searchObj.meta.sqlMode == false
      //         ) {
      //           searchObj.data.histogramQuery.query.sql =
      //             setMultiStreamHistogramQuery(
      //               searchObj.data.histogramQuery.query,
      //             );
      //         }
      //         searchObjDebug["histogramStartTime"] = performance.now();
      //         searchObj.data.histogram.errorMsg = "";
      //         searchObj.data.histogram.errorCode = 0;
      //         searchObj.data.histogram.errorDetail = "";
      //         searchObj.loadingHistogram = true;

      //         const parsedSQL: any = fnParsedSQL();
      //         searchObj.data.queryResults.aggs = [];

      //         const partitions = JSON.parse(
      //           JSON.stringify(
      //             searchObj.data.queryResults.partitionDetail.partitions,
      //           ),
      //         );

      //         // is _timestamp orderby ASC then reverse the partition array
      //         if (isTimestampASC(parsedSQL?.orderby) && partitions.length > 1) {
      //           partitions.reverse();
      //         }

      //         await generateHistogramSkeleton();
      //         for (const partition of partitions) {
      //           searchObj.data.histogramQuery.query.start_time = partition[0];
      //           searchObj.data.histogramQuery.query.end_time = partition[1];
      //           //to improve the cancel query UI experience we add additional check here and further we need to remove it
      //           if (searchObj.data.isOperationCancelled) {
      //             searchObj.loadingHistogram = false;
      //             searchObj.data.isOperationCancelled = false;

      //             if (!searchObj.data.histogram?.xData?.length) {
      //               notificationMsg.value = "Search query was cancelled";
      //               searchObj.data.histogram.errorMsg =
      //                 "Search query was cancelled";
      //               searchObj.data.histogram.errorDetail =
      //                 "Search query was cancelled";
      //             }

      //             showCancelSearchNotification();
      //             break;
      //           }
      //           await getHistogramQueryData(searchObj.data.histogramQuery);
      //           if (partitions.length > 1) {
      //             setTimeout(async () => {
      //               await generateHistogramData();
      //               if (!queryReq.query?.streaming_output)
      //                 refreshPartitionPagination(true);
      //             }, 100);
      //           }
      //         }
      //         searchObj.loadingHistogram = false;
      //       }
      //     }
      //     if (
      //       searchObj.data.stream.selectedStream.length == 1 ||
      //       (searchObj.data.stream.selectedStream.length > 1 &&
      //         searchObj.meta.sqlMode == false)
      //     ) {
      //       await generateHistogramData();
      //     }
      //     if (!queryReq.query?.streaming_output)
      //       refreshPartitionPagination(true);
      //   } else if (searchObj.meta.sqlMode && isLimitQuery(parsedSQL)) {
      //     resetHistogramWithError(
      //       "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
      //       -1,
      //     );
      //     searchObj.meta.histogramDirtyFlag = false;
      //   } else if (
      //     searchObj.meta.sqlMode &&
      //     (isDistinctQuery(parsedSQL) ||
      //       isWithQuery(parsedSQL) ||
      //       !searchObj.data.queryResults.is_histogram_eligible)
      //   ) {
      //     let aggFlag = false;
      //     if (parsedSQL) {
      //       aggFlag = hasAggregation(parsedSQL?.columns);
      //     }
      //     if (
      //       queryReq.query.from == 0 &&
      //       searchObj.data.queryResults.hits.length > 0 &&
      //       !aggFlag
      //     ) {
      //       setTimeout(async () => {
      //         searchObjDebug["pagecountStartTime"] = performance.now();
      //         // TODO : check the page count request
      //         getPageCount(queryReq);
      //         searchObjDebug["pagecountEndTime"] = performance.now();
      //       }, 0);
      //     }
      //     if (
      //       isWithQuery(parsedSQL) ||
      //       !searchObj.data.queryResults.is_histogram_eligible
      //     ) {
      //       resetHistogramWithError(
      //         "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
      //         -1,
      //       );
      //     } else {
      //       resetHistogramWithError(
      //         "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries",
      //         -1,
      //       );
      //     }
      //     searchObj.meta.histogramDirtyFlag = false;
      //   } else {
      //     let aggFlag = false;
      //     if (parsedSQL) {
      //       aggFlag = hasAggregation(parsedSQL?.columns);
      //     }
      //     if (
      //       queryReq.query.from == 0 &&
      //       searchObj.data.queryResults.hits.length > 0 &&
      //       !aggFlag &&
      //       searchObj.data.queryResults.aggs == undefined
      //     ) {
      //       setTimeout(async () => {
      //         searchObjDebug["pagecountStartTime"] = performance.now();
      //         await getPageCount(queryReq);
      //         searchObjDebug["pagecountEndTime"] = performance.now();
      //       }, 0);
      //     } else {
      //       await generateHistogramData();
      //     }
      //   }
      // } else {
      //   searchObj.loading = false;
      //   if (!notificationMsg.value) {
      //     notificationMsg.value = "Search query is empty or invalid.";
      //   }
      // }
      // searchObjDebug["queryDataEndTime"] = performance.now();
    } catch (e: any) {
      // console.error(
      //   `${notificationMsg.value || "Error occurred during the search operation."}`,
      //   e,
      // );
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      notificationMsg.value = "";
    }
  };

  const cancelQuery = async (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      try {
        // only call cancel query api if it is enterprise 
        // otherwise resolve and return immediately
        if (config.isEnterprise !== "true") {
          resolve(true);
          return;
        }

        const tracesIds = [...searchObj.data.searchRequestTraceIds];

        if (!searchObj.data.searchRequestTraceIds.length) {
          searchObj.data.isOperationCancelled = false;
          resolve(true);
          return;
        }

        searchObj.data.isOperationCancelled = true;

        searchService
          .delete_running_queries(
            store.state.selectedOrganization.identifier,
            searchObj.data.searchRequestTraceIds,
          )
          .then((res) => {
            const isCancelled = res.data.some((item: any) => item.is_success);
            if (isCancelled) {
              searchObj.data.isOperationCancelled = false;
              $q.notify({
                message: "Running query cancelled successfully",
                color: "positive",
                position: "bottom",
                timeout: 4000,
              });
            }
          })
          .catch((error: any) => {
            $q.notify({
              message:
                error.response?.data?.message ||
                "Failed to cancel running query",
              color: "negative",
              position: "bottom",
              timeout: 1500,
            });
          })
          .finally(() => {
            searchObj.data.searchRequestTraceIds =
              searchObj.data.searchRequestTraceIds.filter(
                (id: string) => !tracesIds.includes(id),
              );
            resolve(true);
          });
      } catch (error) {
        $q.notify({
          message: "Failed to cancel running query",
          color: "negative",
          position: "bottom",
          timeout: 1500,
        });
        resolve(true);
      }
    });
  };

  const sendCancelSearchMessage = (searchRequests: any[]) => {
    try {
      if (!searchRequests.length) {
        searchObj.data.isOperationCancelled = false;
        return;
      }

      searchObj.data.isOperationCancelled = true;

      // loop on all requestIds
      searchRequests.forEach((traceId) => {
        cancelSearchQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: store?.state?.selectedOrganization?.identifier,
        });
      });
    } catch (error: any) {
      console.error("Failed to cancel WebSocket searches:", error);
      showErrorNotification("Failed to cancel search operations");
    }
  };

  // const setCommunicationMethod = () => {
  // const shouldUseStreaming = isStreamingEnabled(store.state);

  // const isMultiStreamSearch =
  //   searchObj.data.stream.selectedStream.length > 1 &&
  //   !searchObj.meta.sqlMode;

  // if (shouldUseStreaming && !isMultiStreamSearch) {
  // searchObj.communicationMethod = "streaming";
  // } else {
  //   searchObj.communicationMethod = "http";
  // }
  // };

  // const getPageCount = async (queryReq: any) => {
  //   return new Promise((resolve, reject) => {
  //     try {
  //       const isStreamingOutput = !!queryReq.query.streaming_output;
  //       searchObj.loadingCounter = true;
  //       searchObj.data.countErrorMsg = "";
  //       queryReq.query.size = 0;
  //       delete queryReq.query.from;
  //       delete queryReq.query.quick_mode;
  //       if (queryReq.query.action_id) delete queryReq.query.action_id;
  //       if (queryReq.query.hasOwnProperty("streaming_output"))
  //         delete queryReq.query.streaming_output;
  //       if (queryReq.query.hasOwnProperty("streaming_id"))
  //         delete queryReq.query.streaming_id;

  //       queryReq.query.track_total_hits = true;

  //       const { traceparent, traceId } = generateTraceContext();
  //       addTraceId(traceId);

  //       searchService
  //         .search(
  //           {
  //             org_identifier: searchObj.organizationIdentifier,
  //             query: queryReq,
  //             page_type: searchObj.data.stream.streamType,
  //             traceparent,
  //           },
  //           "ui",
  //         )
  //         .then(async (res) => {
  //           // check for total records update for the partition and update pagination accordingly
  //           // searchObj.data.queryResults.partitionDetail.partitions.forEach(
  //           //   (item: any, index: number) => {
  //           searchObj.data.queryResults.scan_size += res.data.scan_size;
  //           searchObj.data.queryResults.took += res.data.took;

  //           // Update total for the last partition
  //           if (searchObj.meta.jobId == "") {
  //             for (const [
  //               index,
  //               item,
  //             ] of searchObj.data.queryResults.partitionDetail.partitions.entries()) {
  //               if (
  //                 (searchObj.data.queryResults.partitionDetail.partitionTotal[
  //                   index
  //                 ] == -1 ||
  //                   searchObj.data.queryResults.partitionDetail.partitionTotal[
  //                     index
  //                   ] < res.data.total) &&
  //                 queryReq.query.start_time == item[0]
  //               ) {
  //                 searchObj.data.queryResults.partitionDetail.partitionTotal[
  //                   index
  //                 ] = res.data.total;
  //               }
  //             }
  //           }

  //           if (isStreamingOutput) {
  //             searchObj.data.queryResults.total = res.data.total;
  //           }

  //           let regeratePaginationFlag = false;
  //           if (res.data.hits.length != searchObj.meta.resultGrid.rowsPerPage) {
  //             regeratePaginationFlag = true;
  //           }
  //           // if total records in partition is greater than recordsPerPage then we need to update pagination
  //           // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
  //           refreshPartitionPagination(
  //             regeratePaginationFlag,
  //             isStreamingOutput,
  //           );

  //           searchObj.data.histogram.chartParams.title = getHistogramTitle();
  //           searchObj.loadingCounter = false;
  //           resolve(true);
  //         })
  //         .catch((err) => {
  //           searchObj.loading = false;
  //           searchObj.loadingCounter = false;

  //           // Reset cancel query on search error
  //           searchObj.data.isOperationCancelled = false;

  //           let trace_id = "";
  //           searchObj.data.countErrorMsg =
  //             "Error while retrieving total events: ";
  //           if (err.response != undefined) {
  //             if (err.response.data.hasOwnProperty("trace_id")) {
  //               trace_id = err.response.data?.trace_id;
  //             }
  //           } else {
  //             if (err.hasOwnProperty("trace_id")) {
  //               trace_id = err?.trace_id;
  //             }
  //           }

  //           const customMessage = logsErrorMessage(err?.response?.data.code);
  //           searchObj.data.errorCode = err?.response?.data.code;

  //           notificationMsg.value = searchObj.data.countErrorMsg;

  //           if (err?.request?.status >= 429 || err?.request?.status == 400) {
  //             notificationMsg.value = err?.response?.data?.message;
  //             searchObj.data.countErrorMsg += err?.response?.data?.message;
  //           }

  //           if (trace_id) {
  //             searchObj.data.countErrorMsg += " TraceID:" + trace_id;
  //             notificationMsg.value += " TraceID:" + trace_id;
  //             trace_id = "";
  //           }
  //           reject(false);
  //         })
  //         .finally(() => {
  //           removeTraceId(traceId);
  //         });
  //     } catch (e) {
  //       searchObj.loadingCounter = false;
  //       reject(false);
  //     }
  //   });
  // };

  // const getQueryPartitions = async (queryReq: any) => {
  //   try {
  //     // const queryReq = buildSearch();
  //     searchObj.data.queryResults.hits = [];
  //     searchObj.data.histogram = {
  //       xData: [],
  //       yData: [],
  //       chartParams: {
  //         title: "",
  //         unparsed_x_data: [],
  //         timezone: "",
  //       },
  //       errorCode: 0,
  //       errorMsg: "",
  //       errorDetail: "",
  //     };

  //     const parsedSQL: any = fnParsedSQL();

  //     // if (searchObj.meta.sqlMode && parsedSQL == undefined) {
  //     //   searchObj.data.queryResults.error =
  //     //     "Error while search partition. Search query is invalid.";
  //     //   return;
  //     // }

  //     // In Limit we don't need to get partitions, as we directly hit search request with query limit
  //     if (
  //       !searchObj.meta.sqlMode ||
  //       (searchObj.meta.sqlMode && !isLimitQuery(parsedSQL))
  //     ) {
  //       const partitionQueryReq: any = {
  //         sql: queryReq.query.sql,
  //         start_time: queryReq.query.start_time,
  //         end_time: queryReq.query.end_time,
  //       };
  //       //if the sql_base64_enabled is true, then we will encode the query
  //       if (store.state.zoConfig.sql_base64_enabled) {
  //         partitionQueryReq["encoding"] = "base64";
  //       }

  //       if (
  //         config.isEnterprise == "true" &&
  //         store.state.zoConfig.super_cluster_enabled
  //       ) {
  //         if (queryReq.query.hasOwnProperty("regions")) {
  //           partitionQueryReq["regions"] = queryReq.query.regions;
  //         }

  //         if (queryReq.query.hasOwnProperty("clusters")) {
  //           partitionQueryReq["clusters"] = queryReq.query.clusters;
  //         }
  //       }

  //       const { traceparent, traceId } = generateTraceContext();

  //       addTraceId(traceId);

  //       partitionQueryReq["streaming_output"] = true;

  //       searchObj.data.queryResults.histogram_interval = null;

  //       // for visualization, will require to set histogram interval to fill missing values
  //       searchObj.data.queryResults.visualization_histogram_interval = null;

  //       await searchService
  //         .partition({
  //           org_identifier: searchObj.organizationIdentifier,
  //           query: partitionQueryReq,
  //           page_type: searchObj.data.stream.streamType,
  //           traceparent,
  //           enable_align_histogram: true,
  //         })
  //         .then(async (res: any) => {
  //           searchObj.data.queryResults.partitionDetail = {
  //             partitions: [],
  //             partitionTotal: [],
  //             paginations: [],
  //           };
  //           //we get is_histogram_eligible flag to check from the BE so that if it is false then we dont need to make histogram call
  //           searchObj.data.queryResults.is_histogram_eligible =
  //             res.data?.is_histogram_eligible;
  //           searchObj.data.queryResults.histogram_interval =
  //             res.data.histogram_interval;

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

  //           if (typeof partitionQueryReq.sql != "string") {
  //             const partitionSize = 0;
  //             let partitions = [];
  //             let pageObject = [];
  //             // Object.values(res).forEach((partItem: any) => {
  //             const partItem = res.data;
  //             searchObj.data.queryResults.total += partItem.records;

  //             if (partItem.partitions.length > partitionSize) {
  //               partitions = partItem.partitions;

  //               searchObj.data.queryResults.partitionDetail.partitions =
  //                 partitions;

  //               for (const [index, item] of partitions.entries()) {
  //                 pageObject = [
  //                   {
  //                     startTime: item[0],
  //                     endTime: item[1],
  //                     from: 0,
  //                     size: searchObj.meta.resultGrid.rowsPerPage,
  //                     streaming_output: res.data?.streaming_aggs || false,
  //                     streaming_id: res.data?.streaming_id || null,
  //                   },
  //                 ];
  //                 searchObj.data.queryResults.partitionDetail.paginations.push(
  //                   pageObject,
  //                 );
  //                 searchObj.data.queryResults.partitionDetail.partitionTotal.push(
  //                   -1,
  //                 );
  //               }
  //             }
  //             // });
  //           }
  //           //this condition will satisfy only in the case of single stream because
  //           //we will send the query in string format in case of single stream
  //           //eg: select * from stream1
  //           else {
  //             //we need to reset the total as 0 because we are getting the total from the response
  //             //the previous total would not be valid
  //             searchObj.data.queryResults.total = 0;
  //             // delete searchObj.data.histogram.chartParams.title;

  //             // generateHistogramData();
  //             const partitions = res.data.partitions;
  //             let pageObject = [];
  //             //we use res.data.partitions in the paritionDetail.partitions array
  //             // so here this would become as per the response we are getting 2 partitions
  //             // [
  //             //   [1749627783934000, 1749627843934000],
  //             //   [1749625143934000, 1749627783934000]
  //             // ]
  //             searchObj.data.queryResults.partitionDetail.partitions =
  //               partitions;
  //             //now we will iterate over the partitions and create the pageObject
  //             //the pageObject would look like this
  //             // [
  //             //   {
  //             //     startTime: 1749627783934000,
  //             //     endTime: 1749627843934000,
  //             //     from: 0,
  //             //     size: 50, this depends on the rows per page that we have
  //             //     streaming_output: false,
  //             //     streaming_id: null
  //             //   }
  //             // ]
  //             for (const [index, item] of partitions.entries()) {
  //               pageObject = [
  //                 {
  //                   startTime: item[0],
  //                   endTime: item[1],
  //                   from: 0,
  //                   size: searchObj.meta.resultGrid.rowsPerPage,
  //                   streaming_output: res.data?.streaming_aggs || false,
  //                   streaming_id: res.data?.streaming_id || null,
  //                 },
  //               ];
  //               searchObj.data.queryResults.partitionDetail.paginations.push(
  //                 pageObject,
  //               );
  //               //and we will push the partitionTotal as -1 because we are not getting the total from the response
  //               //so we inititate with -1 for all the paginations
  //               //it will be [ -1, -1 ] for 2 partitions
  //               searchObj.data.queryResults.partitionDetail.partitionTotal.push(
  //                 -1,
  //               );
  //             }
  //           }
  //         })
  //         .catch((err: any) => {
  //           searchObj.loading = false;

  //           // Reset cancel query on search error
  //           searchObj.data.isOperationCancelled = false;

  //           let trace_id = "";
  //           searchObj.data.errorMsg =
  //             "Error while processing partition request.";
  //           if (err.response != undefined) {
  //             searchObj.data.errorMsg =
  //               err.response?.data?.error || err.response?.data?.message || "";
  //             if (err.response.data.hasOwnProperty("error_detail")) {
  //               searchObj.data.errorDetail = err.response.data.error_detail;
  //             }
  //             if (err.response.data.hasOwnProperty("trace_id")) {
  //               trace_id = err.response.data?.trace_id;
  //             }
  //           } else {
  //             searchObj.data.errorMsg = err.message;
  //             if (err.hasOwnProperty("trace_id")) {
  //               trace_id = err?.trace_id;
  //             }
  //           }

  //           notificationMsg.value = searchObj.data.errorMsg;

  //           if (err?.request?.status >= 429 || err?.request?.status == 400) {
  //             notificationMsg.value = err?.response?.data?.message;
  //             searchObj.data.errorMsg = err?.response?.data?.message || "";
  //             searchObj.data.errorDetail = err?.response?.data?.error_detail;
  //           }

  //           if (trace_id) {
  //             searchObj.data.errorMsg +=
  //               " <br><span class='text-subtitle1'>TraceID:" +
  //               trace_id +
  //               "</span>";
  //             notificationMsg.value += " TraceID:" + trace_id;
  //             trace_id = "";
  //           }
  //         })
  //         .finally(() => {
  //           removeTraceId(traceId);
  //         });
  //       // }
  //     } else {
  //       searchObj.data.queryResults.partitionDetail = {
  //         partitions: [],
  //         partitionTotal: [],
  //         paginations: [],
  //       };

  //       searchObj.data.queryResults.partitionDetail.partitions = [
  //         [queryReq.query.start_time, queryReq.query.end_time],
  //       ];

  //       let pageObject: any = [];
  //       for (const [
  //         index,
  //         item,
  //       ] of searchObj.data.queryResults.partitionDetail.partitions.entries()) {
  //         pageObject = [
  //           {
  //             startTime: item[0],
  //             endTime: item[1],
  //             from: 0,
  //             size: searchObj.meta.resultGrid.rowsPerPage,
  //           },
  //         ];
  //         searchObj.data.queryResults.partitionDetail.paginations.push(
  //           pageObject,
  //         );
  //         searchObj.data.queryResults.partitionDetail.partitionTotal.push(-1);
  //       }
  //     }
  //   } catch (e: any) {
  //     console.log("error", e);
  //     notificationMsg.value = "Error while getting search partitions.";
  //     searchObj.data.queryResults.error = e.message;
  //     throw e;
  //   }
  // };

  const setDateTime = (period: string = "15m") => {
    const extractedDate: any = extractTimestamps(period);
    searchObj.data.datetime.startTime = extractedDate.from;
    searchObj.data.datetime.endTime = extractedDate.to;
  };

  return {
    getFunctions,
    getActions,
    getSavedViews,
    getRegionInfo,
    setSelectedStreams,
    onStreamChange,
    getQueryData,
    sendCancelSearchMessage,
    cancelQuery,
    handleQueryData,
    setDateTime,
  };
};

export default useSearchBar;
