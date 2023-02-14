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
  <q-page class="logPage" id="logPage">
    <div id="secondLevel">
      <search-bar
        ref="searchBarRef"
        v-show="searchObj.data.stream.streamLists.length > 0"
        :key="searchObj.data.stream.streamLists.length"
        @searchdata="searchData"
      />
      <div
        id="thirdLevel"
        class="row scroll"
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
            <index-list :key="searchObj.data.stream.streamLists" />
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
            <div v-if="searchObj.loading == true">
              <q-spinner-dots
                color="primary"
                size="40px"
                style="margin: 0 auto; display: block"
              />
            </div>
            <div
              v-else-if="
                searchObj.data.errorMsg !== '' && searchObj.loading == false
              "
            >
              <h5 class="text-center">
                Result not found. {{ searchObj.data.errorMsg }} <br />
                <q-item-label>{{
                  searchObj.data.additionalErrorMsg
                }}</q-item-label>
              </h5>
            </div>
            <div v-else-if="searchObj.data.stream.selectedStream.label == ''">
              <h5 class="text-center">No stream selected.</h5>
            </div>
            <div
              v-else-if="
                searchObj.data.queryResults.hasOwnProperty('total') &&
                searchObj.data.queryResults.total == 0
              "
            >
              <h5 class="text-center">No result found.</h5>
            </div>
            <div v-show="searchObj.data.errorMsg == ''">
              <search-result
                ref="searchResultRef"
                @update:datetime="searchData"
                @update:scroll="getMoreData"
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
        <h5 class="text-center">
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
import useLogs from "../../composables/useLogs";
import { deepKeys, byString } from "../../utils/json";
import { Parser } from "node-sql-parser";

import indexService from "../../services/index";
import searchService from "../../services/search";
import TransformService from "../../services/jstransform";
import QueryEditor from "./QueryEditor.vue";
import DateTime from "./DateTime.vue";
import { useLocalLogsObj } from "../../utils/zincutils";

