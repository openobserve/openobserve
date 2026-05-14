<!-- Copyright 2026 OpenObserve Inc.

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
  <div
    class="col column full-height"
    style="
      overflow: hidden !important;
      padding: 0 !important;
      margin: 0 !important;
      height: 100%;
    "
  >
    <div
      class="search-list full-height full-width tw:flex tw:flex-col"
      ref="searchListContainer"
    >
      <!-- Section header: static at top -->
      <div class="row tw:min-h-[28px] tw:pt-[0.375rem] tw:shrink-0">
        <div
          class="col-8 text-left q-pl-lg bg-warning text-white rounded-borders"
          v-if="searchObj.data.countErrorMsg != ''"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-total-count-error-message"
            :htmlContent="searchObj.data.countErrorMsg"
          />
        </div>
        <div v-else class="col-8 text-left q-pl-lg warning flex items-center" data-test="logs-search-result-title">
          {{
            searchObj.meta.logsVisualizeToggle === "patterns"
              ? patternSummaryText
              : noOfRecordsTitle
          }}
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
              <span class="search-loading-text"
                >Fetching the search events</span
              >
            </q-tooltip>
          </span>
          <div
            v-else-if="
              searchObj.data.histogram.errorCode == -1 &&
              !searchObj.loadingCounter &&
              searchObj.meta.showHistogram
            "
            class="q-ml-md tw:cursor-pointer"
            :class="
              store.state.theme == 'dark'
                ? 'histogram-unavailable-text'
                : 'histogram-unavailable-text-light'
            "
          >
            <!-- {{ searchObj.data.histogram.errorMsg }} -->
            <q-icon name="info" color="warning" size="sm"> </q-icon>
            <q-tooltip position="top" class="tw:text-sm tw:font-semi-bold">
              {{ searchObj.data.histogram.errorMsg }}
            </q-tooltip>
          </div>
          <!-- Inspect Button -->
          <OButton
            v-if="
              searchObj.data?.queryResults?.hits?.length > 0 &&
              searchObj.data.lastSearchTraceId &&
              config.isEnterprise == 'true' &&
              config.isCloud == 'false' &&
              store.state.zoConfig.search_inspector_enabled
            "
            variant="ghost-primary"
            size="icon-sm"
            class="analyze-button inspect-button"
            @click="openSearchJobInspector"
            data-test="logs-inspect-button"
          >
            <q-icon name="troubleshoot" size="xs" />
            <q-tooltip>
              {{ t("volumeInsights.searchInspectionsLabel") }}
            </q-tooltip>
          </OButton>
          <!-- Volume Analysis Button -->
          <OButton
            v-if="
              searchObj.data?.queryResults?.hits?.length > 0 &&
              !searchObj.meta.sqlMode
            "
            variant="ghost-primary"
            size="icon-sm"
            class="analyze-button"
            @click="openVolumeAnalysisDashboard"
            data-test="logs-analyze-dimensions-button"
          >
            <q-icon name="timeline" size="xs" />
            <q-tooltip>
              {{ t("volumeInsights.analyzeTooltipLogs") }}
            </q-tooltip>
          </OButton>
          <ORefreshButton
            :last-run-at="searchObj.meta.lastRunAt"
            :loading="searchObj.loading || searchObj.loadingHistogram"
            :disabled="searchObj.loading || searchObj.loadingHistogram"
            @click="$emit('run-query')"
            class="tw:ml-2"
          />
        </div>

        <div class="col-4 text-right q-pr-sm q-gutter-xs pagination-block">
          <q-pagination
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
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
                (searchObj.communicationMethod === 'streaming' ||
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
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
            data-test="logs-search-result-records-per-page"
            v-model="searchObj.meta.resultGrid.rowsPerPage"
            :options="rowsPerPageOptions"
            class="float-right select-pagination"
            size="sm"
            dense
            borderless
            @update:model-value="getPageData('recordsPerPage')"
          ></q-select>
          <!-- Wrap Content Button -->
          <OButton
            v-if="
              searchObj.meta.logsVisualizeToggle === 'logs' ||
              searchObj.meta.logsVisualizeToggle === 'patterns'
            "
            data-test="logs-search-result-wrap-table-content-btn"
            variant="ghost"
            size="icon"
            class="wrap-content-btn float-right"
            :class="{
              'wrap-content-btn--active': searchObj.meta.toggleSourceWrap,
            }"
            @click="
              searchObj.meta.toggleSourceWrap = !searchObj.meta.toggleSourceWrap
            "
          >
            <q-icon name="wrap_text" />
            <q-tooltip>
              {{ t("search.messageWrapContent") }}
            </q-tooltip>
          </OButton>
        </div>
      </div>

      <!-- Combined scroll area: histogram + logs/patterns scroll together -->
      <div class="tw:flex-1 tw:overflow-y-auto" ref="scrollContainerRef">
        <div
          ref="histogramRef"
          :class="[
            'histogram-container',
            searchObj.meta.showHistogram
              ? 'histogram-container--visible'
              : 'histogram-container--hidden',
          ]"
          v-if="
            searchObj.meta.logsVisualizeToggle !== 'patterns' &&
            searchObj.data?.histogram?.errorMsg == '' &&
            searchObj.data.histogram.errorCode != -1
          "
        >
          <div
            v-if="
              searchObj.meta.showHistogram &&
              (searchObj.data?.queryResults?.aggs?.length > 0 ||
                (plotChart && Object.keys(plotChart)?.length > 0))
            "
            class="histogram-chart"
            @click="onHistogramAreaClick"
          >
            <ChartRenderer
              ref="histogramChart"
              data-test="logs-search-result-bar-chart"
              :data="plotChart"
              style="width: 100%; height: 100%"
              @updated:dataZoom="onChartUpdate"
            />
          </div>

          <div
            class="histogram-empty"
            v-else-if="
              searchObj.meta.showHistogram &&
              !searchObj.loadingHistogram &&
              !searchObj.loading
            "
          >
            <h6 class="text-center">
              <span class="histogram-empty__message">
                <q-icon name="warning" color="warning" size="xs"></q-icon> No
                data found for histogram.</span
              >
            </h6>
          </div>

          <div
            class="histogram-empty"
            v-else-if="
              searchObj.meta.showHistogram &&
              Object.keys(plotChart)?.length === 0
            "
          >
            <h5 class="text-center">
              <span class="histogram-empty__message" style="color: transparent"
                >.</span
              >
            </h5>
          </div>

          <div class="q-pb-sm histogram-loader" v-if="histogramLoader">
            <q-spinner-hourglass
              color="primary"
              size="25px"
              class="search-spinner"
            />
          </div>
        </div>
        <div
          :class="[
            'histogram-container',
            searchObj.meta.showHistogram
              ? 'histogram-container--visible'
              : 'histogram-container--hidden',
          ]"
          v-else-if="
            searchObj.meta.logsVisualizeToggle !== 'patterns' &&
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
            <q-icon name="warning" color="warning" size="xs"></q-icon> Error
            while fetching histogram data.
            <OButton
              variant="secondary"
              size="sm"
              @click="toggleErrorDetails"
            data-test="logs-page-histogram-error-details-btn"
                >{{ t("search.histogramErrorBtnLabel") }}</OButton
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

        <!-- Pinned breakdown tooltip — teleported to body to avoid stacking context issues -->
        <Teleport to="body">
          <div
            v-if="pinnedTooltip.visible"
            class="oo-pin-backdrop"
            @click="closePinnedTooltip"
          />
          <div
            v-if="pinnedTooltip.visible"
            class="oo-pin-tooltip"
            :style="{
              top: pinnedTooltip.y + 'px',
              left: pinnedTooltip.x + 'px',
            }"
            @keydown.esc="closePinnedTooltip"
            tabindex="-1"
          >
            <div class="oo-pin-tooltip__time">
              {{ pinnedTooltip.timestamp }}
            </div>
            <div
              v-for="row in pinnedTooltip.rows"
              :key="row.rawValue"
              class="oo-pin-tooltip__row"
            >
              <span
                class="oo-pin-tooltip__dot"
                :style="{ background: row.color }"
              />
              <span class="oo-pin-tooltip__name">{{ row.displayLabel }}</span>
              <span class="oo-pin-tooltip__count">{{
                formatCount(row.count)
              }}</span>
              <span class="oo-pin-tooltip__row-actions">
                <span
                  class="oo-pin-tooltip__action oo-pin-tooltip__action--include"
                  title="include"
                  @click.stop="applyPinnedFilter(row.rawValue, 'include')"
                  >=</span
                >
                <span
                  class="oo-pin-tooltip__action oo-pin-tooltip__action--exclude"
                  title="exclude"
                  @click.stop="applyPinnedFilter(row.rawValue, 'exclude')"
                  >≠</span
                >
              </span>
            </div>
          </div>
        </Teleport>

        <!-- Logs View -->
        <template v-if="searchObj.meta.logsVisualizeToggle === 'logs'">
          <!-- Desktop: full table view -->
          <tenstack-table
            v-if="!isMobile"
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
            :highlight-query="searchObj.data.highlightQuery"
            :default-columns="!searchObj.data.stream.selectedFields.length"
            class="col-12"
            :selectedStreamFields="searchObj.data.stream.selectedStreamFields"
            :scroll-el="scrollContainerRef"
            :scroll-margin="0"
            :class="[
              !searchObj.meta.showHistogram ||
              (searchObj.meta.showHistogram &&
                searchObj.data.histogram.errorCode == -1)
                ? 'table-container--without-histogram'
                : 'table-container--with-histogram',
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
            @show-correlation="openLogDetailsWithCorrelation"
          />
          <!-- Mobile: card-per-row view -->
          <q-virtual-scroll
            v-else
            :items="searchObj.data.queryResults?.hits || []"
            :virtual-scroll-item-size="52"
            :virtual-scroll-slice-size="30"
            class="col-12 tw:mt-[0.375rem]"
            :class="[
              !searchObj.meta.showHistogram ||
              (searchObj.meta.showHistogram &&
                searchObj.data.histogram.errorCode == -1)
                ? 'table-container--without-histogram'
                : 'table-container--with-histogram',
            ]"
            style="overflow-y: auto"
          >
            <template v-slot="{ item: row, index }">
              <MobileLogCard
                :key="'log_' + index"
                :row="row"
                :index="index"
                @click="openLogDetails"
              />
            </template>
          </q-virtual-scroll>
        </template>

        <!-- Patterns View -->
        <div
          v-if="searchObj.meta.logsVisualizeToggle === 'patterns'"
          class="tw:flex tw:flex-col"
          :class="[
            !searchObj.meta.showHistogram ||
            (searchObj.meta.showHistogram &&
              searchObj.data.histogram.errorCode == -1)
              ? 'table-container--without-histogram'
              : 'table-container--with-histogram',
          ]"
        >
          <!-- Patterns List -->
          <PatternList
            :patterns="patternsState?.patterns?.patterns || []"
            :loading="searchObj.loading"
            :totalLogsAnalyzed="
              patternsState?.patterns?.statistics?.total_logs_analyzed
            "
            :wrap="searchObj.meta.toggleSourceWrap"
            :scroll-target="scrollContainerRef"
            @open-details="openPatternDetails"
            @add-to-search="addPatternToSearch"
            @create-alert="createAlertFromPattern"
            @filter-value="addWildcardValueToSearch"
          />
        </div>
      </div>
      <!-- end combined scroll area -->

      <q-dialog
        data-test="logs-search-result-detail-dialog"
        v-model="searchObj.meta.showDetailTab"
        :position="isMobile ? undefined : 'right'"
        full-height
        :full-width="isMobile"
        maximized
        allow-focus-outside
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
          :correlation-props="correlationDashboardProps"
          :correlation-loading="correlationLoading"
          :correlation-error="correlationError"
          :initial-tab="detailTableInitialTab"
          class="detail-table-dialog"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex"
          :totalLength="parseInt(searchObj.data.queryResults.hits.length)"
          :highlight-query="searchObj.data.highlightQuery"
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
          @load-correlation="openCorrelationFromLog"
        />
      </q-dialog>

      <!-- Pattern Details Drawer -->
      <PatternDetailsDialog
        v-model="showPatternDetails"
        :selectedPattern="selectedPattern"
        :totalPatterns="patternsState?.patterns?.patterns?.length || 0"
        @navigate="navigatePatternDetail"
        @filter-value="addWildcardValueToSearch"
      />

      <!-- Volume Analysis Dashboard -->
      <TracesAnalysisDashboard
        v-if="showVolumeAnalysisDashboard"
        :streamName="searchObj.data.stream.selectedStream[0]"
        streamType="logs"
        :timeRange="originalTimeRangeBeforeSelection || volumeAnalysisTimeRange"
        :rateFilter="
          hasHistogramSelection ? histogramSelectionRange : undefined
        "
        :baseFilter="searchObj.data.editorValue"
        :streamFields="
          searchObj.data.stream.userDefinedSchema?.length > 0
            ? searchObj.data.stream.userDefinedSchema
            : searchObj.data.stream.selectedStreamFields
        "
        :logSamples="searchObj.data.queryResults.hits"
        analysisType="volume"
        :availableAnalysisTypes="['volume']"
        @close="closeVolumeAnalysisDashboard"
      />
    </div>

    <!-- Correlation Dashboard (for inline expanded logs, opens as separate dialog) -->
    <TelemetryCorrelationDashboard
      v-if="shouldShowInlineDialog"
      mode="dialog"
      :service-name="correlationDashboardProps.serviceName"
      :matched-dimensions="correlationDashboardProps.matchedDimensions"
      :additional-dimensions="correlationDashboardProps.additionalDimensions"
      :metric-streams="correlationDashboardProps.metricStreams"
      :log-streams="correlationDashboardProps.logStreams"
      :trace-streams="correlationDashboardProps.traceStreams"
      :source-stream="correlationDashboardProps.sourceStream"
      :source-type="correlationDashboardProps.sourceType"
      :available-dimensions="correlationDashboardProps.availableDimensions"
      :fts-fields="correlationDashboardProps.ftsFields"
      :time-range="correlationDashboardProps.timeRange"
      @close="showCorrelation = false"
    />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  onMounted,
  onUpdated,
  onBeforeUnmount,
  defineAsyncComponent,
  watch,
  nextTick,
} from "vue";
import { copyToClipboard, useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import { byString } from "../../utils/json";
import { getImageURL, useLocalWrapContent } from "../../utils/zincutils";
import useLogs from "../../composables/useLogs";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import usePatterns from "@/composables/useLogs/usePatterns";
import { usePatternActions } from "@/plugins/logs/patterns/usePatternActions";
import { extractConstantsFromPattern } from "@/plugins/logs/patterns/patternUtils";
import {
  convertLogData,
  convertStackedLogData,
  formatDate,
  formatCount,
} from "@/utils/logs/convertLogData";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { useRouter } from "vue-router";
import { useSearchAround } from "@/composables/useLogs/searchAround";
import { useScreen } from "@/composables/useScreen";
import MobileLogCard from "./MobileLogCard.vue";
import { usePagination } from "@/composables/useLogs/usePagination";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import { searchState } from "@/composables/useLogs/searchState";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import TelemetryCorrelationDashboard from "@/plugins/correlation/TelemetryCorrelationDashboard.vue";
import type { TelemetryContext } from "@/utils/telemetryCorrelation";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import config from "@/aws-exports";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "SearchResult",
  components: {
    ORefreshButton,
    OButton,
    DetailTable: defineAsyncComponent(() => import("./DetailTable.vue")),
    ChartRenderer: defineAsyncComponent(
      () => import("@/components/dashboards/panels/ChartRenderer.vue"),
    ),
    SanitizedHtmlRenderer,
    TenstackTable: defineAsyncComponent(() => import("./TenstackTable.vue")),
    JsonPreview: defineAsyncComponent(() => import("./JsonPreview.vue")),
    EqualIcon,
    NotEqualIcon,
    MobileLogCard,
    TelemetryCorrelationDashboard,
    PatternList: defineAsyncComponent(
      () => import("./patterns/PatternList.vue"),
    ),
    PatternDetailsDialog: defineAsyncComponent(
      () => import("./patterns/PatternDetailsDialog.vue"),
    ),
    TracesAnalysisDashboard: defineAsyncComponent(
      () => import("../traces/metrics/TracesAnalysisDashboard.vue"),
    ),
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
    "run-query",
  ],
  props: {
    expandedLogs: {
      type: Array,
      default: () => [],
    },
  },
  methods: {
    formatPatternSummary(stats: any, totalEvents: number, histogramMs: number) {
      const patternsFound = stats?.total_patterns_found || 0;
      const logsAnalyzed = (stats?.total_logs_analyzed || 0).toLocaleString();
      const totalEventsStr = totalEvents
        ? totalEvents.toLocaleString()
        : logsAnalyzed;

      // Combine histogram time + pattern extraction time
      const patternMs = stats?.extraction_time_ms || 0;
      const totalTimeMs = histogramMs + patternMs;

      return this.$t("search.pattern_summary", {
        totalEvents: totalEventsStr,
        patternsFound: patternsFound,
        logsAnalyzed: logsAnalyzed,
        totalTime: totalTimeMs,
      });
    },
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

        if (newColOrder.length > 0) {
          this.searchObj.organizationIdentifier =
            this.store.state.selectedOrganization.identifier;
          let selectedFields = this.reorderSelectedFields();

          this.searchObj.data.stream.selectedFields = selectedFields.filter(
            (_field) =>
              _field !==
              (this.store?.state?.zoConfig?.timestamp_column || "_timestamp"),
          );
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
        if (this.searchObj.communicationMethod === "streaming") {
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

      this.searchObj.data.stream.selectedFields = selectedFields.filter(
        (_field) =>
          _field !==
          (this.store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );

      this.searchObj.organizationIdentifier =
        this.store.state.selectedOrganization.identifier;
      this.updatedLocalLogFilterField();
    },
    onChartUpdate({ start, end }: { start: any; end: any }) {
      this.searchObj.meta.showDetailTab = false;

      // Store the original time range BEFORE updating datetime (for volume analysis baseline)
      if (start && end && !this.originalTimeRangeBeforeSelection) {
        this.originalTimeRangeBeforeSelection = {
          startTime: this.searchObj.data.datetime.startTime,
          endTime: this.searchObj.data.datetime.endTime,
        };
      }

      this.$emit("update:datetime", { start, end });

      // Track histogram selection for volume analysis
      // Chart emits timestamps in milliseconds, convert to microseconds for OpenObserve
      if (start && end) {
        this.hasHistogramSelection = true;
        this.histogramSelectionRange = {
          start: -1, // Placeholder to indicate time-based selection (not Y-axis)
          end: -1, // Placeholder to indicate time-based selection (not Y-axis)
          timeStart: start * 1000, // Convert ms to microseconds
          timeEnd: end * 1000, // Convert ms to microseconds
        };
      } else {
        this.hasHistogramSelection = false;
        this.histogramSelectionRange = {
          start: 0,
          end: 0,
          timeStart: undefined,
          timeEnd: undefined,
        };
        // Reset original time range when selection is cleared
        this.originalTimeRangeBeforeSelection = null;
      }
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
    const { isMobile } = useScreen();
    const searchListContainer = ref(null);
    const noOfRecordsTitle = ref("");
    const patternSummaryText = ref("");
    const scrollPosition = ref(0);
    const rowsPerPageOptions = [10, 25, 50, 100];
    const disableMoreErrorDetails = ref(false);
    const router = useRouter();
    const { searchAroundData } = useSearchAround();
    const { refreshPagination } = useSearchStream();
    const { refreshPartitionPagination, refreshJobPagination } =
      usePagination();
    const { updatedLocalLogFilterField } = logsUtils();
    const { extractFTSFields, filterHitsColumns } = useStreamFields();

    const { reorderSelectedFields, getFilterExpressionByFieldType } = useLogs();

    const { searchObj } = searchState();

    // Use separate patterns state (completely isolated from logs)
    const { patternsState } = usePatterns();

    const {
      selectedPattern,
      showPatternDetails,
      openPatternDetails,
      navigatePatternDetail,
      addPatternToSearch,
      addWildcardValueToSearch,
      createAlertFromPattern,
    } = usePatternActions();

    const pageNumberInput = ref(1);
    const totalHeight = ref(0);

    // Volume Analysis state
    const showVolumeAnalysisDashboard = ref(false);
    const hasHistogramSelection = ref(false);
    const histogramSelectionRange = ref({
      start: 0,
      end: 0,
      timeStart: undefined,
      timeEnd: undefined,
    });
    const originalTimeRangeBeforeSelection = ref<{
      startTime: number;
      endTime: number;
    } | null>(null);

    const searchTableRef: any = ref(null);
    const scrollContainerRef = ref(null);
    const histogramRef = ref(null);

    // Correlation dashboard state
    const showCorrelation = ref(false);
    const correlationContext = ref<TelemetryContext | null>(null);
    const correlationDashboardProps = ref<any>(null);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const detailTableInitialTab = ref<string>("json");
    const { findRelatedTelemetry } = useServiceCorrelation();

    // Flag to prevent duplicate correlation API calls
    const correlationFetchInProgress = ref(false);

    const shouldShowInlineDialog = computed(() => {
      return (
        showCorrelation.value &&
        correlationDashboardProps.value &&
        !searchObj.meta.showDetailTab
      );
    });

    const patternsColumns = [
      {
        accessorKey: "pattern_id",
        header: "#",
        id: "index",
        size: 60,
        cell: (info: any) => info.row.index + 1,
        meta: {
          closable: false,
          showWrap: false,
        },
      },
      {
        accessorKey: "template",
        header: "Pattern Template",
        id: "template",
        cell: (info: any) => info.getValue(),
        size: 500,
        meta: {
          closable: false,
          showWrap: true,
        },
      },
      {
        accessorKey: "frequency",
        header: "Count",
        id: "frequency",
        size: 100,
        cell: (info: any) =>
          `${info.getValue()} (${info.row.original.percentage.toFixed(1)}%)`,
        meta: {
          closable: false,
          showWrap: false,
        },
      },
      {
        accessorKey: "examples",
        header: "Example Log",
        id: "example",
        size: 400,
        cell: (info: any) => {
          const examples = info.getValue();
          if (examples && examples.length > 0) {
            const msg = examples[0].log_message;
            return msg.length > 200 ? msg.substring(0, 200) + "..." : msg;
          }
          return "";
        },
        meta: {
          closable: false,
          showWrap: false,
        },
      },
    ];

    const plotChart: any = ref({});

    // Debounce timer for custom color picker changes
    let debounceTimer: any = null;

    // Watch for theme color changes in localStorage
    const handleThemeColorChange = () => {
      const currentMode = store.state.theme === "dark" ? "dark" : "light";
      const appliedThemeKey =
        currentMode === "light" ? "appliedLightTheme" : "appliedDarkTheme";
      const appliedTheme = localStorage.getItem(appliedThemeKey);

      // If -1, user is picking custom color - debounce to avoid performance issues
      if (appliedTheme === "-1") {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => reDrawChart(), 300);
      } else {
        // Predefined theme applied - re-render immediately
        if (debounceTimer) clearTimeout(debounceTimer);
        reDrawChart();
      }
    };

    // Re-render stacked chart with correct palette when dark/light mode switches
    watch(
      () => store.state.theme,
      () => reDrawChart(),
    );

    // Pinned tooltip — frozen on bar click so user can explore and select
    const pinnedTooltip = ref<{
      visible: boolean;
      x: number;
      y: number;
      field: string;
      timestamp: string;
      rows: {
        displayLabel: string;
        rawValue: string;
        count: number;
        color: string;
      }[];
    }>({
      visible: false,
      x: 0,
      y: 0,
      field: "",
      timestamp: "",
      rows: [],
    });

    const histogramChart: any = ref(null);

    const closePinnedTooltip = () => {
      pinnedTooltip.value.visible = false;
      // Restore tooltip mouse tracking
      histogramChart.value?.chart?.setOption(
        { tooltip: { triggerOn: "mousemove|click" } },
        false,
      );
    };

    const onHistogramAreaClick = (event: MouseEvent) => {
      const { breakdownField, breakdownSeries, xData } =
        searchObj.data.histogram;
      if (!breakdownSeries?.size || !xData?.length) return;

      const eChart = histogramChart.value?.chart;
      if (!eChart) return;

      // Convert click pixel to nearest data index
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const pixelX = event.clientX - rect.left;
      const pixelY = event.clientY - rect.top;

      // Ignore clicks outside the plot area (e.g. legend items)
      if (!eChart.containPixel("grid", [pixelX, pixelY])) return;

      const dataPoint = eChart.convertFromPixel({ seriesIndex: 0 }, [
        pixelX,
        pixelY,
      ]);
      if (!dataPoint) return;

      const clickedTs: number = dataPoint[0];
      let dataIndex = 0;
      let minDiff = Infinity;
      (xData as number[]).forEach((ts: number, i: number) => {
        const diff = Math.abs(ts - clickedTs);
        if (diff < minDiff) {
          minDiff = diff;
          dataIndex = i;
        }
      });

      const timestamp = formatDate(new Date(xData[dataIndex]));

      const rows = [...breakdownSeries.entries()].map(([category, counts]) => {
        // Explicit check so numeric 0 is not treated as empty (0 is falsy in JS).
        // Case is preserved — we never re-capitalize or lowercase user data;
        // the tooltip label and the filter term must match the source exactly.
        const label =
          category === null || category === undefined || category === ""
            ? "(empty)"
            : String(category);
        const rawValue = label === "(empty)" ? "" : label;
        const matchedSeries = (plotChart.value?.options?.series ?? []).find(
          (s: any) => s.name === label,
        );
        return {
          displayLabel: label,
          rawValue,
          count: (counts as number[])[dataIndex] ?? 0,
          color: matchedSeries?.itemStyle?.color ?? "#888",
        };
      });

      const margin = 10;
      const panelW = 250;
      // Cap panel height at the viewport so placement math stays valid even
      // for high-cardinality breakdowns. Actual scroll is handled in CSS.
      const panelH = Math.min(
        rows.length * 28 + 60,
        window.innerHeight - 2 * margin,
      );
      const x = Math.min(
        event.clientX + margin,
        window.innerWidth - panelW - margin,
      );
      const y = Math.max(
        margin,
        Math.min(event.clientY + margin, window.innerHeight - panelH - margin),
      );

      pinnedTooltip.value = {
        visible: true,
        x,
        y,
        field: breakdownField ?? "",
        timestamp,
        rows,
      };

      eChart.dispatchAction({ type: "hideTip" });
      eChart.setOption({ tooltip: { triggerOn: "none" } }, false);
    };

    const applyPinnedFilter = (
      rawValue: string,
      action: "include" | "exclude",
    ) => {
      const field = pinnedTooltip.value.field;
      if (!field) return;
      addSearchTerm(field, rawValue, action);
    };

    onMounted(() => {
      reDrawChart();
      window.addEventListener("themeColorChanged", handleThemeColorChange);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("themeColorChanged", handleThemeColorChange);
      // Clear any pending debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    });

    onUpdated(() => {
      pageNumberInput.value = searchObj.data.resultGrid.currentPage;
    });

    // Patterns are kept in memory when switching views and only cleared on explicit search
    // This allows users to toggle between logs/patterns/visualize without losing pattern data

    const columnSizes = ref({});

    const reDrawChart = () => {
      if (
         
        searchObj.data.histogram.hasOwnProperty("xData") &&
        searchObj.data.histogram.xData.length > 0
      ) {
        const { xData, yData, breakdownSeries, chartParams, breakdownField } =
          searchObj.data.histogram;

        if (breakdownSeries && breakdownSeries.size > 0) {
          plotChart.value = convertStackedLogData(
            xData,
            breakdownSeries,
            { ...chartParams, breakdownField: breakdownField ?? null },
            store.state.theme === "dark",
          );
        } else {
          plotChart.value = convertLogData(xData, yData, chartParams);
        }
      }
    };

    const changeMaxRecordToReturn = (val: any) => {
      // searchObj.meta.resultGrid.pagination.rowsPerPage = val;
    };

    const openLogDetails = (props: any, index: number) => {
      searchObj.meta.showDetailTab = true;
      searchObj.meta.resultGrid.navigation.currentRowIndex = index;
      detailTableInitialTab.value = "json"; // Reset to default tab

      // Prepare correlation context (but don't open panel automatically)
      const logData = searchObj.data.queryResults?.hits?.[index];
      if (logData) {
        correlationContext.value = {
          timestamp: logData._timestamp || Date.now() * 1000,
          fields: logData,
        };
      }
    };

    const openLogDetailsWithCorrelation = (row: any) => {
      // If sidebar is already open, we already know the index
      if (searchObj.meta.showDetailTab) {
        // Just set the tab and load correlation data
        detailTableInitialTab.value = "correlated-logs";
        openCorrelationFromLog(row);
        return;
      }

      // Find the index of this row in the hits array by comparing timestamp
      const timestampColumn =
        store.state.zoConfig?.timestamp_column || "_timestamp";
      const index = searchObj.data.queryResults?.hits?.findIndex(
        (hit: any) => hit[timestampColumn] === row[timestampColumn],
      );

      if (index === -1 || index === undefined) {
        console.error(
          "[SearchResult] Could not find row index for correlation",
          {
            rowTimestamp: row[timestampColumn],
            hitsCount: searchObj.data.queryResults?.hits?.length,
          },
        );
        return;
      }

      // Set the initial tab to correlated-logs before opening the sidebar
      detailTableInitialTab.value = "correlated-logs";

      // Open the log details sidebar
      searchObj.meta.showDetailTab = true;
      searchObj.meta.resultGrid.navigation.currentRowIndex = index;

      // Load correlation data
      openCorrelationFromLog(row);
    };

    const openCorrelationPanel = () => {
      showCorrelation.value = true;
    };

    const openCorrelationFromLog = async (logData: any) => {
      // Prevent duplicate calls - if a fetch is already in progress, skip
      if (correlationFetchInProgress.value) {
        return;
      }

      try {
        correlationFetchInProgress.value = true;
        correlationLoading.value = true;
        correlationError.value = null; // Clear any previous error

        // Set the correlation context from the log data
        const context: TelemetryContext = {
          timestamp: logData._timestamp || Date.now() * 1000,
          fields: logData,
        };
        correlationContext.value = context;

        // Fetch correlation data
        const result = await findRelatedTelemetry(
          context,
          "logs",
          5, // 5 minute time window
          searchObj.data.stream.selectedStream[0],
        );

        if (!result) {
          console.warn("[SearchResult] No correlation result returned");
          correlationError.value = "No matching service found for correlation";
          $q.notify({
            type: "warning",
            message: "No matching service found for correlation",
            timeout: 3000,
          });
          return;
        }

        if (!result.correlationData) {
          console.warn("[SearchResult] No correlation data in result");
          correlationError.value = "Unable to retrieve correlation data";
          $q.notify({
            type: "warning",
            message: "Unable to retrieve correlation data",
            timeout: 3000,
          });
          return;
        }

        // Prepare props for the dashboard
        // Calculate time range: ±5 minutes from log timestamp
        // context.timestamp is in microseconds - pass microseconds directly (like TracesAnalysisDashboard)
        const timeWindowMicros = 5 * 60 * 1000000; // 5 minutes in microseconds
        const startTimeMicros = context.timestamp - timeWindowMicros;
        let endTimeMicros = context.timestamp + timeWindowMicros;

        // Cap end time to current UTC time (never allow future timestamps)
        const currentTimeMicros = Date.now() * 1000; // Current time in microseconds
        if (endTimeMicros > currentTimeMicros) {
          endTimeMicros = currentTimeMicros;
        }

        // Extract FTS fields from stream settings
        const ftsFields =
          searchObj.data.stream.selectedStreamFields
            ?.filter((field: any) => field.ftsKey === true)
            .map((field: any) => field.name) || [];

        // Always set correlation props, even if metrics array is empty
        // This prevents re-fetching when switching between tabs
        //
        // v2: backend returns per-stream actual field names in StreamInfo.filters
        // Use log stream filters as matchedDimensions (actual field names for source stream)
        const logFilters =
          result.correlationData.related_streams.logs?.[0]?.filters || {};
        const actualMatchedDimensions =
          Object.keys(logFilters).length > 0
            ? logFilters
            : result.correlationData.matched_dimensions;

        correlationDashboardProps.value = {
          serviceName: result.correlationData.service_name,
          matchedDimensions: actualMatchedDimensions,
          additionalDimensions: {},
          metricStreams: result.correlationData.related_streams.metrics || [],
          logStreams: result.correlationData.related_streams.logs || [],
          traceStreams: result.correlationData.related_streams.traces || [],
          sourceStream: searchObj.data.stream.selectedStream[0],
          sourceType: "logs",
          // Use log stream filters and log record as availableDimensions for field name resolution and traceId extraction
          availableDimensions: { ...logFilters, ...context.fields },
          ftsFields: ftsFields, // Full text search fields for trace_id extraction from log body
          timeRange: {
            startTime: startTimeMicros,
            endTime: endTimeMicros,
          },
        };

        // Show info notification if no metrics found (but don't prevent setting props)
        if (
          !result.correlationData.related_streams.metrics ||
          result.correlationData.related_streams.metrics.length === 0
        ) {
          console.warn(
            "[SearchResult] No metric streams found for correlation",
          );
          $q.notify({
            type: "info",
            message: `No metric streams found for service "${result.correlationData.service_name}"`,
            timeout: 3000,
          });
        }

        // For inline expanded logs, open the correlation dashboard as a dialog
        // For DetailTable drawer, the data is passed via props (tabs are already visible)
        if (!searchObj.meta.showDetailTab) {
          showCorrelation.value = true;
        }
      } catch (err: any) {
        console.error("[SearchResult] Error in openCorrelationFromLog:", err);
        correlationError.value = `Correlation error: ${err.message || err}`;
        $q.notify({
          type: "negative",
          message: `Correlation error: ${err.message || err}`,
          timeout: 3000,
        });
        correlationDashboardProps.value = null;
      } finally {
        correlationLoading.value = false;
        correlationFetchInProgress.value = false;
      }
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

      // Clear correlation data when navigating to a different log
      // User will need to click a correlation tab again for the new log
      correlationDashboardProps.value = null;
      correlationLoading.value = false;
      correlationError.value = null;
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
      } else if (
        fieldName !== (store?.state?.zoConfig?.timestamp_column || "_timestamp")
      ) {
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
      scrollContainerRef.value?.scrollTo({ top: value });
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

    const sendToAiChat = (value: any, append: boolean = true) => {
      emit("sendToAiChat", value, append);
    };

    const closeTable = () => {
      searchObj.meta.showDetailTab = false;
      // Clear correlation data when closing sidebar so it doesn't persist to next row
      correlationDashboardProps.value = null;
      correlationLoading.value = false;
      correlationError.value = null;
    };

    // Volume Analysis functions
    const openVolumeAnalysisDashboard = () => {
      showVolumeAnalysisDashboard.value = true;
    };

    const closeVolumeAnalysisDashboard = () => {
      showVolumeAnalysisDashboard.value = false;
    };

    // Search Job Inspector functions
    const openSearchJobInspector = () => {
      // Get the last search trace_id
      const traceId = searchObj.data.lastSearchTraceId;

      if (!traceId) {
        $q.notify({
          type: "warning",
          message: "No trace ID available for inspection",
          timeout: 2000,
        });
        return;
      }

      // Navigate to the search job inspector page
      router.push({
        name: "searchJobInspector",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          trace_id: traceId,
        },
      });
    };

    const resetPlotChart = computed(() => {
      return searchObj.meta.resetPlotChart;
    });

    watch(
      () => searchObj.loading,
      (loading, wasLoading) => {
        if (wasLoading && !loading && searchObj.meta.searchApplied) {
          searchObj.meta.lastRunAt = Date.now();
        }
      },
    );

    watch(resetPlotChart, (newVal) => {
      if (newVal) {
        plotChart.value = {};
        searchObj.meta.resetPlotChart = false;

        // Clear histogram selection when chart is reset
        hasHistogramSelection.value = false;
        histogramSelectionRange.value = {
          start: 0,
          end: 0,
          timeStart: undefined,
          timeEnd: undefined,
        };
        originalTimeRangeBeforeSelection.value = null;
      }
    });

    // Debug watcher for patterns state
    watch(
      () => patternsState.value.patterns,
      (newPatterns) => {
        // console.log("[SearchResult] Patterns state changed:", {
        //   hasPatterns: !!newPatterns,
        //   patternCount: newPatterns?.patterns?.length || 0,
        //   statistics: newPatterns?.statistics,
        // });
      },
      { deep: true },
    );

    // Watch for sidebar close to clear correlation data
    // This ensures fresh correlation data when reopening with a different row
    watch(
      () => searchObj.meta.showDetailTab,
      (isOpen, wasOpen) => {
        // When sidebar closes, clear correlation data
        if (wasOpen && !isOpen) {
          correlationDashboardProps.value = null;
          correlationLoading.value = false;
          correlationError.value = null;
        }
      },
    );

    // Watch for datetime changes from outside (datetime picker, search button, etc.)
    // Clear histogram selection when datetime changes not from brush selection
    watch(
      () => ({
        start: searchObj.data.datetime.startTime,
        end: searchObj.data.datetime.endTime,
      }),
      (newTime, oldTime) => {
        // Only clear if this is NOT from a brush selection (onChartUpdate sets both together)
        // We can detect this by checking if the time change is significant (> 1 second difference from histogram range)
        const histogramStartTime = histogramSelectionRange.value.timeStart
          ? histogramSelectionRange.value.timeStart / 1000 // Convert to ms
          : null;
        const histogramEndTime = histogramSelectionRange.value.timeEnd
          ? histogramSelectionRange.value.timeEnd / 1000 // Convert to ms
          : null;

        const isFromBrushSelection =
          histogramStartTime &&
          histogramEndTime &&
          Math.abs(newTime.start / 1000 - histogramStartTime) < 1000 && // Within 1 second
          Math.abs(newTime.end / 1000 - histogramEndTime) < 1000;

        if (
          !isFromBrushSelection &&
          oldTime &&
          (newTime.start !== oldTime.start || newTime.end !== oldTime.end)
        ) {
          hasHistogramSelection.value = false;
          histogramSelectionRange.value = {
            start: 0,
            end: 0,
            timeStart: undefined,
            timeEnd: undefined,
          };
          originalTimeRangeBeforeSelection.value = null;
        }
      },
      { deep: true },
    );

    const selectedStreamFullTextSearchKeys = computed(() => {
      const defaultFTSKeys = store?.state?.zoConfig?.default_fts_keys || [];
      const selectedStreamFTSKeys = searchObj.data.stream.selectedStreamFields
        .filter((field: string) => field.ftsKey)
        .map((field: any) => field.name);
      //merge default FTS keys with selected stream FTS keys
      return [...new Set([...defaultFTSKeys, ...selectedStreamFTSKeys])];
    });

    return {
      t,
      store,
      config,
      plotChart,
      searchObj,
      patternsState,
      updatedLocalLogFilterField,
      byString,
      searchTableRef,
      scrollContainerRef,
      histogramRef,
      searchAroundData,
      addSearchTerm,
      removeSearchTerm,
      histogramChart,
      pinnedTooltip,
      closePinnedTooltip,
      onHistogramAreaClick,
      applyPinnedFilter,
      formatCount,
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
      patternSummaryText,
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
      selectedStreamFullTextSearchKeys,
      patternsColumns,
      selectedPattern,
      showPatternDetails,
      hasHistogramSelection,
      histogramSelectionRange,
      originalTimeRangeBeforeSelection,
      showVolumeAnalysisDashboard,
      openPatternDetails,
      navigatePatternDetail,
      addPatternToSearch,
      addWildcardValueToSearch,
      createAlertFromPattern,
      extractConstantsFromPattern,
      openVolumeAnalysisDashboard,
      closeVolumeAnalysisDashboard,
      openSearchJobInspector,
      showCorrelation,
      correlationContext,
      correlationDashboardProps,
      correlationLoading,
      correlationError,
      detailTableInitialTab,
      shouldShowInlineDialog,
      openCorrelationPanel,
      openCorrelationFromLog,
      openLogDetailsWithCorrelation,
      isMobile,
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
    updatePatternSummary() {
      return this.patternsState?.patterns?.statistics;
    },
    reDrawChartData() {
      return this.searchObj.data.histogram;
    },
    volumeAnalysisTimeRange() {
      // Use histogram selection if available, otherwise use current time range
      const hasSelection =
        this.histogramSelectionRange.start && this.histogramSelectionRange.end;
      return {
        startTime: hasSelection
          ? this.histogramSelectionRange.start
          : this.searchObj.data.datetime.startTime,
        endTime: hasSelection
          ? this.histogramSelectionRange.end
          : this.searchObj.data.datetime.endTime,
      };
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
    updatePatternSummary() {
      if (this.patternsState?.patterns?.statistics) {
        // Reuse the same summary logic from PatternStatistics component
        const stats = this.patternsState.patterns.statistics;
        const totalEvents =
          this.searchObj.data.queryResults?.total ||
          stats.total_logs_analyzed ||
          0;
        const histogramMs = this.searchObj.data.queryResults?.took || 0;

        this.patternSummaryText = this.formatPatternSummary(
          stats,
          totalEvents,
          histogramMs,
        );
      }
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
@import "@/styles/logs/search-result.scss";

/* Correlation Panel Styles */
.correlation-panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3000;
  display: flex;
  justify-content: flex-end;
}

.correlation-panel-container {
  width: 450px;
  max-width: 90vw;
  height: 100vh;
  background: var(--q-background, #ffffff);
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.15);
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
</style>
