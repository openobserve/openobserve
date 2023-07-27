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
    <div id="secondLevel" class="full-height">
      <q-splitter
        class="logs-horizontal-splitter full-height"
        v-model="splitterModel"
        horizontal
      >
        <template v-slot:before>
          <search-bar
            data-test="logs-search-bar"
            ref="searchBarRef"
            :fieldValues="fieldValues"
            :key="searchObj.data.transforms.length || -1"
            @searchdata="searchData"
          />
        </template>
        <template v-slot:after>
          <div
            id="thirdLevel"
            class="row scroll relative-position thirdlevel full-height overflow-hidden"
            style="width: 100%"
          >
            <!-- Note: Splitter max-height to be dynamically calculated with JS -->
            <q-splitter
              v-model="searchObj.config.splitterModel"
              :limits="searchObj.config.splitterLimit"
              style="width: 100%"
              class="full-height"
              @update:model-value="onSplitterUpdate"
            >
              <template #before>
                <div class="relative-position full-height">
                  <index-list
                    v-if="searchObj.meta.showFields"
                    data-test="logs-search-index-list"
                    :key="searchObj.data.stream.streamLists"
                    class="full-height"
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
                <div
                  class="full-height flex justify-center items-center"
                  v-if="searchObj.loading == true"
                >
                  <div class="q-pb-lg">
                    <q-spinner-hourglass
                      color="primary"
                      size="40px"
                      style="margin: 0 auto; display: block"
                    />
                    <span class="text-center">
                      Hold on tight, we're fetching your logs.
                    </span>
                  </div>
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
                    class="full-height"
                    v-show="
                      searchObj.data.queryResults.hasOwnProperty('total') &&
                      searchObj.data.queryResults.hits.length !== 0
                    "
                  >
                    <search-result
                      :key="searchObj.data.histogram.xData.length || -1"
                      ref="searchResultRef"
                      :expandedLogs="expandedLogs"
                      @update:datetime="searchData"
                      @update:scroll="getMoreData"
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
  ref,
  onDeactivated,
  onActivated,
  computed,
  onMounted,
} from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

import SearchBar from "./SearchBar.vue";
import IndexList from "./IndexList.vue";
import SearchResult from "./SearchResult.vue";
import useLogs from "@/composables/useLogs";
import { Parser } from "node-sql-parser";

import { b64DecodeUnicode } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { verifyOrganizationStatus } from "@/utils/zincutils";

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
        this.searchObj.loading = true;
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

        this.getQueryData(true);

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
    let {
      searchObj,
      resetSearchObj,
      getQueryData,
      getStreamList,
      fieldValues,
      getFunctions,
      updateGridColumns,
      refreshData,
      updateUrlQueryParams,
      loadLogsData,
    } = useLogs();
    let refreshIntervalID = 0;
    const searchResultRef = ref(null);
    const searchBarRef = ref(null);
    const parser = new Parser();
    const expandedLogs = ref({});

    function restoreUrlQueryParams() {
      const queryParams = router.currentRoute.value.query;
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
    }

    // async function loadPageData() {
    //   try {
    //     loadLogsData();
    //   } catch (e) {
    //     searchObj.loading = false;
    //     console.log(e);
    //   }
    // }

    onDeactivated(() => {
      // resetSearchObj();
      // searchBarRef.value.resetFunctionContent();
      // setQuery("");
      // clearInterval(refreshIntervalID);
    });

    onActivated(async () => {
      searchObj.organizationIdetifier =
        store.state.selectedOrganization.identifier;
      restoreUrlQueryParams();
      loadLogsData();

      //   // alert("activated");
      //   // if (!searchObj.loading) updateStreams();
      //   refreshData();

      //   if (
      //     searchObj.organizationIdetifier !=
      //     store.state.selectedOrganization.identifier
      //   ) {
      //     loadPageData();
      //   }

      //   if (
      //     searchObj.meta.showHistogram == true &&
      //     searchObj.meta.sqlMode == false &&
      //     router.currentRoute.value.path.indexOf("/logs") > -1
      //   ) {
      //     setTimeout(() => {
      //       if (searchResultRef.value) searchResultRef.value.reDrawChart();
      //     }, 1500);
      //   }
    });

    // const updateStreams = () => {
    //   if (searchObj.data.streamResults?.list?.length) {
    //     const streamType = searchObj.data.stream.streamType || "logs";
    //     streamService
    //       .nameList(
    //         store.state.selectedOrganization.identifier,
    //         streamType,
    //         true
    //       )
    //       .then((response: any) => {
    //         searchObj.data.streamResults = response.data;
    //         searchObj.data.stream.streamLists = [];
    //         response.data.list.map((item: any) => {
    //           let itemObj = {
    //             label: item.name,
    //             value: item.name,
    //           };
    //           searchObj.data.stream.streamLists.push(itemObj);
    //         });
    //       });
    //   } else {
    //     loadPageData(true);
    //   }
    // };

    const runQueryFn = async () => {
      // searchObj.data.resultGrid.currentPage = 0;
      // searchObj.runQuery = false;
      // expandedLogs.value = {};
      await getQueryData();
      // setTimeout(() => {
      //   if (
      //     searchObj.meta.showHistogram == true &&
      //     searchObj.meta.sqlMode == false &&
      //     searchResultRef.value?.reDrawChart
      //   ) {
      //     searchResultRef.value.reDrawChart();
      //   }
      // }, 3000);
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

    const onSplitterUpdate = () => {
      window.dispatchEvent(new Event("resize"));
    };

    return {
      store,
      router,
      parser,
      searchObj,
      searchBarRef,
      splitterModel: ref(17),
      // loadPageData,
      getQueryData,
      searchResultRef,
      runQueryFn,
      refreshData,
      setQuery,
      verifyOrganizationStatus,
      collapseFieldList,
      areStreamsPresent,
      toggleExpandLog,
      expandedLogs,
      fieldValues,
      onSplitterUpdate,
      updateGridColumns,
      updateUrlQueryParams,
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
    // changeStream() {
    //   return this.searchObj.data.stream.selectedStream;
    // },
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
    // changeStream: {
    //   handler(stream, streamOld) {
    //     if (
    //       this.searchObj.data.stream.selectedStream.hasOwnProperty("value") &&
    //       this.searchObj.data.stream.selectedStream.value != ""
    //     ) {
    //       this.searchObj.data.tempFunctionContent = "";
    //       this.searchBarRef.resetFunctionContent();
    //       if (streamOld.value) this.searchObj.data.query = "";
    //       if (streamOld.value) this.setQuery(this.searchObj.meta.sqlMode);
    //       this.searchObj.loading = true;
    //       // setTimeout(() => {
    //       //   this.runQueryFn();
    //       // }, 500);
    //     }
    //   },
    //   immediate: false,
    // },
    updateSelectedColumns() {
      this.searchObj.meta.resultGrid.manualRemoveFields = true;
      setTimeout(() => {
        this.updateGridColumns();
      }, 50);
    },
    runQuery() {
      if (this.searchObj.runQuery == true) {
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
$navbarHeight: 64px;

div.plotly-notifier {
  visibility: hidden;
}

.logPage {
  height: calc(100vh - $navbarHeight);
  min-height: calc(100vh - $navbarHeight) !important;

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
