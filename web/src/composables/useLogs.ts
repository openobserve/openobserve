// Copyright 2023 Zinc Labs Inc.
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
import { reactive, ref, type Ref, toRaw, nextTick, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";

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
  generateTraceContext,
} from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { byString } from "@/utils/json";
import { logsErrorMessage } from "@/utils/common";
import useSqlSuggestions from "@/composables/useSuggestions";
// import {
//   b64EncodeUnicode,
//   useLocalLogFilterField,
//   b64DecodeUnicode,
// } from "@/utils/zincutils";

import useFunctions from "@/composables/useFunctions";
import useNotifications from "@/composables/useNotifications";
import useStreams from "@/composables/useStreams";

import searchService from "@/services/search";
import type { LogsQueryPayload } from "@/ts/interfaces/query";
import savedviewsService from "@/services/saved_views";
import config from "@/aws-exports";

const defaultObject = {
  organizationIdetifier: "",
  runQuery: false,
  loading: false,
  loadingHistogram: false,
  loadingStream: false,
  loadingSavedView: false,
  shouldIgnoreWatcher: false,
  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40],
    fnSplitterModel: 60,
    fnLastSplitterPosition: 0,
    fnSplitterLimit: [40, 100],
    refreshTimes: [
      [
        { label: "5 sec", value: 5 },
        { label: "1 min", value: 60 },
        { label: "1 hr", value: 3600 },
      ],
      [
        { label: "10 sec", value: 10 },
        { label: "5 min", value: 300 },
        { label: "2 hr", value: 7200 },
      ],
      [
        { label: "15 sec", value: 15 },
        { label: "15 min", value: 900 },
        { label: "1 day", value: 86400 },
      ],
      [
        { label: "30 sec", value: 30 },
        { label: "30 min", value: 1800 },
      ],
    ],
  },
  meta: {
    logsVisualizeToggle: "logs",
    refreshInterval: <number>0,
    refreshIntervalLabel: "Off",
    refreshHistogram: false,
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    toggleFunction: true,
    searchApplied: false,
    toggleSourceWrap: useLocalWrapContent()
      ? JSON.parse(useLocalWrapContent())
      : false,
    histogramDirtyFlag: false,
    sqlMode: false,
    quickMode: false,
    queryEditorPlaceholderFlag: true,
    functionEditorPlaceholderFlag: true,
    resultGrid: {
      wrapCells: false,
      manualRemoveFields: false,
      rowsPerPage: 100,
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: {
        currentRowIndex: 0,
      },
      showPagination: true,
    },
    scrollInfo: {},
    pageType: "logs", // 'logs' or 'stream
    regions: [],
    clusters: [],
    useUserDefinedSchemas: "user_defined_schema",
    hasUserDefinedSchemas: false,
    selectedTraceStream: "",
  },
  data: {
    query: <any>"",
    histogramQuery: <any>"",
    parsedQuery: {},
    countErrorMsg: "",
    errorMsg: "",
    errorCode: 0,
    filterErrMsg: "",
    missingStreamMessage: "",
    additionalErrorMsg: "",
    savedViewFilterFields: "",
    hasSearchDataTimestampField: false,
    stream: {
      loading: false,
      streamLists: <object[]>[],
      selectedStream: <any>[],
      selectedStreamFields: <any>[],
      selectedFields: <string[]>[],
      filterField: "",
      addToFilter: "",
      functions: <any>[],
      streamType: "logs",
      interestingFieldList: <string[]>[],
      userDefinedSchema: <any>[],
      expandGroupRows: <any>{},
      expandGroupRowsFieldCount: <any>{},
      filteredField: <any>[],
      missingStreamMultiStreamFilter: <any>[],
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 1,
      columns: <any>[],
      colOrder: <any>{},
      colSizes: <any>{},
    },
    transforms: <any>[],
    queryResults: <any>[],
    sortedQueryResults: <any>[],
    streamResults: <any>[],
    histogram: <any>{
      xData: [],
      yData: [],
      chartParams: {
        title: "",
        unparsed_x_data: [],
        timezone: "",
      },
      errorMsg: "",
      errorCode: 0,
      errorDetail: "",
    },
    editorValue: <any>"",
    datetime: <any>{
      startTime: (new Date().getTime() - 900000) * 1000,
      endTime: new Date().getTime(),
      relativeTimePeriod: "15m",
      type: "relative",
      selectedDate: <any>{},
      selectedTime: <any>{},
      queryRangeRestrictionMsg: "",
      queryRangeRestrictionInHour: 100000,
    },
    searchAround: {
      indexTimestamp: 0,
      size: <number>10,
      histogramHide: false,
    },
    tempFunctionName: "",
    tempFunctionContent: "",
    tempFunctionLoading: false,
    savedViews: <any>[],
    customDownloadQueryObj: <any>{},
    functionError: "",
    searchRequestTraceIds: <string[]>[],
    isOperationCancelled: false,
  },
};

const searchObj = reactive(Object.assign({}, defaultObject));
const searchObjDebug = reactive({
  queryDataStartTime: 0,
  queryDataEndTime: 0,
  buildSearchStartTime: 0,
  buildSearchEndTime: 0,
  partitionStartTime: 0,
  partitionEndTime: 0,
  paginatedDatawithAPIStartTime: 0,
  paginatedDatawithAPIEndTime: 0,
  pagecountStartTime: 0,
  pagecountEndTime: 0,
  paginatedDataReceivedStartTime: 0,
  paginatedDataReceivedEndTime: 0,
  histogramStartTime: 0,
  histogramEndTime: 0,
  histogramProcessingStartTime: 0,
  histogramProcessingEndTime: 0,
  extractFieldsStartTime: 0,
  extractFieldsEndTime: 0,
  extractFieldsWithAPI: "",
});

const searchAggData = reactive({
  total: 0,
  hasAggregation: false,
});

let histogramResults: any = [];
let histogramMappedData: any = [];
const intervalMap: any = {
  "10 second": 10 * 1000 * 1000,
  "15 second": 15 * 1000 * 1000,
  "30 second": 30 * 1000 * 1000,
  "1 minute": 60 * 1000 * 1000,
  "5 minute": 5 * 60 * 1000 * 1000,
  "30 minute": 30 * 60 * 1000 * 1000,
  "1 hour": 60 * 60 * 1000 * 1000,
  "1 day": 24 * 60 * 60 * 1000 * 1000,
};

