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
    class="flex flex-col h-full max-h-full overflow-hidden"
  >
    <div
      class="h-full max-h-full overflow-hidden w-full flex flex-col"
      ref="searchListContainer"
    >
      <!-- Section header: static at top -->
      <div class="flex items-center h-9 shrink-0 border-b border-card-glass-border bg-card-glass-bg">
        <!-- Field panel toggle — same style as add-panel config sidebar -->
        <OButton
          variant="outline"
          size="icon-xs-sq"
          class="ml-1.5 shrink-0"
          data-test="logs-search-field-list-collapse-btn"
          @click="toggleFieldList"
        >
          <OIcon
            :name="searchObj.meta.showFields ? 'keyboard-double-arrow-left' : 'keyboard-double-arrow-right'"
            size="sm"
          />
          <OTooltip
            :content="searchObj.meta.showFields ? t('logs.searchResult.collapseFields') : t('logs.searchResult.openFields')"
            side="bottom"
            shortcut-id="logsToggleSidebar"
          />
        </OButton>
        <div
          class="flex-1 min-w-0 text-left pl-2 bg-warning text-text-inverse rounded-default"
          v-if="searchObj.data.countErrorMsg != ''"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-total-count-error-message"
            :htmlContent="searchObj.data.countErrorMsg"
          />
        </div>
        <div
          v-else
          class="flex-1 min-w-0 text-left pl-2 text-warning flex items-center flex-wrap gap-1.5"
          data-test="logs-search-result-title"
          :data-search-state="searchObj.loading || searchObj.loadingCounter ? 'loading' : 'complete'"
          :data-hits-count="searchObj.data?.queryResults?.hits?.length ?? 0"
        >
          <!-- Logs mode: structured chips -->
          <template v-if="searchObj.meta.logsVisualizeToggle !== 'patterns'">
            <template v-if="recordsChips">
              <OTag
                type="logsResultChip"
                value="neutral"
                data-test="logs-result-records-chip"
              >{{ recordsChips.records }}</OTag>
              <OTag
                type="logsResultChip"
                value="info"
                data-test="logs-result-time-chip"
              >{{ recordsChips.time }}</OTag>
              <OTag
                v-if="recordsChips.scan"
                type="logsResultChip"
                value="warn"
                data-test="logs-result-scan-chip"
              >{{ recordsChips.scan }}</OTag>
            </template>
            <span v-else class="truncate min-w-0">{{ noOfRecordsTitle }}</span>
          </template>
          <!-- Patterns mode: structured chips -->
          <template v-else>
            <template v-if="patternChips">
              <OTag
                v-if="patternChips.events !== null"
                type="logsResultChip"
                value="neutral"
                data-test="logs-result-events-chip"
              >{{ patternChips.events }} {{ t('logs.searchResult.events') }}</OTag>
              <OTag
                type="logsResultChip"
                value="neutral"
                data-test="logs-result-patterns-chip"
              >{{ patternChips.patterns }} {{ t('logs.searchResult.patterns') }}</OTag>
              <OTag
                type="logsResultChip"
                value="info"
                data-test="logs-result-pattern-time-chip"
              >{{ patternChips.time }} ms</OTag>
            </template>
            <span v-else class="truncate min-w-0">{{ patternSummaryText }}</span>
          </template>
          <span v-if="searchObj.loadingCounter" class="shrink-0">
            <OSpinner size="xs" class="mx-auto block" />
          </span>
          <div
            v-else-if="
              searchObj.data.histogram.errorCode == -1 &&
              !searchObj.loadingCounter &&
              searchObj.meta.showHistogram
            "
            class="shrink-0 cursor-pointer text-warning"
          >
            <OIcon name="info-outline" size="sm"> </OIcon>
            <OTooltip :content="searchObj.data.histogram.errorMsg" side="top" align="center" />
          </div>
        </div>

        <div class="flex-none pr-2 flex items-center justify-end gap-1">
          <!-- OVERFLOW MENU (narrow): refresh + all action buttons collapse here -->
          <ODropdown v-if="shouldMoveActionsToMenu" side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="outline"
                size="icon-chip"
                data-test="logs-result-actions-menu-btn"
              >
                <OIcon name="more-horiz" size="sm" />
                <OTooltip :content="t('search.moreActions')" />
              </OButton>
            </template>
            <ODropdownItem
              data-test="logs-result-refresh-menu-item"
              @select="$emit('run-query')"
            >
              <template #icon-left><OIcon name="refresh" size="sm" /></template>
              {{ t('common.refresh') }}
            </ODropdownItem>
            <ODropdownItem
              v-if="showWrapBtn"
              data-test="logs-result-wrap-menu-item"
              @select="searchObj.meta.toggleSourceWrap = !searchObj.meta.toggleSourceWrap"
            >
              <template #icon-left><OIcon name="wrap-text" size="sm" /></template>
              {{ t('search.messageWrapContent') }}
              <template v-if="searchObj.meta.toggleSourceWrap" #icon-right>
                <OIcon name="check" size="sm" />
              </template>
            </ODropdownItem>
            <ODropdownItem
              v-if="showInspectBtn"
              data-test="logs-inspect-button"
              @select="openSearchJobInspector"
            >
              <template #icon-left><OIcon name="troubleshoot" size="sm" /></template>
              {{ t('volumeInsights.searchInspectionsLabel') }}
            </ODropdownItem>
            <ODropdownItem
              v-if="showAnalyzeBtn"
              data-test="logs-analyze-dimensions-button"
              @select="openVolumeAnalysisDashboard"
            >
              <template #icon-left><OIcon name="timeline" size="sm" /></template>
              {{ t('volumeInsights.analyzeTooltipLogs') }}
            </ODropdownItem>
          </ODropdown>

          <!-- INLINE BUTTONS (wider container) -->
          <template v-else>
            <!-- Refresh in bordered wrapper -->
            <div class="inline-flex items-center border border-card-glass-border rounded-default px-1 h-6 overflow-hidden">
              <ORefreshButton
                :last-run-at="searchObj.meta.lastRunAt"
                :loading="searchObj.loading || searchObj.loadingHistogram"
                :disabled="searchObj.loading || searchObj.loadingHistogram"
                @click="$emit('run-query')"
              />
            </div>
            <!-- Action buttons -->
            <div
              v-if="showInspectBtn || showAnalyzeBtn || showWrapBtn"
              class="inline-flex items-center gap-0.5"
            >
              <OButton
                v-if="showInspectBtn"
                variant="outline"
                :size="showActionLabels ? 'chip' : 'icon-chip'"
                @click="openSearchJobInspector"
                data-test="logs-inspect-button"
              >
                <OIcon name="troubleshoot" size="sm" />
                <span v-if="showActionLabels" class="whitespace-nowrap">{{ t('volumeInsights.inspectBtnLabel') }}</span>
                <OTooltip v-if="!showActionLabels" :content="t('volumeInsights.searchInspectionsLabel')" />
              </OButton>
              <OButton
                v-if="showAnalyzeBtn"
                variant="outline"
                :size="showActionLabels ? 'chip' : 'icon-chip'"
                @click="openVolumeAnalysisDashboard"
                data-test="logs-analyze-dimensions-button"
              >
                <OIcon name="timeline" size="sm" />
                <span v-if="showActionLabels" class="whitespace-nowrap">{{ t('volumeInsights.analyzeBtnLabel') }}</span>
                <OTooltip v-if="!showActionLabels" :content="t('volumeInsights.analyzeTooltipLogs')" />
              </OButton>
              <OButton
                v-if="showWrapBtn"
                variant="outline"
                size="icon-chip"
                :active="searchObj.meta.toggleSourceWrap"
                @click="searchObj.meta.toggleSourceWrap = !searchObj.meta.toggleSourceWrap"
                data-test="logs-search-result-wrap-table-content-btn"
              >
                <OIcon name="wrap-text" size="sm" />
                <OTooltip :content="t('search.messageWrapContent')" />
              </OButton>
            </div>
          </template>

          <OSelect
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
            data-test="logs-search-result-records-per-page"
            v-model="searchObj.meta.resultGrid.rowsPerPage"
            :options="rowsPerPageOptions"
            class="select-pagination min-w-[4.5rem]"
            size="sm"
            :searchable="false"
            :disable="searchObj.loading"
            @update:model-value="getPageData('recordsPerPage')"
          />
          <OPagination
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
            :disable="searchObj.loading"
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
            :max-pages="paginationMaxPages"
            class="paginator-section"
            @update:model-value="getPageData('pageChange')"
            data-test="logs-search-result-pagination"
          />
        </div>
      </div>

      <!-- Combined scroll area: histogram + logs/patterns scroll together -->
      <div class="flex-1 overflow-auto" ref="scrollContainerRef">
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
          <!-- Streaming progress bar for the histogram chart: keeps the chart
            visible while it refreshes/replaces, mirroring the results table. -->
          <LoadingProgress
            :loading="searchObj.loadingHistogram"
            :loadingProgressPercentage="
              searchObj.loadingHistogramProgressPercentage || 0
            "
          />
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
              class="w-full h-full"
              @updated:dataZoom="onChartUpdate"
            />
          </div>

          <div
            v-else-if="
              searchObj.meta.showHistogram &&
              (searchObj.loadingHistogram || searchObj.loading)
            "
            class="histogram-skeleton"
            data-test="logs-search-histogram-skeleton"
          >
            <!-- main row: y-axis labels + plot area -->
            <div class="histogram-skeleton__main">
              <div class="histogram-skeleton__y-axis">
                <div class="histogram-skeleton__y-label" style="width: 1.75rem" />
                <div class="histogram-skeleton__y-label" style="width: 2.25rem" />
                <div class="histogram-skeleton__y-label" style="width: 1rem" />
              </div>
              <div class="histogram-skeleton__plot border-l border-b border-card-glass-border">
                <div class="histogram-skeleton__bars">
                  <div
                    v-for="h in skeletonBarHeights"
                    :key="h.id"
                    class="histogram-skeleton__bar"
                    :style="{ height: h.pct + '%' }"
                  />
                </div>
              </div>
            </div>
            <!-- x-axis labels row -->
            <div class="histogram-skeleton__x-axis">
              <div v-for="i in 6" :key="i" class="histogram-skeleton__x-label bg-skeleton-base" />
            </div>
          </div>

          <!-- Same no-data treatment as dashboard panels (PanelSchemaRenderer);
               inline min-height/padding overridden to fit the 6.25rem strip. -->
          <OEmptyState
            v-else-if="
              searchObj.meta.showHistogram &&
              !searchObj.loadingHistogram &&
              !searchObj.loading
            "
            size="inline"
            icon="bar-chart"
            :title="t('logs.searchResult.noData')"
            :backdrop="false"
            data-test="logs-search-no-data-histogram"
            class="histogram-empty !min-h-0 !p-2"
          />

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
            <OIcon name="warning" size="xs"></OIcon> {{ t('logs.searchResult.histogramFetchError') }}
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
                  :title="t('logs.searchResult.include')"
                  @click.stop="applyPinnedFilter(row.rawValue, 'include')"
                  >=</span
                >
                <span
                  class="oo-pin-tooltip__action oo-pin-tooltip__action--exclude"
                  :title="t('logs.searchResult.exclude')"
                  @click.stop="applyPinnedFilter(row.rawValue, 'exclude')"
                  >≠</span
                >
              </span>
            </div>
          </div>
        </Teleport>

        <!-- Logs View -->
        <template v-if="searchObj.meta.logsVisualizeToggle === 'logs'">
          <tenstack-table
            ref="searchTableRef"
            :columns="getColumns || []"
            :rows="searchObj.data.queryResults?.hits || []"
            :wrap="searchObj.meta.toggleSourceWrap"
            :width="getTableWidth"
            :err-msg="searchObj.data.missingStreamMessage"
            :loading="searchObj.loading"
            :loadingProgressPercentage="searchObj.loadingProgressPercentage || 0"
            :functionErrorMsg="searchObj?.data?.functionError"
            :expandedRows="expandedLogs"
            :highlight-timestamp="searchObj.data?.searchAround?.indexTimestamp"
            :selected-stream-fts-keys="selectedStreamFullTextSearchKeys"
            :highlight-query="searchObj.data.highlightQuery"
            :default-columns="!searchObj.data.stream.selectedFields.length"
            class="w-full"
            :selectedStreamFields="searchObj.data.stream.selectedStreamFields"
            :scroll-el="scrollContainerRef"
            :scroll-margin="0"
            :class="[
              !searchObj.meta.showHistogram ||
              (searchObj.meta.showHistogram &&
                searchObj.data.histogram.errorCode == -1)
                ? 'min-h-full!'
                : 'min-h-[calc(100%-6.25rem)]!',
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
        </template>

        <!-- Patterns View -->
        <div
          v-if="searchObj.meta.logsVisualizeToggle === 'patterns'"
          class="flex flex-col h-full"
          :class="[
            !searchObj.meta.showHistogram ||
            (searchObj.meta.showHistogram &&
              searchObj.data.histogram.errorCode == -1)
              ? 'min-h-full!'
              : 'min-h-[calc(100%-6.25rem)]!',
          ]"
        >
          <!-- Patterns List -->
          <PatternList
            :patterns="patternsState?.patterns?.patterns || []"
            :loading="patternsState?.loading"
            :totalLogsAnalyzed="
              patternsState?.patterns?.statistics?.total_logs_analyzed
            "
            :wrap="searchObj.meta.toggleSourceWrap"
            :scroll-target="scrollContainerRef"
            :stream-doc-time-range="streamDocTimeRange"
            :query-window-us="queryWindowUs"
            :window-total="patternWindowTotal"
            @open-details="openPatternDetails"
            @filter-value="addWildcardValueToSearch"
            @jump-to-stream-data="(from, to) => $emit('jump-to-stream-data', from, to)"
          />
        </div>
      </div>
      <!-- end combined scroll area -->

      <ODrawer
        bleed
        lazy
        data-test="logs-search-result-detail-dialog"
        v-model:open="searchObj.meta.showDetailTab"
        :width="85"
        :title="t('search.rowDetail')"
        @update:open="(v) => !v && reDrawChart()"
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
          :correlation-error="correlationError ?? undefined"
          :initial-tab="detailTableInitialTab"
          class="rounded-default"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex"
          :totalLength="parseInt(searchObj.data.queryResults.hits.length)"
          :highlight-query="searchObj.data.highlightQuery"
          @showNextDetail="navigateRowDetail"
          @showPrevDetail="navigateRowDetail"
          @add:searchterm="addSearchTerm"
          @remove:searchterm="removeSearchTerm"
          @search:timeboxed="onTimeBoxed"
          @add:table="addFieldToTable"
          @close="searchObj.meta.showDetailTab = false"
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
      </ODrawer>

      <!-- Pattern Details Drawer -->
      <PatternDetailsDialog
        v-model="showPatternDetails"
        :selectedPattern="selectedPattern"
        :totalPatterns="patternNavTotal"
        @navigate="navigatePatternDetail"
        @filter-value="addWildcardValueToSearch"
        @add-to-search="addPatternToSearch"
        @create-alert="createAlertFromPattern"
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
      :matched-set-id="correlationDashboardProps.matchedSetId"
      :chip-dimensions="correlationDashboardProps.chipDimensions"
      :source-event="correlationDashboardProps.sourceEvent"
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
  type PropType,
  provide,
} from "vue";
import { copyToClipboard } from "@/utils/clipboard";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useI18n } from "vue-i18n";

