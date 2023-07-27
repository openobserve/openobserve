// Copyright 2022 Zinc Labs Inc. and Contributors

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
import { reactive, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";
import { Parser } from "node-sql-parser";

import {
  useLocalLogFilterField,
  b64EncodeUnicode,
  b64DecodeUnicode,
} from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { byString } from "@/utils/json";
import { logsErrorMessage } from "@/utils/common";
// import {
//   b64EncodeUnicode,
//   useLocalLogFilterField,
//   b64DecodeUnicode,
//   ooNotify,
// } from "@/utils/zincutils";

import useFunctions from "@/composables/useFunctions";
import useNotifications from "@/composables/useNotifications";
import useStreams from "@/composables/useStreams";

import searchService from "@/services/search";

const defaultObject = {
  organizationIdetifier: "",
  runQuery: false,
  loading: false,
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
    refreshInterval: <number>0,
    refreshIntervalLabel: "Off",
    showFields: true,
    showQuery: true,
    showHistogram: true,
    showDetailTab: false,
    toggleFunction: true,
    sqlMode: false,
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
        searchObj.data.streamResults.list.map((item: any) => {
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
            searchObj.data.stream.selectedStream = itemObj;
          } else {
            if (item.stats.doc_time_max >= lastUpdatedStreamTime) {
              lastUpdatedStreamTime = item.stats.doc_time_max;
              searchObj.data.stream.selectedStream = itemObj;
            }
          }
        });
      }
      return;
    } catch (e: any) {
      throw new Error(e.message);
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
      throw new Error(e.message);
    }
  };

  const updateUrlQueryParams = () => {
    const date = searchObj.data.datetime;

    const query: any = {
      stream: searchObj.data.stream.selectedStream.label,
      refresh: 0,
      org_identifier: "",
    };

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
        const parsedSQL: any = parser.astify(searchObj.data.query);
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

      if (searchObj.data.resultGrid.currentPage > 0) {
        delete req.aggs;
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
      throw new Error(e.message);
    }
  }

  const getQueryData = async () => {
    try {
      resetQueryData();
      if (searchObj.data.stream.selectedStream.value == "") {
        return false;
      }

      // if (searchObj.data.searchAround.histogramHide) {
      //   searchObj.data.searchAround.histogramHide = false;
      //   searchObj.meta.showHistogram = true;
      // }
      const queryReq = buildSearch();

      if (queryReq != null) {
        if (
          searchObj.data.tempFunctionContent != "" &&
          searchObj.meta.toggleFunction
        ) {
          queryReq.query["query_fn"] = b64EncodeUnicode(
            searchObj.data.tempFunctionContent
          );
        }

        searchObj.data.errorCode = 0;
        searchService
          .search({
            org_identifier: searchObj.organizationIdetifier,
            query: queryReq,
            page_type: searchObj.data.stream.streamType,
          })
          .then((res) => {
            if (res.data.from > 0) {
              searchObj.data.queryResults.from = res.data.from;
              searchObj.data.queryResults.scan_size += res.data.scan_size;
              searchObj.data.queryResults.took += res.data.took;
              searchObj.data.queryResults.hits.push(...res.data.hits);
            } else {
              resetFieldValues();
              searchObj.data.queryResults = res.data;
            }

            updateFieldValues();

            //extract fields from query response
            extractFields();

            generateHistogramData();
            //update grid columns
            updateGridColumns();
            searchObj.loading = false;
          })
          .catch((err) => {
            searchObj.loading = false;
            if (err.response != undefined) {
              searchObj.data.errorMsg = err.response.data.error + "114";
            } else {
              searchObj.data.errorMsg = err.message + "115";
            }
            const customMessage = logsErrorMessage(err.response.data.code);
            searchObj.data.errorCode = err.response.data.code;
            if (customMessage != "") {
              searchObj.data.errorMsg = t(customMessage) + "116";
            }
          });
      } else {
        searchObj.loading = false;
        return false;
      }
    } catch (e: any) {
      searchObj.loading = false;
      throw new Error(e.message);
    }
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
            ftsKeys = new Set([
              ...stream.settings.full_text_search_keys,
              ...ignoreFields,
            ]);
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
      throw new Error(e.message);
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
          date.formatDate(
            Math.floor(row[store.state.zoConfig.timestamp_column] / 1000),
            "MMM DD, YYYY HH:mm:ss.SSS Z"
          ),
        prop: (row: any) =>
          date.formatDate(
            Math.floor(row[store.state.zoConfig.timestamp_column] / 1000),
            "MMM DD, YYYY HH:mm:ss.SSS Z"
          ),
        label: t("search.timestamp"),
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
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

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
            const histDate = new Date(bucket.zo_sql_key + "Z");
            xData.push(Math.floor(histDate.getTime()));
            yData.push(parseInt(bucket.zo_sql_num, 10));
          }
        );
      }

      const chartParams = {
        title:
          "Showing " +
          searchObj.data.queryResults.hits.length +
          " out of " +
          searchObj.data.queryResults.total.toLocaleString() +
          " hits in " +
          searchObj.data.queryResults.took +
          " ms. (Scan Size: " +
          searchObj.data.queryResults.scan_size +
          "MB)",
        unparsed_x_data: unparsed_x_data,
      };
      searchObj.data.histogram = { xData, yData, chartParams };
    } catch (e: any) {
      throw new Error(e.message);
    }
  }

  const searchAroundData = (obj: any) => {
    try {
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
            searchObj.data.errorMsg = err.response.data.error + "111";
          } else {
            searchObj.data.errorMsg = err.message + "112";
          }

          const customMessage = logsErrorMessage(err.response.data.code);
          searchObj.data.errorCode = err.response.data.code;
          if (customMessage != "") {
            searchObj.data.errorMsg = t(customMessage) + "113";
          }
        });
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  const refreshData = () => {
    if (
      searchObj.meta.refreshInterval > 0 &&
      router.currentRoute.value.name == "logs"
    ) {
      clearInterval(refreshIntervalID);
      refreshIntervalID = setInterval(() => {
        searchObj.loading = true;
        getQueryData();
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
      await resetSearchObj();
      resetFunctions();
      await getFunctions();
      await getStreamList();
      await getQueryData();
    } catch (e: any) {
      throw new Error(e.message);
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
      throw new Error(e.message);
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
  };
};

export default useLogs;