const useLogs = () => {
  const store = useStore();
  const { t } = useI18n();
  const $q = useQuasar();
  const { getAllFunctions } = useFunctions();
  const { showErrorNotification } = useNotifications();
  const { getStreams, getStream, getMultiStreams } = useStreams();
  const router = useRouter();
  let parser: any;
  const fieldValues = ref();
  const initialQueryPayload: Ref<LogsQueryPayload | null> = ref(null);
  const notificationMsg = ref("");

  const { updateFieldKeywords } = useSqlSuggestions();

  onBeforeMount(async () => {
    if (router.currentRoute.value.query?.quick_mode == "true") {
      searchObj.meta.quickMode = true;
    }
    await importSqlParser();
  });

  const importSqlParser = async () => {
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    parser = await sqlParser();
  };

  searchObj.organizationIdetifier = store.state.selectedOrganization.identifier;
  const resetSearchObj = () => {
    // searchObj = reactive(Object.assign({}, defaultObject));
    searchObj.data.errorMsg = "No stream found in selected organization!";
    searchObj.data.stream.streamLists = [];
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.queryResults = {};
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
    searchObj.data.tempFunctionContent = "";
    searchObj.data.query = "";
    searchObj.data.editorValue = "";
    searchObj.meta.sqlMode = false;
    searchObj.runQuery = false;
    searchObj.data.savedViews = [];
  };

  const updatedLocalLogFilterField = (): void => {
    const identifier: string = searchObj.organizationIdetifier || "default";
    const selectedFields: any =
      useLocalLogFilterField()?.value != null
        ? useLocalLogFilterField()?.value
        : {};
    const stream = searchObj.data.stream.selectedStream.sort().join("_");
    selectedFields[`${identifier}_${stream}`] =
      searchObj.data.stream.selectedFields;
    useLocalLogFilterField(selectedFields);
  };

  function resetFunctions() {
    store.dispatch("setFunctions", []);
    searchObj.data.transforms = [];
    searchObj.data.stream.functions = [];
    return;
  }

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

  function resetStreamData() {
    store.dispatch("resetStreams", {});
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.stream.selectedFields = [];
    searchObj.data.stream.filterField = "";
    searchObj.data.stream.addToFilter = "";
    searchObj.data.stream.functions = [];
    searchObj.data.stream.streamType =
      (router.currentRoute.value.query.stream_type as string) || "logs";
    searchObj.data.stream.streamLists = [];
    resetQueryData();
    resetSearchAroundData();
  }

  function resetQueryData() {
    // searchObj.data.queryResults = {};
    searchObj.data.sortedQueryResults = [];
    // searchObj.data.histogram = {
    //   xData: [],
    //   yData: [],
    //   chartParams: {},
    // };
    // searchObj.data.resultGrid.columns = [];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.runQuery = false;
    searchObj.data.errorMsg = "";
    searchObj.data.countErrorMsg = "";
  }

  function resetSearchAroundData() {
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.searchAround.size = 0;
  }

  async function loadStreamLists() {
    try {
      if (searchObj.data.streamResults.list.length > 0) {
        let lastUpdatedStreamTime = 0;

        let selectedStream: any[] = [];

        searchObj.data.stream.streamLists = [];
        let itemObj: {
          label: string;
          value: string;
        };
        // searchObj.data.streamResults.list.forEach((item: any) => {
        for (const item of searchObj.data.streamResults.list) {
          itemObj = {
            label: item.name,
            value: item.name,
          };

          searchObj.data.stream.streamLists.push(itemObj);

          // If isFirstLoad is true, then select the stream from query params
          if (router.currentRoute.value?.query?.stream == item.name) {
            selectedStream.push(itemObj.value);
          }
          if (
            !router.currentRoute.value?.query?.stream &&
            item.stats.doc_time_max >= lastUpdatedStreamTime
          ) {
            selectedStream = [];
            lastUpdatedStreamTime = item.stats.doc_time_max;
            selectedStream.push(itemObj.value);
          }
        }
        if (
          store.state.zoConfig.query_on_stream_selection == false ||
          router.currentRoute.value.query?.type == "stream_explorer"
        ) {
          searchObj.data.stream.selectedStream = selectedStream;
        }
      } else {
        searchObj.data.errorMsg = "No stream found in selected organization!";
      }
      return;
    } catch (e: any) {
      console.log("Error while loading stream list");
    }
  }

  async function loadStreamFileds(streamName: string) {
    try {
      if (streamName != "") {
        searchObj.loadingStream = true;
        return await getStream(
          streamName,
          searchObj.data.stream.streamType || "logs",
          true,
        ).then((res) => {
          searchObj.loadingStream = false;
          return res;
        });
      } else {
        searchObj.data.errorMsg = "No stream found in selected organization!";
      }
      return;
    } catch (e: any) {
      searchObj.loadingStream = false;
      console.log("Error while loading stream fields");
    }
  }

  const getStreamList = async () => {
    try {
      // commented below function as we are doing resetStreamData from all the places where getStreamList is called
      // resetStreamData();
      const streamType = searchObj.data.stream.streamType || "logs";
      const streamData: any = await getStreams(streamType, false);
      searchObj.data.streamResults["list"] = streamData.list;
      await nextTick();
      await loadStreamLists();
      return;
    } catch (e: any) {
      console.log("Error while getting stream list");
    }
  };

  const generateURLQuery = (isShareLink: boolean = false) => {
    const date = searchObj.data.datetime;

    const query: any = {};

    if (searchObj.data.stream.streamType) {
      query["stream_type"] = searchObj.data.stream.streamType;
    }

    if (
      searchObj.data.stream.selectedStream.length > 0 &&
      typeof searchObj.data.stream.selectedStream != "object"
    ) {
      query["stream"] = searchObj.data.stream.selectedStream.join(",");
    } else if (
      typeof searchObj.data.stream.selectedStream == "object" &&
      searchObj.data.stream.selectedStream.hasOwnProperty("value")
    ) {
      query["stream"] = searchObj.data.stream.selectedStream.value;
    } else {
      query["stream"] = searchObj.data.stream.selectedStream.join(",");
    }

    if (date.type == "relative") {
      if (isShareLink) {
        query["from"] = date.startTime;
        query["to"] = date.endTime;
      } else {
        query["period"] = date.relativeTimePeriod;
      }
    } else if (date.type == "absolute") {
      query["from"] = date.startTime;
      query["to"] = date.endTime;
    }

    query["refresh"] = searchObj.meta.refreshInterval;

    if (searchObj.data.query) {
      query["sql_mode"] = searchObj.meta.sqlMode;
      query["query"] = b64EncodeUnicode(searchObj.data.query);
    }

    if (
      searchObj.meta.toggleFunction &&
      searchObj.data.tempFunctionContent != ""
    ) {
      query["functionContent"] = b64EncodeUnicode(
        searchObj.data.tempFunctionContent,
      );
    }

    // TODO : Add type in query params for all types
    if (searchObj.meta.pageType !== "logs") {
      query["type"] = searchObj.meta.pageType;
    }

    query["defined_schemas"] = searchObj.meta.useUserDefinedSchemas;
    query["org_identifier"] = store.state.selectedOrganization.identifier;
    query["quick_mode"] = searchObj.meta.quickMode;
    query["show_histogram"] = searchObj.meta.showHistogram;
    // query["timezone"] = store.state.timezone;
    return query;
  };

  const updateUrlQueryParams = () => {
    const query = generateURLQuery(false);

    router.push({ query });
  };

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
    const filterCondition = searchObj.data.editorValue;
    const parsedSQL: any = parser.astify(
      "select * from stream where " + filterCondition,
    );
    searchObj.data.stream.filteredField = extractFilterColumns(
      parsedSQL?.where,
    );

    searchObj.data.filterErrMsg = "";
    searchObj.data.missingStreamMessage = "";
    searchObj.data.stream.missingStreamMultiStreamFilter = [];
    for (const fieldName of searchObj.data.stream.filteredField) {
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
      let query = searchObj.data.editorValue;
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
        aggs: {
          histogram:
            "select histogram(" +
            store.state.zoConfig.timestamp_column +
            ", '[INTERVAL]') AS zo_sql_key, count(*) AS zo_sql_num from \"[INDEX_NAME]\" [WHERE_CLAUSE] GROUP BY zo_sql_key ORDER BY zo_sql_key",
        },
      };

      if (
        config.isEnterprise == "true" &&
        store.state.zoConfig.super_cluster_enabled
      ) {
        req["regions"] = searchObj.meta.regions;
        req["clusters"] = searchObj.meta.clusters;
      }

      if (searchObj.data.stream.selectedStreamFields.length == 0) {
        const streamData: any = getStreams(
          searchObj.data.stream.streamType,
          true,
          true,
        );
        searchObj.data.stream.selectedStreamFields = streamData.schema;
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

        req.aggs.histogram = req.aggs.histogram.replaceAll(
          "[INTERVAL]",
          searchObj.meta.resultGrid.chartInterval,
        );
      } else {
        notificationMsg.value = "Invalid date format";
        return false;
      }

      if (searchObj.meta.sqlMode == true) {
        req.aggs.histogram = req.aggs.histogram.replace(
          "[INDEX_NAME]",
          searchObj.data.stream.selectedStream[0],
        );

        req.aggs.histogram = req.aggs.histogram.replace("[WHERE_CLAUSE]", "");

        searchObj.data.query = query;
        const parsedSQL: any = fnParsedSQL();
        const histogramParsedSQL: any = fnHistogramParsedSQL(
          req.aggs.histogram,
        );

        histogramParsedSQL.where = parsedSQL.where;

        let histogramQuery = parser.sqlify(histogramParsedSQL);
        histogramQuery = histogramQuery.replace(/`/g, '"');
        req.aggs.histogram = histogramQuery;

        if (!parsedSQL?.columns?.length) {
          notificationMsg.value = "No column found in selected stream.";
          return false;
        }

        // if (
        //   hasTimeStampColumn(parsedSQL.columns) &&
        //   parsedSQL.orderby == null
        // ) {
        //   // showErrorNotification("Order by clause is required in SQL mode");
        //   notificationMsg.value = "Order by clause is required in SQL mode";
        //   return false;
        // }

        // if (!hasTimeStampColumn(parsedSQL.columns)) {
        //   // showErrorNotification("Timestamp column is required in SQL mode");
        //   notificationMsg.value = "Timestamp column is required in SQL mode";
        //   return false;
        // }

        if (parsedSQL.limit != null) {
          req.query.size = parsedSQL.limit.value[0].value;

          if (parsedSQL.limit.seperator == "offset") {
            req.query.from = parsedSQL.limit.value[1].value || 0;
          }

          // parsedSQL.limit = null;

          query = parser.sqlify(parsedSQL);

          //replace backticks with \" for sql_mode
          query = query.replace(/`/g, '"');
          searchObj.data.queryResults.hits = [];
        }

        req.query.sql = query;
        req.query["sql_mode"] = "full";
        // delete req.aggs;
      } else {
        const parseQuery = query.split("|");
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
          whereClause = whereClause
            .replace(/=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " =")
            .replace(/>(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >")
            .replace(/<(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <");

          whereClause = whereClause
            .replace(/!=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
            .replace(/! =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
            .replace(/< =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <=")
            .replace(/> =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >=");

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

          req.query.sql = req.query.sql.replace(
            "[WHERE_CLAUSE]",
            " WHERE " + whereClause,
          );

          req.aggs.histogram = req.aggs.histogram.replace(
            "[WHERE_CLAUSE]",
            " WHERE " + whereClause,
          );
        } else {
          req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", "");
          req.aggs.histogram = req.aggs.histogram.replace("[WHERE_CLAUSE]", "");
        }

        req.query.sql = req.query.sql.replace(
          "[QUERY_FUNCTIONS]",
          queryFunctions,
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
          const preHistogramSQLQuery = req.aggs.histogram;
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

          req.aggs.histogram = req.aggs.histogram.replace(
            "[INDEX_NAME]",
            searchObj.data.stream.selectedStream[0],
          );
        }

        // const parsedSQL = parser.astify(req.query.sql);
        // const unparsedSQL = parser.sqlify(parsedSQL);
      }

      // in case of sql mode or disable histogram to get total records we need to set track_total_hits to true
      // because histogram query will not be executed
      // if (
      //   searchObj.data.resultGrid.currentPage == 1 &&
      //   (searchObj.meta.showHistogram === false || searchObj.meta.sqlMode)
      // ) {
      //   req.query.track_total_hits = true;
      // }

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
        if (
          !searchObj.meta.sqlMode &&
          searchObj.data.resultGrid.currentPage == 1
        ) {
          req.aggs.histogram = b64EncodeUnicode(req.aggs.histogram);
        }
      }

      updateUrlQueryParams();

      return req;
    } catch (e: any) {
      // showErrorNotification("Invalid SQL Syntax");
      console.log(e);
      notificationMsg.value =
        "An error occurred while constructing the search query.";
      return "";
    }
  }

  const isNonAggregatedQuery = (parsedSQL: any = null) => {
    return !parsedSQL?.limit;
  };

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

      if (searchObj.meta.sqlMode && parsedSQL == undefined) {
        searchObj.data.queryResults.error =
          "Error while search partition. Search query is invalid.";
        return;
      }

      if (
        !searchObj.meta.sqlMode ||
        (searchObj.meta.sqlMode && isNonAggregatedQuery(parsedSQL))
      ) {
        const partitionQueryReq: any = {
          sql: queryReq.query.sql,
          start_time: queryReq.query.start_time,
          end_time: queryReq.query.end_time,
          sql_mode: searchObj.meta.sqlMode ? "full" : "context",
        };
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

        if (parsedSQL != undefined && hasAggregation(parsedSQL?.columns)) {
          searchObj.data.queryResults.partitionDetail = {
            partitions: [],
            partitionTotal: [],
            paginations: [],
          };
          let pageObject: any = [];
          const partitions: any = [
            [partitionQueryReq.start_time, partitionQueryReq.end_time],
          ];
          searchObj.data.queryResults.partitionDetail.partitions = partitions;
          for (const [index, item] of partitions.entries()) {
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
        } else {
          const { traceparent, traceId } = generateTraceContext();

          addTraceId(traceId);

          await searchService
            .partition({
              org_identifier: searchObj.organizationIdetifier,
              query: partitionQueryReq,
              page_type: searchObj.data.stream.streamType,
              traceparent,
            })
            .then(async (res: any) => {
              searchObj.data.queryResults.partitionDetail = {
                partitions: [],
                partitionTotal: [],
                paginations: [],
              };

              // searchObj.data.queryResults.total = res.data.records;
              // const partitions = res.data.partitions;

              // searchObj.data.queryResults.partitionDetail.partitions =
              //   partitions;

              // let pageObject: any = [];
              // partitions.forEach((item: any, index: number) => {
              //   pageObject = [
              //     {
              //       startTime: item[0],
              //       endTime: item[1],
              //       from: 0,
              //       size: searchObj.meta.resultGrid.rowsPerPage,
              //     },
              //   ];
              //   searchObj.data.queryResults.partitionDetail.paginations.push(
              //     pageObject
              //   );
              //   searchObj.data.queryResults.partitionDetail.partitionTotal.push(-1);
              // });
              // for (const [index, item] of partitions.entries()) {
              //   pageObject = [
              //     {
              //       startTime: item[0],
              //       endTime: item[1],
              //       from: 0,
              //       size: searchObj.meta.resultGrid.rowsPerPage,
              //     },
              //   ];
              //   searchObj.data.queryResults.partitionDetail.paginations.push(
              //     pageObject
              //   );
              //   searchObj.data.queryResults.partitionDetail.partitionTotal.push(
              //     -1
              //   );
              // }
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
              } else {
                searchObj.data.queryResults.total = 0;
                // delete searchObj.data.histogram.chartParams.title;

                // generateHistogramData();
                const partitions = res.data.partitions;
                let pageObject = [];
                searchObj.data.queryResults.partitionDetail.partitions =
                  partitions;

                for (const [index, item] of partitions.entries()) {
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
                  searchObj.data.queryResults.partitionDetail.partitionTotal.push(
                    -1,
                  );
                }
              }
            })
            .catch((err: any) => {
              searchObj.loading = false;
              let trace_id = "";
              searchObj.data.errorMsg =
                "Error while processing partition request.";
              if (err.response != undefined) {
                searchObj.data.errorMsg = err.response.data.error;
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

              if (err?.request?.status >= 429) {
                notificationMsg.value = err?.response?.data?.message;
                searchObj.data.errorMsg = err?.response?.data?.message;
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
        }
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
        // searchObj.data.queryResults.partitionDetail.partitions.forEach(
        //   (item: any, index: number) => {
        //     pageObject = [
        //       {
        //         startTime: item[0],
        //         endTime: item[1],
        //         from: 0,
        //         size: searchObj.meta.resultGrid.rowsPerPage,
        //       },
        //     ];
        //     searchObj.data.queryResults.partitionDetail.paginations.push(
        //       pageObject
        //     );
        //     searchObj.data.queryResults.partitionDetail.partitionTotal.push(-1);
        //   }
        // );
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

  const refreshPartitionPagination = (regenrateFlag: boolean = false) => {
    try {
      const { rowsPerPage } = searchObj.meta.resultGrid;
      const { currentPage } = searchObj.data.resultGrid;
      const partitionDetail = searchObj.data.queryResults.partitionDetail;
      let remainingRecords = rowsPerPage;
      let lastPartitionSize = 0;

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
              (searchObj.meta.sqlMode && isNonAggregatedQuery(parsedSQL)))) ||
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
            searchObj.data.queryResults.total =
              searchObj.data.queryResults.aggs.reduce(
                (accumulator: number, currentValue: any) =>
                  accumulator +
                  Math.max(parseInt(currentValue.zo_sql_num, 10), 0),
                0,
              );
            partitionDetail.partitionTotal[0] =
              searchObj.data.queryResults.total;
          }
        } else {
          searchObj.data.queryResults.total =
            partitionDetail.partitionTotal.reduce(
              (accumulator: number, currentValue: number) =>
                accumulator + Math.max(currentValue, 0),
              0,
            );
        }
        // partitionDetail.partitions.forEach((item: any, index: number) => {
        for (const [index, item] of partitionDetail.partitions.entries()) {
          total = partitionDetail.partitionTotal[index];
          totalPages = Math.ceil(total / rowsPerPage);
          if (!partitionDetail.paginations[pageNumber]) {
            partitionDetail.paginations[pageNumber] = [];
          }
          if (totalPages > 0) {
            partitionFrom = 0;
            for (let i = 0; i < totalPages; i++) {
              remainingRecords = rowsPerPage;
              recordSize =
                i === totalPages - 1
                  ? total - partitionFrom || rowsPerPage
                  : rowsPerPage;
              from = partitionFrom;

              // if (i === 0 && partitionDetail.paginations.length > 0) {
              lastPartitionSize = 0;
              if (pageNumber > 0) {
                lastPage = partitionDetail.paginations.length - 1;

                // partitionDetail.paginations[lastPage].forEach((item: any) => {
                for (const item of partitionDetail.paginations[lastPage]) {
                  lastPartitionSize += item.size;
                }

                if (lastPartitionSize != rowsPerPage) {
                  recordSize = rowsPerPage - lastPartitionSize;
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

  const getQueryData = async (isPagination = false) => {
    try {
      // searchObj.data.histogram.chartParams.title = "";
      searchObjDebug["queryDataStartTime"] = performance.now();
      searchObj.meta.showDetailTab = false;
      searchObj.meta.searchApplied = true;
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
        const queryParams: any = router.currentRoute.value.query;
        const currentPeriod: string = queryParams?.period || "15m";
        const extractedDate: any = extractTimestamps(currentPeriod);
        searchObj.data.datetime.startTime = extractedDate.from;
        searchObj.data.datetime.endTime = extractedDate.to;
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
        if (
          searchObj.data.tempFunctionContent != "" &&
          searchObj.meta.toggleFunction
        ) {
          queryReq.query["query_fn"] = b64EncodeUnicode(
            searchObj.data.tempFunctionContent,
          );
        }

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

        searchObj.data.histogramQuery.query.sql =
          searchObj.data.histogramQuery.aggs.histogram;
        searchObj.data.histogramQuery.query.sql_mode = "full";

        // searchObj.data.histogramQuery.query.start_time =
        //   queryReq.query.start_time;

        // searchObj.data.histogramQuery.query.end_time =
        //   queryReq.query.end_time;

        delete searchObj.data.histogramQuery.query.quick_mode;
        delete searchObj.data.histogramQuery.query.from;

        // Removing sql_mode from histogram query, as it is not required
        //delete searchObj.data.histogramQuery.query.sql_mode;
        delete searchObj.data.histogramQuery.aggs;
        delete queryReq.aggs;
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
        searchObjDebug["paginatedDatawithAPIEndTime"] = performance.now();
        const parsedSQL: any = fnParsedSQL();

        if (
          (searchObj.data.queryResults.aggs == undefined &&
            searchObj.meta.refreshHistogram == true &&
            searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true &&
            searchObj.data.stream.selectedStream.length <= 1 &&
            (!searchObj.meta.sqlMode ||
              (searchObj.meta.sqlMode && isNonAggregatedQuery(parsedSQL)))) ||
          (searchObj.loadingHistogram == false &&
            searchObj.meta.showHistogram == true &&
            searchObj.meta.sqlMode == false &&
            searchObj.data.stream.selectedStream.length <= 1 &&
            searchObj.meta.refreshHistogram == true)
        ) {
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
                await getHistogramQueryData(searchObj.data.histogramQuery);
                if (partitions.length > 1) {
                  setTimeout(async () => {
                    await generateHistogramData();
                    refreshPartitionPagination(true);
                  }, 100);
                }
              }
              searchObj.loadingHistogram = false;
            }
          }
          await generateHistogramData();
          refreshPartitionPagination(true);
        } else if (searchObj.meta.sqlMode && !isNonAggregatedQuery(parsedSQL)) {
          searchObj.data.histogram = {
            xData: [],
            yData: [],
            chartParams: {
              title: getHistogramTitle(),
              unparsed_x_data: [],
              timezone: "",
            },
            errorCode: 0,
            errorMsg: "Histogram is not available for limit queries.",
            errorDetail: "",
          };
        } else {
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
              await getPageCount(queryReq);
              searchObjDebug["pagecountEndTime"] = performance.now();
            }, 0);
          }

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
      searchObj.loading = false;
      showErrorNotification(
        notificationMsg.value || "Error occurred during the search operation.",
      );
      notificationMsg.value = "";
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

  function generateHistogramSkeleton() {
    if (
      searchObj.data.queryResults.hasOwnProperty("aggs") &&
      searchObj.data.queryResults.aggs
    ) {
      histogramResults = [];
      histogramMappedData = [];
      const intervalMs: any =
        intervalMap[searchObj.meta.resultGrid.chartInterval];
      if (!intervalMs) {
        throw new Error("Invalid interval");
      }

      let date = new Date();
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
      for (
        let currentTime: any = startTime;
        currentTime < searchObj.data.customDownloadQueryObj.query.end_time;
        currentTime += intervalMs
      ) {
        date = new Date(currentTime / 1000); // Convert microseconds to milliseconds
        histogramResults.push({
          zo_sql_key: date.toISOString().slice(0, 19),
          zo_sql_num: 0,
        });
      }
    }
  }

  function hasAggregation(columns: any) {
    if (columns) {
      for (const column of columns) {
        if (column.expr && column.expr.type === "aggr_func") {
          return true; // Found aggregation function or non-null groupby property
        }
      }
    }
    return false; // No aggregation function or non-null groupby property found
  }

  function hasTimeStampColumn(columns: any) {
    for (const column of columns) {
      if (
        column.expr &&
        (column.expr.column === store.state.zoConfig.timestamp_column ||
          column.expr.column === "*" ||
          (column.expr.hasOwnProperty("args") &&
            column.expr?.args?.expr?.column ===
              store.state.zoConfig.timestamp_column) ||
          (column.hasOwnProperty("as") &&
            column.as === store.state.zoConfig.timestamp_column))
      ) {
        return true; // Found _timestamp column
      }
    }
    return false; // No aggregation function or non-null groupby property found
  }

  const fnParsedSQL = () => {
    try {
      const filteredQuery = searchObj.data.query
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");
      return parser.astify(filteredQuery);
    } catch (e: any) {
      return {
        columns: [],
        orderby: null,
        limit: null,
        groupby: null,
        where: null,
      };
    }
  };

  const fnHistogramParsedSQL = (query: string) => {
    try {
      const filteredQuery = query
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");
      return parser.astify(filteredQuery);
    } catch (e: any) {
      return {
        columns: [],
        orderby: null,
        limit: null,
        groupby: null,
        where: null,
      };
    }
  };

  const getPageCount = async (queryReq: any) => {
    return new Promise((resolve, reject) => {
      searchObj.data.countErrorMsg = "";
      queryReq.query.size = 0;
      delete queryReq.query.from;
      delete queryReq.query.quick_mode;
      queryReq.query["sql_mode"] = "full";

      queryReq.query.track_total_hits = true;

      const { traceparent, traceId } = generateTraceContext();
      addTraceId(traceId);

      searchService
        .search(
          {
            org_identifier: searchObj.organizationIdetifier,
            query: queryReq,
            page_type: searchObj.data.stream.streamType,
            traceparent,
          },
          "UI",
        )
        .then(async (res) => {
          // check for total records update for the partition and update pagination accordingly
          // searchObj.data.queryResults.partitionDetail.partitions.forEach(
          //   (item: any, index: number) => {
          searchObj.data.queryResults.scan_size = res.data.scan_size;
          searchObj.data.queryResults.took += res.data.took;
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

          let regeratePaginationFlag = false;
          if (res.data.hits.length != searchObj.meta.resultGrid.rowsPerPage) {
            regeratePaginationFlag = true;
          }
          // if total records in partition is greate than recordsPerPage then we need to update pagination
          // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
          refreshPartitionPagination(regeratePaginationFlag);
          searchObj.data.histogram.chartParams.title = getHistogramTitle();
          resolve(true);
        })
        .catch((err) => {
          searchObj.loading = false;
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

          if (err?.request?.status >= 429) {
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

  const getPaginatedData = async (
    queryReq: any,
    appendResult: boolean = false,
  ) => {
    return new Promise((resolve, reject) => {
      // // set track_total_hits true for first request of partition to get total records in partition
      // // it will be used to send pagination request
      // if (queryReq.query.from == 0) {
      //   queryReq.query.track_total_hits = true;
      // } else if (
      //   searchObj.data.queryResults.partitionDetail.partitionTotal[
      //     searchObj.data.resultGrid.currentPage - 1
      //   ] > -1 &&
      //   queryReq.query.hasOwnProperty("track_total_hits")
      // ) {
      //   delete queryReq.query.track_total_hits;
      // }

      if (searchObj.data.isOperationCancelled) {
        notificationMsg.value = "Search operation is cancelled.";
        searchObj.loading = false;
        searchObj.data.isOperationCancelled = false;
        return;
      }

      const parsedSQL: any = fnParsedSQL();
      searchObj.meta.resultGrid.showPagination = true;
      if (searchObj.meta.sqlMode == true) {
        if (parsedSQL.limit != null) {
          queryReq.query.size = parsedSQL.limit.value[0].value;
          searchObj.meta.resultGrid.showPagination = false;
          //searchObj.meta.resultGrid.rowsPerPage = queryReq.query.size;

          if (parsedSQL.limit.seperator == "offset") {
            queryReq.query.from = parsedSQL.limit.value[1].value || 0;
          }
          delete queryReq.query.track_total_hits;
        }

        // for group by query no need to get total.
        // if (parsedSQL.groupby != null || hasAggregation(parsedSQL.columns)) {
        //   searchObj.meta.resultGrid.showPagination = false;
        //   delete queryReq.query.track_total_hits;
        // }
      }

      const { traceparent, traceId } = generateTraceContext();
      addTraceId(traceId);

      searchService
        .search(
          {
            org_identifier: searchObj.organizationIdetifier,
            query: queryReq,
            page_type: searchObj.data.stream.streamType,
            traceparent,
          },
          "UI",
        )
        .then(async (res) => {
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

          searchAggData.total = 0;
          searchAggData.hasAggregation = false;
          if (searchObj.meta.sqlMode == true) {
            if (
              hasAggregation(parsedSQL?.columns) ||
              parsedSQL.groupby != null
            ) {
              const parsedSQL: any = fnParsedSQL();
              searchAggData.total = res.data.total;
              searchAggData.hasAggregation = true;
              searchObj.meta.resultGrid.showPagination = false;
            }
          }

          let regeratePaginationFlag = false;
          if (res.data.hits.length != searchObj.meta.resultGrid.rowsPerPage) {
            regeratePaginationFlag = true;
          }
          // if total records in partition is greate than recordsPerPage then we need to update pagination
          // setting up forceFlag to true to update pagination as we have check for pagination already created more than currentPage + 3 pages.
          refreshPartitionPagination(regeratePaginationFlag);

          if (res.data.from > 0 || searchObj.data.queryResults.subpage > 1) {
            if (appendResult) {
              searchObj.data.queryResults.from += res.data.from;
              searchObj.data.queryResults.scan_size += res.data.scan_size;
              searchObj.data.queryResults.took += res.data.took;
              searchObj.data.queryResults.hits.push(...res.data.hits);
            } else {
              searchObj.data.queryResults.from = res.data.from;
              searchObj.data.queryResults.scan_size = res.data.scan_size;
              searchObj.data.queryResults.took = res.data.took;
              searchObj.data.queryResults.hits = res.data.hits;
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
              if (!queryReq.query.hasOwnProperty("track_total_hits")) {
                delete res.data.total;
              }
              searchObj.data.queryResults = {
                ...searchObj.data.queryResults,
                ...res.data,
              };
            }
          }

          // check for pagination request for the partition and check for subpage if we have to pull data from multiple partitions
          // it will check for subpage and if subpage is present then it will send pagination request for next partition
          if (
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

              searchObj.data.functionError = "";
              if (
                res.data.hasOwnProperty("function_error") &&
                res.data.function_error
              ) {
                searchObj.data.functionError = res.data.function_error;
              }
            }, 0);
            await getPaginatedData(queryReq, true);
          }

          await processPostPaginationData();

          searchObj.data.functionError = "";
          if (
            res.data.hasOwnProperty("function_error") &&
            res.data.function_error
          ) {
            searchObj.data.functionError = res.data.function_error;
          }

          searchObj.loading = false;
          searchObjDebug["paginatedDataReceivedEndTime"] = performance.now();

          resolve(true);
        })
        .catch((err) => {
          searchObj.loading = false;
          let trace_id = "";
          searchObj.data.errorMsg =
            typeof err == "string" && err
              ? err
              : "Error while processing histogram request.";
          if (err.response != undefined) {
            searchObj.data.errorMsg = err.response.data.error;
            if (err.response.data.hasOwnProperty("trace_id")) {
              trace_id = err.response.data?.trace_id;
            }
          } else {
            searchObj.data.errorMsg = err.message;
            if (err.hasOwnProperty("trace_id")) {
              trace_id = err?.trace_id;
            }
          }

          const customMessage = logsErrorMessage(err?.response?.data.code);
          searchObj.data.errorCode = err?.response?.data.code;

          if (customMessage != "") {
            searchObj.data.errorMsg = t(customMessage);
          }

          notificationMsg.value = searchObj.data.errorMsg;

          if (err?.request?.status >= 429) {
            notificationMsg.value = err?.response?.data?.message;
            searchObj.data.errorMsg = err?.response?.data?.message;
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

  const filterHitsColumns = () => {
    searchObj.data.queryResults.filteredHit = [];
    let itemHits: any = {};
    if (searchObj.data.stream.selectedFields.length > 0) {
      searchObj.data.queryResults.hits.map((hit: any) => {
        itemHits = {};
        // searchObj.data.stream.selectedFields.forEach((field) => {
        for (const field of searchObj.data.stream.selectedFields) {
          if (hit.hasOwnProperty(field)) {
            itemHits[field] = hit[field];
          }
        }
        itemHits[store.state.zoConfig.timestamp_column] =
          hit[store.state.zoConfig.timestamp_column];
        searchObj.data.queryResults.filteredHit.push(itemHits);
      });
    } else {
      searchObj.data.queryResults.filteredHit =
        searchObj.data.queryResults.hits;
    }
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
        return;
      }

      const dismiss = () => {};
      try {
        const { traceparent, traceId } = generateTraceContext();
        addTraceId(traceId);
        queryReq.query.size = -1;

        searchService
          .search(
            {
              org_identifier: searchObj.organizationIdetifier,
              query: queryReq,
              page_type: searchObj.data.stream.streamType,
              traceparent,
            },
            "UI",
          )
          .then(async (res: any) => {
            removeTraceId(traceId);
            searchObjDebug["histogramProcessingStartTime"] = performance.now();
            searchObj.loading = false;
            if (searchObj.data.queryResults.aggs == null) {
              searchObj.data.queryResults.aggs = [];
            }
            searchObj.data.queryResults.aggs.push(...res.data.hits);
            searchObj.data.queryResults.scan_size += res.data.scan_size;
            searchObj.data.queryResults.took += res.data.took;
            searchObj.data.queryResults.result_cache_ratio +=
              res.data.result_cache_ratio;

            queryReq.query.start_time =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][0].startTime;
            queryReq.query.end_time =
              searchObj.data.queryResults.partitionDetail.paginations[
                searchObj.data.resultGrid.currentPage - 1
              ][0].endTime;
            // if (hasAggregationFlag) {
            //   searchObj.data.queryResults.total = res.data.total;
            // }

            //searchObj.data.histogram.chartParams.title = getHistogramTitle();

            searchObjDebug["histogramProcessingEndTime"] = performance.now();
            searchObjDebug["histogramEndTime"] = performance.now();
            dismiss();
            resolve(true);
          })
          .catch((err) => {
            searchObj.loadingHistogram = false;
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

  const updateFieldValues = () => {
    try {
      const excludedFields = [
        store.state.zoConfig.timestamp_column,
        "log",
        "msg",
      ];
      // searchObj.data.queryResults.hits.forEach((item: { [x: string]: any }) => {
      for (const item of searchObj.data.queryResults.hits) {
        // Create set for each field values and add values to corresponding set
        // Object.keys(item).forEach((key) => {
        for (const key of Object.keys(item)) {
          if (excludedFields.includes(key)) {
            return;
          }

          if (fieldValues.value[key] == undefined) {
            fieldValues.value[key] = new Set();
          }

          if (!fieldValues.value[key].has(item[key])) {
            fieldValues.value[key].add(item[key]);
          }
        }
      }
    } catch (e: any) {
      console.log("Error while updating field values", e);
    }
  };

  const resetFieldValues = () => {
    fieldValues.value = {};
  };

  async function extractFields() {
    try {
      searchObjDebug["extractFieldsStartTime"] = performance.now();
      searchObjDebug["extractFieldsWithAPI"] = "";
      searchObj.data.errorMsg = "";
      searchObj.data.countErrorMsg = "";
      searchObj.data.stream.selectedStreamFields = [];
      searchObj.data.stream.interestingFieldList = [];
      const schemaFields: any = [];
      const commonSchemaFields: any = [];
      if (searchObj.data.streamResults.list.length > 0) {
        const timestampField = store.state.zoConfig.timestamp_column;
        const allField = store.state.zoConfig?.all_fields_name;
        const schemaInterestingFields: string[] = [];
        let userDefineSchemaSettings: any = [];
        const schemaMaps: any = [];
        const commonSchemaMaps: any = [];
        let schemaFieldsIndex: number = -1;
        let commonSchemaFieldsIndex: number = -1;
        let fieldObj: any = {};
        const localInterestingFields: any = useLocalInterestingFields();
        const streamInterestingFields: any = [];
        let streamInterestingFieldsLocal: any = [];

        const selectedStreamValues = searchObj.data.stream.selectedStream
          .join(",")
          .split(",");

        searchObj.data.stream.expandGroupRows = {
          common: true,
          ...Object.fromEntries(
            selectedStreamValues
              .sort()
              .map((stream: any) => [
                stream,
                searchObj.data.stream.expandGroupRows[stream] &&
                selectedStreamValues.length > 1
                  ? searchObj.data.stream.expandGroupRows[stream]
                  : selectedStreamValues.length > 1
                    ? false
                    : true,
              ]),
          ),
        };
        searchObj.data.stream.expandGroupRowsFieldCount = {
          common: 0,
          ...Object.fromEntries(
            selectedStreamValues.sort().map((stream: any) => [stream, 0]),
          ),
        };

        searchObj.data.datetime.queryRangeRestrictionMsg = "";
        searchObj.data.datetime.queryRangeRestrictionInHour = -1;
        for (const stream of searchObj.data.streamResults.list) {
          if (searchObj.data.stream.selectedStream.includes(stream.name)) {
            if (searchObj.data.stream.selectedStream.length > 1) {
              schemaMaps.push({
                name: convertToCamelCase(stream.name),
                label: true,
                ftsKey: false,
                isSchemaField: false,
                showValues: false,
                group: stream.name,
                isExpanded: false,
                streams: [stream.name],
                isInterestingField: false,
              });

              schemaFields.push("dummylabel");
              // searchObj.data.stream.expandGroupRowsFieldCount[stream.name] = searchObj.data.stream.expandGroupRowsFieldCount[stream.name] + 1;
            }

            userDefineSchemaSettings =
              stream.settings?.defined_schema_fields?.slice() || [];
            // check for schema exist in the object or not
            // if not pull the schema from server.
            if (!stream.hasOwnProperty("schema")) {
              searchObjDebug["extractFieldsWithAPI"] = " with API ";
              const streamData: any = await loadStreamFileds(stream.name);
              const streamSchema: any = streamData.schema;
              if (streamSchema == undefined) {
                searchObj.loadingStream = false;
                searchObj.data.errorMsg = t("search.noFieldFound");
                throw new Error(searchObj.data.errorMsg);
                return;
              }
              stream.settings = streamData.settings;
              stream.schema = streamSchema;
            }

            if (
              stream.settings.max_query_range > 0 &&
              (searchObj.data.datetime.queryRangeRestrictionInHour >
                stream.settings.max_query_range ||
                stream.settings.max_query_range == 0 ||
                searchObj.data.datetime.queryRangeRestrictionInHour == -1) &&
              searchObj.data.datetime.queryRangeRestrictionInHour != 0
            ) {
              searchObj.data.datetime.queryRangeRestrictionInHour =
                stream.settings.max_query_range;
              searchObj.data.datetime.queryRangeRestrictionMsg = t(
                "search.queryRangeRestrictionMsg",
                {
                  range:
                    searchObj.data.datetime.queryRangeRestrictionInHour > 1
                      ? searchObj.data.datetime.queryRangeRestrictionInHour +
                        " hours"
                      : searchObj.data.datetime.queryRangeRestrictionInHour +
                        " hour",
                },
              );
            }

            let environmentInterestingFields = [];
            if (
              store.state.zoConfig.hasOwnProperty("default_quick_mode_fields")
            ) {
              environmentInterestingFields =
                store.state?.zoConfig?.default_quick_mode_fields;
            }

            if (
              stream.settings.hasOwnProperty("defined_schema_fields") &&
              userDefineSchemaSettings.length > 0
            ) {
              searchObj.meta.hasUserDefinedSchemas = true;
              if (store.state.zoConfig.hasOwnProperty("timestamp_column")) {
                userDefineSchemaSettings.push(
                  store.state.zoConfig?.timestamp_column,
                );
              }

              if (store.state.zoConfig.hasOwnProperty("all_fields_name")) {
                userDefineSchemaSettings.push(
                  store.state.zoConfig?.all_fields_name,
                );
              }
            } else {
              searchObj.meta.hasUserDefinedSchemas =
                searchObj.meta.hasUserDefinedSchemas &&
                searchObj.data.stream.selectedStream.length > 1;
            }

            streamInterestingFieldsLocal =
              localInterestingFields.value != null &&
              localInterestingFields.value[
                searchObj.organizationIdetifier + "_" + stream.name
              ] !== undefined &&
              localInterestingFields.value[
                searchObj.organizationIdetifier + "_" + stream.name
              ].length > 0
                ? localInterestingFields.value[
                    searchObj.organizationIdetifier + "_" + stream.name
                  ]
                : environmentInterestingFields.length > 0
                  ? [...environmentInterestingFields]
                  : [...schemaInterestingFields];

            searchObj.data.stream.interestingFieldList.push(
              ...streamInterestingFieldsLocal,
            );

            const intField = new Set(
              searchObj.data.stream.interestingFieldList,
            );
            searchObj.data.stream.interestingFieldList = [...intField];

            // create a schema field mapping based on field name to avoid iteration over object.
            // in case of user defined schema consideration, loop will be break once all defined fields are mapped.
            let UDSFieldCount = 0;
            const fields: [string] =
              stream.settings?.defined_schema_fields &&
              searchObj.meta.useUserDefinedSchemas != "all_fields"
                ? [
                    store.state.zoConfig?.timestamp_column,
                    ...stream.settings?.defined_schema_fields,
                    store.state.zoConfig?.all_fields_name,
                  ]
                : stream.schema.map((obj: any) => obj.name);
            for (const field of fields) {
              fieldObj = {
                name: field,
                ftsKey:
                  stream.settings.full_text_search_keys.indexOf > -1
                    ? true
                    : false,
                isSchemaField: true,
                group: stream.name,
                streams: [stream.name],
                showValues: field !== timestampField && field !== allField,
                isInterestingField:
                  searchObj.data.stream.interestingFieldList.includes(field)
                    ? true
                    : false,
              };
              if (
                store.state.zoConfig.user_defined_schemas_enabled &&
                searchObj.meta.useUserDefinedSchemas == "user_defined_schema" &&
                stream.settings.hasOwnProperty("defined_schema_fields") &&
                userDefineSchemaSettings.length > 0
              ) {
                if (userDefineSchemaSettings.includes(field)) {
                  schemaFieldsIndex = schemaFields.indexOf(field);
                  commonSchemaFieldsIndex = commonSchemaFields.indexOf(field);
                  if (schemaFieldsIndex > -1) {
                    fieldObj.group = "common";

                    if (
                      schemaMaps[schemaFieldsIndex].hasOwnProperty("streams") &&
                      schemaMaps[schemaFieldsIndex].streams.length > 0
                    ) {
                      fieldObj.streams.push(
                        ...schemaMaps[schemaFieldsIndex].streams,
                      );
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        schemaMaps[schemaFieldsIndex].streams[0]
                      ] =
                        searchObj.data.stream.expandGroupRowsFieldCount[
                          schemaMaps[schemaFieldsIndex].streams[0]
                        ] - 1;
                    }

                    commonSchemaMaps.push(fieldObj);
                    commonSchemaFields.push(field);
                    searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        "common"
                      ] + 1;

                    //remove the element from the index
                    schemaFields.splice(schemaFieldsIndex, 1);
                    schemaMaps.splice(schemaFieldsIndex, 1);
                  } else if (commonSchemaFieldsIndex > -1) {
                    commonSchemaMaps[commonSchemaFieldsIndex].streams.push(
                      stream.name,
                    );
                    // searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                    //   searchObj.data.stream.expandGroupRowsFieldCount[
                    //     "common"
                    //   ] + 1;
                  } else {
                    schemaMaps.push(fieldObj);
                    schemaFields.push(field);
                    searchObj.data.stream.expandGroupRowsFieldCount[
                      stream.name
                    ] =
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        stream.name
                      ] + 1;
                  }

                  if (UDSFieldCount < userDefineSchemaSettings.length) {
                    UDSFieldCount++;
                  } else {
                    break;
                  }
                }

                // if (schemaMaps.length == userDefineSchemaSettings.length) {
                //   break;
                // }
              } else {
                schemaFieldsIndex = schemaFields.indexOf(field);
                commonSchemaFieldsIndex = commonSchemaFields.indexOf(field);
                if (schemaFieldsIndex > -1) {
                  fieldObj.group = "common";
                  if (
                    schemaMaps[schemaFieldsIndex].hasOwnProperty("streams") &&
                    schemaMaps[schemaFieldsIndex].streams.length > 0
                  ) {
                    fieldObj.streams.push(
                      ...schemaMaps[schemaFieldsIndex].streams,
                    );
                    searchObj.data.stream.expandGroupRowsFieldCount[
                      schemaMaps[schemaFieldsIndex].streams[0]
                    ] =
                      searchObj.data.stream.expandGroupRowsFieldCount[
                        schemaMaps[schemaFieldsIndex].streams[0]
                      ] - 1;
                  }

                  commonSchemaMaps.push(fieldObj);
                  commonSchemaFields.push(field);
                  searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                    searchObj.data.stream.expandGroupRowsFieldCount["common"] +
                    1;

                  //remove the element from the index
                  schemaFields.splice(schemaFieldsIndex, 1);
                  schemaMaps.splice(schemaFieldsIndex, 1);
                } else if (commonSchemaFieldsIndex > -1) {
                  commonSchemaMaps[commonSchemaFieldsIndex].streams.push(
                    stream.name,
                  );
                  // searchObj.data.stream.expandGroupRowsFieldCount["common"] =
                  //   searchObj.data.stream.expandGroupRowsFieldCount["common"] +
                  //   1;
                } else {
                  schemaMaps.push(fieldObj);
                  schemaFields.push(field);
                  searchObj.data.stream.expandGroupRowsFieldCount[stream.name] =
                    searchObj.data.stream.expandGroupRowsFieldCount[
                      stream.name
                    ] + 1;
                }
              }
            }

            if (
              searchObj.data.stream.selectedStream.length > 1 &&
              commonSchemaFields.length == 0
            ) {
              commonSchemaMaps.unshift({
                name: "Common Group Fields",
                label: true,
                ftsKey: false,
                isSchemaField: false,
                showValues: false,
                group: "common",
                isExpanded: false,
                streams: [stream.name],
                isInterestingField: false,
              });

              commonSchemaFields.unshift("dummylabel");
              // searchObj.data.stream.expandGroupRowsFieldCount["common"] = searchObj.data.stream.expandGroupRowsFieldCount["common"] + 1;
            }
            //here we check whether timestamp field is present or not
            //as we append timestamp dynamically for userDefined schema we need to check this
            if (
              userDefineSchemaSettings.includes(
                store.state.zoConfig?.timestamp_column,
              )
            ) {
              searchObj.data.hasSearchDataTimestampField = true;
            } else {
              searchObj.data.hasSearchDataTimestampField = false;
            }

            // check for user defined schema is false then only consider checking new fields from result set
            if (
              searchObj.data.queryResults.hasOwnProperty("hits") &&
              searchObj.data.queryResults?.hits.length > 0 &&
              searchObj.data.stream.selectedStream.length == 1 &&
              (!store.state.zoConfig.user_defined_schemas_enabled ||
                !searchObj.meta.hasUserDefinedSchemas)
            ) {
              // Find the index of the record with max attributes
              const maxAttributesIndex =
                searchObj.data.queryResults.hits.reduce(
                  (
                    maxIndex: string | number,
                    obj: {},
                    currentIndex: any,
                    array: { [x: string]: {} },
                  ) => {
                    const numAttributes = Object.keys(obj).length;
                    const maxNumAttributes = Object.keys(
                      array[maxIndex],
                    ).length;
                    return numAttributes > maxNumAttributes
                      ? currentIndex
                      : maxIndex;
                  },
                  0,
                );
              const recordwithMaxAttribute =
                searchObj.data.queryResults.hits[maxAttributesIndex];

              // Object.keys(recordwithMaxAttribute).forEach((key) => {
              for (const key of Object.keys(recordwithMaxAttribute)) {
                if (key == store.state.zoConfig.timestamp_column) {
                  searchObj.data.hasSearchDataTimestampField = true;
                }
                if (
                  !schemaFields.includes(key) &&
                  !commonSchemaFields.includes(key) &&
                  key != "_stream_name"
                ) {
                  fieldObj = {
                    name: key,
                    type: "Utf8",
                    ftsKey: false,
                    group: stream.name,
                    isSchemaField: false,
                    showValues: false,
                    isInterestingField:
                      searchObj.data.stream.interestingFieldList.includes(key)
                        ? true
                        : false,
                  };
                  schemaMaps.push(fieldObj);
                  schemaFields.push(key);
                }
              }
            }
            searchObj.data.stream.userDefinedSchema =
              userDefineSchemaSettings || [];
          }
        }

        // searchObj.data.stream.selectedStreamFields = schemaMaps;
        searchObj.data.stream.selectedStreamFields = [
          ...commonSchemaMaps,
          ...schemaMaps,
        ];
        if (
          searchObj.data.stream.selectedStreamFields != undefined &&
          searchObj.data.stream.selectedStreamFields.length
        )
          updateFieldKeywords(searchObj.data.stream.selectedStreamFields);
      }
      searchObjDebug["extractFieldsEndTime"] = performance.now();
    } catch (e: any) {
      searchObj.loadingStream = false;
      console.log("Error while extracting fields.", e);
      notificationMsg.value = "Error while extracting stream fields.";
    }
  }

  const updateGridColumns = () => {
    try {
      searchObj.data.resultGrid.columns = [];

      const logFilterField: any =
        useLocalLogFilterField()?.value != null
          ? useLocalLogFilterField()?.value
          : {};
      const logFieldSelectedValue: any = [];
      const stream = searchObj.data.stream.selectedStream.sort().join("_");
      if (
        logFilterField.length > 0 &&
        logFilterField[
          `${store.state.selectedOrganization.identifier}_${stream}`
        ] != undefined
      ) {
        logFieldSelectedValue.push(
          ...logFilterField[
            `${store.state.selectedOrganization.identifier}_${stream}`
          ],
        );
      }
      let selectedFields = (logFilterField && logFieldSelectedValue) || [];

      if (
        searchObj.data.stream.selectedFields.length == 0 &&
        selectedFields.length > 0
      ) {
        return (searchObj.data.stream.selectedFields = selectedFields);
      }

      // As in saved view, we observed field getting duplicated in selectedFields
      // So, we are removing duplicates before applying saved view
      if (searchObj.data.stream.selectedFields?.length) {
        selectedFields = [...new Set(searchObj.data.stream.selectedFields)];
      }

      const parsedSQL: any = fnParsedSQL();

      // By default when no fields are selected. Timestamp and Source will be visible. If user selects field, then only selected fields will be visible in table
      // In SQL and Quick mode.
      // If user adds timestamp manually then only we get it in response.
      // If we don’t add timestamp and add timestamp to table it should show invalid date.

      if (
        selectedFields.length == 0 ||
        !searchObj.data.queryResults?.hits?.length
      ) {
        searchObj.meta.resultGrid.manualRemoveFields = false;
        if (
          (searchObj.meta.sqlMode == true &&
            parsedSQL.hasOwnProperty("columns") &&
            searchObj.data.queryResults?.hits[0].hasOwnProperty(
              store.state.zoConfig.timestamp_column,
            )) ||
          searchObj.meta.sqlMode == false ||
          selectedFields.includes(store.state.zoConfig.timestamp_column)
        ) {
          searchObj.data.resultGrid.columns.push({
            name: store.state.zoConfig.timestamp_column,
            id: store.state.zoConfig.timestamp_column,
            accessorFn: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            prop: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            label: t("search.timestamp") + ` (${store.state.timezone})`,
            header: t("search.timestamp") + ` (${store.state.timezone})`,
            align: "left",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
            size: 260,
          });
        }

        if (selectedFields.length == 0) {
          searchObj.data.resultGrid.columns.push({
            name: "source",
            id: "source",
            accessorFn: (row: any) => JSON.stringify(row),
            cell: (info: any) => info.getValue(),
            header: "source",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
          });
        }
      } else {
        if (
          searchObj.data.hasSearchDataTimestampField ||
          selectedFields.includes(store.state.zoConfig.timestamp_column)
        ) {
          searchObj.data.resultGrid.columns.unshift({
            name: store.state.zoConfig.timestamp_column,
            id: store.state.zoConfig.timestamp_column,
            accessorFn: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            prop: (row: any) =>
              timestampToTimezoneDate(
                row[store.state.zoConfig.timestamp_column] / 1000,
                store.state.timezone,
                "yyyy-MM-dd HH:mm:ss.SSS",
              ),
            label: t("search.timestamp") + ` (${store.state.timezone})`,
            header: t("search.timestamp") + ` (${store.state.timezone})`,
            align: "left",
            sortable: true,
            enableResizing: false,
            meta: {
              closable: false,
              showWrap: false,
              wrapContent: false,
            },
            size: 260,
          });
        }

        let sizes: any;
        if (
          searchObj.data.resultGrid.colSizes &&
          searchObj.data.resultGrid.colSizes.hasOwnProperty(
            searchObj.data.stream.selectedStream,
          )
        ) {
          sizes =
            searchObj.data.resultGrid.colSizes[
              searchObj.data.stream.selectedStream
            ];
        }

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        for (const field of selectedFields) {
          if (field != store.state.zoConfig.timestamp_column) {
            let foundKey, foundValue;

            if (sizes?.length > 0) {
              Object.keys(sizes[0]).forEach((key) => {
                const trimmedKey = key
                  .replace(/^--(header|col)-/, "")
                  .replace(/-size$/, "");
                if (trimmedKey === field) {
                  foundKey = key;
                  foundValue = sizes[0][key];
                }
              });
            }

            searchObj.data.resultGrid.columns.push({
              name: field,
              id: field,
              accessorFn: (row: { [x: string]: any; source: any }) => {
                return byString(row, field);
              },
              header: field,
              sortable: true,
              enableResizing: true,
              meta: {
                closable: true,
                showWrap: true,
                wrapContent: false,
              },
              size: foundValue ? foundValue : getColumnWidth(context, field),
              maxSize: window.innerWidth,
            });
          }
        }
      }

      extractFTSFields();
    } catch (e: any) {
      searchObj.loadingStream = false;
      notificationMsg.value = "Error while updating table columns.";
    }
  };

  /**
   * Helper function to calculate width of the column based on its content(from first 5 rows)
   * @param context - Canvas Context to calculate width of column using its content
   * @param field - Field name for which width needs to be calculated
   * @returns - Width of the column
   */
  const getColumnWidth = (context: any, field: string) => {
    // Font of table header
    context.font = "bold 14px sans-serif";
    let max = context.measureText(field).width + 16;

    // Font of the table content
    context.font = "12px monospace";
    let width = 0;
    try {
      for (let i = 0; i < 5; i++) {
        if (searchObj.data.queryResults.hits?.[i]?.[field]) {
          width = context.measureText(
            searchObj.data.queryResults.hits[i][field],
          ).width;

          if (width > max) max = width;
        }
      }
    } catch (err) {
      console.log("Error while calculation column width");
    }

    max += 24; // 24px padding

    if (max > 800) return 800;

    if (max < 150) return 150;

    return max;
  };

  function getHistogramTitle() {
    try {
      const currentPage = searchObj.data.resultGrid.currentPage - 1 || 0;
      const startCount =
        currentPage * searchObj.meta.resultGrid.rowsPerPage + 1;
      let endCount;

      let totalCount = Math.max(
        searchObj.data.queryResults.hits.length,
        searchObj.data.queryResults.total,
      );
      if (searchObj.meta.resultGrid.showPagination == false) {
        endCount = searchObj.data.queryResults.hits.length;
        totalCount = searchObj.data.queryResults.hits.length;
      } else {
        if (
          currentPage >=
          searchObj.data.queryResults.partitionDetail.paginations.length - 1
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
        searchObj.data.queryResults.partitionDetail.partitions.length > 1 &&
        searchObj.meta.showHistogram == false
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
  }

  function generateHistogramData() {
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
      return true;
    } catch (e: any) {
      console.log("Error while generating histogram data", e);
      notificationMsg.value = "Error while generating histogram data.";
    }
  }

  const searchAroundData = (obj: any) => {
    try {
      searchObj.loading = true;
      searchObj.data.errorCode = 0;
      const sqlContext: any = [];
      let query_context: any = "";
      const query = searchObj.data.query;
      if (searchObj.meta.sqlMode == true) {
        const parsedSQL: any = parser.astify(query);
        //removing this change as datafusion not supporting *, _timestamp. It was working but now throwing error.
        //hack add time stamp column to parsedSQL if not already added
        // if (
        //   !(parsedSQL.columns === "*") &&
        //   parsedSQL.columns.filter(
        //     (e: any) => e.expr.column === store.state.zoConfig.timestamp_column
        //   ).length === 0
        // ) {
        //   const ts_col = {
        //     expr: {
        //       type: "column_ref",
        //       table: null,
        //       column: store.state.zoConfig.timestamp_column,
        //     },
        //     as: null,
        //   };
        //   parsedSQL.columns.push(ts_col);
        // }
        parsedSQL.where = null;
        sqlContext.push(
          b64EncodeUnicode(parser.sqlify(parsedSQL).replace(/`/g, '"')),
        );
      } else {
        const parseQuery = query.split("|");
        let queryFunctions = "";
        let whereClause = "";
        if (parseQuery.length > 1) {
          queryFunctions = "," + parseQuery[0].trim();
          whereClause = "";
        } else {
          whereClause = "";
        }
        query_context = `SELECT [FIELD_LIST]${queryFunctions} FROM "[INDEX_NAME]" `;

        if (!searchObj.meta.quickMode) {
          query_context = query_context.replace("[FIELD_LIST]", "*");
        }

        // const preSQLQuery = req.query.sql;
        const streamsData: any = searchObj.data.stream.selectedStream.filter(
          (streams: any) =>
            !searchObj.data.stream.missingStreamMultiStreamFilter.includes(
              streams,
            ),
        );

        let finalQuery: string = "";
        streamsData.forEach((item: any) => {
          finalQuery = query_context.replace("[INDEX_NAME]", item);

          const listOfFields: any = [];
          let streamField: any = {};
          for (const field of searchObj.data.stream.interestingFieldList) {
            for (streamField of searchObj.data.stream.selectedStreamFields) {
              if (
                streamField?.name == field &&
                streamField?.streams.indexOf(item) > -1
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
          sqlContext.push(b64EncodeUnicode(finalQuery));
        });
      }

      let query_fn: any = "";
      if (
        searchObj.data.tempFunctionContent != "" &&
        searchObj.meta.toggleFunction
      ) {
        query_fn = b64EncodeUnicode(searchObj.data.tempFunctionContent);
      }

      let streamName: string = "";
      if (searchObj.data.stream.selectedStream.length > 1) {
        streamName =
          b64EncodeUnicode(searchObj.data.stream.selectedStream.join(",")) ||
          "";
      } else {
        streamName = searchObj.data.stream.selectedStream[0];
      }

      const { traceparent, traceId } = generateTraceContext();
      addTraceId(traceId);

      searchService
        .search_around({
          org_identifier: searchObj.organizationIdetifier,
          index: streamName,
          key: obj.key,
          size: obj.size,
          query_context: sqlContext,
          query_fn: query_fn,
          stream_type: searchObj.data.stream.streamType,
          regions: searchObj.meta.hasOwnProperty("regions")
            ? searchObj.meta.regions.join(",")
            : "",
          clusters: searchObj.meta.hasOwnProperty("clusters")
            ? searchObj.meta.clusters.join(",")
            : "",
          is_multistream:
            searchObj.data.stream.selectedStream.length > 1 ? true : false,
          traceparent,
        })
        .then((res) => {
          searchObj.loading = false;
          searchObj.data.histogram.chartParams.title = "";
          if (res.data.from > 0) {
            searchObj.data.queryResults.from = res.data.from;
            searchObj.data.queryResults.scan_size += res.data.scan_size;
            searchObj.data.queryResults.took += res.data.took;
            searchObj.data.queryResults.hits.push(...res.data.hits);
          } else {
            searchObj.data.queryResults = res.data;
          }
          //extract fields from query response
          extractFields();
          generateHistogramSkeleton();
          generateHistogramData();
          //update grid columns
          updateGridColumns();
          filterHitsColumns();

          if (searchObj.meta.showHistogram) {
            searchObj.meta.showHistogram = false;
            searchObj.data.searchAround.histogramHide = true;
          }
          // segment.track("Button Click", {
          //   button: "Search Around Data",
          //   user_org: store.state.selectedOrganization.identifier,
          //   user_id: store.state.userInfo.email,
          //   stream_name: searchObj.data.stream.selectedStream.value,
          //   show_timestamp: obj.key,
          //   show_size: obj.size,
          //   show_histogram: searchObj.meta.showHistogram,
          //   sqlMode: searchObj.meta.sqlMode,
          //   showFields: searchObj.meta.showFields,
          //   page: "Search Logs - Search around data",
          // });

          // const visibleIndex =
          //   obj.size > 30 ? obj.size / 2 - 12 : obj.size / 2;
          // setTimeout(() => {
          //   searchResultRef.value.searchTableRef.scrollTo(
          //     visibleIndex,
          //     "start-force"
          //   );
          // }, 500);
        })
        .catch((err) => {
          let trace_id = "";
          searchObj.data.errorMsg = "Error while processing search request.";
          if (err.response != undefined) {
            searchObj.data.errorMsg = err.response.data.error;
            if (err.response.data.hasOwnProperty("trace_id")) {
              trace_id = err.response.data?.trace_id;
            }
          } else {
            searchObj.data.errorMsg = err.message;
            if (err.hasOwnProperty("trace_id")) {
              trace_id = err?.trace_id;
            }
          }

          const customMessage = logsErrorMessage(err.response.data.code);
          searchObj.data.errorCode = err.response.data.code;
          if (customMessage != "") {
            searchObj.data.errorMsg = customMessage;
          }

          if (err?.request?.status >= 429) {
            notificationMsg.value = err?.response?.data?.message;
            searchObj.data.errorMsg = err?.response?.data?.message;
          }

          if (trace_id) {
            searchObj.data.errorMsg +=
              " <br><span class='text-subtitle1'>TraceID:" +
              trace_id +
              "</span>";
            trace_id = "";
          }
        })
        .finally(() => {
          removeTraceId(traceId);
          searchObj.loading = false;
        });
    } catch (e: any) {
      searchObj.loading = false;
      showErrorNotification("Error while fetching data");
    }
  };

  const refreshData = () => {
    try {
      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "logs"
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
      await extractFields();
      await getQueryData();
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
      // searchObj.data.histogram.chartParams.title = ""
      await getQueryData();
    } catch (e: any) {
      console.log("Error while loading logs data");
    }
  };

  function extractTimestamps(period: string) {
    const currentTime = new Date();
    let fromTimestamp, toTimestamp;

    switch (period.slice(-1)) {
      case "m":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 60000; // 1 minute = 60000 milliseconds
        toTimestamp = currentTime.getTime();
        break;
      case "h":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 3600000; // 1 hour = 3600000 milliseconds
        toTimestamp = currentTime.getTime();
        break;
      case "d":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 86400000; // 1 day = 86400000 milliseconds
        toTimestamp = currentTime.getTime();
        break;
      case "w":
        fromTimestamp = currentTime.getTime() - parseInt(period) * 604800000; // 1 week = 604800000 milliseconds
        toTimestamp = currentTime.getTime();
        break;
      case "M":
        const currentMonth = currentTime.getMonth();
        const currentYear = currentTime.getFullYear();
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        const fromDate = new Date(prevYear, prevMonth, 1);
        fromTimestamp = fromDate.getTime();
        toTimestamp = currentTime.getTime();
        break;
      default:
        console.error("Invalid period format!");
        return;
    }

    return { from: fromTimestamp, to: toTimestamp };
  }

  const restoreUrlQueryParams = async () => {
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
    if (queryParams.refresh) {
      searchObj.meta.refreshInterval = parseInt(queryParams.refresh);
    }
    useLocalTimezone(queryParams.timezone);

    if (queryParams.functionContent) {
      searchObj.data.tempFunctionContent =
        b64DecodeUnicode(queryParams.functionContent) || "";
      searchObj.meta.functionEditorPlaceholderFlag = false;
      searchObj.meta.toggleFunction = true;
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
      searchObj.data.stream.selectedStream.push(
        ...queryParams.stream.split(","),
      );
    }

    if (queryParams.show_histogram) {
      searchObj.meta.showHistogram =
        queryParams.show_histogram == "true" ? true : false;
    }

    searchObj.shouldIgnoreWatcher = false;

    // TODO OK : Replace push with replace and test all scenarios
    router.push({
      query: {
        ...queryParams,
        sql_mode: searchObj.meta.sqlMode,
        defined_schemas: searchObj.meta.useUserDefinedSchemas,
      },
    });
  };

  const showNotification = () => {
    return $q.notify({
      type: "positive",
      message: "Waiting for response...",
      timeout: 10000,
      actions: [
        {
          icon: "cancel",
          color: "white",
          handler: () => {
            /* ... */
          },
        },
      ],
    });
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

  const ftsFields: any = ref([]);
  const extractFTSFields = () => {
    if (
      searchObj.data.stream.selectedStreamFields != undefined &&
      searchObj.data.stream.selectedStreamFields.length > 0
    ) {
      ftsFields.value = searchObj.data.stream.selectedStreamFields
        .filter((item: any) => item.ftsKey === true)
        .map((item: any) => item.name);
    }

    // if there is no FTS fields set by user then use default FTS fields
    if (ftsFields.value.length == 0) {
      ftsFields.value = store.state.zoConfig.default_fts_keys;
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
      searchObj.data.queryResults = {
        hits: [],
      };
      searchObj.data.stream.selectedStreamFields = [];

      let query = searchObj.meta.sqlMode
        ? queryStr != ""
          ? queryStr
          : `SELECT [FIELD_LIST] FROM "${searchObj.data.stream.selectedStream.join(
              ",",
            )}"`
        : "";

      searchObj.data.stream.selectedStreamFields = [];
      for (const stream of searchObj.data.stream.selectedStream) {
        const streamData: any = await getStream(
          stream,
          searchObj.data.stream.streamType || "logs",
          true,
        );

        if (streamData.schema != undefined) {
          searchObj.data.stream.selectedStreamFields.push(streamData.schema);
        }
      }

      if (
        searchObj.data.stream.selectedStreamFields == undefined ||
        searchObj.data.stream.selectedStreamFields.length == 0
      ) {
        searchObj.loadingStream = false;
        searchObj.data.errorMsg = t("search.noFieldFound");
        return;
      }
      const streamFieldNames: any = [];
      searchObj.data.stream.selectedStreamFields.forEach((subArray: any) => {
        subArray.forEach((item: any) => {
          streamFieldNames.push(item.name);
        });
      });

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

      if (queryStr == "") {
        if (
          searchObj.data.stream.interestingFieldList.length > 0 &&
          searchObj.meta.quickMode
        ) {
          query = query.replace(
            "[FIELD_LIST]",
            searchObj.data.stream.interestingFieldList.join(","),
          );
        } else {
          query = query.replace("[FIELD_LIST]", "*");
        }
      }

      searchObj.data.editorValue = query;
      searchObj.data.query = query;
      searchObj.data.tempFunctionContent = "";
      searchObj.meta.searchApplied = false;

      if (searchObj.data.stream.selectedStream.length > 1) {
        searchObj.meta.showHistogram = false;
      }

      if (store.state.zoConfig.query_on_stream_selection == false) {
        handleQueryData();
      } else {
        searchObj.data.stream.selectedStreamFields = [];
        searchObj.data.queryResults = {
          hits: [],
        };
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
        searchObj.loadingStream = false;
      }
    } catch (e: any) {
      searchObj.loadingStream = false;
      console.log("Error while getting stream data", e);
    }
  };

  const addOrderByToQuery = (
    sql: string,
    column: string,
    type: "ASC" | "DESC",
    streamName: string,
  ) => {
    // Parse the SQL query into an AST
    try {
      const parsedQuery: any = parser.astify(sql);

      if (!parsedQuery.columns.length || !parsedQuery.from) {
        return sql;
      }

      // Check for the presence of an ORDER BY clause
      const hasOrderBy = !!(
        parsedQuery.orderby && parsedQuery.orderby.length > 0
      );

      // Check if _timestamp is in the SELECT clause if not SELECT *
      const includesTimestamp = !!parsedQuery.columns.find(
        (col: any) => col?.expr?.column === column || col?.expr?.column === "*",
      );

      // If ORDER BY is present and doesn't include _timestamp, append it
      if (!hasOrderBy) {
        // If no ORDER BY clause, add it
        parsedQuery.orderby = [
          {
            expr: {
              type: "column_ref",
              table: null,
              column: column,
            },
            type: type,
          },
        ];
      }

      // Convert the AST back to a SQL string, replacing backtics with empty strings and table name with double quotes
      return quoteTableNameDirectly(
        parser.sqlify(parsedQuery).replace(/`/g, ""),
        streamName,
      );
    } catch (err) {
      return sql;
    }
  };

  function quoteTableNameDirectly(sql: string, streamName: string) {
    // This regular expression looks for the FROM keyword followed by
    // an optional schema name, a table name, and handles optional spaces.
    // It captures the table name to be replaced with double quotes.
    const regex = new RegExp(`FROM\\s+${streamName}`, "gi");

    // Replace the captured table name with the same name enclosed in double quotes
    const modifiedSql = sql.replace(regex, `FROM "${streamName}"`);

    return modifiedSql;
  }

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

  const addTraceId = (traceId: string) => {
    if (searchObj.data.searchRequestTraceIds.includes(traceId)) {
      return;
    }

    searchObj.data.searchRequestTraceIds.push(traceId);
  };

  const removeTraceId = (traceId: string) => {
    searchObj.data.searchRequestTraceIds =
      searchObj.data.searchRequestTraceIds.filter(
        (id: string) => id !== traceId,
      );
  };

  const cancelQuery = () => {
    const tracesIds = [...searchObj.data.searchRequestTraceIds];
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
            error.response?.data?.message || "Failed to cancel running query",
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

  return {
    searchObj,
    searchAggData,
    getStreams,
    resetSearchObj,
    resetStreamData,
    updatedLocalLogFilterField,
    getFunctions,
    getStreamList,
    fieldValues,
    extractFields,
    getQueryData,
    searchAroundData,
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
    fnParsedSQL,
    addOrderByToQuery,
    getRegionInfo,
    validateFilterForMultiStream,
    cancelQuery,
    reorderSelectedFields,
  };
};

export default useLogs;
