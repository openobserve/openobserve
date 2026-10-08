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
  <div class="flex h-full max-h-full flex-col overflow-hidden">
    <div class="flex h-full max-h-full w-full flex-col overflow-hidden" ref="searchListContainer">
      <!-- Section header: static at top -->
      <div
        class="border-card-glass-border bg-card-glass-bg flex h-9 shrink-0 items-center border-b max-md:h-auto max-md:min-h-9 max-md:flex-wrap max-md:gap-y-1 max-md:py-0.5"
      >
        <!-- Field panel toggle — same style as add-panel config sidebar -->
        <OButton
          variant="outline"
          size="icon-xs-sq"
          class="ms-1.5 shrink-0"
          data-test="logs-search-field-list-collapse-btn"
          @click="isMobile ? $emit('open-mobile-fields') : toggleFieldList()"
        >
          <OIcon
            :name="
              isMobile
                ? 'menu'
                : searchObj.meta.showFields
                  ? 'keyboard-double-arrow-left'
                  : 'keyboard-double-arrow-right'
            "
            size="sm"
          />
          <OTooltip
            :content="
              isMobile
                ? t('search.showFields')
                : searchObj.meta.showFields
                  ? t('logs.searchResult.collapseFields')
                  : t('logs.searchResult.openFields')
            "
            side="bottom"
            shortcut-id="logsToggleSidebar"
          />
        </OButton>
        <div
          class="bg-warning text-text-inverse rounded-default min-w-0 flex-1 ps-2 text-left"
          v-if="searchObj.data.countErrorMsg != ''"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-total-count-error-message"
            :htmlContent="searchObj.data.countErrorMsg"
          />
        </div>
        <div
          v-else
          class="text-warning flex min-w-0 flex-1 flex-wrap items-center gap-1.5 ps-2 text-left max-md:min-w-32"
          data-test="logs-search-result-title"
          :data-search-state="
            searchObj.loading || searchObj.loadingCounter ? 'loading' : 'complete'
          "
          :data-hits-count="searchObj.data?.queryResults?.hits?.length ?? 0"
        >
          <!-- Logs mode: structured chips -->
          <template v-if="searchObj.meta.logsVisualizeToggle !== 'patterns'">
            <template v-if="recordsChips">
              <OTag type="logsResultChip" value="neutral" data-test="logs-result-records-chip">{{
                recordsChips.records
              }}</OTag>
              <OTag
                type="logsResultChip"
                value="info"
                class="max-md:hidden"
                data-test="logs-result-time-chip"
                >{{ recordsChips.time }}</OTag
              >
              <OTag
                v-if="recordsChips.scan"
                type="logsResultChip"
                value="warn"
                class="max-md:hidden"
                data-test="logs-result-scan-chip"
                >{{ recordsChips.scan }}</OTag
              >
            </template>
            <span v-else class="min-w-0 truncate">{{ noOfRecordsTitle }}</span>
          </template>
          <!-- Patterns mode: structured chips -->
          <template v-else>
            <template v-if="patternChips">
              <OTag
                v-if="patternChips.events !== null"
                type="logsResultChip"
                value="neutral"
                data-test="logs-result-events-chip"
                >{{ patternChips.events }} {{ t("logs.searchResult.events") }}</OTag
              >
              <OTag type="logsResultChip" value="neutral" data-test="logs-result-patterns-chip"
                >{{ patternChips.patterns }} {{ t("logs.searchResult.patterns") }}</OTag
              >
              <OTag
                type="logsResultChip"
                value="info"
                class="max-md:hidden"
                data-test="logs-result-pattern-time-chip"
                >{{ patternChips.time }} {{ t("logs.searchResult.msUnit") }}</OTag
              >
            </template>
            <span v-else class="min-w-0 truncate">{{ patternSummaryText }}</span>
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
            class="text-warning shrink-0 cursor-pointer"
          >
            <OIcon name="info-outline" size="sm"> </OIcon>
            <OTooltip :content="raw(searchObj.data.histogram.errorMsg)" side="top" align="center" />
          </div>
        </div>

        <div class="flex flex-none items-center justify-end gap-1 pe-2 max-md:ms-auto">
          <!-- OVERFLOW MENU (narrow): refresh + all action buttons collapse here -->
          <ODropdown v-if="shouldMoveActionsToMenu" side="bottom" align="end">
            <template #trigger>
              <OButton variant="outline" size="icon-chip" data-test="logs-result-actions-menu-btn">
                <OIcon name="more-horiz" size="sm" />
                <OTooltip :content="t('search.moreActions')" />
              </OButton>
            </template>
            <ODropdownItem data-test="logs-result-refresh-menu-item" @select="$emit('run-query')">
              <template #icon-left><OIcon name="refresh" size="sm" /></template>
              {{ t("common.refresh") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="showWrapBtn"
              data-test="logs-result-wrap-menu-item"
              @select="searchObj.meta.toggleSourceWrap = !searchObj.meta.toggleSourceWrap"
            >
              <template #icon-left><OIcon name="wrap-text" size="sm" /></template>
              {{ t("search.messageWrapContent") }}
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
              {{ t("volumeInsights.searchInspectionsLabel") }}
            </ODropdownItem>
          </ODropdown>

          <!-- INLINE BUTTONS (wider container) -->
          <template v-else>
            <!-- Refresh in bordered wrapper -->
            <div
              class="border-card-glass-border rounded-default inline-flex h-6 items-center overflow-hidden border px-1"
            >
              <ORefreshButton
                :last-run-at="searchObj.meta.lastRunAt"
                :loading="searchObj.loading || searchObj.loadingHistogram"
                :disabled="searchObj.loading || searchObj.loadingHistogram"
                @click="$emit('run-query')"
              />
            </div>
            <!-- Action buttons -->
            <div v-if="showInspectBtn || showWrapBtn" class="inline-flex items-center gap-0.5">
              <OButton
                v-if="showInspectBtn"
                variant="outline"
                :size="showActionLabels ? 'chip' : 'icon-chip'"
                @click="openSearchJobInspector"
                data-test="logs-inspect-button"
              >
                <OIcon name="troubleshoot" size="sm" />
                <span v-if="showActionLabels" class="whitespace-nowrap">{{
                  t("volumeInsights.inspectBtnLabel")
                }}</span>
                <OTooltip
                  v-if="!showActionLabels"
                  :content="t('volumeInsights.searchInspectionsLabel')"
                />
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
            :disable="searchObj.loading || !!gridLockReason"
            @update:model-value="getPageData('recordsPerPage')"
          />
          <OTooltip
            v-if="gridLockReason && searchObj.meta.resultGrid.showPagination"
            :content="gridLockReason"
          />
          <OPagination
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
            :disable="searchObj.loading || !!gridLockReason"
            :data-locked="gridLockReason ? 'true' : undefined"
            v-model="pageNumberInput"
            :key="searchObj.data.queryResults.total + '-' + searchObj.data.resultGrid.currentPage"
            :max="pageCount"
            :max-pages="paginationMaxPages"
            class="paginator-section"
            @update:model-value="getPageData('pageChange')"
            data-test="logs-search-result-pagination"
          />
          <OTooltip
            v-if="gridLockReason && searchObj.meta.resultGrid.showPagination"
            :content="gridLockReason"
          />
        </div>
      </div>

      <!-- Outside scrollContainerRef so the results progress bar can't scroll away. -->
      <div class="relative">
        <LoadingProgress
          data-test="logs-results-progress"
          :loading="searchObj.loading"
          :loadingProgressPercentage="searchObj.loadingProgressPercentage || 0"
        />
      </div>

      <!-- Combined scroll: histogram + logs/patterns scroll together vertically.
        The histogram is pinned along the X axis only (see histogramPinStyle), so
        scrolling the wide results table sideways can't drag the chart with it. -->
      <!-- tabindex -1: focus lands here when a closed drawer has no row to return to (4a §3.2.2). -->
      <div class="min-h-0 flex-1 overflow-auto" ref="scrollContainerRef" tabindex="-1">
        <div
          ref="histogramRef"
          :style="histogramPinStyle"
          :class="[
            'histogram-container histogram-container--pinned-x',
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
            :loadingProgressPercentage="searchObj.loadingHistogramProgressPercentage || 0"
          />
          <div
            v-if="
              searchObj.meta.showHistogram &&
              (searchObj.data?.queryResults?.aggs?.length > 0 ||
                (plotChart && Object.keys(plotChart)?.length > 0))
            "
            ref="histogramChartWrap"
            class="histogram-chart"
            @click="onHistogramAreaClick"
          >
            <ChartRenderer
              ref="histogramChart"
              data-test="logs-search-result-bar-chart"
              :data="plotChart"
              class="h-full w-full"
              @updated:dataZoom="onChartUpdate"
            />
          </div>

          <div
            v-else-if="
              searchObj.meta.showHistogram && (searchObj.loadingHistogram || searchObj.loading)
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
              <div class="histogram-skeleton__plot border-card-glass-border border-s border-b">
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
              searchObj.meta.showHistogram && !searchObj.loadingHistogram && !searchObj.loading
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
            v-else-if="searchObj.meta.showHistogram && Object.keys(plotChart)?.length === 0"
          >
            <h5 class="text-center">
              <span class="histogram-empty__message" style="color: transparent">.</span>
            </h5>
          </div>
        </div>
        <div
          :style="histogramPinStyle"
          :class="[
            'histogram-container histogram-container--pinned-x',
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
            class="histogram-error text-center"
            v-if="
              searchObj.data.histogram.errorCode != 0 && searchObj.data.histogram.errorCode != -1
            "
          >
            <OIcon name="warning" size="xs"></OIcon>
            {{ t("logs.searchResult.histogramFetchError") }}
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
          <h6 class="text-center" v-else-if="searchObj.data.histogram.errorCode != -1">
            <SanitizedHtmlRenderer
              data-test="logs-search-histogram-error-message"
              :htmlContent="searchObj.data?.histogram?.errorMsg"
            />
          </h6>
        </div>

        <!-- Pinned breakdown tooltip — teleported to body to avoid stacking context issues -->
        <Teleport to="body">
          <div v-if="pinnedTooltip.visible" class="oo-pin-backdrop" @click="closePinnedTooltip" />
          <div
            v-if="pinnedTooltip.visible"
            class="oo-pin-tooltip bg-surface-base border-border-default text-text-heading border"
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
            <div v-for="row in pinnedTooltip.rows" :key="row.rawValue" class="oo-pin-tooltip__row">
              <span class="oo-pin-tooltip__dot" :style="{ background: row.color }" />
              <span class="oo-pin-tooltip__name">{{ row.displayLabel }}</span>
              <span class="oo-pin-tooltip__count">{{ formatCount(row.count) }}</span>
              <span class="oo-pin-tooltip__row-actions">
                <span
                  class="oo-pin-tooltip__action oo-pin-tooltip__action--include text-status-info-text"
                  :title="t('logs.searchResult.include')"
                  @click.stop="applyPinnedFilter(row.rawValue, 'include')"
                  >=</span
                >
                <span
                  class="oo-pin-tooltip__action oo-pin-tooltip__action--exclude text-status-error-text"
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
          <!-- Missing-stream warning banner -->
          <LogsMissingStreamBanner
            v-if="!searchObj.loading && searchObj.data.missingStreamMessage"
            :message="searchObj.data.missingStreamMessage"
            :no-fts-streams="searchObj.data.freeTextExcluded ?? []"
            :term="noFtsRecoveryTerm"
            :recovery-streams="noFtsRecoverySchemas"
            :selected-streams="searchObj.data.stream.selectedStream"
            @clear-run="$emit('no-fts-clear-run')"
            @field-search="(values) => $emit('no-fts-field-search', values)"
          />
          <!-- VRL function-error banner (collapsible) -->
          <div
            v-if="!searchObj.loading && searchObj?.data?.functionError"
            data-test="log-search-result-function-error"
            class="px-page-edge bg-status-warning-bg py-2 text-xs"
          >
            <button
              type="button"
              class="text-status-warning-text flex cursor-pointer items-center gap-1 border-0 bg-transparent"
              data-test="table-row-expand-menu"
              @click="isFunctionErrorOpen = !isFunctionErrorOpen"
            >
              <OIcon :name="isFunctionErrorOpen ? 'expand-more' : 'chevron-right'" size="sm" />
              {{ t("search.functionErrorLabel") }}
            </button>
            <pre
              v-if="isFunctionErrorOpen"
              class="text-status-warning-text mt-1 break-words whitespace-pre-wrap"
              >{{ searchObj?.data?.functionError }}</pre>
          </div>

          <!-- Row/cell actions live in a right-click context menu as well as the
               hover overlay: the overlay can only be offered on columns wide
               enough to host it, while the menu is anchored to the pointer so
               every cell can offer actions. -->
          <OContextMenu @update:open="onContextMenuOpenChange">
            <template #trigger>
              <div class="contents" @contextmenu.capture="handleTableContextMenu">
                <OTable
                  ref="searchTableRef"
                  :columns="getColumns || []"
                  :data="searchObj.data.queryResults?.hits || []"
                  :wrap="searchObj.meta.toggleSourceWrap"
                  :cell-overflow-tooltip="false"
                  :loading="isResultsSkeleton"
                  :streaming="isResultsStreaming"
                  :row-key="logsRowKey"
                  :row-height="20"
                  virtual-scroll
                  :fill-height="false"
                  :scroll-el="scrollContainerRef"
                  :horizontal-scroll="true"
                  :scroll-margin="0"
                  :default-columns="false"
                  :show-global-filter="false"
                  :frame="false"
                  pagination="none"
                  sorting="none"
                  :enable-column-reorder="true"
                  :pinned-first-column="logsTimestampCol"
                  :enable-column-resize="true"
                  :get-row-status-color="getLogRowStatusColor"
                  :row-class="getLogRowClass"
                  :active-row-index="activeRowIndex"
                  expansion="multiple"
                  :expanded-ids="expandedLogIds"
                  data-test="logs-search-result-logs-table"
                  class="logs-results-otable w-full"
                  :class="[
                    !searchObj.meta.showHistogram ||
                    (searchObj.meta.showHistogram && searchObj.data.histogram.errorCode == -1)
                      ? 'min-h-full!'
                      : 'min-h-[calc(100%-6.25rem)]!',
                  ]"
                  @update:columnSizes="handleColumnSizesUpdate"
                  @column-order-change="handleColumnOrderUpdate"
                  @close-column="closeColumn"
                  @cell-contextmenu="handleCellContextMenu"
                  @row-click="openLogDetailsByRow"
                  @update:expandedIds="onExpandedLogIdsChange"
                >
                  <!-- Empty slot opts out of OTable's default banner, which would shift the grid on every partition. -->
                  <template #loading-banner />

                  <!-- FTS-highlighted cell content; falls back to the plain value. -->
                  <template
                    v-for="col in getColumns || []"
                    :key="col.id"
                    #[`cell-${col.id}`]="{ row, value }"
                  >
                    <span
                      v-if="logsCellHtml(col.id, row)"
                      class="log-cell-html"
                      :data-test="
                        col.id === logsTimestampCol ? 'log-row-timestamp-value' : undefined
                      "
                      v-html="logsCellHtml(col.id, row)"
                    />
                    <span
                      v-else
                      :data-test="
                        col.id === logsTimestampCol ? 'log-row-timestamp-value' : undefined
                      "
                      >{{ value }}</span
                    >
                    <span
                      v-if="col.id === logsTimestampCol"
                      class="sr-only select-none"
                      data-test="log-row-severity-sr"
                      >{{ logRowSeveritySrText(row) }}</span
                    >
                  </template>

                  <!-- Per-cell hover actions: AI button on the timestamp cell; copy /
                 add-search-term on closable field cells. -->
                  <template #cell-hover-actions="{ row, column, value, active }">
                    <O2AIContextAddBtn
                      v-if="active && !contextMenuOpen && column.id === logsTimestampCol"
                      data-test="logs-search-result-ai-btn"
                      @send-to-ai-chat="sendToAiChat(JSON.stringify(row), true)"
                    />
                    <CellActions
                      v-else-if="active && !contextMenuOpen && showLogCellActions(column, row)"
                      :column="column"
                      :row="row"
                      :value="value"
                      :selected-stream-fields="searchObj.data.stream.selectedStreamFields"
                      :hide-search-term-actions="false"
                      :hide-ai="column.id === 'source'"
                      @copy="copyLogToClipboard"
                      @add-search-term="addSearchTerm"
                      @send-to-ai-chat="sendToAiChat"
                    />
                  </template>

                  <!-- Expanded row → JSON preview -->
                  <template #expansion="{ row }">
                    <JsonPreview
                      :value="row"
                      :index="logsRowIndex(row)"
                      class="px-2 py-1.5"
                      mode="expanded"
                      :highlight-query="searchObj.data.highlightQuery"
                      :hide-search-term-actions="false"
                      @copy="copyLogToClipboard"
                      @add-field-to-table="addFieldToTable"
                      @add-search-term="addSearchTerm"
                      @view-trace="redirectToTraces(row)"
                      @show-correlation="openLogDetailsWithCorrelation"
                      @send-to-ai-chat="sendToAiChat"
                    />
                  </template>
                </OTable>
              </div>
            </template>

            <!-- Actions apply to the cell that was right-clicked. `contextCell`
                 is recorded by the table's @cell-contextmenu, which fires before
                 reka-ui opens the menu, so the content is always in sync with
                 the pointer. -->
            <template v-if="contextCell">
              <OContextMenuLabel data-test="log-context-menu-field">
                {{ contextCell.columnId }}
              </OContextMenuLabel>
              <OContextMenuSeparator />

              <OContextMenuItem
                icon-left="content-copy"
                data-test="log-context-menu-copy-value"
                @select="copyLogToClipboard(contextCell.value)"
              >
                {{ t("logs.cellActions.copy") }}
              </OContextMenuItem>

              <OContextMenuItem
                v-if="contextLineLink.kind !== 'hidden'"
                icon-left="link"
                :disabled="contextLineLink.kind === 'disabled'"
                data-test="log-context-menu-copy-line-link"
                @select="copyLineLink(contextCell.row, 'menu')"
              >
                <!-- A child tooltip binds to its previous sibling, so the label gets its own box. -->
                <span class="min-w-0 flex-1">
                  <OTooltip
                    v-if="contextLineLink.kind === 'disabled'"
                    :content="contextLineLink.reason"
                    side="right"
                  />
                  {{ t("search.linePermalink.copyLinkMenu") }}
                </span>
              </OContextMenuItem>

              <template v-if="contextCellIsStreamField">
                <OContextMenuItem
                  data-test="log-context-menu-include-term"
                  @select="
                    addSearchTerm(
                      contextCell.columnId,
                      toSearchTermValue(contextCell.value),
                      'include',
                    )
                  "
                >
                  <!-- size="sm" matches the registry icons on the other items so
                    the labels line up; the glyph itself is inset because it
                    fills its viewBox edge-to-edge, unlike Material Symbols. -->
                  <template #icon-left>
                    <OIcon name="" size="sm">
                      <EqualIcon class="size-3" />
                    </OIcon>
                  </template>
                  {{ t("logs.cellActions.includeTerm") }}
                </OContextMenuItem>

                <OContextMenuItem
                  data-test="log-context-menu-exclude-term"
                  @select="
                    addSearchTerm(
                      contextCell.columnId,
                      toSearchTermValue(contextCell.value),
                      'exclude',
                    )
                  "
                >
                  <template #icon-left>
                    <OIcon name="" size="sm">
                      <NotEqualIcon class="size-3" />
                    </OIcon>
                  </template>
                  {{ t("logs.cellActions.excludeTerm") }}
                </OContextMenuItem>
              </template>

              <template v-if="aiEnabled">
                <OContextMenuSeparator />
                <OContextMenuItem
                  icon-left="auto-awesome"
                  data-test="log-context-menu-ai-value"
                  @select="sendToAiChat(JSON.stringify(contextCell.value))"
                >
                  {{ t("logs.cellActions.sendValueToAi") }}
                </OContextMenuItem>
                <OContextMenuItem
                  icon-left="auto-awesome"
                  data-test="log-context-menu-ai-row"
                  @select="sendToAiChat(JSON.stringify(contextCell.row), true)"
                >
                  {{ t("logs.cellActions.sendRowToAi") }}
                </OContextMenuItem>
              </template>
            </template>
          </OContextMenu>
        </template>

        <!-- Patterns View -->
        <div
          v-if="searchObj.meta.logsVisualizeToggle === 'patterns'"
          class="flex h-full flex-col"
          :class="[
            !searchObj.meta.showHistogram ||
            (searchObj.meta.showHistogram && searchObj.data.histogram.errorCode == -1)
              ? 'min-h-full!'
              : 'min-h-[calc(100%-6.25rem)]!',
          ]"
        >
          <!-- Patterns List -->
          <PatternList
            :patterns="patternsState?.patterns?.patterns || []"
            :loading="patternsState?.loading"
            :totalLogsAnalyzed="patternsState?.patterns?.statistics?.total_logs_analyzed"
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
        :sub-title="drawerSubTitle"
        :return-focus-to="detailReturnFocus"
        @update:open="(v) => !v && (reDrawChart(), endSharedDetail())"
        @after-close="onDetailDrawerAfterClose"
      >
        <DetailTable
          v-if="detailRow"
          :key="'dialog_' + detailOpenSeq"
          :model-value="detailRow"
          :stream-type="searchObj.data.stream.streamType"
          :correlation-props="correlationDashboardProps"
          :correlation-loading="correlationLoading"
          :correlation-error="correlationError ?? undefined"
          :initial-tab="detailTableInitialTab"
          class="rounded-default"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex ?? -1"
          :totalLength="searchObj.data.queryResults?.hits?.length || 0"
          :has-prev-page="hasPrevPage"
          :has-next-page="hasNextPage"
          :page-loading="!!searchObj.meta.resultGrid.navigation.pendingPageSelection"
          :page-loading-direction="pageLoadingDirection"
          :page-loading-page="searchObj.meta.resultGrid.navigation.pendingPageSelection?.page ?? 0"
          :nav-disabled-reason="navDisabledReason"
          :page-edge-reason="pageEdgeReason"
          :highlight-query="searchObj.data.highlightQuery"
          @showNextDetail="stepLogRow(1, false)"
          @showPrevDetail="stepLogRow(-1, false)"
          @update:tab="onDetailTabChange"
          @add:searchterm="addSearchTerm"
          @remove:searchterm="removeSearchTerm"
          @search:timeboxed="onTimeBoxed"
          @add:table="addFieldToTable"
          @close="onDetailUserClose"
          @view-trace="redirectToTraces(detailRow)"
          @sendToAiChat="sendToAiChat"
          @closeTable="closeTable"
          @load-correlation="openCorrelationFromLog"
        />
        <!-- Outside the keyed DetailTable so it is one node across steps, inside the dialog so reka does not hide it. -->
        <div class="sr-only" aria-live="polite" aria-atomic="true" data-test="logs-detail-nav-live">
          {{ detailNavAnnouncement }}
        </div>
      </ODrawer>

      <!-- The menu closes on select, so the fallback popover anchors where the right-click landed, outside the scrolling results. -->
      <div
        v-if="menuLinkAnchor"
        class="pointer-events-none fixed size-0"
        :style="{ insetInlineStart: `${menuLinkAnchor.x}px`, top: `${menuLinkAnchor.y}px` }"
      >
        <LogLineLinkPopover source="menu" />
      </div>

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
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { raw, useI18nTyped } from "@/types/i18n";

