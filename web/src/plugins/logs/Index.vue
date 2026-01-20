<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- eslint-disable vue/attribute-hyphenation -->
<!-- eslint-disable vue/v-on-event-hyphenation -->
<template>
  <q-page class="logPage" id="logPage">
    <div
      v-show="!showSearchHistory && !showSearchScheduler"
      id="secondLevel"
      class="full-height"
    >
      <q-splitter
        class="logs-horizontal-splitter full-height"
        v-model="splitterModel"
        horizontal
      >
        <template v-slot:before>
          <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs">
            <search-bar
              data-test="logs-search-bar"
              ref="searchBarRef"
              class="card-container"
              :fieldValues="fieldValues"
              @searchdata="searchData"
              @onChangeInterval="onChangeInterval"
              @onChangeTimezone="refreshTimezone"
              @handleQuickModeChange="handleQuickModeChange"
              @handleRunQueryFn="handleRunQueryFn"
              @on-auto-interval-trigger="onAutoIntervalTrigger"
              @showSearchHistory="showSearchHistoryfn"
              @extractPatterns="extractPatternsForCurrentQuery"
            />
          </div>
        </template>
        <template v-slot:after>
          <div
            id="thirdLevel"
            class="row scroll relative-position thirdlevel full-height overflow-hidden logsPageMainSection full-width"
            v-show="searchObj.meta.logsVisualizeToggle != 'visualize'"
          >
            <!-- Note: Splitter max-height to be dynamically calculated with JS -->
            <q-splitter
              v-model="searchObj.config.splitterModel"
              :limits="searchObj.config.splitterLimit"
              class="full-height full-width logs-splitter-smooth"
              @update:model-value="onSplitterUpdate"
            >
              <template #before>
                <div class="relative-position tw:h-full tw:pl-[0.625rem]">
                  <index-list
                    v-if="searchObj.meta.showFields"
                    data-test="logs-search-index-list"
                    class="card-container"
                    @setInterestingFieldInSQLQuery="
                      setInterestingFieldInSQLQuery
                    "
                  />
                </div>
              </template>
              <template #separator>
                <q-btn
                  data-test="logs-search-field-list-collapse-btn"
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
                  :class="searchObj.meta.showFields ? 'logs-splitter-icon-expand' : 'logs-splitter-icon-collapse'"
                  color="primary"
                  size="sm"
                  dense
                  round
                  @click="collapseFieldList"
                />
              </template>
              <template #after>
                <div
                  class="tw:pr-[0.625rem] tw:pb-[0.625rem] tw:h-full"
                >
                  <div
                    class="card-container tw:h-full tw:w-full relative-position"
                  >
                    <div
                      v-if="
                        searchObj.data.filterErrMsg !== '' &&
                        searchObj.loading == false
                      "
                      class="tw:justify-center"
                    >
                      <h5 class="text-center">
                        <q-icon
                          name="warning"
                          color="warning"
                          size="10rem"
                        /><br />
                        <div
                          data-test="logs-search-filter-error-message"
                          v-html="searchObj.data.filterErrMsg"
                        ></div>
                      </h5>
                    </div>
                    <div
                      v-else-if="
                        searchObj.data.errorMsg !== '' &&
                        searchObj.loading == false
                      "
                      class="tw:justify-center"
                    >
                      <h5 class="text-center q-ma-none tw:pt-[2rem]">
                        <div
                          data-test="logs-search-result-not-found-text"
                          class="q-pt-lg"
                          v-if="
                            searchObj.data.errorCode == 0 &&
                            searchObj.data.errorMsg == ''
                          "
                        >
                          Result not found.
                          <q-btn
                            v-if="
                              searchObj.data.errorMsg != '' ||
                              searchObj?.data?.functionError != ''
                            "
                            @click="toggleErrorDetails"
                            size="sm"
                            class="o2-secondary-button"
                            data-test="logs-page-result-error-details-btn-result-not-found"
                            >{{ t("search.functionErrorBtnLabel") }}</q-btn
                          >
                        </div>
                        <div
                          data-test="logs-search-error-message"
                          class="q-pt-lg"
                          v-else
                        >
                          Error occurred while retrieving search events.
                          <q-btn
                            v-if="
                              searchObj.data.errorMsg != '' ||
                              searchObj?.data?.functionError != ''
                            "
                            @click="toggleErrorDetails"
                            size="sm"
                            class="o2-secondary-button"
                            data-test="logs-page-result-error-details-btn"
                            >{{ t("search.histogramErrorBtnLabel") }}</q-btn
                          >
                        </div>
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
                              '/streams?dialog=' +
                              searchObj.data.stream.selectedStream.label
                            "
                            >Click here</q-btn
                          >
                          to configure a full text search field to the stream.
                        </div>
                        <q-item-label>{{
                          searchObj.data.additionalErrorMsg
                        }}</q-item-label>
                      </h5>
                    </div>
                    <div
                      v-else-if="
                        searchObj.data.stream.selectedStream.length == 0 &&
                        searchObj.loading == false
                      "
                      class="row tw:justify-center"
                    >
                      <h6
                        data-test="logs-search-no-stream-selected-text"
                        class="text-center col-10 q-mx-none tw:mt-none! tw:pt-[2rem]"
                      >
                        <q-icon name="info" color="primary" size="md" />
                        {{ t("search.noStreamSelectedMessage") }}
                      </h6>
                    </div>
                    <div
                      v-else-if="
                        searchObj.meta.logsVisualizeToggle === 'logs' &&
                        searchObj.data.queryResults.hasOwnProperty('hits') &&
                        searchObj.data.queryResults.hits.length == 0 &&
                        searchObj.loading == false &&
                        searchObj.meta.searchApplied == true
                      "
                      class="row tw:justify-center"
                    >
                      <h6
                        data-test="logs-search-error-message"
                        class="text-center q-ma-none col-10 tw:pt-[2rem]"
                      >
                        <q-icon name="info" color="primary"
size="md" />
                        {{ t("search.noRecordFound") }}
                        <q-btn
                          v-if="
                            searchObj.data.errorMsg != '' ||
                            searchObj?.data?.functionError != ''
                          "
                          @click="toggleErrorDetails"
                          size="sm"
                          data-test="logs-page-result-error-details-btn-norecord"
                          >{{ t("search.functionErrorBtnLabel") }}</q-btn
                        ><br />
                      </h6>
                    </div>
                    <div
                      v-else-if="
                        searchObj.data.queryResults.hasOwnProperty('hits') &&
                        searchObj.data.queryResults.hits.length == 0 &&
                        searchObj.loading == false &&
                        searchObj.meta.searchApplied == false
                      "
                      class="row tw:justify-center"
                    >
                      <h6
                        data-test="logs-search-error-message"
                        class="text-center q-ma-none col-10 tw:pt-[2rem]"
                      >
                        <q-icon name="info" color="primary"
size="md" />
                        {{ t("search.applySearch") }}
                      </h6>
                    </div>
                    <div
                      v-else-if="
                        searchObj.meta.logsVisualizeToggle === 'patterns' &&
                        patternsState?.patterns?.patterns?.length == 0 &&
                        searchObj.meta.searchApplied == false &&
                        searchObj.loading == false
                      "
                      class="row tw:justify-center"
                    >
                      <h6
                        data-test="logs-search-error-message"
                        class="text-center q-ma-none col-10 tw:pt-[2rem]"
                      >
                        <q-icon name="info" color="primary"
    size="md" />
                        {{ t("search.applySearch") }}
                      </h6>
                    </div>
                    <div
                      v-else
                      data-test="logs-search-search-result"
                      class="full-height card-container"
                    >
                      <search-result
                        ref="searchResultRef"
                        :expandedLogs="expandedLogs"
                        @update:datetime="setHistogramDate"
                        @update:scroll="getMoreData"
                        @update:recordsPerPage="getMoreDataRecordsPerPage"
                        @expandlog="toggleExpandLog"
                        @send-to-ai-chat="sendToAiChat"
                      />
                    </div>
                    <div class="text-center col-10 q-ma-none">
                      <h5 class="tw:my-none">
                        <span v-if="disableMoreErrorDetails">
                          <SanitizedHtmlRenderer
                            data-test="logs-search-detail-error-message"
                            :htmlContent="searchObj?.data?.errorMsg"
                          />
                          <div class="error-display__message">
                            {{ searchObj?.data?.errorDetail }}
                          </div>
                          <SanitizedHtmlRenderer
                            data-test="logs-search-detail-function-error-message"
                            :htmlContent="searchObj?.data?.functionError"
                          />
                        </span>
                      </h5>
                    </div>
                  </div>
                </div>
              </template>
            </q-splitter>
          </div>
          <div
            v-show="searchObj.meta.logsVisualizeToggle == 'visualize'"
            class="visualize-container"
            :style="{ '--splitter-height': `${splitterModel}vh` }"
          >
            <VisualizeLogsQuery
              :visualizeChartData="visualizeChartData"
              :errorData="visualizeErrorData"
              :searchResponse="searchResponseForVisualization"
              :is_ui_histogram="shouldUseHistogramQuery"
              :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
            ></VisualizeLogsQuery>
          </div>
        </template>
      </q-splitter>
    </div>
    <div v-show="showSearchHistory">
      <search-history
        v-if="store.state.zoConfig.usage_enabled"
        ref="searchHistoryRef"
        @closeSearchHistory="closeSearchHistoryfn"
        :isClicked="showSearchHistory"
      />
      <div
        v-else-if="showSearchHistory && !store.state.zoConfig.usage_enabled"
        class="search-history-empty"
      >
        <div
          class="search-history-empty__content text-center q-pa-md flex flex-center"
        >
          <div>
            <div>
              <q-icon
                name="history"
                size="100px"
                color="gray"
                class="search-history-empty__icon"
              />
            </div>
            <div class="text-h4 search-history-empty__title">
              Search history is not enabled.
            </div>
            <div
              class="search-history-empty__info q-mt-sm flex items-center justify-center"
            >
              <q-icon name="info" class="q-mr-xs"
