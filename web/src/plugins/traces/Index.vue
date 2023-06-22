<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/attribute-hyphenation -->
<!-- eslint-disable vue/v-on-event-hyphenation -->
<template>
  <q-page class="tracePage" id="tracePage">
    <div id="tracesSecondLevel">
      <search-bar
        data-test="logs-search-bar"
        ref="searchBarRef"
        v-show="searchObj.data.stream.streamLists.length > 0"
        :key="searchObj.data.stream.streamLists.length"
        @searchdata="searchData"
      />
      <div
        id="tracesThirdLevel"
        class="row scroll traces-search-result-container"
        style="width: 100%"
        v-if="searchObj.data.stream.streamLists.length > 0"
      >
        <!-- Note: Splitter max-height to be dynamically calculated with JS -->
        <q-splitter
          v-model="searchObj.config.splitterModel"
          :limits="searchObj.config.splitterLimit"
          style="width: 100%"
        >
          <template #before v-if="searchObj.meta.showFields">
            <index-list
              data-test="logs-search-index-list"
              :key="searchObj.data.stream.streamLists"
            />
          </template>
          <template #separator>
            <q-avatar
              color="primary"
              text-color="white"
              size="20px"
              icon="drag_indicator"
              style="top: 10px"
            />
          </template>
          <template #after>
            <div
              v-if="
                searchObj.data.errorMsg !== '' && searchObj.loading == false
              "
            >
              <h5 class="text-center">
                <div
                  data-test="logs-search-result-not-found-text"
                  v-if="searchObj.data.errorCode == 0"
                >
                  Result not found.
                </div>
                <div
                  data-test="logs-search-error-message"
                  v-html="searchObj.data.errorMsg"
                ></div>
                <div
                  data-test="logs-search-error-20003"
                  v-if="parseInt(searchObj.data.errorCode) == 20003"
                >
                  <q-btn
                    no-caps
                    unelevated
                    size="sm"
                    bg-secondary
                    class="no-border bg-secondary text-white"
                    :to="
                      '/logstreams?dialog=' +
                      searchObj.data.stream.selectedStream.label
                    "
                    >Click here</q-btn
                  >
                  to configure a full text search field to the stream.
                </div>
                <br />
                <q-item-label>{{
                  searchObj.data.additionalErrorMsg
                }}</q-item-label>
              </h5>
            </div>
            <div v-else-if="searchObj.data.stream.selectedStream.label == ''">
              <h5
                data-test="logs-search-no-stream-selected-text"
                class="text-center"
              >
                No stream selected.
              </h5>
            </div>
            <div
              v-else-if="
                searchObj.data.queryResults.hasOwnProperty('total') &&
                searchObj.data.queryResults.hits.length == 0 &&
                searchObj.loading == false
              "
            >
              <h5 class="text-center">No result found.</h5>
            </div>
            <div
              data-test="logs-search-search-result"
              v-show="
                searchObj.data.queryResults.hasOwnProperty('total') &&
                !!searchObj.data.queryResults.hits.length
              "
            >
              <search-result
                ref="searchResultRef"
                @update:datetime="searchData"
                @update:scroll="getMoreData"
                @search:timeboxed="searchAroundData"
                @get:traceDetails="getTraceDetails"
              />
            </div>
          </template>
        </q-splitter>
      </div>
      <div v-else-if="searchObj.loading == true">
        <q-spinner-dots
          color="primary"
          size="40px"
          style="margin: 0 auto; display: block"
        />
      </div>
      <div v-else>
        <h5 data-test="logs-search-error-message" class="text-center">
          <q-icon name="warning" color="warning" size="10rem" /><br />{{
            searchObj.data.errorMsg
          }}
        </h5>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  onMounted,
  onUpdated,
  ref,
  onDeactivated,
  onActivated,
} from "vue";
import { useQuasar, date } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import SearchBar from "./SearchBar.vue";
import IndexList from "./IndexList.vue";
import SearchResult from "./SearchResult.vue";
import useTraces from "@/composables/useTraces";
import { deepKeys, byString } from "@/utils/json";
import { Parser } from "node-sql-parser";