import { byString } from "../../utils/json";
import { getImageURL, useLocalWrapContent } from "../../utils/zincutils";
import { formatLargeNumber } from "@/utils/formatters";
import { CUSTOM_THEME_NAME, THEME_STORAGE_KEYS } from "@/constants/themes";
import useLogs from "../../composables/useLogs";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import usePatterns from "@/composables/useLogs/usePatterns";
import { usePatternActions } from "@/plugins/logs/patterns/usePatternActions";
import { useAlertCreation } from "@/composables/alerts/useAlertCreation";
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
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import {
  failPendingPageNavigation,
  logsRowNavAnnouncement,
  onHitsComplete,
  resetRowSelection,
  setPageNavFailureHandler,
} from "@/composables/useLogs/logsRowNav";
import { nextRowTarget } from "@/utils/rowNavigation";
import {
  activePermalink,
  clearColumnsFromUrl,
  clearPermalink,
  columnsFromUrl,
  permalinkHighlightTs,
  permalinkRowIndex,
  searchResultMounts,
  sharedLineRecord,
} from "@/composables/useLogs/useLogPermalink";
import { useLogLineLink, type LineLinkState } from "@/composables/useLogs/useLogLineLink";
import LogLineLinkPopover from "@/plugins/logs/LogLineLinkPopover.vue";
import { traceDetailsLocation } from "@/composables/useLogs/useViewTraceAction";
import { matchDetailRow, trustworthyFields } from "@/utils/logs/detailRowMatch";
import { acceptsPageLoad, type PageLoad, type PendingPageSelection } from "@/utils/pageCrossing";
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
import OContextMenu from "@/lib/overlay/ContextMenu/OContextMenu.vue";
import OContextMenuItem from "@/lib/overlay/ContextMenu/OContextMenuItem.vue";
import OContextMenuLabel from "@/lib/overlay/ContextMenu/OContextMenuLabel.vue";
import OContextMenuSeparator from "@/lib/overlay/ContextMenu/OContextMenuSeparator.vue";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";
import {
  buildFilterContext,
  noFtsRecoveryStreams,
  planStreamsFilter,
} from "@/composables/useLogs/freeTextSearch";
import LogsMissingStreamBanner from "@/plugins/logs/LogsMissingStreamBanner.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";
import { severityIndicatorColor, severityRowClass } from "@/utils/logs/statusParser";
import useLogSeverity from "@/composables/useLogs/useLogSeverity";
import { isFilterableLogField } from "@/utils/logs/streamNameColumn";
import useBreakpoint from "@/composables/useBreakpoint";
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
    LogLineLinkPopover,
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
    OTable: defineAsyncComponent(() => import("@/lib/core/Table/OTable.vue")),
    CellActions,
    LogsMissingStreamBanner,
    O2AIContextAddBtn,
    JsonPreview: defineAsyncComponent(() => import("./JsonPreview.vue")),
    TelemetryCorrelationDashboard,
    PatternList: defineAsyncComponent(() => import("./patterns/PatternList.vue")),
    PatternDetailsDialog: defineAsyncComponent(() => import("./patterns/PatternDetailsDialog.vue")),
    OIcon,
    ODropdown,
    ODropdownItem,
    OContextMenu,
    OContextMenuItem,
    OContextMenuLabel,
    OContextMenuSeparator,
    EqualIcon,
    NotEqualIcon,
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
    "open-mobile-fields",
    "no-fts-clear-run",
    "no-fts-field-search",
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
      // Sizes arrive keyed by column id, but persistence stores them as
      // `--col-{id}-size` / `--header-{id}-size` so saved views load back correctly.
      const cssVarSizes: Record<string, number> = {};
      for (const [id, size] of Object.entries(newColSizes || {})) {
        cssVarSizes[`--col-${id}-size`] = size as number;
        cssVarSizes[`--header-${id}-size`] = size as number;
      }
      // colSizes entries are arrays of size-maps keyed by joined stream name.
      const colSizes = this.searchObj.data.resultGrid?.colSizes as Record<
        string,
        Record<string, unknown>[]
      >;
      const prevColSizes =
        colSizes?.[this.searchObj.data.stream.selectedStream.join(",")]?.[0] || {};
      this.searchObj.data.resultGrid.colSizes[this.searchObj.data.stream.selectedStream.join(",")] =
        [
          {
            ...prevColSizes,
            ...cssVarSizes,
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
          clearColumnsFromUrl();
          this.searchObj.organizationIdentifier = this.store.state.selectedOrganization.identifier;
          let selectedFields = this.reorderSelectedFields();

          this.searchObj.data.stream.selectedFields = selectedFields.filter(
            (_field) => _field !== (this.store?.state?.zoConfig?.timestamp_column || "_timestamp"),
          );
          this.updatedLocalLogFilterField();
        }
      }
    },

    getPageData(actionType: string) {
      // The controls are disabled while locked; this also covers keyboard paths.
      if (this.gridLockReason) return false;
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
            this.searchObj.data.queryResults.total / this.searchObj.meta.resultGrid.rowsPerPage,
          )
        ) {
          this.searchObj.data.resultGrid.currentPage =
            this.searchObj.data.resultGrid.currentPage + 1;
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          this.$emit("update:scroll");
          this.scrollTableToTop(0);
        }
      } else if (actionType == "recordsPerPage") {
        resetRowSelection(this.searchObj);
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
        if (!this.changePage(Number(this.pageNumberInput), { fromCrossing: false })) return false;
      }
      return undefined;
    },
    closeColumn(col: any) {
      // Explicit user action — clear the system-pick marker so the result persists.
      this.searchObj.meta.isFtsDefaultColumn = false;
      clearColumnsFromUrl();
      let selectedFields = this.reorderSelectedFields();

      // `col` is the OTable columnDef, which carries `id` but not the original
      // `name`. resultGrid.columns holds column objects, so match on id there and
      // fall back to id for the selectedFields (string) lookup.
      const field = col.name ?? col.id;
      const RGIndex = this.searchObj.data.resultGrid.columns.findIndex((c: any) => c.id === col.id);
      if (RGIndex !== -1) this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = selectedFields.indexOf(field);

      if (SFIndex !== -1) selectedFields.splice(SFIndex, 1);

      this.searchObj.data.stream.selectedFields = selectedFields.filter(
        (_field) => _field !== (this.store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );

      this.searchObj.organizationIdentifier = this.store.state.selectedOrganization.identifier;
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
      // Search-around is a user scope change, so it ends a shared line (4c C5 step 6b).
      clearPermalink();
      this.searchObj.meta.showDetailTab = false;
      // Search-around never reaches getQueryData, so it drops the old open row itself (AC5.4).
      resetRowSelection(this.searchObj);
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
    const { t } = useI18nTyped();
    const store = useStore();
    const { isDark } = useTheme();
    const { isMobile } = useBreakpoint();
    const searchListContainer = ref<HTMLElement | null>(null);

    // Responsive: observe the outer container (reacts to splitter + window resize)
    const containerWidth = ref(9999);
    let containerResizeObserver: ResizeObserver | null = null;
    // match shouldMoveActionsToMenu threshold: 3 pages when narrow, 5 when wide
    const paginationMaxPages = computed(() => (containerWidth.value < 700 ? 3 : 5));

    // The histogram is sticky-left inside the shared scroll container. Sticky
    // alone would stretch it to the full scroll width and mis-size the ECharts
    // canvas, so lock it to the container's visible (client) width instead.
    const histogramPinWidth = ref(0);
    let histogramResizeObserver: ResizeObserver | null = null;
    const histogramPinStyle = computed(() =>
      histogramPinWidth.value ? { width: `${histogramPinWidth.value}px` } : {},
    );
    const syncHistogramPinWidth = () => {
      histogramPinWidth.value = scrollContainerRef.value?.clientWidth ?? 0;
    };

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
      const totalTimeMs =
        (searchObj.data.queryResults?.took || 0) + (stats.extraction_time_ms || 0);
      return t("search.pattern_summary", {
        totalEvents: totalEventsStr,
        patternsFound,
        logsAnalyzed,
        totalTime: totalTimeMs,
      });
    });

    // Builds the logs-mode chips from the histogram's structured values. Read
    // `titleParts`, never the rendered title — parsing that back apart only worked
    // while it was hardcoded English and breaks in every other locale.
    const recordsChips = computed(() => {
      const parts = searchObj.data.histogram.chartParams.titleParts;
      if (!parts) return null;

      return {
        records: t(isMobile.value ? "search.recordsChipShort" : "search.recordsChip", {
          start: parts.start,
          end: parts.end,
          total: parts.total,
        }),
        time: t("search.tookChip", { took: parts.took }),
        // Label is already translated, the size is data — joined so the pair reads like the title.
        scan: parts.scanLabel != null ? raw(`${parts.scanLabel}: ${parts.scanSize}`) : null,
      };
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
      const totalEvents = patternWindowTotal.value ?? searchObj.data.queryResults?.total ?? null;
      const totalEventsStr = totalEvents === null ? null : formatLargeNumber(totalEvents);
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
    const { refreshPagination } = useSearchStream(t);
    const { refreshPartitionPagination, refreshJobPagination } = usePagination();
    const { updatedLocalLogFilterField } = logsUtils();
    const { extractFTSFields, filterHitsColumns } = useStreamFields();

    const { reorderSelectedFields, getFilterExpressionByFieldType, resolveDefaultColumns } =
      useLogs(t);

    const { searchObj } = searchState();
    const autoRun = useLogsAutoRun();
    const noFtsRecoverySchemas = computed(() =>
      noFtsRecoveryStreams(searchObj, searchObj.data.freeTextExcluded ?? []),
    );
    const noFtsRecoveryTerm = computed(() => {
      const plan = planStreamsFilter(
        searchObj.data.query.trim(),
        searchObj.data.stream.selectedStream,
        buildFilterContext(searchObj, store.state.zoConfig),
      );
      return plan.kind === "freeText" ? plan.units.join(" ") : searchObj.data.query;
    });

    // Paging an out-of-date or search-around grid would fetch a different query than the rows show (AC5.2, D6).
    const gridLockReason = computed(() => {
      if (autoRun.engine.isResultsStale()) return t("search.autoRunStaleTooltip");
      if (autoRun.searchAroundActive()) return t("search.autoRunSearchAroundActive");
      return null;
    });

    // Use separate patterns state (completely isolated from logs)
    const { patternsState } = usePatterns(t);

    const {
      selectedPattern,
      showPatternDetails,
      openPatternDetails,
      navigatePatternDetail,
      navTotal: patternNavTotal,
      addPatternToSearch,
      addWildcardValueToSearch,
      buildSinglePatternAlertPrefill,
    } = usePatternActions();

    const { openAlertCreation } = useAlertCreation();

    /**
     * Single-pattern alert creation from the detail drawer. Previously this
     * wrote a sessionStorage payload nothing ever read, so the alert form opened
     * blank; it now goes through the same prefill contract as every other
     * surface.
     */
    const createAlertFromPattern = (pattern: any) => {
      const launched = openAlertCreation(buildSinglePatternAlertPrefill(pattern));
      if (!launched) {
        toast({
          variant: "warning",
          message: t("logs.patternList.alertBroadMatch"),
        });
      }
    };

    // Context the pattern details drawer needs to look up a pattern's
    // window-wide volume, so its Occurrences figure matches the list's `~N`
    // instead of falling back to the much smaller extraction-sample count.
    const patternVolumeContext = computed<PatternVolumeContext | null>(() => {
      // Pattern volume feeds only the patterns view's "N events" figures. Don't
      // build a context (and so don't fire the window-total count query) while the
      // user is on the logs/visualize view — otherwise every logs visit runs a
      // `SELECT count(*)` for a feature that isn't on screen.
      if (searchObj.meta.logsVisualizeToggle !== "patterns") return null;
      return buildPatternVolumeContext({
        orgId: store.state.selectedOrganization?.identifier ?? "",
        streamName: searchObj.data.stream.selectedStream[0],
        window: props.queryWindowUs as { start: number; end: number } | undefined,
        lastQuery: patternsState.value?.lastQuery,
      });
    });

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

    // Histogram brush selection, read by the Drill down page (Index.vue)
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
    const {
      findRelatedTelemetry,
      semanticGroups,
      noMatch: correlationNoMatch,
      error: serviceCorrelationError,
    } = useServiceCorrelation();

    // Flag to prevent duplicate correlation API calls
    const correlationFetchInProgress = ref(false);

    const shouldShowInlineDialog = computed(() => {
      return (
        showCorrelation.value && correlationDashboardProps.value && !searchObj.meta.showDetailTab
      );
    });

    const patternsColumns = [
      {
        accessorKey: "pattern_id",
        header: raw("#"),
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
        header: t("search.patternTemplate"),
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
        header: t("search.patternCount"),
        id: "frequency",
        size: 100,
        cell: (info: any) => `${info.getValue()} (${info.row.original.percentage.toFixed(1)}%)`,
        meta: {
          closable: false,
          showWrap: false,
        },
      },
      {
        accessorKey: "examples",
        header: t("search.patternExampleLog"),
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
      const appliedThemeName = localStorage.getItem(THEME_STORAGE_KEYS[currentMode].appliedName);

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

    // ECharts sizes its canvas from the element it was mounted into, and only
    // re-measures when told to. The histogram wrapper is locked to an explicit
    // pixel width (histogramPinStyle), so a viewport change — docking or
    // undocking devtools, for instance — moves the box underneath a canvas that
    // never hears about it, and the chart is left at the old size. ECharts' own
    // window-resize handler is no help: it fires before the new width has been
    // applied, so it re-measures the stale box.
    //
    // Watching the chart's own element removes the ordering problem entirely —
    // the observer fires once the new box is real, whatever caused it.
    const histogramChartWrap = ref<HTMLElement | null>(null);
    let chartResizeObserver: ResizeObserver | null = null;

    watch(histogramChartWrap, (el) => {
      chartResizeObserver?.disconnect();
      chartResizeObserver = null;
      if (!el) return;
      chartResizeObserver = new ResizeObserver(() => histogramChart.value?.chart?.resize());
      chartResizeObserver.observe(el);
    });

    const closePinnedTooltip = () => {
      pinnedTooltip.value.visible = false;
      // Restore tooltip mouse tracking
      histogramChart.value?.chart?.setOption({ tooltip: { triggerOn: "mousemove|click" } }, false);
    };

    const onHistogramAreaClick = (event: MouseEvent) => {
      const { breakdownField, breakdownSeries, xData } = searchObj.data.histogram;
      if (!breakdownSeries?.size || !xData?.length) return;

      const eChart = histogramChart.value?.chart;
      if (!eChart) return;

      // Convert click pixel to nearest data index
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const pixelX = event.clientX - rect.left;
      const pixelY = event.clientY - rect.top;

      // Ignore clicks outside the plot area (e.g. legend items)
      if (!eChart.containPixel("grid", [pixelX, pixelY])) return;

      const dataPoint = eChart.convertFromPixel({ seriesIndex: 0 }, [pixelX, pixelY]);
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
          // `label` stays the English sentinel: it is compared above to derive
          // rawValue and matched against the ECharts series name. Only the
          // rendered field is translated.
          displayLabel: label === "(empty)" ? t("logs.searchResult.emptyValue") : label,
          rawValue,
          count: (counts as number[])[dataIndex] ?? 0,
          color: matchedSeries?.itemStyle?.color ?? "#888",
        };
      });

      const margin = 10;
      const panelW = 250;
      // Cap panel height at the viewport so placement math stays valid even
      // for high-cardinality breakdowns. Actual scroll is handled in CSS.
      const panelH = Math.min(rows.length * 28 + 60, window.innerHeight - 2 * margin);
      const x = Math.min(event.clientX + margin, window.innerWidth - panelW - margin);
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

    const applyPinnedFilter = (rawValue: string, action: "include" | "exclude") => {
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

      if (scrollContainerRef.value) {
        syncHistogramPinWidth();
        histogramResizeObserver = new ResizeObserver(syncHistogramPinWidth);
        histogramResizeObserver.observe(scrollContainerRef.value);
      }
    });

    onBeforeUnmount(() => {
      window.removeEventListener("themeColorChanged", handleThemeColorChange);
      containerResizeObserver?.disconnect();
      histogramResizeObserver?.disconnect();
      chartResizeObserver?.disconnect();
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
        Object.prototype.hasOwnProperty.call(searchObj.data.histogram, "xData") &&
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

    const openLogDetails = (_row: any, index: number) => {
      if (!openDetail({ index }, { tab: "json" })) return;
      searchObj.meta.resultGrid.navigation.selectionActive = true;

      // Prepare correlation context (but don't open panel automatically)
      const logData = detailRow.value;
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

      // Identity is the hit's position: timestamps repeat within a batch.
      const index = logsRowIndex(row);
      if (index < 0) {
        console.error("[SearchResult] Could not find flex index for correlation", {
          hitsCount: searchObj.data.queryResults?.hits?.length,
        });
        return;
      }

      openDetail({ index }, { tab: "correlated-logs" });
      searchObj.meta.resultGrid.navigation.selectionActive = true;

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
          // F28: only claim "no matching service" when the API actually
          // returned no-match; a genuine failure (403, network, …) keeps its
          // own message instead of being aliased to no-match.
          correlationError.value = correlationNoMatch.value
            ? t("logs.searchResult.noMatchingService")
            : serviceCorrelationError.value || t("logs.searchResult.unableToRetrieveCorrelation");
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
        const logFilters = result.correlationData.related_streams.logs?.[0]?.filters || {};
        const actualMatchedDimensions =
          Object.keys(logFilters).length > 0
            ? logFilters
            : result.correlationData.matched_dimensions;

        const sourceEvent = {
          timestamp: logData._timestamp,
          severity: extractSeverity(logData) ?? undefined,
          message: logData.body || logData.message || logData.log || logData.msg,
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
            ...buildWorkloadChipDimensions(
              result.correlationData.matched_set_id,
              semanticGroups.value,
              logData,
            ),
          },
          sourceEvent,
          metricStreams: result.correlationData.related_streams.metrics || [],
          logStreams: result.correlationData.related_streams.logs || [],
          traceStreams: result.correlationData.related_streams.traces || [],
          sourceStream: searchObj.data.stream.selectedStream[0],
          sourceType: "logs",
          // Use log stream filters and log record as availableDimensions for field name resolution and traceId extraction
          availableDimensions: { ...logFilters, ...context.fields },
          // Lets filter edits resolve across streams that alias the same
          // semantic group under different field names (F35).
          semanticGroups: semanticGroups.value,
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
          console.warn("[SearchResult] No metric streams found for correlation");
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

    const clearCorrelationState = () => {
      correlationDashboardProps.value = null;
      correlationLoading.value = false;
      correlationError.value = null;
    };

    const navigation = () => searchObj.meta.resultGrid.navigation;
    const hitsList = (): any[] => searchObj.data.queryResults?.hits ?? [];
    const detailRow = ref<Record<string, any> | null>(null);
    const detailOpenSeq = ref(0);
    const detailActiveTab = ref("json");
    const rowNavAnnouncement = logsRowNavAnnouncement;
    const detailNavAnnouncement = ref("");
    let afterCloseAnnouncement: string | null = null;
    let crossingFromClosedDrawer = false;

    const currentPage = computed(() => Number(searchObj.data.resultGrid.currentPage) || 1);
    const pageCount = computed(() =>
      Math.max(
        1,
        (searchObj.communicationMethod === "streaming" || searchObj.meta.jobId != ""
          ? searchObj.data.queryResults?.pagination?.length
          : searchObj.data.queryResults?.partitionDetail?.paginations?.length) || 0,
      ),
    );
    const searchAroundShown = () => searchObj.data.searchAround?.indexTimestamp > 0;
    const autoRefreshOn = () => Number(searchObj.meta.refreshInterval ?? 0) > 0;
    // Live mode stays page-1-only, and a stale or search-around grid would page a different query (4a §3.2).
    const canChangePage = computed(
      () =>
        !!searchObj.meta.resultGrid.showPagination &&
        !autoRefreshOn() &&
        !searchAroundShown() &&
        !gridLockReason.value,
    );
    const hasNextPage = computed(() => canChangePage.value && currentPage.value < pageCount.value);
    const hasPrevPage = computed(() => canChangePage.value && currentPage.value > 1);
    // Another request clearing `loading` must not enable J/K while the hits stream still reorders rows.
    const hitsSettled = () => searchObj.data.resultGrid.hitsSettled !== false && !searchObj.loading;

    const activeRowIndex = computed(() =>
      navigation().selectionActive ? (navigation().currentRowIndex ?? null) : null,
    );

    const pageEdgeReason = computed(() => {
      if (!searchObj.meta.resultGrid.showPagination || searchAroundShown()) return null;
      if (autoRefreshOn()) return t("logs.rowNav.autoRefreshEdge");
      if (autoRun.engine.isResultsStale()) return t("search.autoRunStaleTooltip");
      return null;
    });

    // True while the drawer shows the resolved record of an opened line link (4c C5).
    const detailIsShared = ref(false);

    const navDisabledReason = computed<"resultsChanged" | "notInPage" | "loading" | null>(() => {
      if (navigation().pendingPageSelection) return null;
      if (!hitsSettled()) return "loading";
      if (navigation().currentRowIndex == null) {
        return detailIsShared.value ? "notInPage" : "resultsChanged";
      }
      return null;
    });

    const pageLoadingDirection = computed<"next" | "prev" | null>(() => {
      const pending = navigation().pendingPageSelection;
      if (!pending) return null;
      return pending.position === "first" ? "next" : "prev";
    });

    const drawerSubTitle = computed(() => {
      const pending = navigation().pendingPageSelection;
      if (pending) return t("logs.rowNav.loadingPage", { page: pending.page });
      const index = navigation().currentRowIndex;
      if (index == null || !hitsList().length) return undefined;
      return t("logs.rowNav.positionLabel", {
        row: index + 1,
        count: hitsList().length,
        page: currentPage.value,
      });
    });

    const resultsRowElement = (index: number): HTMLElement | null =>
      searchListContainer.value?.querySelector<HTMLElement>(
        `[data-test="logs-search-result-logs-table"] [data-test="o2-table-row-${index}"]`,
      ) ?? null;

    const detailReturnFocus = (): HTMLElement | null => {
      const index = navigation().currentRowIndex;
      return index == null ? null : resultsRowElement(index);
    };

    // Re-setting the same text is not re-announced, so the region is emptied first.
    const announceInto = (region: typeof rowNavAnnouncement, message: string) => {
      region.value = "";
      nextTick(() => {
        region.value = message;
      });
    };

    const announce = (message: string) =>
      announceInto(
        searchObj.meta.showDetailTab ? detailNavAnnouncement : rowNavAnnouncement,
        message,
      );

    const announcePosition = (index: number) =>
      announce(
        t("logs.rowNav.position", {
          row: index + 1,
          count: hitsList().length,
          page: currentPage.value,
        }),
      );

    const scrollRowIntoView = (index: number) => {
      nextTick(() => resultsRowElement(index)?.scrollIntoView({ block: "nearest" }));
    };

    const clearRowSelection = () => {
      navigation().selectionActive = false;
      navigation().currentRowIndex = null;
    };

    /** The drawer's only writer (4a §3.2.7): snapshots the record and remounts DetailTable. */
    const openDetail = (
      target: { index: number } | { record: Record<string, any> },
      options: { origin?: "user" | "permalink" | "crossing"; tab?: string } = {},
    ): boolean => {
      let record: Record<string, any> | undefined;
      let index: number | null = null;
      if ("index" in target) {
        record = hitsList()[target.index];
        index = target.index;
      } else {
        record = target.record;
      }
      if (!record) return false;
      const origin = options.origin ?? "user";
      // The user's own row always wins over a shared line, pending or open (4c C5 step 6c).
      if (origin !== "permalink" && activePermalink.value) clearPermalink();
      detailIsShared.value = origin === "permalink";
      if (origin !== "crossing") navigation().pendingPageSelection = null;
      const tab =
        options.tab ?? (searchObj.meta.showDetailTab ? detailTableInitialTab.value : "json");
      detailRow.value = { ...record };
      navigation().currentRowIndex = index;
      detailOpenSeq.value += 1;
      detailTableInitialTab.value = tab;
      detailActiveTab.value = tab;
      searchObj.meta.showDetailTab = true;
      return true;
    };

    const onDetailTabChange = (tab: string) => {
      detailActiveTab.value = tab;
      if (tab === "json" || tab === "table") detailTableInitialTab.value = tab;
    };

    const isOtherDialogOpen = () =>
      Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]')).some(
        (el) => !el.matches('[data-test="logs-search-result-detail-dialog"]'),
      );

    const focusedResultsRow = (): number | null => {
      const active = document.activeElement as HTMLElement | null;
      const table = searchListContainer.value?.querySelector(
        '[data-test="logs-search-result-logs-table"]',
      );
      const row = active?.closest?.<HTMLElement>('[data-test^="o2-table-row-"]');
      if (!table || !row || !table.contains(row)) return null;
      const match = /^o2-table-row-(\d+)$/.exec(row.dataset.test ?? "");
      return match ? Number(match[1]) : null;
    };

    // Hover is never an anchor: it is pointer-incidental (4a §3.2 "Anchor").
    const resolveAnchor = (): number | null => {
      if (searchObj.meta.showDetailTab) return navigation().currentRowIndex ?? null;
      const focused = focusedResultsRow();
      if (focused !== null) return focused;
      if (navigation().selectionActive) return navigation().currentRowIndex ?? null;
      if (searchAroundShown()) {
        const ts = searchObj.data.searchAround.indexTimestamp;
        const index = hitsList().findIndex((hit) => hit[logsTimestampCol.value] === ts);
        return index >= 0 ? index : null;
      }
      return null;
    };

    const edgeMessage = (edge: "first" | "last", direction: 1 | -1): string => {
      const morePages =
        searchObj.meta.resultGrid.showPagination &&
        !searchAroundShown() &&
        (direction === 1 ? currentPage.value < pageCount.value : currentPage.value > 1);
      if (morePages && pageEdgeReason.value) return pageEdgeReason.value;
      return edge === "last" ? t("logs.rowNav.lastResult") : t("logs.rowNav.firstResult");
    };

    /** Paginator and J/K crossings share this; only a crossing keeps the open row (4a §3.2). */
    const changePage = (page: number, options: { fromCrossing?: boolean } = {}): boolean => {
      // The controls are disabled while locked; this also covers keyboard paths.
      if (gridLockReason.value) return false;
      const results = searchObj.data.queryResults;
      if (searchObj.meta.jobId != "" && results.paginations == undefined) results.pagination = [];
      const maxPages =
        searchObj.communicationMethod === "streaming" || searchObj.meta.jobId != ""
          ? results.pagination?.length
          : results?.partitionDetail?.paginations?.length;
      if (page > Math.ceil(maxPages) && searchObj.meta.jobId == "") {
        toast({ variant: "error", message: t("logs.searchResult.pageOutOfRange"), timeout: 1000 });
        pageNumberInput.value = searchObj.data.resultGrid.currentPage;
        return false;
      }
      if (!options.fromCrossing) resetRowSelection(searchObj);
      searchObj.data.resultGrid.currentPage = page;
      pageNumberInput.value = page;
      emit("update:scroll");
      scrollTableToTop(0);
      return true;
    };

    const startCrossing = (page: number, position: "first" | "last") => {
      crossingFromClosedDrawer = !searchObj.meta.showDetailTab;
      navigation().pendingPageSelection = { page, position, requestId: null };
      announce(t("logs.rowNav.loadingPageAnnouncement", { page }));
      const sent = changePage(page, { fromCrossing: true });
      // The dispatch is synchronous, so a still-unbound crossing here was never sent (4a §3.2 "Dispatch check").
      if (navigation().pendingPageSelection?.requestId === null) {
        failPendingPageNavigation(searchObj, { quiet: !sent });
      }
    };

    /** One J/K step, shared by the keys and the drawer's Prev/Next buttons. */
    const stepLogRow = (direction: 1 | -1, isRepeat = false) => {
      if (searchObj.meta.logsVisualizeToggle !== "logs") return;
      if (!hitsSettled() || navigation().pendingPageSelection) return;
      if (isOtherDialogOpen()) return;
      const hits = hitsList();
      if (!hits.length) return;
      if (searchObj.meta.showDetailTab && detailActiveTab.value.startsWith("correlated-")) return;
      const target = nextRowTarget({
        anchor: resolveAnchor(),
        count: hits.length,
        direction,
        page: currentPage.value,
        pageCount: pageCount.value,
        canChangePage: canChangePage.value,
        isRepeat,
      });
      if (target.kind === "select") {
        if (!openDetail({ index: target.index })) return;
        navigation().selectionActive = true;
        clearCorrelationState();
        scrollRowIntoView(target.index);
        announcePosition(target.index);
      } else if (target.kind === "page") {
        startCrossing(target.page, target.position);
      } else if (target.kind === "edge") {
        announce(edgeMessage(target.edge, direction));
      }
    };

    // A drawer close that coincides with this message is announced outside, once the dialog content is gone.
    const closeDrawerAnnouncing = (message: string) => {
      if (searchObj.meta.showDetailTab) {
        afterCloseAnnouncement = message;
        searchObj.meta.showDetailTab = false;
      } else {
        announceInto(rowNavAnnouncement, message);
      }
    };

    const failCrossing = (page: number, options: { quiet: boolean; cancelled?: boolean }) => {
      navigation().pendingPageSelection = null;
      clearRowSelection();
      if (options.cancelled) {
        closeDrawerAnnouncing("");
        return;
      }
      const message = t("logs.rowNav.pageFailed", { page });
      if (!options.quiet) toast({ variant: "error", message });
      closeDrawerAnnouncing(message);
    };

    const crossingTargetStillWanted = () => {
      if (searchObj.meta.logsVisualizeToggle !== "logs" || isOtherDialogOpen()) return false;
      if (!crossingFromClosedDrawer) return true;
      const active = document.activeElement;
      if (!active || active === document.body) return true;
      const table = searchListContainer.value?.querySelector(
        '[data-test="logs-search-result-logs-table"]',
      );
      return !!table?.contains(active) || active === scrollContainerRef.value;
    };

    const resolveCrossing = (pending: PendingPageSelection, load: PageLoad) => {
      if (!load.ok) {
        failCrossing(pending.page, { quiet: false, cancelled: load.reason === "cancelled" });
        return;
      }
      const hits = hitsList();
      if (!hits.length) {
        navigation().pendingPageSelection = null;
        clearRowSelection();
        closeDrawerAnnouncing(t("logs.rowNav.pageEmpty", { page: pending.page }));
        return;
      }
      const index = pending.position === "first" ? 0 : hits.length - 1;
      navigation().pendingPageSelection = null;
      if (crossingTargetStillWanted()) {
        openDetail({ index }, { origin: "crossing" });
        clearCorrelationState();
      } else {
        navigation().currentRowIndex = index;
      }
      navigation().selectionActive = true;
      scrollRowIntoView(index);
      nextTick(() => announcePosition(index));
    };

    // Sync: the error that fails a page also swaps the results for the error state, which unmounts this component.
    watch(
      () => searchObj.data.resultGrid.pageLoad,
      (load) => {
        const pending = navigation().pendingPageSelection ?? null;
        if (pending && acceptsPageLoad(pending, load ?? null)) resolveCrossing(pending, load!);
      },
      { flush: "sync" },
    );

    // Leaving Logs mode abandons a crossing; nothing reopens when its page lands (4a §3.2.2 "Cancel").
    watch(
      () => searchObj.meta.logsVisualizeToggle,
      (mode) => {
        if (mode !== "logs" && navigation().pendingPageSelection) resetRowSelection(searchObj);
      },
    );

    const onDetailDrawerAfterClose = () => {
      const message = afterCloseAnnouncement;
      afterCloseAnnouncement = null;
      if (navigation().currentRowIndex == null)
        scrollContainerRef.value?.focus({ preventScroll: true });
      if (message) nextTick(() => announceInto(rowNavAnnouncement, message));
    };

    const executedTrustworthy = () => {
      const executed = searchObj.meta.executed as
        { signature?: { sqlMode?: boolean }; req?: any } | null | undefined;
      const options = { timestampColumn: logsTimestampCol.value };
      return executed?.req
        ? trustworthyFields(
            {
              sqlMode: !!executed.signature?.sqlMode,
              encoding: executed.req.encoding,
              query: executed.req.query ?? {},
            },
            options,
          )
        : "all";
    };

    /** Keeps the open drawer on its row after a search replaced the hits (4a §3.2.7 "Row match"). */
    const rematchDetailRow = () => {
      const snapshot = detailRow.value;
      if (!snapshot) return;
      const options = { timestampColumn: logsTimestampCol.value };
      navigation().currentRowIndex = matchDetailRow(
        hitsList(),
        snapshot,
        executedTrustworthy(),
        options,
      );
    };

    /** Maps the shared line onto the loaded page: open-row highlight, scroll, and J/K resume from it (4c C5 row 7). */
    const mapSharedLine = () => {
      const record = detailRow.value;
      if (!record) return;
      const hits = hitsList();
      const snapshot: Record<string, any> = { ...record };
      // The resolve always carries _o2_id; a page whose projection dropped it must still match on content.
      if (!hits.some((hit) => hit?._o2_id !== undefined)) delete snapshot._o2_id;
      const options = { timestampColumn: logsTimestampCol.value };
      const index = matchDetailRow(hits, snapshot, executedTrustworthy(), options);
      navigation().currentRowIndex = index;
      permalinkRowIndex.value = index;
      if (index === null) return;
      navigation().selectionActive = true;
      scrollRowIntoView(index);
    };

    const stopHitsComplete = onHitsComplete((payload) => {
      if (payload.type !== "search" || navigation().pendingPageSelection) return;
      if (!searchObj.meta.showDetailTab || !detailRow.value) return;
      if (detailIsShared.value && sharedLineRecord.value) mapSharedLine();
      else rematchDetailRow();
    });

    // Opens the shared line whatever the first search is doing; a page already loaded maps at once.
    watch(
      sharedLineRecord,
      (record) => {
        if (!record) return;
        openDetail({ record }, { origin: "permalink", tab: "json" });
        const executed = searchObj.meta.executed as { complete?: boolean } | null | undefined;
        if (executed?.complete && hitsSettled() && hitsList().length) mapSharedLine();
      },
      { immediate: true },
    );

    // An explicit close of the drawer ends the shared line and drops log_* (4c C5 step 6a).
    const endSharedDetail = () => {
      if (detailIsShared.value) clearPermalink();
    };

    const onDetailUserClose = () => {
      searchObj.meta.showDetailTab = false;
      endSharedDetail();
    };

    searchResultMounts.value += 1;

    const stopPageNavFailure = setPageNavFailureHandler(({ quiet }) => {
      const pending = navigation().pendingPageSelection;
      if (pending) failCrossing(pending.page, { quiet });
    });

    onBeforeUnmount(() => {
      searchResultMounts.value = Math.max(0, searchResultMounts.value - 1);
      stopHitsComplete();
      stopPageNavFailure();
      // A failed page can swap the results for the error state before the drawer reports its close.
      if (afterCloseAnnouncement) announceInto(rowNavAnnouncement, afterCloseAnnouncement);
      afterCloseAnnouncement = null;
    });

    const addSearchTerm = (
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) => {
      const searchExpression = getFilterExpressionByFieldType(field, field_value, action);
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
      clearColumnsFromUrl();
      if (searchObj.data.stream.selectedFields.includes(fieldName)) {
        searchObj.data.stream.selectedFields = searchObj.data.stream.selectedFields.filter(
          (v: any) => v !== fieldName,
        );
      } else if (fieldName !== (store?.state?.zoConfig?.timestamp_column || "_timestamp")) {
        searchObj.data.stream.selectedFields.push(fieldName);
      }
      searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    const copyLogToClipboard = (log: any, copyAsJson: boolean = true) => {
      const copyData = copyAsJson ? JSON.stringify(log) : log;
      copyToClipboard(copyData, t, {
        successMessage: t("logs.searchResult.contentCopied"),
        timeout: 1000,
      });
    };

    const redirectToTraces = (log: any) => {
      // Guard: a caller that loses the record used to crash here on
      // `log[timestamp_column]` (issue #13708). Tell the user instead of
      // leaving a button that silently does nothing.
      if (!log) {
        toast({
          variant: "warning",
          message: t("search.viewTraceUnavailable"),
        });
        return;
      }

      router.push(traceDetailsLocation(log, store.state, searchObj.meta.selectedTraceStream));
    };

    const getTableWidth = computed(() => {
      const leftSidebarMenu = 56;
      const fieldList =
        (window.innerWidth - leftSidebarMenu) * (searchObj.config.splitterModel / 100);
      return window.innerWidth - (leftSidebarMenu + fieldList) - 5;
    });

    const scrollTableToTop = (value: number) => {
      scrollContainerRef.value?.scrollTo({ top: value });
    };

    const getColumns = computed<OTableColumnDef<any>[]>(() => {
      return ((searchObj.data?.resultGrid?.columns as any[]) ?? []).filter((col: any) => !!col.id);
    });

    const hasResultRows = computed(() => (searchObj.data.queryResults?.hits?.length ?? 0) > 0);
    // First paint has nothing to show, so the skeleton is right; once rows exist we switch to `streaming` so partial results stay on screen.
    const isResultsSkeleton = computed(() => searchObj.loading && !hasResultRows.value);
    const isResultsStreaming = computed(() => searchObj.loading && hasResultRows.value);

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
    const SKELETON_HEIGHTS = [
      45, 72, 58, 88, 62, 42, 78, 52, 73, 38, 68, 83, 48, 68, 44, 92, 62, 38, 72, 56, 32, 82, 48,
      64, 38, 88, 68, 44, 78, 52, 40, 95, 55, 70, 30, 85, 65, 50, 75, 42,
    ];
    const skeletonBarHeights = Array.from({ length: 250 }, (_, i) => ({
      id: i,
      pct: SKELETON_HEIGHTS[i % SKELETON_HEIGHTS.length],
    }));

    const sendToAiChat = (value: any, append: boolean = true) => {
      emit("sendToAiChat", value, append);
    };

    const closeTable = () => {
      searchObj.meta.showDetailTab = false;
      endSharedDetail();
      // Clear correlation data when closing sidebar so it doesn't persist to next "row"
      correlationDashboardProps.value = null;
      correlationLoading.value = false;
      correlationError.value = null;
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
          // A shared link's columns, including [], are rendered as given (4c C7).
          if (columnsFromUrl.value) return;
          // Only the system may overwrite a column the system itself picked.
          // isFtsDefaultColumn is the authoritative "current columns are a system
          // pick" signal: it is true only when this watcher set the columns, and
          // is cleared the moment the user takes any explicit column action (pin,
          // toggle, remove, reset). So we re-evaluate the FTS default ONLY when
          // there is no selection at all, or the existing selection is a prior
          // system pick. A user-chosen selection (flag false, non-empty) — even
          // if it happens to be FTS fields like "message" — is left untouched.
          const currentFields = searchObj.data.stream.selectedFields;
          const canResolveDefault = !currentFields.length || searchObj.meta.isFtsDefaultColumn;
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
        // The patterns list shares its scroller with the rest of the view, so a re-run must land on row 1 rather than inherit the previous offset
        if (loading && !wasLoading) {
          scrollTableToTop(0);
        }
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
          // Esc or × during a crossing cancels it; the page still lands but nothing reopens (AC2.8).
          if (navigation().pendingPageSelection) resetRowSelection(searchObj);
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

    // ── Logs-grid rendering ───────────────────────────────────────────────────
    // `processHitsInChunks` builds a per-(column, rowIndex) map of colorized HTML
    // that the cell slots render via v-html.
    const { processedResults, processHitsInChunks } = useLogsHighlighter(t);

    const isFunctionErrorOpen = ref(false);

    const logsTimestampCol = computed(() => store.state.zoConfig.timestamp_column || "_timestamp");

    // `source` (whole-row JSON) is not closable but still gets copy; AI stays on the timestamp cell.
    const showLogCellActions = (column: any, row: any) =>
      column.meta?.closable ? row[column.id] != null : column.id === "source";

    // ── Right-click cell actions ──────────────────────────────────────────────
    // The cell the user last right-clicked, held as plain values (not the
    // TanStack cell) so the menu keeps rendering correctly even if the
    // virtualizer recycles the row underneath it.
    interface ContextCell {
      columnId: string;
      value: unknown;
      row: Record<string, unknown>;
    }

    const contextCell = ref<ContextCell | null>(null);
    const menuLinkAnchor = ref<{ x: number; y: number } | null>(null);
    const { lineLinkState, copyLineLink } = useLogLineLink();
    const contextLineLink = computed<LineLinkState>(() =>
      contextCell.value ? lineLinkState(contextCell.value.row) : { kind: "hidden" },
    );

    const contextCellIsStreamField = computed(() => {
      const columnId = contextCell.value?.columnId;
      if (!columnId) return false;
      return isFilterableLogField(columnId, searchObj.data.stream.selectedStreamFields);
    });

    // Mirrors O2AIContextAddBtn's own gate — the AI actions only exist on
    // enterprise builds with AI turned on in the backend config.
    const aiEnabled = computed(
      () => config.isEnterprise === "true" && !!store.state.zoConfig.ai_enabled,
    );

    const toSearchTermValue = (value: unknown): string | number | boolean => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (value === null || value === undefined) return "null";
      return JSON.stringify(value);
    };

    // Capture-phase gate on the whole table, so it runs before the cell's own
    // handler. Only data cells offer actions — right-clicking a header or the
    // expanded JSON row (which has its own menu) would otherwise open an empty
    // one. reka-ui checks `defaultPrevented` before opening, so preventing here
    // suppresses it.
    const DATA_CELL_SELECTOR = "td[data-test^='o2-table-cell-']";

    const handleTableContextMenu = (event: MouseEvent) => {
      contextCell.value = null;
      menuLinkAnchor.value = { x: event.clientX, y: event.clientY };
      const target = event.target;
      if (!(target instanceof Element) || !target.closest?.(DATA_CELL_SELECTOR)) {
        event.preventDefault();
      }
    };

    // Records which cell the right-click landed on. OTableBodyCell emits this
    // from the td, so it fires before OContextMenu's own handler on the trigger.
    const handleCellContextMenu = (params: { columnId: string; row: any; value: any }) => {
      contextCell.value = {
        columnId: params.columnId,
        value: params.value,
        row: (params.row ?? {}) as Record<string, unknown>,
      };
    };

    // Drop the reference once the menu closes so a recycled virtual row can't be
    // held alive by a stale row object.
    // While the context menu is open the hover overlay offers the same actions, so
    // the two would sit on screen at once. Track open state and hide the overlay.
    const contextMenuOpen = ref(false);

    const onContextMenuOpenChange = (open: boolean) => {
      contextMenuOpen.value = open;
      if (!open) contextCell.value = null;
    };

    // Row object → its original index in hits; the highlight cache, detail
    // sidebar and expansion are all keyed by that index.
    const logsHitIndexMap = computed(() => {
      const m = new Map<any, number>();
      (searchObj.data.queryResults?.hits || []).forEach((h: any, i: number) => m.set(h, i));
      return m;
    });
    const logsRowIndex = (row: any): number => logsHitIndexMap.value.get(row) ?? -1;
    const logsCellHtml = (columnId: string, row: any): string | null => {
      const idx = logsRowIndex(row);
      if (idx < 0) return null;
      return (processedResults.value as any)[`${columnId}_${idx}`] ?? null;
    };

    const reprocessLogsHighlight = (clearCache: boolean) => {
      processHitsInChunks(
        searchObj.data.queryResults?.hits || [],
        (getColumns.value as any[]) || [],
        clearCache,
        searchObj.data.highlightQuery || "",
        100,
        selectedStreamFullTextSearchKeys.value,
      );
    };
    // `immediate` so a mount with results already present still highlights them.
    // `clearCache: true` is load-bearing: updateGridColumns() reassigns the columns on every streaming chunk, and this is the only path that drops the previous partition's highlighted HTML for a reused row index.
    watch(
      () => getColumns.value,
      () => reprocessLogsHighlight(true),
      {
        immediate: true,
      },
    );
    watch(
      () => searchObj.data.queryResults?.hits,
      () => reprocessLogsHighlight(false),
    );

    const { rowSeverity } = useLogSeverity();
    const getLogRowStatusColor = (row: any): string => severityIndicatorColor(rowSeverity(row));
    const logRowSeveritySrText = (row: any) => {
      const severity = rowSeverity(row);
      const level = t(`logs.severity.levels.${severity.level}`);
      return severity.source === "message"
        ? t("logs.severity.srTextInferred", { level })
        : t("logs.severity.srText", { level });
    };

    // "Search around" highlight, applied as a class (not an inline style) so the
    // row-hover utility still wins on hover.
    const getLogRowClass = (row: any): string => {
      const classes: string[] = [];
      const ts = searchObj.data?.searchAround?.indexTimestamp;
      if (ts != null && ts !== -1 && row[logsTimestampCol.value] === ts) {
        classes.push("bg-table-row-selected-bg");
      }
      // Ambiguous timestamp link: every loaded row at that µs, without the open-row ring (DECISIONS S-C3).
      const sharedTs = permalinkHighlightTs.value;
      const sharedStream = activePermalink.value?.link.stream;
      if (
        sharedTs !== null &&
        Number(row[logsTimestampCol.value]) === sharedTs &&
        (row._stream_name === undefined || row._stream_name === sharedStream)
      ) {
        classes.push("bg-table-row-selected-bg o2-log-permalink-match");
      }
      if (
        activePermalink.value &&
        permalinkRowIndex.value !== null &&
        logsRowIndex(row) === permalinkRowIndex.value
      ) {
        classes.push("o2-log-permalink-row");
      }
      // Carries the detected severity for the status spine, which is otherwise
      // only readable as a colour.
      classes.push(severityRowClass(rowSeverity(row)));
      return classes.join(" ");
    };

    // Row identity is the hit's position, NOT its `_timestamp`: a timestamp
    // repeats across hits ingested in the same batch (an enrichment table gives
    // every row the upload time), and keying on it expanded every row sharing
    // the value off a single click. The parent already tracks `expandedLogs` as
    // hit indices, so use those directly.
    const logsRowKey = (row: any): string => String(logsRowIndex(row));
    const expandedLogIds = computed<string[]>(() =>
      ((props.expandedLogs as number[]) || []).map(String),
    );
    const onExpandedLogIdsChange = (newIds: string[]) => {
      const prev = new Set(expandedLogIds.value);
      const next = new Set(newIds);
      let toggled: string | null = null;
      for (const k of next)
        if (!prev.has(k)) {
          toggled = k;
          break;
        }
      if (toggled == null)
        for (const k of prev)
          if (!next.has(k)) {
            toggled = k;
            break;
          }
      if (toggled == null) return;
      const idx = Number(toggled);
      if (Number.isInteger(idx) && idx >= 0) expandLog(idx);
    };

    const openLogDetailsByRow = (row: any) => openLogDetails(row, logsRowIndex(row));

    return {
      noFtsRecoverySchemas,
      noFtsRecoveryTerm,
      gridLockReason,
      activeRowIndex,
      pageCount,
      canChangePage,
      hasPrevPage,
      hasNextPage,
      pageLoadingDirection,
      navDisabledReason,
      pageEdgeReason,
      drawerSubTitle,
      detailReturnFocus,
      onDetailDrawerAfterClose,
      detailRow,
      detailIsShared,
      endSharedDetail,
      onDetailUserClose,
      contextLineLink,
      copyLineLink,
      menuLinkAnchor,
      detailOpenSeq,
      detailActiveTab,
      onDetailTabChange,
      openDetail,
      stepLogRow,
      changePage,
      rowNavAnnouncement,
      detailNavAnnouncement,
      raw,
      isDark,
      isMobile,
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
      histogramPinStyle,
      searchAroundData,
      addSearchTerm,
      removeSearchTerm,
      logsTimestampCol,
      showLogCellActions,
      logsCellHtml,
      logsRowIndex,
      logsRowKey,
      getLogRowStatusColor,
      getLogRowClass,
      logRowSeveritySrText,
      expandedLogIds,
      onExpandedLogIdsChange,
      openLogDetailsByRow,
      isFunctionErrorOpen,
      contextCell,
      contextCellIsStreamField,
      aiEnabled,
      toSearchTermValue,
      handleTableContextMenu,
      handleCellContextMenu,
      onContextMenuOpenChange,
      contextMenuOpen,
      histogramChart,
      histogramChartWrap,
      pinnedTooltip,
      closePinnedTooltip,
      onHistogramAreaClick,
      applyPinnedFilter,
      formatCount,
      openLogDetails,
      changeMaxRecordToReturn,
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
      hasResultRows,
      isResultsSkeleton,
      isResultsStreaming,
      reorderSelectedFields,
      getPaginations,
      refreshPagination,
      refreshJobPagination,
      skeletonBarHeights,
      sendToAiChat,
      closeTable,
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
      openPatternDetails,
      navigatePatternDetail,
      patternNavTotal,
      patternVolumeContext,
      patternWindowTotal,
      addPatternToSearch,
      addWildcardValueToSearch,
      createAlertFromPattern,
      extractConstantsFromPattern,
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
      const hasSelection = this.histogramSelectionRange.start && this.histogramSelectionRange.end;
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

<style scoped>
/* keep(lib-override:logs-cell-font): the monospace log-cell font. Body cells are
   rendered by OTableBodyCell, so the rule must reach them through :deep(), and it
   is scoped to the DATA cells so the expanded row keeps its own typography. */
.logs-results-otable :deep(td[data-test^="o2-table-cell-"]) {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  /* Cap the line box so a single log line can't grow the row height. */
  line-height: 1.125rem;
}

/* The default expand button sets a floor under every log row height
   regardless of :row-height, which costs a line per screen. Sized to fill its
   cell rather than shrunk to the glyph, so the whole cell is clickable — a
   glyph-sized target is easy to miss near its edges. */
.logs-results-otable :deep([data-test^="o2-table-expand-"]) {
  height: 1.25rem !important;
  /* Definite width matching the w-4 expand cell — NOT 100%: a percent-width
     child inside the auto-layout table is circular, and Chromium resolves it
     by inflating the table to its 500000-pixel cap, pushing all data off-screen. */
  width: 1rem !important;
  min-height: 0 !important;
}
.logs-results-otable :deep([data-test^="o2-table-expand-"] svg) {
  width: 0.875rem !important;
  height: 0.875rem !important;
}

/* The shared expanded-row fill reads as a grey slab against the dense log rows,
   which is not how the logs grid looked before. Keep the normal cell surface. */
.logs-results-otable :deep([data-test^="o2-table-expanded-row-"]) {
  background-color: var(--color-table-cell-bg);
}

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
  border-radius: var(--radius-surface);
  box-shadow: var(--shadow-lg);
  padding: 0.5rem 0;
  font-size: var(--text-xs);
  outline: none;
}

.oo-pin-tooltip__time {
  font-size: var(--text-2xs);
  font-weight: 500;
  opacity: 0.65;
  padding: 0 0.625rem 0.25rem;
  margin-bottom: 0;
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom */
  border-bottom: 1px solid color-mix(in srgb, var(--color-grey-500) 15%, transparent);
}

.oo-pin-tooltip__row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.0625rem 0.625rem;
  transition: background 0.1s;

  &:hover {
    background: color-mix(in srgb, var(--color-grey-500) 12%, transparent);
  }
}

.oo-pin-tooltip__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.oo-pin-tooltip__name {
  flex: 1;
  white-space: nowrap;
}

.oo-pin-tooltip__count {
  font-weight: 600;
  min-width: 2rem;
  text-align: right;
  transition: opacity 0.1s;
}

.oo-pin-tooltip__row-actions {
  display: flex;
  gap: 0.1875rem;
  flex-shrink: 0;
  margin-left: 0.25rem;
}

.oo-pin-tooltip__action {
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
}

.oo-pin-tooltip__action--include {
  background: color-mix(in srgb, var(--color-status-info-text) 12%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--color-status-info-text) 25%, transparent);
  }
}

