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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div class="col column full-height" style="overflow: hidden !important; padding: 0 !important; margin: 0 !important; height: 100%;">
    <div
      class="search-list full-height full-width"
      ref="searchListContainer"
    >
      <div class="row tw-min-h-[28px]">
        <div
          class="col-7 text-left q-pl-lg bg-warning text-white rounded-borders"
          v-if="searchObj.data.countErrorMsg != ''"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-total-count-error-message"
            :htmlContent="searchObj.data.countErrorMsg"
          />
        </div>
        <div
          v-else
          class="col-7 text-left q-pl-lg warning flex items-center"
        >
          {{ noOfRecordsTitle }}
          <span v-if="searchObj.loadingCounter" class="q-ml-md">
            <q-spinner-hourglass
              color="primary"
              size="25px"
              class="search-spinner"
            />
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="300px"
            >
              <span class="search-loading-text">Fetching the search events</span>
            </q-tooltip>
          </span>
          <div
            v-else-if="
              searchObj.data.histogram.errorCode == -1 &&
              !searchObj.loadingCounter &&
              searchObj.meta.showHistogram
            "
            class="q-ml-md tw-cursor-pointer"
            :class="
              store.state.theme == 'dark'
                ? 'histogram-unavailable-text'
                : 'histogram-unavailable-text-light'
            "
          >
            <!-- {{ searchObj.data.histogram.errorMsg }} -->
            <q-icon name="info" color="warning" size="sm"> </q-icon>
            <q-tooltip position="top" class="tw-text-sm tw-font-semi-bold">
              {{ searchObj.data.histogram.errorMsg }}
            </q-tooltip>
          </div>
        </div>

        <div class="col-5 text-right q-pr-sm q-gutter-xs pagination-block">
          <q-pagination
            v-if="searchObj.meta.resultGrid.showPagination"
            :disable="searchObj.loading == true"
            v-model="pageNumberInput"
            :key="
              searchObj.data.queryResults.total +
              '-' +
              searchObj.data.resultGrid.currentPage
            "
            :max="
              Math.max(
                1,
                (searchObj.communicationMethod === 'ws' ||
                searchObj.communicationMethod === 'streaming' ||
                searchObj.meta.jobId != ''
                  ? searchObj.data.queryResults?.pagination?.length
                  : searchObj.data.queryResults?.partitionDetail?.paginations
                      ?.length) || 0,
              )
            "
            :input="false"
            direction-links
            :boundary-numbers="false"
            :max-pages="5"
            :ellipses="false"
            icon-first="skip_previous"
            icon-last="skip_next"
            icon-prev="fast_rewind"
            icon-next="fast_forward"
            class="float-right paginator-section"
            @update:model-value="getPageData('pageChange')"
            rowsPerPageLabel="Rows per page"
            :rows-per-page-options="rowsPerPageOptions"
            :rows-per-page="searchObj.meta.resultGrid.rowsPerPage"
            data-test="logs-search-result-pagination"
          />
          <q-select
            v-if="searchObj.meta.resultGrid.showPagination"
            data-test="logs-search-result-records-per-page"
            v-model="searchObj.meta.resultGrid.rowsPerPage"
            :options="rowsPerPageOptions"
            class="float-right select-pagination"
            size="sm"
            dense
            borderless
            @update:model-value="getPageData('recordsPerPage')"
          ></q-select>
        </div>
      </div>
      <div
        :class="[
          'histogram-container',
          searchObj.meta.showHistogram ? 'histogram-container--visible' : 'histogram-container--hidden'
        ]"
        v-if="
          searchObj.data?.histogram?.errorMsg == '' &&
          searchObj.data.histogram.errorCode != -1
        "
      >
        <ChartRenderer
          v-if="
            searchObj.meta.showHistogram &&
            (searchObj.data?.queryResults?.aggs?.length > 0 ||
              (plotChart && Object.keys(plotChart)?.length > 0))
          "
          data-test="logs-search-result-bar-chart"
          :data="plotChart"
          class="histogram-chart"
          @updated:dataZoom="onChartUpdate"
        />

        <div
          class="histogram-empty"
          v-else-if="
            searchObj.meta.showHistogram &&
            !searchObj.loadingHistogram &&
            !searchObj.loading
          "
        >
          <h3 class="text-center">
            <span class="histogram-empty__message">
              <q-icon name="warning" color="warning" size="xs"></q-icon> No data
              found for histogram.</span
            >
          </h3>
        </div>

        <div
          class="histogram-empty"
          v-else-if="
            searchObj.meta.showHistogram && Object.keys(plotChart)?.length === 0
          "
        >
          <h3 class="text-center">
            <span class="histogram-empty__message" style="color: transparent">.</span>
          </h3>
        </div>

        <div
          class="q-pb-sm histogram-loader"
          v-if="histogramLoader"
        >
          <q-spinner-hourglass
            color="primary"
            size="25px"
            class="search-spinner"
          />
        </div>
      </div>
      <div
        v-else-if="
          searchObj.data.histogram?.errorMsg != '' &&
          searchObj.meta.showHistogram &&
          searchObj.data.histogram.errorCode != -1
        "
      >
        <h6
          class="text-center histogram-error"
          v-if="
            searchObj.data.histogram.errorCode != 0 &&
            searchObj.data.histogram.errorCode != -1
          "
        >
          <q-icon name="warning" color="warning" size="xs"></q-icon> Error while
          fetching histogram data.
          <q-btn
            @click="toggleErrorDetails"
            size="sm"
            data-test="logs-page-histogram-error-details-btn"
            >{{ t("search.histogramErrorBtnLabel") }}</q-btn
          ><br />
          <span v-if="disableMoreErrorDetails">
            <SanitizedHtmlRenderer
              data-test="logs-search-histogram-error-message"
              :htmlContent="searchObj.data?.histogram?.errorMsg"
            />
          </span>
        </h6>
        <h6
          class="text-center"
          v-else-if="searchObj.data.histogram.errorCode != -1"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-histogram-error-message"
            :htmlContent="searchObj.data?.histogram?.errorMsg"
          />
        </h6>
      </div>
      <tenstack-table
        ref="searchTableRef"
        :columns="getColumns || []"
        :rows="searchObj.data.queryResults?.hits || []"
        :wrap="searchObj.meta.toggleSourceWrap"
        :width="getTableWidth"
        :err-msg="searchObj.data.missingStreamMessage"
        :loading="searchObj.loading"
        :functionErrorMsg="searchObj?.data?.functionError"
        :expandedRows="expandedLogs"
        :highlight-timestamp="searchObj.data?.searchAround?.indexTimestamp"
        :selected-stream-fts-keys="selectedStreamFullTextSearchKeys"
        :highlight-query="
          searchObj.meta.sqlMode
            ? searchObj.data.query.toLowerCase().split('where')[1]
            : searchObj.data.query.toLowerCase()
        "
        :default-columns="!searchObj.data.stream.selectedFields.length"
        class="col-12"
        :class="[
          !searchObj.meta.showHistogram ||
          (searchObj.meta.showHistogram &&
            searchObj.data.histogram.errorCode == -1)
            ? 'table-container--without-histogram'
            : 'table-container--with-histogram'
        ]"
        @update:columnSizes="handleColumnSizesUpdate"
        @update:columnOrder="handleColumnOrderUpdate"
        @copy="copyLogToClipboard"
        @add-field-to-table="addFieldToTable"
        @add-search-term="addSearchTerm"
        @close-column="closeColumn"
        @click:data-row="openLogDetails"
        @expand-row="expandLog"
        @send-to-ai-chat="sendToAiChat"
        @view-trace="redirectToTraces"
      />

      <q-dialog
        data-test="logs-search-result-detail-dialog"
        v-model="searchObj.meta.showDetailTab"
        position="right"
        full-height
        maximized
        @escap.stop="reDrawChart"
        @hide="reDrawChart"
        @before-hide="reDrawChart"
      >
        <DetailTable
          v-if="searchObj.data.queryResults?.hits?.length"
          :key="
            'dialog_' + searchObj.meta.resultGrid.navigation.currentRowIndex
          "
          v-model="
            searchObj.data.queryResults.hits[
              searchObj.meta.resultGrid.navigation.currentRowIndex
            ]
          "
          :stream-type="searchObj.data.stream.streamType"
          class="detail-table-dialog"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex"
          :totalLength="parseInt(searchObj.data.queryResults.hits.length)"
          :highlight-query="
            searchObj.meta.sqlMode
              ? searchObj.data.query.toLowerCase().split('where')[1]
              : searchObj.data.query.toLowerCase()
          "
          @showNextDetail="navigateRowDetail"
          @showPrevDetail="navigateRowDetail"
          @add:searchterm="addSearchTerm"
          @remove:searchterm="removeSearchTerm"
          @search:timeboxed="onTimeBoxed"
          @add:table="addFieldToTable"
          @view-trace="
            redirectToTraces(
              searchObj.data.queryResults.hits[
                searchObj.meta.resultGrid.navigation.currentRowIndex
              ],
            )
          "
          @sendToAiChat="sendToAiChat"
          @closeTable="closeTable"
        />
      </q-dialog>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  onMounted,
  onUpdated,
  defineAsyncComponent,
  watch,
} from "vue";
import { copyToClipboard, useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import HighLight from "../../components/HighLight.vue";
import { byString } from "../../utils/json";
import { getImageURL, useLocalWrapContent } from "../../utils/zincutils";
import useLogs from "../../composables/useLogs";
import {useSearchStream} from "@/composables/useLogs/useSearchStream";
import { convertLogData } from "@/utils/logs/convertLogData";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { useRouter } from "vue-router";
import TenstackTable from "./TenstackTable.vue";
import { useSearchAround } from "@/composables/useLogs/searchAround";
import { usePagination } from "@/composables/useLogs/usePagination";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import { searchState } from "@/composables/useLogs/searchState";

export default defineComponent({
  name: "SearchResult",
  components: {
    DetailTable: defineAsyncComponent(() => import("./DetailTable.vue")),
    ChartRenderer: defineAsyncComponent(
      () => import("@/components/dashboards/panels/ChartRenderer.vue"),
    ),
    SanitizedHtmlRenderer,
    TenstackTable: defineAsyncComponent(() => import("./TenstackTable.vue")),
  },
  emits: [
    "update:scroll",
    "update:datetime",
    "remove:searchTerm",
    "search:timeboxed",
    "expandlog",
    "update:recordsPerPage",
    "update:columnSizes",
    "sendToAiChat",
  ],
  props: {
    expandedLogs: {
      type: Array,
      default: () => [],
    },
  },
  methods: {
    handleColumnSizesUpdate(newColSizes: any) {
      const prevColSizes =
        this.searchObj.data.resultGrid?.colSizes[
          this.searchObj.data.stream.selectedStream
        ]?.[0] || {};
      this.searchObj.data.resultGrid.colSizes[
        this.searchObj.data.stream.selectedStream
      ] = [
        {
          ...prevColSizes,
          ...newColSizes,
        },
      ];
    },
    handleColumnOrderUpdate(newColOrder: string[], columns: any[]) {
      // Here we are checking if the columns are default columns ( _timestamp and source)
      // If selected fields are empty, then we are setting colOrder to empty array as we
      // don't change the order of default columns
      // If you store the colOrder it will create issue when you save the view and load it again

      if (!this.searchObj.data.stream.selectedFields.length) {
        this.searchObj.data.resultGrid.colOrder[
          this.searchObj.data.stream.selectedStream
        ] = [];
      } else {
        this.searchObj.data.resultGrid.colOrder[
          this.searchObj.data.stream.selectedStream
        ] = [...newColOrder];

        if(newColOrder.length > 0){
          this.searchObj.organizationIdentifier =
            this.store.state.selectedOrganization.identifier;
          let selectedFields = this.reorderSelectedFields();

          this.searchObj.data.stream.selectedFields = selectedFields;
          this.updatedLocalLogFilterField();
        }
      }
    },

    getPageData(actionType: string) {
      if (actionType == "prev") {
        if (this.searchObj.data.resultGrid.currentPage > 1) {
          this.searchObj.data.resultGrid.currentPage =
            this.searchObj.data.resultGrid.currentPage - 1;
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          this.$emit("update:scroll");
          this.scrollTableToTop(0);
        }
      } else if (actionType == "next") {
        if (
          this.searchObj.data.resultGrid.currentPage <=
          Math.round(
            this.searchObj.data.queryResults.total /
              this.searchObj.meta.resultGrid.rowsPerPage,
          )
        ) {
          this.searchObj.data.resultGrid.currentPage =
            this.searchObj.data.resultGrid.currentPage + 1;
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          this.$emit("update:scroll");
          this.scrollTableToTop(0);
        }
      } else if (actionType == "recordsPerPage") {
        this.searchObj.data.resultGrid.currentPage = 1;
        this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
        if (
          this.searchObj.communicationMethod === "ws" ||
          this.searchObj.communicationMethod === "streaming"
        ) {
          if (this.searchObj.meta.jobId == "") {
            this.refreshPagination();
          } else {
            this.refreshJobPagination();
          }
        } else {
          if (this.searchObj.meta.jobId !== "") {
            this.refreshJobPagination();
          } else {
            this.refreshPartitionPagination(true);
          }
        }
        this.$emit("update:recordsPerPage");
        this.scrollTableToTop(0);
      } else if (actionType == "pageChange") {
        //here at first the queryResults is undefined so we are checking if it is undefined then we are setting it to empty array
        if (
          this.searchObj.meta.jobId != "" &&
          this.searchObj.data.queryResults.paginations == undefined
        ) {
          this.searchObj.data.queryResults.pagination = [];
        }
        const maxPages =
          this.searchObj.communicationMethod === "ws" ||
          this.searchObj.communicationMethod === "streaming" ||
          this.searchObj.meta.jobId != ""
            ? this.searchObj.data.queryResults.pagination.length
            : this.searchObj.data.queryResults?.partitionDetail?.paginations
                .length;
        if (
          this.pageNumberInput > Math.ceil(maxPages) &&
          this.searchObj.meta.jobId == ""
        ) {
          this.$q.notify({
            type: "negative",
            message:
              "Page number is out of range. Please provide valid page number.",
            timeout: 1000,
          });
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          return false;
        }

        this.searchObj.data.resultGrid.currentPage = this.pageNumberInput;
        this.$emit("update:scroll");
        this.scrollTableToTop(0);
      }
    },
    closeColumn(col: any) {
      let selectedFields = this.reorderSelectedFields();

      const RGIndex = this.searchObj.data.resultGrid.columns.indexOf(col.id);
      this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = selectedFields.indexOf(col.name);

      selectedFields.splice(SFIndex, 1);

      this.searchObj.data.stream.selectedFields = selectedFields;

      this.searchObj.organizationIdentifier =
        this.store.state.selectedOrganization.identifier;
      this.updatedLocalLogFilterField();
    },
    onChartUpdate({ start, end }: { start: any; end: any }) {
      this.searchObj.meta.showDetailTab = false;
      this.$emit("update:datetime", { start, end });
    },
    onTimeBoxed(obj: any) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.data.searchAround.indexTimestamp = obj.key;
      // this.$emit("search:timeboxed", obj);
      this.searchAroundData(obj);
    },
    toggleErrorDetails() {
      this.disableMoreErrorDetails = !this.disableMoreErrorDetails;
    },
  },
  setup(props, { emit }) {
    // Accessing nested JavaScript objects and arrays by string path
    // https://stackoverflow.com/questions/6491463/accessing-nested-javascript-objects-and-arrays-by-string-path
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const searchListContainer = ref(null);
    const noOfRecordsTitle = ref("");
    const scrollPosition = ref(0);
    const rowsPerPageOptions = [10, 25, 50, 100];
    const disableMoreErrorDetails = ref(false);
    const router = useRouter();
    const { searchAroundData } = useSearchAround();
    const { refreshPagination } = useSearchStream();
    const { refreshPartitionPagination, refreshJobPagination } = usePagination();
    const { updatedLocalLogFilterField } = logsUtils();
    const { extractFTSFields, filterHitsColumns } = useStreamFields();

    const {
      reorderSelectedFields,
      getFilterExpressionByFieldType,
    } = useLogs();

    const { searchObj } = searchState();

    const pageNumberInput = ref(1);
    const totalHeight = ref(0);

    const searchTableRef: any = ref(null);

    const plotChart: any = ref({});

    onMounted(() => {
      reDrawChart();
    });

    onUpdated(() => {
      pageNumberInput.value = searchObj.data.resultGrid.currentPage;
    });
    const columnSizes = ref({});

    const reDrawChart = () => {
      if (
        // eslint-disable-next-line no-prototype-builtins
        searchObj.data.histogram.hasOwnProperty("xData") &&
        searchObj.data.histogram.xData.length > 0
        // && plotChart.value?.reDraw
      ) {
        //format data in form of echarts options
        plotChart.value = convertLogData(
          searchObj.data.histogram.xData,
          searchObj.data.histogram.yData,
          searchObj.data.histogram.chartParams,
        );
        // plotChart.value.forceReLayout();
      }
    };

    const changeMaxRecordToReturn = (val: any) => {
      // searchObj.meta.resultGrid.pagination.rowsPerPage = val;
    };

    const openLogDetails = (props: any, index: number) => {
      searchObj.meta.showDetailTab = true;
      searchObj.meta.resultGrid.navigation.currentRowIndex = index;
    };

    const getRowIndex = (next: boolean, prev: boolean, oldIndex: number) => {
      if (next) {
        return oldIndex + 1;
      } else {
        return oldIndex - 1;
      }
    };

    const navigateRowDetail = (isNext: boolean, isPrev: boolean) => {
      const newIndex = getRowIndex(
        isNext,
        isPrev,
        Number(searchObj.meta.resultGrid.navigation.currentRowIndex),
      );
      searchObj.meta.resultGrid.navigation.currentRowIndex = newIndex;
    };

    const addSearchTerm = (
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) => {
      const searchExpression = getFilterExpressionByFieldType(
        field,
        field_value,
        action,
      );
      searchObj.data.stream.addToFilter = searchExpression;
    };

    const removeSearchTerm = (term: string) => {
      emit("remove:searchTerm", term);
    };

    const expandLog = async (index: number) => {
      emit("expandlog", index);
    };

    const getWidth = computed(() => {
      return "";
    });

    function addFieldToTable(fieldName: string) {
      if (searchObj.data.stream.selectedFields.includes(fieldName)) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter(
            (v: any) => v !== fieldName,
          );
      } else {
        searchObj.data.stream.selectedFields.push(fieldName);
      }
      searchObj.organizationIdentifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    const copyLogToClipboard = (log: any, copyAsJson: boolean = true) => {
      const copyData = copyAsJson ? JSON.stringify(log) : log;
      copyToClipboard(copyData).then(() =>
        $q.notify({
          type: "positive",
          message: "Content Copied Successfully!",
          timeout: 1000,
        }),
      );
    };

    const redirectToTraces = (log: any) => {
      // 15 mins +- from the log timestamp
      const from = log[store.state.zoConfig.timestamp_column] - 900000000;
      const to = log[store.state.zoConfig.timestamp_column] + 900000000;
      const refresh = 0;

      const query: any = {
        name: "traceDetails",
        query: {
          stream: searchObj.meta.selectedTraceStream,
          from,
          to,
          refresh,
          org_identifier: store.state.selectedOrganization.identifier,
          trace_id:
            log[
              store.state.organizationData.organizationSettings
                .trace_id_field_name
            ],
          reload: "true",
        },
      };

      query["span_id"] =
        log[
          store.state.organizationData.organizationSettings.span_id_field_name
        ];

      router.push(query);
    };

    const getTableWidth = computed(() => {
      const leftSidebarMenu = 56;
      const fieldList =
        (window.innerWidth - leftSidebarMenu) *
        (searchObj.config.splitterModel / 100);
      return window.innerWidth - (leftSidebarMenu + fieldList) - 5;
    });

    const scrollTableToTop = (value: number) => {
      searchTableRef.value?.parentRef?.scrollTo({ top: value });
    };

    const getColumns = computed(() => {
      return searchObj.data?.resultGrid?.columns?.filter(
        (col: any) => !!col.id,
      );
    });

    const getPartitionPaginations = computed(() => {
      return searchObj.data.queryResults?.partitionDetail?.paginations || [];
    });

    const getSocketPaginations = computed(() => {
      return searchObj.data.queryResults.pagination || [];
    });

    const getPaginations = computed(() => {
      try {
        if (searchObj.communicationMethod === "http") {
          return getPartitionPaginations.value || [];
        } else {
          return getSocketPaginations.value || [];
        }
      } catch (e) {
        return [];
      }
    });
    //this is used to show the histogram loader when the histogram is loading
    const histogramLoader = computed(() => {
      return searchObj.meta.showHistogram && searchObj.loadingHistogram == true;
    });

    const sendToAiChat = (value: any) => {
      emit("sendToAiChat", value);
    };

    const closeTable = () => {
      searchObj.meta.showDetailTab = false;
    };

    const resetPlotChart = computed(() => {
      return searchObj.meta.resetPlotChart;
    });

    watch(resetPlotChart, (newVal) => {
      if (newVal) {
        plotChart.value = {};
        searchObj.meta.resetPlotChart = false;
      }
    });    
    
    const selectedStreamFullTextSearchKeys = computed(() => {
      const defaultFTSKeys = store?.state?.zoConfig?.default_fts_keys || [];
      const selectedStreamFTSKeys = searchObj.data.stream.selectedStreamFields.filter(
        (field: string) => field.ftsKey
      ).map((field: any) => field.name);
      //merge default FTS keys with selected stream FTS keys
      return [...new Set([...defaultFTSKeys, ...selectedStreamFTSKeys])];
    });

    return {
      t,
      store,
      plotChart,
      searchObj,
      updatedLocalLogFilterField,
      byString,
      searchTableRef,
      searchAroundData,
      addSearchTerm,
      removeSearchTerm,
      openLogDetails,
      changeMaxRecordToReturn,
      navigateRowDetail,
      totalHeight,
      reDrawChart,
      expandLog,
      getImageURL,
      addFieldToTable,
      searchListContainer,
      getWidth,
      copyLogToClipboard,
      extractFTSFields,
      useLocalWrapContent,
      noOfRecordsTitle,
      scrollPosition,
      rowsPerPageOptions,
      pageNumberInput,
      refreshPartitionPagination,
      disableMoreErrorDetails,
      redirectToTraces,
      getTableWidth,
      scrollTableToTop,
      getColumns,
      reorderSelectedFields,
      getPaginations,
      refreshPagination,
      refreshJobPagination,
      histogramLoader,
      sendToAiChat,
      closeTable,
      getRowIndex,
      getPartitionPaginations,
      getSocketPaginations,
      resetPlotChart,
      columnSizes,
      selectedStreamFullTextSearchKeys
    };
  },
  computed: {
    toggleWrapFlag() {
      return this.searchObj.meta.toggleSourceWrap;
    },
    findFTSFields() {
      return this.searchObj.data.stream.selectedStreamFields;
    },
    updateTitle() {
      return this.searchObj.data.histogram.chartParams.title;
    },
    reDrawChartData() {
      return this.searchObj.data.histogram;
    },
  },
  watch: {
    toggleWrapFlag() {
      this.useLocalWrapContent(this.searchObj.meta.toggleSourceWrap);
    },
    findFTSFields() {
      this.extractFTSFields();
    },
    updateTitle() {
      this.noOfRecordsTitle = this.searchObj.data.histogram.chartParams.title;
    },
    reDrawChartData: {
      deep: true,
      handler: function () {
        this.reDrawChart();
      },
    },
  },
});
</script>

<style lang="scss" scoped>
@import '@/styles/logs/search-result.scss';
</style>

<style lang="scss">
@import '@/styles/search-result.scss';
</style>
