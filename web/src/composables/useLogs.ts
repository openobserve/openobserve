// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { date, useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { reactive, ref, type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";
import { Parser } from "node-sql-parser/build/mysql";

import {
  useLocalLogFilterField,
  b64EncodeUnicode,
  b64DecodeUnicode,
  formatSizeFromMB,
  timestampToTimezoneDate,
  histogramDateTimezone,
  useLocalWrapContent,
} from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { byString } from "@/utils/json";
import { logsErrorMessage } from "@/utils/common";
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

const defaultObject = {
  organizationIdetifier: "",
  runQuery: false,
  loading: false,
  config: {
    splitterModel: 20,
    lastSplitterPosition: 0,
    splitterLimit: [0, 40],
    fnSplitterModel: 99.5,
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
    refreshInterval: <number>0,
    refreshIntervalLabel: "Off",
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    toggleFunction: false,
    toggleSourceWrap: useLocalWrapContent()
      ? JSON.parse(useLocalWrapContent())
      : false,
    histogramDirtyFlag: false,
    sqlMode: false,
    queryEditorPlaceholderFlag: true,
    functionEditorPlaceholderFlag: true,
    resultGrid: {
      wrapCells: false,
      manualRemoveFields: false,
      rowsPerPage: 150,
      chartInterval: "1 second",
      chartKeyFormat: "HH:mm:ss",
      navigation: {
        currentRowIndex: 0,
      },
    },
    scrollInfo: {},
    flagWrapContent: false,
  },
  data: {
    query: <any>"",
    parsedQuery: {},
    errorMsg: "",
    errorCode: 0,
    additionalErrorMsg: "",
    stream: {
      streamLists: <object[]>[],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: <object[]>[],
      selectedFields: <string[]>[],
      filterField: "",
      addToFilter: "",
      functions: <any>[],
      streamType: "logs",
    },
    resultGrid: {
      currentDateTime: new Date(),
      currentPage: 0,
      columns: <any>[],
    },
    transforms: <any>[],
    queryResults: <any>[],
    sortedQueryResults: <any>[],
    streamResults: <any>[],
    histogram: <any>{},
    editorValue: <any>"",
    datetime: <any>{
      startTime: 0,
      endTime: 0,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    searchAround: {
      indexTimestamp: 0,
      size: <number>10,
      histogramHide: false,
    },
    tempFunctionName: "",
    tempFunctionContent: "",
    tempFunctionLoading: false,
  },
};

const searchObj = reactive(Object.assign({}, defaultObject));

const useLogs = () => {
  const store = useStore();
  const { t } = useI18n();
  const $q = useQuasar();
  const { getAllFunctions } = useFunctions();
  const { showErrorNotification } = useNotifications();
  const { getStreams } = useStreams();
  const router = useRouter();
  const parser = new Parser();
  const fieldValues = ref();
  let refreshIntervalID: any = 0;
  const initialQueryPayload: Ref<LogsQueryPayload | null> = ref(null);

  const resetSearchObj = () => {
    // searchObj = reactive(Object.assign({}, defaultObject));
    searchObj.data.errorMsg = "No stream found in selected organization!";
    searchObj.data.stream.streamLists = [];
    searchObj.data.stream.selectedStream = { label: "", value: "" };
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.queryResults = {};
    searchObj.data.sortedQueryResults = [];
    searchObj.data.histogram = {
      xData: [],
      yData: [],
      chartParams: {},
    };
    searchObj.data.tempFunctionContent = "";
    searchObj.data.query = "";
    searchObj.meta.sqlMode = false;
    searchObj.runQuery = false;
  };

  const updatedLocalLogFilterField = (): void => {
    const identifier: string = searchObj.organizationIdetifier || "default";
    const selectedFields: any =
      useLocalLogFilterField()?.value != null
        ? useLocalLogFilterField()?.value
        : {};
    selectedFields[
      `${identifier}_${searchObj.data.stream.selectedStream.value}`
    ] = searchObj.data.stream.selectedFields;
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
    searchObj.data.stream.selectedStream = { label: "", value: "" };
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.stream.selectedFields = [];
    searchObj.data.stream.filterField = "";
    searchObj.data.stream.addToFilter = "";
    searchObj.data.stream.functions = [];
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.streamLists = [];
    resetQueryData();
    resetSearchAroundData();
  }

  function resetQueryData() {
    searchObj.data.queryResults = {};
    searchObj.data.sortedQueryResults = [];
    searchObj.data.histogram = {
      xData: [],
      yData: [],
      chartParams: {},
    };
    searchObj.data.resultGrid.columns = [];
    searchObj.data.resultGrid.currentPage = 0;
    searchObj.runQuery = false;
    searchObj.data.errorMsg = "";
  }

  function resetSearchAroundData() {
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.searchAround.size = 0;
  }

  function loadStreamLists() {
    try {
      if (searchObj.data.streamResults.list.length > 0) {
        let lastUpdatedStreamTime = 0;

        let selectedStream = { label: "", value: "" };

        searchObj.data.streamResults.list.forEach((item: any) => {
          const itemObj: {
            label: string;
            value: string;
          } = {
            label: item.name,
            value: item.name,
          };

          searchObj.data.stream.streamLists.push(itemObj);

          // If isFirstLoad is true, then select the stream from query params
          if (router.currentRoute.value?.query?.stream == item.name) {
            selectedStream = itemObj;
          }
          if (
            !router.currentRoute.value?.query?.stream &&
            item.stats.doc_time_max >= lastUpdatedStreamTime
          ) {
            lastUpdatedStreamTime = item.stats.doc_time_max;
            selectedStream = itemObj;
          }
        });
        searchObj.data.stream.selectedStream = selectedStream;
      } else {
        searchObj.data.errorMsg = "No stream found in selected organization!";
      }
      return;
    } catch (e: any) {
      console.log("Error while loading stream list");
    }
  }

  const getStreamList = async () => {
    try {
      resetStreamData();
      const streamType = searchObj.data.stream.streamType || "logs";
      const streamData = await getStreams(streamType, true);
      searchObj.data.streamResults = streamData;
      loadStreamLists();
      return;
    } catch (e: any) {
      console.log("Error while getting stream list");
    }
  };

  const updateUrlQueryParams = () => {
    const date = searchObj.data.datetime;

    const query: any = {};

    if (searchObj.data.stream.selectedStream.label) {
      query["stream"] = searchObj.data.stream.selectedStream.label;
    }

    if (date.type == "relative") {
      query["period"] = date.relativeTimePeriod;
    } else {
      query["from"] = date.startTime;
      query["to"] = date.endTime;
    }

    query["refresh"] = searchObj.meta.refreshInterval;

    if (searchObj.data.query) {
      query["sql_mode"] = searchObj.meta.sqlMode;
      query["query"] = b64EncodeUnicode(searchObj.data.query);
    }

    query["org_identifier"] = store.state.selectedOrganization.identifier;

    router.push({ query });
  };

  function buildSearch() {
    try {
      let query = searchObj.data.editorValue;
      const req: any = {
        query: {
          sql: 'select *[QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
          from: searchObj.data.queryResults?.hits?.length || 0,
          size: parseInt(
            (searchObj.data.queryResults?.hits?.length || 0) + 150,
            10
          ),
        },
        aggs: {
          histogram:
            "select histogram(" +
            store.state.zoConfig.timestamp_column +
            ", '[INTERVAL]') AS zo_sql_key, count(*) AS zo_sql_num from query GROUP BY zo_sql_key ORDER BY zo_sql_key",
        },
      };

      const timestamps: any =
        searchObj.data.datetime.type === "relative"
          ? getConsumableRelativeTime(
              searchObj.data.datetime.relativeTimePeriod
            )
          : cloneDeep(searchObj.data.datetime);

      if (
        timestamps.startTime != "Invalid Date" &&
        timestamps.endTime != "Invalid Date"
      ) {
        if (timestamps.startTime > timestamps.endTime) {
          showErrorNotification("Start time cannot be greater than end time");
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
          searchObj.meta.resultGrid.chartInterval
        );
      } else {
        return false;
      }

      if (searchObj.meta.sqlMode == true) {
        query = searchObj.data.query
          .split("\n")
          .filter((line: string) => !line.trim().startsWith("--"))
          .join("\n");
        const parsedSQL: any = parser.astify(query);
        if (parsedSQL.limit != null) {
          req.query.size = parsedSQL.limit.value[0].value;

          if (parsedSQL.limit.seperator == "offset") {
            req.query.from = parsedSQL.limit.value[1].value || 0;
          }

          parsedSQL.limit = null;

          query = parser.sqlify(parsedSQL);

          //replace backticks with \" for sql_mode
          query = query.replace(/`/g, '"');
          searchObj.loading = true;
          searchObj.data.queryResults.hits = [];
          searchObj.data.queryResults.total = 0;
        }

        req.query.sql = query;
        req.query["sql_mode"] = "full";
        delete req.aggs;
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
          searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
            parsedSQL.forEach((node: any, index: any) => {
              if (node == field.name) {
                node = node.replaceAll('"', "");
                parsedSQL[index] = '"' + node + '"';
              }
            });
          });

          whereClause = parsedSQL.join(" ");

          req.query.sql = req.query.sql.replace(
            "[WHERE_CLAUSE]",
            " WHERE " + whereClause
          );
        } else {
          req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", "");
        }

        req.query.sql = req.query.sql.replace(
          "[QUERY_FUNCTIONS]",
          queryFunctions
        );

        req.query.sql = req.query.sql.replace(
          "[INDEX_NAME]",
          searchObj.data.stream.selectedStream.value
        );
        // const parsedSQL = parser.astify(req.query.sql);
        // const unparsedSQL = parser.sqlify(parsedSQL);
        // console.log(unparsedSQL);
      }

      if (
        searchObj.data.resultGrid.currentPage > 0 ||
        searchObj.meta.showHistogram === false
      ) {
        delete req.aggs;

        if (searchObj.meta.showHistogram === false) {
          // delete searchObj.data.histogram;
          searchObj.data.histogram = { xData: [], yData: [], chartParams: {} };
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
          searchObj.data.resultGrid.currentPage == 0
        ) {
          req.aggs.histogram = b64EncodeUnicode(req.aggs.histogram);
        }
      }

      updateUrlQueryParams();

      return req;
    } catch (e: any) {
      showErrorNotification("Invalid SQL Syntax");
    }
  }

  const getQueryData = (isPagination = false) => {
    return new Promise((resolve, reject) => {
      let dismiss = () => {};
      try {
        searchObj.meta.showDetailTab = false;

        if (!searchObj.data.stream.streamLists?.length) {
          searchObj.loading = false;
          reject(false);
          return;
        }

        if (!isPagination) resetQueryData();

        // if (searchObj.data.searchAround.histogramHide) {
        //   searchObj.data.searchAround.histogramHide = false;
        //   searchObj.meta.showHistogram = true;
        // }
        const queryReq = buildSearch();

        if (queryReq != null) {
          if (
            searchObj.meta.refreshInterval > 0 &&
            router.currentRoute.value.name == "logs"
          ) {
            queryReq.query.from = 0;
          }

          if (
            searchObj.data.tempFunctionContent != "" &&
            searchObj.meta.toggleFunction
          ) {
            queryReq.query["query_fn"] = b64EncodeUnicode(
              searchObj.data.tempFunctionContent
            );
          }

          if (isPagination) dismiss = showNotification();

          if (searchObj.data.datetime.type === "relative") {
            if (!isPagination) initialQueryPayload.value = cloneDeep(queryReq);
            else {
              if (
                searchObj.meta.refreshInterval == 0 &&
                router.currentRoute.value.name == "logs" &&
                searchObj.data.queryResults.hasOwnProperty("hits")
              ) {
                queryReq.query.start_time =
                  initialQueryPayload.value?.query?.start_time;
                queryReq.query.end_time =
                  initialQueryPayload.value?.query?.end_time;
              }
            }
          }

          searchObj.data.errorCode = 0;
          searchService
            .search({
              org_identifier: searchObj.organizationIdetifier,
              query: queryReq,
              page_type: searchObj.data.stream.streamType,
            })
            .then((res) => {
              dismiss();
              if (res.data.from > 0) {
                searchObj.data.queryResults.from = res.data.from;
                searchObj.data.queryResults.scan_size += res.data.scan_size;
                searchObj.data.queryResults.took += res.data.took;
                searchObj.data.queryResults.hits.push(...res.data.hits);
              } else {
                resetFieldValues();
                if (
                  searchObj.meta.refreshInterval > 0 &&
                  router.currentRoute.value.name == "logs" &&
                  searchObj.data.queryResults.hasOwnProperty("hits")
                ) {
                  searchObj.data.queryResults.from = res.data.from;
                  searchObj.data.queryResults.scan_size = res.data.scan_size;
                  searchObj.data.queryResults.took = res.data.took;
                  searchObj.data.queryResults.aggs = res.data.aggs;
                  const lastRecordTimeStamp = parseInt(
                    searchObj.data.queryResults.hits[0]._timestamp
                  );
                  // searchObj.data.queryResults.hits = res.data.hits;
                  for (let i = 0; i < res.data.hits.length; i++) {
                    if (
                      lastRecordTimeStamp <
                      parseInt(res.data.hits[i]._timestamp)
                    ) {
                      searchObj.data.queryResults.hits.unshift(
                        res.data.hits[i]
                      );
                    }
                  }

                  searchObj.data.queryResults.hits =
                    searchObj.data.queryResults.hits.splice(0, 150);
                } else {
                  searchObj.data.queryResults = res.data;
                }
              }

              updateFieldValues();

              //extract fields from query response
              extractFields();

              if (!isPagination) generateHistogramData();
              else {
                searchObj.data.histogram.chartParams.title =
                  getHistogramTitle();
              }

              //update grid columns
              updateGridColumns();
              searchObj.loading = false;
              resolve(true);
            })
            .catch((err) => {
              searchObj.loading = false;
              if (err.response != undefined) {
                searchObj.data.errorMsg = err.response.data.error;
              } else {
                searchObj.data.errorMsg = err.message;
              }
              const customMessage = logsErrorMessage(err.response.data.code);
              searchObj.data.errorCode = err.response.data.code;
              if (customMessage != "") {
                searchObj.data.errorMsg = t(customMessage);
              }
              reject(false);
            });
        } else {
          dismiss();
          searchObj.loading = false;
          reject(false);
        }
      } catch (e: any) {
        dismiss();
        searchObj.loading = false;
        showErrorNotification("Error while fetching data");
        reject(false);
      }
    });
  };

  const updateFieldValues = () => {
    const excludedFields = [
      store.state.zoConfig.timestamp_column,
      "log",
      "msg",
    ];
    searchObj.data.queryResults.hits.forEach((item: { [x: string]: any }) => {
      // Create set for each field values and add values to corresponding set
      Object.keys(item).forEach((key) => {
        if (excludedFields.includes(key)) {
          return;
        }

        if (fieldValues.value[key] == undefined) {
          fieldValues.value[key] = new Set();
        }

        if (!fieldValues.value[key].has(item[key])) {
          fieldValues.value[key].add(item[key]);
        }
      });
    });
  };

  const resetFieldValues = () => {
    fieldValues.value = {};
  };

  function extractFields() {
    try {
      searchObj.data.stream.selectedStreamFields = [];
      if (searchObj.data.streamResults.list.length > 0) {
        const queryResult: { name: string; type: string }[] = [];
        const tempFieldsName: string[] = [];
        const ignoreFields = [store.state.zoConfig.timestamp_column];
        let ftsKeys: Set<any>;

        searchObj.data.streamResults.list.forEach((stream: any) => {
          if (searchObj.data.stream.selectedStream.value == stream.name) {
            queryResult.push(...stream.schema);
            ftsKeys = new Set([...stream.settings.full_text_search_keys]);
          }
        });

        queryResult.forEach((field: any) => {
          tempFieldsName.push(field.name);
        });

        if (searchObj.data.queryResults.hits.length > 0) {
          const firstRecord = searchObj.data.queryResults.hits[0];

          Object.keys(firstRecord).forEach((key) => {
            if (!tempFieldsName.includes(key)) {
              queryResult.push({ name: key, type: "Utf8" });
            }
          });
        }

        const fields: any = {};
        queryResult.forEach((row: any) => {
          // let keys = deepKeys(row);
          // for (let i in row) {
          if (fields[row.name] == undefined) {
            fields[row.name] = {};
            searchObj.data.stream.selectedStreamFields.push({
              name: row.name,
              ftsKey: ftsKeys.has(row.name),
            });
          }
          // }
        });
      }
    } catch (e: any) {
      console.log("Error while extracting fields");
    }
  }

  const updateGridColumns = () => {
    try {
      searchObj.data.resultGrid.columns = [];

      const logFilterField: any =
        useLocalLogFilterField()?.value != null
          ? useLocalLogFilterField()?.value
          : {};
      const logFieldSelectedValue =
        logFilterField[
          `${store.state.selectedOrganization.identifier}_${searchObj.data.stream.selectedStream.value}`
        ];
      const selectedFields = (logFilterField && logFieldSelectedValue) || [];
      if (
        !searchObj.data.stream.selectedFields.length &&
        selectedFields.length
      ) {
        return (searchObj.data.stream.selectedFields = selectedFields);
      }
      searchObj.data.stream.selectedFields = selectedFields;

      searchObj.data.resultGrid.columns.push({
        name: "@timestamp",
        field: (row: any) =>
          timestampToTimezoneDate(
            row[store.state.zoConfig.timestamp_column] / 1000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS"
          ),
        prop: (row: any) =>
          timestampToTimezoneDate(
            row[store.state.zoConfig.timestamp_column] / 1000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS"
          ),
        label: t("search.timestamp") + ` (${store.state.timezone})`,
        align: "left",
        sortable: true,
      });
      if (searchObj.data.stream.selectedFields.length == 0) {
        searchObj.meta.resultGrid.manualRemoveFields = false;
        if (searchObj.data.stream.selectedFields.length == 0) {
          searchObj.data.resultGrid.columns.push({
            name: "source",
            field: (row: any) => JSON.stringify(row),
            prop: (row: any) => JSON.stringify(row),
            label: "source",
            align: "left",
            sortable: true,
          });
        }
      } else {
        searchObj.data.stream.selectedFields.forEach((field: any) => {
          searchObj.data.resultGrid.columns.push({
            name: field,
            field: (row: { [x: string]: any; source: any }) => {
              return byString(row, field);
            },
            prop: (row: { [x: string]: any; source: any }) => {
              return byString(row, field);
            },
            label: field,
            align: "left",
            sortable: true,
            closable: true,
          });
        });
      }
      extractFTSFields();
      evaluateWrapContentFlag();
    } catch (e: any) {
      console.log("Error while updating grid columns");
    }
  };

  function getHistogramTitle() {
    const title =
      "Showing " +
      searchObj.data.queryResults.hits.length.toLocaleString() +
      " out of " +
      searchObj.data.queryResults.total.toLocaleString() +
      " hits in " +
      searchObj.data.queryResults.took +
      " ms. (Scan Size: " +
      formatSizeFromMB(searchObj.data.queryResults.scan_size) +
      ")";
    return title;
  }

  function generateHistogramData() {
    try {
      const unparsed_x_data: any[] = [];
      const xData: number[] = [];
      const yData: number[] = [];

      if (searchObj.data.queryResults.aggs) {
        searchObj.data.queryResults.aggs.histogram.map(
          (bucket: {
            zo_sql_key: string | number | Date;
            zo_sql_num: string;
          }) => {
            unparsed_x_data.push(bucket.zo_sql_key);
            // const histDate = new Date(bucket.zo_sql_key);
            xData.push(
              histogramDateTimezone(bucket.zo_sql_key, store.state.timezone)
            );
            // xData.push(Math.floor(histDate.getTime()))
            yData.push(parseInt(bucket.zo_sql_num, 10));
          }
        );
      }

      const chartParams = {
        title: getHistogramTitle(),
        unparsed_x_data: unparsed_x_data,
        timezone: store.state.timezone,
      };
      searchObj.data.histogram = { xData, yData, chartParams };
    } catch (e: any) {
      console.log("Error while generating histogram data");
    }
  }

  const searchAroundData = (obj: any) => {
    try {
      searchObj.loading = true;
      searchObj.data.errorCode = 0;
      let query_context: any = "";
      const query = searchObj.data.query;
      if (searchObj.meta.sqlMode == true) {
        const parsedSQL: any = parser.astify(query);
        //hack add time stamp column to parsedSQL if not already added
        if (
          !(parsedSQL.columns === "*") &&
          parsedSQL.columns.filter(
            (e: any) => e.expr.column === store.state.zoConfig.timestamp_column
          ).length === 0
        ) {
          const ts_col = {
            expr: {
              type: "column_ref",
              table: null,
              column: store.state.zoConfig.timestamp_column,
            },
            as: null,
          };
          parsedSQL.columns.push(ts_col);
        }
        parsedSQL.where = null;
        query_context = b64EncodeUnicode(
          parser.sqlify(parsedSQL).replace(/`/g, '"')
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
        query_context =
          `SELECT *${queryFunctions} FROM "` +
          searchObj.data.stream.selectedStream.value +
          `" `;
        query_context = b64EncodeUnicode(query_context);
      }

      let query_fn: any = "";
      if (
        searchObj.data.tempFunctionContent != "" &&
        searchObj.meta.toggleFunction
      ) {
        query_fn = b64EncodeUnicode(searchObj.data.tempFunctionContent);
      }

      searchService
        .search_around({
          org_identifier: searchObj.organizationIdetifier,
          index: searchObj.data.stream.selectedStream.value,
          key: obj.key,
          size: obj.size,
          query_context: query_context,
          query_fn: query_fn,
        })
        .then((res) => {
          searchObj.loading = false;
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
          generateHistogramData();
          //update grid columns
          updateGridColumns();

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
          if (err.response != undefined) {
            searchObj.data.errorMsg = err.response.data.error;
          } else {
            searchObj.data.errorMsg = err.message;
          }

          const customMessage = logsErrorMessage(err.response.data.code);
          searchObj.data.errorCode = err.response.data.code;
          if (customMessage != "") {
            searchObj.data.errorMsg = t(customMessage);
          }
        })
        .finally(() => (searchObj.loading = false));
    } catch (e: any) {
      searchObj.loading = false;
      showErrorNotification("Error while fetching data");
    }
  };

  const refreshData = () => {
    if (
      searchObj.meta.refreshInterval > 0 &&
      router.currentRoute.value.name == "logs"
    ) {
      clearInterval(refreshIntervalID);
      refreshIntervalID = setInterval(async () => {
        // searchObj.loading = true;
        await getQueryData(true);
        generateHistogramData();
        updateGridColumns();
        searchObj.meta.histogramDirtyFlag = true;
      }, searchObj.meta.refreshInterval * 1000);
      $q.notify({
        message: `Live mode is enabled. Only top ${searchObj.meta.resultGrid.rowsPerPage} results are shown.`,
        color: "positive",
        position: "top",
        timeout: 1000,
      });
    } else {
      clearInterval(refreshIntervalID);
    }
  };

  const loadLogsData = async () => {
    try {
      searchObj.loading = true;
      resetFunctions();
      await getFunctions();
      await getStreamList();
      await getQueryData();
      refreshData();
    } catch (e: any) {
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

  const handleRunQuery = async () => {
    try {
      searchObj.loading = true;
      await getQueryData();
    } catch (e: any) {
      console.log("Error while loading logs data");
    }
  };

  const restoreUrlQueryParams = async () => {
    const queryParams: any = router.currentRoute.value.query;
    if (!queryParams.stream) {
      return;
    }
    const date = {
      startTime: queryParams.from,
      endTime: queryParams.to,
      relativeTimePeriod: queryParams.period || null,
      type: queryParams.period ? "relative" : "absolute",
    };
    if (date) {
      searchObj.data.datetime = date;
    }
    if (queryParams.query) {
      searchObj.meta.sqlMode = queryParams.sql_mode == "true" ? true : false;
      searchObj.data.editorValue = b64DecodeUnicode(queryParams.query);
      searchObj.data.query = b64DecodeUnicode(queryParams.query);
    }
    if (queryParams.refresh) {
      searchObj.meta.refreshInterval = queryParams.refresh;
    }

    router.push({
      query: {
        ...queryParams,
        from: date.startTime,
        to: date.endTime,
        period: date.relativeTimePeriod,
        sql_mode: searchObj.meta.sqlMode,
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
      const streams = await getStreams(streamType, true);
      searchObj.data.streamResults = streams;
      searchObj.data.stream.streamLists = [];
      streams.list.map((item: any) => {
        const itemObj = {
          label: item.name,
          value: item.name,
        };
        searchObj.data.stream.streamLists.push(itemObj);
      });
    } else {
      loadLogsData();
    }
  };

  const ftsFields: any = ref([]);
  const extractFTSFields = () => {
    if (searchObj.data.stream.selectedStreamFields.length > 0) {
      ftsFields.value = searchObj.data.stream.selectedStreamFields
        .filter((item: any) => item.ftsKey === true)
        .map((item: any) => item.name);
    }

    // if there is no FTS fields set by user then use default FTS fields
    if (ftsFields.value.length == 0) {
      ftsFields.value = store.state.zoConfig.default_fts_keys;
    }
  };

  const evaluateWrapContentFlag = () => {
    // Initialize a flag to false
    let flag = false;

    // Iterate through the array of objects
    for (const item of searchObj.data.resultGrid.columns) {
      // Check if the item's name is 'source' (the static field)
      // if (item.name.toLowerCase() === "source") {
      //   flag = true; // Set the flag to true if 'source' exists
      // }
      // Check if the item's name is in the ftsFields array
      if (ftsFields.value.includes(item.name.toLowerCase())) {
        flag = true; // Set the flag to true if an ftsField exists
      }

      // If the flag is already true, no need to continue checking
      if (flag) {
        searchObj.meta.flagWrapContent = flag;
        break;
      }
    }

    searchObj.meta.flagWrapContent = flag;
  };

  return {
    searchObj,
    resetSearchObj,
    updatedLocalLogFilterField,
    getFunctions,
    getStreamList,
    fieldValues,
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
    evaluateWrapContentFlag,
  };
};

export default useLogs;
