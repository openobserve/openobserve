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
  <q-page class="logPage q-my-xs" id="logPage">
    <div id="secondLevel">
      <q-splitter
        class="logs-horizontal-splitter"
        v-model="splitterModel"
        horizontal
        style="height: 100%"
      >
        <template v-slot:before>
          <search-bar
            data-test="logs-search-bar"
            ref="searchBarRef"
            :fieldValues="fieldValues"
            :key="searchObj.data.stream.streamLists.length || 1"
            @searchdata="searchData"
          />
        </template>
        <template v-slot:after>
          <div
            id="thirdLevel"
            class="row scroll relative-position thirdlevel"
            style="width: 100%"
          >
            <!-- Note: Splitter max-height to be dynamically calculated with JS -->
            <q-splitter
              v-model="searchObj.config.splitterModel"
              :limits="searchObj.config.splitterLimit"
              style="width: 100%"
            >
              <template #before>
                <div class="relative-position">
                  <index-list
                    v-if="searchObj.meta.showFields"
                    data-test="logs-search-index-list"
                    :key="searchObj.data.stream.streamLists"
                  />
                  <q-btn
                    :icon="
                      searchObj.meta.showFields
                        ? 'chevron_left'
                        : 'chevron_right'
                    "
                    :title="
                      searchObj.meta.showFields
                        ? 'Collapse Fields'
                        : 'Open Fields'
                    "
                    dense
                    size="20px"
                    round
                    class="q-mr-xs field-list-collapse-btn"
                    color="primary"
                    :style="{
                      right: searchObj.meta.showFields ? '-20px' : '-24px',
                    }"
                    @click="collapseFieldList"
                  ></q-btn>
                </div>
              </template>
              <template #after>
                <div v-if="!areStreamsPresent && searchObj.loading == true">
                  <q-spinner-dots
                    color="primary"
                    size="40px"
                    style="margin: 0 auto; display: block"
                  />
                </div>
                <div v-else-if="!areStreamsPresent">
                  <h5 data-test="logs-search-error-message" class="text-center">
                    <q-icon
                      name="warning"
                      color="warning"
                      size="10rem"
                    /><br />{{ searchObj.data.errorMsg }}
                  </h5>
                </div>
                <template v-else>
                  <div
                    v-if="
                      searchObj.data.errorMsg !== '' &&
                      searchObj.loading == false
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
                  <div
                    v-else-if="searchObj.data.stream.selectedStream.label == ''"
                  >
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
                      searchObj.data.queryResults.hits.length !== 0
                    "
                  >
                    <search-result
                      ref="searchResultRef"
                      :expandedLogs="expandedLogs"
                      @update:datetime="searchData"
                      @update:scroll="getMoreData"
                      @search:timeboxed="searchAroundData"
                      @expandlog="toggleExpandLog"
                    />
                  </div>
                </template>
              </template>
            </q-splitter>
          </div>
        </template>
      </q-splitter>
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
  computed,
  onBeforeMount,
} from "vue";
import { useQuasar, date, is } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import SearchBar from "./SearchBar.vue";
import IndexList from "./IndexList.vue";
import SearchResult from "./SearchResult.vue";
import useLogs from "@/composables/useLogs";
import { deepKeys, byString } from "@/utils/json";
import { Parser } from "node-sql-parser";