export default defineComponent({
  name: "PageSearch",
  components: {
    SearchBar,
    IndexList,
    SearchResult,
    QueryEditor,
    DateTime,
  },
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        this.searchObj.runQuery = true;
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
        ).then((res) => {
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
        });

        return;
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function getStreamList() {
      try {
        indexService
          .nameList(store.state.selectedOrganization.identifier, "logs", true)
          .then((res) => {
            searchObj.data.streamResults = res.data;

            if (res.data.list.length > 0) {
              // getQueryTransform();

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

            if (item.stats.doc_time_max > lastUpdatedStreamTime) {
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
            reDrawGrid();
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

    function buildZincENLSearch() {
      try {
        let query = searchObj.data.editorValue;

        var req: any = {
          query: {
            sql: 'select *[QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
            start_time: (new Date().getTime() - 900000) * 1000,
            end_time: new Date().getTime() * 1000,
            from:
              searchObj.data.resultGrid.currentPage *
              searchObj.meta.resultGrid.rowsPerPage,
            size: parseInt(searchObj.meta.resultGrid.rowsPerPage, 10),
          },
          aggs: {
            histogram:
              "select histogram(_timestamp, '[INTERVAL]') AS key, count(*) AS num from query GROUP BY key ORDER BY key",
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

          searchObj.meta.resultGrid.chartInterval = "1 second";
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 5) {
            searchObj.meta.resultGrid.chartInterval = "3 second";
            searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 10) {
            searchObj.meta.resultGrid.chartInterval = "5 second";
            searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
          }
          if (timestamps.end_time - timestamps.start_time >= 1000 * 60 * 20) {
            searchObj.meta.resultGrid.chartInterval = "10 second";
            searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
          }
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
          req.query.sql = query + " limit " + req.query.size;
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
              .replaceAll("=", " =")
              .replaceAll(">", " >")
              .replaceAll("<", " <");

            whereClause = whereClause
              .replaceAll("!=", " !=")
              .replaceAll("! =", " !=");

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
          // alert(req.query.sql);
          // const parsedSQL = parser.astify(req.query.sql);
          // const unparsedSQL = parser.sqlify(parsedSQL);
          // console.log(unparsedSQL);
        }

        if (searchObj.data.resultGrid.currentPage > 0) {
          delete req.aggs;
        }

        return req;
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function getQueryData() {
      try {
        if (searchObj.data.stream.selectedStream.value == "") {
          return false;
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

        const queryReq = buildZincENLSearch();

        searchService
          .search({
            org_identifier: searchObj.organizationIdetifier,
            query: queryReq,
            page_type: "logs",
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

          searchObj.data.streamResults.list.forEach((stream: any) => {
            if (searchObj.data.stream.selectedStream.value == stream.name)
              queryResult.push(...stream.schema);
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

        searchObj.data.resultGrid.columns.push({
          name: "@timestamp",
          field: (row: any) =>
            date.formatDate(
              Math.floor(row["_timestamp"] / 1000),
              "MMM DD, YYYY HH:mm:ss.SSS Z"
            ),
          prop: (row: any) =>
            date.formatDate(
              Math.floor(row["_timestamp"] / 1000),
              "MMM DD, YYYY HH:mm:ss.SSS Z"
            ),
          label: t("search.timestamp"),
          align: "left",
          sortable: true,
        });
        if (searchObj.data.stream.selectedFields.length == 0) {
          if (searchObj.meta.resultGrid.manualRemoveFields == false) {
            searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
              if (
                (field.name == "log" &&
                  searchObj.data.stream.selectedStreamFields.indexOf("log") ==
                    -1) ||
                (field.name == "message" &&
                  searchObj.data.stream.selectedStreamFields.indexOf(
                    "message"
                  ) == -1)
              ) {
                searchObj.data.stream.selectedFields.push(field.name);
              }
            });
          }

          searchObj.meta.resultGrid.manualRemoveFields = false;
          if (searchObj.data.stream.selectedFields.length == 0) {
            searchObj.data.resultGrid.columns.push({
              name: "source",
              field: (row: any) => JSON.stringify(row),
              prop: (row: any) => JSON.stringify(row),
              label: "Source",
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
        reDrawGrid();
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
          (bucket: { key: string | number | Date; num: string }) => {
            unparsed_x_data.push(bucket.key);
            let histDate = new Date(bucket.key + "Z");
            xData.push(histDate.toLocaleTimeString("en-US", { hour12: false }));
            yData.push(parseInt(bucket.num, 10));
          }
        );
      }

      const totalRecords =
        (searchObj.data.resultGrid.currentPage + 1) *
          searchObj.meta.resultGrid.rowsPerPage <
        searchObj.data.queryResults.hits.length
          ? (searchObj.data.resultGrid.currentPage + 1) *
            searchObj.meta.resultGrid.rowsPerPage
          : searchObj.data.queryResults.hits.length;
      const chartParams = {
        title:
          "Showing " +
          totalRecords +
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
      if (searchObj.meta.showHistogram == true) {
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
        loadPageData();

        reDrawGrid();
        refreshData();
      }
    });

    onUpdated(() => {
      // loadPageData();
      reDrawGrid();
    });

    onDeactivated(() => {
      clearInterval(refreshIntervalID);
    });

    onActivated(() => {
      refreshData();

      if (
        searchObj.organizationIdetifier !=
        store.state.selectedOrganization.identifier
      ) {
        loadPageData();
      }

      reDrawGrid();
      if (searchObj.meta.showHistogram == true) {
        setTimeout(() => {
          searchResultRef.value.reDrawChart();
        }, 1500);
      }
    });

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
      getQueryData();
    };

    const refreshData = () => {
      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "logs"
      ) {
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
      if (sqlMode) {
        let selectFields = "";
        let whereClause = "";
        let currentQuery = searchObj.data.query;
        currentQuery = currentQuery.split("|");
        if (currentQuery.length > 1) {
          selectFields = "," + currentQuery[0].trim();
          whereClause = "WHERE " + currentQuery[1].trim();
        } else if (currentQuery[0].trim() != "") {
          whereClause = "WHERE " + currentQuery[0].trim();
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

    return {
      store,
      router,
      parser,
      searchObj,
      searchBarRef,
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
      return this.searchObj.data.datetime.relative.value;
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
  },
  watch: {
    showFields() {
      if (this.searchObj.meta.showHistogram == true) {
        setTimeout(() => {
          this.searchResultRef.reDrawChart();
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
      if (this.searchObj.meta.showHistogram == true) {
        setTimeout(() => {
          this.searchResultRef.reDrawChart();
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
    changeRefreshInterval() {
      this.refreshData();
    },
    fullSQLMode(newVal) {
      this.setQuery(newVal);
      this.searchObj.meta.showHistogram = false;
    },
  },
});
</script>

<style>
.logPage,
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
</style>
