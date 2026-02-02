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
import { useI18n } from "vue-i18n";
import { reactive, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";

import { b64DecodeUnicode, useLocalTimezone } from "@/utils/zincutils";

import useNotifications from "@/composables/useNotifications";
import useStreams from "@/composables/useStreams";

import searchService from "@/services/search";

import { searchState } from "@/composables/useLogs/searchState";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { DEFAULT_LOGS_CONFIG } from "@/utils/logs/constants";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { usePagination } from "@/composables/useLogs/usePagination";

import useStreamFields from "@/composables/useLogs/useStreamFields";
import { useHistogram } from "@/composables/useLogs/useHistogram";
import useSearchBar from "@/composables/useLogs/useSearchBar";

const useLogs = () => {
  const store = useStore();
  const { t } = useI18n();
  const $q = useQuasar();

  let {
    searchObj,
    searchObjDebug,
    initialQueryPayload,
    resetFunctions,
    notificationMsg,
    fieldValues,
  } = searchState();

  const { getHistogramTitle } = useHistogram();

  const { refreshPartitionPagination, getPaginatedData } = usePagination();

  const { buildSearch } = useSearchStream();

  const { getFunctions, getActions, getQueryData } = useSearchBar();

  const {
    fnParsedSQL,
    fnUnparsedSQL,
    extractTimestamps,
    addTransformToQuery,
    isActionsEnabled,
    showCancelSearchNotification,
    isTimestampASC,
  } = logsUtils();

  const {
    updateFieldValues,
    extractFields,
    updateGridColumns,
    filterHitsColumns,
    getStreamList,
  } = useStreamFields();

  const { showErrorNotification } = useNotifications();
  const { getStreams } = useStreams();

  const router = useRouter();

  onBeforeMount(async () => {
    if (router.currentRoute.value.query?.quick_mode == "true") {
      searchObj.meta.quickMode = true;
    }
    extractValueQuery();
  });

  const clearSearchObj = () => {
    searchObj = reactive(
      Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_LOGS_CONFIG))),
    );
  };

  const getJobData = async (isPagination = false) => {
    try {
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

      // Create initialStreamSelected variable to handle first time load when api call for function & actions are
      // in-progress and user select stream from dropdown in that case it loads data but it should wait for
      // additional details from the user like filter conditions and time range selection before load data
      // it should work in case of page refresh, navigate user from streams page or short url
      let initialStreamSelected: boolean = searchObj.data.stream.selectedStream.length > 0;

      await getStreamList();
      await getFunctions();
      if (isActionsEnabled.value) await getActions();
      await extractFields();
      if (searchObj.meta.jobId == "") {
        if (initialStreamSelected) {
          await getQueryData();
        } else {
          searchObj.loading = false;
        }
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

  const loadPatternsData = async () => {
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

  const handleRunQuery = async (clear_cache = false) => {
    try {
      searchObj.loading = true;
      searchObj.meta.refreshHistogram = true;
      initialQueryPayload.value = null;
      searchObj.data.queryResults.aggs = null;
      searchObj.meta.clearCache = clear_cache;
      if (
        Object.hasOwn(router.currentRoute.value.query, "type") &&
        router.currentRoute.value.query.type == "search_history_re_apply"
      ) {
        delete router.currentRoute.value.query.type;
      }
      await getQueryData();
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

  const reorderArrayByReference = (arr1: string[], arr2: string[]): string[] => {
    return [...arr1].sort((a, b) => {
      const indexA = arr2.indexOf(a);
      const indexB = arr2.indexOf(b);

      if (indexA === -1) return 1;
      if (indexB === -1) return -1;

      return indexA - indexB;
    });
  };

  const reorderSelectedFields = () => {
    const selectedFields = [...searchObj.data.stream.selectedFields].filter(
      (_field) =>
        _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
    );

    let colOrder = searchObj.data.resultGrid.colOrder[
      searchObj.data.stream.selectedStream
    ].filter(
      (_field) =>
        _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
    );

    // Skip reordering when colOrder is empty to prevent unstable sort in Firefox
    if (colOrder.length === 0) {
      return selectedFields;
    }

    if (JSON.stringify(selectedFields) !== JSON.stringify(colOrder)) {
      return reorderArrayByReference(selectedFields, colOrder);
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
        parsedSQL.from.length > 0 &&
        parsedSQL.from[0]?.table &&
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

  return {
    getJobData,
    refreshData,
    loadLogsData,
    restoreUrlQueryParams,
    updateStreams,
    handleRunQuery,
    reorderSelectedFields,
    getFilterExpressionByFieldType,
    extractValueQuery,
    loadJobData,
    enableRefreshInterval,
    routeToSearchSchedule,
    processPostPaginationData,
    router,
    $q,
    clearSearchObj,
    loadVisualizeData,
    loadPatternsData,
    getHistogramTitle,
  };
};

export default useLogs;
