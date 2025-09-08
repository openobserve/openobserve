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
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { INTERVAL_MAP, DEFAULT_LOGS_CONFIG } from "@/utils/logs/constants";
import {logsUtils} from "@/composables/useLogs/logsUtils";
import {usePagination} from "@/composables/useLogs/usePagination";

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


const { fetchQueryDataWithHttpStream } = useStreamingSearch();


type SearchPartition = {
  partition: number;
  chunks: Record<number, number>;
};

const searchPartitionMap = reactive<Record<string, SearchPartition>>({});

const useLogs = () => {
  const store = useStore();
  const { t } = useI18n();
  const $q = useQuasar();

  const {getHistogramTitle,
  generateHistogramData,
  generateHistogramSkeleton,
  getHistogramQueryData,
  isHistogramEnabled,} = useHistogram();
  const { refreshPartitionPagination, getPaginatedData } = usePagination();

  const { getQueryReq,
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
handleSearchReset,
validateFilterForMultiStream, buildSearch} = useSearchStream();

const {getFunctions, getActions, getQueryData} = useSearchBar();

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
  generateURLQuery,
updatedLocalLogFilterField,
isTimestampASC,} = logsUtils();

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

  // const updatedLocalLogFilterField = (): void => {
  //   const identifier: string = searchObj.organizationIdentifier || "default";
  //   const selectedFields: any =
  //     useLocalLogFilterField()?.value != null
  //       ? useLocalLogFilterField()?.value
  //       : {};
  //   const stream = searchObj.data.stream.selectedStream.sort().join("_");
  //   selectedFields[`${identifier}_${stream}`] =
  //     searchObj.data.stream.selectedFields;
  //   useLocalLogFilterField(selectedFields);
  // };

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

  const processPostPaginationData = () => {
    updateFieldValues();

    //extract fields from query response
    extractFields();

    //update grid columns
    updateGridColumns();

    filterHitsColumns();
    searchObj.data.histogram.chartParams.title = getHistogramTitle();
  };

  

  const routeToSearchSchedule = () => {
    router.push({
      query: {
        action: "search_scheduler",
        org_identifier: searchObj.organizationIdentifier,
        type: "search_scheduler_list",
      },
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

  // const handleQueryData = async () => {
  //   try {
  //     searchObj.data.tempFunctionLoading = false;
  //     searchObj.data.tempFunctionName = "";
  //     searchObj.data.tempFunctionContent = "";
  //     searchObj.loading = true;
  //     await getQueryData();
  //   } catch (e: any) {
  //     console.log("Error while loading logs data");
  //   }
  // };
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

  const handleSearchReset = async (data: any, traceId?: string) => {
    // reset query data
    try {
      if(data.type === "search") {
        if(!data.isPagination) {
          resetQueryData();
          searchObj.data.queryResults = {};
        }

        // reset searchAggData
        searchAggData.total = 0;
        searchAggData.hasAggregation = false;
        searchObj.meta.showDetailTab = false;
        searchObj.meta.searchApplied = true;
        searchObj.data.functionError = "";
      
        searchObj.data.errorCode = 0;
      
        if(!data.isPagination) {
          // Histogram reset
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
          resetHistogramError();
        }

        const payload = buildWebSocketPayload(data.queryReq, data.isPagination, "search");

        initializeSearchConnection(payload);
        addTraceId(payload.traceId);
      }

      if(data.type === "histogram" || data.type === "pageCount") {
        searchObj.data.queryResults.aggs = [];
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
        
        resetHistogramError();

        searchObj.loadingHistogram = true;

        if(data.type === "histogram") await generateHistogramSkeleton();

        if(data.type === "histogram") histogramResults = [];

        const payload = buildWebSocketPayload(
          data.queryReq,
          false,
          data.type,
        );

        initializeSearchConnection(payload);

        addTraceId(payload.traceId);
      }
    } catch(e: any){
      console.error("Error while resetting search", e);
    }
  };

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

  const setDateTime = (period: string = "15m") => {
    const extractedDate: any = extractTimestamps(period);
    searchObj.data.datetime.startTime = extractedDate.from;
    searchObj.data.datetime.endTime = extractedDate.to;
  };


  const handleStreamingHits = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    // Scan-size and took time in histogram title
    // For the initial request, we get histogram and logs data. So, we need to sum the scan_size and took time of both the requests.
    // For the pagination request, we only get logs data. So, we need to consider scan_size and took time of only logs request.
    if((isPagination && searchPartitionMap[payload.traceId].partition === 1) || !appendResult){
      searchObj.data.queryResults.hits = response.content.results.hits;
    } else if (appendResult) {
      searchObj.data.queryResults.hits.push(
        ...response.content.results.hits,
      );
    } 
    
    if (searchObj.meta.refreshInterval == 0) {
      updatePageCountTotal(payload.queryReq, response.content.results.hits.length, searchObj.data.queryResults.hits.length);
      trimPageCountExtraHit(payload.queryReq, searchObj.data.queryResults.hits.length);
    }

    refreshPagination(true);

    processPostPaginationData();
  }

  const handleStreamingMetadata = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
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
          took: (searchObj.data?.queryResults?.took || 0) + response.content.results.took,
          scan_size: (searchObj.data?.queryResults?.scan_size || 0) + response.content.results.scan_size,
          hits: searchObj.data?.queryResults?.hits || [],
          streaming_aggs: response.content?.streaming_aggs,
        }
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
    if(response.content.results.hasOwnProperty("is_histogram_eligible")){
      searchObj.data.queryResults.is_histogram_eligible = response.content.results.is_histogram_eligible;
    }

    if(searchObj.meta.refreshInterval == 0) {
      if(shouldGetPageCount(payload.queryReq, fnParsedSQL()) && (response.content.results.total === payload.queryReq.query.size)) {
        searchObj.data.queryResults.pageCountTotal = payload.queryReq.query.size * searchObj.data.resultGrid.currentPage;
      } else if(shouldGetPageCount(payload.queryReq, fnParsedSQL()) && (response.content.results.total != payload.queryReq.query.size)){
        searchObj.data.queryResults.pageCountTotal = (payload.queryReq.query.size * Math.max(searchObj.data.resultGrid.currentPage-1,0)) + response.content.results.total;
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
  }

  const updatePageCountTotal = (queryReq: SearchRequestPayload, currentHits: number, total: any) => {
    try {
      if(shouldGetPageCount(queryReq, fnParsedSQL()) && (total === queryReq.query.size)) {
        searchObj.data.queryResults.pageCountTotal = (searchObj.meta.resultGrid.rowsPerPage * searchObj.data.resultGrid.currentPage) + 1;
      } else if(shouldGetPageCount(queryReq, fnParsedSQL()) && (total !== queryReq.query.size)){
        searchObj.data.queryResults.pageCountTotal = ((searchObj.meta.resultGrid.rowsPerPage) * Math.max(searchObj.data.resultGrid.currentPage-1,0)) + currentHits;
      }
    } catch(e: any) {
      console.error("Error while updating page count total", e);
    }
  }

  const trimPageCountExtraHit = (queryReq: SearchRequestPayload, total: any) => {
    try{
      if(shouldGetPageCount(queryReq, fnParsedSQL()) && (total === queryReq.query.size)) {
        searchObj.data.queryResults.hits = searchObj.data.queryResults.hits.slice(0, searchObj.data.queryResults.hits.length- 1);
      }
    } catch(e: any) {
      console.error("Error while trimming page count extra hit", e);
    }
  }

  // const updatePageCountSearchSize = (queryReq: SearchRequestPayload) => {
  //   try{
  //     if(shouldGetPageCount(queryReq, fnParsedSQL())) {
  //       queryReq.query.size = queryReq.query.size + 1;
  //     }
  //   } catch(e: any) {
  //     console.error("Error while updating page count search size", e);
  //     return queryReq.query.size;
  //   }
  // }

  const handleHistogramStreamingHits = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    
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

      if(!searchObj.data.histogramInterval) {
        console.error("Error processing histogram data:", "histogramInterval is not set");
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
      searchObj.data.queryResults.aggs.unshift(...response.content.results.hits);
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
  }

  const handleHistogramStreamingMetadata = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    searchObjDebug["histogramProcessingStartTime"] = performance.now();

    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;
    searchObj.data.queryResults.result_cache_ratio +=
      response.content.results.result_cache_ratio;
      searchObj.data.queryResults.histogram_interval = response.content.results.histogram_interval;
      if(searchObj.data.queryResults.histogram_interval) searchObj.data.histogramInterval = searchObj.data.queryResults.histogram_interval * 1000000;
    searchObj.data.queryResults.order_by = response?.content?.results?.order_by ?? "desc";

    // copy converted_histogram_query to queryResults
    searchObj.data.queryResults.converted_histogram_query = response?.content?.results?.converted_histogram_query ?? "";

    // check if histogram interval is undefined, then set current response as histogram response
    // for visualization, will require to set histogram interval to fill missing values
    // Using same histogram interval attribute creates pagination issue(showing 1 to 50 out of .... was not shown on page change)
    // created new attribute visualization_histogram_interval to avoid this issue
    if (
      !searchObj.data.queryResults.visualization_histogram_interval &&
      response.content?.results?.histogram_interval
    ) {
      searchObj.data.queryResults.visualization_histogram_interval  =
        response.content?.results?.histogram_interval;
    }
  }

  const handlePageCountStreamingHits = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    let regeratePaginationFlag = false;
    if (
      response.content.results.hits.length !=
      searchObj.meta.resultGrid.rowsPerPage
    ) {
      regeratePaginationFlag = true;
    }
  
    if(response.content?.streaming_aggs || searchObj.data.queryResults.streaming_aggs) {
      searchObj.data.queryResults.aggs = response.content.results.hits;
    } else {
      searchObj.data.queryResults.aggs.push(...response.content.results.hits);
    }

    // if total records in partition is greater than recordsPerPage then we need to update pagination
    // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
    refreshPagination(regeratePaginationFlag);

    searchObj.data.histogram.chartParams.title = getHistogramTitle();
  }

  const handlePageCountStreamingMetadata = (payload: WebSocketSearchPayload, response: WebSocketSearchResponse, isPagination: boolean, appendResult: boolean = false) => {
    removeTraceId(response.content.traceId);

    if (searchObj.data.queryResults.aggs == null) {
      searchObj.data.queryResults.aggs = [];
    }

    searchObj.data.queryResults.streaming_aggs = response?.content?.streaming_aggs;

    searchObj.data.queryResults.scan_size += response.content.results.scan_size;
    searchObj.data.queryResults.took += response.content.results.took;
  }

  // Limit, aggregation, vrl function, pagination, function error and query error
  const handleSearchResponse = (
    payload: WebSocketSearchPayload,
    response: WebSocketSearchResponse,
  ) => {
    // Streaming aggs and hits -> replace
    // streaming aggs and empty hits -> append
    // If first partition then replace else it depends on streaming aggs and hits length
    if(payload.type === "search" && response?.type === "search_response_hits") {
      const isStreamingAggs = response.content?.streaming_aggs || searchObj.data.queryResults.streaming_aggs;
      const shouldAppendStreamingResults = isStreamingAggs ? !response.content?.results?.hits?.length : true;
      searchPartitionMap[payload.traceId].chunks[searchPartitionMap[payload.traceId].partition]++;
      // If single partition has more than 1 chunk, then we need to append the results
      const isChunkedHits = searchPartitionMap[payload.traceId].chunks[searchPartitionMap[payload.traceId].partition] > 1;

      handleStreamingHits(payload, response, payload.isPagination, (shouldAppendStreamingResults && (searchPartitionMap[payload.traceId].partition > 1 || isChunkedHits)));
      return;
    }

    if(payload.type === "search" && response?.type === "search_response_metadata") {
      searchPartitionMap[payload.traceId] = searchPartitionMap[payload.traceId]
      ? searchPartitionMap[payload.traceId]
      : {
        partition: 0,
        chunks: {},
      };

      const isStreamingAggs = response.content?.streaming_aggs;
      const shouldAppendStreamingResults = isStreamingAggs ? !response.content?.results?.hits?.length : true;

      searchPartitionMap[payload.traceId].partition++;
      searchPartitionMap[payload.traceId].chunks[searchPartitionMap[payload.traceId].partition] = 0;

      handleStreamingMetadata(payload, response, payload.isPagination, (shouldAppendStreamingResults && searchPartitionMap[payload.traceId].partition > 1));
      return;
    }

    if(payload.type === "histogram" && response?.type === "search_response_hits") {      
      handleHistogramStreamingHits(payload, response, payload.isPagination);
      return;
    }

    if(payload.type === "histogram" && response?.type === "search_response_metadata") {
      handleHistogramStreamingMetadata(payload, response, payload.isPagination);
      return;
    }


    if(payload.type === "pageCount" && response?.type === "search_response_hits") {
      handlePageCountStreamingHits(payload, response, payload.isPagination);
      return;
    }

    if(payload.type === "pageCount" && response?.type === "search_response_metadata") {
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

      if (payload.type === "search") {
        handleLogsResponse(
          payload.queryReq,
          payload.isPagination,
          payload.traceId,
          response,
          !response.content?.streaming_aggs &&
            searchPartitionMap[payload.traceId].partition > 1, // In aggregation query, we need to replace the results instead of appending
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

  const handleFunctionError = (queryReq: SearchRequestPayload, response: any) => {
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
  }

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
  }

  const updateResult = async (queryReq: SearchRequestPayload, response: any, isPagination: boolean, appendResult: boolean = false) => {
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
          await chunkedAppend(searchObj.data.queryResults.hits, response.content.results.hits);

        searchObj.data.queryResults.total += response.content.results.total;
        searchObj.data.queryResults.took += response.content.results.took;
        searchObj.data.queryResults.scan_size +=
          response.content.results.scan_size;
      } else {
        if (response.content?.streaming_aggs) {
          searchObj.data.queryResults = {
            ...response.content.results,
            took: (searchObj.data?.queryResults?.took || 0) + response.content.results.took,
            scan_size: (searchObj.data?.queryResults?.scan_size || 0) + response.content.results.scan_size,
          }
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
  }

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

  const chunkedAppend = async (target: any, source: any, chunkSize = 5000) => {
    for (let i = 0; i < source.length; i += chunkSize) {
      target.push.apply(target, source.slice(i, i + chunkSize));
      await new Promise(resolve => setTimeout(resolve, 0)); // Let UI update
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

  // const resetHistogramError = () => {
  //   searchObj.data.histogram.errorMsg = "";
  //   searchObj.data.histogram.errorCode = 0;
  //   searchObj.data.histogram.errorDetail = "";
  // };

  const shouldShowHistogram = (parsedSQL: any) => {
    return ((isHistogramDataMissing(searchObj) && isHistogramEnabled(searchObj) && (!searchObj.meta.sqlMode || isNonAggregatedSQLMode(searchObj, parsedSQL))) ||
            (isHistogramEnabled(searchObj) && !searchObj.meta.sqlMode)) &&
            (searchObj.data.stream.selectedStream.length === 1 || (searchObj.data.stream.selectedStream.length > 1 && !searchObj.meta.sqlMode));
  }

  const processHistogramRequest = async (queryReq: SearchRequestPayload) => {
    const parsedSQL: any = fnParsedSQL();

    if (searchObj.data.stream.selectedStream.length > 1 && searchObj.meta.sqlMode == true) {
      const errMsg = "Histogram is not available for multi-stream SQL mode search.";
      resetHistogramWithError(errMsg, 0);
    }

    if (!searchObj.data.queryResults?.hits?.length) {
      return;
    }

    const isFromZero = queryReq.query.from == 0 &&
    searchObj.data.queryResults.hits?.length > 0

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

        if (searchObj.data.stream.selectedStream.length > 1 && searchObj.meta.sqlMode == false) {
          payload.queryReq.query.sql = setMultiStreamHistogramQuery(searchObj.data.histogramQuery.query);
        } else {
          payload.queryReq.query.sql = searchObj.data.histogramQuery.query.sql.replace("[INTERVAL]",
            searchObj.meta.resultGrid.chartInterval,
          );
        }

        payload.meta = {
          isHistogramOnly: searchObj.meta.histogramDirtyFlag,
          is_ui_histogram: true,
        }

        const requestId = initializeSearchConnection(payload);

        addTraceId(payload.traceId);
      }
    } else if (searchObj.meta.sqlMode && isLimitQuery(parsedSQL)) {
      resetHistogramWithError("Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.", -1);
      searchObj.meta.histogramDirtyFlag = false;
    } else if (searchObj.meta.sqlMode && (isDistinctQuery(parsedSQL) || isWithQuery(parsedSQL) || !searchObj.data.queryResults.is_histogram_eligible)) {
      if (shouldGetPageCount(queryReq, parsedSQL) && isFromZero) {
        setTimeout(async () => {
          searchObjDebug["pagecountStartTime"] = performance.now();
          getPageCountThroughSocket(queryReq);
          searchObjDebug["pagecountEndTime"] = performance.now();
        }, 0);
      }
      if(isWithQuery(parsedSQL) || !searchObj.data.queryResults.is_histogram_eligible){
        resetHistogramWithError(
          "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
          -1
        );
        searchObj.meta.histogramDirtyFlag = false;
      }
      else{
        resetHistogramWithError(
          "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
          -1
        );
      }
      searchObj.meta.histogramDirtyFlag = false;
    } else {
      if(shouldGetPageCount(queryReq, parsedSQL) && isFromZero) {
        setTimeout(async () => {
          searchObjDebug["pagecountStartTime"] = performance.now();
          getPageCountThroughSocket(queryReq);
          searchObjDebug["pagecountEndTime"] = performance.now();
        }, 0);
      }
    }
  };

  function isHistogramEnabled(searchObj: any) {
    return (
      searchObj.meta.refreshHistogram &&
      !searchObj.loadingHistogram &&
      searchObj.meta.showHistogram
    );
  }

  // function isSingleStreamSelected(searchObj: any) {
  //   return searchObj.data.stream.selectedStream.length <= 1;
  // }

  function isNonAggregatedSQLMode(searchObj: any, parsedSQL: any) {
    return !(
      searchObj.meta.sqlMode &&
      (isLimitQuery(parsedSQL) || isDistinctQuery(parsedSQL) || isWithQuery(parsedSQL) || !searchObj.data.queryResults.is_histogram_eligible)
    );
  }

  function isHistogramDataMissing(searchObj: any) {
    return !searchObj.data.queryResults?.aggs?.length;
  }

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

    if(!searchObj.data.queryResults.hasOwnProperty('hits')){
      searchObj.data.queryResults.hits = [];
    }

    if(payload.type === "search" && !payload.isPagination && searchObj.meta.refreshInterval == 0) {
      searchObj.meta.resetPlotChart = true;
    }
    if (
      payload.type === "search" &&
      !payload.isPagination &&
      !searchObj.data.isOperationCancelled
    ) {
      processHistogramRequest(payload.queryReq);
    }

    if (payload.type === "search" && !response?.content?.should_client_retry) searchObj.loading = false;
    if ((payload.type === "histogram" || payload.type === "pageCount") && !response?.content?.should_client_retry){
      searchObj.loadingHistogram = false;
    }



    searchObj.data.isOperationCancelled = false;
  };

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

    if(error === "rate_limit_exceeded") {
      errorMsg = message;
    }

    if(request.type === 'pageCount') {
      searchObj.data.countErrorMsg = "Error while retrieving total events: ";
      if (trace_id) searchObj.data.countErrorMsg += " TraceID: " + trace_id;
      notificationMsg.value = searchObj.data.countErrorMsg;
    } else {
      if(request.type === 'pageCount') {
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
      (acc: number, item: { zo_sql_num: number; }) => acc + item.zo_sql_num,
      0,
    );
  };

  const refreshPagination = (regenrateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;

      if (searchObj.meta.jobId != "")
        searchObj.meta.resultGrid.rowsPerPage = 100;

      let total = 0;
      let totalPages = 0;

      total = getAggsTotal();



      if((searchObj.data.queryResults.pageCountTotal || -1) > total) {
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
    getJobData,
    updateGridColumns,
    refreshData,
    updateUrlQueryParams,
    loadLogsData,
    restoreUrlQueryParams,
    updateStreams,
    handleRunQuery,
    extractFTSFields,
    generateURLQuery,
    loadStreamLists,
    filterHitsColumns,
    generateHistogramSkeleton,
    fnParsedSQL,
    reorderSelectedFields,
    getFilterExpressionByFieldType,
    extractValueQuery,
    initialQueryPayload,
    loadJobData,
    enableRefreshInterval,
    routeToSearchSchedule,
    isActionsEnabled,
    getStream,
    updateFieldValues,
    getHistogramTitle,
    processPostPaginationData,
    parser,
    router,
    $q,
    clearSearchObj,
    loadVisualizeData,
    processHttpHistogramResults,
    streamSchemaFieldsIndexMapping,
    notificationMsg,
    showErrorNotification,
    setDateTime,
  };
};

export default useLogs;