size="20px" />
              <span class="text-h6 text-center">
                Set ZO_USAGE_REPORTING_ENABLED to true to enable usage
                reporting.</span
              >
            </div>

            <q-btn
              class="q-mt-xl"
              color="secondary"
              unelevated
              :label="t('search.redirect_to_logs_page')"
              no-caps
              @click="redirectBackToLogs"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-show="showSearchScheduler">
      <SearchSchedulersList
        ref="searchSchedulerRef"
        @closeSearchHistory="closeSearchSchedulerFn"
        :isClicked="showSearchScheduler"
      />
    </div>
  </q-page>
</template>

<script lang="ts">
// TODO: Remove ts-ignore from the code
// @ts-nocheck
import {
  defineComponent,
  ref,
  onActivated,
  onDeactivated,
  computed,
  nextTick,
  onBeforeMount,
  watch,
  defineAsyncComponent,
  provide,
  onMounted,
  onBeforeUnmount,
  onUnmounted,
} from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import {
  verifyOrganizationStatus,
  useLocalInterestingFields,
  deepCopy,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import MainLayoutCloudMixin from "@/enterprise/mixins/mainLayout.mixin";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import useLogs from "@/composables/useLogs";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { reactive } from "vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep, debounce } from "lodash-es";
import {
  buildSqlQuery,
  getFieldsFromQuery,
  isSimpleSelectAllQuery,
  getStreamFromQuery,
} from "@/utils/query/sqlUtils";
import useNotifications from "@/composables/useNotifications";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import SearchHistory from "@/plugins/logs/SearchHistory.vue";
import SearchSchedulersList from "@/plugins/logs/SearchSchedulersList.vue";
import { type ActivationState, PageType } from "@/ts/interfaces/logs.ts";
import { isWebSocketEnabled, isStreamingEnabled } from "@/utils/zincutils";
import { allSelectionFieldsHaveAlias } from "@/utils/query/visualizationUtils";
import useAiChat from "@/composables/useAiChat";
import queryService from "@/services/search";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { searchState } from "@/composables/useLogs/searchState";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import usePatterns from "@/composables/useLogs/usePatterns";
import {
  getVisualizationConfig,
  encodeVisualizationConfig,
  decodeVisualizationConfig,
} from "@/composables/useLogs/logsVisualization";
import useSearchBar from "@/composables/useLogs/useSearchBar";
import { useHistogram } from "@/composables/useLogs/useHistogram";
import useStreams from "@/composables/useStreams";
import { contextRegistry } from "@/composables/contextProviders";
import { createLogsContextProvider } from "@/composables/contextProviders/logsContextProvider";
import IndexList from "@/plugins/logs/IndexList.vue";

export default defineComponent({
  name: "PageSearch",
  components: {
    SearchBar,
    IndexList,
    SearchResult: defineAsyncComponent(
      () => import("@/plugins/logs/SearchResult.vue"),
    ),
    SearchSchedulersList: defineAsyncComponent(
      () => import("@/plugins/logs/SearchSchedulersList.vue"),
    ),
    SanitizedHtmlRenderer,
    VisualizeLogsQuery: defineAsyncComponent(
      () => import("@/plugins/logs/VisualizeLogsQuery.vue"),
    ),
    SearchHistory: defineAsyncComponent(
      () => import("@/plugins/logs/SearchHistory.vue"),
    ),
  },
  mixins: [MainLayoutCloudMixin],
  emits: ["sendToAiChat"],
  methods: {
    setHistogramDate(date: any) {
      this.searchBarRef.dateTimeRef.setCustomDate("absolute", date);
    },
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
          stream_name: this.searchObj.data.stream.selectedStream.join(","),
          show_query: this.searchObj.meta.showQuery,
          show_histogram: this.searchObj.meta.showHistogram,
          sqlMode: this.searchObj.meta.sqlMode,
          showFields: this.searchObj.meta.showFields,
          page: "Search Logs",
        });
      }
    },
    async getMoreDataRecordsPerPage() {
      if (this.searchObj.meta.refreshInterval == 0) {
        // this.searchObj.data.resultGrid.currentPage =
        //   ((this.searchObj.data.queryResults?.hits?.length || 0) +
        //     ((this.searchObj.data.queryResults?.hits?.length || 0) + 150)) /
        //     150 -
        //   1;
        // this.searchObj.data.resultGrid.currentPage =
        //   this.searchObj.data.resultGrid.currentPage + 1;
        this.searchObj.loading = true;

        // As page count request was getting fired on changing date records per page instead of histogram,
        // so added this condition to avoid that
        this.searchObj.meta.refreshHistogram = true;
        this.searchObj.data.queryResults.aggs = null;
        if (this.searchObj.meta.jobId == "") {
          await this.getQueryData(false);
          this.refreshHistogramChart();
        } else {
          await this.getJobData(false);
        }

        if (config.isCloud == "true") {
          segment.track("Button Click", {
            button: "Get More Data",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.searchObj.data.stream.selectedStream.join(","),
            page: "Search Logs",
          });
        }
      }
    },
    async getMoreData() {
      if (this.searchObj.meta.refreshInterval == 0) {
        // this.searchObj.data.resultGrid.currentPage =
        //   ((this.searchObj.data.queryResults?.hits?.length || 0) +
        //     ((this.searchObj.data.queryResults?.hits?.length || 0) + 150)) /
        //     150 -
        //   1;
        // this.searchObj.data.resultGrid.currentPage =
        //   this.searchObj.data.resultGrid.currentPage + 1;
        this.searchObj.loading = true;
        if (this.searchObj.meta.jobId == "") {
          await this.getQueryData(true);
          this.refreshHistogramChart();
        } else {
          await this.getJobData(false);
        }

        if (config.isCloud == "true") {
          segment.track("Button Click", {
            button: "Get More Data",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.searchObj.data.stream.selectedStream.join(","),
            page: "Search Logs",
          });
        }
      }
    },
    async getLessData() {
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
        // this.searchObj.data.resultGrid.currentPage =
        //   ((this.searchObj.data.queryResults?.hits?.length || 0) +
        //     ((this.searchObj.data.queryResults?.hits?.length || 0) + 150)) /
        //     150 -
        //   1;
        this.searchObj.data.resultGrid.currentPage =
          this.searchObj.data.resultGrid.currentPage - 1;

        await this.getQueryData(true);
        this.refreshHistogramChart();

        if (config.isCloud == "true") {
          segment.track("Button Click", {
            button: "Get Less Data",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.searchObj.data.stream.selectedStream.join(","),
            page: "Search Logs",
          });
        }
      }
    },
    toggleErrorDetails() {
      this.disableMoreErrorDetails = !this.disableMoreErrorDetails;
    },
  },
  setup(props: any, { emit }: any) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();
    const disableMoreErrorDetails: boolean = ref(false);
    const searchHistoryRef = ref(null);
    const {
      searchObj,
      resetSearchObj,
      initialLogsState,
      resetStreamData,
      fieldValues,
    } = searchState();
    const { getStreamList, updateGridColumns, extractFields } =
      useStreamFields();
    const {
      getFunctions,
      getQueryData,
      cancelQuery,
      getRegionInfo,
      sendCancelSearchMessage,
      setCommunicationMethod,
    } = useSearchBar();
    let {
      getJobData,
      refreshData,
      loadLogsData,
      updateStreams,
      restoreUrlQueryParams,
      handleRunQuery,
      enableRefreshInterval,
      clearSearchObj,
      processHttpHistogramResults,
      loadVisualizeData,
      loadPatternsData,
    } = useLogs();

    const {
      getHistogramQueryData,
      resetHistogramWithError,
      generateHistogramData,
      generateHistogramSkeleton,
    } = useHistogram();

    const { getStream } = useStreams();

    const {
      fnParsedSQL,
      fnUnparsedSQL,
      isDistinctQuery,
      isWithQuery,
      isLimitQuery,
      updateUrlQueryParams,
      addTraceId,
      checkTimestampAlias,
    } = logsUtils();
    const {
      getHistogramData,
      buildWebSocketPayload,
      buildSearch,
      initializeSearchConnection,
    } = useSearchStream();

    // Initialize patterns composable (completely separate from logs)
    const { extractPatterns, patternsState } = usePatterns();

    const searchResultRef = ref(null);
    const searchBarRef = ref(null);
    const showSearchHistory = ref(false);
    const showSearchScheduler = ref(false);
    const showJobScheduler = ref(false);

    const isLogsMounted = ref(false);

    const expandedLogs = ref([]);
    const splitterModel = ref(15);
    const chartRedrawTimeout = ref(null);
    const updateColumnsTimeout = ref(null);

    const { showErrorNotification, showAliasErrorForVisualization } =
      useNotifications();

    provide("dashboardPanelDataPageKey", "logs");
    const visualizeChartData = ref({});
    const {
      dashboardPanelData,
      validatePanel,
      generateLabelFromName,
      resetDashboardPanelData,
      setCustomQueryFields,
      getResultSchema,
      determineChartType,
      convertSchemaToFields,
      setFieldsBasedOnChartTypeValidation,
    } = useDashboardPanelData("logs");
    const visualizeErrorData: any = reactive({
      errors: [],
    });

    // Schema caching for result_schema API calls
    // This cache stores the response of result_schema API to avoid redundant calls
    // when the same query is executed multiple times.
    const schemaCache = ref<{
      key: string;
      response: any;
    } | null>(null);

    const clearSchemaCache = () => {
      schemaCache.value = null;
    };

    const {
      registerAiChatHandler,
      removeAiChatHandler,
      initializeDefaultContext,
    } = useAiChat();

    onUnmounted(() => {
      // reset logsVisualizeToggle when user navigate to other page with keepAlive is false and navigate back to logs page
      searchObj.meta.logsVisualizeToggle = "logs";
      // Clear schema cache to free up memory
      clearSchemaCache();
    });

    onBeforeMount(() => {
      handleBeforeMount();
    });

    onMounted(() => {
      if (
        router.currentRoute.value.query.hasOwnProperty("action") &&
        router.currentRoute.value.query.action == "history"
      ) {
        showSearchHistory.value = true;
      }
      if (
        router.currentRoute.value.query.hasOwnProperty("action") &&
        router.currentRoute.value.query.action == "search_scheduler"
      ) {
        if (config.isEnterprise == "true") {
          showSearchScheduler.value = true;
        } else {
          router.back();
        }
      }

      registerAiContextHandler();
      setupContextProvider();
    });

    onBeforeUnmount(async () => {
      // Cancel all the search queries
      if (store.state.refreshIntervalID)
        clearInterval(store.state.refreshIntervalID);

      cancelQuery();

      removeAiContextHandler();
      cleanupContextProvider();

      // Clear any pending timeouts
      clearAllTimeouts();
      try {
        if (searchObj)
          await store.dispatch(
            "logs/setLogs",
            JSON.parse(JSON.stringify(searchObj)),
          );
      } catch (error) {
        console.error("Failed to set logs:", error.message);
      }

      clearSearchObj();
      searchBarRef.value = null;
      searchResultRef.value = null;
    });

    onActivated(() => {
      if (isLogsMounted.value) handleActivation();
    });

    /**
     * As we are redirecting stream explorer to logs page, we need to check if the user has changed the stream type from stream explorer to logs.
     * This watcher is used to check if the user has changed the stream type from stream explorer to logs.
     * This gets triggered when stream explorer is active and user clicks on logs icon from left menu sidebar. Then we need to redirect the user to logs page again.
     */

    watch(
      () => router.currentRoute.value.query.type,

      (type, prev) => {
        if (
          searchObj.shouldIgnoreWatcher == false &&
          router.currentRoute.value.name === "logs" &&
          prev === "stream_explorer" &&
          !type
        ) {
          searchObj.meta.pageType = "logs";
          if (
            prev === "stream_explorer" &&
            (type == undefined || type !== "stream_explorer")
          ) {
            searchObj.meta.refreshHistogram = true;
          }
          loadLogsData();
        }
      },
    );
    watch(
      () => router.currentRoute.value.query,
      () => {
        if (!router.currentRoute.value.query.hasOwnProperty("action")) {
          showSearchHistory.value = false;
          showSearchScheduler.value = false;
        }
        if (
          router.currentRoute.value.query.hasOwnProperty("action") &&
          router.currentRoute.value.query.action == "history"
        ) {
          showSearchHistory.value = true;
        }
        if (
          router.currentRoute.value.query.hasOwnProperty("action") &&
          router.currentRoute.value.query.action == "search_scheduler"
        ) {
          if (config.isEnterprise == "true") {
            showSearchScheduler.value = true;
          } else {
            router.back();
          }
        }
      },
      // (action) => {
      //   if (action === "history") {
      //     showSearchHistory.value = true;
      //   }
      // }
    );
    watch(
      () => router.currentRoute.value.query.type,
      async (type) => {
        if (type == "search_history_re_apply") {
          searchObj.meta.jobId = "";

          searchObj.organizationIdetifier =
            router.currentRoute.value.query.org_identifier;
          searchObj.data.stream.selectedStream.value =
            router.currentRoute.value.query.stream;
          searchObj.data.stream.streamType =
            router.currentRoute.value.query.stream_type;
          resetSearchObj();

          // As when redirecting from search history to logs page, date type was getting set as absolute, so forcefully keeping it relative.
          searchBarRef.value.dateTimeRef.setRelativeTime(
            router.currentRoute.value.query.period,
          );
          searchObj.data.datetime.type = "relative";

          searchObj.data.queryResults.hits = [];
          searchObj.meta.searchApplied = false;
          resetStreamData();
          restoreUrlQueryParams(dashboardPanelData);
          // loadLogsData();
          //instead of loadLogsData so I have used all the functions that are used in that and removed getQuerydata from the list
          //of functions of loadLogsData to stop run query whenever this gets redirecited
          await getStreamList();
          await getFunctions();
          await extractFields();
          refreshData();
        }
      },
    );
    watch(
      () => router.currentRoute.value.query.type,
      async (type) => {
        if (type == "search_scheduler") {
          searchObj.organizationIdetifier =
            router.currentRoute.value.query.org_identifier;
          searchObj.data.stream.selectedStream.value =
            router.currentRoute.value.query.stream;
          searchObj.data.stream.streamType =
            router.currentRoute.value.query.stream_type;
          resetSearchObj();

          // As when redirecting from search history to logs page, date type was getting set as absolute, so forcefully keeping it relative.
          searchBarRef.value.dateTimeRef.setAbsoluteTime(
            router.currentRoute.value.query.from,
            router.currentRoute.value.query.to,
          );
          searchObj.data.datetime.type = "absolute";
          searchObj.meta.searchApplied = false;
          resetStreamData();
          await restoreUrlQueryParams(dashboardPanelData);
          await loadLogsData();
        }
      },
    );

    const runQueryFn = async () => {
      // searchObj.data.resultGrid.currentPage = 0;
      // searchObj.runQuery = false;
      try {
        await getQueryData();
        refreshHistogramChart();
        showJobScheduler.value = true;
      } catch (e) {
        console.log(e);
      }
    };

    /**
     * Common method to extract patterns
     * Handles validation, loading states, and error handling
     */
    const extractPatternsForCurrentQuery = async (clear_cache = false) => {
      console.log("[Index] Extracting patterns for current query");
      searchObj.meta.resultGrid.showPagination = false;
      searchObj.loading = true;

      try {
        const queryReq = buildSearch(false, false);
        if (!queryReq) {
          console.log("[Index] No query request available");
          searchObj.loading = false;
          return;
        }

        // Set size to -1 to let backend determine sampling size based on config
        console.log("[Patterns] Using default sampling from backend configuration");
        queryReq.query.size = -1;

        const streamName = searchObj.data.stream.selectedStream[0];
        if (!streamName) {
          console.log("[Index] No stream selected");
          searchObj.loading = false;
          showErrorNotification("Please select a stream to extract patterns");
          return;
        }

        await extractPatterns(
          searchObj.organizationIdentifier,
          streamName,
          queryReq,
        );
        searchObj.loading = false;

        // Set clear_cache flag before calling getQueryData
        searchObj.meta.clearCache = clear_cache;
        searchObj.meta.refreshHistogram = true;
        await getQueryData();
        refreshHistogramChart();
        console.log("[Index] Patterns extracted successfully");
      } catch (error) {
        console.error("[Index] Error extracting patterns:", error);
        searchObj.loading = false;
        showErrorNotification("Error extracting patterns. Please try again.");
      }
    };

    // // Watch for patterns mode switch - completely separate from logs flow
    // watch(
    //   () => searchObj.meta.logsVisualizeToggle,
    //   async (newMode, oldMode) => {
    //     if (newMode === "patterns") {
    //       console.log("[Index] Switched to patterns mode - fetching patterns");
    //       await extractPatternsForCurrentQuery();
    //     } else if (oldMode === "patterns") {
    //       console.log("[Index] Switched from patterns to", newMode);
    //       // No need to clear patterns - they can be cached
    //     }
    //   },
    // );

    // Main method for handling before mount logic
    async function handleBeforeMount() {
      if (
        Object.hasOwn(router.currentRoute.value?.query, "logs_visualize_toggle")
      ) {
        searchObj.meta.logsVisualizeToggle =
          router.currentRoute.value.query.logs_visualize_toggle;
      }

      // Always setup logs tab on mount
      await setupLogsTab();
    }

    // Helper function to check if the current tab is "logs"
    function isLogsTab() {
      return searchObj.meta.logsVisualizeToggle === "logs";
    }

    const isRouteChanged = () => {
      if (
        !Object.hasOwn(router.currentRoute.value.query, "stream") ||
        !Object.hasOwn(router.currentRoute.value.query, "org_identifier")
      ) {
        return;
      }

      if (
        Object.hasOwn(router.currentRoute.value.query, "stream") &&
        Object.hasOwn(router.currentRoute.value.query, "org_identifier") &&
        store.state.logs.logs.data != undefined &&
        Object.hasOwn(store.state.logs.logs.data, "stream") &&
        Object.hasOwn(store.state.logs.logs, "organizationIdentifier") &&
        (!store.state.logs.logs.data.stream.selectedStream.includes(
          router.currentRoute.value.query.stream,
        ) ||
          router.currentRoute.value.query.org_identifier !==
            store.state.logs.logs.organizationIdentifier)
      ) {
        store.dispatch("logs/setIsInitialized", false);
      }
      return;
    };

    // Setup logic for the logs tab
    async function setupLogsTab() {
      try {
        isRouteChanged();
        if (!store.state.logs.isInitialized) {
          searchObj.organizationIdentifier =
            store.state.selectedOrganization.identifier;

          searchObj.meta.pageType = "logs";
          searchObj.meta.refreshHistogram = true;
          // Bhargav Todo: remove this comment
          // searchObj.loading = true;

          resetSearchObj();

          resetStreamData();

          searchObj.meta.quickMode = isQuickModeEnabled();

          searchObj.meta.showHistogram = isHistogramEnabled();

          restoreUrlQueryParams(dashboardPanelData);

          if (isEnterpriseClusterEnabled()) {
            await getRegionInfo();
          }

          if (isLogsTab()) {
            searchObj.loading = true;
            loadLogsData();
          } else if (searchObj.meta.logsVisualizeToggle === "patterns") {
            await loadPatternsData();
            await extractPatternsForCurrentQuery();
          } else {
            loadVisualizeData();
            searchObj.loading = false;
          }

          store.dispatch("logs/setIsInitialized", true);
        } else {
          await initialLogsState();
          await nextTick();
          await getStreamList(false);
          await nextTick();
          await updateGridColumns();
          await nextTick();
        }

        isLogsMounted.value = true;
      } catch (error) {
        console.error("Failed to setup logs tab:", error);
        searchObj.loading = false;
      }
    }

    // Helper function to check if the environment is enterprise and super cluster is enabled
    function isEnterpriseClusterEnabled() {
      return (
        config.isEnterprise === "true" &&
        store.state.zoConfig.super_cluster_enabled
      );
    }

    // Helper function to check if the environment is cloud
    function isCloudEnvironment() {
      return config.isCloud === "true";
    }

    // Helper function to check if quick mode is enabled
    function isQuickModeEnabled() {
      return store.state.zoConfig.quick_mode_enabled;
    }

    // Helper function to check if histogram is enabled
    function isHistogramEnabled() {
      return store.state.zoConfig.histogram_enabled;
    }

    const handleActivation = async () => {
      try {
        const queryParams: any = router.currentRoute.value.query;

        const activationState: ActivationState = {
          isSearchTab: searchObj.meta.logsVisualizeToggle === PageType.LOGS,
          isStreamExplorer: queryParams.type === PageType.STREAM_EXPLORER,
          isTraceExplorer: queryParams.type === PageType.TRACE_EXPLORER,
          isStreamChanged:
            queryParams.stream_type !== searchObj.data.stream.streamType ||
            queryParams.stream !==
              searchObj.data.stream.selectedStream.join(","),
        };

        if (activationState.isSearchTab) {
          await handleSearchTab(queryParams, activationState);
        } else {
          handleVisualizeTab();
        }
      } catch (err) {
        searchObj.loading = false;
        console.error("Activation handling failed:", {
          error: err,
          route: router.currentRoute.value.path,
          queryParams: router.currentRoute.value.query,
        });
      }
    };

    // Helper function for handling search tab logic
    const handleSearchTab = (queryParams, activationState: ActivationState) => {
      try {
        searchObj.meta.refreshHistogram = true;

        if (activationState.isTraceExplorer) {
          handleTraceExplorer(queryParams);
          return;
        }

        if (
          activationState.isStreamChanged &&
          activationState.isStreamExplorer &&
          !searchObj.loading
        ) {
          handleStreamExplorer();
          return;
        }

        if (isOrganizationChanged() && !searchObj.loading) {
          handleOrganizationChange();
        } else if (!searchObj.loading) {
          updateStreams();
        }

        refreshHistogramChart();
      } catch (err) {
        searchObj.loading = false;
        console.error("Failed to handle search tab:", err);
      }
    };

    // Helper function for handling the trace explorer
    function handleTraceExplorer(queryParams) {
      searchObj.organizationIdentifier = queryParams.org_identifier;
      searchObj.data.stream.selectedStream.value = queryParams.stream;
      searchObj.data.stream.streamType = queryParams.stream_type;
      resetSearchObj();
      resetStreamData();
      restoreUrlQueryParams(dashboardPanelData);
      loadLogsData();
    }

    // Helper function for handling the stream explorer
    function handleStreamExplorer() {
      resetSearchObj();
      resetStreamData();
      restoreUrlQueryParams(dashboardPanelData);
      loadLogsData();
    }

    // Helper function for organization change
    function handleOrganizationChange() {
      searchObj.loading = true;
      loadLogsData();
    }

    // Check if the selected organization has changed
    function isOrganizationChanged() {
      return (
        searchObj.organizationIdentifier !==
        store.state.selectedOrganization.identifier
      );
    }

    // Helper function for handling the visualize tab
    function handleVisualizeTab() {
      handleRunQueryFn();
    }

    const refreshTimezone = () => {
      updateGridColumns();
      generateHistogramData();
      refreshHistogramChart();
    };

    const refreshHistogramChart = () => {
      nextTick(() => {
        if (
          searchObj.meta.showHistogram &&
          searchResultRef.value?.reDrawChart
        ) {
          searchResultRef.value.reDrawChart();
        }
      });
    };

    const setQuery = (sqlMode: boolean) => {
      if (!searchBarRef.value) {
        console.error("searchBarRef is null");
        return;
      }

      try {
        if (sqlMode) {
          let selectFields = "";
          let whereClause = "";
          let currentQuery = searchObj.data.query;

          const hasSelect =
            currentQuery != "" &&
            (currentQuery.toLowerCase() === "select" ||
              currentQuery.toLowerCase().indexOf("select ") == 0);
          //check if user try to applied saved views in which sql mode is enabled.
          if (currentQuery.toLowerCase().indexOf("select") >= 0) {
            return;
          }

          // Parse the query and check if it is valid
          // It should have one column and one table

          // const hasSelect =
          //   currentQuery.toLowerCase() === "select" ||
          //   currentQuery.toLowerCase().indexOf("select ") == 0;
          if (!hasSelect) {
            if (currentQuery != "") {
              if (currentQuery.trim() != "") {
                  whereClause = "WHERE " + currentQuery;
              }
            }

            searchObj.data.query = "";
            const streams = searchObj.data.stream.selectedStream;

            streams.forEach((stream: string, index: number) => {
              // Add UNION for all but the first SELECT statement
              if (index > 0) {
                searchObj.data.query += " UNION ";
              }
              searchObj.data.query += `SELECT [FIELD_LIST]${selectFields} FROM "${stream}" ${whereClause}`;
            });

            if (
              !searchObj.data.stream?.selectedStreamFields?.length &&
              searchObj.data?.stream?.selectedStream?.[0]
            ) {
              const streamData: any = getStream(
                searchObj.data.stream.selectedStream[0],
                searchObj.data.stream.streamType || "logs",
                true,
              );
              if (streamData.schema)
                searchObj.data.stream.selectedStreamFields = streamData.schema;
            }

            if (searchObj.data.stream?.selectedStreamFields?.length > 0) {
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
                searchObj.data.query = searchObj.data.query.replace(
                  /\[FIELD_LIST\]/g,
                  searchObj.data.stream.interestingFieldList.join(","),
                );
              } else {
                searchObj.data.query = searchObj.data.query.replace(
                  /\[FIELD_LIST\]/g,
                  "*",
                );
              }
            }
          }

          searchObj.data.editorValue = searchObj.data.query;

          searchBarRef.value.updateQuery();
        } else {
          searchObj.data.query = "";
          searchBarRef.value.updateQuery();
        }
      } catch (e) {
        console.log("Logs : Error in setQuery ", e);
      }
    };

    const collapseFieldList = () => {
      if (searchObj.meta.showFields) searchObj.meta.showFields = false;
      else searchObj.meta.showFields = true;

      // Redraw chart after field list collapse/expand
      nextTick(() => {
        if (
          searchObj.meta.showHistogram &&
          searchResultRef.value?.reDrawChart
        ) {
          searchResultRef.value.reDrawChart();
        }
      });
    };

    const areStreamsPresent = computed(() => {
      return !!searchObj.data.stream.streamLists.length;
    });

    const toggleExpandLog = (index: number) => {
      if (expandedLogs.value.includes(index))
        expandedLogs.value = expandedLogs.value.filter((item) => item != index);
      else expandedLogs.value.push(index);
    };

    const onSplitterUpdate = () => {
      window.dispatchEvent(new Event("resize"));
    };

    const onChangeInterval = () => {
      if (
        searchObj.meta.refreshInterval > 0 &&
        !enableRefreshInterval(searchObj.meta.refreshInterval)
      ) {
        searchObj.meta.refreshInterval = 0;
      }

      updateUrlQueryParams();
      refreshData();
    };

    const onAutoIntervalTrigger = () => {
      // handle event for visualization page only
      if (searchObj.meta.logsVisualizeToggle == "visualize") {
        handleRunQueryFn();
      }
    };
    const showSearchHistoryfn = () => {
      router.push({
        name: "logs",
        query: {
          action: "history",
          org_identifier: store.state.selectedOrganization.identifier,
          type: "search_history",
        },
      });
      showSearchHistory.value = true;
    };

    const redirectBackToLogs = () => {
      router.push({
        name: "logs",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    function removeFieldByName(data, fieldName) {
      return data.filter((item: any) => {
        if (item.expr) {
          if (
            (item.expr.type === "column_ref" &&
              (item.expr?.column?.expr?.value === fieldName ||
                item.expr.column === fieldName)) ||
            (item.expr.type === "aggr_func" &&
              item.expr?.args?.expr?.column?.value === fieldName)
          ) {
            return false;
          }
        }
        return true;
      });
    }

    const setInterestingFieldInSQLQuery = (
      field: any,
      isFieldExistInSQL: boolean,
    ) => {
      //implement setQuery function using node-sql-parser
      //isFieldExistInSQL is used to check if the field is already present in the query or not.
      let parsedSQL = fnParsedSQL();
      parsedSQL = processInterestingFiledInSQLQuery(
        parsedSQL,
        field,
        isFieldExistInSQL,
      );

      // Modify the query based on stream name
      const streamName = searchObj.data.stream.selectedStream[0].replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const newQuery = fnUnparsedSQL(parsedSQL)
        .replace(/`/g, "")
        .replace(
          new RegExp(`\\b${streamName}\\b`, "g"),
          `"${searchObj.data.stream.selectedStream[0]}"`,
        );

      searchObj.data.query = newQuery;
      searchObj.data.editorValue = newQuery;
      searchBarRef.value.updateQuery();
    };

    const processInterestingFiledInSQLQuery = (
      parsedSQL,
      field,
      isFieldExistInSQL,
    ) => {
      let fieldPrefix = "";
      if (parsedSQL) {
        if (isFieldExistInSQL) {
          // Remove the field from the query
          if (parsedSQL.columns && parsedSQL.columns.length > 0) {
            let filteredData = removeFieldByName(parsedSQL.columns, field.name);

            const index = searchObj.data.stream.interestingFieldList.indexOf(
              field.name,
            );
            if (index > -1) {
              searchObj.data.stream.interestingFieldList.splice(index, 1);
            }
            parsedSQL.columns = filteredData;
          }
        } else {
          if (searchObj.data.stream.selectedStream.length > 1) {
            if (parsedSQL && parsedSQL?.from?.length > 1) {
              fieldPrefix = parsedSQL.from[0].as
                ? `${parsedSQL.from[0].as}.`
                : `${parsedSQL.from[0].table}.`;
            }
          }
          // Add the field in the query
          if (parsedSQL.columns && parsedSQL?.columns?.length > 0) {
            // Iterate and remove the * from the query
            parsedSQL.columns = removeFieldByName(parsedSQL?.columns, "*");
          }

          // check is required for union query where both streams interesting fields goes into single array
          // but it should be added if field exist in the strem schema
          searchObj.data.streamResults.list.forEach((stream) => {
            if (stream.name === parsedSQL?.from?.[0]?.table) {
              stream.schema.forEach((stream_field) => {
                if (field.name === stream_field.name) {
                  parsedSQL.columns.push({
                    expr: {
                      type: "column_ref",
                      column: fieldPrefix + field.name,
                    },
                    type: "expr",
                  });
                }
              });
            }
          });
        }

        // Add '*' if no columns are left
        if (parsedSQL.columns && parsedSQL.columns.length === 0) {
          parsedSQL.columns.push({
            expr: {
              type: "column_ref",
              column: fieldPrefix + "*",
            },
            type: "expr",
          });
        }
      }

      // Recursively process _next if it exists
      if (parsedSQL._next) {
        parsedSQL._next = processInterestingFiledInSQLQuery(
          parsedSQL._next,
          field,
          isFieldExistInSQL,
        );
      }

      return parsedSQL;
    };

    const handleQuickModeChange = () => {
      if (searchObj.meta.quickMode == true) {
        let field_list: string = "*";
        if (searchObj.data.stream.interestingFieldList.length > 0) {
          field_list = searchObj.data.stream.interestingFieldList.join(",");
        }
        if (searchObj.meta.sqlMode == true) {
          searchObj.data.query = searchObj.data.query.replace(
            /SELECT\s+(.*?)\s+FROM/gi,
            (match, fields) => {
              return `SELECT ${field_list} FROM`;
            },
          );
          setQuery(searchObj.meta.quickMode);
          updateUrlQueryParams();
        }
      }
    };

    //validate the data
    const isValid = (onlyChart = false, isFieldsValidationRequired = true) => {
      const errors = visualizeErrorData.errors;
      errors.splice(0);
      const dashboardData = dashboardPanelData;

      // check if name of panel is there
      if (!onlyChart) {
        if (
          dashboardData.data.title == null ||
          dashboardData.data.title.trim() == ""
        ) {
          errors.push("Name of Panel is required");
        }
      }

      // will push errors in errors array
      validatePanel(errors, isFieldsValidationRequired);

      if (errors.length) {
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
        return false;
      }
      return true;
    };

    const closeSearchHistoryfn = () => {
      router.back();
      showSearchHistory.value = false;
      refreshHistogramChart();
    };
    const closeSearchSchedulerFn = () => {
      router.back();
      showSearchScheduler.value = false;
    };

    const searchResponseForVisualization = ref({});

    const shouldUseHistogramQuery = ref(false);
    const shouldRefreshWithoutCache = ref(false);

    // Flag to prevent unnecessary chart type changes during URL restoration
    const isRestoringFromUrl = ref(false);

    // Flag to track if this is the first time switching to visualization mode
    const isFirstVisualizationToggle = ref(true);

    watch(
      () => [searchObj?.meta?.logsVisualizeToggle],
      async () => {
        try {
          if (searchObj.meta.logsVisualizeToggle == "visualize") {
            // Enable quick mode automatically when switching to visualization if:
            // 1. SQL mode is disabled OR
            // 2. Query is "SELECT * FROM some_stream" (simple select all query)
            // 3. Default quick mode config is true
            const shouldEnableQuickMode =
              !searchObj.meta.sqlMode ||
              isSimpleSelectAllQuery(searchObj.data.query);

            const isQuickModeDisabled = !searchObj.meta.quickMode;
            const isQuickModeConfigEnabled =
              store.state.zoConfig.quick_mode_enabled === true;

            if (
              shouldEnableQuickMode &&
              isQuickModeDisabled &&
              isQuickModeConfigEnabled
            ) {
              searchObj.meta.quickMode = true;
              handleQuickModeChange();
            }

            // close field list and splitter
            dashboardPanelData.layout.splitter = 0;
            dashboardPanelData.layout.showFieldList = false;

            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].customQuery = true;

            // Store current config and chart type to preserve them during rebuild
            const queryParams = router.currentRoute.value.query;
            let preservedConfig = null;
            let shouldAutoSelectChartType = true;
            // Always try to restore config from URL if present
            const visualizationDataParam = queryParams.visualization_data;
            if (
              visualizationDataParam &&
              typeof visualizationDataParam === "string"
            ) {
              try {
                const restoredData = decodeVisualizationConfig(
                  visualizationDataParam,
                );

                if (restoredData && typeof restoredData === "object") {
                  // Always restore config from URL on every toggle
                  if (
                    restoredData.config &&
                    typeof restoredData.config === "object"
                  ) {
                    preservedConfig = { ...restoredData.config };
                  }

                  // Only check for chart type from URL on first visualization toggle
                  if (
                    isFirstVisualizationToggle.value &&
                    restoredData.type &&
                    typeof restoredData.type === "string"
                  ) {
                    const validLogsChartTypes = [
                      "area",
                      "bar",
                      "h-bar",
                      "line",
                      "scatter",
                      "table",
                    ];
                    if (validLogsChartTypes.includes(restoredData.type)) {
                      // Valid chart type found in URL - set it and disable auto-selection
                      dashboardPanelData.data.type = restoredData.type;
                      shouldAutoSelectChartType = false;
                    }
                  }
                }
              } catch (error) {
                console.warn(
                  "Failed to restore visualization config from URL:",
                  error,
                );
              }
            }

            // Mark that we've processed the first toggle
            if (isFirstVisualizationToggle.value) {
              isFirstVisualizationToggle.value = false;
            }

            let logsPageQuery = "";

            // handle sql mode
            if (!searchObj.meta.sqlMode) {
              const queryBuild = buildSearch();
              logsPageQuery = queryBuild?.query?.sql ?? "";
            } else {
              logsPageQuery = searchObj.data.query;
            }

            // Check if query is SELECT * which is not supported for visualization
            if (
              store.state.zoConfig.quick_mode_enabled === true &&
              isSimpleSelectAllQuery(logsPageQuery)
            ) {
              showErrorNotification(
                "Select * query is not supported for visualization",
              );
              return;
            }

            // Use conditional auto-selection based on first toggle and URL chart type
            isRestoringFromUrl.value = true;
            shouldUseHistogramQuery.value = await extractVisualizationFields(
              shouldAutoSelectChartType,
            );

            // if not able to parse query, do not do anything
            if (shouldUseHistogramQuery.value === null) {
              return;
            }

            // set logs page data to searchResponseForVisualization
            if (shouldUseHistogramQuery.value === true) {
              // only do it if is_histogram_eligible is true on logs page
              // and showHistogram is true on logs page
              if (
                searchObj?.data?.queryResults?.is_histogram_eligible === true &&
                searchObj?.meta?.showHistogram === true
              ) {
                // replace hits with histogram query data
                searchResponseForVisualization.value = {
                  ...searchObj.data.queryResults,
                  hits: searchObj.data.queryResults.aggs,
                  histogram_interval:
                    searchObj?.data?.queryResults
                      ?.visualization_histogram_interval,
                };

                // assign converted_histogram_query to dashboardPanelData
                if (searchObj.data.queryResults.converted_histogram_query) {
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].query =
                    searchObj.data.queryResults.converted_histogram_query;

                  // assign to visualizeChartData as well
                  visualizeChartData.value.queries[0].query =
                    dashboardPanelData.data.queries[0].query;
                }
              }
            } else {
              searchResponseForVisualization.value = {
                ...searchObj.data.queryResults,
                histogram_interval:
                  searchObj?.data?.queryResults
                    ?.visualization_histogram_interval,
              };

              // if hits is empty and filteredHit is present, then set hits to filteredHit
              if (
                searchResponseForVisualization?.value?.hits?.length === 0 &&
                searchResponseForVisualization?.value?.filteredHit
              ) {
                searchResponseForVisualization.value.hits =
                  searchResponseForVisualization?.value?.filteredHit ?? [];
              }
            }

            // reset old rendered chart
            visualizeChartData.value = {};

            if (
              searchObj?.data?.customDownloadQueryObj?.query?.start_time &&
              searchObj?.data?.customDownloadQueryObj?.query?.end_time
            ) {
              dashboardPanelData.meta.dateTime = {
                start_time: new Date(
                  searchObj.data.customDownloadQueryObj.query.start_time,
                ),
                end_time: new Date(
                  searchObj.data.customDownloadQueryObj.query.end_time,
                ),
              };
            } else {
              // set date time
              const dateTime =
                searchObj.data.datetime.type === "relative"
                  ? getConsumableRelativeTime(
                      searchObj.data.datetime.relativeTimePeriod,
                    )
                  : cloneDeep(searchObj.data.datetime);

              dashboardPanelData.meta.dateTime = {
                start_time: new Date(dateTime.startTime),
                end_time: new Date(dateTime.endTime),
              };
            }

            // by default enable connect nulls to true for visualization
            // will overwrite if preservedConfig has connect_nulls config
            dashboardPanelData.data.config.connect_nulls = true;

            // Always restore preserved config after field extraction
            if (preservedConfig) {
              dashboardPanelData.data.config = {
                ...dashboardPanelData.data.config,
                ...preservedConfig,
              };
            }

            // run query
            await copyDashboardDataToVisualize();

            // Clear the restoration flag after all operations are complete
            await nextTick();
            isRestoringFromUrl.value = false;

            // set fields extraction loading to false
            variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;

            // emit resize event
            // this will rerender/call resize method of already rendered chart to resize
            window.dispatchEvent(new Event("resize"));

            // Sync visualization data to URL parameters when chart type changes
            if (searchObj.meta.logsVisualizeToggle === "visualize") {
              updateUrlQueryParams(dashboardPanelData);
            }
          } else {
            // reset dashboard panel data as we will rebuild when user came back to visualize
            // this fixes blank chart issue when user came back to visualize
            resetDashboardPanelData();
          }
        } catch (err: any) {
          // this will clear dummy trace id
          cancelFieldExtraction();

          if (err.name === "AbortError") {
            return;
          }

          // show error notification
          showErrorNotification(
            err.message ?? "Error in updating visualization",
          );
          return;
        }
      },
    );

    // Create debounced function for visualization updates
    const updateVisualization = async (autoSelectChartType: boolean = true) => {
      try {
        if (searchObj?.meta?.logsVisualizeToggle == "visualize") {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = true;

          // reset old rendered chart
          visualizeChartData.value = {};

          shouldUseHistogramQuery.value =
            await extractVisualizationFields(autoSelectChartType);

          // if not able to parse query, do not do anything
          if (shouldUseHistogramQuery.value === null) {
            return false;
          }

          // emit resize event
          // this will rerender/call resize method of already rendered chart to resize
          window.dispatchEvent(new Event("resize"));

          return true;
        }
      } catch (error) {
        throw error;
      }
    };

    watch(
      () => dashboardPanelData.data.type,
      async () => {
        // Skip processing if we're currently restoring from URL
        if (isRestoringFromUrl.value) {
          return;
        }

        const currentQuery =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].query;

        // reset searchResponseForVisualization
        searchResponseForVisualization.value = {};

        // update visualization
        await updateVisualization(false);

        // check if query is assigned and not empty
        // this prevents hard refresh early validation before query is assigned
        if (currentQuery && currentQuery.trim() !== "") {
          isValid(true, true);
        }

        // Sync visualization data to URL parameters when chart type changes
        if (searchObj.meta.logsVisualizeToggle === "visualize") {
          updateUrlQueryParams(dashboardPanelData);
        }
      },
    );

    watch(
      () => splitterModel.value,
      () => {
        // rerender chart
        window.dispatchEvent(new Event("resize"));
      },
    );

    // Auto-apply config changes that don't require API calls (similar to dashboard)
    const debouncedUpdateChartConfig = debounce(async (newVal) => {
      if (searchObj.meta.logsVisualizeToggle === "visualize") {
        let configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          visualizeChartData.value,
          newVal,
        );

        if (!configNeedsApiCall) {
          await copyDashboardDataToVisualize();
          window.dispatchEvent(new Event("resize"));
        }
      }
    }, 1000);

    watch(() => dashboardPanelData.data, debouncedUpdateChartConfig, {
      deep: true,
    });

    watch(
      () => [
        searchObj.data.datetime.type,
        searchObj.data.datetime,
        searchObj.data.datetime.relativeTimePeriod,
      ],
      async () => {
        const dateTime =
          searchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(
                searchObj.data.datetime.relativeTimePeriod,
              )
            : cloneDeep(searchObj.data.datetime);
      },
      { deep: true },
    );

    const handleRunQueryFn = async (clear_cache = false) => {
      if (searchObj.meta.logsVisualizeToggle == "visualize") {
        // Set the shouldRefreshWithoutCache flag
        shouldRefreshWithoutCache.value = clear_cache;
        // wait to extract fields if its ongoing; if promise rejects due to abort just return silently
        try {
          let logsPageQuery = "";

          // handle sql mode
          if (!searchObj.meta.sqlMode) {
            const queryBuild = buildSearch();
            logsPageQuery = queryBuild?.query?.sql ?? "";
          } else {
            logsPageQuery = searchObj.data.query;
          }

          // Check if query is SELECT * which is not supported for visualization
          if (
            store.state.zoConfig.quick_mode_enabled === true &&
            isSimpleSelectAllQuery(logsPageQuery)
          ) {
            showErrorNotification(
              "Select * query is not supported for visualization",
            );
            return;
          }

          const success = await updateVisualization(false);
          if (!success) {
            return;
          }
        } catch (err: any) {
          // this will clear dummy trace id
          cancelFieldExtraction();

          // Extraction was cancelled, so do not proceed further
          // if its abort, then do not show any error notification
          if (err.name === "AbortError") {
            return;
          }

          // show error notification
          showErrorNotification(
            err.message ?? "Error in updating visualization",
          );
          return;
        }

        const currentQuery =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].query;

        // check if query is assigned and not empty
        // this prevents hard refresh early validation before query is assigned
        if (currentQuery && currentQuery.trim() !== "") {
          isValid(true, true);
        }

        // reset searchResponseForVisualization
        searchResponseForVisualization.value = {};

        // refresh the date time
        searchBarRef.value &&
          searchBarRef.value.dateTimeRef &&
          searchBarRef.value.dateTimeRef.refresh();

        // set logsVisualizeDirtyFlag to true
        searchObj.meta.logsVisualizeDirtyFlag = true;

        const dateTime =
          searchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(
                searchObj.data.datetime.relativeTimePeriod,
              )
            : cloneDeep(searchObj.data.datetime);

        dashboardPanelData.meta.dateTime = {
          start_time: new Date(dateTime.startTime),
          end_time: new Date(dateTime.endTime),
        };

        await copyDashboardDataToVisualize();

        // Sync visualization config to URL parameters
        updateUrlQueryParams(dashboardPanelData);
      }

      if (searchObj.meta.logsVisualizeToggle == "patterns") {
        // Extract patterns when user clicks run query in patterns mode
        await extractPatternsForCurrentQuery(clear_cache);
      }
    };

    const handleChartApiError = (errorMessage: any) => {
      const errorList = visualizeErrorData.errors;
      errorList.splice(0);
      errorList.push(errorMessage);
    };

    // [START] cancel running queries

    //reactive object for loading state of variablesData and panels
    const variablesAndPanelsDataLoadingState = reactive({
      variablesData: {},
      panels: {},
      searchRequestTraceIds: {},
      fieldsExtractionLoading: false, // track custom field extraction progress
    });

    // -------------------------------------------------------------
    // Debounce helpers for field-extraction (50 ms)
    // -------------------------------------------------------------
    const FIELD_EXTRACTION_DEBOUNCE_TIME = 50;
    let fieldsExtractionAbortController: AbortController | null = null;

    /**
     * Waits for `FIELD_EXTRACTION_DEBOUNCE_TIME` ms unless the provided
     * `signal` is aborted – mirrors the debounce utility in
     * `usePanelDataLoader.ts`.
     */
    const waitForFieldExtractionTimeout = (signal: AbortSignal) => {
      return new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(resolve, FIELD_EXTRACTION_DEBOUNCE_TIME);

        signal.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    };

    // Helper function to copy dashboardPanelData while preserving stream info
    const copyDashboardDataToVisualize = async () => {
      // Extract and assign stream info BEFORE copying
      const currentQueryIndex = dashboardPanelData.layout.currentQueryIndex;
      const currentQuery = dashboardPanelData.data.queries[currentQueryIndex];

      if (currentQuery) {
        // Try to extract stream from the query if it exists
        let streamName = currentQuery.fields.stream;
        if (currentQuery.query) {
          const extractedStream = await getStreamFromQuery(currentQuery.query);
          if (extractedStream) {
            streamName = extractedStream;
          }
        }

        // Assign stream info to dashboardPanelData before copying
        dashboardPanelData.data.queries[currentQueryIndex].fields.stream = streamName;
        // stream_type should already be set, but ensure it's preserved
        if (!dashboardPanelData.data.queries[currentQueryIndex].fields.stream_type) {
          dashboardPanelData.data.queries[currentQueryIndex].fields.stream_type = "logs";
        }
      }

      // Now copy dashboardPanelData with updated stream info
      visualizeChartData.value = JSON.parse(
        JSON.stringify(dashboardPanelData.data),
      );
    };

    const extractVisualizationFields = async (
      autoSelectChartType: boolean = true,
    ) => {
      // mark extraction as in-progress so that cancel button is shown
      variablesAndPanelsDataLoadingState.fieldsExtractionLoading = true;

      // Abort any previous extraction if still running
      if (fieldsExtractionAbortController) {
        fieldsExtractionAbortController.abort();
      }

      // Create a fresh AbortController for this cycle
      fieldsExtractionAbortController = new AbortController();
      const signal = fieldsExtractionAbortController.signal;

      // Debounce – wait briefly before starting expensive operations.
      // If the call is aborted during the wait window, simply exit.
      try {
        await waitForFieldExtractionTimeout(signal);
      } catch (e: any) {
        if (e?.name === "AbortError") {
          return null; // previous invocation cancelled
        }
        throw e;
      }

      // Exit early if a newer invocation already aborted this one
      if (signal.aborted) {
        return null;
      }

      const checkAbort = () => {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
      };

      try {
        let logsPageQuery = "";

        // handle sql mode
        if (!searchObj.meta.sqlMode) {
          const queryBuild = buildSearch();
          logsPageQuery = queryBuild?.query?.sql ?? "";
        } else {
          logsPageQuery = searchObj.data.query;
        }

        // return if query is empty and stream is not selected
        if (
          logsPageQuery === "" &&
          searchObj?.data?.stream?.selectedStream?.length === 0
        ) {
          showErrorNotification(
            "Query is empty, please write query to visualize",
          );
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        // check if query is empty
        if (logsPageQuery === "") {
          showErrorNotification(
            "Query is empty, please write query to visualize",
          );
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        // if multiple sql, then do not allow to visualize
        if (
          logsPageQuery &&
          Array.isArray(logsPageQuery) &&
          logsPageQuery.length > 1
        ) {
          showErrorNotification(
            "Multiple SQL queries are not allowed to visualize",
          );
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        /* ------------------------------------------------------------- */
        /* 1) Fetch schema for the user query                            */
        /* ------------------------------------------------------------- */
        const timestamps = dashboardPanelData.meta.dateTime;
        let startISOTimestamp: number | undefined;
        let endISOTimestamp: number | undefined;

        if (
          timestamps?.start_time &&
          timestamps?.end_time &&
          timestamps.start_time != "Invalid Date" &&
          timestamps.end_time != "Invalid Date"
        ) {
          startISOTimestamp = new Date(
            timestamps.start_time.toISOString(),
          ).getTime();
          endISOTimestamp = new Date(
            timestamps.end_time.toISOString(),
          ).getTime();
        }

        checkAbort();

        // Handle schema caching in Index.vue
        let extractedFields;

        // Check if we have a cached response for this query
        if (schemaCache?.value && schemaCache?.value?.key === logsPageQuery) {
          extractedFields = schemaCache?.value?.response?.data;
        } else {
          // Use the refactored getResultSchema function
          extractedFields = await getResultSchema(
            logsPageQuery,
            signal,
            startISOTimestamp,
            endISOTimestamp,
          );

          // Cache the response
          schemaCache.value = {
            key: logsPageQuery,
            response: { data: extractedFields },
          };
        }

        checkAbort();

        /* Decide whether to use histogram query - don't use for table charts or when there are group_by fields */
        shouldUseHistogramQuery.value =
          dashboardPanelData.data.type !== "table" &&
          !(extractedFields?.group_by && extractedFields.group_by.length);

        const finalQuery = logsPageQuery;

        if (!finalQuery) {
          showErrorNotification(
            "Query is empty, please write query to visualize",
          );
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].query = finalQuery;

        const allFieldsHaveAlias = allSelectionFieldsHaveAlias(finalQuery);
        if (!allFieldsHaveAlias) {
          showAliasErrorForVisualization(
            "Fields using aggregation functions must have aliases to visualize.",
          );
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        /* Populate fields & axes */
        // For histogram queries, we need to modify the extractedFields to match the actual query structure
        let fieldsForVisualization = extractedFields;
        if (shouldUseHistogramQuery.value) {
          // For histogram query, override the extracted fields to match the histogram structure
          fieldsForVisualization = {
            group_by: ["zo_sql_key"], // histogram field is grouped by zo_sql_key
            projections: ["zo_sql_key", "zo_sql_num"], // histogram returns zo_sql_key and zo_sql_num
            timeseries_field: "zo_sql_key", // zo_sql_key is the time field in histogram
          };
        }

        // Use the refactored functions
        await setCustomQueryFields(
          fieldsForVisualization,
          autoSelectChartType,
          signal,
        );

        await copyDashboardDataToVisualize();

        return shouldUseHistogramQuery.value;
      } catch (err) {
        visualizeErrorData.errors.splice(0);
        visualizeErrorData.errors.push(err.response?.data?.message);
        variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
        throw err;
      }
    };

    // Helper to abort any ongoing field-extraction operation
    const cancelFieldExtraction = () => {
      if (fieldsExtractionAbortController) {
        fieldsExtractionAbortController.abort();
      }
      variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
    };

    // Listen to global cancelQuery event (fired by useCancelQuery composable)
    onMounted(() => {
      window.addEventListener("cancelQuery", cancelFieldExtraction);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("cancelQuery", cancelFieldExtraction);
    });

    // provide variablesAndPanelsDataLoadingState to share data between components
    provide(
      "variablesAndPanelsDataLoadingState",
      variablesAndPanelsDataLoadingState,
    );

    // ---------------------------------------------------------------------
    // WATCHERS
    // ---------------------------------------------------------------------

    // Reset the `fieldsExtractionLoading` flag the moment the first search
    // request (for data retrieval) is issued. This is detected via the
    // presence of at least one trace-id recorded in
    // `variablesAndPanelsDataLoadingState.searchRequestTraceIds`.
    watch(
      () =>
        Object.values(
          variablesAndPanelsDataLoadingState?.searchRequestTraceIds ?? {},
        )?.flat()?.length,
      (totalActiveTraceIds) => {
        if (totalActiveTraceIds > 0) {
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
        }
      },
    );

    // [END] cancel running queries

    const cancelOnGoingSearchQueries = () => {
      sendCancelSearchMessage(searchObj.data.searchWebSocketTraceIds);
    };

    // [START] O2 AI Context Handler

    const registerAiContextHandler = () => {
      registerAiChatHandler(getContext);
    };

    const getContext = async () => {
      return new Promise(async (resolve, reject) => {
        try {
          const isLogsPage = router.currentRoute.value.name === "logs";

          const isStreamSelectedInLogsPage =
            searchObj.meta.logsVisualizeToggle === "logs" &&
            searchObj.data.stream.selectedStream.length;

          const isStreamSelectedInDashboardPage =
            searchObj.meta.logsVisualizeToggle === "visualize" &&
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream;

          if (
            !isLogsPage ||
            !(isStreamSelectedInLogsPage || isStreamSelectedInDashboardPage)
          ) {
            resolve("");
            return;
          }

          const payload = {};

          const streams =
            searchObj.meta.logsVisualizeToggle === "logs"
              ? searchObj.data.stream.selectedStream
              : [
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].fields.stream,
                ];

          const streamType =
            searchObj.meta.logsVisualizeToggle === "logs"
              ? searchObj.data.stream.streamType
              : dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.stream_type;

          if (!streamType || !streams?.length) {
            resolve("");
            return;
          }

          for (let i = 0; i < streams.length; i++) {
            const schema = await getStream(streams[i], streamType, true);
            //here we are deep copying the schema before assiging it to schemaData so that we dont mutatat the orginial data
            //if we do this we dont get duplicate fields in the schema
            let schemaData = deepCopy(schema.uds_schema || schema.schema || []);
            let isUdsEnabled = schema.uds_schema?.length > 0;
            //we only push the timestamp and all fields name in the schema if uds is enabled for that stream
            if (isUdsEnabled) {
              let timestampColumn = store.state.zoConfig.timestamp_column;
              let allFieldsName = store.state.zoConfig.all_fields_name;
              schemaData.push({
                name: timestampColumn,
                type: "Int64",
              });
              schemaData.push({
                name: allFieldsName,
                type: "Utf8",
              });
            }
            payload["stream_name_" + (i + 1)] = streams[i];
            payload["schema_" + (i + 1)] = schemaData;
          }

          resolve(payload);
        } catch (error) {
          console.error("Error in getContext for logs page", error);
          resolve("");
        }
      });
    };

    const removeAiContextHandler = () => {
      removeAiChatHandler();
    };

    // [END] O2 AI Context Handler

    // [START] Context Provider Setup

    /**
     * Setup the logs context provider for AI chat integration
     *
     * Example: When user opens logs page, this registers the context provider
     * that will extract current search state and comprehensive schema information for AI context
     * Follows the same schema extraction pattern as legacy AI context system
     */
    const setupContextProvider = () => {
      const provider = createLogsContextProvider(
        searchObj,
        store,
        dashboardPanelData,
      );

      contextRegistry.register("logs", provider);
      contextRegistry.setActive("logs");
    };

    /**
     * Cleanup logs context provider when leaving logs page
     *
     * Example: When user navigates away from logs, this deactivates the logs provider
     * but keeps the default provider available for fallback
     */
    const cleanupContextProvider = () => {
      // Only unregister the logs provider, keep default provider
      contextRegistry.unregister("logs");
      // Reset to no active provider, so it falls back to default
      contextRegistry.setActive("");
    };

    // [END] Context Provider Setup

    const sendToAiChat = (value: any) => {
      emit("sendToAiChat", value);
    };

    const clearAllTimeouts = () => {
      if (chartRedrawTimeout.value) {
        clearTimeout(chartRedrawTimeout.value);
        chartRedrawTimeout.value = null;
      }
      if (updateColumnsTimeout.value) {
        clearTimeout(updateColumnsTimeout.value);
        updateColumnsTimeout.value = null;
      }
    };

    return {
      t,
      store,
      router,
      searchObj,
      searchBarRef,
      splitterModel,
      // loadPageData,
      getQueryData,
      getJobData,
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
      refreshHistogramChart,
      onChangeInterval,
      onAutoIntervalTrigger,
      showSearchHistory,
      showSearchHistoryfn,
      redirectBackToLogs,
      handleRunQuery,
      refreshTimezone,
      getHistogramQueryData,
      generateHistogramSkeleton,
      setInterestingFieldInSQLQuery,
      handleQuickModeChange,
      handleRunQueryFn,
      visualizeChartData,
      handleChartApiError,
      visualizeErrorData,
      disableMoreErrorDetails,
      closeSearchHistoryfn,
      resetHistogramWithError,
      fnParsedSQL,
      isLimitQuery,
      buildWebSocketPayload,
      initializeSearchConnection,
      addTraceId,
      isWebSocketEnabled,
      showJobScheduler,
      showSearchScheduler,
      closeSearchSchedulerFn,
      isDistinctQuery,
      isWithQuery,
      isStreamingEnabled,
      setCommunicationMethod,
      sendToAiChat,
      processInterestingFiledInSQLQuery,
      removeFieldByName,
      dashboardPanelData,
      processHttpHistogramResults,
      searchResponseForVisualization,
      shouldUseHistogramQuery,
      shouldRefreshWithoutCache,
      clearSchemaCache,
      getHistogramData,
      extractPatternsForCurrentQuery,
      patternsState,
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
    refreshHistogram() {
      return this.searchObj.meta.histogramDirtyFlag;
    },
    redrawHistogram() {
      return (
        this.searchObj.data.histogram.hasOwnProperty("xData") &&
        this.searchObj.data.histogram.xData.length
      );
    },
  },
  watch: {
    showFields() {
      if (
        this.searchObj.meta.showHistogram == true &&
        this.searchObj.meta.sqlMode == false
      ) {
        // Clear any existing timeout
        if (this.chartRedrawTimeout) {
          clearTimeout(this.chartRedrawTimeout);
        }
        this.chartRedrawTimeout = setTimeout(() => {
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
    async showHistogram(newVal, oldVal) {
      if (
        newVal == true &&
        oldVal == false &&
        this.searchObj.meta?.histogramDirtyFlag == true &&
        this.searchObj.data.queryResults?.hits?.length > 0
      ) {
        this.searchObj.meta.resetPlotChart = true;
        this.searchObj.data.queryResults.aggs = [];
      }

      let parsedSQL = null;

      if (this.searchObj.meta.sqlMode) parsedSQL = this.fnParsedSQL();

      if (
        this.searchObj.meta?.showHistogram &&
        !this.searchObj?.shouldIgnoreWatcher
      ) {
        this.searchObj.data.queryResults.aggs = [];

        if (this.searchObj.meta.sqlMode && this.isLimitQuery(parsedSQL)) {
          this.resetHistogramWithError(
            "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
            -1,
          );
          this.searchObj.meta.histogramDirtyFlag = false;
        } else if (
          this.searchObj.meta.sqlMode &&
          (this.isDistinctQuery(parsedSQL) || this.isWithQuery(parsedSQL))
        ) {
          this.resetHistogramWithError(
            "Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.",
            -1,
          );
          this.searchObj.meta.histogramDirtyFlag = false;
        } else if (
          this.searchObj.data.stream.selectedStream.length > 1 &&
          this.searchObj.meta.sqlMode == true
        ) {
          this.resetHistogramWithError(
            "Histogram is not available for multi stream search.",
          );
        } else if (
          this.searchObj.data.queryResults.is_histogram_eligible == false
        ) {
          this.resetHistogramWithError(
            "Histogram unavailable for CTEs, DISTINCT and LIMIT queries.",
            -1,
          );
          this.searchObj.meta.histogramDirtyFlag = false;
        } else if (
          this.searchObj.meta.histogramDirtyFlag == true &&
          this.searchObj.meta.jobId == ""
        ) {
          this.searchObj.meta.histogramDirtyFlag = false;

          // Generate histogram skeleton before making request
          await this.generateHistogramSkeleton();

          this.getHistogramData(this.searchObj.data.histogramQuery);
        }
      }

      this.updateUrlQueryParams();
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
      // Clear any existing timeout
      if (this.updateColumnsTimeout) {
        clearTimeout(this.updateColumnsTimeout);
      }
      this.updateColumnsTimeout = setTimeout(() => {
        this.updateGridColumns();
      }, 50);
    },
    runQuery() {
      if (this.store.state.savedViewFlag == true) return;
      if (this.searchObj.runQuery == true) {
        this.runQueryFn();
      }
    },
    async fullSQLMode(newVal) {
      if (newVal) {
        await nextTick();
        if (this.searchObj.meta.sqlModeManualTrigger) {
          this.searchObj.meta.sqlModeManualTrigger = false;
        } else {
          this.setQuery(newVal);
          this.updateUrlQueryParams();
        }
      } else {
        this.searchObj.meta.sqlMode = false;
        this.searchObj.data.query = "";
        this.searchObj.data.editorValue = "";
        if (
          this.searchObj.loading == false &&
          this.searchObj.shouldIgnoreWatcher == false &&
          this.store.state.zoConfig.query_on_stream_selection == false
        ) {
          this.searchObj.loading = true;
          this.getQueryData();
        }
      }
      // this.searchResultRef.reDrawChart();
    },
    refreshHistogram() {
      if (
        this.searchObj.meta.histogramDirtyFlag == true &&
        this.searchObj.meta.showHistogram == true
      ) {
        this.searchObj.meta.histogramDirtyFlag = false;
        this.handleRunQuery();
        this.refreshHistogramChart();
      }
    },
    redrawHistogram() {
      this.refreshHistogramChart();
    },
  },
}) as any;
</script>

<style lang="scss">
.logPage {
  height: calc(100vh - $navbarHeight);
  min-height: calc(100vh - $navbarHeight) !important;
  max-height: calc(100vh - $navbarHeight) !important;
  overflow: hidden !important;

  .index-menu .field_list .field_overlay .field_label,
  .q-field__native,
  .q-field__input,
  .q-table tbody td {
    font-size: 12px !important;
  }

  .q-splitter__after {
    overflow: hidden;
  }

  .q-table__top {
    padding: 0px !important;
  }

  .q-table__control {
    width: 100%;
  }

  .logsPageMainSection > .q-field__control-container {
    padding-top: 0px !important;
  }

  .thirdlevel {
    padding: 0 !important;
    margin: 0 !important;
    box-sizing: border-box !important;
    height: 100% !important;
    overflow: visible !important; /* Changed from hidden to visible for button */
  }

  .logs-horizontal-splitter .q-splitter__before {
    z-index: auto;
    overflow: visible;
  }

  // .search-result-container {
  //   position: relative;
  //   width: 100%;
  //   height: 100%;
  //   padding: 0 !important;
  //   margin: 0 !important;
  //   box-sizing: border-box !important;
  //   overflow: hidden !important;
  // }
}
</style>

<style lang="scss">
@import "@/styles/logs/logs-page.scss";
</style>
