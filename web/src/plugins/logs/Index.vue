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

<!-- eslint-disable vue/attribute-hyphenation -->
<!-- eslint-disable vue/v-on-event-hyphenation -->
<template>
  <div
    class="rounded-default logPage h-full max-h-full! min-h-full! overflow-hidden!"
    id="logPage"
    data-test="logs-page-container"
  >
    <div id="secondLevel" class="h-full max-h-full overflow-hidden">
      <OSplitter
        class="h-full max-h-full overflow-hidden"
        v-model="splitterModel"
        :horizontal="true"
        unit="px"
        :limits="[85, 400]"
        :separatorStyle="{
          height: '0.625rem',
          marginTop: '-0.3125rem',
          marginBottom: '-0.3125rem',
          zIndex: '10',
        }"
        @update:model-value="onSplitterUpdate"
      >
        <template v-slot:before>
          <!-- px-1 (4px), not 10px: the search bar's own content already carries
               a 6px internal inset (toolbar p-1.5 + editor ms-1.5), so 4+6=10px
               lines the toolbar/editor up with the 10px field-list & results
               panels below. -->
          <div class="h-full w-full">
            <SearchBar
              data-test="logs-search-bar"
              ref="searchBarRef"
              :fieldValues="fieldValues"
              @searchdata="searchData"
              @onChangeInterval="onChangeInterval"
              @onChangeTimezone="refreshTimezone"
              @handleQuickModeChange="handleQuickModeChange"
              :buildRunBlocked="buildRunBlocked"
              @handleRunQueryFn="handleRunQueryFn"
              @on-auto-interval-trigger="onAutoIntervalTrigger"
              @showSearchHistory="showSearchHistoryfn"
              @extractPatterns="extractPatternsForCurrentQuery"
              @buildModeToggle="onBuildModeToggle"
              @sendToAiChat="sendToAiChat"
            />
          </div>
        </template>
        <template v-slot:after>
          <div
            id="thirdLevel"
            class="scroll relative-position thirdlevel logsPageMainSection border-border-default m-0 box-border flex h-full max-h-full w-full overflow-hidden border-t p-0"
            v-show="
              searchObj.meta.logsVisualizeToggle == 'logs' ||
              searchObj.meta.logsVisualizeToggle == 'patterns'
            "
          >
            <!-- Note: Splitter max-height to be dynamically calculated with JS -->
            <OSplitter
              v-model="searchObj.config.splitterModel"
              :limits="isMobile ? [0, 0] : searchObj.config.splitterLimit"
              class="logs-splitter-smooth h-full max-h-full w-full overflow-hidden"
              separatorClass="field-list-separator"
              :separatorStyle="{
                width: '0.625rem',
                marginLeft: '-0.3125rem',
                marginRight: '-0.3125rem',
                zIndex: '10',
              }"
              @update:model-value="onSplitterUpdate"
            >
              <template #before>
                <!-- 10px on top (matching the search bar's 4+6 above it).
                     No right/bottom gutter here: the field list runs into the
                     divider so its scrollbar sits on the panel edge, and scrolls
                     into the panel foot. The form controls (stream selector, field
                     search) carry their own matching px-1.5 gutter (see IndexList /
                     OFieldList) so they line up — they're controls, not scrolling
                     surfaces. -->
                <div
                  class="relative-position border-border-default bg-surface-panel h-full border-e pt-2.5"
                >
                  <IndexList
                    v-if="searchObj.meta.showFields && !isMobile"
                    data-test="logs-search-index-list"
                    @setInterestingFieldInSQLQuery="setInterestingFieldInSQLQuery"
                  />
                </div>
              </template>
              <template #after>
                <div class="h-full">
                  <div class="bg-card-glass-bg relative-position h-full w-full">
                    <div
                      v-if="
                        !searchObj.loadingStream &&
                        searchObj.data.stream.streamLists.length == 0 &&
                        searchObj.loading == false
                      "
                      class="h-full max-lg:overflow-y-auto"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <LogsNoDataState
                        :ai-enabled="isAiEnabled"
                        data-test="logs-search-no-streams-in-org-text"
                        @ask-ai="onAskAiFixQuery"
                      />
                    </div>
                    <!--
                      No stream selected — the org has streams but none is
                      chosen. This is more fundamental than any error / loading /
                      no-events state (all meaningless without a stream), so it is
                      checked first and is NOT gated on errorMsg/loading/
                      loadingStream flags. Those could be stale (e.g. a stuck
                      loadingStream after an early-return in extractFields, or a
                      leftover errorMsg after resetSearchObj), which would
                      otherwise fall through to the results branch and leave the
                      center blank.

                      filterErrMsg IS checked here though: a non-empty query
                      naming a stream that doesn't exist also leaves
                      selectedStream empty, and that has a specific cause to show
                      (see updateQueryValue's streamFound handling) rather than
                      the generic "pick a stream" prompt.
                    -->
                    <div
                      v-else-if="
                        searchObj.data.stream.streamLists.length > 0 &&
                        searchObj.data.stream.selectedStream.length == 0 &&
                        searchObj.data.filterErrMsg === ''
                      "
                      class="h-full max-lg:overflow-y-auto"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <LogsNoStreamState
                        :org-id="store.state.selectedOrganization.identifier"
                        :stream-type="searchObj.data.stream.streamType"
                        :auto-run="isAutoRunOn"
                        data-test="logs-search-no-stream-selected-text"
                        @select-stream="onSelectStream"
                        @pick-stream="onPickStream"
                      />
                    </div>
                    <div
                      v-else-if="searchObj.data.filterErrMsg !== '' && searchObj.loading == false"
                      data-test="logs-search-filter-error-message"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <LogsErrorState
                        :error-code="0"
                        :error-msg="searchObj.data.filterErrMsg"
                        :ai-enabled="isAiEnabled"
                        @ask-ai="onAskAiFixQuery"
                        @fix-query="onFixQuery"
                        @configure-stream="onConfigureStream"
                        @widen-range="onWidenRange"
                      />
                    </div>
                    <div
                      v-else-if="searchObj.data.freeTextBlocked && searchObj.loading == false"
                      class="flex h-full min-h-0 flex-col"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <LogsNoFtsPanel
                        :streams="noFtsPanelStreams"
                        :term="noFtsRecoveryTerm"
                        :recovery-streams="noFtsRecoverySchemas"
                        :selected-streams="searchObj.data.stream.selectedStream"
                        @clear-run="onNoFtsClearRun"
                        @field-search="onNoFtsFieldSearch"
                        @configure="onConfigureFreeTextStream"
                      />
                    </div>
                    <div
                      v-else-if="searchObj.data.errorMsg !== '' && searchObj.loading == false"
                      data-test="logs-search-error-state"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <LogsErrorState
                        :error-code="parseInt(searchObj.data.errorCode) || 0"
                        :error-msg="searchObj.data.errorMsg"
                        :error-detail="searchObj.data.errorDetail"
                        :ai-enabled="isAiEnabled"
                        :stream-name="searchObj.data.stream.selectedStream[0]"
                        :free-text-candidate="recoveryCards.freeTextCandidate"
                        :run-suggestion="recoveryCards.runSuggestion"
                        :filter-mode="!searchObj.meta.sqlMode"
                        @ask-ai="onAskAiFixQuery"
                        @fix-query="onFixQuery"
                        @configure-stream="onConfigureStream"
                        @widen-range="onWidenRange"
                        @search-text="onSearchText"
                        @run-suggestion="onRunSuggestion"
                      />
                    </div>
                    <div v-else-if="showGuardEmptyState" class="h-full max-lg:overflow-y-auto">
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <LogsAutoRunGuard
                        :blocked="searchObj.meta.autoRunBlocked"
                        :auto-run-on="isAutoRunOn"
                        :show-search-job="showGuardSearchJob"
                        @run="onGuardRunAnyway"
                        @narrow="onGuardNarrow"
                        @search-job="onGuardSearchJob"
                        @select-stream="onSelectStream"
                      />
                    </div>

                    <div
                      v-else-if="showSearchCancelledState"
                      class="flex h-full flex-col"
                      data-test="logs-search-cancelled-state"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <OEmptyState
                        preset="search-cancelled"
                        size="hero"
                        class="min-h-0 flex-1"
                        @action="() => searchBarRef?.handleRunQueryFn?.()"
                      />
                    </div>
                    <div
                      v-else-if="
                        searchObj.meta.logsVisualizeToggle === 'logs' &&
                        searchObj.data.queryResults.hasOwnProperty('hits') &&
                        searchObj.data.queryResults.hits.length == 0 &&
                        searchObj.loading == false &&
                        searchObj.meta.searchApplied == true
                      "
                      class="flex h-full flex-col"
                      data-test="logs-search-no-events-found-text"
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <!-- With no rows the results grid is gone, so the exclusions banner moves here. -->
                      <LogsMissingStreamBanner
                        v-if="searchObj.data.missingStreamMessage"
                        :message="searchObj.data.missingStreamMessage"
                        :no-fts-streams="searchObj.data.freeTextExcluded ?? []"
                        :term="noFtsRecoveryTerm"
                        :recovery-streams="noFtsRecoverySchemas"
                        :selected-streams="searchObj.data.stream.selectedStream"
                        @clear-run="onNoFtsClearRun"
                        @field-search="onNoFtsFieldSearch"
                      />
                      <LogsNoEventsState
                        class="min-h-0 flex-1"
                        :sql-mode="searchObj.meta.sqlMode"
                        :query="searchObj.data.query"
                        :editor-value="searchObj.data.editorValue"
                        :relative-time-period="searchObj.data.datetime.relativeTimePeriod || ''"
                        :date-type="searchObj.data.datetime.type || 'relative'"
                        :ai-enabled="isAiEnabled"
                        :stream-doc-time-range="streamDocTimeRange"
                        :query-window-us="queryWindowUs"
                        :timezone="store.state.timezone"
                        @jump-to-stream-data="onJumpToStreamData"
                        @open-history="showSearchHistoryfn"
                        @ask-ai="onAskAiFixQuery"
                      />
                    </div>
                    <div
                      v-else-if="
                        searchObj.meta.logsVisualizeToggle === 'logs' &&
                        searchObj.data.queryResults.hasOwnProperty('hits') &&
                        searchObj.data.queryResults.hits.length == 0 &&
                        searchObj.loading == false &&
                        searchObj.meta.searchApplied == false
                      "
                    >
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <OEmptyState
                        preset="no-query-applied"
                        size="hero"
                        data-test="logs-search-apply-search-text"
                        @action="() => searchBarRef?.handleRunQueryFn?.()"
                      />
                    </div>
                    <div
                      v-else-if="
                        searchObj.meta.logsVisualizeToggle === 'patterns' &&
                        patternsState?.patterns?.patterns?.length == 0 &&
                        searchObj.meta.searchApplied == false &&
                        searchObj.loading == false
                      "
                    >
                      <OEmptyState
                        preset="no-query-applied"
                        size="hero"
                        data-test="logs-search-patterns-apply-search-text"
                        @action="() => searchBarRef?.handleRunQueryFn?.()"
                      />
                    </div>
                    <div
                      v-else
                      data-test="logs-search-search-result"
                      class="flex h-full max-h-full flex-col overflow-hidden"
                    >
                      <!-- Notice order above the table is owned by item 2 (P4): guard banner, then the stale chip. -->
                      <LogsAutoRunGuard
                        v-if="showGuardBanner"
                        variant="banner"
                        :blocked="searchObj.meta.autoRunBlocked"
                        :auto-run-on="isAutoRunOn"
                        :show-search-job="showGuardSearchJob"
                        @run="onGuardRunAnyway"
                        @narrow="onGuardNarrow"
                        @search-job="onGuardSearchJob"
                        @select-stream="onSelectStream"
                      />
                      <div
                        v-if="isResultsStale && searchObj.meta.logsVisualizeToggle === 'logs'"
                        class="flex items-center px-2.5 pt-2"
                      >
                        <OBadge
                          variant="warning-soft"
                          size="sm"
                          icon="schedule"
                          data-test="logs-search-results-stale"
                        >
                          {{ t("search.autoRunStaleChip") }}
                        </OBadge>
                        <OTooltip :content="t('search.autoRunStaleTooltip')" />
                      </div>
                      <div v-if="showSearchCancelledNotice" class="flex items-center px-2.5 pt-2">
                        <OBadge
                          variant="default-soft"
                          size="sm"
                          icon="cancel"
                          data-test="logs-search-cancelled-notice"
                        >
                          {{ t("search.searchCancelledNotice") }}
                        </OBadge>
                      </div>
                      <LogsPermalinkBanner
                        @retry="onPermalinkRetry"
                        @show-lines="onPermalinkShowLines"
                        @show-in-context="onPermalinkShowInContext"
                        @go-to-page="onSharedPageGo"
                      />
                      <div class="min-h-0 flex-1">
                        <SearchResult
                          @no-fts-clear-run="onNoFtsClearRun"
                          @no-fts-field-search="onNoFtsFieldSearch"
                          ref="searchResultRef"
                          :expandedLogs="expandedLogs"
                          :stream-doc-time-range="streamDocTimeRange"
                          :query-window-us="queryWindowUs"
                          @update:datetime="setHistogramDate"
                          @update:scroll="getMoreData"
                          @update:recordsPerPage="getMoreDataRecordsPerPage"
                          @expandlog="toggleExpandLog"
                          @send-to-ai-chat="sendToAiChat"
                          @run-query="searchData"
                          @jump-to-stream-data="onJumpToStreamData"
                          @open-mobile-fields="mobileFieldsOpen = true"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </OSplitter>
          </div>
          <div
            v-show="searchObj.meta.logsVisualizeToggle == 'visualize'"
            class="border-border-default flex h-full flex-col border-t"
            :style="{ '--splitter-width': `${100 - splitterModel}vw` }"
          >
            <LogsAutoRunGuard
              v-if="searchObj.meta.autoRunBlocked?.op === 'visualize'"
              variant="banner"
              :blocked="searchObj.meta.autoRunBlocked"
              :auto-run-on="isAutoRunOn"
              :show-search-job="showGuardSearchJob"
              @run="onGuardRunAnyway"
              @narrow="onGuardNarrow"
              @search-job="onGuardSearchJob"
              @select-stream="onSelectStream"
            />
            <LogsNoFtsPanel
              v-if="
                searchObj.data.freeTextBlocked && searchObj.meta.logsVisualizeToggle == 'visualize'
              "
              :streams="noFtsPanelStreams"
              :term="noFtsRecoveryTerm"
              :recovery-streams="noFtsRecoverySchemas"
              :selected-streams="searchObj.data.stream.selectedStream"
              @clear-run="onNoFtsClearRun"
              @field-search="onNoFtsFieldSearch"
              @configure="onConfigureFreeTextStream"
            />
            <VisualizeLogsQuery
              v-show="!searchObj.data.freeTextBlocked"
              class="min-h-0 flex-1"
              :visualizeChartData="visualizeChartData"
              :errorData="visualizeErrorData"
              :searchResponse="searchResponseForVisualization"
              :is_ui_histogram="shouldUseHistogramQuery"
              :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
              :histogramQuery="storedHistogramQuery"
            >
            </VisualizeLogsQuery>
          </div>
          <div
            v-if="searchObj.meta.logsVisualizeToggle == 'drilldown'"
            class="border-border-default h-full overflow-hidden border-t"
            data-test="logs-drill-down-page"
          >
            <!-- Same no-stream / error / no-events states as the results pane. -->
            <OEmptyState
              v-if="searchObj.meta.sqlMode"
              size="hero"
              :title="t('search.drillDownUnavailableInSqlMode')"
              data-test="logs-drill-down-sql-mode-text"
            />
            <LogsNoDataState
              v-else-if="
                !searchObj.loadingStream &&
                searchObj.data.stream.streamLists.length == 0 &&
                searchObj.loading == false
              "
              :ai-enabled="isAiEnabled"
              data-test="logs-drill-down-no-streams-in-org-text"
              @ask-ai="onAskAiFixQuery"
            />
            <LogsNoStreamState
              v-else-if="
                searchObj.data.stream.streamLists.length > 0 &&
                searchObj.data.stream.selectedStream.length == 0 &&
                searchObj.data.filterErrMsg === ''
              "
              :org-id="store.state.selectedOrganization.identifier"
              :stream-type="searchObj.data.stream.streamType"
              :auto-run="isAutoRunOn"
              data-test="logs-drill-down-no-stream-selected-text"
              @select-stream="onSelectStream"
              @pick-stream="onPickStream"
            />
            <LogsErrorState
              v-else-if="searchObj.data.filterErrMsg !== '' && searchObj.loading == false"
              data-test="logs-drill-down-filter-error-message"
              :error-code="0"
              :error-msg="searchObj.data.filterErrMsg"
              :ai-enabled="isAiEnabled"
              @ask-ai="onAskAiFixQuery"
              @fix-query="onFixQuery"
              @configure-stream="onConfigureStream"
              @widen-range="onWidenRange"
            />
            <LogsErrorState
              v-else-if="searchObj.data.errorMsg !== '' && searchObj.loading == false"
              data-test="logs-drill-down-error-state"
              :error-code="parseInt(searchObj.data.errorCode) || 0"
              :error-msg="searchObj.data.errorMsg"
              :error-detail="searchObj.data.errorDetail"
              :ai-enabled="isAiEnabled"
              :stream-name="searchObj.data.stream.selectedStream[0]"
              @ask-ai="onAskAiFixQuery"
              @fix-query="onFixQuery"
              @configure-stream="onConfigureStream"
              @widen-range="onWidenRange"
            />
            <div v-else-if="searchObj.loading" class="flex h-full items-center justify-center">
              <OSpinner size="lg" />
            </div>
            <LogsAutoRunGuard
              v-else-if="searchObj.meta.autoRunBlocked && !searchObj.data.queryResults.hits?.length"
              :blocked="searchObj.meta.autoRunBlocked"
              :auto-run-on="isAutoRunOn"
              :show-search-job="showGuardSearchJob"
              @run="onGuardRunAnyway"
              @narrow="onGuardNarrow"
              @search-job="onGuardSearchJob"
              @select-stream="onSelectStream"
            />
            <!-- Mounted only once a search settles, so each search rebuilds it from the new results. -->
            <TracesAnalysisDashboard
              v-else-if="searchObj.data.queryResults.hits?.length > 0"
              embedded
              :streamName="searchObj.data.stream.selectedStream[0]"
              streamType="logs"
              :timeRange="drillDownTimeRange"
              :rateFilter="drillDownRateFilter"
              :baseFilter="drillDownBaseFilter"
              :streamFields="
                searchObj.data.stream.userDefinedSchema?.length > 0
                  ? searchObj.data.stream.userDefinedSchema
                  : searchObj.data.stream.selectedStreamFields
              "
              :logSamples="searchObj.data.queryResults.hits"
              analysisType="volume"
            />
            <LogsNoEventsState
              v-else-if="searchObj.meta.searchApplied == true"
              data-test="logs-drill-down-no-events-found-text"
              :sql-mode="searchObj.meta.sqlMode"
              :query="searchObj.data.query"
              :editor-value="searchObj.data.editorValue"
              :relative-time-period="searchObj.data.datetime.relativeTimePeriod || ''"
              :date-type="searchObj.data.datetime.type || 'relative'"
              :ai-enabled="isAiEnabled"
              :stream-doc-time-range="streamDocTimeRange"
              :query-window-us="queryWindowUs"
              :timezone="store.state.timezone"
              @jump-to-stream-data="onJumpToStreamData"
              @open-history="showSearchHistoryfn"
              @ask-ai="onAskAiFixQuery"
            />
            <OEmptyState
              v-else
              preset="no-query-applied"
              size="hero"
              data-test="logs-drill-down-apply-search-text"
              @action="() => searchBarRef?.handleRunQueryFn?.()"
            />
          </div>
          <div
            v-if="searchObj.meta.logsVisualizeToggle == 'build'"
            class="h-full overflow-hidden"
            :style="{ '--splitter-width': `${100 - splitterModel}vw` }"
          >
            <BuildQueryPage
              ref="buildQueryPageRef"
              :searchQuery="searchObj.meta.sqlMode ? searchObj.data.query : ''"
              :selectedStream="searchObj.data.stream.selectedStream[0] || ''"
              :selectedDateTime="selectedDateTime"
              :isFirstToggle="isFirstBuildToggle"
              :isSqlMode="searchObj.meta.sqlMode"
              :whereClause="buildWhereForBuild.where"
              :freeTextFilter="buildWhereForBuild.freeText"
              @apply="onBuildApply"
              @cancel="onBuildCancel"
              @queryGenerated="onBuildQueryGenerated"
              @customQueryModeChanged="onCustomQueryModeChanged"
              @initialized="onBuildInitialized"
            />
          </div>
        </template>
      </OSplitter>
    </div>

    <ODrawer
      v-if="isMobile"
      v-model:open="mobileFieldsOpen"
      side="left"
      size="sm"
      bleed
      seamless
      anchor="#thirdLevel"
      data-test="logs-mobile-fields-drawer"
    >
      <div class="flex h-full flex-col overflow-hidden pt-2.5">
        <IndexList
          data-test="logs-search-index-list-mobile"
          @setInterestingFieldInSQLQuery="setInterestingFieldInSQLQuery"
        />
      </div>
    </ODrawer>
    <!-- Outside the results, which an error state replaces exactly when a failed page is announced. -->
    <div class="sr-only" aria-live="polite" aria-atomic="true" data-test="logs-row-nav-live">
      {{ rowNavAnnouncement }}
    </div>
    <LogsPermalinkDrawer
      @search-around="runSearchAround"
      @add-search-term="onPermalinkAddSearchTerm"
      @send-to-ai-chat="sendToAiChat"
    />
  </div>
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
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";

import analytics from "@/services/product_analytics";
import config from "@/aws-exports";
import { verifyOrganizationStatus, deepCopy, addSpacesToOperators } from "@/utils/zincutils";
import MainLayoutCloudMixin from "@/enterprise/mixins/mainLayout.mixin";
import useLogs from "@/composables/useLogs";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { reactive } from "vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep, debounce } from "lodash-es";
import {
  isSimpleSelectAllQuery,
  getStreamFromQuery,
  extractWhereClause,
} from "@/utils/query/sqlUtils";
import { buildColumnIdentifierAst, quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { replaceSelectFieldList } from "@/utils/query/quickModeFieldList";
import useNotifications from "@/composables/useNotifications";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { type ActivationState, PageType } from "@/ts/interfaces/logs.ts";
import { isWebSocketEnabled, isStreamingEnabled } from "@/utils/zincutils";
import { allSelectionFieldsHaveAlias } from "@/utils/query/visualizationUtils";
import { shouldReloadStreamFieldsForVisualize } from "@/utils/logs/visualizeStreamFields";
import { pruneInterestingFields } from "@/utils/logs/interestingFields";
import useAiChat from "@/composables/useAiChat";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { onBeforeAppReload } from "@/utils/beforeAppReload";
import { searchState } from "@/composables/useLogs/searchState";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import usePatterns from "@/composables/useLogs/usePatterns";
import {
  getVisualizationConfig,
  decodeVisualizationConfig,
} from "@/composables/useLogs/logsVisualization";
import useSearchBar, { bumpSelectionToken } from "@/composables/useLogs/useSearchBar";
import { useHistogram } from "@/composables/useLogs/useHistogram";
import useStreams from "@/composables/useStreams";
import { contextRegistry } from "@/composables/contextProviders";
import { createLogsContextProvider } from "@/composables/contextProviders/logsContextProvider";
import IndexList from "@/plugins/logs/IndexList.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import LogsNoEventsState from "@/plugins/logs/LogsNoEventsState.vue";
import LogsNoDataState from "@/plugins/logs/LogsNoDataState.vue";
import LogsNoStreamState from "@/plugins/logs/LogsNoStreamState.vue";
import LogsErrorState from "@/plugins/logs/LogsErrorState.vue";
import LogsNoFtsPanel from "@/plugins/logs/LogsNoFtsPanel.vue";
import LogsMissingStreamBanner from "@/plugins/logs/LogsMissingStreamBanner.vue";
import LogsAutoRunGuard from "@/plugins/logs/LogsAutoRunGuard.vue";
import LogsPermalinkBanner from "@/plugins/logs/LogsPermalinkBanner.vue";
import LogsPermalinkDrawer from "@/plugins/logs/LogsPermalinkDrawer.vue";
import {
  activePermalink,
  clearColumnsFromUrl,
  clearPermalink,
  currentInitOrigin,
  initOriginForRun,
  resetPermalinkState,
  sharedLineRecord,
} from "@/composables/useLogs/useLogPermalink";
import {
  beginPermalinkFromUrl,
  resolveActivePermalink,
  retryPermalinkResolve,
  type ResolveContext,
} from "@/composables/useLogs/permalinkResolve";
import {
  parseSharedPage,
  resetShownSearch,
  sharedPage,
  sharedPageNotice,
} from "@/composables/useLogs/useLogsUrl";
import { useLogsUrlSync } from "@/composables/useLogs/useLogsUrlSync";
import { useSearchAround } from "@/composables/useLogs/searchAround";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  saveLogsSelectedStreams,
  saveLogsStreamType,
  restoreLogsStreamType,
} from "@/utils/streamPersist";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import { fieldSearchPredicate, type NoFtsFieldSubmission } from "./LogsNoFtsFieldSearch.schema";
import { isAuthoredStatement, renderPlan } from "@/utils/query/freeTextFilter";
import {
  buildFilterContext,
  markFreeTextBlocked,
  noFtsStreams,
  noFtsRecoveryStreams,
  planStreamsFilter,
  recoveryCardsFor,
  searchTextReplacement,
} from "@/composables/useLogs/freeTextSearch";
import { isAutoRunActive, type RunContext } from "@/composables/useLogs/useAutoRun";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import {
  logsRowNavAnnouncement,
  nextJobRequestId,
  notePageLoad,
  notePageRequest,
  resetRowSelection,
} from "@/composables/useLogs/logsRowNav";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "PageSearch",
  components: {
    SearchBar,
    IndexList,
    SearchResult: defineAsyncComponent(() => import("@/plugins/logs/SearchResult.vue")),
    VisualizeLogsQuery: defineAsyncComponent(() => import("@/plugins/logs/VisualizeLogsQuery.vue")),
    BuildQueryPage: defineAsyncComponent(() => import("@/plugins/logs/BuildQueryPage.vue")),
    LogsNoFtsPanel,
    LogsMissingStreamBanner,
    LogsPermalinkBanner,
    LogsPermalinkDrawer,
    TracesAnalysisDashboard: defineAsyncComponent(
      () => import("@/plugins/traces/metrics/TracesAnalysisDashboard.vue"),
    ),
    OSplitter,
    ODrawer,
    OEmptyState,
    OSpinner,
    LogsNoEventsState,
    LogsNoDataState,
    LogsNoStreamState,
    LogsErrorState,
    LogsAutoRunGuard,
    OBadge,
    OTooltip,
  },
  mixins: [MainLayoutCloudMixin],
  emits: ["sendToAiChat"],
  methods: {
    setHistogramDate(date: any) {
      this.searchBarRef?.markZoom?.();
      this.searchBarRef.dateTimeRef.setCustomDate("absolute", date);
    },
    searchData() {
      // Explicit: supersedes an in-flight run instead of waiting for it (P2).
      this.autoRun.engine.requestRun("run");

      analytics.track("Button Click", {
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
        if (this.searchObj.meta.jobId == "") {
          this.autoRun.engine.requestRun("page-size");
        } else {
          this.searchObj.loading = true;
          // Without this a page-size change fired a page-count request instead of the histogram.
          this.searchObj.meta.refreshHistogram = true;
          this.searchObj.data.queryResults.aggs = null;
          await this.getJobData(false);
        }

        analytics.track("Button Click", {
          button: "Get More Data",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.searchObj.data.stream.selectedStream.join(","),
          page: "Search Logs",
        });
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
        if (this.searchObj.meta.jobId == "") {
          this.autoRun.engine.requestRun("pagination");
        } else {
          this.searchObj.loading = true;
          // Bound before the await, so a J/K crossing sees its request when the paginator returns (4a §3.2.2).
          const requestId = nextJobRequestId();
          notePageRequest(this.searchObj, requestId);
          try {
            await this.getJobData(false);
            notePageLoad(this.searchObj, requestId, "done");
          } catch {
            notePageLoad(this.searchObj, requestId, "error");
          }
        }

        analytics.track("Button Click", {
          button: "Get More Data",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.searchObj.data.stream.selectedStream.join(","),
          page: "Search Logs",
        });
      }
    },
    async getLessData() {
      if (
        this.searchObj.meta.sqlMode == false &&
        this.searchObj.meta.refreshInterval == 0 &&
        this.searchObj.data.queryResults.total > this.searchObj.data.queryResults.from &&
        this.searchObj.data.queryResults.total > this.searchObj.data.queryResults.size &&
        this.searchObj.data.queryResults.total >
          this.searchObj.data.queryResults.size + this.searchObj.data.queryResults.from
      ) {
        // this.searchObj.data.resultGrid.currentPage =
        //   ((this.searchObj.data.queryResults?.hits?.length || 0) +
        //     ((this.searchObj.data.queryResults?.hits?.length || 0) + 150)) /
        //     150 -
        //   1;
        this.searchObj.data.resultGrid.currentPage = this.searchObj.data.resultGrid.currentPage - 1;

        this.autoRun.engine.requestRun("pagination");

        analytics.track("Button Click", {
          button: "Get Less Data",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.searchObj.data.stream.selectedStream.join(","),
          page: "Search Logs",
        });
      }
    },
  },
  setup(props: any, { emit }: any) {
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();
    const {
      searchObj,
      resetSearchObj,
      initialLogsState,
      resetStreamData,
      fieldValues,
      resetSearchError,
    } = searchState();
    const { getStreamList, updateGridColumns, extractFields } = useStreamFields();
    const { getFunctions, getQueryData, getRegionInfo, setCommunicationMethod, onStreamChange } =
      useSearchBar(t);
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
      runGridSearch,
      resetRunStateForReapply,
      getFilterExpressionByFieldType,
    } = useLogs(t);
    const autoRun = useLogsAutoRun();

    const {
      getHistogramQueryData,
      resetHistogramWithError,
      generateHistogramData,
      generateHistogramSkeleton,
    } = useHistogram();

    const { getStream } = useStreams(t);

    const {
      fnParsedSQL,
      fnUnparsedSQL,
      isDistinctQuery,
      isWithQuery,
      isLimitQuery,
      updateUrlQueryParams,
      generateURLQuery,
      patchUrlViewState,
      addTraceId,
    } = logsUtils();
    const { getHistogramData, buildWebSocketPayload, buildSearch, initializeSearchConnection } =
      useSearchStream(t);

    // Initialize patterns composable (completely separate from logs)
    const { extractPatterns, patternsState, cancelPatterns, clearPatterns } = usePatterns(t);

    const searchResultRef = ref(null);
    const searchBarRef = ref(null);

    // Uses SearchResult's histogram brush; SearchResult stays mounted (hidden) in Drill down.
    const drillDownTimeRange = computed(
      () =>
        searchResultRef.value?.originalTimeRangeBeforeSelection ||
        searchResultRef.value?.volumeAnalysisTimeRange || {
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
        },
    );
    const drillDownRateFilter = computed(() =>
      searchResultRef.value?.hasHistogramSelection
        ? searchResultRef.value.histogramSelectionRange
        : undefined,
    );
    // The last run filter: the editor stays editable in Drill down and may hold unrun typing.
    const drillDownBaseFilter = ref(searchObj.data.editorValue);
    let runningSearchFilter = searchObj.data.editorValue;
    watch(
      () => searchObj.loading,
      (loading) => {
        if (loading) runningSearchFilter = searchObj.data.editorValue;
        else drillDownBaseFilter.value = runningSearchFilter;
      },
    );
    const buildQueryPageRef = ref(null);
    const showJobScheduler = ref(false);

    const isLogsMounted = ref(false);

    const expandedLogs = ref([]);
    const splitterModel = ref(90);

    const { isMobile, isTablet } = useBreakpoint();
    const mobileFieldsOpen = ref(false);
    watch(
      isMobile,
      (mobile, wasMobile) => {
        if (mobile) {
          searchObj.config.splitterModel = 0;
        } else if (wasMobile && searchObj.config.splitterModel === 0 && searchObj.meta.showFields) {
          searchObj.config.splitterModel = searchObj.config.lastSplitterPosition || 20;
        }
      },
      { immediate: true },
    );
    // md–lg: the desktop 20% pane is ~140px, too narrow for the stream picker.
    let preTabletSplitter: number | null = null;
    watch(
      isTablet,
      (tablet, wasTablet) => {
        if (tablet && searchObj.config.splitterModel > 0 && searchObj.config.splitterModel < 30) {
          preTabletSplitter = searchObj.config.splitterModel;
          searchObj.config.splitterModel = 30;
        } else if (wasTablet && !tablet && !isMobile.value && preTabletSplitter !== null) {
          // Back on a laptop: undo the floor unless the reader dragged the pane since.
          if (searchObj.config.splitterModel === 30) {
            searchObj.config.splitterModel = preTabletSplitter;
          }
          preTabletSplitter = null;
        }
      },
      { immediate: true },
    );

    const chartRedrawTimeout = ref(null);
    const updateColumnsTimeout = ref(null);

    const { showErrorNotification, showAliasErrorForVisualization } = useNotifications();

    provide("dashboardPanelDataPageKey", "logs");
    const visualizeChartData = ref({});
    const {
      dashboardPanelData,
      validatePanel,
      resetDashboardPanelData,
      setCustomQueryFields,
      getResultSchema,
    } = useDashboardPanelData("logs", t);

    // Get build page's dashboardPanelData for watching chart type/config changes
    const {
      dashboardPanelData: buildDashboardPanelData,
      removeXYFilters: buildRemoveXYFilters,
      updateXYFieldsForCustomQueryMode: buildUpdateXYFieldsForCustomQueryMode,
    } = useDashboardPanelData("build", t);

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

    const { registerAiChatHandler, removeAiChatHandler } = useAiChat();

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
      registerAiContextHandler();
      setupContextProvider();
    });

    onBeforeUnmount(async () => {
      // Cancel all the search queries
      if (store.state.refreshIntervalID) clearInterval(store.state.refreshIntervalID);
      endSharedLinkSession();

      autoRun.engine.cancelGeneration(null, { cause: "unmount" });
      cancelPatterns();

      removeAiContextHandler();
      cleanupContextProvider();

      // Clear any pending timeouts
      clearAllTimeouts();
      try {
        if (searchObj) {
          // Save visualization config so it can be restored when navigating back
          if (searchObj.meta.logsVisualizeToggle === "visualize") {
            searchObj.meta.savedVisualizationConfig = getVisualizationConfig(dashboardPanelData);
          }

          // Serialize breakdownSeries Map as entries array before JSON cloning
          const breakdownSeries = searchObj.data?.histogram?.breakdownSeries;
          const serializableSearchObj = {
            ...searchObj,
            data: {
              ...searchObj.data,
              histogram: {
                ...searchObj.data?.histogram,
                breakdownSeries:
                  breakdownSeries instanceof Map ? [...breakdownSeries.entries()] : null,
              },
            },
          };
          let savedSearchObj = JSON.parse(JSON.stringify(serializableSearchObj));
          savedSearchObj.loading = false;
          savedSearchObj.loadingHistogram = false;
          savedSearchObj.loadingCounter = false;
          savedSearchObj.loadingStream = false;
          savedSearchObj.loadingSavedView = false;
          await store.dispatch("logs/setLogs", savedSearchObj);
        }
      } catch (error) {
        console.error("Failed to set logs:", error.message);
      }

      clearSearchObj();
      searchBarRef.value = null;
      searchResultRef.value = null;
    });

    // Logs has no beforeunload guard; the URL is what restoreUrlQueryParams reads back after the language reload.
    const persistQueryForReload = async (): Promise<void> => {
      const query = generateURLQuery(false);
      if (query.type === "search_history_re_apply" || query.type === "search_scheduler") {
        delete query.type;
      }
      await router.replace({ query });
    };

    let stopBeforeAppReload: (() => void) | null = null;
    const unregisterBeforeAppReload = () => {
      stopBeforeAppReload?.();
      stopBeforeAppReload = null;
    };
    const registerBeforeAppReload = () => {
      unregisterBeforeAppReload();
      stopBeforeAppReload = onBeforeAppReload(persistQueryForReload);
    };

    // Logs is not in MainLayout's keep-alive include list, so onActivated alone would never run.
    onMounted(registerBeforeAppReload);

    onActivated(() => {
      registerBeforeAppReload();
      if (isLogsMounted.value) handleActivation();
    });

    onDeactivated(unregisterBeforeAppReload);
    onBeforeUnmount(unregisterBeforeAppReload);

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
          if (prev === "stream_explorer" && (type == undefined || type !== "stream_explorer")) {
            searchObj.meta.refreshHistogram = true;
          }
          loadLogsData("landing");
        }
      },
    );
    watch(
      () => router.currentRoute.value.query.type,
      async (type) => {
        if (type == "search_history_re_apply" || type == "ai_chat_query") {
          searchObj.meta.jobId = "";
          resetRunStateForReapply();

          searchObj.organizationIdetifier = router.currentRoute.value.query.org_identifier;
          searchObj.data.stream.selectedStream.value = router.currentRoute.value.query.stream;
          searchObj.data.stream.streamType = router.currentRoute.value.query.stream_type;
          resetSearchObj();

          // Set time range based on source type
          if (
            type == "ai_chat_query" &&
            router.currentRoute.value.query.from &&
            router.currentRoute.value.query.to
          ) {
            searchBarRef.value.dateTimeRef.setAbsoluteTime(
              router.currentRoute.value.query.from,
              router.currentRoute.value.query.to,
            );
            searchObj.data.datetime.type = "absolute";
          } else {
            // As when redirecting from search history to logs page, date type was getting set as absolute, so forcefully keeping it relative.
            searchBarRef.value.dateTimeRef.setRelativeTime(router.currentRoute.value.query.period);
            searchObj.data.datetime.type = "relative";
          }

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
          searchObj.organizationIdetifier = router.currentRoute.value.query.org_identifier;
          searchObj.data.stream.selectedStream.value = router.currentRoute.value.query.stream;
          searchObj.data.stream.streamType = router.currentRoute.value.query.stream_type;
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
          await loadLogsData("url");
        }
      },
    );

    // The `runQuery` flag path (Run, legacy QOSS=false runs): an explicit run under a generation.
    const runQueryFn = async () => {
      searchObj.runQuery = false;
      if (!searchObj.data.stream.selectedStream.length) {
        searchObj.loading = false;
        return;
      }
      autoRun.engine.requestRun("run");
    };

    // Executor for every grid run (AC4.6 dispatch by mode): full, pagination and page size.
    const executeGridRun = async (ctx: RunContext) => {
      const generationId = ctx.generation.id;
      autoRun.adoptHandOver(ctx);
      if (!searchObj.data.stream.selectedStream.length) {
        searchObj.loading = false;
        autoRun.finishDispatch(generationId, { hitsDone: true });
        return;
      }
      let mode: "full" | "page" | "page-size" = "full";
      if (ctx.op === "page") mode = ctx.reason === "page-size" ? "page-size" : "page";
      try {
        await runGridSearch(generationId, mode, initOriginForRun(ctx.origin));
        refreshHistogramChart();
        if (mode === "full") showJobScheduler.value = true;
      } finally {
        autoRun.finishDispatch(generationId);
      }
    };

    // Executor for the histogram reveal (C14): one histogram request, rows kept, zero hits requests.
    const executeHistogramRun = async (ctx: RunContext) => {
      const generationId = ctx.generation.id;
      try {
        searchObj.meta.histogramDirtyFlag = false;
        await generateHistogramSkeleton();
        getHistogramData(searchObj.data.histogramQuery, { generationId });
      } finally {
        autoRun.finishDispatch(generationId, { hitsDone: true });
      }
    };

    /**
     * Common method to extract patterns
     * Handles validation, loading states, and error handling
     */
    const extractPatternsForCurrentQuery = async (clear_cache = false, generationId?: number) => {
      const engine = autoRun.engine;
      const settle = () => {
        if (generationId != null) engine.settleGeneration(generationId);
      };
      // Clear any stale error from previous logs search
      resetSearchError();

      // Patterns extraction only supports a single stream (dedicated
      // single-stream API). Reject client-side instead of letting the
      // request fail server-side and leaving the previous single-stream
      // result on screen.
      if (!searchObj.meta.sqlMode && searchObj.data.stream.selectedStream.length > 1) {
        cancelPatterns();
        clearPatterns();
        showErrorNotification(t("logs.index.patternsUnavailableForMultiStream"));
        if (generationId != null) engine.recordPatternsFailure(generationId);
        settle();
        return;
      }

      searchObj.meta.resultGrid.showPagination = false;
      searchObj.loading = true;

      try {
        const queryReq = buildSearch(false, true);
        if (!queryReq) {
          searchObj.loading = false;
          if (generationId != null) engine.recordPatternsFailure(generationId);
          settle();
          return;
        }

        // Set size to -1 to let backend determine sampling size based on config
        queryReq.query.size = -1;

        // set quick_mode false for patterns
        queryReq.query.quick_mode = false;

        // Extract stream name:
        // - SQL mode: parse FROM clause from user-written SQL
        // - Non-SQL mode: use selectedStream directly (patterns always run on a single stream)
        let streamName = null;

        if (searchObj.meta.sqlMode && queryReq.query.sql) {
          const fromMatch = queryReq.query.sql.match(/FROM\s+["']?([^"'\s,]+)["']?/i);
          if (fromMatch?.[1]) streamName = fromMatch[1];
        }

        if (!streamName) {
          const selectedStreams = searchObj.data.stream.selectedStream;
          if (!selectedStreams?.length) {
            searchObj.loading = false;
            showErrorNotification(t("logs.index.selectStreamToExtractPatterns"));
            if (generationId != null) engine.recordPatternsFailure(generationId);
            settle();
            return;
          }
          streamName = selectedStreams[0];
        }

        await extractPatterns(searchObj.organizationIdentifier, streamName, queryReq);
        // A cancelled or replaced extraction returns quietly; it must not publish a record.
        if (generationId != null && !engine.isCurrent(generationId)) return;
        searchObj.loading = false;
        if (generationId != null) engine.recordPatternsComplete(generationId);

        // Only update histogram for patterns mode, don't fetch logs data
        // Patterns have their own separate state and don't need logs data
        searchObj.meta.clearCache = clear_cache;
        searchObj.meta.refreshHistogram = true;

        // Fetch histogram data only (not logs) for patterns mode. It needs the
        // same request the extraction ran on: called with no arguments it threw
        // on `queryReq.query`, and because the throw happens inside the
        // manager's own promise it escaped this try/catch as an unhandled
        // rejection rather than surfacing as a search error.
        await getHistogramData(queryReq, { clear_cache });
        refreshHistogramChart();
        settle();
      } catch (error) {
        console.error("[Index] Error extracting patterns:", error);
        searchObj.loading = false;
        showErrorNotification(t("logs.index.errorExtractingPatterns"));
        if (generationId != null) engine.recordPatternsFailure(generationId);
        settle();
      }
    };

    const executePatternsRun = async (ctx: RunContext) => {
      autoRun.engine.registerAbort(ctx.generation.id, () => cancelPatterns());
      await extractPatternsForCurrentQuery(!!searchObj.meta.clearCache, ctx.generation.id);
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
      if (Object.hasOwn(router.currentRoute.value?.query, "logs_visualize_toggle")) {
        const urlToggle = router.currentRoute.value.query.logs_visualize_toggle;
        // Restoring directly onto the Timechart tab: setupLogsTab() will run the
        // visualization once fields are ready, so tell the toggle watcher to skip
        // the page-load fire it is about to receive from the assignment below.
        if (urlToggle === "visualize") {
          isInitialVisualizeRestore.value = true;
        }
        searchObj.meta.logsVisualizeToggle = urlToggle;
      }

      // Always setup logs tab on mount
      await setupLogsTab();
    }

    // Helper function to check if the current tab is "logs"
    function isLogsTab() {
      return searchObj.meta.logsVisualizeToggle === "logs";
    }

    // Search History and the AI chat only re-apply the query; the scheduler also runs it.
    const RE_APPLY_QUERY_TYPES = ["search_history_re_apply", "ai_chat_query"];
    const URL_DRIVEN_QUERY_TYPES = [...RE_APPLY_QUERY_TYPES, "search_scheduler"];

    const isRouteChanged = () => {
      // Not kept alive: this fresh mount never fires the type watchers, so the cached searchObj would bury the URL query (#14283).
      if (URL_DRIVEN_QUERY_TYPES.includes(router.currentRoute.value.query.type)) {
        store.dispatch("logs/setIsInitialized", false);
        return;
      }

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
        // restoreUrlQueryParams() deletes a search_history_re_apply `type` off the route, so read it first.
        const arrivalType = router.currentRoute.value.query.type;
        isRouteChanged();
        if (!store.state.logs.isInitialized) {
          searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;

          searchObj.meta.pageType = "logs";
          searchObj.meta.refreshHistogram = true;
          // Bhargav Todo: remove this comment
          // searchObj.loading = true;

          resetSearchObj();

          resetStreamData();

          searchObj.meta.quickMode = isQuickModeEnabled();

          searchObj.meta.showHistogram = isHistogramEnabled();

          // If the org in the URL doesn't match the currently selected org, the
          // URL params are stale (race condition: router.push from updateOrganization
          // hasn't finished when the new component mounts due to :key change).
          // In that case skip URL param restoration so the old stream is not carried
          // over to the new org.
          const urlOrgId = router.currentRoute.value.query.org_identifier as string;
          const isOrgMismatch =
            !!urlOrgId && urlOrgId !== store.state.selectedOrganization.identifier;

          if (!isOrgMismatch) {
            startSharedLinkSession(router.currentRoute.value.query);
            await restoreUrlQueryParams(dashboardPanelData);
            if (activePermalink.value) void resolveActivePermalink(permalinkResolveContext());
          } else {
            endSharedLinkSession();
          }

          if (
            store.state.zoConfig?.auto_query_enabled &&
            !router.currentRoute.value.query.stream &&
            !router.currentRoute.value.query.stream_type
          ) {
            const persistedType = restoreLogsStreamType(
              store.state.selectedOrganization.identifier,
            );
            if (persistedType) {
              searchObj.data.stream.streamType = persistedType;
            }
          }

          if (isEnterpriseClusterEnabled()) {
            await getRegionInfo();
          }

          // Drill down is built from the logs results, so it loads them too.
          if (isLogsTab() || searchObj.meta.logsVisualizeToggle === "drilldown") {
            if (RE_APPLY_QUERY_TYPES.includes(arrivalType)) {
              await applyReAppliedQuery();
            } else {
              searchObj.loading = true;
              loadLogsData("landing", { origin: currentInitOrigin() ?? undefined });
            }
          } else if (searchObj.meta.logsVisualizeToggle === "patterns") {
            await loadPatternsData();
            autoRun.request("patterns");
          } else {
            await loadVisualizeData();
            searchObj.loading = false;
            // The visualize toggle watcher bails out during page load because it
            // fires before URL restoration completes. Now that the
            // stream and its fields are restored, mirror the watcher's setup,
            // restore the saved chart type/config from the URL, and run the
            // visualization. Scoped to the visualize tab — the build tab loads
            // through BuildQueryPage and must not auto-run here.
            if (
              searchObj.meta.logsVisualizeToggle === "visualize" &&
              searchObj.data.stream.selectedStream?.length
            ) {
              prepareVisualizeMode();
              // Suppress the chart-type watcher while restoring (it would
              // trigger a duplicate updateVisualization for the type change).
              isRestoringFromUrl.value = true;
              restoreVisualizationFromUrlOnLoad();
              await nextTick();
              isRestoringFromUrl.value = false;
              handleVisualizeTab();
            }
          }

          store.dispatch("logs/setIsInitialized", true);
        } else {
          await initialLogsState();
          const savedAutoRun = localStorage.getItem("oo_toggle_auto_run");
          if (savedAutoRun !== null) {
            searchObj.meta.liveMode = savedAutoRun === "true";
          }
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
      return config.isEnterprise === "true" && store.state.zoConfig.super_cluster_enabled;
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
      const savedAutoRun = localStorage.getItem("oo_toggle_auto_run");
      if (savedAutoRun !== null) {
        searchObj.meta.liveMode = savedAutoRun === "true";
      }

      try {
        const queryParams: any = router.currentRoute.value.query;

        const activationState: ActivationState = {
          // Drill down is built from the logs results, so it reactivates like Search.
          isSearchTab:
            searchObj.meta.logsVisualizeToggle === PageType.LOGS ||
            searchObj.meta.logsVisualizeToggle === "drilldown",
          isStreamExplorer: queryParams.type === PageType.STREAM_EXPLORER,
          isTraceExplorer: queryParams.type === PageType.TRACE_EXPLORER,
          isStreamChanged:
            queryParams.stream_type !== searchObj.data.stream.streamType ||
            queryParams.stream !== searchObj.data.stream.selectedStream.join(","),
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
    async function handleTraceExplorer(queryParams) {
      searchObj.organizationIdentifier = queryParams.org_identifier;
      searchObj.data.stream.selectedStream.value = queryParams.stream;
      searchObj.data.stream.streamType = queryParams.stream_type;
      resetSearchObj();
      resetStreamData();
      await restoreUrlQueryParams(dashboardPanelData);
      loadLogsData("url");
    }

    // loadLogsData() minus getQueryData(): a re-applied query is loaded for the user to run, not run for them.
    async function applyReAppliedQuery() {
      resetRunStateForReapply();
      searchObj.meta.searchApplied = false;
      await getStreamList();
      await getFunctions();
      await extractFields();
      refreshData();
      searchObj.loading = false;
    }

    // Helper function for handling the stream explorer
    async function handleStreamExplorer() {
      resetSearchObj();
      resetStreamData();
      await restoreUrlQueryParams(dashboardPanelData);
      loadLogsData("url");
    }

    // Helper function for organization change (C20): the old org's generation is cancelled with its own orgId.
    function handleOrganizationChange() {
      bumpSelectionToken();
      autoRun.engine.resetScope("org");
      endSharedLinkSession();
      searchObj.meta.freeTextScan = {};
      searchObj.loading = true;
      resetStreamData();
      // The URL still names the previous org's stream; this is a landing in the new org (C20).
      loadLogsData("landing", { ignoreUrl: true });
    }

    // Check if the selected organization has changed
    function isOrganizationChanged() {
      return searchObj.organizationIdentifier !== store.state.selectedOrganization.identifier;
    }

    // Visualize / Patterns / Build restore and keep-alive reactivation are guarded entry points (C17, C21).
    function handleVisualizeTab() {
      autoRun.request(
        searchObj.meta.logsVisualizeToggle === "patterns" ? "patterns" : "visualize-restore",
      );
    }

    const refreshTimezone = () => {
      updateGridColumns();
      generateHistogramData();
      refreshHistogramChart();
    };

    const refreshHistogramChart = () => {
      nextTick(() => {
        if (searchObj.meta.showHistogram && searchResultRef.value?.reDrawChart) {
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
          searchObj.data.freeTextBlocked = null;
          let selectFields = "";
          let whereClause = "";
          let currentQuery = searchObj.data.query;

          const hasSelect =
            currentQuery != "" &&
            (currentQuery.toLowerCase() === "select" ||
              currentQuery.toLowerCase().indexOf("select ") == 0);
          // An authored statement is kept as typed; text that merely contains "select" is a filter.
          if (isAuthoredStatement(currentQuery)) {
            return;
          }

          const toggleStreams: string[] = searchObj.data.stream.selectedStream;
          const toggleCtx = buildFilterContext(searchObj, store.state.zoConfig);
          const togglePlan = planStreamsFilter(currentQuery.trim(), toggleStreams, toggleCtx);
          const textWhere =
            togglePlan.kind === "freeText"
              ? toggleStreams.map((stream) =>
                  renderPlan(togglePlan, toggleCtx.targets[stream], toggleCtx.knownFields),
                )
              : null;
          if (textWhere?.some((where) => where === null)) {
            // A no-FTS arm would fail or be dropped, so the toggle is refused (AC6.3).
            const blocked = toggleStreams.filter((_, index) => textWhere[index] === null);
            searchObj.meta.sqlModeEditTransition = true;
            searchObj.meta.sqlMode = false;
            markFreeTextBlocked(searchObj, blocked, togglePlan);
            showErrorNotification(t("search.freeTextChooseFirst"));
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
                const parsedFilterQuery = addSpacesToOperators(currentQuery)
                  .split(" ")
                  .map((token: string) => token.replaceAll('"', ""));
                const streamFieldNames = new Set(
                  searchObj.data.stream.selectedStreamFields.map((item: any) => item.name),
                );

                for (const [index, token] of parsedFilterQuery.entries()) {
                  if (streamFieldNames.has(token)) {
                    parsedFilterQuery[index] = quoteSqlIdentifierIfNeeded(token);
                  }
                }

                whereClause = "WHERE " + parsedFilterQuery.join(" ");
              }
            }

            searchObj.data.query = "";
            const streams = searchObj.data.stream.selectedStream;

            streams.forEach((stream: string, index: number) => {
              // BY NAME merges differing columns; ALL keeps events duplicated across streams.
              if (index > 0) {
                searchObj.data.query += " UNION ALL BY NAME ";
              }
              const armWhere = textWhere ? `WHERE ${textWhere[index]}` : whereClause;
              searchObj.data.query += `SELECT [FIELD_LIST]${selectFields} FROM "${stream}" ${armWhere}`;
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
              if (streamData.schema) searchObj.data.stream.selectedStreamFields = streamData.schema;
            }

            if (searchObj.data.stream?.selectedStreamFields?.length > 0) {
              pruneInterestingFields(
                searchObj.data.stream.interestingFieldList,
                searchObj.data.stream.selectedStreamFields,
              );

              if (
                searchObj.data.stream.interestingFieldList.length > 0 &&
                searchObj.meta.quickMode
              ) {
                searchObj.data.query = searchObj.data.query.replace(
                  /\[FIELD_LIST\]/g,
                  searchObj.data.stream.interestingFieldList
                    .map((field: string) => quoteSqlIdentifierIfNeeded(field))
                    .join(","),
                );
              } else {
                searchObj.data.query = searchObj.data.query.replace(/\[FIELD_LIST\]/g, "*");
              }
            } else {
              // Schema not yet loaded — fall back to SELECT * to avoid leaving
              // the [FIELD_LIST] placeholder literal in the query
              searchObj.data.query = searchObj.data.query.replace(/\[FIELD_LIST\]/g, "*");
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
        if (searchObj.meta.showHistogram && searchResultRef.value?.reDrawChart) {
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
      autoRun.engine.onRefreshIntervalChanged(Number(searchObj.meta.refreshInterval) || 0);

      patchUrlViewState();
      refreshData();
    };

    const onAutoIntervalTrigger = () => {
      // handle event for visualization page only
      if (searchObj.meta.logsVisualizeToggle == "visualize") {
        handleRunQueryFn();
      }
    };
    const showSearchHistoryfn = () => {
      // Search History is now its own route (was an `action=history` overlay).
      // Forward the active stream type/name so the history shown there matches
      // whichever telemetry type the user was viewing (logs/traces/metrics).
      // With more than one stream selected there's no single name to forward
      // without silently dropping the others, so leave history unscoped by
      // stream in that case.
      const selectedStreams = searchObj.data.stream.selectedStream;
      router.push({
        name: "searchHistory",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          stream_type: searchObj.data.stream.streamType,
          stream: selectedStreams.length === 1 ? selectedStreams[0] : "",
        },
      });
    };

    const onSelectStream = () => {
      // < md the stream selector lives in the fields drawer, so it must open before the trigger can focus.
      if (isMobile.value) {
        mobileFieldsOpen.value = true;
        setTimeout(() => {
          document
            .querySelector<HTMLElement>('[data-test="log-search-index-list-select-stream"] button')
            ?.click();
        }, 300);
        return;
      }
      // Focus the stream selector trigger so the user can immediately pick a stream.
      const trigger = document.querySelector<HTMLElement>(
        '[data-test="log-search-index-list-select-stream"] button',
      );
      trigger?.click();
    };

    // A hero chip is a stream pick: fields load, then a guarded "stream" refinement (F4).
    const onPickStream = (stream: string) => {
      searchObj.data.stream.selectedStream = [stream];
      onStreamChange("", { origin: "selector" });
    };

    const isAiEnabled = computed(
      () => config.isEnterprise === "true" && !!store.state.zoConfig.ai_enabled,
    );

    const onWidenRange = (period: string) => {
      searchBarRef.value?.dateTimeRef?.setRelativeTime(period);
      searchObj.data.datetime.relativeTimePeriod = period;
      searchObj.data.datetime.type = "relative";
      autoRun.engine.requestRun("run");
    };

    // Microsecond bounds of the selected streams' data (union across all selected streams).
    // undefined when no stream is selected or stats are unavailable.
    const streamDocTimeRange = computed<{ min: number; max: number } | undefined>(() => {
      const selected: string[] = searchObj.data.stream.selectedStream ?? [];
      if (!selected.length) return undefined;
      const list: any[] = searchObj.data.streamResults?.list ?? [];
      let min = Infinity;
      let max = -Infinity;
      for (const s of list) {
        if (!selected.includes(s.name)) continue;
        const st = s.stats;
        if (!st) continue;
        if (st.doc_time_min > 0 && st.doc_time_min < min) min = st.doc_time_min;
        if (st.doc_time_max > 0 && st.doc_time_max > max) max = st.doc_time_max;
      }
      if (!isFinite(min) || !isFinite(max)) return undefined;
      return { min, max };
    });

    // Resolved microsecond bounds of the current query window.
    const queryWindowUs = computed<{ start: number; end: number } | undefined>(() => {
      const dt = searchObj.data.datetime;
      if (dt.type === "absolute" && dt.startTime && dt.endTime) {
        return { start: Number(dt.startTime), end: Number(dt.endTime) };
      }
      if (dt.type === "relative" && dt.relativeTimePeriod) {
        const r = getConsumableRelativeTime(dt.relativeTimePeriod);
        if (r) return { start: r.startTime, end: r.endTime };
      }
      return undefined;
    });

    const onJumpToStreamData = (fromUs: number, toUs: number) => {
      // We fire the search directly via runQuery below. setAbsoluteTime is only
      // needed to sync the picker UI, but it also mutates the picker's selectedDate/
      // selectedTime, which fires DateTime.vue's deep auto-apply watcher → on:date-change
      // → updateDateTime. In live mode that path schedules a SECOND search via a 2.5s
      // debounce. The programmatic-change flag that would normally mark that emit as
      // userChangedValue=false is defeated here because runQuery kicks off an async
      // search that flushes the flag's nextTick reset before the emit lands.
      //
      // Set shouldIgnoreWatcher so updateDateTime's auto-trigger path is skipped, fire
      // the single search, then release the flag after the picker's emit has flushed.
      searchObj.shouldIgnoreWatcher = true;
      searchBarRef.value?.dateTimeRef?.setAbsoluteTime(fromUs, toUs);
      searchObj.data.datetime.startTime = fromUs;
      searchObj.data.datetime.endTime = toUs;
      searchObj.data.datetime.type = "absolute";
      // The `runQuery` flag only drives the logs table search. Patterns are
      // extracted through handleRunQueryFn (the same path as the Run query
      // button), so a jump from the patterns empty state must route there —
      // otherwise the new window is set but patterns never re-extract.
      autoRun.engine.requestRun("run");
      nextTick(() => {
        searchObj.shouldIgnoreWatcher = false;
      });
    };

    const onRemoveFilter = () => {
      searchObj.data.query = "";
      searchBarRef.value?.updateQuery?.();
      autoRun.engine.requestRun("run");
    };

    const onAskAiFixQuery = () => {
      const sqlMode = searchObj.meta.sqlMode;
      const queryContext = sqlMode ? searchObj.data.editorValue : searchObj.data.query;
      const errorContext = searchObj.data.errorMsg
        ? (() => {
            const el = document.createElement("div");
            el.innerHTML = searchObj.data.errorMsg;
            const text = (el.textContent ?? "").trim();
            return text ? ` Error: ${text}.` : "";
          })()
        : "";
      // The prompt is model input, not screen copy — it stays English so the
      // assistant reads the same wording regardless of the user's locale.
      const modeContext = sqlMode
        ? raw(`I am using SQL mode. Full query: ${queryContext || "(none)"}.`)
        : raw(
            `I am using filter mode (not SQL). The filter expression is: ${queryContext || "(none)"}. This is a WHERE-clause filter — not a full SQL query.`,
          );
      const outcome = errorContext
        ? raw(`The query produced an error.${errorContext}`)
        : raw(`The query ran successfully but returned no results.`);
      emit(
        "sendToAiChat",
        raw(
          `${outcome} ${modeContext} Stream: ${searchObj.data.stream.selectedStream?.[0] || "unknown"}. Time range: ${searchObj.data.datetime.relativeTimePeriod || "custom"}. Can you help me adjust the filter to get results?`,
        ),
        false,
      );
    };

    const onFixQuery = () => {
      searchBarRef.value?.focusEditor?.();
    };

    const onConfigureStream = () => {
      const stream = searchObj.data.stream.selectedStream?.[0];
      if (stream) {
        router.push(`/streams?dialog=${stream}`);
      }
    };

    // Build gets the rendered WHERE, so a text search is never parsed as a column.
    const buildRunBlocked = computed(
      () =>
        searchObj.meta.logsVisualizeToggle === "build" &&
        !!(buildQueryPageRef.value as { runBlocked?: boolean } | null)?.runBlocked,
    );

    const buildWhereForBuild = computed(() => {
      if (searchObj.meta.sqlMode) return { where: "", freeText: false };
      const raw = searchObj.data.query ?? "";
      const stream = searchObj.data.stream.selectedStream?.[0];
      const ctx = buildFilterContext(searchObj, store.state.zoConfig);
      const plan = stream ? planStreamsFilter(raw.trim(), [stream], ctx) : null;
      if (!stream || plan?.kind !== "freeText") return { where: raw, freeText: false };
      const target = ctx.targets[stream];
      return {
        where: target ? (renderPlan(plan, target, ctx.knownFields) ?? "") : "",
        freeText: true,
      };
    });

    // Only routes to the stream settings; nothing is written from the logs page.
    const onConfigureFreeTextStream = (stream: string) => {
      router.push(`/streams?dialog=${stream}`);
    };

    const noFtsPanelStreams = computed(() =>
      searchObj.data.freeTextBlocked ? noFtsStreams(searchObj, store.state.zoConfig) : [],
    );

    const noFtsRecoverySchemas = computed(() =>
      noFtsRecoveryStreams(
        searchObj,
        searchObj.data.freeTextBlocked?.streams ?? searchObj.data.freeTextExcluded ?? [],
      ),
    );
    const noFtsRecoveryTerm = computed(() => {
      const plan = planStreamsFilter(
        searchObj.data.query.trim(),
        searchObj.data.stream.selectedStream,
        buildFilterContext(searchObj, store.state.zoConfig),
      );
      return plan.kind === "freeText" ? plan.units.join(" ") : searchObj.data.query;
    });
    const onNoFtsClearRun = () => runRecoveryFilter("");
    const onNoFtsFieldSearch = async (values: NoFtsFieldSubmission) => {
      const predicate = fieldSearchPredicate(values, noFtsRecoverySchemas.value);
      if (!predicate || predicate !== values.predicate) return;
      searchObj.data.stream.selectedStream = [values.stream];
      searchObj.data.query = predicate;
      searchObj.data.editorValue = predicate;
      await extractFields();
      runRecoveryFilter(predicate);
    };

    const recoveryCards = computed(() =>
      searchObj.data.errorMsg !== ""
        ? recoveryCardsFor(searchObj, store.state.zoConfig)
        : { runSuggestion: null, freeTextCandidate: null },
    );

    // Recovery text is SQL (match_all) or a quoted phrase, so later runs send it verbatim.
    const runRecoveryFilter = (text: string) => {
      searchObj.data.query = text;
      searchObj.data.editorValue = text;
      searchBarRef.value?.updateQuery?.();
      searchBarRef.value?.handleRunQueryFn?.();
    };

    const onSearchText = (text: string) => {
      runRecoveryFilter(searchTextReplacement(text, searchObj, store.state.zoConfig));
    };

    const onRunSuggestion = (suggestion: string) => {
      runRecoveryFilter(suggestion);
    };

    function removeFieldByName(data, fieldName) {
      return data.filter((item: any) => {
        if (item.expr) {
          if (
            (item.expr.type === "column_ref" &&
              (item.expr?.column?.expr?.value === fieldName ||
                (typeof item.expr.column === "string" &&
                  item.expr.column.replace(/['"`]/g, "") === fieldName))) ||
            (item.expr.type === "aggr_func" && item.expr?.args?.expr?.column?.value === fieldName)
          ) {
            return false;
          }
        }
        return true;
      });
    }

    const setInterestingFieldInSQLQuery = (field: any, isFieldExistInSQL: boolean) => {
      //implement setQuery function using node-sql-parser
      //isFieldExistInSQL is used to check if the field is already present in the query or not.
      let parsedSQL = fnParsedSQL();
      parsedSQL = processInterestingFiledInSQLQuery(parsedSQL, field, isFieldExistInSQL);

      // Modify the query based on stream name
      const newQuery = fnUnparsedSQL(parsedSQL).replace(/`/g, '"');

      if (newQuery) {
        searchObj.data.query = newQuery;
        searchObj.data.editorValue = newQuery;
        searchBarRef.value.updateQuery();
      }
    };

    const processInterestingFiledInSQLQuery = (parsedSQL, field, isFieldExistInSQL) => {
      let fieldTable = null;
      if (parsedSQL) {
        if (isFieldExistInSQL) {
          // Remove the field from the query
          if (parsedSQL.columns && parsedSQL.columns.length > 0) {
            let filteredData = removeFieldByName(parsedSQL.columns, field.name);

            const index = searchObj.data.stream.interestingFieldList.indexOf(field.name);
            if (index > -1) {
              searchObj.data.stream.interestingFieldList.splice(index, 1);
            }
            parsedSQL.columns = filteredData;
          }
        } else {
          if (searchObj.data.stream.selectedStream.length > 1) {
            if (parsedSQL && parsedSQL?.from?.length > 1) {
              fieldTable = parsedSQL.from[0].as || parsedSQL.from[0].table;
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
                      table: fieldTable,
                      column: buildColumnIdentifierAst(field.name),
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
              table: fieldTable,
              column: "*",
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
        // Guarded: pruning before the fields load would wipe the user's interesting fields.
        if (searchObj.data.stream.selectedStreamFields?.length > 0) {
          pruneInterestingFields(
            searchObj.data.stream.interestingFieldList,
            searchObj.data.stream.selectedStreamFields,
          );
        }
        if (searchObj.data.stream.interestingFieldList.length > 0) {
          field_list = searchObj.data.stream.interestingFieldList
            .map((field: string) => quoteSqlIdentifierIfNeeded(field))
            .join(",");
        }
        if (searchObj.meta.sqlMode == true) {
          searchObj.data.query = replaceSelectFieldList(searchObj.data.query, field_list);
          setQuery(searchObj.meta.quickMode);
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
        if (dashboardData.data.title == null || dashboardData.data.title.trim() == "") {
          errors.push(t("logs.index.nameOfPanelRequired"));
        }
      }

      // will push errors in errors array
      validatePanel(errors, isFieldsValidationRequired);

      if (errors.length) {
        showErrorNotification(t("logs.index.errorsFixAndTryAgain"));
        return false;
      }
      return true;
    };

    const searchResponseForVisualization = ref({});

    const shouldUseHistogramQuery = ref(false);
    const shouldRefreshWithoutCache = ref(false);
    // Store the histogram query so it persists even after searchResponse is cleared
    const storedHistogramQuery = ref("");

    watch(
      () => searchObj.data.stream.selectedStream,
      (streams: string[]) => {
        if (store.state.zoConfig?.auto_query_enabled && Array.isArray(streams) && streams.length) {
          saveLogsSelectedStreams(
            store.state.selectedOrganization.identifier,
            searchObj.data.stream.streamType,
            streams,
          );
        }
      },
      { deep: true },
    );

    watch(
      () => searchObj.data.stream.streamType,
      (streamType: string) => {
        if (store.state.zoConfig?.auto_query_enabled && streamType) {
          saveLogsStreamType(store.state.selectedOrganization.identifier, streamType);
        }
      },
    );

    // Watch for histogram query in search results and store it immediately
    // This ensures the histogram query is saved before queryResults might be reset
    watch(
      () => searchObj.data.queryResults?.converted_histogram_query,
      (newHistogramQuery) => {
        if (newHistogramQuery) {
          storedHistogramQuery.value = newHistogramQuery;
        }
      },
      { immediate: true },
    );

    // Flag to prevent unnecessary chart type changes during URL restoration
    const isRestoringFromUrl = ref(false);

    // Flag to track if this is the first time switching to visualization mode
    const isFirstVisualizationToggle = ref(true);

    // Flag to track if this is the first time switching to build mode
    // Used to restore chart type from URL only on first toggle (for shared links)
    const isFirstBuildToggle = ref(true);

    // On page load with the Timechart tab in the URL, handleBeforeMount() sets
    // the visualize toggle, which fires the toggle watcher before setupLogsTab()
    // has restored the stream and extracted fields. That early fire would build
    // a stale `select *` and show a spurious error. setupLogsTab() owns the
    // page-load restoration (it calls handleVisualizeTab() once fields are
    // ready), so the watcher skips its work exactly once on that initial fire.
    const isInitialVisualizeRestore = ref(false);

    // Chart types the logs Timechart supports restoring from a shared URL
    const validLogsChartTypes = ["area", "bar", "h-bar", "line", "scatter", "table"];

    // Shared setup for entering visualize (Timechart) mode. Used by the
    // logsVisualizeToggle watcher (manual toggle) and by setupLogsTab on
    // page load, so both entry paths behave identically.
    function prepareVisualizeMode() {
      // Enable quick mode automatically when switching to visualization if:
      // 1. SQL mode is disabled OR
      // 2. Query is "SELECT * FROM some_stream" (simple select all query)
      // 3. Default quick mode config is true
      const shouldEnableQuickMode =
        !searchObj.meta.sqlMode || isSimpleSelectAllQuery(searchObj.data.query);

      const isQuickModeDisabled = !searchObj.meta.quickMode;
      const isQuickModeConfigEnabled = store.state.zoConfig.quick_mode_enabled === true;

      if (shouldEnableQuickMode && isQuickModeDisabled && isQuickModeConfigEnabled) {
        searchObj.meta.quickMode = true;
        handleQuickModeChange();
      }

      // close field list and splitter
      dashboardPanelData.layout.splitter = 0;
      dashboardPanelData.layout.showFieldList = false;

      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery =
        true;

      // Copy VRL function query if present
      if (searchObj.data.tempFunctionContent && searchObj.data.transformType === "function") {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].vrlFunctionQuery = searchObj.data.tempFunctionContent;
      } else {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].vrlFunctionQuery = "";
      }
    }

    // Restore the chart type and panel config saved in the URL
    // (visualization_data) when the page loads directly on the Timechart tab.
    // The visualize toggle watcher normally does this, but on page load it
    // bails out before restoring because it fires ahead of URL/stream
    // restoration.
    function restoreVisualizationFromUrlOnLoad() {
      const visualizationDataParam = router.currentRoute.value.query.visualization_data;
      if (!visualizationDataParam || typeof visualizationDataParam !== "string") {
        return;
      }

      let restoredData = null;
      try {
        restoredData = decodeVisualizationConfig(visualizationDataParam);
      } catch (error) {
        console.warn("Failed to restore visualization config from URL:", error);
        return;
      }
      if (!restoredData || typeof restoredData !== "object") return;

      if (
        isFirstVisualizationToggle.value &&
        restoredData.type &&
        typeof restoredData.type === "string" &&
        validLogsChartTypes.includes(restoredData.type)
      ) {
        dashboardPanelData.data.type = restoredData.type;
      }

      if (restoredData.config && typeof restoredData.config === "object") {
        dashboardPanelData.data.config = {
          ...dashboardPanelData.data.config,
          connect_nulls: true,
          ...restoredData.config,
        };
      }

      // The URL restore counts as the first-toggle restoration.
      isFirstVisualizationToggle.value = false;
    }

    // The effective SQL that visualization runs for the current logs query.
    // In SQL mode this is the raw user query; otherwise buildSearch() resolves
    // the field list (quick mode fields, or `*` when quick mode is off).
    const getEffectiveVisualizeQuery = (): string => {
      if (searchObj.meta.sqlMode) {
        return searchObj.data.query ?? "";
      }
      return buildSearch()?.query?.sql ?? "";
    };

    // Table charts render the raw query columns, so a bare `SELECT *` is not a
    // meaningful table visualization. Histogram-based charts (line/bar/area/
    // scatter) ignore the SELECT columns and render it as a histogram, so this
    // only blocks the table chart. Quick mode yields `SELECT <fields>` (not
    // select-all), so tables render normally there.
    const isSelectStarForTable = (): boolean =>
      store.state.zoConfig.quick_mode_enabled === true &&
      isSimpleSelectAllQuery(getEffectiveVisualizeQuery());

    watch(
      () => [searchObj?.meta?.logsVisualizeToggle],
      async () => {
        try {
          // Reset buildModeQueryEditorDisabled when not in build mode
          if (searchObj.meta.logsVisualizeToggle !== "build") {
            searchObj.meta.buildModeQueryEditorDisabled = false;
          }

          // Set loading flag for build mode with SQL mode ON to prevent flicker between initialization and chart API call
          // This will be cleared when trace IDs arrive (via watcher) or when unmounting
          // When SQL mode is OFF, build page handles its own loading state
          if (searchObj.meta.logsVisualizeToggle === "build" && searchObj.meta.sqlMode) {
            // If query is empty, don't set loading flag - BuildQueryPage handles
            // empty query by using builder mode with the selected stream
            if (searchObj.data.query?.trim()) {
              variablesAndPanelsDataLoadingState.fieldsExtractionLoading = true;
            }
          }

          if (searchObj.meta.logsVisualizeToggle == "visualize") {
            // Skip the initial page-load fire (see isInitialVisualizeRestore).
            // setupLogsTab() restores the stream, extracts fields, and then runs
            // the visualization via handleVisualizeTab(). Running here too would
            // race that flow with stale/empty fields and build a spurious
            // `select *` (which shows the "not supported" error). Genuine user
            // toggles after mount have the flag unset and fall through normally.
            if (isInitialVisualizeRestore.value) {
              isInitialVisualizeRestore.value = false;
              return;
            }

            // Defensive: no stream selected yet — nothing to visualize.
            if (!searchObj.data.stream.selectedStream?.length) {
              return;
            }

            prepareVisualizeMode();

            // Store current config and chart type to preserve them during rebuild
            const queryParams = router.currentRoute.value.query;
            let preservedConfig = null;
            let shouldAutoSelectChartType = true;
            // Try to restore config from URL first, then fall back to saved state
            const visualizationDataParam = queryParams.visualization_data;
            let restoredData = null;

            if (visualizationDataParam && typeof visualizationDataParam === "string") {
              try {
                restoredData = decodeVisualizationConfig(visualizationDataParam);
              } catch (error) {
                console.warn("Failed to restore visualization config from URL:", error);
              }
            }

            // Fallback: use saved visualization config from store (preserved across navigation)
            if (!restoredData && searchObj.meta.savedVisualizationConfig) {
              restoredData = searchObj.meta.savedVisualizationConfig;
              searchObj.meta.savedVisualizationConfig = null;
            }

            if (restoredData && typeof restoredData === "object") {
              // Always restore config on every toggle
              if (restoredData.config && typeof restoredData.config === "object") {
                preservedConfig = { ...restoredData.config };
              }

              // Only check for chart type on first visualization toggle
              if (
                isFirstVisualizationToggle.value &&
                restoredData.type &&
                typeof restoredData.type === "string"
              ) {
                if (validLogsChartTypes.includes(restoredData.type)) {
                  // Valid chart type found - set it and disable auto-selection
                  dashboardPanelData.data.type = restoredData.type;
                  shouldAutoSelectChartType = false;
                }
              }
            }

            // Mark that we've processed the first toggle
            if (isFirstVisualizationToggle.value) {
              isFirstVisualizationToggle.value = false;
            }

            // Ensure stream fields are loaded before building the query.
            // On page reload, loadVisualizeData() runs async and may not have
            // finished populating interestingFieldList yet. Without fields,
            // buildSearch() produces SELECT * which is invalid for visualization.
            if (
              shouldReloadStreamFieldsForVisualize({
                selectedStream: searchObj.data.stream.selectedStream,
                selectedStreamFields: searchObj.data.stream.selectedStreamFields,
                interestingFieldList: searchObj.data.stream.interestingFieldList,
                quickMode: searchObj.meta.quickMode,
              })
            ) {
              await getStreamList();
              await extractFields();
            }

            let logsPageQuery = "";

            // Everytime, build the query inrespective of sqlMode
            const queryBuild = buildSearch();
            logsPageQuery = queryBuild?.query?.sql ?? "";

            // NOTE: `SELECT *` is intentionally allowed for histogram-based charts
            // (line/bar/area/scatter). They render histogram(_timestamp), count(*),
            // which ignores the query's SELECT columns, so `SELECT *` (produced when
            // quick mode is off or in SQL mode) is a valid input. The table chart is
            // the exception — it renders the raw query columns — and is guarded below
            // once the chart type is finalized.

            // Use conditional auto-selection based on first toggle and URL chart type
            isRestoringFromUrl.value = true;
            shouldUseHistogramQuery.value =
              await extractVisualizationFields(shouldAutoSelectChartType);

            // if not able to parse query, do not do anything
            if (shouldUseHistogramQuery.value === null) {
              return;
            }

            // Force table chart if VRL functions are present
            if (
              searchObj.data.tempFunctionContent &&
              searchObj.data.transformType === "function" &&
              shouldAutoSelectChartType
            ) {
              dashboardPanelData.data.type = "table";
              // Enable dynamic columns for VRL table charts
              dashboardPanelData.data.config.table_dynamic_columns = true;
            }

            // Clear VRL if chart type is not table (VRL only supported for table in visualization)
            if (
              dashboardPanelData.data.type !== "table" &&
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
                .vrlFunctionQuery
            ) {
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].vrlFunctionQuery = "";
            }

            // Recalculate shouldUseHistogramQuery after chart type is finalized
            // Table charts should not use histogram query
            if (dashboardPanelData.data.type === "table") {
              shouldUseHistogramQuery.value = false;
            }

            // On entry/reload, if the finalized chart type is a table with a
            // bare `SELECT *`, surface the error (the table renders raw columns).
            if (dashboardPanelData.data.type === "table" && isSelectStarForTable()) {
              showErrorNotification(t("logs.index.selectStarNotSupportedForVisualization"));
              return;
            }

            // Only reuse cached search results if the current query matches
            // the query that produced those results. When the user modifies
            // the query in Build/Patterns mode and switches to Visualize,
            // stale results would cause a blank or incorrect chart.
            const lastRunSql = searchObj.data.customDownloadQueryObj?.query?.sql;
            const currentSql = logsPageQuery;
            const normalizeSQL = (sql: any) => {
              if (!sql) return "";
              const s = Array.isArray(sql) ? sql.join(";") : String(sql);
              return s.replace(/\s+/g, " ").trim().toLowerCase();
            };
            const queryMatchesResults =
              !!lastRunSql && normalizeSQL(currentSql) === normalizeSQL(lastRunSql);

            // Only reuse cached search results when the current query
            // matches the query that produced them. When they differ (e.g.
            // query was edited in Build mode), leave searchResponseForVisualization
            // empty so the chart component makes a fresh API call.
            if (queryMatchesResults) {
              // set logs page data to searchResponseForVisualization
              if (shouldUseHistogramQuery.value === true) {
                // only do it if is_histogram_eligible is true on logs page
                // and showHistogram is true on logs page
                if (
                  searchObj?.data?.queryResults?.is_histogram_eligible === true &&
                  searchObj?.meta?.showHistogram === true
                ) {
                  // replace hits with histogram query data
                  // Override time_offset with the full query time range so that
                  // fillMissingValues uses the correct start time. The main search
                  // time_offset only covers the current page (last N rows), which
                  // would cause the chart to display partial data.
                  searchResponseForVisualization.value = {
                    ...searchObj.data.queryResults,
                    hits: searchObj.data.queryResults.aggs,
                    histogram_interval:
                      searchObj?.data?.queryResults?.visualization_histogram_interval,
                    time_offset: {
                      start_time: searchObj?.data?.customDownloadQueryObj?.query?.start_time,
                      end_time: searchObj?.data?.customDownloadQueryObj?.query?.end_time,
                    },
                  };

                  // assign converted_histogram_query to dashboardPanelData
                  if (searchObj.data.queryResults.converted_histogram_query) {
                    // Store the histogram query so it persists for "Add to Dashboard"
                    storedHistogramQuery.value =
                      searchObj.data.queryResults.converted_histogram_query;

                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].query = searchObj.data.queryResults.converted_histogram_query;

                    // assign to visualizeChartData as well
                    visualizeChartData.value.queries[0].query =
                      dashboardPanelData.data.queries[0].query;
                    visualizeChartData.value.queries[0].vrlFunctionQuery =
                      dashboardPanelData.data.queries[0].vrlFunctionQuery;
                  }
                }
              } else if (
                searchObj.data.queryResults?.hits?.length > 0 ||
                searchObj.data.queryResults?.filteredHit?.length > 0
              ) {
                searchResponseForVisualization.value = {
                  ...searchObj.data.queryResults,
                  histogram_interval:
                    searchObj?.data?.queryResults?.visualization_histogram_interval,
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
            }

            // reset old rendered chart
            visualizeChartData.value = {};

            // Use customDownloadQueryObj time only when reusing cached results
            // (the time must match the data). Otherwise use the user's current
            // datetime selection — e.g. when navigating back to the page the
            // user may have selected a different time range on the visualize tab
            // than the last logs query used.
            const hasReusableData = searchResponseForVisualization.value?.hits?.length > 0;

            if (
              hasReusableData &&
              searchObj?.data?.customDownloadQueryObj?.query?.start_time &&
              searchObj?.data?.customDownloadQueryObj?.query?.end_time
            ) {
              dashboardPanelData.meta.dateTime = {
                start_time: new Date(searchObj.data.customDownloadQueryObj.query.start_time),
                end_time: new Date(searchObj.data.customDownloadQueryObj.query.end_time),
              };
            } else {
              // set date time
              const dateTime =
                searchObj.data.datetime.type === "relative"
                  ? getConsumableRelativeTime(searchObj.data.datetime.relativeTimePeriod)
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

            // Enable dynamic columns for VRL table charts (after preservedConfig to ensure it's set)
            if (
              searchObj.data.tempFunctionContent &&
              searchObj.data.transformType === "function" &&
              dashboardPanelData.data.type === "table"
            ) {
              dashboardPanelData.data.config.table_dynamic_columns = true;
            }

            // run query
            await copyDashboardDataToVisualize();

            // Clear the restoration flag after all operations are complete
            await nextTick();
            isRestoringFromUrl.value = false;

            // Only clear fieldsExtractionLoading if we have data to reuse (no API call needed)
            // If searchResponseForVisualization has hits, data will be reused and no API call
            // If empty, API call will happen and trace IDs watcher will clear the flag
            const hasDataToReuse = searchResponseForVisualization.value?.hits?.length > 0;
            if (hasDataToReuse) {
              variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
            }

            // emit resize event
            // this will rerender/call resize method of already rendered chart to resize
            window.dispatchEvent(new Event("resize"));

            // Sync visualization data to URL parameters when chart type changes
            if (searchObj.meta.logsVisualizeToggle === "visualize") {
              patchUrlViewState(dashboardPanelData);
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
          showErrorNotification(err.message ?? t("logs.index.errorUpdatingVisualization"));
          return;
        }
      },
    );

    // Create debounced function for visualization updates
    const updateVisualization = async (autoSelectChartType: boolean = true) => {
      if (searchObj?.meta?.logsVisualizeToggle == "visualize") {
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery =
          true;

        // Update VRL function query if present
        // VRL is only supported for table chart type in visualization
        if (
          searchObj.data.tempFunctionContent &&
          searchObj.data.transformType === "function" &&
          dashboardPanelData.data.type === "table"
        ) {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].vrlFunctionQuery = searchObj.data.tempFunctionContent;
        } else {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].vrlFunctionQuery = "";
        }

        // reset old rendered chart
        visualizeChartData.value = {};

        shouldUseHistogramQuery.value = await extractVisualizationFields(autoSelectChartType);

        // if not able to parse query, do not do anything
        if (shouldUseHistogramQuery.value === null) {
          return false;
        }

        // Enable dynamic columns for VRL table charts
        if (
          searchObj.data.tempFunctionContent &&
          searchObj.data.transformType === "function" &&
          dashboardPanelData.data.type === "table"
        ) {
          dashboardPanelData.data.config.table_dynamic_columns = true;
        }

        // emit resize event
        // this will rerender/call resize method of already rendered chart to resize
        window.dispatchEvent(new Event("resize"));

        return true;
      }
    };

    watch(
      () => dashboardPanelData.data.type,
      async (newType, oldType) => {
        // Skip processing if we're currently restoring from URL
        if (isRestoringFromUrl.value) {
          return;
        }

        // A table chart renders the raw query columns, so a bare `SELECT *`
        // (quick mode off / SQL mode) is not a meaningful table visualization.
        // Histogram-based charts ignore the SELECT columns, so this only blocks
        // the table chart. Surface the error and revert to the previous chart
        // type so the raw-`SELECT *` data is never shown.
        if (newType === "table" && isSelectStarForTable()) {
          showErrorNotification(t("logs.index.selectStarNotSupportedForVisualization"));
          if (oldType && oldType !== "table") {
            dashboardPanelData.data.type = oldType;
          }
          return;
        }

        const currentQuery =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].query;

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
          patchUrlViewState(dashboardPanelData);
        }
      },
    );

    // Watch for build page chart type changes to sync URL params
    watch(
      () => buildDashboardPanelData.data.type,
      () => {
        // Sync build data to URL parameters when chart type changes
        if (searchObj.meta.logsVisualizeToggle === "build") {
          patchUrlViewState(null, buildDashboardPanelData);
        }
      },
    );

    // Watch for build page config changes to sync URL params
    watch(
      () => buildDashboardPanelData.data.config,
      () => {
        if (searchObj.meta.logsVisualizeToggle === "build") {
          patchUrlViewState(null, buildDashboardPanelData);
        }
      },
      { deep: true },
    );

    // Watch for SQL mode changes while in build mode.
    // When SQL mode is toggled, re-sync the search bar query:
    //   ON  → show the builder's full generated SQL
    //   OFF → show only the WHERE clause (filter text)
    watch(
      () => searchObj.meta.sqlMode,
      async () => {
        if (searchObj.meta.logsVisualizeToggle !== "build") return;

        const generatedQuery = buildDashboardPanelData.data.queries?.[0]?.query || "";
        await onBuildQueryGenerated(generatedQuery);
      },
    );

    watch(
      () => splitterModel.value,
      () => {
        // rerender chart
        window.dispatchEvent(new Event("resize"));
      },
    );

    // Auto-expand the splitter when either editor has >2 lines; never overrides a larger user-set value.
    watch(
      [() => searchObj.data.editorValue, () => searchObj.data.tempFunctionContent, isMobile],
      ([queryValue, fnValue, mobile]) => {
        const queryLines = (queryValue || "").split("\n").length;
        const fnLines = (fnValue || "").split("\n").length;
        const hasMoreThanTwoLines = queryLines > 2 || fnLines > 2;
        const baseHeight = mobile ? 165 : 83;
        const expandedHeight = mobile ? 205 : 130;

        if (hasMoreThanTwoLines && splitterModel.value < expandedHeight) {
          splitterModel.value = expandedHeight;
        } else if (!hasMoreThanTwoLines && splitterModel.value <= expandedHeight) {
          splitterModel.value = baseHeight;
        }
      },
      { immediate: true },
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

    // Sync searchObj.data.query to build page's dashboardPanelData when in custom query mode
    // This ensures edited queries are reflected in the panel schema immediately
    watch(
      () => searchObj.data.query,
      (newQuery) => {
        if (
          searchObj.meta.logsVisualizeToggle === "build" &&
          buildDashboardPanelData.data.queries[0]?.customQuery === true
        ) {
          buildDashboardPanelData.data.queries[
            buildDashboardPanelData.layout.currentQueryIndex
          ].query = newQuery;
        }
      },
    );

    watch(
      () => [
        searchObj.data.datetime.type,
        searchObj.data.datetime,
        searchObj.data.datetime.relativeTimePeriod,
      ],
      async () => {},
      { deep: true },
    );

    // Live mode: when auto_query_enabled is true in zoConfig, always sync from
    // localStorage so the module-level singleton reflects the user's preference
    // even after navigating between pages. Defaults to true when no preference
    // has been saved yet. zoConfig may not be populated yet at mount time;
    // watch for it to arrive.
    watch(
      () => store.state.zoConfig?.auto_query_enabled,
      (enabled) => {
        if (enabled) {
          const saved = localStorage.getItem("oo_toggle_auto_run");
          searchObj.meta.liveMode = saved === null ? true : saved === "true";
        }
      },
      { immediate: true },
    );

    // Watch AI chat state and adjust splitter to give more space when chat is open
    const originalSplitterValue = ref(searchObj.config.splitterModel);
    watch(
      () => store.state.isAiChatEnabled,
      (isEnabled) => {
        // Only adjust splitter if field list is shown
        if (searchObj.meta.showFields) {
          if (isEnabled) {
            // AI chat opened - save current value and set splitter to 25
            originalSplitterValue.value = searchObj.config.splitterModel;
            searchObj.config.splitterModel = 25;
          } else {
            // AI chat closed - restore original splitter value
            searchObj.config.splitterModel = originalSplitterValue.value;
          }
        }
      },
    );

    // Run for Visualize, Patterns and Build: explicit, so it always opens a generation and never waits on the guard.
    const handleRunQueryFn = async (clear_cache = false) => {
      const mode = searchObj.meta.logsVisualizeToggle;
      if (mode !== "visualize" && mode !== "patterns" && mode !== "build") return;
      searchObj.meta.clearCache = clear_cache;
      autoRun.engine.requestRun("run");
    };

    // G1 for Visualize and Build: the proof is the panel's own completed run (J7).
    const executePanelRun = async (ctx: RunContext) => {
      autoRun.beginPanelRun(ctx.generation.id, () =>
        searchBarRef.value?.cancelVisualizeQueries?.(),
      );
      const launched = await runPanelQuery(!!searchObj.meta.clearCache, ctx.generation.id);
      if (!launched && autoRun.hasPanelRun(ctx.generation.id)) autoRun.endPanelRun(false);
    };

    // Returns false when validation stopped the run before any panel request was made.
    const runPanelQuery = async (clear_cache = false, generationId?: number): Promise<boolean> => {
      if (searchObj.meta.logsVisualizeToggle == "visualize") {
        // Set the shouldRefreshWithoutCache flag
        shouldRefreshWithoutCache.value = clear_cache;
        // wait to extract fields if its ongoing; if promise rejects due to abort just return silently
        try {
          // Ensure stream fields are loaded before building the query.
          // On page reload, loadVisualizeData() runs async and may not have
          // finished populating interestingFieldList yet. Without fields,
          // buildSearch() produces SELECT * which is invalid for visualization.
          if (
            shouldReloadStreamFieldsForVisualize({
              selectedStream: searchObj.data.stream.selectedStream,
              selectedStreamFields: searchObj.data.stream.selectedStreamFields,
              interestingFieldList: searchObj.data.stream.interestingFieldList,
              quickMode: searchObj.meta.quickMode,
            })
          ) {
            await getStreamList();
            await extractFields();
          }

          // Build the query for its side effect (prunes interestingFieldList to
          // fields present in the stream). Histogram-based charts ignore the
          // SELECT columns (updateVisualization builds their histogram query),
          // so `SELECT *` is fine for them. The table chart renders the raw query
          // columns, so a bare `SELECT *` there is not a meaningful visualization.
          buildSearch();
          if (dashboardPanelData.data.type === "table" && isSelectStarForTable()) {
            showErrorNotification(t("logs.index.selectStarNotSupportedForVisualization"));
            return false;
          }

          const success = await updateVisualization(false);
          if (!success) {
            return false;
          }
        } catch (err: any) {
          // this will clear dummy trace id
          cancelFieldExtraction();

          // Extraction was cancelled, so do not proceed further
          // if its abort, then do not show any error notification
          if (err.name === "AbortError") {
            return false;
          }

          // show error notification
          showErrorNotification(err.message ?? t("logs.index.errorUpdatingVisualization"));
          return false;
        }

        const currentQuery =
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].query;

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
            ? getConsumableRelativeTime(searchObj.data.datetime.relativeTimePeriod)
            : cloneDeep(searchObj.data.datetime);

        dashboardPanelData.meta.dateTime = {
          start_time: new Date(dateTime.startTime),
          end_time: new Date(dateTime.endTime),
        };

        await copyDashboardDataToVisualize();
        // The chart renders this copy, so it is the config the panel run certifies.
        if (generationId != null) autoRun.markPanelDispatched(generationId);

        // Sync visualization config to URL parameters
        patchUrlViewState(dashboardPanelData);
        return true;
      }

      if (searchObj.meta.logsVisualizeToggle == "build") {
        if (buildRunBlocked.value) return false;
        // Validate query before running - only block if in custom query mode with empty query.
        // In builder mode (non-custom), BuildQueryPage generates the query automatically.
        const isCustomQueryMode = buildDashboardPanelData.data.queries[0]?.customQuery === true;
        if (
          isCustomQueryMode &&
          !searchObj.data.query?.trim() &&
          !buildDashboardPanelData.data.queries[0]?.query?.trim()
        ) {
          showErrorNotification(t("logs.index.queryEmptySelectFieldsToBuild"));
          return false;
        }

        // Run query in build mode - same approach as visualization
        const dateTime =
          searchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(searchObj.data.datetime.relativeTimePeriod)
            : cloneDeep(searchObj.data.datetime);

        // Set datetime in build page's dashboardPanelData (same as visualization)
        if (buildQueryPageRef.value?.dashboardPanelData) {
          buildQueryPageRef.value.dashboardPanelData.meta.dateTime = {
            start_time: new Date(dateTime.startTime),
            end_time: new Date(dateTime.endTime),
          };
        }

        // Trigger PanelEditor's runQuery
        const launched = await buildQueryPageRef.value?.runQuery(clear_cache, generationId);
        if (!launched) return false;

        // Sync build config to URL parameters
        patchUrlViewState(null, buildQueryPageRef.value?.dashboardPanelData);
        return true;
      }
      return false;
    };

    const handleChartApiError = (errorMessage: any) => {
      autoRun.markPanelFailed();
      const errorList = visualizeErrorData.errors;
      errorList.splice(0);
      errorList.push(errorMessage);
    };

    // Build Query Page handlers
    const onBuildApply = (query: string) => {
      // Apply the generated query from build page
      searchObj.data.query = query;
      searchObj.meta.logsVisualizeToggle = "logs";
      handleRunQueryFn();
    };

    const onBuildCancel = () => {
      // Cancel and return to logs view
      searchObj.meta.logsVisualizeToggle = "logs";
    };

    const onBuildQueryGenerated = async (query: string) => {
      if (searchObj.meta.sqlMode) {
        // SQL mode ON: sync the full generated SQL to the search bar
        searchObj.data.query = query;
        searchObj.data.editorValue = query;
      } else {
        // SQL mode OFF: extract only the WHERE clause and sync that
        // so the search bar stays in filter mode
        const whereClause = await extractWhereClause(query);
        searchObj.data.query = whereClause;
        searchObj.data.editorValue = whereClause;
      }
    };

    const onCustomQueryModeChanged = (isCustomMode: boolean) => {
      // Disable query editor in build mode when customQuery is false (builder mode)
      // In builder mode, query is auto-generated from fields - user shouldn't edit directly
      searchObj.meta.buildModeQueryEditorDisabled = !isCustomMode;
    };

    // Handle build mode toggle from SearchBar (updates panel schema's customQuery)
    const onBuildModeToggle = async (isCustomMode: boolean) => {
      // Update the panel schema's customQuery flag
      if (buildDashboardPanelData.data.queries[0]) {
        buildDashboardPanelData.data.queries[0].customQuery = isCustomMode;

        // Builder → Custom: show the generated SQL in the editor for editing
        if (isCustomMode) {
          const generatedQuery = buildDashboardPanelData.data.queries[0]?.query || "";
          if (searchObj.meta.sqlMode) {
            searchObj.data.query = generatedQuery;
            searchObj.data.editorValue = generatedQuery;
          } else {
            // SQL mode OFF: sync only the WHERE clause
            const whereClause = await extractWhereClause(generatedQuery);
            searchObj.data.query = whereClause;
            searchObj.data.editorValue = whereClause;
          }
          return;
        }

        // Custom → Builder: clear fields and query
        await nextTick();
        buildRemoveXYFilters();
        buildUpdateXYFieldsForCustomQueryMode();

        buildDashboardPanelData.data.queries[
          buildDashboardPanelData.layout.currentQueryIndex
        ].query = "";
        if (searchObj.meta.sqlMode) {
          searchObj.data.query = "";
          searchObj.data.editorValue = "";
        }
      }
    };

    const onBuildInitialized = () => {
      // Mark that we've processed the first build toggle
      // After this, chart type will always be auto-selected on tab switch
      if (isFirstBuildToggle.value) {
        isFirstBuildToggle.value = false;
      }

      // Clear fields extraction loading flag since build page has finished initialization
      // This prevents the cancel button from staying visible when no query is actually running
      variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
    };

    // Selected date time for BuildQueryPage
    const selectedDateTime = computed(() => {
      const dateTime =
        searchObj.data.datetime.type === "relative"
          ? getConsumableRelativeTime(searchObj.data.datetime.relativeTimePeriod)
          : cloneDeep(searchObj.data.datetime);

      return {
        start_time: new Date(dateTime.startTime),
        end_time: new Date(dateTime.endTime),
        valueType: searchObj.data.datetime.type,
        relativeTimePeriod: searchObj.data.datetime.relativeTimePeriod,
      };
    });

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

    const detectHistogramBreakdownField = (): string | null => {
      const selectedStreamFields = (searchObj.data.stream?.selectedStreamFields ?? []) as Array<{
        name?: string | null;
      }>;
      const fieldNameMap = new Map<string, string>();

      selectedStreamFields.forEach((field) => {
        const fieldName = field.name?.toLowerCase();
        if (fieldName && !fieldNameMap.has(fieldName)) {
          fieldNameMap.set(fieldName, field.name ?? fieldName);
        }
      });

      // Keep this order aligned with backend histogram breakdown detection in
      // `src/service/search/sql/histogram.rs`.
      const prioritizedFields = ["severity", "log_level", "level", "status"];
      for (const fieldName of prioritizedFields) {
        if (fieldNameMap.has(fieldName)) {
          return fieldNameMap.get(fieldName) ?? null;
        }
      }

      return null;
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
      visualizeChartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
    };

    const extractVisualizationFields = async (autoSelectChartType: boolean = true) => {
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
        if (logsPageQuery === "" && searchObj?.data?.stream?.selectedStream?.length === 0) {
          showErrorNotification(t("search.queryEmptyToVisualize"));
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        // Blocked text shows the no-FTS panel in the Visualize pane instead of a toast.
        if (logsPageQuery === "" && searchObj.data.freeTextBlocked) {
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        // check if query is empty
        if (logsPageQuery === "") {
          showErrorNotification(t("search.queryEmptyToVisualize"));
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        // if multiple sql, then do not allow to visualize
        if (logsPageQuery && Array.isArray(logsPageQuery) && logsPageQuery.length > 1) {
          showErrorNotification(t("search.multipleSqlNotAllowed"));
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
          startISOTimestamp = new Date(timestamps.start_time.toISOString()).getTime();
          endISOTimestamp = new Date(timestamps.end_time.toISOString()).getTime();
        }

        checkAbort();

        // Handle schema caching in Index.vue
        let extractedFields;

        // Check if we have a cached response for this query
        if (schemaCache?.value && schemaCache?.value?.key === logsPageQuery) {
          extractedFields = schemaCache?.value?.response?.data;
        } else {
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
        /* Note: VRL functions are only supported for table charts, and VRL will force table chart type */
        /* So if VRL is present and autoSelectChartType is true, we know chart will be table */
        const willBeTableChart =
          dashboardPanelData.data.type === "table" ||
          (autoSelectChartType &&
            searchObj.data.tempFunctionContent &&
            searchObj.data.transformType === "function");

        shouldUseHistogramQuery.value =
          !willBeTableChart && !(extractedFields?.group_by && extractedFields.group_by.length);

        const finalQuery = logsPageQuery;

        if (!finalQuery) {
          showErrorNotification(t("search.queryEmptyToVisualize"));
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].query =
          finalQuery;

        const allFieldsHaveAlias = allSelectionFieldsHaveAlias(finalQuery);
        if (!allFieldsHaveAlias) {
          showAliasErrorForVisualization(t("search.aggregationFieldsNeedAlias"));
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
          return null;
        }

        /* Populate fields & axes */
        // For histogram queries, we need to modify the extractedFields to match the actual query structure
        let fieldsForVisualization = extractedFields;
        const histogramBreakdownField = shouldUseHistogramQuery.value
          ? detectHistogramBreakdownField()
          : null;
        let shouldAutoSelectChartTypeForFields = autoSelectChartType;
        if (shouldUseHistogramQuery.value) {
          // For histogram query, override the extracted fields to match the histogram structure
          fieldsForVisualization = {
            group_by: histogramBreakdownField ? ["zo_sql_key", "zo_sql_breakdown"] : ["zo_sql_key"], // histogram field is grouped by zo_sql_key
            projections: histogramBreakdownField
              ? ["zo_sql_key", "zo_sql_breakdown", "zo_sql_num"]
              : ["zo_sql_key", "zo_sql_num"], // histogram returns zo_sql_key and zo_sql_num
            timeseries_field: "zo_sql_key", // zo_sql_key is the time field in histogram
          };
        }

        await setCustomQueryFields(
          fieldsForVisualization,
          shouldAutoSelectChartTypeForFields,
          signal,
        );

        await copyDashboardDataToVisualize();

        // Don't clear fieldsExtractionLoading here - let the watcher handle it.
        // The watcher will clear it when:
        // 1. Trace IDs appear (API call started) - existing watcher at line ~2630
        // 2. Chart data is set AND no trace IDs (data reused) - new watcher below

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
    provide("variablesAndPanelsDataLoadingState", variablesAndPanelsDataLoadingState);

    const panelsLoading = computed(() =>
      Object.values(variablesAndPanelsDataLoadingState.panels ?? {}).some(Boolean),
    );
    watch(panelsLoading, (loading) => {
      const surfaceErrors =
        searchObj.meta.logsVisualizeToggle === "build"
          ? (buildQueryPageRef.value?.panelEditorRef?.errorData?.errors ?? [])
          : (visualizeErrorData.errors ?? []);
      autoRun.panelLoadingChanged(loading, surfaceErrors.length > 0);
    });

    autoRun.setPanelConfigReader((surface) => {
      const data = surface === "build" ? buildDashboardPanelData.data : dashboardPanelData.data;
      return {
        type: data?.type,
        config: data?.config,
        queries: (data?.queries ?? []).map((query: any) => ({
          query: query?.query,
          customQuery: query?.customQuery,
          fields: query?.fields,
          vrlFunctionQuery: query?.vrlFunctionQuery,
        })),
      };
    });

    // ---------------------------------------------------------------------
    // WATCHERS
    // ---------------------------------------------------------------------

    // Reset the `fieldsExtractionLoading` flag the moment the first search
    // request (for data retrieval) is issued. This is detected via the
    // presence of at least one trace-id recorded in
    // `variablesAndPanelsDataLoadingState.searchRequestTraceIds`.
    watch(
      () =>
        Object.values(variablesAndPanelsDataLoadingState?.searchRequestTraceIds ?? {})?.flat()
          ?.length,
      (totalActiveTraceIds) => {
        if (totalActiveTraceIds > 0) {
          variablesAndPanelsDataLoadingState.fieldsExtractionLoading = false;
        }
      },
    );

    // [END] cancel running queries

    // [START] O2 AI Context Handler

    const registerAiContextHandler = () => {
      registerAiChatHandler(getContext);
    };

    const getContext = async () => {
      try {
        const isLogsPage = router.currentRoute.value.name === "logs";

        // Drill down reads the logs search, so it gives the logs context.
        const isLogsResultsMode =
          searchObj.meta.logsVisualizeToggle === "logs" ||
          searchObj.meta.logsVisualizeToggle === "drilldown";

        const isStreamSelectedInLogsPage =
          isLogsResultsMode && searchObj.data.stream.selectedStream.length;

        const isStreamSelectedInDashboardPage =
          searchObj.meta.logsVisualizeToggle === "visualize" &&
          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
            .stream;

        if (!isLogsPage || !(isStreamSelectedInLogsPage || isStreamSelectedInDashboardPage)) {
          return "";
        }

        const payload = {};

        const streams = isLogsResultsMode
          ? searchObj.data.stream.selectedStream
          : [
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
                .stream,
            ];

        const streamType = isLogsResultsMode
          ? searchObj.data.stream.streamType
          : dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              .stream_type;

        if (!streamType || !streams?.length) {
          return "";
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

        return payload;
      } catch (error) {
        console.error("Error in getContext for logs page", error);
        return "";
      }
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
      const provider = createLogsContextProvider(searchObj, store, dashboardPanelData);

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

    const sendToAiChat = (value: any, append: boolean = true) => {
      emit("sendToAiChat", value, append);
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

    autoRun.setExecutors({
      logs: executeGridRun,
      patterns: executePatternsRun,
      histogram: executeHistogramRun,
      visualize: executePanelRun,
    });

    const isAutoRunOn = computed(() => isAutoRunActive(store.state.zoConfig ?? {}, searchObj.meta));
    const isResultsStale = computed(() => autoRun.engine.isResultsStale());
    const gridRunCancelled = computed(
      () =>
        searchObj.meta.logsVisualizeToggle === "logs" &&
        searchObj.meta.runCancelled?.logs === true &&
        !searchObj.loading,
    );
    const showSearchCancelledState = computed(
      () => gridRunCancelled.value && !searchObj.data.queryResults?.hits?.length,
    );
    const showSearchCancelledNotice = computed(
      () => gridRunCancelled.value && !!searchObj.data.queryResults?.hits?.length,
    );
    const guardBlocksGrid = computed(
      () => !!searchObj.meta.autoRunBlocked && searchObj.meta.autoRunBlocked.op !== "visualize",
    );
    const showGuardEmptyState = computed(() => {
      if (!guardBlocksGrid.value || searchObj.loading) return false;
      if (searchObj.meta.logsVisualizeToggle === "patterns") {
        return !patternsState.value?.patterns?.patterns?.length;
      }
      return (
        searchObj.meta.logsVisualizeToggle === "logs" && !searchObj.data.queryResults?.hits?.length
      );
    });
    const showGuardBanner = computed(() => guardBlocksGrid.value && !showGuardEmptyState.value);
    const showGuardSearchJob = computed(() => config.isEnterprise === "true");

    // A paused interval resumes once nothing pauses it any more (P3 "missedTick").
    watch(
      () => [isResultsStale.value, !!searchObj.meta.autoRunBlocked],
      () => autoRun.engine.checkRefreshResume(),
    );

    // A refinement that moves the scope away from a blocked snapshot withdraws "Run anyway" (AC5.1).
    watch(
      () => autoRun.readSignature(),
      () => autoRun.engine.syncBlockedScope(),
      { deep: true },
    );

    // Run anyway on the initial-load generation keeps the shared line open (CROSS-SPEC row 10).
    const onGuardRunAnyway = () => {
      autoRun.engine.runAnyway({ origin: initOriginForRun(currentInitOrigin()) });
    };

    /** Initial load only: reads `page` and `log_*` before restore (4c C5 step 2, C7). */
    const startSharedLinkSession = (query: Record<string, any>) => {
      clearColumnsFromUrl();
      resetShownSearch();
      const refreshOff = !(Number(query.refresh) > 0);
      const page = refreshOff ? parseSharedPage(query.page) : null;
      sharedPage.value = page !== null && page > 1 ? page : null;
      sharedPageNotice.value = null;
      beginPermalinkFromUrl(query, store.state.selectedOrganization.identifier);
    };

    /** Leaving Logs or switching org: no shared line, page notice, link columns or shown run survive. */
    const endSharedLinkSession = () => {
      resetPermalinkState();
      clearColumnsFromUrl();
      resetShownSearch();
      sharedPage.value = null;
      sharedPageNotice.value = null;
    };

    const permalinkResolveContext = (): ResolveContext => {
      const superCluster = !!store.state.zoConfig?.super_cluster_enabled;
      return {
        regions: superCluster ? [...(searchObj.meta.regions ?? [])] : [],
        clusters: superCluster ? [...(searchObj.meta.clusters ?? [])] : [],
        multiStream: searchObj.data.stream.selectedStream.length > 1,
        allFieldsName: store.state.zoConfig?.all_fields_name,
        retentionDays: (stream: string) => {
          const entry = (searchObj.data.streamResults?.list ?? []).find(
            (item: any) => item?.name === stream,
          );
          const days = Number(entry?.settings?.data_retention ?? 0);
          return days > 0 ? days : null;
        },
      };
    };

    const onPermalinkRetry = () => {
      void retryPermalinkResolve(permalinkResolveContext());
    };

    // "Show these lines" is a user scope change that ends the permalink; SearchBar keeps the 1 µs window through the picker echo.
    const onPermalinkShowLines = (ts: number) => {
      onJumpToStreamData(ts, ts + 1);
    };

    const { searchAroundData } = useSearchAround();

    const runSearchAround = (params: {
      key: unknown;
      size: number;
      body: Record<string, unknown>;
    }) => {
      clearPermalink();
      searchObj.meta.showDetailTab = false;
      resetRowSelection(searchObj);
      searchObj.data.searchAround.indexTimestamp = params.key;
      searchAroundData(params as any);
    };

    const onPermalinkShowInContext = () => {
      const record = sharedLineRecord.value;
      const ts = activePermalink.value?.link.ts;
      if (!record || ts === undefined) return;
      runSearchAround({ key: ts, size: 10, body: { ...record } });
    };

    const onPermalinkAddSearchTerm = (
      field: string | number,
      value: string | number | boolean,
      action: string,
    ) => {
      searchObj.data.stream.addToFilterMode = "append";
      searchObj.data.stream.addToFilter = getFilterExpressionByFieldType(field, value, action);
    };

    const onSharedPageGo = (page: number) => {
      sharedPageNotice.value = null;
      searchResultRef.value?.changePage?.(page);
    };

    useLogsUrlSync({
      panelData: (surface) =>
        surface === "visualize"
          ? dashboardPanelData
          : (buildQueryPageRef.value?.dashboardPanelData ?? buildDashboardPanelData),
    });

    // Narrow to sets only the date, then runs once after re-checking the guard (J5).
    const onGuardNarrow = (period: string) => {
      searchObj.shouldIgnoreWatcher = true;
      searchBarRef.value?.dateTimeRef?.setRelativeTime(period);
      searchObj.data.datetime.relativeTimePeriod = period;
      searchObj.data.datetime.type = "relative";
      autoRun.engine.requestRun("narrow");
      nextTick(() => {
        searchObj.shouldIgnoreWatcher = false;
      });
    };

    // G1-X1: the job runs the frozen blocked scope, so it bypasses canPersistOrShare.
    const onGuardSearchJob = () => {
      const snapshot = buildSearch(true);
      if (!snapshot) return;
      searchBarRef.value?.openGuardSearchJob?.(cloneDeep(snapshot));
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "logsRunQuery",
        handler: () => {
          // Explicit in every mode: it supersedes an in-flight run instead of waiting (P2).
          searchBarRef.value?.handleRunQueryFn?.();
        },
      },
      {
        id: "logsSearchHistory",
        handler: () => showSearchHistoryfn(),
      },
      {
        id: "logsFocusQuery",
        handler: () => {
          // The logs query editor is Monaco — focus its inner textarea.
          const el = document.querySelector<HTMLElement>(
            '[data-test="logs-search-bar-query-editor"] textarea, [data-test="logs-search-bar"] .monaco-editor textarea',
          );
          el?.focus();
        },
      },
      {
        id: "logsRefresh",
        handler: () => {
          if (isInputFocused()) return;
          searchBarRef.value?.handleRunQueryFn?.();
        },
      },
      {
        id: "logsToggleHistogram",
        handler: () => {
          if (isInputFocused()) return;
          searchObj.meta.showHistogram = !searchObj.meta.showHistogram;
        },
      },
      {
        id: "logsToggleSidebar",
        handler: () => {
          searchObj.meta.showFields = !searchObj.meta.showFields;
        },
      },
      {
        id: "logsSaveView",
        handler: () => {
          if (isInputFocused()) return;
          // fnSavedView applies the same G1 save gate as the buttons (2-U-2).
          (searchBarRef.value as any)?.fnSavedView?.();
        },
      },
      {
        id: "logsNextRow",
        handler: (e?: KeyboardEvent) =>
          (searchResultRef.value as any)?.stepLogRow?.(1, !!e?.repeat),
      },
      {
        id: "logsPrevRow",
        handler: (e?: KeyboardEvent) =>
          (searchResultRef.value as any)?.stepLogRow?.(-1, !!e?.repeat),
      },
      {
        id: "logsExport",
        handler: () => {
          if (autoRun.engine.isResultsStale()) return;
          (searchBarRef.value as any)?.downloadLogs?.(
            searchObj.data?.queryResults?.hits ?? [],
            "csv",
          );
        },
      },
    ]);

    return {
      autoRun,
      rowNavAnnouncement: logsRowNavAnnouncement,
      isAutoRunOn,
      isResultsStale,
      showSearchCancelledState,
      showSearchCancelledNotice,
      showGuardEmptyState,
      showGuardBanner,
      showGuardSearchJob,
      onGuardRunAnyway,
      onGuardNarrow,
      onGuardSearchJob,
      onConfigureFreeTextStream,
      noFtsPanelStreams,
      noFtsRecoverySchemas,
      noFtsRecoveryTerm,
      onNoFtsClearRun,
      onNoFtsFieldSearch,
      recoveryCards,
      onSearchText,
      onRunSuggestion,
      buildWhereForBuild,
      buildRunBlocked,
      t,
      store,
      router,
      searchObj,
      searchBarRef,
      splitterModel,
      isMobile,
      mobileFieldsOpen,
      // loadPageData,
      getQueryData,
      getJobData,
      searchResultRef,
      drillDownTimeRange,
      drillDownRateFilter,
      drillDownBaseFilter,
      handleActivation,
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
      patchUrlViewState,
      onPermalinkRetry,
      onPermalinkShowLines,
      onPermalinkShowInContext,
      onPermalinkAddSearchTerm,
      runSearchAround,
      onSharedPageGo,
      refreshHistogramChart,
      onChangeInterval,
      onAutoIntervalTrigger,
      showSearchHistoryfn,
      isAiEnabled,
      onSelectStream,
      onPickStream,
      onWidenRange,
      onRemoveFilter,
      onAskAiFixQuery,
      streamDocTimeRange,
      queryWindowUs,
      onJumpToStreamData,
      onFixQuery,
      onConfigureStream,
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
      resetHistogramWithError,
      fnParsedSQL,
      isLimitQuery,
      buildWebSocketPayload,
      initializeSearchConnection,
      addTraceId,
      isWebSocketEnabled,
      showJobScheduler,
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
      storedHistogramQuery,
      clearSchemaCache,
      getHistogramData,
      extractPatternsForCurrentQuery,
      patternsState,
      buildQueryPageRef,
      buildDashboardPanelData,
      onBuildApply,
      onBuildCancel,
      onBuildQueryGenerated,
      onCustomQueryModeChanged,
      onBuildModeToggle,
      onBuildInitialized,
      selectedDateTime,
      isFirstBuildToggle,
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
        Object.prototype.hasOwnProperty.call(this.searchObj.data.histogram, "xData") &&
        this.searchObj.data.histogram.xData.length
      );
    },
  },
  watch: {
    showFields() {
      if (this.searchObj.meta.showHistogram == true && this.searchObj.meta.sqlMode == false) {
        // Clear any existing timeout
        if (this.chartRedrawTimeout) {
          clearTimeout(this.chartRedrawTimeout);
        }
        this.chartRedrawTimeout = setTimeout(() => {
          if (this.searchResultRef) this.searchResultRef.reDrawChart();
        }, 100);
      }
      if (this.searchObj.config.splitterModel > 0) {
        this.searchObj.config.lastSplitterPosition = this.searchObj.config.splitterModel;
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

      if (this.searchObj.meta?.showHistogram && !this.searchObj?.shouldIgnoreWatcher) {
        this.searchObj.data.queryResults.aggs = [];

        if (this.searchObj.meta.sqlMode && this.isLimitQuery(parsedSQL)) {
          this.resetHistogramWithError(this.t("search.histogramUnavailableForQueries"), -1);
          this.searchObj.meta.histogramDirtyFlag = false;
        } else if (
          this.searchObj.meta.sqlMode &&
          (this.isDistinctQuery(parsedSQL) || this.isWithQuery(parsedSQL))
        ) {
          this.resetHistogramWithError(this.t("search.histogramUnavailableForQueries"), -1);
          this.searchObj.meta.histogramDirtyFlag = false;
        } else if (this.searchObj.data.stream.selectedStream.length > 1) {
          this.resetHistogramWithError(this.t("search.histogramUnavailableForQueries"), -1);
        } else if (this.searchObj.data.queryResults.is_histogram_eligible == false) {
          this.resetHistogramWithError(
            this.t("logs.index.histogramUnavailableCtesDistinctLimit"),
            -1,
          );
          this.searchObj.meta.histogramDirtyFlag = false;
        } else if (
          this.searchObj.meta.histogramDirtyFlag == true &&
          this.searchObj.meta.jobId == ""
        ) {
          this.searchObj.meta.histogramDirtyFlag = false;

          // A histogram-only entry point, guarded against the executed scope (C14).
          this.autoRun.request("histogram");
        }
      }

      this.patchUrlViewState();
    },
    moveSplitter() {
      if (this.searchObj.meta.showFields == false) {
        this.searchObj.meta.showFields = this.searchObj.config.splitterModel > 0;
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
      // Build mode handles SQL mode changes via its own watcher in setup()
      if (this.searchObj.meta.logsVisualizeToggle === "build") {
        return;
      }

      if (newVal) {
        await nextTick();
        // Symmetry with the `else` branch below, which already honours
        // shouldIgnoreWatcher. During a URL / shared-link restore,
        // restoreUrlQueryParams() raises shouldIgnoreWatcher and sets the SQL
        // query itself. This "switch ON" path previously ignored that guard and
        // called setQuery(), overwriting the just-restored query with a default —
        // and once the editor momentarily empties, SQL mode auto-detects back off
        // and clears it entirely. That race is the intermittent "shared SQL link
        // opens an empty editor" bug. Stand down while a restore is in progress
        // and let it have the last word.
        if (this.searchObj.shouldIgnoreWatcher) {
          return;
        }
        if (this.searchObj.meta.sqlModeManualTrigger) {
          this.searchObj.meta.sqlModeManualTrigger = false;
        } else {
          this.setQuery(newVal);
        }
      } else {
        this.searchObj.meta.sqlMode = false;

        if (this.searchObj.meta.sqlModeEditTransition) {
          // Mode turned off because user edited away the SELECT prefix — keep
          // whatever they typed so it becomes a filter expression in non-SQL mode.
          this.searchObj.meta.sqlModeEditTransition = false;
        } else if (!this.searchObj.meta.nlpMode) {
          // IMPORTANT: Don't clear query when switching from SQL mode to NLP mode
          // User may want to refine/fix their existing SQL query using AI
          // Only clear when not in NLP mode (i.e., switching to Quick mode or other modes)
          this.searchObj.data.query = "";
          this.searchObj.data.editorValue = "";
        }

        if (
          this.searchObj.loading == false &&
          this.searchObj.shouldIgnoreWatcher == false &&
          this.store.state.zoConfig.query_on_stream_selection == false
        ) {
          this.autoRun.engine.requestRun("explicit");
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

<style scoped>
/* keep(complex-state): the field label is rendered deep inside the IndexList /
   FieldRow child components, so this reaches it with :deep() rather than a
   template utility. Mirrors the identical rule in plugins/traces/Index.vue. */
.logPage :deep(.index-menu .field_list .field_overlay .field_label) {
  font-size: var(--text-xs) !important;
}
</style>