.oo-pin-tooltip__action--exclude {
  background: color-mix(in srgb, var(--color-status-error-text) 8%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--color-status-error-text) 20%, transparent);
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
}

/* keep(deep-nesting): without lang="scss", Vue's scoped compiler doesn't flatten a
   nested :deep() with its parent selector, so it silently never matches — keep these
   top-level instead of nested inside .paginator-section/.select-pagination. */
.paginator-section :deep(.o-pagination__btn) {
  padding: 0.125rem 0.25rem !important;
  height: 1.5rem !important;
  min-height: 1.5rem !important;
  min-width: 1.5rem !important;
  font-size: var(--text-xs) !important;
  border-radius: 0.25rem !important;
  line-height: 1rem !important;
}

.paginator-section :deep(.o-pagination__btn) svg {
  width: 1rem !important;
  height: 1rem !important;
}

.select-pagination {
  position: relative;
  width: 4rem !important;
  height: 1.5rem !important;
  margin-top: 0;
}

.select-pagination :deep(button) {
  height: 1.5rem !important;
  min-height: 1.5rem !important;
  font-size: var(--text-xs) !important;
  padding-inline: 0.5rem !important;
}
/* keep(keyframes): the histogram skeleton's shimmer @keyframes and the
   animation: that references it must stay in the same scoped block so Vue
   renames both consistently. */