import streamService from "@/services/stream";
import searchService from "@/services/search";
import TransformService from "@/services/jstransform";
import {
  useLocalLogsObj,
  b64EncodeUnicode,
  useLocalLogFilterField,
  b64DecodeUnicode,
} from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { logsErrorMessage } from "@/utils/common";
import {
  verifyOrganizationStatus,
  convertTimeFromMicroToMilli,
} from "@/utils/zincutils";
import {
  getQueryParamsForDuration,
  getDurationObjectFromParams,
} from "@/utils/date";
import { first } from "lodash-es";

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
        this.searchObj.meta.sqlMode == false &&
        this.searchObj.meta.refreshInterval == 0 &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.from &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.size &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.size +
            this.searchObj.data.queryResults.from
      ) {
        this.searchObj.data.resultGrid.currentPage =
          ((this.searchObj.data.queryResults?.hits?.length || 0) +
            ((this.searchObj.data.queryResults?.hits?.length || 0) + 150)) /
            150 -
          1;
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
    const { searchObj, resetSearchObj } = useLogs();
    let dismiss = null;
    let refreshIntervalID = 0;
    const searchResultRef = ref(null);
    const searchBarRef = ref(null);
    const parser = new Parser();
    const expandedLogs = ref({});

    const fieldValues = ref({});

    searchObj.organizationIdetifier =
      store.state.selectedOrganization.identifier;

    const getStreamType = computed(() => searchObj.data.stream.streamType);

    function ErrorException(message) {
      searchObj.loading = false;
      // searchObj.data.errorMsg = message;
      $q.notify({
        type: "negative",
        message: message,
        timeout: 10000,
        actions: [
          {
            icon: "close",
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
            icon: "close",
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
              searchObj.data.transforms.push({
                name: data.name,
                function: data.function,
              });
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

    function getStreamList(isFirstLoad = false) {
      try {
        const streamType = searchObj.data.stream.streamType || "logs";
        streamService
          .nameList(
            store.state.selectedOrganization.identifier,
            streamType,
            true
          )
          .then((res) => {
            searchObj.data.streamResults = res.data;

            if (res.data.list.length > 0) {
              getQueryTransform();

              //extract stream data from response
              loadStreamLists(isFirstLoad);
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
                xData: [],
                yData: [],
                chartParams: {},
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

    function loadStreamLists(isFirstLoad = false) {
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

            // If isFirstLoad is true, then select the stream from query params
            if (
              isFirstLoad &&
              router.currentRoute.value?.query?.stream == item.name
            ) {
              lastUpdatedStreamTime = item.stats.doc_time_max;
              selectedStreamItemObj = itemObj;
            }

            // If stream from query params dosent match the selected stream, then select the stream from last updated time
            if (
              item.stats.doc_time_max >= lastUpdatedStreamTime &&
              !(
                router.currentRoute.value.query?.stream &&
                selectedStreamItemObj.value &&
                router.currentRoute.value.query.stream ===
                  selectedStreamItemObj.value
              )
            ) {
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
              xData: [],
              yData: [],
              chartParams: {},
            };
            // reDrawGrid();
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
        if (searchObj.data.stream.streamType === "enrichment_tables") {
          const stream = searchObj.data.streamResults.list.find(
            (stream) =>
              stream.name === searchObj.data.stream.selectedStream.value
          );
          if (stream.stats) {
            return {
              start_time: new Date(
                convertTimeFromMicroToMilli(
                  stream.stats.doc_time_min - 300000000
                )
              ),
              end_time: new Date(
                convertTimeFromMicroToMilli(
                  stream.stats.doc_time_max + 300000000
                )
              ),
            };
          }
        }
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

    function buildSearch() {
      try {
        let query = searchObj.data.editorValue;

        var req: any = {
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

        var timestamps: any = getConsumableDateTime();
        if (
          timestamps.start_time != "Invalid Date" &&
          timestamps.end_time != "Invalid Date"
        ) {
          searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";

          const startISOTimestamp: any =
            new Date(timestamps.start_time.toISOString()).getTime() * 1000;
          const endISOTimestamp: any =
            new Date(timestamps.end_time.toISOString()).getTime() * 1000;
          // let timeRangeFilter: String =
          //   "(_timestamp >= [START_TIME] AND _timestamp < [END_TIME])";
          // // let timeRangeFilter: String =
          // //   "time_range(\"_timestamp\", '[START_TIME]','[END_TIME]')";
          // timeRangeFilter = timeRangeFilter.replace(
          //   "[START_TIME]",
          //   startISOTimestamp
          // );
          // timeRangeFilter = timeRangeFilter.replace(
          //   "[END_TIME]",
          //   endISOTimestamp
          // );

          // if (query.trim() != "") {
          //   query += " and " + timeRangeFilter;
          // } else {
          //   query = timeRangeFilter;
          // }

          req.query.start_time = startISOTimestamp;
          req.query.end_time = endISOTimestamp;

          searchObj.meta.resultGrid.chartInterval = "10 second";
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 30) {
            searchObj.meta.resultGrid.chartInterval = "15 second";
            searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 60) {
            searchObj.meta.resultGrid.chartInterval = "30 second";
            searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 2) {
            searchObj.meta.resultGrid.chartInterval = "1 minute";
            searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 6) {
            searchObj.meta.resultGrid.chartInterval = "5 minute";
            searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 3600 * 24) {
            searchObj.meta.resultGrid.chartInterval = "30 minute";
            searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 86400 * 7) {
            searchObj.meta.resultGrid.chartInterval = "1 hour";
            searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
          }
          if (
            timestamps.end_time - timestamps.start_time >=
            1000 * 86400 * 30
          ) {
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
          const parsedSQL = parser.astify(searchObj.data.query);
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
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function restoreUrlQueryParams() {
      const queryParams = router.currentRoute.value.query;
      const date = getDurationObjectFromParams(queryParams);
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
    }

    function updateUrlQueryParams() {
      const date = getQueryParamsForDuration(searchObj.data.datetime);
      const query = {
        stream: searchObj.data.stream.selectedStream.label,
      };
      if (date.period) {
        query["period"] = date.period;
      }
      if (date.from && date.to) {
        query["from"] = date.from;
        query["to"] = date.to;
      }
      query["refresh"] = searchObj.meta.refreshInterval;

      if (searchObj.data.query) {
        query["sql_mode"] = searchObj.meta.sqlMode;
        query["query"] = b64EncodeUnicode(searchObj.data.query);
      }

      query["org_identifier"] = store.state.selectedOrganization.identifier;

      router.push({ query });
    }

    function getQueryData() {
      try {
        if (searchObj.data.stream.selectedStream.value == "") {
          return false;
        }

        searchObj.data.searchAround.indexTimestamp = -1;
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
            xData: [],
            yData: [],
            chartParams: {},
          };
          // searchObj.data.editorValue = "";
        }
        dismiss = Notify();

        const queryReq = buildSearch();

        if (queryReq == null) {
          dismiss();
          return false;
        }

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
            page_type: getStreamType.value,
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
              resetFieldValues();
              searchObj.data.queryResults = res.data;
            }

            updateFieldValues(res.data.hits);

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

    const resetFieldValues = () => {
      fieldValues.value = {};
    };

    const updateFieldValues = (data) => {
      const excludedFields = [
        store.state.zoConfig.timestamp_column,
        "log",
        "msg",
      ];
      data.forEach((item) => {
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

          let fields: any = {};
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
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function updateGridColumns() {
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
          // if (searchObj.meta.resultGrid.manualRemoveFields == false) {
          //   searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
          //     if (
          //       (field.name == "log" &&
          //         searchObj.data.stream.selectedStreamFields.indexOf("log") ==
          //           -1) ||
          //       (field.name == "message" &&
          //         searchObj.data.stream.selectedStreamFields.indexOf(
          //           "message"
          //         ) == -1)
          //     ) {
          //       searchObj.data.stream.selectedFields.push(field.name);
          //     }
          //   });
          // }

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

        searchObj.loading = false;
        if (searchObj.data.queryResults.aggs) reDrawGrid();
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function generateHistogramData() {
      const unparsed_x_data: any[] = [];
      const xData: string[] = [];
      const yData: number[] = [];

      if (searchObj.data.queryResults.aggs) {
        searchObj.data.queryResults.aggs.histogram.map(
          (bucket: {
            zo_sql_key: string | number | Date;
            zo_sql_num: string;
          }) => {
            unparsed_x_data.push(bucket.zo_sql_key);
            let histDate = new Date(bucket.zo_sql_key + "Z");
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
      if (
        searchObj.meta.showHistogram == true &&
        searchObj.meta.sqlMode == false &&
        searchResultRef.value?.reDrawChart
      ) {
        searchResultRef.value.reDrawChart();
      }
    }

    function loadPageData(isFirstLoad: boolean = false) {
      searchObj.loading = true;
      searchObj.data.resultGrid.currentPage = 0;
      resetSearchObj();
      searchObj.organizationIdetifier =
        store.state.selectedOrganization.identifier;

      //get stream list
      getStreamList(isFirstLoad);
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

    onBeforeMount(() => {
      if (searchObj.loading == false) {
        loadPageData(true);
        restoreUrlQueryParams();
        refreshData();
      }
    });

    onMounted(() => {
      reDrawGrid();
    });

    onUpdated(() => {
      // loadPageData();
      reDrawGrid();
    });

    onDeactivated(() => {
      clearInterval(refreshIntervalID);
    });

    onActivated(() => {
      if (!searchObj.loading) updateStreams();
      refreshData();

      if (
        searchObj.organizationIdetifier !=
        store.state.selectedOrganization.identifier
      ) {
        loadPageData();
      }

      reDrawGrid();
      if (
        searchObj.meta.showHistogram == true &&
        searchObj.meta.sqlMode == false &&
        router.currentRoute.value.path.indexOf("/logs") > -1
      ) {
        setTimeout(() => {
          if (searchResultRef.value) searchResultRef.value.reDrawChart();
        }, 1500);
      }
    });

    const updateStreams = () => {
      if (searchObj.data.streamResults?.list?.length) {
        const streamType = searchObj.data.stream.streamType || "logs";
        streamService
          .nameList(
            store.state.selectedOrganization.identifier,
            streamType,
            true
          )
          .then((response: any) => {
            searchObj.data.streamResults = response.data;
            searchObj.data.stream.streamLists = [];
            response.data.list.map((item: any) => {
              let itemObj = {
                label: item.name,
                value: item.name,
              };
              searchObj.data.stream.streamLists.push(itemObj);
            });
          });
      } else {
        loadPageData(true);
      }
    };

    const reDrawGrid = () => {
      setTimeout(() => {
        let rect = {};
        const secondWrapperElement: any =
          document.getElementById("secondLevel");
        if (secondWrapperElement != null) {
          rect = secondWrapperElement.getBoundingClientRect();
          secondWrapperElement.style.height = `calc(100vh - ${Math.round(
            rect.top
          )}px)`;
        }

        const thirdWrapperElement: any = document.getElementById("thirdLevel");
        if (thirdWrapperElement != null) {
          rect = thirdWrapperElement.getBoundingClientRect();
          thirdWrapperElement.style.height = `calc(100vh - ${Math.round(
            rect.top
          )}px)`;
        }

        const GridElement: any = document.getElementById("searchGridComponent");
        if (GridElement != null) {
          rect = GridElement.getBoundingClientRect();
          GridElement.style.height = `calc(100vh - ${Math.round(rect.top)}px)`;
        }

        const FLElement = document.getElementById("fieldList");
        if (FLElement != null) {
          rect = FLElement.getBoundingClientRect();
          FLElement.style.height = `calc(100vh - ${Math.round(rect.top)}px)`;
        }

        const logPagesecondWrapperElement: any =
          document.getElementById("logPage");
        if (logPagesecondWrapperElement != null) {
          rect = logPagesecondWrapperElement.getBoundingClientRect();
          logPagesecondWrapperElement.style.height = `calc(100vh - ${Math.round(
            rect.top
          )}px)`;
          logPagesecondWrapperElement.style.minHeight = `calc(100vh - ${Math.round(
            rect.top + 20
          )}px)`;
        }
      }, 100);
    };

    const runQueryFn = () => {
      searchObj.data.resultGrid.currentPage = 0;
      searchObj.runQuery = false;
      expandedLogs.value = {};
      getQueryData();
    };

    const refreshData = () => {
      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "logs"
      ) {
        clearInterval(refreshIntervalID);
        refreshIntervalID = setInterval(() => {
          runQueryFn();
        }, parseInt(searchObj.meta.refreshInterval) * 1000);
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

    const setQuery = (sqlMode: boolean) => {
      if (!searchBarRef.value) {
        console.error("searchBarRef is null");
        return;
      }

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
        let query_context = "";
        let query = searchObj.data.query;
        if (searchObj.meta.sqlMode == true) {
          const parsedSQL: any = parser.astify(query);
          //hack add time stamp column to parsedSQL if not already added
          if (
            !(parsedSQL.columns === "*") &&
            parsedSQL.columns.filter(
              (e) => e.expr.column === store.state.zoConfig.timestamp_column
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
          let parseQuery = query.split("|");
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

        let query_fn = "";
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

    const collapseFieldList = () => {
      if (searchObj.meta.showFields) searchObj.meta.showFields = false;
      else searchObj.meta.showFields = true;
    };

    const areStreamsPresent = computed(() => {
      return !!searchObj.data.stream.streamLists.length;
    });

    const toggleExpandLog = async (index: number) => {
      if (expandedLogs.value[index.toString()])
        delete expandedLogs.value[index.toString()];
      else expandedLogs.value[index.toString()] = true;
    };

    return {
      store,
      router,
      parser,
      searchObj,
      searchBarRef,
      splitterModel: ref(17),
      loadPageData,
      getQueryData,
      reDrawGrid,
      searchResultRef,
      refreshStreamData,
      updateGridColumns,
      getConsumableDateTime,
      runQueryFn,
      refreshData,
      setQuery,
      useLocalLogsObj,
      searchAroundData,
      verifyOrganizationStatus,
      getStreamList,
      collapseFieldList,
      areStreamsPresent,
      toggleExpandLog,
      expandedLogs,
      updateUrlQueryParams,
      fieldValues,
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
    changeRefreshInterval() {
      return this.searchObj.meta.refreshInterval;
    },
    fullSQLMode() {
      return this.searchObj.meta.sqlMode;
    },
    getStreamType() {
      return this.searchObj.data.stream.streamType;
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
      setTimeout(() => {
        this.reDrawGrid();
      }, 100);
      if (
        this.searchObj.meta.showHistogram == true &&
        this.searchObj.meta.sqlMode == false
      ) {
        setTimeout(() => {
          if (this.searchResultRef) this.searchResultRef.reDrawChart();
        }, 100);
      }
    },
    showQuery() {
      setTimeout(() => {
        this.reDrawGrid();
      }, 100);
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
        this.searchObj.data.tempFunctionContent = "";
        this.searchBarRef.resetFunctionContent();
        this.searchObj.data.query = "";
        this.setQuery("");
        this.searchObj.meta.sqlMode = false;
        this.loadPageData();
      }
    },
    changeStream() {
      if (this.searchObj.data.stream.selectedStream.hasOwnProperty("value")) {
        this.searchObj.data.tempFunctionContent = "";
        this.searchBarRef.resetFunctionContent();
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
      }, 50);
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
    changeRefreshInterval() {
      this.updateUrlQueryParams();
      this.refreshData();
    },
    fullSQLMode(newVal) {
      this.setQuery(newVal);
    },
    getStreamType() {
      this.searchObj.loading = true;
      this.searchObj.data.errorMsg = "";
      this.searchObj.data.stream.streamLists = [];
      this.searchObj.data.stream.selectedStreamFields = [];
      this.searchObj.data.queryResults = {};
      this.searchObj.data.sortedQueryResults = [];
      this.getStreamList();
    },
  },
});
</script>

<style lang="scss">
div.plotly-notifier {
  visibility: hidden;
}

.logPage {
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
  #searchGridComponent:hover::-webkit-scrollbar {
    height: 13px;
    width: 13px;
  }

  .index-table ::-webkit-scrollbar-track,
  #searchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 10px;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #searchGridComponent::-webkit-scrollbar-thumb {
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

  .logs-horizontal-splitter {
    .q-splitter__panel {
      z-index: auto !important;
    }
    .q-splitter__before {
      overflow: visible !important;
    }
  }

  .thirdlevel {
    .field-list-collapse-btn {
      z-index: 9;
      position: absolute;
      top: 5px;
      font-size: 12px !important;
    }
  }
}
</style>
