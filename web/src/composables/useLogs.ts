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

import { date, useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import {
  reactive,
  ref,
  type Ref,
  toRaw,
  nextTick,
  onBeforeMount,
  watch,
  computed,
  onBeforeUnmount,
} from "vue";
import { useStore } from "vuex";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { cloneDeep, startCase } from "lodash-es";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";

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
  convertDateToTimestamp,
  getConsumableRelativeTime,
} from "@/utils/date";
import { byString } from "@/utils/json";
import { logsErrorMessage } from "@/utils/common";
import useSqlSuggestions from "@/composables/useSuggestions";

import useNotifications from "@/composables/useNotifications";
import useStreams from "@/composables/useStreams";
import useWebSocket from "@/composables/useWebSocket";

import searchService from "@/services/search";
import savedviewsService from "@/services/saved_views";
import config from "@/aws-exports";
import useSearchWebSocket from "./useSearchWebSocket";

import { searchState } from "@/composables/useLogs/searchState";
import { searchStream } from "@/composables/useLogs/searchStream";
import { INTERVAL_MAP, DEFAULT_LOGS_CONFIG } from "@/utils/logs/constants";
import {logsUtils} from "@/composables/useLogs/logsUtils";

import useStreamFields from "@/composables/useLogs/useStreamFields";
import {
  useHistogram
} from "@/composables/useLogs/useHistogram";
import useSearchBar from "@/composables/useLogs/useSearchBar";

// TODO OK:
// useStreamManagement for stream-related functions
// useQueryProcessing for query-related functions
// useDataVisualization for histogram and data display functions

// let histogramResults: any = [];
// let histogramMappedData: any = [];

const {
  fetchQueryDataWithWebSocket,
  sendSearchMessageBasedOnRequestId,
  cancelSearchQueryBasedOnRequestId,
  closeSocketBasedOnRequestId,
} = useSearchWebSocket();

// const searchPartitionMap = reactive<{ [key: string]: number }>({});

let {
  searchObj,
  searchObjDebug,
  searchAggData,
  initialQueryPayload,
  streamSchemaFieldsIndexMapping,
  resetHistogramError,
  resetQueryData,
  resetFunctions,
  resetStreamData,
  notificationMsg,
  histogramMappedData,
  histogramResults,
} = searchState();