.histogram-container {
  border-radius: 0.5rem;
  position: relative;
}

/* Pinned along X only: still scrolls away with the log lines, but stays put
   when the wide results table scrolls sideways. */
.histogram-container--pinned-x {
  position: sticky;
  left: 0;
  z-index: 1;
}

.histogram-container--visible {
  height: 6.25rem;
  padding-top: 0.25rem;
  opacity: 1;
  transition: all 0.3s ease-in-out;
}

.histogram-container--hidden {
  height: 0;
  opacity: 0;
  overflow: hidden;
  transition: all 0.3s ease-in-out;
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
}

.histogram-empty__message {
  min-height: 2rem;
}

.histogram-skeleton {
  --hsk-bar: var(--color-grey-100);
  --hsk-shimmer: color-mix(in srgb, var(--color-white) 65%, transparent);

  .dark & {
    --hsk-bar: var(--color-grey-700);
    --hsk-shimmer: color-mix(in srgb, var(--color-white) 6%, transparent);
  }

  height: 6.25rem;
  display: flex;
  flex-direction: column;
  padding-top: 0.25rem;
  overflow: hidden;
}

.histogram-skeleton__main {
  flex: 1;
  display: flex;
  min-height: 0;
}

.histogram-skeleton__y-axis {
  width: 2.25rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  padding-right: 0.3125rem;
  padding-bottom: 0.125rem;
}

.histogram-skeleton__y-label {
  height: 0.4375rem;
  border-radius: 0.125rem;
  background-color: var(--hsk-bar);
}

.histogram-skeleton__plot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.histogram-skeleton__bars {
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
      transparent 0%,
      transparent 20%,
      var(--hsk-shimmer) 50%,
      transparent 80%,
      transparent 100%
    );
    animation: histogram-bar-shimmer 1.6s ease-in-out infinite;
    pointer-events: none;
  }
}

.histogram-skeleton__bar {
  flex: 0 0 0.4375rem;
  flex-shrink: 0;
  border-radius: 0.0625rem 0.0625rem 0 0;
  background-color: var(--hsk-bar);
}

.histogram-skeleton__x-axis {
  display: flex;
  justify-content: space-between;
  padding-left: 2.25rem;
  padding-top: 0.1875rem;
}

.histogram-skeleton__x-label {
  width: 2.25rem;
  height: 0.4375rem;
  border-radius: 0.125rem;
}

@keyframes histogram-bar-shimmer {
  from {
    left: -100%;
  }
  to {
    left: 100%;
  }
}

.histogram-error {
  margin: 0.5rem 0;
  border-radius: 0.5rem;
}

.histogram-error__message {
  min-height: 2rem;
}
</style>