import { byString } from "../../utils/json";
import { getImageURL, useLocalWrapContent } from "../../utils/zincutils";
import { formatLargeNumber } from "@/utils/formatters";
import { CUSTOM_THEME_NAME, THEME_STORAGE_KEYS } from "@/constants/themes";
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
import { usePagination } from "@/composables/useLogs/usePagination";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import { searchState } from "@/composables/useLogs/searchState";
import TelemetryCorrelationDashboard from "@/plugins/correlation/TelemetryCorrelationDashboard.vue";
import type { TelemetryContext } from "@/utils/telemetryCorrelation";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { buildChipDimensionsFromFilters } from "@/services/service_streams";
import { buildWorkloadChipDimensions } from "@/composables/useMetricSubjectButtons";
import { extractSeverity } from "@/utils/sourceEventSeverity";
import config from "@/aws-exports";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  buildPatternVolumeContext,
  fetchWindowTotal,
  usePatternVolumeCache,
  PATTERN_VOLUME_CACHE,
  type PatternVolumeContext,
} from "./patterns/usePatternVolume";

export default defineComponent({
  name: "SearchResult",
  components: {
    ORefreshButton,
    OButton,
    ODrawer,
    OSpinner,
    OTooltip,
    OSelect,
    OPagination,
    OEmptyState,
    LoadingProgress,
    DetailTable: defineAsyncComponent(() => import("./DetailTable.vue")),
    ChartRenderer: defineAsyncComponent(
      () => import("@/components/dashboards/panels/ChartRenderer.vue"),
    ),
    SanitizedHtmlRenderer,
    TenstackTable: defineAsyncComponent(() => import("./TenstackTable.vue")),
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
    OIcon,
    ODropdown,
    ODropdownItem,
    OTag,
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
    "jump-to-stream-data",
  ],
  props: {
    expandedLogs: {
      type: Array,
      default: () => [],
    },
    streamDocTimeRange: {
      type: Object as PropType<{ min: number; max: number }>,
      default: undefined,
    },
    queryWindowUs: {
      type: Object as PropType<{ start: number; end: number }>,
      default: undefined,
    },
  },
  methods: {
    handleColumnSizesUpdate(newColSizes: any) {
      // colSizes entries are arrays of size-maps keyed by joined stream name.
      const colSizes = this.searchObj.data.resultGrid?.colSizes as Record<
        string,
        Record<string, unknown>[]
      >;
      const prevColSizes =
        colSizes?.[this.searchObj.data.stream.selectedStream.join(",")]?.[0] ||
        {};
      this.searchObj.data.resultGrid.colSizes[
        this.searchObj.data.stream.selectedStream.join(",")
      ] = [
        {
          ...prevColSizes,
          ...newColSizes,
        },
      ];
    },
    handleColumnOrderUpdate(newColOrder: string[]) {
      // Here we are checking if the columns are default columns ( _timestamp and source)
      // If selected fields are empty, then we are setting colOrder to empty array as we
      // don't change the order of default columns
      // If you store the colOrder it will create issue when you save the view and load it again
      if (!this.searchObj.data.stream.selectedFields.length) {
        this.searchObj.data.resultGrid.colOrder[
          this.searchObj.data.stream.selectedStream.join(",")
        ] = [];
      } else {
        this.searchObj.data.resultGrid.colOrder[
          this.searchObj.data.stream.selectedStream.join(",")
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
          toast({
            variant: "error",
            message: this.t("logs.searchResult.pageOutOfRange"),
            timeout: 1000,
          });
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          return false;
        }

        this.searchObj.data.resultGrid.currentPage = this.pageNumberInput;
        this.$emit("update:scroll");
        this.scrollTableToTop(0);
      }
      return undefined;
    },
    closeColumn(col: any) {
      // Explicit user action — clear the system-pick marker so the result persists.
      this.searchObj.meta.isFtsDefaultColumn = false;
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
    const { isDark } = useTheme();
    const searchListContainer = ref<HTMLElement | null>(null);

    // Responsive: observe the outer container (reacts to splitter + window resize)
    const containerWidth = ref(9999);
    let containerResizeObserver: ResizeObserver | null = null;
    // match shouldMoveActionsToMenu threshold: 3 pages when narrow, 5 when wide
    const paginationMaxPages = computed(() => containerWidth.value < 700 ? 3 : 5);

    const noOfRecordsTitle = computed<string>(
      () => (searchObj.data.histogram.chartParams.title as string) || "",
    );

    const patternSummaryText = computed<string>(() => {
      const stats = patternsState.value?.patterns?.statistics;
      if (!stats) return "";
      const patternsFound = stats.total_patterns_found || 0;
      const logsAnalyzed = formatLargeNumber(stats.total_logs_analyzed || 0);
      const totalEvents = searchObj.data.queryResults?.total || stats.total_logs_analyzed || 0;
      const totalEventsStr = totalEvents ? formatLargeNumber(totalEvents) : logsAnalyzed;
      const totalTimeMs = (searchObj.data.queryResults?.took || 0) + (stats.extraction_time_ms || 0);
      return t("search.pattern_summary", {
        totalEvents: totalEventsStr,
        patternsFound,
        logsAnalyzed,
        totalTime: totalTimeMs,
      });
    });

    // Parses the histogram title string into structured chip data for logs mode.
    // Format: "Showing X to Y out of Z events in T ms. (Scan Size: S MB)"
    const recordsChips = computed(() => {
      const title = noOfRecordsTitle.value;
      if (!title) return null;

      const eventsInIdx = title.indexOf(" events in ");
      if (eventsInIdx === -1) return null;

      const records = title.substring("Showing ".length, eventsInIdx + " events".length);
      const afterEvents = title.substring(eventsInIdx + " events in ".length);

      const msIdx = afterEvents.indexOf(" ms.");
      const time = msIdx !== -1 ? afterEvents.substring(0, msIdx) + " ms" : afterEvents;

      const parenMatch = afterEvents.match(/\((.+?)\)/);
      const scan = parenMatch ? parenMatch[1] : null;

      return { records, time, scan };
    });

    // Derives structured chip data for patterns mode from raw stats.
    const patternChips = computed(() => {
      const stats = patternsState.value?.patterns?.statistics;
      if (!stats) return null;

      const patternsFound = stats.total_patterns_found || 0;
      // The window's real event count — NOT `total_logs_analyzed`, which is the
      // extraction sample (capped at ~10K). Showing that read as "this window
      // holds 10K events" when it holds millions, and disagreed with the same
      // chip when arriving from the search page.
      const totalEvents =
        patternWindowTotal.value ?? searchObj.data.queryResults?.total ?? null;
      const totalEventsStr =
        totalEvents === null ? null : formatLargeNumber(totalEvents);
      const totalTimeMs =
        (searchObj.data.queryResults?.took || 0) + (stats.extraction_time_ms || 0);

      return {
        events: totalEventsStr,
        patterns: patternsFound,
        time: totalTimeMs,
      };
    });
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

    const { reorderSelectedFields, getFilterExpressionByFieldType, resolveDefaultColumns } = useLogs();

    const { searchObj } = searchState();

    // Use separate patterns state (completely isolated from logs)
    const { patternsState } = usePatterns();

    const {
      selectedPattern,
      showPatternDetails,
      openPatternDetails,
      navigatePatternDetail,
      navTotal: patternNavTotal,
      addPatternToSearch,
      addWildcardValueToSearch,
      createAlertFromPattern,
    } = usePatternActions();

    // Context the pattern details drawer needs to look up a pattern's
    // window-wide volume, so its Occurrences figure matches the list's `~N`
    // instead of falling back to the much smaller extraction-sample count.
    const patternVolumeContext = computed<PatternVolumeContext | null>(() =>
      buildPatternVolumeContext({
        orgId: store.state.selectedOrganization?.identifier ?? "",
        streamName: searchObj.data.stream.selectedStream[0],
        window: props.queryWindowUs as { start: number; end: number } | undefined,
        lastQuery: patternsState.value?.lastQuery,
      }),
    );

    // Exact event count for the query window, from one aggregate query. Feeds
    // both the "N events" chip and the severity-chip scaling in PatternList, so
    // they can't disagree. Generation-guarded: a slow reply for an earlier
    // window must not overwrite the current one.
    // One volume cache for the whole patterns view. Provided here rather than in
    // PatternList so the details drawer — a sibling of the list, not a child —
    // reads the same entries the rows already fetched. Opening a row is then a
    // cache hit and shows its real count immediately, instead of rendering the
    // extraction-sample figure and swapping it out a moment later.
    const patternVolumeCache = usePatternVolumeCache(patternVolumeContext);
    provide(PATTERN_VOLUME_CACHE, {
      request: patternVolumeCache.request,
      get: patternVolumeCache.get,
    });

    const patternWindowTotal = ref<number | null>(null);
    let patternWindowTotalGeneration = 0;
    watch(
      patternVolumeContext,
      async (ctx) => {
        const token = ++patternWindowTotalGeneration;
        patternWindowTotal.value = null;
        if (!ctx) return;
        const total = await fetchWindowTotal(ctx);
        if (token === patternWindowTotalGeneration) {
          patternWindowTotal.value = total;
        }
      },
      { immediate: true },
    );

    const pageNumberInput = ref(1);
    const totalHeight = ref(0);

    // Volume Analysis state
    const showVolumeAnalysisDashboard = ref(false);
    const hasHistogramSelection = ref(false);
    const histogramSelectionRange = ref<{
      start: number;
      end: number;
      timeStart: number | undefined;
      timeEnd: number | undefined;
    }>({
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
    const scrollContainerRef = ref<HTMLElement | null>(null);
    const histogramRef = ref(null);

    // Correlation dashboard state
    const showCorrelation = ref(false);
    const correlationContext = ref<TelemetryContext | null>(null);
    const correlationDashboardProps = ref<any>(null);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);
    const detailTableInitialTab = ref<string>("json");
    const { findRelatedTelemetry, semanticGroups } = useServiceCorrelation();

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
      const currentMode = isDark.value ? "dark" : "light";
      const appliedThemeName = localStorage.getItem(
        THEME_STORAGE_KEYS[currentMode].appliedName,
      );

      // Custom color: user may be dragging the picker — debounce to avoid jank
      if (appliedThemeName === CUSTOM_THEME_NAME) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => reDrawChart(), 300);
      } else {
        // Predefined / default theme applied - re-render immediately
        if (debounceTimer) clearTimeout(debounceTimer);
        reDrawChart();
      }
    };

    // Re-render stacked chart with correct palette when dark/light mode switches
    watch(
      () => isDark.value,
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

      // Observe the outer container so breakpoints respond to splitter + window resize
      if (searchListContainer.value) {
        containerWidth.value = searchListContainer.value.getBoundingClientRect().width;
        containerResizeObserver = new ResizeObserver((entries) => {
          containerWidth.value = entries[0]?.contentRect.width ?? 0;
        });
        containerResizeObserver.observe(searchListContainer.value);
      }
    });

    onBeforeUnmount(() => {
      window.removeEventListener("themeColorChanged", handleThemeColorChange);
      containerResizeObserver?.disconnect();
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
         
        Object.prototype.hasOwnProperty.call(
          searchObj.data.histogram,
          "xData",
        ) &&
        searchObj.data.histogram.xData.length > 0
      ) {
        const { xData, yData, breakdownSeries, chartParams, breakdownField } =
          searchObj.data.histogram;

        if (breakdownSeries && breakdownSeries.size > 0) {
          plotChart.value = convertStackedLogData(
            xData,
            breakdownSeries,
            { ...chartParams, breakdownField: breakdownField ?? null },
            isDark.value,
          );
        } else {
          plotChart.value = convertLogData(xData, yData, chartParams);
        }
      }
    };

    const toggleFieldList = () => {
      searchObj.meta.showFields = !searchObj.meta.showFields;
      nextTick(() => {
        if (searchObj.meta.showHistogram) reDrawChart();
      });
    };

    const changeMaxRecordToReturn = () => {
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
          "[SearchResult] Could not find flex index for correlation",
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
          correlationError.value = t("logs.searchResult.noMatchingService");
          return;
        }

        if (!result.correlationData) {
          console.warn("[SearchResult] No correlation data in result");
          correlationError.value = t("logs.searchResult.unableToRetrieveCorrelation");
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

        const sourceEvent = {
          timestamp: logData._timestamp,
          severity: extractSeverity(logData) ?? undefined,
          message:
            logData.body ||
            logData.message ||
            logData.log ||
            logData.msg,
        };

        correlationDashboardProps.value = {
          serviceName: result.correlationData.service_name,
          matchedDimensions: actualMatchedDimensions,
          additionalDimensions: {},
          matchedSetId: result.correlationData.matched_set_id,
          // Chip dimensions derived from actual per-stream filters returned by
          // _correlate. Only fields that appear in StreamInfo.filters are shown,
          // ensuring every chip corresponds to a real SQL WHERE condition.
          chipDimensions: {
            ...buildChipDimensionsFromFilters(result.correlationData, semanticGroups.value),
            // Subject dims (semantic IDs) for metrics tab subject chips (Pod, Node, Host…).
            // Keyed by semantic ID so unifiedChips recognises them as kind="subject".
            ...buildWorkloadChipDimensions(result.correlationData.matched_set_id, semanticGroups.value, logData),
          },
          sourceEvent,
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
          toast({
            variant: "info",
            message: t("logs.searchResult.noMetricStreams", {
              service: result.correlationData.service_name,
            }),
          });
        }

        // For inline expanded logs, open the correlation dashboard as a dialog
        // For DetailTable drawer, the data is passed via props (tabs are already visible)
        if (!searchObj.meta.showDetailTab) {
          showCorrelation.value = true;
        }
      } catch (err: any) {
        console.error("[SearchResult] Error in openCorrelationFromLog:", err);
        correlationError.value = t("logs.searchResult.correlationError", {
          error: err.message || err,
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
      // Clicks on log-row include/exclude should always append (AND) to the
      // existing query, never replace an existing condition for the same field
      // — unlike the field-sidebar checkboxes which represent the full set of
      // selected values for that field.
      searchObj.data.stream.addToFilterMode = "append";
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
      // Explicit user action — this selection is now user-owned, so allow it to
      // persist (clears any prior system-pick FTS-default marker).
      searchObj.meta.isFtsDefaultColumn = false;
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
      copyToClipboard(copyData, {
        successMessage: t("logs.searchResult.contentCopied"),
        timeout: 1000,
      });
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
    // 250 bars × 9px (7px bar + 2px gap) = 2250px — covers any viewport width.
    // Heights cycle through a realistic uneven pattern so it looks like real log data.
    const SKELETON_HEIGHTS = [45,72,58,88,62,42,78,52,73,38,68,83,48,68,44,92,62,38,72,56,32,82,48,64,38,88,68,44,78,52,40,95,55,70,30,85,65,50,75,42];
    const skeletonBarHeights = Array.from({ length: 250 }, (_, i) => ({
      id: i,
      pct: SKELETON_HEIGHTS[i % SKELETON_HEIGHTS.length],
    }));

    const sendToAiChat = (value: any, append: boolean = true) => {
      emit("sendToAiChat", value, append);
    };

    const closeTable = () => {
      searchObj.meta.showDetailTab = false;
      // Clear correlation data when closing sidebar so it doesn't persist to next "row"
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
        toast({
          variant: "warning",
          message: t("logs.searchResult.noTraceIdForInspection"),
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
          // FTS default columns are a convenience for the default logs view only.
          // In SQL mode the user authored the exact SELECT list (custom queries,
          // CTEs, aggregates), so their result columns are authoritative — never
          // inject an FTS default over a hand-written query.
          if (searchObj.meta.sqlMode) {
            return;
          }
          // Only the system may overwrite a column the system itself picked.
          // isFtsDefaultColumn is the authoritative "current columns are a system
          // pick" signal: it is true only when this watcher set the columns, and
          // is cleared the moment the user takes any explicit column action (pin,
          // toggle, remove, reset). So we re-evaluate the FTS default ONLY when
          // there is no selection at all, or the existing selection is a prior
          // system pick. A user-chosen selection (flag false, non-empty) — even
          // if it happens to be FTS fields like "message" — is left untouched.
          const currentFields = searchObj.data.stream.selectedFields;
          const canResolveDefault =
            !currentFields.length || searchObj.meta.isFtsDefaultColumn;
          if (canResolveDefault) {
            const hits = searchObj.data.queryResults?.hits || [];
            const globalFtsKeys = store?.state?.zoConfig?.default_fts_keys || [];
            const ftsDefaults = resolveDefaultColumns(
              searchObj.data.stream.selectedStreamFields,
              globalFtsKeys,
              hits,
            );
            // ftsDefaults is [] when no candidate has filled values → falls through to _source
            searchObj.data.stream.selectedFields = ftsDefaults;
            // Mark this as a system pick so it is not persisted to logFilterField.
            // A stale persisted FTS default would otherwise leak back into later
            // searches (and SQL mode) as if the user had chosen it.
            searchObj.meta.isFtsDefaultColumn = ftsDefaults.length > 0;
          }
        }
      },
    );

    watch(
      () => patternsState.value.loading,
      (loading, wasLoading) => {
        if (wasLoading && !loading) {
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

    // Watch for sidebar close to clear correlation data
    // This ensures fresh correlation data when reopening with a different "row"
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
        .filter((field: any) => field.ftsKey)
        .map((field: any) => field.name);
      //merge default FTS keys with selected stream FTS keys
      return [...new Set([...defaultFTSKeys, ...selectedStreamFTSKeys])];
    });

    return {
      isDark,
      t,
      store,
      config,
      plotChart,
      searchObj,
      containerWidth,
      paginationMaxPages,
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
      toggleFieldList,
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
      recordsChips,
      patternChips,
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
      skeletonBarHeights,
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
      patternNavTotal,
      patternVolumeContext,
      patternWindowTotal,
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
      resolveDefaultColumns,
    };
  },
  computed: {
    toggleWrapFlag() {
      return this.searchObj.meta.toggleSourceWrap;
    },
    findFTSFields() {
      return this.searchObj.data.stream.selectedStreamFields;
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
    // Responsive: collapse action buttons to overflow menu when container is narrow
    shouldMoveActionsToMenu() {
      return this.containerWidth < 700;
    },
    // Show icon + label on action buttons when container is wide enough
    showActionLabels() {
      return this.containerWidth >= 900;
    },
    showInspectBtn() {
      return (
        this.searchObj.data?.queryResults?.hits?.length > 0 &&
        this.searchObj.data.lastSearchTraceId &&
        this.config.isEnterprise == "true" &&
        this.config.isCloud == "false" &&
        this.store.state.zoConfig.search_inspector_enabled
      );
    },
    showAnalyzeBtn() {
      return (
        this.searchObj.data?.queryResults?.hits?.length > 0 &&
        !this.searchObj.meta.sqlMode
      );
    },
    showWrapBtn() {
      return (
        this.searchObj.meta.logsVisualizeToggle === "logs" ||
        this.searchObj.meta.logsVisualizeToggle === "patterns"
      );
    },
  },
  watch: {
    toggleWrapFlag() {
      this.useLocalWrapContent(this.searchObj.meta.toggleSourceWrap);
    },
    findFTSFields() {
      this.extractFTSFields();
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
/* keep(generated-content): pin-breakdown tooltip. The rows are built from data
   via v-for with per-row inline colours, and the whole tooltip is
   <Teleport to="body">; Vue still stamps the scope id onto teleported nodes, so
   `scoped` reaches it. Surfaces/borders/text use the theme-flipping tokens;
   include/exclude actions use --color-status-info-* / --color-status-error-*
   with color-mix tints. */
.oo-pin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.oo-pin-tooltip {
  position: fixed;
  z-index: 9999;
  min-width: 12.5rem;
  max-height: 20vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--color-surface-base);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  box-shadow: var(--shadow-lg);
  padding: 0.5rem 0;
  font-size: var(--text-xs);
  color: var(--color-text-heading);
  outline: none;

  &__time {
    font-size: var(--text-2xs);
    font-weight: 500;
    opacity: 0.65;
    padding: 0 0.625rem 0.25rem;
    margin-bottom: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-grey-500) 15%, transparent);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 1px 0.625rem;
    transition: background 0.1s;

    &:hover {
      background: color-mix(in srgb, var(--color-grey-500) 12%, transparent);
    }
  }

  &__dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__name {
    flex: 1;
    white-space: nowrap;
  }

  &__count {
    font-weight: 600;
    min-width: 2rem;
    text-align: right;
    transition: opacity 0.1s;
  }

  &__row-actions {
    display: flex;
    gap: 0.1875rem;
    flex-shrink: 0;
    margin-left: 0.25rem;
  }

  &__action {
    width: 1.375rem;
    height: 1.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-default);
    cursor: pointer;
    font-size: var(--text-compact);
    font-weight: 700;
    line-height: 1;

    &--include {
      background: color-mix(in srgb, var(--color-status-info-text) 12%, transparent);
      color: var(--color-status-info-text);

      &:hover {
        background: color-mix(in srgb, var(--color-status-info-text) 25%, transparent);
      }
    }

    &--exclude {
      background: color-mix(in srgb, var(--color-status-error-text) 8%, transparent);
      color: var(--color-status-error-text);

      &:hover {
        background: color-mix(in srgb, var(--color-status-error-text) 20%, transparent);
      }
    }
  }
}

/* keep(lib-override:opagination): reaches into the OPagination/OSelect-rendered
   button DOM to compress the pagination controls into the results toolbar. */
.paginator-section {
  line-height: 1.5rem;
  max-height: 2rem;
  border-radius: 0.5rem;
  padding: 0.125rem 0.25rem;
  background: color-mix(in srgb, var(--color-white) 10%, transparent);
  backdrop-filter: blur(0.625rem);
  margin-top: 0;
  overflow: visible;

  :deep(.o-pagination__btn) {
    padding: 0.125rem 0.25rem !important;
    height: 1.5rem !important;
    min-height: 1.5rem !important;
    min-width: 1.5rem !important;
    font-size: var(--text-xs) !important;
    border-radius: 0.25rem !important;
    line-height: 1rem !important;

    svg {
      width: 1rem !important;
      height: 1rem !important;
    }
  }
}

.select-pagination {
  position: relative;
  width: 4rem !important;
  height: 1.5rem !important;
  margin-top: 0;

  :deep(button) {
    height: 1.5rem !important;
    min-height: 1.5rem !important;
    font-size: var(--text-xs) !important;
    padding-inline: 0.5rem !important;
  }
}
/* keep(keyframes): the histogram skeleton's shimmer @keyframes and the
   animation: that references it must stay in the same scoped block so Vue
   renames both consistently. */
.histogram-container {
  border-radius: 0.5rem;
  position: relative;

  &--visible {
    height: 6.25rem;
    padding-top: 0.25rem;
    opacity: 1;
    transition: all 0.3s ease-in-out;
  }

  &--hidden {
    height: 0;
    opacity: 0;
    overflow: hidden;
    transition: all 0.3s ease-in-out;
  }
}

.histogram-chart {
  /* Explicit height (not just max-height): the ChartRenderer inside sizes
     with h-full, and a percentage height collapses to 0 against an
     auto-height parent — which renders an empty histogram strip. */
  height: 6rem;
  max-height: 6.25rem;
  border-radius: 0.5rem;
}

.histogram-empty {
  height: 6.25rem;
  border-radius: 0.5rem;

  &__message {
    min-height: 2rem;
  }
}

.histogram-skeleton {
  --hsk-bar:     var(--color-grey-100);
  --hsk-shimmer: color-mix(in srgb, var(--color-white) 65%, transparent);

  .dark & {
    --hsk-bar:     var(--color-grey-700);
    --hsk-shimmer: color-mix(in srgb, var(--color-white) 6%, transparent);
  }

  height: 6.25rem;
  display: flex;
  flex-direction: column;
  padding-top: 0.25rem;
  overflow: hidden;

  &__main {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  &__y-axis {
    width: 2.25rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    padding-right: 0.3125rem;
    padding-bottom: 0.125rem;
  }

  &__y-label {
    height: 0.4375rem;
    border-radius: 0.125rem;
    background-color: var(--hsk-bar);
  }

  &__plot {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  &__bars {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 0.125rem;
    padding: 0.25rem 0.25rem 0;
    overflow: hidden;
    position: relative;

    &::after {
      content: "";
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        90deg,
        transparent        0%,
        transparent       20%,
        var(--hsk-shimmer) 50%,
        transparent       80%,
        transparent       100%
      );
      animation: histogram-bar-shimmer 1.6s ease-in-out infinite;
      pointer-events: none;
    }
  }

  &__bar {
    flex: 0 0 0.4375rem;
    flex-shrink: 0;
    border-radius: 0.0625rem 0.0625rem 0 0;
    background-color: var(--hsk-bar);
  }

  &__x-axis {
    display: flex;
    justify-content: space-between;
    padding-left: 2.25rem;
    padding-top: 0.1875rem;
  }

  &__x-label {
    width: 2.25rem;
    height: 0.4375rem;
    border-radius: 0.125rem;
  }
}

@keyframes histogram-bar-shimmer {
  from { left: -100%; }
  to   { left: 100%; }
}

.histogram-error {
  margin: 0.5rem 0;
  border-radius: 0.5rem;

  &__message {
    min-height: 2rem;
  }
}
</style>