const useLogs = () => {
  const store = useStore();
  const { t } = useI18n();
  const $q = useQuasar();

  const {getHistogramTitle,
  resetHistogramWithError,
  generateHistogramData,
  generateHistogramSkeleton,
  setMultiStreamHistogramQuery,
  isHistogramEnabled,} = useHistogram();

  const { getQueryReq,
getDataThroughStream,
buildWebSocketPayload,
initializeSearchConnection,
sendSearchMessage,
handleStreamingHits,
handleStreamingMetadata,
updatePageCountTotal,
trimPageCountExtraHit,
handleHistogramStreamingHits,
handleHistogramStreamingMetadata,
handlePageCountStreamingHits,
handlePageCountStreamingMetadata,
handleSearchResponse,
handleFunctionError,
handleAggregation,
updateResult,
handleLogsResponse,
chunkedAppend,
handlePageCountResponse,
handleHistogramResponse,
shouldShowHistogram,
processHistogramRequest,
isHistogramDataMissing,
handleSearchClose,
handleSearchError,
constructErrorMessage,
getAggsTotal,
refreshPagination,
shouldGetPageCount,
getPageCountThroughSocket,
setCancelSearchError,
handleSearchReset} = searchStream();

const {getFunctions, getActions} = useSearchBar();

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
  showCancelSearchNotification,
  updateUrlQueryParams,
  isNonAggregatedSQLMode,
  generateURLQuery,} = logsUtils();

  const {
    updateFieldValues,
    extractFields,
    updateGridColumns,
    filterHitsColumns,
    getStreamList,
    extractFTSFields,
    loadStreamLists,
    resetFieldValues,
  } = useStreamFields();

  let parser: null | Parser = new Parser();

  const { showErrorNotification } = useNotifications();
  const {
    getStreams,
    getStream,
    getMultiStreams,
    isStreamExists,
    isStreamFetched,
  } = useStreams();

  const router = useRouter();
  const fieldValues = ref();

  const { updateFieldKeywords } = useSqlSuggestions();

  onBeforeMount(async () => {
    if (router.currentRoute.value.query?.quick_mode == "true") {
      searchObj.meta.quickMode = true;
    }
    extractValueQuery();
  });

  onBeforeUnmount(() => {
    parser = null;
  });

  const clearSearchObj = () => {
    searchObj = reactive(
      Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_LOGS_CONFIG))),
    );
  };

  const updatedLocalLogFilterField = (): void => {
    const identifier: string = searchObj.organizationIdentifier || "default";
    const selectedFields: any =
      useLocalLogFilterField()?.value != null
        ? useLocalLogFilterField()?.value
        : {};
    const stream = searchObj.data.stream.selectedStream.sort().join("_");
    selectedFields[`${identifier}_${stream}`] =
      searchObj.data.stream.selectedFields;
    useLocalLogFilterField(selectedFields);
  };

  // const getFunctions = async () => {
  //   try {
  //     if (store.state.organizationData.functions.length == 0) {
  //       await getAllFunctions();
  //     }

  //     store.state.organizationData.functions.map((data: any) => {
  //       const args: any = [];
  //       for (let i = 0; i < parseInt(data.num_args); i++) {
  //         args.push("'${1:value}'");
  //       }

  //       const itemObj: {
  //         name: any;
  //         args: string;
  //       } = {
  //         name: data.name,
  //         args: "(" + args.join(",") + ")",
  //       };
  //       searchObj.data.transforms.push({
  //         name: data.name,
  //         function: data.function,
  //       });
  //       if (!data.stream_name) {
  //         searchObj.data.stream.functions.push(itemObj);
  //       }
  //     });
  //     return;
  //   } catch (e) {
  //     showErrorNotification("Error while fetching functions");
  //   }
  // };

  // const getActions = async () => {
  //   try {
  //     searchObj.data.actions = [];

  //     if (store.state.organizationData.actions.length == 0) {
  //       await getAllActions();
  //     }

  //     store.state.organizationData.actions.forEach((data: any) => {
  //       if (data.execution_details_type === "service") {
  //         searchObj.data.actions.push({
  //           name: data.name,
  //           id: data.id,
  //         });
  //       }
  //     });
  //     return;
  //   } catch (e) {
  //     showErrorNotification("Error while fetching actions");
  //   }
  // };

  function extractFilterColumns(expression: any) {
    const columns: any[] = [];

    function traverse(node: {
      type: string;
      column: any;
      left: any;
      right: any;
      args: { type: string; value: any[] };
    }) {
      if (node.type === "column_ref") {
        columns.push(node.column);
      } else if (node.type === "binary_expr") {
        traverse(node.left);
        traverse(node.right);
      } else if (node.type === "function") {
        // Function expressions might contain columns as arguments
        if (node.args && node.args.type === "expr_list") {
          node.args.value.forEach((arg: any) => traverse(arg));
        }
      }
    }

    traverse(expression);
    return columns;
  }

  const validateFilterForMultiStream = () => {
    const filterCondition = searchObj.data.query;
    const parsedSQL: any = fnParsedSQL(
      "select * from stream where " + filterCondition,
    );
    searchObj.data.stream.filteredField = extractFilterColumns(
      parsedSQL?.where,
    );

    searchObj.data.filterErrMsg = "";
    searchObj.data.missingStreamMessage = "";
    searchObj.data.stream.missingStreamMultiStreamFilter = [];
    for (const fieldObj of searchObj.data.stream.filteredField) {
      const fieldName = fieldObj.expr.value;
      const filteredFields: any =
        searchObj.data.stream.selectedStreamFields.filter(
          (field: any) => field.name === fieldName,
        );
      if (filteredFields.length > 0) {
        const streamsCount = filteredFields[0].streams.length;
        const allStreamsEqual = filteredFields.every(
          (field: any) => field.streams.length === streamsCount,
        );
        if (!allStreamsEqual) {
          searchObj.data.filterErrMsg += `Field '${fieldName}' exists in different number of streams.\n`;
        }
      } else {
        searchObj.data.filterErrMsg += `Field '${fieldName}' does not exist in the one or more stream.\n`;
      }

      const fieldStreams: any = searchObj.data.stream.selectedStreamFields
        .filter((field: any) => field.name === fieldName)
        .map((field: any) => field.streams)
        .flat();

      searchObj.data.stream.missingStreamMultiStreamFilter =
        searchObj.data.stream.selectedStream.filter(
          (stream: any) => !fieldStreams.includes(stream),
        );

      if (searchObj.data.stream.missingStreamMultiStreamFilter.length > 0) {
        searchObj.data.missingStreamMessage = `One or more filter fields do not exist in "${searchObj.data.stream.missingStreamMultiStreamFilter.join(
          ", ",
        )}", hence no search is performed in the mentioned stream.\n`;
      }
    }

    return searchObj.data.filterErrMsg === "" ? true : false;
  };

  function buildSearch() {
    try {
      let query = searchObj.data.query.trim();
      searchObj.data.filterErrMsg = "";
      searchObj.data.missingStreamMessage = "";
      searchObj.data.stream.missingStreamMultiStreamFilter = [];
      const req: any = {
        query: {
          sql: searchObj.meta.sqlMode
            ? query
            : 'select [FIELD_LIST][QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
          from:
            searchObj.meta.resultGrid.rowsPerPage *
              (searchObj.data.resultGrid.currentPage - 1) || 0,
          size: searchObj.meta.resultGrid.rowsPerPage,
          quick_mode: searchObj.meta.quickMode,
        },
      };

      if (
        config.isEnterprise == "true" &&
        store.state.zoConfig.super_cluster_enabled
      ) {
        req["regions"] = searchObj.meta.regions;
        req["clusters"] = searchObj.meta.clusters;
      }

      const streamFieldNames: any =
        searchObj.data.stream.selectedStreamFields.map(
          (item: any) => item.name,
        );

      for (
        let i = searchObj.data.stream.interestingFieldList.length - 1;
        i >= 0;
        i--
      ) {
        const fieldName = searchObj.data.stream.interestingFieldList[i];
        if (!streamFieldNames.includes(fieldName)) {
          searchObj.data.stream.interestingFieldList.splice(i, 1);
        }
      }

      if (
        searchObj.data.stream.interestingFieldList.length > 0 &&
        searchObj.meta.quickMode
      ) {
        if (searchObj.data.stream.selectedStream.length == 1) {
          req.query.sql = req.query.sql.replace(
            "[FIELD_LIST]",
            searchObj.data.stream.interestingFieldList.join(","),
          );
        }
      } else {
        req.query.sql = req.query.sql.replace("[FIELD_LIST]", "*");
      }

      const timestamps: any =
        searchObj.data.datetime.type === "relative"
          ? getConsumableRelativeTime(
              searchObj.data.datetime.relativeTimePeriod,
            )
          : cloneDeep(searchObj.data.datetime);

      if (searchObj.data.datetime.type === "relative") {
        searchObj.data.datetime.startTime = timestamps.startTime;
        searchObj.data.datetime.endTime = timestamps.endTime;
      }

      if (
        timestamps.startTime != "Invalid Date" &&
        timestamps.endTime != "Invalid Date"
      ) {
        if (timestamps.startTime > timestamps.endTime) {
          notificationMsg.value = "Start time cannot be greater than end time";
          // showErrorNotification("Start time cannot be greater than end time");
          return false;
        }
        searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";

        req.query.start_time = timestamps.startTime;
        req.query.end_time = timestamps.endTime;

        searchObj.meta.resultGrid.chartInterval = "10 second";
        if (req.query.end_time - req.query.start_time >= 1000000 * 60 * 30) {
          searchObj.meta.resultGrid.chartInterval = "15 second";
          searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
        }
        if (req.query.end_time - req.query.start_time >= 1000000 * 60 * 60) {
          searchObj.meta.resultGrid.chartInterval = "30 second";
          searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
        }
        if (req.query.end_time - req.query.start_time >= 1000000 * 3600 * 2) {
          searchObj.meta.resultGrid.chartInterval = "1 minute";
          searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
        }
        if (req.query.end_time - req.query.start_time >= 1000000 * 3600 * 6) {
          searchObj.meta.resultGrid.chartInterval = "5 minute";
          searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
        }
        if (req.query.end_time - req.query.start_time >= 1000000 * 3600 * 24) {
          searchObj.meta.resultGrid.chartInterval = "30 minute";
          searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
        }
        if (req.query.end_time - req.query.start_time >= 1000000 * 86400 * 7) {
          searchObj.meta.resultGrid.chartInterval = "1 hour";
          searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
        }
        if (req.query.end_time - req.query.start_time >= 1000000 * 86400 * 30) {
          searchObj.meta.resultGrid.chartInterval = "1 day";
          searchObj.meta.resultGrid.chartKeyFormat = "YYYY-MM-DD";
        }
      } else {
        notificationMsg.value = "Invalid date format";
        return false;
      }

      if (searchObj.meta.sqlMode == true) {
        searchObj.data.query = query;
        const parsedSQL: any = fnParsedSQL();
        if (parsedSQL != undefined) {
          //check if query is valid or not , if the query is invalid --> empty query

          if (Array.isArray(parsedSQL) && parsedSQL.length == 0) {
            notificationMsg.value =
              "SQL query is missing or invalid. Please submit a valid SQL statement.";
            return false;
          }

          if (!parsedSQL?.columns?.length && !searchObj.meta.sqlMode) {
            notificationMsg.value = "No column found in selected stream.";
            return false;
          }

          if (parsedSQL.limit != null && parsedSQL.limit.value.length != 0) {
            req.query.size = parsedSQL.limit.value[0].value;

            if (parsedSQL.limit.separator == "offset") {
              req.query.from = parsedSQL.limit.value[1].value || 0;
            }

            query = fnUnparsedSQL(parsedSQL);

            //replace backticks with \" for sql_mode
            query = query.replace(/`/g, '"');
            searchObj.data.queryResults.hits = [];
          }
        }

        req.query.sql = query
          .split("\n")
          .filter((line: string) => !line.trim().startsWith("--"))
          .join("\n");
        req.query["sql_mode"] = "full";
        // delete req.aggs;
      } else {
        const parseQuery = [query];
        let queryFunctions = "";
        let whereClause = "";
        if (parseQuery.length > 1) {
          queryFunctions = "," + parseQuery[0].trim();
          whereClause = parseQuery[1].trim();
        } else {
          whereClause = parseQuery[0].trim();
        }

        whereClause = whereClause
          .split("\n")
          .filter((line: string) => !line.trim().startsWith("--"))
          .join("\n");
        if (whereClause.trim() != "") {
          // Use efficient state-based approach to avoid regex backtracking
          whereClause = addSpacesToOperators(whereClause);

          //remove everything after -- in where clause
          const parsedSQL = whereClause.split(" ");
          // searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
          //   parsedSQL.forEach((node: any, index: any) => {
          //     if (node == field.name) {
          //       node = node.replaceAll('"', "");
          //       parsedSQL[index] = '"' + node + '"';
          //     }
          //   });
          // });
          let field: any;
          let node: any;
          let index: any;
          for (field of searchObj.data.stream.selectedStreamFields) {
            for ([node, index] of parsedSQL) {
              if (node === field.name) {
                parsedSQL[index] = '"' + node.replaceAll('"', "") + '"';
              }
            }
          }

          whereClause = parsedSQL.join(" ");

          // req.query.sql = req.query.sql.replace(
          //   "[WHERE_CLAUSE]",
          //   " WHERE " + whereClause,
          // );
          req.query.sql = req.query.sql
            .split("[WHERE_CLAUSE]")
            .join(" WHERE " + whereClause);
        } else {
          req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", "");
        }

        req.query.sql = req.query.sql.replace(
          "[QUERY_FUNCTIONS]",
          queryFunctions.trim(),
        );

        // in the case of multi stream, we need to pass query for each selected stream in the form of array
        // additional checks added for filter condition,
        // 1. all fields in filter condition should be present in same streams.
        // if one or more fields belongs to different stream then error will be shown
        // 2. if multiple streams are selected but filter condition contains fields from only one stream
        // then we need to send the search request for only matched stream
        if (searchObj.data.stream.selectedStream.length > 1) {
          let streams: any = searchObj.data.stream.selectedStream;
          if (whereClause.trim() != "") {
            const validationFlag = validateFilterForMultiStream();
            if (!validationFlag) {
              return false;
            }

            if (
              searchObj.data.stream.missingStreamMultiStreamFilter.length > 0
            ) {
              streams = searchObj.data.stream.selectedStream.filter(
                (streams: any) =>
                  !searchObj.data.stream.missingStreamMultiStreamFilter.includes(
                    streams,
                  ),
              );
            }
          }

          const preSQLQuery = req.query.sql;
          req.query.sql = [];

          streams
            .join(",")
            .split(",")
            .forEach((item: any) => {
              let finalQuery: string = preSQLQuery.replace(
                "[INDEX_NAME]",
                item,
              );

              // const finalHistogramQuery: string = preHistogramSQLQuery.replace(
              //   "[INDEX_NAME]",
              //   item
              // );

              const listOfFields: any = [];
              let streamField: any = {};
              for (const field of searchObj.data.stream.interestingFieldList) {
                for (streamField of searchObj.data.stream
                  .selectedStreamFields) {
                  if (
                    streamField?.name == field &&
                    streamField?.streams.indexOf(item) > -1 &&
                    listOfFields.indexOf(field) == -1
                  ) {
                    listOfFields.push(field);
                  }
                }
              }

              let queryFieldList: string = "";
              if (listOfFields.length > 0) {
                queryFieldList = "," + listOfFields.join(",");
              }

              finalQuery = finalQuery.replace(
                "[FIELD_LIST]",
                `'${item}' as _stream_name` + queryFieldList,
              );

              // finalHistogramQuery = finalHistogramQuery.replace(
              //   "[FIELD_LIST]",
              //   `'${item}' as _stream_name,` + listOfFields.join(",")
              // );

              req.query.sql.push(finalQuery);
              // req.aggs.histogram.push(finalHistogramQuery);
            });
        } else {
          req.query.sql = req.query.sql.replace(
            "[INDEX_NAME]",
            searchObj.data.stream.selectedStream[0],
          );
        }
      }

      if (
        searchObj.data.resultGrid.currentPage > 1 ||
        searchObj.meta.showHistogram === false
      ) {
        // delete req.aggs;

        if (searchObj.meta.showHistogram === false) {
          // delete searchObj.data.histogram;
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
          searchObj.meta.histogramDirtyFlag = true;
        } else {
          searchObj.meta.histogramDirtyFlag = false;
        }
      }

      if (store.state.zoConfig.sql_base64_enabled) {
        req["encoding"] = "base64";
        req.query.sql = b64EncodeUnicode(req.query.sql);
      }

      // updateUrlQueryParams();

      return req;
    } catch (e: any) {
      notificationMsg.value =
        "An error occurred while constructing the search query.";
      return "";
    }
  }

  const getQueryPartitions = async (queryReq: any) => {
    try {
      // const queryReq = buildSearch();
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

      const parsedSQL: any = fnParsedSQL();

      // if (searchObj.meta.sqlMode && parsedSQL == undefined) {
      //   searchObj.data.queryResults.error =
      //     "Error while search partition. Search query is invalid.";
      //   return;
      // }

      // In Limit we don't need to get partitions, as we directly hit search request with query limit
      if (
        !searchObj.meta.sqlMode ||
        (searchObj.meta.sqlMode && !isLimitQuery(parsedSQL))
      ) {
        const partitionQueryReq: any = {
          sql: queryReq.query.sql,
          start_time: queryReq.query.start_time,
          end_time: queryReq.query.end_time,
        };
        //if the sql_base64_enabled is true, then we will encode the query
        if (store.state.zoConfig.sql_base64_enabled) {
          partitionQueryReq["encoding"] = "base64";
        }

        if (
          config.isEnterprise == "true" &&
          store.state.zoConfig.super_cluster_enabled
        ) {
          if (queryReq.query.hasOwnProperty("regions")) {
            partitionQueryReq["regions"] = queryReq.query.regions;
          }

          if (queryReq.query.hasOwnProperty("clusters")) {
            partitionQueryReq["clusters"] = queryReq.query.clusters;
          }
        }

        const { traceparent, traceId } = generateTraceContext();

        addTraceId(traceId);

        partitionQueryReq["streaming_output"] = true;

        searchObj.data.queryResults.histogram_interval = null;

        // for visualization, will require to set histogram interval to fill missing values
        searchObj.data.queryResults.visualization_histogram_interval = null;

        await searchService
          .partition({
            org_identifier: searchObj.organizationIdentifier,
            query: partitionQueryReq,
            page_type: searchObj.data.stream.streamType,
            traceparent,
            enable_align_histogram: true,
          })
          .then(async (res: any) => {
            
            searchObj.data.queryResults.partitionDetail = {
              partitions: [],
              partitionTotal: [],
              paginations: [],
            };
            //we get is_histogram_eligible flag to check from the BE so that if it is false then we dont need to make histogram call
            searchObj.data.queryResults.is_histogram_eligible =
              res.data?.is_histogram_eligible;
            searchObj.data.queryResults.histogram_interval =
              res.data.histogram_interval;

            // check if histogram interval is undefined, then set current response as histogram response
            // for visualization, will require to set histogram interval to fill missing values
            // Using same histogram interval attribute creates pagination issue(showing 1 to 50 out of .... was not shown on page change)
            // created new attribute visualization_histogram_interval to avoid this issue
            if (
              !searchObj.data.queryResults.visualization_histogram_interval &&
              res.data?.histogram_interval
            ) {
              searchObj.data.queryResults.visualization_histogram_interval =
                res.data?.histogram_interval;
            }

            if (typeof partitionQueryReq.sql != "string") {
              const partitionSize = 0;
              let partitions = [];
              let pageObject = [];
              // Object.values(res).forEach((partItem: any) => {
              const partItem = res.data;
              searchObj.data.queryResults.total += partItem.records;

              if (partItem.partitions.length > partitionSize) {
                partitions = partItem.partitions;

                searchObj.data.queryResults.partitionDetail.partitions =
                  partitions;

                for (const [index, item] of partitions.entries()) {
                  pageObject = [
                    {
                      startTime: item[0],
                      endTime: item[1],
                      from: 0,
                      size: searchObj.meta.resultGrid.rowsPerPage,
                      streaming_output: res.data?.streaming_aggs || false,
                      streaming_id: res.data?.streaming_id || null,
                    },
                  ];
                  searchObj.data.queryResults.partitionDetail.paginations.push(
                    pageObject,
                  );
                  searchObj.data.queryResults.partitionDetail.partitionTotal.push(
                    -1,
                  );
                }
              }
              // });
            }
            //this condition will satisfy only in the case of single stream because
            //we will send the query in string format in case of single stream
            //eg: select * from stream1
            else {
              //we need to reset the total as 0 because we are getting the total from the response
              //the previous total would not be valid
              searchObj.data.queryResults.total = 0;
              // delete searchObj.data.histogram.chartParams.title;

              // generateHistogramData();
              const partitions = res.data.partitions;
              let pageObject = [];
              //we use res.data.partitions in the paritionDetail.partitions array
              // so here this would become as per the response we are getting 2 partitions
              // [
              //   [1749627783934000, 1749627843934000],
              //   [1749625143934000, 1749627783934000]
              // ]
              searchObj.data.queryResults.partitionDetail.partitions =
                partitions;
              //now we will iterate over the partitions and create the pageObject
              //the pageObject would look like this
              // [
              //   {
              //     startTime: 1749627783934000,
              //     endTime: 1749627843934000,
              //     from: 0,
              //     size: 50, this depends on the rows per page that we have
              //     streaming_output: false,
              //     streaming_id: null
              //   }
              // ]
              for (const [index, item] of partitions.entries()) {
                pageObject = [
                  {
                    startTime: item[0],
                    endTime: item[1],
                    from: 0,
                    size: searchObj.meta.resultGrid.rowsPerPage,
                    streaming_output: res.data?.streaming_aggs || false,
                    streaming_id: res.data?.streaming_id || null,
                  },
                ];
                searchObj.data.queryResults.partitionDetail.paginations.push(
                  pageObject,
                );
                //and we will push the partitionTotal as -1 because we are not getting the total from the response
                //so we inititate with -1 for all the paginations
                //it will be [ -1, -1 ] for 2 partitions
                searchObj.data.queryResults.partitionDetail.partitionTotal.push(
                  -1,
                );
              }
            }
          })
          .catch((err: any) => {
            searchObj.loading = false;

            // Reset cancel query on search error
            searchObj.data.isOperationCancelled = false;

            let trace_id = "";
            searchObj.data.errorMsg =
              "Error while processing partition request.";
            if (err.response != undefined) {
              searchObj.data.errorMsg =
                err.response?.data?.error || err.response?.data?.message || "";
              if (err.response.data.hasOwnProperty("error_detail")) {
                searchObj.data.errorDetail = err.response.data.error_detail;
              }
              if (err.response.data.hasOwnProperty("trace_id")) {
                trace_id = err.response.data?.trace_id;
              }
            } else {
              searchObj.data.errorMsg = err.message;
              if (err.hasOwnProperty("trace_id")) {
                trace_id = err?.trace_id;
              }
            }

            notificationMsg.value = searchObj.data.errorMsg;

            if (err?.request?.status >= 429 || err?.request?.status == 400) {
              notificationMsg.value = err?.response?.data?.message;
              searchObj.data.errorMsg = err?.response?.data?.message || "";
              searchObj.data.errorDetail = err?.response?.data?.error_detail;
            }

            if (trace_id) {
              searchObj.data.errorMsg +=
                " <br><span class='text-subtitle1'>TraceID:" +
                trace_id +
                "</span>";
              notificationMsg.value += " TraceID:" + trace_id;
              trace_id = "";
            }
          })
          .finally(() => {
            removeTraceId(traceId);
          });
        // }
      } else {
        searchObj.data.queryResults.partitionDetail = {
          partitions: [],
          partitionTotal: [],
          paginations: [],
        };

        searchObj.data.queryResults.partitionDetail.partitions = [
          [queryReq.query.start_time, queryReq.query.end_time],
        ];

        let pageObject: any = [];
        for (const [
          index,
          item,
        ] of searchObj.data.queryResults.partitionDetail.partitions.entries()) {
          pageObject = [
            {
              startTime: item[0],
              endTime: item[1],
              from: 0,
              size: searchObj.meta.resultGrid.rowsPerPage,
            },
          ];
          searchObj.data.queryResults.partitionDetail.paginations.push(
            pageObject,
          );
          searchObj.data.queryResults.partitionDetail.partitionTotal.push(-1);
        }
      }
    } catch (e: any) {
      console.log("error", e);
      notificationMsg.value = "Error while getting search partitions.";
      searchObj.data.queryResults.error = e.message;
      throw e;
    }
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

  const setCommunicationMethod = () => {
    const shouldUseWebSocket = isWebSocketEnabled(store.state);
    const shouldUseStreaming = isStreamingEnabled(store.state);

    const isMultiStreamSearch =
      searchObj.data.stream.selectedStream.length > 1 &&
      !searchObj.meta.sqlMode;

    if (shouldUseStreaming && !isMultiStreamSearch) {
      searchObj.communicationMethod = "streaming";
    } else if (shouldUseWebSocket && !isMultiStreamSearch) {
      searchObj.communicationMethod = "ws";
    } else {
      searchObj.communicationMethod = "http";
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

      // get websocket enable config from store
      // window will have more priority
      // if window has use_web_socket property then use that
      // else use organization settings
      searchObj.meta.jobId = "";

      setCommunicationMethod();

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

      if (
        isNaN(searchObj.data.datetime.endTime) ||
        isNaN(searchObj.data.datetime.startTime)
      ) {
        setDateTime(
          (router.currentRoute.value?.query?.period as string) || "15m",
        );
      }

      // Use the appropriate method to fetch data
      if (
        searchObj.communicationMethod === "ws" ||
        searchObj.communicationMethod === "streaming"
      ) {
        getDataThroughStream(isPagination);
        return;
      }

      searchObjDebug["buildSearchStartTime"] = performance.now();
      const queryReq: any = buildSearch();
      searchObjDebug["buildSearchEndTime"] = performance.now();
      if (queryReq == false) {
        throw new Error(notificationMsg.value || "Something went wrong.");
      }
      // reset query data and get partition detail for given query.
      if (!isPagination) {
        resetQueryData();
        searchObjDebug["partitionStartTime"] = performance.now();
        await getQueryPartitions(queryReq);
        searchObjDebug["partitionEndTime"] = performance.now();
      }

      //reset the plot chart when the query is run
      //this is to avoid the issue of chart not updating when histogram is disabled and enabled and clicking the run query button
      //only reset the plot chart when the query is not run for pagination
      // if(!isPagination && searchObj.meta.refreshInterval == 0) searchObj.meta.resetPlotChart = true;

      if (queryReq != null) {
        // in case of live refresh, reset from to 0
        if (
          searchObj.meta.refreshInterval > 0 &&
          router.currentRoute.value.name == "logs"
        ) {
          queryReq.query.from = 0;
          searchObj.meta.refreshHistogram = true;
        }

        // update query with function or action
        addTransformToQuery(queryReq);

        // in case of relative time, set start_time and end_time to query
        // it will be used in pagination request
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

        // reset errorCode
        searchObj.data.errorCode = 0;

        // copy query request for histogram query and same for customDownload
        searchObj.data.histogramQuery = JSON.parse(JSON.stringify(queryReq));

        //here we need to send the actual sql query for histogram
        searchObj.data.histogramQuery.query.sql = queryReq.query.sql;

        // searchObj.data.histogramQuery.query.start_time =
        //   queryReq.query.start_time;

        // searchObj.data.histogramQuery.query.end_time =
        //   queryReq.query.end_time;

        delete searchObj.data.histogramQuery.query.quick_mode;
        delete searchObj.data.histogramQuery.query.from;
        if (searchObj.data.histogramQuery.query.action_id)
          delete searchObj.data.histogramQuery.query.action_id;

        delete searchObj.data.histogramQuery.aggs;
        searchObj.data.customDownloadQueryObj = JSON.parse(
          JSON.stringify(queryReq),
        );

        // get the current page detail and set it into query request
        queryReq.query.start_time =
          searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ][0].startTime;
        queryReq.query.end_time =
          searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ][0].endTime;
        queryReq.query.from =
          searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ][0].from;
        queryReq.query.size =
          searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ][0].size;
        queryReq.query.streaming_output =
          searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ][0].streaming_output;
        queryReq.query.streaming_id =
          searchObj.data.queryResults.partitionDetail.paginations[
            searchObj.data.resultGrid.currentPage - 1
          ][0].streaming_id;

        // for custom download we need to set the streaming_output and streaming_id
        searchObj.data.customDownloadQueryObj.query.streaming_output =
          queryReq.query.streaming_output;
        searchObj.data.customDownloadQueryObj.query.streaming_id =
          queryReq.query.streaming_id;
        // setting subpage for pagination to handle below scenario
        // for one particular page, if we have to fetch data from multiple partitions in that case we need to set subpage
        // in below example we have 2 partitions and we need to fetch data from both partitions for page 2 to match recordsPerPage
        /*
           [
              {
                  "startTime": 1704869331795000,
                  "endTime": 1705474131795000,
                  "from": 500,
                  "size": 34
              },
              {
                  "startTime": 1705474131795000,
                  "endTime": 1706078931795000,
                  "from": 0,
                  "size": 216
              }
            ],
            [
              {
                  "startTime": 1706078931795000,
                  "endTime": 1706683731795000,
                  "from": 0,
                  "size": 250
              }
            ]
          */
        searchObj.data.queryResults.subpage = 1;

        // based on pagination request, get the data
        searchObjDebug["paginatedDatawithAPIStartTime"] = performance.now();
        await getPaginatedData(queryReq);
        if (
          !isPagination &&
          searchObj.meta.refreshInterval == 0 &&
          searchObj.data.queryResults.hits.length > 0
        )
          searchObj.meta.resetPlotChart = true;
        searchObjDebug["paginatedDatawithAPIEndTime"] = performance.now();
        const parsedSQL: any = fnParsedSQL();

        if (
          (searchObj.data.queryResults.aggs == undefined &&
            searchObj.meta.refreshHistogram == true &&
            searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true &&
            (!searchObj.meta.sqlMode ||
              isNonAggregatedSQLMode(searchObj, parsedSQL))) ||
          (searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true &&
            searchObj.meta.sqlMode == false &&
            searchObj.meta.refreshHistogram == true)
        ) {
          searchObj.meta.refreshHistogram = false;
          if (searchObj.data.queryResults.hits.length > 0) {
            if (
              searchObj.data.stream.selectedStream.length > 1 &&
              searchObj.meta.sqlMode == true
            ) {
              searchObj.data.histogram = {
                xData: [],
                yData: [],
                chartParams: {
                  title: getHistogramTitle(),
                  unparsed_x_data: [],
                  timezone: "",
                },
                errorCode: 0,
                errorMsg:
                  "Histogram is not available for multi-stream SQL mode search.",
                errorDetail: "",
              };

              // get page count for multi stream sql mode search
              setTimeout(async () => {
                getPageCount(queryReq);
              }, 0);
              searchObj.meta.histogramDirtyFlag = false;
            } else {
              if (
                searchObj.data.stream.selectedStream.length > 1 &&
                searchObj.meta.sqlMode == false
              ) {
                searchObj.data.histogramQuery.query.sql =
                  setMultiStreamHistogramQuery(
                    searchObj.data.histogramQuery.query,
                  );
              }
              searchObjDebug["histogramStartTime"] = performance.now();
              searchObj.data.histogram.errorMsg = "";
              searchObj.data.histogram.errorCode = 0;
              searchObj.data.histogram.errorDetail = "";
              searchObj.loadingHistogram = true;

              const parsedSQL: any = fnParsedSQL();
              searchObj.data.queryResults.aggs = [];

              const partitions = JSON.parse(
                JSON.stringify(
                  searchObj.data.queryResults.partitionDetail.partitions,
                ),
              );

              // is _timestamp orderby ASC then reverse the partition array
              if (isTimestampASC(parsedSQL?.orderby) && partitions.length > 1) {
                partitions.reverse();
              }

              await generateHistogramSkeleton();
              for (const partition of partitions) {
                searchObj.data.histogramQuery.query.start_time = partition[0];
                searchObj.data.histogramQuery.query.end_time = partition[1];
                //to improve the cancel query UI experience we add additional check here and further we need to remove it
                if (searchObj.data.isOperationCancelled) {
                  searchObj.loadingHistogram = false;
                  searchObj.data.isOperationCancelled = false;

                  if (!searchObj.data.histogram?.xData?.length) {
                    notificationMsg.value = "Search query was cancelled";
                    searchObj.data.histogram.errorMsg =
                      "Search query was cancelled";
                    searchObj.data.histogram.errorDetail =
                      "Search query was cancelled";
                  }

                  showCancelSearchNotification();
                  break;
                }
                await getHistogramQueryData(searchObj.data.histogramQuery);
                if (partitions.length > 1) {
                  setTimeout(async () => {
                    await generateHistogramData();
                    if (!queryReq.query?.streaming_output)
                      refreshPartitionPagination(true);
                  }, 100);
                }
              }
              searchObj.loadingHistogram = false;
            }
          }
          if (
            searchObj.data.stream.selectedStream.length == 1 ||
            (searchObj.data.stream.selectedStream.length > 1 &&
              searchObj.meta.sqlMode == false)
          ) {
            await generateHistogramData();
          }
          if (!queryReq.query?.streaming_output)
            refreshPartitionPagination(true);
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
          let aggFlag = false;
          if (parsedSQL) {
            aggFlag = hasAggregation(parsedSQL?.columns);
          }
          if (
            queryReq.query.from == 0 &&
            searchObj.data.queryResults.hits.length > 0 &&
            !aggFlag
          ) {
            setTimeout(async () => {
              searchObjDebug["pagecountStartTime"] = performance.now();
              // TODO : check the page count request
              getPageCount(queryReq);
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
          } else {
            resetHistogramWithError(
              "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries",
              -1,
            );
          }
          searchObj.meta.histogramDirtyFlag = false;
        } else {
          let aggFlag = false;
          if (parsedSQL) {
            aggFlag = hasAggregation(parsedSQL?.columns);
          }
          if (
            queryReq.query.from == 0 &&
            searchObj.data.queryResults.hits.length > 0 &&
            !aggFlag &&
            searchObj.data.queryResults.aggs == undefined
          ) {
            setTimeout(async () => {
              searchObjDebug["pagecountStartTime"] = performance.now();
              await getPageCount(queryReq);
              searchObjDebug["pagecountEndTime"] = performance.now();
            }, 0);
          } else {
            await generateHistogramData();
          }
        }
      } else {
        searchObj.loading = false;
        if (!notificationMsg.value) {
          notificationMsg.value = "Search query is empty or invalid.";
        }
      }
      searchObjDebug["queryDataEndTime"] = performance.now();
    } catch (e: any) {
      console.error(
        `${notificationMsg.value || "Error occurred during the search operation."}`,
        e,
      );
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      notificationMsg.value = "";
    }
  };
  const processHttpHistogramResults = async (queryReq: any) => {
    return new Promise(async (resolve, reject) => {
      try {
        searchObj.meta.refreshHistogram = false;
        if (searchObj.data.queryResults.hits.length > 0) {
          if (searchObj.data.stream.selectedStream.length > 1) {
            searchObj.data.histogram = {
              xData: [],
              yData: [],
              chartParams: {
                title: getHistogramTitle(),
                unparsed_x_data: [],
                timezone: "",
              },
              errorCode: 0,
              errorMsg: "Histogram is not available for multi stream search.",
              errorDetail: "",
            };
          } else {
            searchObjDebug["histogramStartTime"] = performance.now();
            searchObj.data.histogram.errorMsg = "";
            searchObj.data.histogram.errorCode = 0;
            searchObj.data.histogram.errorDetail = "";
            searchObj.loadingHistogram = true;

            const parsedSQL: any = fnParsedSQL();
            searchObj.data.queryResults.aggs = [];

            const partitions = JSON.parse(
              JSON.stringify(
                searchObj.data.queryResults.partitionDetail.partitions,
              ),
            );

            // is _timestamp orderby ASC then reverse the partition array
            if (isTimestampASC(parsedSQL?.orderby) && partitions.length > 1) {
              partitions.reverse();
            }

            await generateHistogramSkeleton();
            for (const partition of partitions) {
              searchObj.data.histogramQuery.query.start_time = partition[0];
              searchObj.data.histogramQuery.query.end_time = partition[1];
              //to improve the cancel query UI experience we add additional check here and further we need to remove it
              if (searchObj.data.isOperationCancelled) {
                searchObj.loadingHistogram = false;
                searchObj.data.isOperationCancelled = false;

                if (!searchObj.data.histogram?.xData?.length) {
                  notificationMsg.value = "Search query was cancelled";
                  searchObj.data.histogram.errorMsg =
                    "Search query was cancelled";
                  searchObj.data.histogram.errorDetail =
                    "Search query was cancelled";
                }

                showCancelSearchNotification();
                break;
              }
              await getHistogramQueryData(searchObj.data.histogramQuery);
              if (partitions.length > 1) {
                setTimeout(async () => {
                  await generateHistogramData();
                  if (!queryReq.query?.streaming_output)
                    refreshPartitionPagination(true);
                }, 100);
              }
            }
            searchObj.loadingHistogram = false;
          }
        }
        await generateHistogramData();
        if (!queryReq.query?.streaming_output) refreshPartitionPagination(true);
        resolve(true);
      } catch (error) {
        console.info("Error while processing http histogram results", error);
        resolve(true);
      }
    });
  };
  const getJobData = async (isPagination = false) => {
    try {
      // get websocket enable config from store
      // window will have more priority
      // if window has use_web_socket property then use that
      // else use organization settings
      const queryReq: any = buildSearch();
      if (queryReq == false) {
        throw new Error(notificationMsg.value || "Something went wrong.");
      }
      if (searchObj.meta.jobId == "") {
        queryReq.query.size = parseInt(searchObj.meta.jobRecords);
      }
      // reset query data and get partition detail for given query.

      if (queryReq != null) {
        // in case of live refresh, reset from to 0
        if (
          searchObj.meta.refreshInterval > 0 &&
          router.currentRoute.value.name == "logs"
        ) {
          queryReq.query.from = 0;
          searchObj.meta.refreshHistogram = true;
        }

        // get function definition
        addTransformToQuery(queryReq);

        // in case of relative time, set start_time and end_time to query
        // it will be used in pagination request
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
        delete queryReq.aggs;
      }
      searchObj.data.queryResults.subpage = 1;
      if (searchObj.meta.jobId == "") {
        searchService
          .schedule_search(
            {
              org_identifier: searchObj.organizationIdentifier,
              query: queryReq,
              page_type: searchObj.data.stream.streamType,
            },
            "ui",
          )
          .then((res: any) => {
            $q.notify({
              type: "positive",
              message: "Job Added Succesfully",
              timeout: 2000,
              actions: [
                {
                  label: "Go To Job Scheduler",
                  color: "white",
                  handler: () => routeToSearchSchedule(),
                },
              ],
            });
          });
      } else {
        await getPaginatedData(queryReq);
      }
      if (searchObj.meta.jobId == "") {
        searchObj.data.histogram.chartParams.title = getHistogramTitle();
      }
    } catch (e: any) {
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      throw e;
      // notificationMsg.value = "";
    }
  };

  function isTimestampASC(orderby: any) {
    if (orderby) {
      for (const order of orderby) {
        if (
          order.expr &&
          order.expr.column === store.state.zoConfig.timestamp_column
        ) {
          if (order.type && order.type === "ASC") {
            return true;
          }
        }
      }
    }
    return false;
  }

  const getPageCount = async (queryReq: any) => {
    return new Promise((resolve, reject) => {
      try {
        const isStreamingOutput = !!queryReq.query.streaming_output;
        searchObj.loadingCounter = true;
        searchObj.data.countErrorMsg = "";
        queryReq.query.size = 0;
        delete queryReq.query.from;
        delete queryReq.query.quick_mode;
        if (queryReq.query.action_id) delete queryReq.query.action_id;
        if (queryReq.query.hasOwnProperty("streaming_output"))
          delete queryReq.query.streaming_output;
        if (queryReq.query.hasOwnProperty("streaming_id"))
          delete queryReq.query.streaming_id;

        queryReq.query.track_total_hits = true;

        const { traceparent, traceId } = generateTraceContext();
        addTraceId(traceId);

        searchService
          .search(
            {
              org_identifier: searchObj.organizationIdentifier,
              query: queryReq,
              page_type: searchObj.data.stream.streamType,
              traceparent,
            },
            "ui",
          )
          .then(async (res) => {
            // check for total records update for the partition and update pagination accordingly
            // searchObj.data.queryResults.partitionDetail.partitions.forEach(
            //   (item: any, index: number) => {
            searchObj.data.queryResults.scan_size += res.data.scan_size;
            searchObj.data.queryResults.took += res.data.took;

            // Update total for the last partition
            if (searchObj.meta.jobId == "") {
              for (const [
                index,
                item,
              ] of searchObj.data.queryResults.partitionDetail.partitions.entries()) {
                if (
                  (searchObj.data.queryResults.partitionDetail.partitionTotal[
                    index
                  ] == -1 ||
                    searchObj.data.queryResults.partitionDetail.partitionTotal[
                      index
                    ] < res.data.total) &&
                  queryReq.query.start_time == item[0]
                ) {
                  searchObj.data.queryResults.partitionDetail.partitionTotal[
                    index
                  ] = res.data.total;
                }
              }
            }

            if (isStreamingOutput) {
              searchObj.data.queryResults.total = res.data.total;
            }

            let regeratePaginationFlag = false;
            if (res.data.hits.length != searchObj.meta.resultGrid.rowsPerPage) {
              regeratePaginationFlag = true;
            }
            // if total records in partition is greater than recordsPerPage then we need to update pagination
            // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
            refreshPartitionPagination(
              regeratePaginationFlag,
              isStreamingOutput,
            );

            searchObj.data.histogram.chartParams.title = getHistogramTitle();
            searchObj.loadingCounter = false;
            resolve(true);
          })
          .catch((err) => {
            searchObj.loading = false;
            searchObj.loadingCounter = false;

            // Reset cancel query on search error
            searchObj.data.isOperationCancelled = false;

            let trace_id = "";
            searchObj.data.countErrorMsg =
              "Error while retrieving total events: ";
            if (err.response != undefined) {
              if (err.response.data.hasOwnProperty("trace_id")) {
                trace_id = err.response.data?.trace_id;
              }
            } else {
              if (err.hasOwnProperty("trace_id")) {
                trace_id = err?.trace_id;
              }
            }

            const customMessage = logsErrorMessage(err?.response?.data.code);
            searchObj.data.errorCode = err?.response?.data.code;

            notificationMsg.value = searchObj.data.countErrorMsg;

            if (err?.request?.status >= 429 || err?.request?.status == 400) {
              notificationMsg.value = err?.response?.data?.message;
              searchObj.data.countErrorMsg += err?.response?.data?.message;
            }

            if (trace_id) {
              searchObj.data.countErrorMsg += " TraceID:" + trace_id;
              notificationMsg.value += " TraceID:" + trace_id;
              trace_id = "";
            }
            reject(false);
          })
          .finally(() => {
            removeTraceId(traceId);
          });
      } catch (e) {
        searchObj.loadingCounter = false;
        reject(false);
      }
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

  // Sorting function
  interface OrderByField {
    0: string;
    1: "asc" | "desc" | "ASC" | "DESC";
  }

  type OrderByArray = OrderByField[];

  interface RecordObject {
    [key: string]: any;
  }

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

  const routeToSearchSchedule = () => {
    router.push({
      query: {
        action: "search_scheduler",
        org_identifier: store.state.selectedOrganization.identifier,
        type: "search_scheduler_list",
      },
    });
  };

  const getHistogramQueryData = (queryReq: any) => {
    return new Promise((resolve, reject) => {
      if (searchObj.data.isOperationCancelled) {
        searchObj.loadingHistogram = false;
        searchObj.data.isOperationCancelled = false;

        if (!searchObj.data.histogram?.xData?.length) {
          notificationMsg.value = "Search query was cancelled";
          searchObj.data.histogram.errorMsg = "Search query was cancelled";
          searchObj.data.histogram.errorDetail = "Search query was cancelled";
        }

        showCancelSearchNotification();
        return;
      }

      const dismiss = () => {};
      try {
        // Set histogram interval
        if (searchObj.data.queryResults.histogram_interval) {
          //1. here we need to send the histogram interval to the BE so that it will honor this we get this from the search partition response
          //2. if user passes the histogram interval in the query BE will honor that and give us histogram interval in the parition response
          searchObj.data.histogramInterval =
            searchObj.data.queryResults.histogram_interval * 1000000;
          queryReq.query.histogram_interval =
            searchObj.data.queryResults.histogram_interval;
        }

        if (!searchObj.data.histogramInterval) {
          console.error(
            "Error processing histogram data:",
            "histogramInterval is not set",
          );
          searchObj.loadingHistogram = false;
          return;
        }
        const { traceparent, traceId } = generateTraceContext();
        addTraceId(traceId);
        queryReq.query.size = -1;
        searchService
          .search(
            {
              org_identifier: searchObj.organizationIdentifier,
              query: queryReq,
              page_type: searchObj.data.stream.streamType,
              traceparent,
              is_ui_histogram: true,
            },
            "ui",
            searchObj.data.stream.selectedStream.length > 1 &&
              searchObj.meta.sqlMode == false
              ? true
              : false,
          )
          .then(async (res: any) => {
            removeTraceId(traceId);
            searchObjDebug["histogramProcessingStartTime"] = performance.now();

            searchObj.loading = false;
            if (searchObj.data.queryResults.aggs == null) {
              searchObj.data.queryResults.aggs = [];
            }

            // copy converted_histogram_query to queryResults
            searchObj.data.queryResults.converted_histogram_query =
              res?.data?.converted_histogram_query ?? "";

            const parsedSQL: any = fnParsedSQL();
            const partitions = JSON.parse(
              JSON.stringify(
                searchObj.data.queryResults.partitionDetail.partitions,
              ),
            );

            // is _timestamp orderby ASC then reverse the partition array
            if (isTimestampASC(parsedSQL?.orderby) && partitions.length > 1) {
              partitions.reverse();
            }

            if (
              searchObj.data.queryResults.aggs.length == 0 &&
              res.data.hits.length > 0
            ) {
              for (const partition of partitions) {
                if (
                  partition[0] == queryReq.query.start_time &&
                  partition[1] == queryReq.query.end_time
                ) {
                  histogramResults = [];
                  let date = new Date();
                  const startDateTime =
                    searchObj.data.customDownloadQueryObj.query.start_time /
                    1000;

                  const endDateTime =
                    searchObj.data.customDownloadQueryObj.query.end_time / 1000;

                  const nowString = res.data.hits[0].zo_sql_key;
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
                    let currentTime: any =
                      currentTimeToBePassed.timestamp / 1000;
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
                    let currentTime: any =
                      currentTimeToBePassed.timestamp / 1000;
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
              }
            }

            const order_by = res?.data?.order_by ?? "desc";

            if (order_by?.toLowerCase() === "desc") {
              searchObj.data.queryResults.aggs.push(...res.data.hits);
            } else {
              searchObj.data.queryResults.aggs.unshift(...res.data.hits);
            }

            searchObj.data.queryResults.scan_size += res.data.scan_size;
            searchObj.data.queryResults.took += res.data.took;
            searchObj.data.queryResults.result_cache_ratio +=
              res.data.result_cache_ratio;
            const currentStartTime = queryReq.query.start_time;
            const currentEndTime = queryReq.query.end_time;
            let totalHits = 0;
            searchObj.data.queryResults.partitionDetail.partitions.map(
              (item: any, index: any) => {
                if (item[0] == currentStartTime && item[1] == currentEndTime) {
                  totalHits = res.data.hits.reduce(
                    (accumulator: number, currentValue: any) =>
                      accumulator +
                      Math.max(parseInt(currentValue.zo_sql_num, 10), 0),
                    0,
                  );

                  searchObj.data.queryResults.partitionDetail.partitionTotal[
                    index
                  ] = totalHits;

                  return;
                }
              },
            );

            queryReq.query.start_time =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][0].startTime;
            queryReq.query.end_time =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][0].endTime;

            // check if histogram interval is undefined, then set current response as histogram response
            // for visualization, will require to set histogram interval to fill missing values
            // Using same histogram interval attribute creates pagination issue(showing 1 to 50 out of .... was not shown on page change)
            // created new attribute visualization_histogram_interval to avoid this issue
            if (
              !searchObj.data.queryResults.visualization_histogram_interval &&
              res.data?.histogram_interval
            ) {
              searchObj.data.queryResults.visualization_histogram_interval =
                res.data?.histogram_interval;
            }

            // if (hasAggregationFlag) {
            //   searchObj.data.queryResults.total = res.data.total;
            // }

            // searchObj.data.histogram.chartParams.title = getHistogramTitle();

            searchObjDebug["histogramProcessingEndTime"] = performance.now();
            searchObjDebug["histogramEndTime"] = performance.now();

            dismiss();
            resolve(true);
          })
          .catch((err) => {
            searchObj.loadingHistogram = false;

            // Reset cancel query on search error
            searchObj.data.isOperationCancelled = false;

            let trace_id = "";

            if (err?.request?.status != 429) {
              searchObj.data.histogram.errorMsg =
                typeof err == "string" && err
                  ? err
                  : "Error while processing histogram request.";
              if (err.response != undefined) {
                searchObj.data.histogram.errorMsg = err.response.data.error;
                if (err.response.data.hasOwnProperty("trace_id")) {
                  trace_id = err.response.data?.trace_id;
                }
              } else {
                searchObj.data.histogram.errorMsg = err.message;
                if (err.hasOwnProperty("trace_id")) {
                  trace_id = err?.trace_id;
                }
              }

              const customMessage = logsErrorMessage(err?.response?.data.code);
              searchObj.data.histogram.errorCode = err?.response?.data.code;
              searchObj.data.histogram.errorDetail =
                err?.response?.data?.error_detail;

              if (customMessage != "") {
                searchObj.data.histogram.errorMsg = t(customMessage);
              }

              notificationMsg.value = searchObj.data.histogram.errorMsg;

              if (trace_id) {
                searchObj.data.histogram.errorMsg +=
                  " <br><span class='text-subtitle1'>TraceID:" +
                  trace_id +
                  "</span>";
                notificationMsg.value += " TraceID:" + trace_id;
                trace_id = "";
              }
            }

            reject(false);
          })
          .finally(() => {
            removeTraceId(traceId);
          });
      } catch (e: any) {
        dismiss();
        // searchObj.data.histogram.errorMsg = e.message;
        // searchObj.data.histogram.errorCode = e.code;
        searchObj.loadingHistogram = false;
        notificationMsg.value = searchObj.data.histogram.errorMsg;
        showErrorNotification("Error while fetching histogram data");

        reject(false);
      }
    });
  };

  const refreshData = () => {
    try {
      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "logs" &&
        enableRefreshInterval(searchObj.meta.refreshInterval)
      ) {
        clearInterval(store.state.refreshIntervalID);
        const refreshIntervalID = setInterval(async () => {
          if (
            searchObj.loading == false &&
            searchObj.loadingHistogram == false &&
            searchObj.meta.logsVisualizeToggle == "logs"
          ) {
            searchObj.loading = true;
            await getQueryData(false);
          }
        }, searchObj.meta.refreshInterval * 1000);
        store.dispatch("setRefreshIntervalID", refreshIntervalID);

        // only notify if user is in logs page
        if (searchObj.meta.logsVisualizeToggle == "logs") {
          $q.notify({
            message: `Live mode is enabled. Only top ${searchObj.meta.resultGrid.rowsPerPage} results are shown.`,
            color: "positive",
            position: "top",
            timeout: 1000,
          });
        }
      } else {
        clearInterval(store.state.refreshIntervalID);
      }

      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "logs" &&
        !enableRefreshInterval(searchObj.meta.refreshInterval)
      ) {
        searchObj.meta.refreshInterval = 0;
        clearInterval(store.state.refreshIntervalID);
        store.dispatch("setRefreshIntervalID", 0);
      }
    } catch (e: any) {
      console.log("Error while refreshing data", e);
    }
  };

  const loadLogsData = async () => {
    try {
      resetFunctions();
      await getStreamList();
      // await getSavedViews();
      await getFunctions();
      if (isActionsEnabled.value) await getActions();
      await extractFields();
      if (searchObj.meta.jobId == "") {
        await getQueryData();
      } else {
        await getJobData();
      }
      refreshData();
    } catch (e: any) {
      searchObj.loading = false;
    }
  };

  const loadVisualizeData = async () => {
    try {
      resetFunctions();
      await getStreamList();
      await getFunctions();
      if (isActionsEnabled.value) await getActions();
      await extractFields();
    } catch (e: any) {
      searchObj.loading = false;
    }
  };

  const loadJobData = async () => {
    try {
      resetFunctions();
      await getStreamList();
      await getFunctions();
      await extractFields();
      await getJobData();
      refreshData();
    } catch (e: any) {
      searchObj.loading = false;
      console.log("Error while loading logs data");
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
  const saveColumnSizes = () => {};

  const handleRunQuery = async () => {
    try {
      searchObj.loading = true;
      searchObj.meta.refreshHistogram = true;
      initialQueryPayload.value = null;
      searchObj.data.queryResults.aggs = null;
      if (
        Object.hasOwn(router.currentRoute.value.query, "type") &&
        router.currentRoute.value.query.type == "search_history_re_apply"
      ) {
        delete router.currentRoute.value.query.type;
      }
      // const queryTimeout = setTimeout(() => {
      //   if (searchObj.loading) {
      //     searchObj.meta.showSearchScheduler = true;
      //   }
      // }, 120000);
      await getQueryData();
      // clearTimeout(queryTimeout);
    } catch (e: any) {
      console.log("Error while loading logs data");
    }
  };

  const restoreUrlQueryParams = async (dashboardPanelData: any = null) => {
    searchObj.shouldIgnoreWatcher = true;
    const queryParams: any = router.currentRoute.value.query;
    if (!queryParams.stream) {
      searchObj.shouldIgnoreWatcher = false;
      return;
    }

    const date = {
      startTime: Number(queryParams.from),
      endTime: Number(queryParams.to),
      relativeTimePeriod: queryParams.period || null,
      type: queryParams.period ? "relative" : "absolute",
    };

    if (date.type === "relative") {
      queryParams.period = date.relativeTimePeriod;
    } else {
      queryParams.from = date.startTime;
      queryParams.to = date.endTime;
    }

    if (date) {
      searchObj.data.datetime = date;
    }

    if (queryParams.query) {
      searchObj.meta.sqlMode = queryParams.sql_mode == "true" ? true : false;
      searchObj.data.editorValue = b64DecodeUnicode(queryParams.query);
      searchObj.data.query = b64DecodeUnicode(queryParams.query);
    }

    if (
      queryParams.hasOwnProperty("defined_schemas") &&
      queryParams.defined_schemas != ""
    ) {
      searchObj.meta.useUserDefinedSchemas = queryParams.defined_schemas;
    }

    if (
      queryParams.refresh &&
      enableRefreshInterval(parseInt(queryParams.refresh))
    ) {
      searchObj.meta.refreshInterval = parseInt(queryParams.refresh);
    }

    if (
      queryParams.refresh &&
      !enableRefreshInterval(parseInt(queryParams.refresh))
    ) {
      delete queryParams.refresh;
    }

    useLocalTimezone(queryParams.timezone);

    if (queryParams.functionContent) {
      searchObj.data.tempFunctionContent =
        b64DecodeUnicode(queryParams.functionContent) || "";
      searchObj.meta.functionEditorPlaceholderFlag = false;
      searchObj.data.transformType = "function";
    }

    if (queryParams.stream_type) {
      searchObj.data.stream.streamType = queryParams.stream_type;
    } else {
      searchObj.data.stream.streamType = "logs";
    }

    if (queryParams.type) {
      searchObj.meta.pageType = queryParams.type;
    }
    searchObj.meta.quickMode = queryParams.quick_mode == "false" ? false : true;

    if (queryParams.stream) {
      searchObj.data.stream.selectedStream = queryParams.stream.split(",");
    }

    if (queryParams.show_histogram) {
      searchObj.meta.showHistogram =
        queryParams.show_histogram == "true" ? true : false;
    }

    searchObj.shouldIgnoreWatcher = false;
    if (
      Object.hasOwn(queryParams, "type") &&
      queryParams.type == "search_history_re_apply"
    ) {
      delete queryParams.type;
    }

    if (store.state.zoConfig?.super_cluster_enabled && queryParams.regions) {
      searchObj.meta.regions = queryParams.regions.split(",");
    }

    if (store.state.zoConfig?.super_cluster_enabled && queryParams.clusters) {
      searchObj.meta.clusters = queryParams.clusters.split(",");
    }

    if (
      queryParams.hasOwnProperty("logs_visualize_toggle") &&
      queryParams.logs_visualize_toggle != ""
    ) {
      searchObj.meta.logsVisualizeToggle = queryParams.logs_visualize_toggle;
    }

    //here we restore the fn editor state from the url query params
    if (queryParams.fn_editor) {
      searchObj.meta.showTransformEditor =
        queryParams.fn_editor == "true" ? true : false;
    }

    // TODO OK : Replace push with replace and test all scenarios
    router.push({
      query: {
        ...queryParams,
        sql_mode: searchObj.meta.sqlMode,
        defined_schemas: searchObj.meta.useUserDefinedSchemas,
      },
    });
  };

  const enableRefreshInterval = (value: number) => {
    return (
      value >= (Number(store.state?.zoConfig?.min_auto_refresh_interval) || 0)
    );
  };

  const updateStreams = async () => {
    if (searchObj.data.streamResults?.list?.length) {
      const streamType = searchObj.data.stream.streamType || "logs";
      const streams: any = await getStreams(streamType, false);
      searchObj.data.streamResults["list"] = streams.list;

      searchObj.data.stream.streamLists = [];
      streams.list.map((item: any) => {
        const itemObj = {
          label: item.name,
          value: item.name,
        };
        searchObj.data.stream.streamLists.push(itemObj);
      });
    } else {
      searchObj.loading = true;
      loadLogsData();
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
        .join(" UNION ");

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

  const cancelQuery = async (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      try {
        if (searchObj.communicationMethod === "ws") {
          sendCancelSearchMessage([...searchObj.data.searchWebSocketTraceIds]);
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

  const reorderArrayByReference = (arr1: string[], arr2: string[]) => {
    arr1.sort((a, b) => {
      const indexA = arr2.indexOf(a);
      const indexB = arr2.indexOf(b);

      // If an element is not found in arr1, keep it at the end
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;

      return indexA - indexB;
    });
  };

  const reorderSelectedFields = () => {
    const selectedFields = [...searchObj.data.stream.selectedFields];

    let colOrder =
      searchObj.data.resultGrid.colOrder[searchObj.data.stream.selectedStream];

    if (!selectedFields.includes(store.state.zoConfig.timestamp_column)) {
      colOrder = colOrder.filter(
        (v: any) => v !== store.state.zoConfig.timestamp_column,
      );
    }

    if (JSON.stringify(selectedFields) !== JSON.stringify(colOrder)) {
      reorderArrayByReference(selectedFields, colOrder);
    }

    return selectedFields;
  };

  const getFilterExpressionByFieldType = (
    field: string | number,
    field_value: string | number | boolean,
    action: string,
  ) => {
    let operator = action == "include" ? "=" : "!=";
    try {
      let fieldType: string = "utf8";

      const getStreamFieldTypes = (stream: any) => {
        if (!stream.schema) return {};
        return Object.fromEntries(
          stream.schema.map((schema: any) => [schema.name, schema.type]),
        );
      };

      const fieldTypeList = searchObj.data.streamResults.list
        .filter((stream: any) =>
          searchObj.data.stream.selectedStream.includes(stream.name),
        )
        .reduce(
          (acc: any, stream: any) => ({
            ...acc,
            ...getStreamFieldTypes(stream),
          }),
          {},
        );

      if (Object.hasOwn(fieldTypeList, field)) {
        fieldType = fieldTypeList[field];
      }

      if (
        field_value === "null" ||
        field_value === "" ||
        field_value === null
      ) {
        operator = action == "include" ? "is" : "is not";
        field_value = "null";
      }
      let expression =
        field_value == "null"
          ? `${field} ${operator} ${field_value}`
          : `${field} ${operator} '${field_value}'`;

      const isNumericType = (type: string) =>
        ["int64", "float64"].includes(type.toLowerCase());
      const isBooleanType = (type: string) => type.toLowerCase() === "boolean";

      if (isNumericType(fieldType)) {
        expression = `${field} ${operator} ${field_value}`;
      } else if (isBooleanType(fieldType)) {
        operator = action == "include" ? "is" : "is not";
        expression = `${field} ${operator} ${field_value}`;
      }

      return expression;
    } catch (e: any) {
      console.log("Error while getting filter expression by field type", e);
      return `${field} ${operator} '${field_value}'`;
    }
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

  /**
   * Extract value query
   * - Extract the query from the query string
   * - Replace the INDEX_NAME with the stream name
   * - Return the query
   *
   * JOIN Queries
   * - Parse the query and make where null
   * - Replace the INDEX_NAME with the stream name
   * - Return the query
   *
   * UNION Queries
   * - Parse the query and add where clause to each query
   * - Replace the INDEX_NAME with the stream name
   * - Return the query
   *
   * @returns
   */
  const extractValueQuery = () => {
    try {
      if (searchObj.meta.sqlMode == false || searchObj.data.query == "") {
        return {};
      }

      const orgQuery: string = searchObj.data.query
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");
      const outputQueries: any = {};
      const parsedSQL = fnParsedSQL(orgQuery);

      let query = `select * from INDEX_NAME`;
      const newParsedSQL = fnParsedSQL(query);
      if (
        Object.hasOwn(parsedSQL, "from") &&
        parsedSQL.from.length <= 1 &&
        parsedSQL._next == null
      ) {
        newParsedSQL.where = parsedSQL.where;

        query = fnUnparsedSQL(newParsedSQL).replace(/`/g, '"');
        outputQueries[parsedSQL.from[0].table] = query.replace(
          "INDEX_NAME",
          "[INDEX_NAME]",
        );
      } else {
        // parse join queries & union queries
        if (Object.hasOwn(parsedSQL, "from") && parsedSQL.from.length > 1) {
          parsedSQL.where = cleanBinaryExpression(parsedSQL.where);
          // parse join queries and make where null
          searchObj.data.stream.selectedStream.forEach((stream: string) => {
            newParsedSQL.where = null;

            query = fnUnparsedSQL(newParsedSQL).replace(/`/g, '"');
            outputQueries[stream] = query.replace("INDEX_NAME", "[INDEX_NAME]");
          });
        } else if (parsedSQL._next != null) {
          //parse union queries
          if (Object.hasOwn(parsedSQL, "from") && parsedSQL.from) {
            let query = `select * from INDEX_NAME`;
            const newParsedSQL = fnParsedSQL(query);

            newParsedSQL.where = parsedSQL.where;

            query = fnUnparsedSQL(newParsedSQL).replace(/`/g, '"');
            outputQueries[parsedSQL.from[0].table] = query.replace(
              "INDEX_NAME",
              "[INDEX_NAME]",
            );
          }

          let nextTable = parsedSQL._next;
          let depth = 0;
          const MAX_DEPTH = 100;
          while (nextTable && depth++ < MAX_DEPTH) {
            // Map through each "from" array in the _next object, as it can contain multiple tables
            if (nextTable.from) {
              let query = "select * from INDEX_NAME";
              const newParsedSQL = fnParsedSQL(query);

              newParsedSQL.where = nextTable.where;

              query = fnUnparsedSQL(newParsedSQL).replace(/`/g, '"');
              outputQueries[nextTable.from[0].table] = query.replace(
                "INDEX_NAME",
                "[INDEX_NAME]",
              );
            }
            nextTable = nextTable._next;
          }
          if (depth >= MAX_DEPTH) {
            throw new Error("Maximum query depth exceeded");
          }
        }
      }
      return outputQueries;
    } catch (error) {
      console.error("Error in extractValueQuery:", error);
      throw error;
    }
  };

  const cleanBinaryExpression = (node: any): any => {
    if (!node) return null;

    switch (node.type) {
      case "binary_expr": {
        const left: any = cleanBinaryExpression(node.left);
        const right: any = cleanBinaryExpression(node.right);

        // Remove the operator and keep only the non-null side if the other side is a field-only reference
        if (left && isFieldOnly(left) && isFieldOnly(right)) {
          return null; // Ignore this condition entirely if both sides are fields
        } else if (!left) {
          return right; // Only the right side remains, so return it
        } else if (!right) {
          return left; // Only the left side remains, so return it
        }

        // Return the expression if both sides are valid
        return {
          type: "binary_expr",
          operator: node.operator,
          left: left,
          right: right,
        };
      }

      case "column_ref":
        return {
          type: "column_ref",
          table: node.table || null,
          column:
            node.column && node.column.expr
              ? node.column.expr.value
              : node.column,
        };

      case "single_quote_string":
      case "number":
        return {
          type: node.type,
          value: node.value,
        };

      default:
        return node;
    }
  };

  // Helper function to check if a node is a field-only reference (column_ref without literal)
  function isFieldOnly(node: any): boolean {
    return node && node.type === "column_ref";
  }

  const setDateTime = (period: string = "15m") => {
    const extractedDate: any = extractTimestamps(period);
    searchObj.data.datetime.startTime = extractedDate.from;
    searchObj.data.datetime.endTime = extractedDate.to;
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

  return {
    searchObj,
    searchAggData,
    getStreams,
    updatedLocalLogFilterField,
    fieldValues,
    extractFields,
    getQueryData,
    getJobData,
    updateGridColumns,
    refreshData,
    updateUrlQueryParams,
    loadLogsData,
    restoreUrlQueryParams,
    handleQueryData,
    updateStreams,
    handleRunQuery,
    generateHistogramData,
    extractFTSFields,
    getSavedViews,
    onStreamChange,
    generateURLQuery,
    buildSearch,
    loadStreamLists,
    refreshPartitionPagination,
    filterHitsColumns,
    getHistogramQueryData,
    generateHistogramSkeleton,
    fnParsedSQL,
    getRegionInfo,
    validateFilterForMultiStream,
    cancelQuery,
    reorderSelectedFields,
    resetHistogramWithError,
    getFilterExpressionByFieldType,
    setSelectedStreams,
    extractValueQuery,
    initialQueryPayload,
    loadJobData,
    refreshJobPagination,
    enableRefreshInterval,
    routeToSearchSchedule,
    isActionsEnabled,
    sendCancelSearchMessage,
    getStream,
    getQueryPartitions,
    getPaginatedData,
    updateFieldValues,
    getHistogramTitle,
    processPostPaginationData,
    parser,
    router,
    $q,
    getPageCount,
    clearSearchObj,
    setCommunicationMethod,
    loadVisualizeData,
    processHttpHistogramResults,
    streamSchemaFieldsIndexMapping,
    notificationMsg,
    showErrorNotification,
    setDateTime,
  };
};

export default useLogs;