import streamService from "@/services/stream";
import searchService from "@/services/search";
import TransformService from "@/services/jstransform";
import {
  useLocalLogsObj,
  b64EncodeUnicode,
  useLocalTraceFilterField,
  verifyOrganizationStatus,
} from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { logsErrorMessage } from "@/utils/common";
import { number } from "@intlify/core-base";
import { stringLiteral } from "@babel/types";

export default defineComponent({
  name: "PageSearch",
  components: {
    SearchBar,
    IndexList,
    SearchResult,
  },
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        this.searchObj.runQuery = true;
      }

      if (config.isCloud == "true") {
        segment.track("Button Click", {
          button: "Search Data",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.searchObj.data.stream.selectedStream.value,
          show_query: this.searchObj.meta.showQuery,
          show_histogram: this.searchObj.meta.showHistogram,
          sqlMode: this.searchObj.meta.sqlMode,
          showFields: this.searchObj.meta.showFields,
          page: "Search Logs",
        });
      }
    },
    getMoreData() {
      if (
        this.searchObj.meta.refreshInterval == 0 &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.from &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.size &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.size +
            this.searchObj.data.queryResults.from
      ) {
        this.searchObj.loading = true;
        this.getQueryData();

        if (config.isCloud == "true") {
          segment.track("Button Click", {
            button: "Get More Data",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.searchObj.data.stream.selectedStream.value,
            page: "Search Logs",
          });
        }
      }
    },
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();
    const { t } = useI18n();
    const { searchObj, resetSearchObj } = useTraces();
    let dismiss = null;
    let refreshIntervalID = 0;
    const searchResultRef = ref(null);
    const searchBarRef = ref(null);
    const parser = new Parser();
    const tracesScatterChart = ref({});

    searchObj.organizationIdetifier =
      store.state.selectedOrganization.identifier;

    function ErrorException(message) {
      searchObj.loading = false;
      // searchObj.data.errorMsg = message;
      $q.notify({
        type: "negative",
        message: message,
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
    }

    function Notify() {
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
    }

    function getQueryTransform() {
      try {
        searchObj.data.stream.functions = [];
        TransformService.list(
          1,
          100000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier
        )
          .then((res) => {
            res.data.list.map((data: any) => {
              let args: any = [];
              for (let i = 0; i < parseInt(data.num_args); i++) {
                args.push("'${1:value}'");
              }

              let itemObj = {
                name: data.name,
                args: "(" + args.join(",") + ")",
              };
              if (!data.stream_name) {
                searchObj.data.stream.functions.push(itemObj);
              }
            });
          })
          .catch((err) => console.log(err));

        return;
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function getStreamList() {
      try {
        streamService
          .nameList(store.state.selectedOrganization.identifier, "traces", true)
          .then((res) => {
            searchObj.data.streamResults = res.data;

            if (res.data.list.length > 0) {
              if (config.isCloud == "true") {
                getQueryTransform();
              }

              //extract stream data from response
              loadStreamLists();
            } else {
              searchObj.loading = false;
              searchObj.data.errorMsg =
                "No stream found in selected organization!";
              searchObj.data.stream.streamLists = [];
              searchObj.data.stream.selectedStream = { label: "", value: "" };
              searchObj.data.stream.selectedStreamFields = [];
              searchObj.data.queryResults = {};
              searchObj.data.sortedQueryResults = [];
              searchObj.data.histogram = {
                layout: {},
                data: [],
              };
            }
          })
          .catch((e) => {
            searchObj.loading = false;
            $q.notify({
              type: "negative",
              message:
                "Error while pulling index for selected organization" +
                e.message,
              timeout: 2000,
            });
          });
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function loadStreamLists() {
      try {
        searchObj.data.stream.streamLists = [];
        searchObj.data.stream.selectedStream = { label: "", value: "" };
        if (searchObj.data.streamResults.list.length > 0) {
          let lastUpdatedStreamTime = 0;
          let selectedStreamItemObj = {};
          searchObj.data.streamResults.list.map((item: any) => {
            let itemObj = {
              label: item.name,
              value: item.name,
            };
            searchObj.data.stream.streamLists.push(itemObj);

            if (item.stats.doc_time_max >= lastUpdatedStreamTime) {
              lastUpdatedStreamTime = item.stats.doc_time_max;
              selectedStreamItemObj = itemObj;
            }
          });

          if (selectedStreamItemObj.label != undefined) {
            searchObj.data.stream.selectedStream = selectedStreamItemObj;
          } else {
            searchObj.loading = false;
            searchObj.data.queryResults = {};
            searchObj.data.sortedQueryResults = [];
            searchObj.data.stream.selectedStreamFields = [];
            searchObj.data.histogram = {
              layout: {},
              data: [],
            };
          }
        } else {
          searchObj.loading = false;
        }
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function getConsumableDateTime() {
      try {
        if (searchObj.data.datetime.tab == "relative") {
          let period = "";
          let periodValue = 0;
          // quasar does not support arithmetic on weeks. convert to days.

          if (
            searchObj.data.datetime.relative.period.label.toLowerCase() ==
            "weeks"
          ) {
            period = "days";
            periodValue = searchObj.data.datetime.relative.value * 7;
          } else {
            period =
              searchObj.data.datetime.relative.period.label.toLowerCase();
            periodValue = searchObj.data.datetime.relative.value;
          }
          const subtractObject = '{"' + period + '":' + periodValue + "}";

          let endTimeStamp = new Date();
          if (searchObj.data.resultGrid.currentPage > 0) {
            endTimeStamp = searchObj.data.resultGrid.currentDateTime;
          } else {
            searchObj.data.resultGrid.currentDateTime = endTimeStamp;
          }

          const startTimeStamp = date.subtractFromDate(
            endTimeStamp,
            JSON.parse(subtractObject)
          );

          return {
            start_time: startTimeStamp,
            end_time: endTimeStamp,
          };
        } else {
          let start, end;
          if (
            searchObj.data.datetime.absolute.date.from == "" &&
            searchObj.data.datetime.absolute.startTime == ""
          ) {
            start = new Date();
          } else {
            start = new Date(
              searchObj.data.datetime.absolute.date.from +
                " " +
                searchObj.data.datetime.absolute.startTime
            );
          }
          if (
            searchObj.data.datetime.absolute.date.to == "" &&
            searchObj.data.datetime.absolute.endTime == ""
          ) {
            end = new Date();
          } else {
            end = new Date(
              searchObj.data.datetime.absolute.date.to +
                " " +
                searchObj.data.datetime.absolute.endTime
            );
          }
          const rVal = {
            start_time: start,
            end_time: end,
          };
          return rVal;
        }
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    const getDefaultRequest = () => {
      return {
        query: {
          sql: `select min(${store.state.zoConfig.timestamp_column}) as ${store.state.zoConfig.timestamp_column}, min(start_time) as start_time, service_name, operation_name, count(span_id) as spans, max(duration) as duration, trace_id [QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE] group by trace_id, service_name, operation_name order by ${store.state.zoConfig.timestamp_column}`,
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
          from: 0,
          size: 0,
        },
        encoding: "base64",
      };
    };

    const getISOTimestamp = (date: any) => {
      return new Date(date.toISOString()).getTime() * 1000;
    };

    // Function to return {chartInterval : "1 day", chartKeyFormat : "YYYY-MM-DD"}
    const getChartSettings = (timestamps: {
      start_time: number | string;
      end_time: number | string;
    }) => {
      if (
        timestamps.start_time != "Invalid Date" &&
        timestamps.end_time != "Invalid Date"
      ) {
        const chartSettings = {
          chartInterval: "10 second",
          chartKeyFormat: "HH:mm:ss",
        };

        if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 30) {
          chartSettings.chartInterval = "15 second";
          chartSettings.chartKeyFormat = "HH:mm:ss";
        }
        if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 60) {
          chartSettings.chartInterval = "30 second";
          chartSettings.chartKeyFormat = "HH:mm:ss";
        }
        if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 2) {
          chartSettings.chartInterval = "1 minute";
          chartSettings.chartKeyFormat = "MM-DD HH:mm";
        }
        if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 6) {
          chartSettings.chartInterval = "5 minute";
          chartSettings.chartKeyFormat = "MM-DD HH:mm";
        }
        if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 24) {
          chartSettings.chartInterval = "30 minute";
          chartSettings.chartKeyFormat = "MM-DD HH:mm";
        }
        if (timestamps.end_time - timestamps.start_time >= 1000 * 86400 * 7) {
          chartSettings.chartInterval = "1 hour";
          chartSettings.chartKeyFormat = "MM-DD HH:mm";
        }
        if (timestamps.end_time - timestamps.start_time >= 1000 * 86400 * 30) {
          chartSettings.chartInterval = "1 day";
          chartSettings.chartKeyFormat = "YYYY-MM-DD";
        }
        return chartSettings;
      } else {
        return false;
      }
    };

    function buildSearch() {
      try {
        let query = searchObj.data.editorValue;
        var req = getDefaultRequest();
        req.query.from =
          searchObj.data.resultGrid.currentPage *
          searchObj.meta.resultGrid.rowsPerPage;
        req.query.size = parseInt(searchObj.meta.resultGrid.rowsPerPage, 10);

        var timestamps: any = getConsumableDateTime();
        req.query.start_time = getISOTimestamp(timestamps.start_time);
        req.query.end_time = getISOTimestamp(timestamps.end_time);

        const chartSettings = getChartSettings(timestamps);
        // if (chartSettings) {
        //   searchObj.meta.resultGrid.chartKeyFormat =
        //     chartSettings.chartKeyFormat;
        //   searchObj.meta.resultGrid.chartInterval = chartSettings.chartInterval;

        //   req.aggs.histogram = req.aggs.histogram.replaceAll(
        //     "[INTERVAL]",
        //     searchObj.meta.resultGrid.chartInterval
        //   );
        // }
        req.query["sql_mode"] = "full";

        let parseQuery = query.split("|");
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

        req.query.sql = b64EncodeUnicode(req.query.sql);

        return req;
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    const getTraceDetails = (trace: string) => {
      searchObj.meta.showTraceDetails = true;
      searchObj.data.traceDetails.loading = true;
      searchObj.data.traceDetails.spanList = [];
      const req = buildTraceSearchQuery(trace);
      delete req.aggs;

      searchService
        .search({
          org_identifier: searchObj.organizationIdetifier,
          query: req,
          page_type: "traces",
        })
        .then((res) => {
          searchObj.data.traceDetails.spanList = res.data?.hits || [];
        })
        .finally(() => {
          searchObj.data.traceDetails.loading = false;
        });
    };

    const buildTraceSearchQuery = (trace: string) => {
      const req = getDefaultRequest();
      req.query.from = 0;
      req.query.size = 1000;
      req.query.start_time = trace._timestamp - 30000000;
      req.query.end_time = trace._timestamp + 30000000;

      req.query.sql = b64EncodeUnicode(
        `SELECT * FROM ${searchObj.data.stream.selectedStream.value} WHERE trace_id = '${trace.trace_id}' ORDER BY start_time`
      );

      return req;
    };

    function getQueryData() {
      try {
        if (searchObj.data.stream.selectedStream.value == "") {
          return false;
        }

        searchObj.data.searchAround.indexTimestamp = 0;
        searchObj.data.searchAround.size = 0;
        if (searchObj.data.searchAround.histogramHide) {
          searchObj.data.searchAround.histogramHide = false;
          searchObj.meta.showHistogram = true;
        }

        searchObj.data.errorMsg = "";
        if (searchObj.data.resultGrid.currentPage == 0) {
          // searchObj.data.stream.selectedFields = [];
          // searchObj.data.stream.addToFilter = "";
          searchObj.data.queryResults = {};
          // searchObj.data.resultGrid.columns = [];
          searchObj.data.sortedQueryResults = [];
          // searchObj.data.streamResults = [];
          searchObj.data.histogram = {
            layout: {},
            data: [],
          };
          // searchObj.data.editorValue = "";
        }
        dismiss = Notify();

        const queryReq = buildSearch();

        if (queryReq == null) {
          dismiss();
          return false;
        }

        searchObj.data.errorCode = 0;
        searchService
          .search({
            org_identifier: searchObj.organizationIdetifier,
            query: queryReq,
            page_type: "traces",
          })
          .then((res) => {
            searchObj.loading = false;
            if (res.data.from > 0) {
              searchObj.data.queryResults.from = res.data.from;
              searchObj.data.queryResults.scan_size += res.data.scan_size;
              searchObj.data.queryResults.took += res.data.took;
              searchObj.data.queryResults.hits.push(...res.data.hits);
              // searchObj.data.queryResults.aggs.histogram.push(
              //   ...res.data.aggs.histogram
              // );
            } else {
              searchObj.data.queryResults = res.data;
            }

            //extract fields from query response
            extractFields();

            generateHistogramData();
            //update grid columns
            updateGridColumns();
            dismiss();
          })
          .catch((err) => {
            searchObj.loading = false;
            dismiss();
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

            // $q.notify({
            //   message: searchObj.data.errorMsg,
            //   color: "negative",
            // });
          });
      } catch (e) {
        throw new ErrorException("Request failed.");
      }
    }

    function extractFields() {
      try {
        searchObj.data.stream.selectedStreamFields = [];
        if (searchObj.data.streamResults.list.length > 0) {
          const queryResult = [];
          const tempFieldsName = [];
          const ignoreFields = [store.state.zoConfig.timestamp_column];
          let ftsKeys;

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
            let firstRecord = searchObj.data.queryResults.hits[0];

            Object.keys(firstRecord).forEach((key) => {
              if (!tempFieldsName.includes(key)) {
                queryResult.push({ name: key, type: "Utf8" });
              }
            });
          }
          const idFields = {
            trace_id: 1,
            span_id: 1,
            reference_parent_span_id: 1,
            reference_parent_trace_id: 1,
            start_time: 1,
          };
          const importantFields = {
            trace_id: 1,
            span_id: 1,
            reference_parent_span_id: 1,
            reference_parent_trace_id: 1,
            service_name: 1,
            operation_name: 1,
            start_time: 1,
          };

          // Ignoring timestamp as start time is present
          let fields: any = {};
          Object.keys(importantFields).forEach((rowName) => {
            if (fields[rowName] == undefined) {
              fields[rowName] = {};
              searchObj.data.stream.selectedStreamFields.push({
                name: rowName,
                ftsKey: ftsKeys.has(rowName),
                showValues: !idFields[rowName],
              });
            }
          });

          queryResult.forEach((row: any) => {
            // let keys = deepKeys(row);
            // for (let i in row) {
            if (
              !importantFields[row.name] &&
              !ignoreFields.includes(row.name)
            ) {
              if (fields[row.name] == undefined) {
                fields[row.name] = {};
                searchObj.data.stream.selectedStreamFields.push({
                  name: row.name,
                  ftsKey: ftsKeys.has(row.name),
                  showValues: !idFields[row.name],
                });
              }
            }
          });
        }
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function updateGridColumns() {
      try {
        searchObj.data.resultGrid.columns = [];

        searchObj.data.stream.selectedFields = [];

        searchObj.meta.resultGrid.manualRemoveFields = false;

        searchObj.data.resultGrid.columns.push({
          name: "@timestamp",
          field: (row: any) =>
            date.formatDate(
              Math.floor(row["start_time"] / 1000000),
              "MMM DD, YYYY HH:mm:ss.SSS Z"
            ),
          prop: (row: any) =>
            date.formatDate(
              Math.floor(row["start_time"] / 1000000),
              "MMM DD, YYYY HH:mm:ss.SSS Z"
            ),
          label: "Start Time",
          align: "left",
          sortable: true,
        });

        searchObj.data.resultGrid.columns.push({
          name: "operation_name",
          field: (row: any) => row.operation_name,
          prop: (row: any) => row.operation_name,
          label: "Operation",
          align: "left",
          sortable: true,
        });

        searchObj.data.resultGrid.columns.push({
          name: "service_name",
          field: (row: any) => row.service_name,
          prop: (row: any) => row.service_name,
          label: "Service",
          align: "left",
          sortable: true,
        });

        searchObj.data.resultGrid.columns.push({
          name: "duration",
          field: (row: any) => row.duration,
          prop: (row: any) => row.duration,
          label: "Duration",
          align: "left",
          sortable: true,
          format: (val) => formatTimeWithSuffix(val),
        });

        searchObj.loading = false;
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function formatTimeWithSuffix(ms) {
      if (ms < 1000) {
        return `${ms}ms`;
      } else {
        return `${(ms / 1000).toFixed(2)}s`;
      }
    }

    function generateHistogramData() {
      const unparsed_x_data: any[] = [];
      const xData: string[] = [];
      const yData: number[] = [];

      var trace1 = {
        x: xData,
        y: yData,
        name: "Trace",
        type: "scatter",
        mode: "markers",
        hovertemplate: "%{x} <br> %{y}", // hovertemplate for custom tooltip
      };

      var data = [trace1];

      var layout = {
        title: {
          text: "",
          font: {
            size: 12,
          },
        },
        margin: {
          l: 50,
          r: 50,
          t: 22,
          b: 50,
        },
        font: { size: 12 },
        xaxis: { type: "date" },
        yaxis: { ticksuffix: "ms" },
        scattergap: 0.7,
        height: 150,
        autosize: true,
      };

      if (searchObj.data.queryResults.hits) {
        searchObj.data.queryResults.hits.forEach(
          (bucket: {
            [store.state.zoConfig.timestamp_column]: string | number | Date;
            duration: number | Date;
          }) => {
            unparsed_x_data.push(bucket[store.state.zoConfig.timestamp_column]);
            let histDate = new Date(
              Math.floor(bucket[store.state.zoConfig.timestamp_column] / 1000)
            );
            xData.push(Math.floor(histDate.getTime()));
            yData.push(Number(bucket.duration.toFixed(2)));
          }
        );
      }

      // const totalRecords =
      //   (searchObj.data.resultGrid.currentPage + 1) *
      //     searchObj.meta.resultGrid.rowsPerPage <
      //   searchObj.data.queryResults.hits.length
      //     ? (searchObj.data.resultGrid.currentPage + 1) *
      //       searchObj.meta.resultGrid.rowsPerPage
      //     : searchObj.data.queryResults.hits.length;

      // layout.title.text =
      //   "Showing " +
      //   (searchObj.data.queryResults.from == 0
      //     ? searchObj.data.queryResults.size
      //     : totalRecords) +
      //   " out of " +
      //   searchObj.data.queryResults.total.toLocaleString() +
      //   " hits in " +
      //   searchObj.data.queryResults.took +
      //   " ms. (Scan Size: " +
      //   searchObj.data.queryResults.scan_size +
      //   "MB)";

      searchObj.data.histogram = {
        data: data,
        layout: layout,
      };

      if (
        searchObj.meta.showHistogram == true &&
        searchResultRef.value?.reDrawChart
      ) {
        searchResultRef.value.reDrawChart();
      }
    }

    function loadPageData() {
      searchObj.loading = true;
      searchObj.data.resultGrid.currentPage = 0;
      resetSearchObj();
      searchObj.organizationIdetifier =
        store.state.selectedOrganization.identifier;

      //get stream list
      getStreamList();
    }

    function refreshStreamData() {
      // searchObj.loading = true;
      // this.searchObj.data.resultGrid.currentPage = 0;
      // resetSearchObj();
      // searchObj.organizationIdetifier =
      //   store.state.selectedOrganization.identifier;
      // //get stream list
      // getStreamList();
    }

    onMounted(() => {
      if (searchObj.loading == false) {
        searchBarRef?.value?.setEditorValue("duration>10");
        loadPageData();
      }
    });

    onDeactivated(() => {
      clearInterval(refreshIntervalID);
    });

    onActivated(() => {
      if (
        searchObj.organizationIdetifier !=
        store.state.selectedOrganization.identifier
      ) {
        loadPageData();
      }

      if (
        searchObj.meta.showHistogram == true &&
        router.currentRoute.value.path.indexOf("/traces") > -1
      ) {
        setTimeout(() => {
          if (searchResultRef.value) searchResultRef.value.reDrawChart();
        }, 1500);
      }
    });

    const runQueryFn = () => {
      searchObj.data.resultGrid.currentPage = 0;
      searchObj.runQuery = false;
      getQueryData();
    };

    const setQuery = (sqlMode: boolean) => {
      if (sqlMode) {
        let selectFields = "";
        let whereClause = "";
        let currentQuery = searchObj.data.query;
        currentQuery = currentQuery.split("|");
        if (currentQuery.length > 1) {
          selectFields = "," + currentQuery[0].trim();
          if (currentQuery[1].trim() != "") {
            whereClause = "WHERE " + currentQuery[1].trim();
          }
        } else if (currentQuery[0].trim() != "") {
          if (currentQuery[0].trim() != "") {
            whereClause = "WHERE " + currentQuery[0].trim();
          }
        }
        searchObj.data.query =
          `SELECT *${selectFields} FROM "` +
          searchObj.data.stream.selectedStream.value +
          `" ` +
          whereClause;

        searchBarRef.value.udpateQuery();

        searchObj.data.parsedQuery = parser.astify(searchObj.data.query);
      } else {
        searchObj.data.query = "";
        searchBarRef.value.udpateQuery();
      }
    };

    const searchAroundData = (obj: any) => {
      try {
        dismiss = Notify();
        searchObj.data.errorCode = 0;
        searchService
          .search_around({
            org_identifier: searchObj.organizationIdetifier,
            index: searchObj.data.stream.selectedStream.value,
            key: obj.key,
            size: obj.size,
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
            segment.track("Button Click", {
              button: "Search Around Data",
              user_org: store.state.selectedOrganization.identifier,
              user_id: store.state.userInfo.email,
              stream_name: searchObj.data.stream.selectedStream.value,
              show_timestamp: obj.key,
              show_size: obj.size,
              show_histogram: searchObj.meta.showHistogram,
              sqlMode: searchObj.meta.sqlMode,
              showFields: searchObj.meta.showFields,
              page: "Search Logs - Search around data",
            });

            const visibleIndex =
              obj.size > 30 ? obj.size / 2 - 12 : obj.size / 2;
            setTimeout(() => {
              searchResultRef.value.searchTableRef.scrollTo(
                visibleIndex,
                "start-force"
              );
            }, 500);

            dismiss();
          })
          .catch((err) => {
            searchObj.loading = false;
            dismiss();
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

            // $q.notify({
            //   message: searchObj.data.errorMsg,
            //   color: "negative",
            // });
          });
      } catch (e) {
        throw new ErrorException("Request failed.");
      }
    };

    return {
      store,
      router,
      parser,
      searchObj,
      searchBarRef,
      loadPageData,
      getQueryData,
      searchResultRef,
      refreshStreamData,
      updateGridColumns,
      getConsumableDateTime,
      runQueryFn,
      setQuery,
      useLocalLogsObj,
      searchAroundData,
      getTraceDetails,
      verifyOrganizationStatus,
    };
  },
  computed: {
    showFields() {
      return this.searchObj.meta.showFields;
    },
    showHistogram() {
      return this.searchObj.meta.showHistogram;
    },
    showQuery() {
      return this.searchObj.meta.showQuery;
    },
    moveSplitter() {
      return this.searchObj.config.splitterModel;
    },
    changeOrganization() {
      return this.store.state.selectedOrganization.identifier;
    },
    changeStream() {
      return this.searchObj.data.stream.selectedStream;
    },
    changeRelativeDate() {
      return (
        this.searchObj.data.datetime.relative.value +
        this.searchObj.data.datetime.relative.period.value
      );
    },
    updateSelectedColumns() {
      return this.searchObj.data.stream.selectedFields.length;
    },
    runQuery() {
      return this.searchObj.runQuery;
    },
    fullSQLMode() {
      return this.searchObj.meta.sqlMode;
    },
  },
  watch: {
    showFields() {
      if (
        this.searchObj.meta.showHistogram == true &&
        this.searchObj.meta.sqlMode == false
      ) {
        setTimeout(() => {
          if (this.searchResultRef) this.searchResultRef.reDrawChart();
        }, 100);
      }
      if (this.searchObj.config.splitterModel > 0) {
        this.searchObj.config.lastSplitterPosition =
          this.searchObj.config.splitterModel;
      }

      this.searchObj.config.splitterModel = this.searchObj.meta.showFields
        ? this.searchObj.config.lastSplitterPosition
        : 0;
    },
    showHistogram() {
      if (
        this.searchObj.meta.showHistogram == true &&
        this.searchObj.meta.sqlMode == false
      ) {
        setTimeout(() => {
          if (this.searchResultRef) this.searchResultRef.reDrawChart();
        }, 100);
      }
    },
    moveSplitter() {
      if (this.searchObj.meta.showFields == false) {
        this.searchObj.meta.showFields =
          this.searchObj.config.splitterModel > 0;
      }
    },
    changeOrganization() {
      this.verifyOrganizationStatus(
        this.store.state.organizations,
        this.router
      );
      if (this.router.currentRoute.value.name == "logs") {
        this.searchObj.data.query = "";
        this.setQuery("");
        this.searchObj.meta.sqlMode = false;
        this.loadPageData();
      }
    },
    changeStream() {
      if (this.searchObj.data.stream.selectedStream.hasOwnProperty("value")) {
        setTimeout(() => {
          this.runQueryFn();
        }, 500);
      }
    },
    changeRelativeDate() {
      if (this.searchObj.data.datetime.tab == "relative") {
        this.runQueryFn();
      }
    },
    updateSelectedColumns() {
      this.searchObj.meta.resultGrid.manualRemoveFields = true;
      setTimeout(() => {
        this.updateGridColumns();
      }, 300);
    },
    runQuery() {
      if (this.searchObj.runQuery == true) {
        this.useLocalLogsObj({
          organizationIdentifier: this.searchObj.organizationIdetifier,
          runQuery: this.searchObj.runQuery,
          loading: this.searchObj.loading,
          config: this.searchObj.config,
          meta: this.searchObj.meta,
        });
        this.runQueryFn();
      }
    },
    fullSQLMode(newVal) {
      this.setQuery(newVal);
    },
  },
});
</script>

<style lang="scss" scoped>
.traces-search-result-container {
  height: calc(100vh - 168px) !important;
}
</style>
<style lang="scss">
div.plotly-notifier {
  visibility: hidden;
}
.tracePage {
  .index-menu .field_list .field_overlay .field_label,
  .q-field__native,
  .q-field__input,
  .q-table tbody td {
    font-size: 12px !important;
  }

  .q-splitter__after {
    overflow: hidden;
  }

  .q-item__label span {
    /* text-transform: capitalize; */
  }

  .index-table :hover::-webkit-scrollbar,
  #tracesSearchGridComponent:hover::-webkit-scrollbar {
    height: 13px;
    width: 13px;
  }

  .index-table ::-webkit-scrollbar-track,
  #tracesSearchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 10px;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #tracesSearchGridComponent::-webkit-scrollbar-thumb {
    border-radius: 10px;
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.5);
  }

  .q-table__top {
    padding: 0px !important;
  }

  .q-table__control {
    width: 100%;
  }

  .q-field__control-container {
    padding-top: 0px !important;
  }
}
</style>
