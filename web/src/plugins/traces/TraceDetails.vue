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

<template>
  <div class="trace-details tw:h-[calc(100vh-2.625rem)]">
    <!-- Original View -->
    <div
      class="trace-details-content"
      v-if="
        traceTree.length &&
        effectiveSpanList.length &&
        !(
          searchObj.data.traceDetails.isLoadingTraceDetails ||
          searchObj.data.traceDetails.isLoadingTraceMeta
        )
      "
    >
      <div v-if="showHeader" class="trace-combined-header-wrapper card-container tw:border-b tw:border-border-default">
        <!-- New Modern Header -->
        <header
          class="tw:h-auto tw:py-[0.125rem] tw:flex! tw:items-center tw:justify-between tw:bg-[var(--o2-surface)] tw:pl-1"
        >
          <div class="tw:flex tw:items-center tw:space-x-4 tw:w-fit!">
            <!-- Back button -->
            <OButton
              v-if="mode === 'standalone' && showBackButton"
              data-test="trace-details-back-btn"
              variant="ghost-muted"
              size="icon-xs"
              class="tw:mr-1.5"
              @click="handleBackOrClose"
            >
              <OIcon name="arrow-back" size="sm" />
              <OTooltip :content="areFiltersAdded ? t('traces.applyPendingFilters') : t('traces.backToTraces')" />
            </OButton>

            <div
              class="tw:flex tw:min-w-0 tw:w-full tw:gap-[0.625rem]! tw:items-center"
            >
              <!-- Operation Name -->
              <div
                data-test="trace-details-operation-name"
                class="tw:text-base tw:font-semibold tw:leading-tight tw:text-[var(--o2-text-primary)] tw:truncate tw:min-w-0 tw:max-w-[24rem]!"
                :title="traceTree[0]?.operationName"
              >
                {{ traceTree[0]?.operationName || t("traces.loadingTrace") }}
                <OTooltip :content="traceTree[0]?.operationName" />
              </div>

              <!-- Service, Timestamp, and Trace ID -->
              <div
                class="tw:flex tw:items-center tw:space-x-2 tw:text-[11px] tw:text-[var(--o2-text-secondary)] tw:whitespace-nowrap"
              >
                <span>{{ formatTimestamp(traceStartTime) }}</span>
                <div
                  class="tw:bg-[var(--o2-text-3)] tw:py-[0rem] tw:w-[1px] tw:h-[16px]"
                />
                <span class="tw:mr-[0.25rem]">
                  {{ t("traces.traceId") }}:
                  <span
                    v-if="mode === 'embedded'"
                    data-test="trace-details-trace-id"
                    class="tw:text-[var(--o2-text-primary)] tw:font-mono tw:cursor-pointer hover:tw:text-[var(--o2-theme-color)] tw:transition-colors"
                    :title="t('traces.openInTraces')"
                    @click="handleExpandToFullView"
                  >
                    {{ effectiveTraceId }}
                  </span>
                  <span
                    v-else
                    data-test="trace-details-trace-id"
                    class="tw:text-[var(--o2-text-primary)] tw:font-mono"
                    :title="effectiveTraceId"
                  >
                    {{ effectiveTraceId }}
                  </span>
                </span>

                <!-- Copy Trace ID Button -->
                <OIcon
                  data-test="trace-details-copy-trace-id-btn"
                  name="content-copy"
                  size="xs"
                  class="tw:cursor-pointer hover:tw:text-[var(--o2-text-primary)]"
                  :title="t('traces.copyTraceId')"
                  @click="copyTraceId"
                />

                <!-- Session ID (LLM traces) -->
                <template v-if="sessionId">
                  <div
                    class="tw:bg-[var(--o2-text-3)] tw:py-[0rem] tw:w-[1px] tw:h-[16px]"
                  />
                  <span class="tw:mr-[0.25rem]">
                    Session ID:
                    <span
                      data-test="trace-details-session-id"
                      class="tw:text-[var(--o2-text-primary)] tw:font-mono"
                      :title="sessionId"
                    >
                      {{ sessionId }}
                    </span>
                  </span>
                  <OIcon
                    data-test="trace-details-copy-session-id-btn"
                    name="content-copy"
                    size="xs"
                    class="tw:cursor-pointer hover:tw:text-[var(--o2-text-primary)]"
                    title="Copy Session ID"
                    @click="copySessionId"
                  />
                </template>

                <!-- Open in new icon (embedded mode only) -->
                <OIcon
                  v-if="mode === 'embedded' && showExpandButton"
                  data-test="trace-details-trace-id-open-btn"
                  class="tw:cursor-pointer hover:tw:text-[var(--o2-theme-color)]"
                  size="xs"
                  name="open-in-new"
                  :title="t('traces.openInTraces')"
                  @click="handleExpandToFullView"
                />
              </div>

              <div
                class="tw:bg-[var(--o2-text-3)] tw:py-[0rem] tw:w-[1px] tw:h-[16px]"
              />
              <!-- Span Count Badge -->
              <div
                data-test="trace-details-spans-count"
                class="tw:flex tw:items-center tw:ml-[0rem] tw:space-x-1 tw:px-[0.625rem] tw:py-[0.1rem] tw:rounded tw:text-[0.75rem] tw:text-[var(--o2-text-4)] tw:bg-[var(--o2-tag-grey-1)]"
              >
                <span data-test="span-count-text">
                  {{ formatLargeNumber(effectiveSpanList.length) }}
                  {{ t("traces.spansLabel") }}
                  <OTooltip :content="effectiveSpanList.length + ' ' + t('traces.spansLabel')" />
                </span>
              </div>

              <div
                class="tw:bg-[var(--o2-text-3)] tw:py-[0rem] tw:w-[1px] tw:h-[16px]"
              />

              <!-- Error Count Badge -->
              <div
                data-test="trace-details-error-spans-count"
                class="tw:flex tw:items-center tw:space-x-1 tw:px-[0.625rem] tw:py-[0.1rem] tw:rounded tw:text-[0.75rem] tw:text-[var(--o2-error-tag-text)] tw:bg-[var(--o2-error-tag-bg)] tw:mr-[0.85rem]"
              >
                <span
                  >{{ formatLargeNumber(errorSpansCount) }}
                  {{ t("traces.errorsLabel") }}</span
                >
                <OTooltip :content="errorSpansCount + ' ' + t('traces.errorsLabel')" />
              </div>
            </div>
          </div>

          <div
            class="tw:flex tw:justify-end tw:items-center tw:space-x-3 tw:w-fit!"
          >
            <!-- Apply filters button (standalone mode, right side) -->
            <OButton
              v-if="mode === 'standalone' && areFiltersAdded"
              data-test="trace-details-apply-filters-btn-right"
              variant="outline"
              size="xs"
              class="tw:mr-2.5"
              @click="openFilterPopover"
            >
              <template #icon-left
                ><OIcon name="filter-alt"
size="xs"
              /></template>
              <span class="tw:text-[0.75rem]">{{ t("traces.viewFilters") }}</span>
              <OTooltip :content="t('traces.reviewAndApplyFilters')" />
            </OButton>

            <!-- Expand button (embedded mode) -->
            <OButton
              v-if="mode === 'embedded' && showExpandButton"
              data-test="trace-details-expand-btn"
              variant="outline"
              size="icon-xs"
              @click="handleExpandToFullView"
            >
              <OIcon name="open-in-new" size="sm" />
              <OTooltip :content="t('traces.openInTraces')" />
            </OButton>

            <!-- Share button (standalone mode) -->
            <share-button
              v-if="mode === 'standalone' && showShareButton"
              data-test="trace-details-share-link-btn"
              :url="traceDetailsShareURL"
              variant="outline"
              buttonClass="tw:mr-1!"
              size="icon-xs"
            />

            <!-- Close button -->
            <OButton
              v-if="mode === 'standalone' && showCloseButton"
              data-test="trace-details-close-btn"
              variant="ghost"
              size="icon-xs"
              class="tw:mr-1!"
              @click="handleBackOrClose"
            >
              <OIcon name="close" size="sm" />
              <OTooltip :content="t('common.cancel')" />
            </OButton>
          </div>
        </header>
      </div>
      <div
        class="card-container tw:overflow-hidden tw:h-full"
        style="display: flex; flex-direction: column; min-height: 0"
      >
        <!-- Tabs & Search Bar -->
        <div
          class="tw:py-0 tw:border-b tw:border-[var(--o2-border)] tw:flex tw:items-center tw:justify-between tw:bg-white tw:bg-[var(--o2-card-bg)]!"
        >
          <div
            class="tw:flex tw:items-center tw:space-x-4 trace-details-view-tabs tw:ml-[0.325rem] tw:py-[0.325rem]"
          >
            <OToggleGroup
              :model-value="activeTab"
              @update:model-value="updateActiveTab"
            >
              <OToggleGroupItem value="waterfall" size="sm">
                <template #icon-left
                  ><OIcon name="align-left" size="sm" class="tw:shrink-0"
                /></template>
                Waterfall
              </OToggleGroupItem>
              <OToggleGroupItem value="flame-graph" size="sm">
                <template #icon-left>
                  <OIcon name="flame" size="sm" />
                </template>
                Flame Graph
              </OToggleGroupItem>
              <OToggleGroupItem value="map" size="sm">
                <template #icon-left
                  ><OIcon name="account-tree" size="sm" class="tw:shrink-0"
                /></template>
                Trace Graph
              </OToggleGroupItem>
              <OToggleGroupItem v-if="hasLLMSpans"
value="dag"
size="sm">
                <template #icon-left>
                  <OIcon name="git-branch" size="sm" />
                </template>
                DAG
              </OToggleGroupItem>
              <!--
                Thread tab gated on:
                  1. `VITE_SHOW_LLM_UI` env flag is NOT explicitly set
                     to `"false"`. Unset / any other value keeps the
                     feature visible.
                  2. The trace actually has LLM spans worth rendering
                     as a chat (`hasLLMSpans`).
              -->
              <OToggleGroupItem
                v-if="config.showLLMUI !== 'false' && hasLLMSpans"
                value="thread"
                size="sm"
                data-test="trace-details-thread-tab"
              >
                <template #icon-left
                  ><OIcon name="chat" size="xs" class="tw:shrink-0"
                /></template>
                Thread
              </OToggleGroupItem>
            </OToggleGroup>
          </div>

          <div class="tw:flex tw:items-center tw:space-x-2 tw:gap-[0.5rem] tw:pr-[0.325rem]">
            <!-- Unified Search Input Group -->
            <div
              v-if="
                activeTab !== 'flame-graph' &&
                activeTab !== 'map' &&
                activeTab !== 'thread'
              "
              class="unified-search-group tw:mr-1! tw:gap-1 tw:flex tw:items-center"
            >
              <div class="log-stream-search-input">
                <OSearchInput
                  v-model="searchQuery"
                  data-test="trace-details-search-input"
                  :placeholder="t('traces.searchInSpans')"
                  clearable
                  size="sm"
                  class="tw:text-[12px]!"
                  @update:model-value="handleSearchQueryChange"
                />
              </div>
              <!-- Search Results Navigation -->
              <div class="search-navigation-container tw:h-8.2! tw:py-[0.125px]!">
                <div
                  class="search-results-counter"
                  data-test="trace-details-search-results"
                >
                  <span class="counter-current">{{
                    searchResults ? currentIndex + 1 : 0
                  }}</span>
                  <span class="counter-separator">/</span>
                  <span class="counter-total">{{ searchResults }}</span>
                </div>
                <div class="navigation-buttons">
                  <OButton
                    data-test="trace-details-search-prev-btn"
                    :disabled="!searchResults || currentIndex === 0"
                    variant="ghost-muted"
                    size="icon"
                    @click="prevMatch"
                  >
                    <OIcon name="keyboard-arrow-up" size="sm" />
                    <OTooltip :content="t('traces.previousMatch')" />
                  </OButton>
                  <div class="button-separator"></div>
                  <OButton
                    data-test="trace-details-search-next-btn"
                    :disabled="
                      !searchResults || currentIndex + 1 === searchResults
                    "
                    variant="ghost-muted"
                    size="icon"
                    @click="nextMatch"
                  >
                    <OIcon name="keyboard-arrow-down" size="sm" />
                    <OTooltip :content="t('traces.nextMatch')" />
                  </OButton>
                </div>
              </div>
            </div>
            <!-- Log Stream Selector (if enabled) -->
            <div
              v-if="showLogStreamSelector && config.isEnterprise !== 'true'"
              class="log-stream-search-input tw:flex tw:items-center trace-logs-selector tw:mx-1!"
            >
              <OSelect
                data-test="trace-details-log-streams-select"
                v-model="searchObj.data.traceDetails.selectedLogStreams"
                :placeholder="t('search.selectLogStream')"
                :options="filteredStreamOptions"
                multiple
                :title="selectedStreamsString"
                class="tw:w-44!"
              />
              <span class="traces-view-logs-btn tw:pl-1">
                <!-- Single button with wrapper for tooltip functionality -->
                <span
                  class="tw:inline-block"
                  tabindex="0"
                >
                  <OButton
                    data-test="trace-details-view-logs-btn"
                    variant="outline"
                    size="sm"
                    class="tw:text-[0.75rem] tw:h-8! tw:font-normal!"
                    :disabled="isViewLogsDisabled"
                    @click="redirectToLogs"
                  >
                    <template #icon-left
                      ><OIcon name="search" size="xs"
                    /></template>
                    {{
                      searchObj.meta.redirectedFromLogs
                        ? t("traces.backToLogs")
                        : t("traces.viewLogs")
                    }}
                  </OButton>
                  <OTooltip
                    :content="isViewLogsDisabled ? t('search.selectLogsStreamFirst') : t('traces.viewLogs')"
                  />
                </span>
              </span>
            </div>
            <OButton
                v-if="hasRumSessionId && !hideSessionReplayButton"
                data-test="trace-details-view-session-replay-btn"
                variant="outline"
                size="sm"
                class="tw:ml-1"
                @click="redirectToSessionReplay"
              >
                <template #icon-left>
                  <OIcon name="play-circle" size="sm"/>
                </template>
                {{ t("rum.playSessionReplay") }}
            </OButton>
          </div>
        </div>
        <div
          class="histogram-spans-container"
          :class="[
            isSidebarOpen ? 'histogram-container' : 'histogram-container-full',
            isTimelineExpanded ? '' : 'full',
          ]"
          ref="parentContainer"
        >
          <div class="trace-tree-wrapper">
            <!-- Waterfall View - show for waterfall tab, or when no LLM spans -->
            <div
              v-if="activeTab === 'waterfall'"
              class="tw:flex tw:h-full tw:bg-[var(--o2-card-bg)]!"
            >
              <div
                class="tw:flex tw:flex-col tw:min-h-0"
                :style="{
                  width: isSidebarOpen ? leftWidth + 'px' : '100%',
                }"
              >
                <trace-header
                  data-test="trace-details-header"
                  :baseTracePosition="baseTracePosition"
                  :splitterWidth="leftWidth"
                  :isSidebarOpen="
                    Boolean(
                      isSidebarOpen && (selectedSpanId || showTraceDetails),
                    )
                  "
                  @resize-start="startResize"
                />
                <div
                  ref="traceScrollContainer"
                  class="relative-position trace-content-scroll"
                  :style="{
                    width: isSidebarOpen ? leftWidth + 'px' : '100%',
                  }"
                >
                  <div
                    class="trace-tree-container tw:bg-[var(--o2-card-bg)]!"
                    data-test="trace-details-tree-container"
                  >
                    <div class="position-relative">
                      <div
                        data-test="trace-details-resizer"
                        :style="{
                          left: `${leftWidth}px`,
                          backgroundColor:
                            store.state.theme === 'dark'
                              ? '#3c3c3c'
                              : '#ececec',
                          zIndex: 999,
                        }"
                        class="tw:absolute resize tw:h-full tw:cursor-col-resize tw:top-0 tw:w-[1px]"
                        @mousedown="startResize"
                      />
                      <trace-tree
                        data-test="trace-details-tree"
                        :collapseMapping="collapseMapping"
                        :spans="spanPositionList"
                        :baseTracePosition="baseTracePosition"
                        :spanDimensions="spanDimensions"
                        :spanMap="spanMap"
                        :leftWidth="leftWidth"
                        :scrollContainer="traceScrollContainer"
                        ref="traceTreeRef"
                        class="tw:bg-[var(--o2-card-bg)]!"
                        :search-query="searchQuery"
                        :spanList="spanList"
                        :selectedSpanId="selectedSpanId"
                        :hoveredSpanId="hoveredSpanId"
                        :isSidebarOpen="
                          !!(
                            isSidebarOpen &&
                            (selectedSpanId || showTraceDetails)
                          )
                        "
                        @toggle-collapse="toggleSpanCollapse"
                        @select-span="updateSelectedSpan"
                        @hover-span="onHoverSpan"
                        @unhover-span="onUnhoverSpan"
                        @update-current-index="handleIndexUpdate"
                        @search-result="handleSearchResult"
                        @view-correlated-logs="handleTreeViewCorrelatedLogs"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="isSidebarOpen && (selectedSpanId || showTraceDetails)"
                class="histogram-sidebar-inner tw:border-l tw:border-l-solid tw:border-l-[var(--o2-border-color)]"
                :class="isTimelineExpanded ? '' : 'full'"
                :style="{
                  width: `calc(100% - ${leftWidth}px)`,
                }"
              >
                <trace-details-sidebar
                  data-test="trace-details-sidebar"
                  :span="spanMap[effectiveSpanId as string]"
                  :baseTracePosition="baseTracePosition"
                  :search-query="searchQuery"
                  :stream-name="currentTraceStreamName"
                  :service-streams-enabled="serviceStreamsEnabled"
                  :parent-mode="mode"
                  :activeTab="sidebarActiveTab"
                  :selected-log-streams="searchObj.data.traceDetails.selectedLogStreams"
                  :show-log-stream-selector="showLogStreamSelector"
                  @view-logs="redirectToLogs"
                  @close="closeSidebar"
                  @open-trace="openTraceLink"
                  @add-filter="addFilterFromSidebar"
                  @apply-filter-immediately="applyFilterImmediately"
                  @update:activeTab="sidebarActiveTab = $event as string"
                />
              </div>
            </div>

            <!-- DAG View - only for LLM traces -->
            <div
              v-if="hasLLMSpans && activeTab === 'dag'"
              style="display: flex; flex: 1; min-height: 0"
            >
              <div
                class="dag-left-panel"
                :style="{
                  width:
                    isSidebarOpen && (selectedSpanId || showTraceDetails)
                      ? `${dagLeftWidth}%`
                      : '100%',
                  minWidth: '200px',
                }"
              >
                <TraceDAG
                  data-test="trace-details-dag"
                  :traceId="effectiveSpanList[0]?.trace_id || ''"
                  :streamName="currentTraceStreamName || 'default'"
                  :startTime="effectiveTimeRange.from || 0"
                  :endTime="effectiveTimeRange.to || 0"
                  :sidebarOpen="
                    Boolean(
                      isSidebarOpen && (!!selectedSpanId || showTraceDetails),
                    )
                  "
                  @node-click="handleDAGNodeClick"
                />
              </div>
              <!-- Resizable divider -->
              <div
                v-if="isSidebarOpen && (selectedSpanId || showTraceDetails)"
                class="dag-resizer"
                @mousedown="startDagResize"
              >
                <div class="dag-resizer-line"></div>
              </div>
              <div
                v-if="isSidebarOpen && (selectedSpanId || showTraceDetails)"
                class="dag-right-panel"
                :style="{
                  width: `${100 - dagLeftWidth}%`,
                  minWidth: '300px',
                }"
              >
                <trace-details-sidebar
                  data-test="trace-details-dag-sidebar"
                  :span="spanMap[effectiveSpanId as string]"
                  :baseTracePosition="baseTracePosition"
                  :search-query="searchQuery"
                  :stream-name="currentTraceStreamName"
                  :service-streams-enabled="serviceStreamsEnabled"
                  :parent-mode="mode"
                  :activeTab="sidebarActiveTab"
                  :selected-log-streams="searchObj.data.traceDetails.selectedLogStreams"
                  :show-log-stream-selector="showLogStreamSelector"
                  @view-logs="redirectToLogs"
                  @close="closeSidebar"
                  @open-trace="openTraceLink"
                  @add-filter="addFilterFromSidebar"
                  @apply-filter-immediately="applyFilterImmediately"
                  @update:activeTab="sidebarActiveTab = $event as string"
                />
              </div>
            </div>

            <!-- Flame Graph View -->
            <div
              v-if="activeTab === 'flame-graph'"
              style="display: flex; flex: 1; min-height: 0"
              class="tw:w-full tw:bg-[var(--o2-card-bg)]!"
            >
              <FlameGraphView
                :spans="flatSpans"
                :selected-span-id="selectedSpanId"
                :trace-duration="traceMetadata?.duration_ms || 0"
                :span-map="spanMap"
                :stream-name="currentTraceStreamName"
                :search-query="searchQuery"
                :parent-mode="mode"
                :service-streams-enabled="serviceStreamsEnabled"
                :base-trace-position="baseTracePosition"
                @view-logs="redirectToLogs"
                @close="closeSidebar"
                @select-span="updateSelectedSpan"
                @add-filter="addFilterFromSidebar"
                @apply-filter-immediately="applyFilterImmediately"
                @open-trace="openTraceLink"
              />
            </div>

            <!--
              Thread View — chat-style projection of LLM turns.
              Same `config.showLLMUI !== 'false'` gate as the tab
              toggle above so a stale `activeTab="thread"` (e.g. from
              a saved URL) can't render the body when the env flag
              has explicitly disabled the feature.
            -->
            <div
              v-if="config.showLLMUI !== 'false' && activeTab === 'thread'"
              style="display: flex; flex: 1; min-height: 0"
              class="tw:w-full tw:bg-[var(--o2-card-bg)]!"
            >
              <div
                class="thread-left-panel"
                :style="{
                  width:
                    isSidebarOpen && (selectedSpanId || showTraceDetails)
                      ? '60%'
                      : '100%',
                  minWidth: '320px',
                  height: '100%',
                  overflow: 'hidden',
                }"
              >
                <ThreadView
                  :spans="effectiveSpanList"
                  :selected-span-id="selectedSpanId"
                  @span-selected="updateSelectedSpan"
                />
              </div>
              <div
                v-if="isSidebarOpen && (selectedSpanId || showTraceDetails)"
                class="tw:border-l tw:border-l-solid tw:border-l-[var(--o2-border-color)]"
                style="width: 40%; min-width: 300px; height: 100%; overflow: hidden;"
              >
                <trace-details-sidebar
                  data-test="trace-details-thread-sidebar"
                  :span="spanMap[selectedSpanId as string]"
                  :baseTracePosition="baseTracePosition"
                  :search-query="searchQuery"
                  :stream-name="currentTraceStreamName"
                  :service-streams-enabled="serviceStreamsEnabled"
                  :parent-mode="mode"
                  :activeTab="sidebarActiveTab"
                  :selected-log-streams="searchObj.data.traceDetails.selectedLogStreams"
                  :show-log-stream-selector="showLogStreamSelector"
                  @view-logs="redirectToLogs"
                  @close="closeSidebar"
                  @open-trace="openTraceLink"
                  @add-filter="addFilterFromSidebar"
                  @apply-filter-immediately="applyFilterImmediately"
                  @update:activeTab="sidebarActiveTab = $event as string"
                />
              </div>
            </div>

            <!-- Spans Table View Placeholder -->
            <div
              v-if="activeTab === 'spans'"
              style="
                display: flex;
                flex: 1;
                min-height: 0;
                align-items: center;
                justify-content: center;
              "
            >
              <div
                style="
                  text-align: center;
                  color: var(--o2-text-secondary);
                  padding: 40px;
                "
              >
                <OIcon
                  name="table-chart"
                  style="margin-bottom: 16px; width: 48px; height: 48px;"
                 />
                <div
                  style="font-size: 16px; font-weight: 600; margin-bottom: 8px"
                >
                  {{ t("traces.spansTableView") }}
                </div>
                <div style="font-size: 14px">{{ t("traces.comingSoon") }}</div>
              </div>
            </div>

            <!-- Map View with Pattern/Span Toggle -->
            <div
              v-if="activeTab === 'map'"
              style="
                display: flex;
                flex: 1;
                min-height: 0;
                flex-direction: column;
              "
              class="tw:w-full tw:h-full"
            >
              <!-- Chart Container -->
              <div
                style="
                  display: flex;
                  flex: 1;
                  min-height: 0;
                  align-items: center;
                  justify-content: center;
                "
              >
                <div
                  style="text-align: center"
                  class="tw:w-full tw:h-full tw:p-[0.625rem]"
                >
                  <ChartRenderer
                    ref="chartRendererRef"
                    data-test="trace-details-service-map-chart"
                    :data="traceServiceMapChartOptions"
                    class="trace-chart-height tw:h-full! tw:w-full!"
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
    <div
      v-else-if="
        shouldFetchData &&
        (searchObj.data.traceDetails.isLoadingTraceDetails ||
          searchObj.data.traceDetails.isLoadingTraceMeta)
      "
      class="tw:flex tw:flex-col tw:items-center tw:justify-center"
      :style="{ height: '100%' }"
    >
      <OSpinner
        data-test="trace-details-loading-spinner"
        size="lg"
      />
      <div data-test="trace-details-loading-text" class="tw:pt-2">
        {{ t("traces.fetchingTrace") }}
      </div>
    </div>

    <!-- Filters Sidebar -->
    <ODrawer data-test="trace-details-filter-popover-drawer"
      v-model:open="showFilterPopover"
      :width="30"
      :title="t('traces.traceFilters')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="t('traces.showTraces')"
      @click:secondary="showFilterPopover = false"
      @click:primary="applyAndViewTraces"
    >
      <div class="tw:flex-1 tw:border tw:border-[var(--o2-border)] tw:rounded">
        <CodeQueryEditor
          v-model:query="localEditorValue"
          language="sql"
          class="tw:h-full tw:w-full"
        />
      </div>
    </ODrawer>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  type PropType,
  onMounted,
  onUnmounted,
  watch,
  defineAsyncComponent,
  onBeforeMount,
  nextTick,
  computed,
  provide,
} from "vue";
import { cloneDeep } from "lodash-es";
import ShareButton from "@/components/common/ShareButton.vue";
import useTraces from "@/composables/useTraces";
import TraceDetailsSidebar from "./TraceDetailsSidebar.vue";
import TraceTree from "./TraceTree.vue";
import TraceDAG from "./TraceDAG.vue";
import TraceHeader from "./TraceHeader.vue";
import { useStore } from "vuex";
import { createTracesContextProvider } from "@/composables/contextProviders/tracesContextProvider";
import { contextRegistry } from "@/composables/contextProviders";
import {
  formatTimeWithSuffix,
  getImageURL,
  convertTimeFromNsToMs,
  convertTimeFromNsToUs,
} from "@/utils/zincutils";
import TraceTimelineIcon from "@/components/icons/TraceTimelineIcon.vue";
import ServiceMapIcon from "@/components/icons/ServiceMapIcon.vue";
import {
  convertTimelineData,
  convertTraceServiceMapData,
} from "@/utils/traces/convertTraceData";
import { getAllSpanColors } from "@/utils/traces/traceColors";
import { resolveSessionId } from "./traceDetails.utils";
import { buildFilterTerm, applyFilterTerm } from "@/utils/traces/filterUtils";
import { buildPatternConsolidatedTree } from "@/utils/traces/patternDetection";
import { useTracePatternTree } from "@/composables/useTracePatternTree";
import { createTreeVisualizationEngine } from "@/utils/traces/treeVisualizationEngine";
import { generateTracePatternTooltipContent } from "@/utils/traces/treeTooltipHelpers";
import {
  SPAN_KIND_MAP,
  SPAN_KIND_UNSPECIFIED,
  SPAN_KIND_CLIENT,
} from "@/utils/traces/constants";
import useResizer from "@/composables/useResizer";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18n } from "vue-i18n";
import useStreams from "@/composables/useStreams";
import useRumSpanBuilder from "@/composables/rum/useRumSpanBuilder";
import { b64EncodeUnicode, formatLargeNumber } from "@/utils/zincutils";
import { useRouter } from "vue-router";
import searchService from "@/services/search";
import config from "@/aws-exports";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import useNotifications from "@/composables/useNotifications";
import {
  parseUsageDetails,
  parseCostDetails,
  isLLMTrace,
} from "@/utils/llmUtils";
import {
  formatTimestamp,
  useTraceProcessing,
} from "@/composables/traces/useTraceProcessing";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { resolveSpanIdentity } from "@/utils/traces/spanIdentity";
import {
  TRACE_SERVICE_DETECTION_KEY,
  useSpanServiceDetection,
} from "@/utils/traces/useSpanServiceDetection";
import type { ServiceDetectionConfig } from "@/ts/interfaces/traces/serviceDetection.types";
import {
  useServiceCorrelation,
  type KeyFieldsConfig,
} from "@/composables/useServiceCorrelation";
import { getOrSetServiceColor } from "@/utils/traces/serviceColorRegistry";

// Import FlameGraphView
const FlameGraphView = defineAsyncComponent(
  () => import("@/components/traces/FlameGraphView.vue"),
);

// Import ThreadView (LLM Thread tab)
const ThreadView = defineAsyncComponent(
  () => import("./ThreadView.vue"),
);

export default defineComponent({
  name: "TraceDetails",
  props: {
    // Mode control
    mode: {
      type: String as PropType<"standalone" | "embedded">,
      default: "standalone",
      validator: (value: string) => ["standalone", "embedded"].includes(value),
    },

    // Data props (used in embedded mode)
    traceIdProp: {
      type: String,
      default: "",
    },
    streamNameProp: {
      type: String,
      default: "",
    },
    spanListProp: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    startTimeProp: {
      type: Number,
      default: 0,
    },
    endTimeProp: {
      type: Number,
      default: 0,
    },
    correlatedLogStream: {
      type: String,
      default: "",
    },

    // UI visibility controls
    showBackButton: {
      type: Boolean,
      default: true,
    },
    showHeader: {
      type: Boolean,
      default: true,
    },
    showTimeline: {
      type: Boolean,
      default: true,
    },
    showLogStreamSelector: {
      type: Boolean,
      default: true,
    },
    showShareButton: {
      type: Boolean,
      default: true,
    },
    showCloseButton: {
      type: Boolean,
      default: true,
    },
    showExpandButton: {
      type: Boolean,
      default: false,
    },
    hideSessionReplayButton: {
      type: Boolean,
      default: false,
    },
    // Correlation-specific props
    enableCorrelationLinks: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    ShareButton,
    TraceDetailsSidebar,
    TraceTree,
    TraceDAG,
    TraceHeader,
    FlameGraphView,
    OToggleGroup,
    OToggleGroupItem,
    OButton,
    ODrawer,
    OIcon,
    ThreadView,
    ChartRenderer: defineAsyncComponent(
      () => import("@/components/dashboards/panels/ChartRenderer.vue"),
    ),
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    OSpinner,
    OTooltip,
    OSearchInput,
    OSelect,
  },

  emits: ["searchQueryUpdated", "close", "spanSelected"],
  setup(props, { emit }) {
    const serviceDetectionConfig = ref<ServiceDetectionConfig | null>(null);
    provide(TRACE_SERVICE_DETECTION_KEY, serviceDetectionConfig);
    const { resolveSpanIdentity } = useSpanServiceDetection(serviceDetectionConfig);

    const traceTree: any = ref([]);
    const spanMap: any = ref({});
    const activeTab = ref("waterfall");
    const sidebarActiveTab = ref("attributes");

    const {
      searchObj,
      getUrlQueryParams,
      buildQueryDetails,
      navigateToLogs,
      navigateToCorrelatedLogs,
    } = useTraces();

    const { loadKeyFields } = useServiceCorrelation();

    const baseTracePosition: any = ref({});
    const collapseMapping: any = ref({});
    const traceRootSpan: any = ref(null);
    const spanPositionList: any = ref([]);
    const splitterModel = ref(25);
    const timeRange: any = ref({ start: 0, end: 0 });
    const store = useStore();
    const { getStreams, getStream } = useStreams();

    // Chart renderer ref for tooltip integration
    const chartRendererRef = ref<any>(null);

    // Tooltip lifecycle management
    let tooltipCleanup: (() => void) | null = null;
    let pendingTooltipSetup: ReturnType<typeof setTimeout> | null = null;

    // AI copilot context provider for trace details page
    const setupContextProvider = () => {
      const provider = createTracesContextProvider(searchObj, store);
      contextRegistry.register("traces", provider);
      contextRegistry.setActive("traces");
    };

    const cleanupContextProvider = () => {
      contextRegistry.unregister("traces");
      contextRegistry.setActive("");
    };

    const traceServiceMap: any = ref({});

    // Pattern View - new functionality
    const consolidatedPatterns = ref(new Map());
    const isDarkMode = computed(() => store.state.theme === 'dark');

    // Set up pattern tree composable and visualization engine
    const { generateEChartsOptions } = createTreeVisualizationEngine();
    const {
      treeData: patternTreeData,
      getNodeLabel: getPatternNodeLabel,
      getNodeTooltip: getPatternNodeTooltip,
      getNodeErrorRate: getPatternNodeErrorRate
    } = useTracePatternTree(consolidatedPatterns, isDarkMode);

    // Computed chart options that switches between pattern and span views
    const traceServiceMapChartOptions = computed(() => {
        // Pattern view - use new pattern-based visualization
        const chartOptions = generateEChartsOptions(
          {
            treeData: patternTreeData.value,
            getNodeLabel: getPatternNodeLabel,
            getNodeTooltip: getPatternNodeTooltip,
            getNodeErrorRate: getPatternNodeErrorRate,
            getNodeServiceColor: (node: any) =>
              searchObj.meta.serviceColors[node.name]
          },
          {
            layoutType: 'horizontal',
            isDarkMode: isDarkMode.value,
            nodeSize: 'fixed'
          }
        );

        // Wrap in the format expected by ChartRenderer
        return {
          options: chartOptions,
          notMerge: true,
          lazyUpdate: true
        };
    });

    const spanDimensions = {
      height: 30,
      barHeight: 8,
      textHeight: 25,
      gap: 15,
      collapseHeight: "14",
      collapseWidth: 14,
      connectorPadding: 2,
      paddingLeft: 8,
      hConnectorWidth: 20,
      dotConnectorWidth: 6,
      dotConnectorHeight: 6,
      colors: ["#b7885e", "#1ab8be", "#ffcb99", "#f89570", "#839ae2"],
    };
    const parentContainer = ref<HTMLElement | null>(null);
    const traceScrollContainer = ref<HTMLElement | null>(null);
    let parentHeight = ref(0);
    let currentHeight = 0;
    const updateHeight = async () => {
      await nextTick();
      if (parentContainer.value) {
        const newHeight = parentContainer.value.scrollHeight;
        if (currentHeight !== newHeight) {
          currentHeight = newHeight;
          parentHeight.value = currentHeight;
        }
      }
    };

    const { showErrorNotification } = useNotifications();

    const logStreams = ref([]);

    const filteredStreamOptions = ref([]);

    const streamSearchValue = ref<string>("");

    const { t } = useI18n();


    const router = useRouter();

    const traceDetails = ref({});

    // ── Filter-from-trace-details state ──────────────────────────────────────
    const areFiltersAdded = ref(false);
    const showFilterPopover = ref(false);
    const filterDialogReady = ref(false);
    const localEditorValue = ref("");

    const addFilterFromSidebar = ({
      field,
      value,
      operator,
    }: {
      field: string;
      value: string;
      operator: "=" | "!=";
    }) => {
      const term = buildFilterTerm(field, value, operator);
      localEditorValue.value = applyFilterTerm(term, localEditorValue.value);
      areFiltersAdded.value = true;

      toast({
        variant: "success",
        message: `Filter added: ${field} ${operator} '${value}'`,
      });
    };

    const openFilterPopover = () => {
      showFilterPopover.value = true;
    };

    const applyAndViewTraces = () => {
      searchObj.data.editorValue = searchObj.data.editorValue
        ? searchObj.data.editorValue + " and " + localEditorValue.value
        : localEditorValue.value;
      showFilterPopover.value = false;
      localEditorValue.value = "";
      areFiltersAdded.value = false;
      const query: any = cloneDeep(router.currentRoute.value.query);
      delete query.trace_id;
      if (searchObj.data.datetime.type === "relative") {
        query.period = searchObj.data.datetime.relativeTimePeriod;
      } else {
        query.from = searchObj.data.datetime.startTime.toString();
        query.to = searchObj.data.datetime.endTime.toString();
      }
      query.query = b64EncodeUnicode(searchObj.data.editorValue);
      query["run-query"] = "true";
      router.push({ name: "traces", query });
    };
    // ─────────────────────────────────────────────────────────────────────────

    const traceVisuals = [
      { label: "Timeline", value: "timeline", icon: TraceTimelineIcon },
      { label: "Service Map", value: "service_map", icon: ServiceMapIcon },
    ];

    const activeVisual = ref("timeline");

    const traceChart = ref({
      data: [],
    });

    const ChartData: any = ref({});

    const {
      value: leftWidth,
      onMouseDown: startResize,
    } = useResizer({
      direction: "horizontal",
      initialValue: 460,
      unit: "px",
      throttleMs: 50,
    });

    // DAG panel resize state
    const {
      value: dagLeftWidth,
      onMouseDown: startDagResize,
    } = useResizer({
      direction: "horizontal",
      initialValue: 50,
      minValue: 20,
      maxValue: 80,
      unit: "%",
      containerRef: parentContainer,
      throttleMs: 16,
    });

    // Calculate sidebar width based on leftWidth
    // Sidebar should take ~84% of the remaining space after left panel
    const sidebarWidth = computed(() => {
      if (!parentContainer.value) return "84%";
      const containerWidth = parentContainer.value.clientWidth || 1200;
      const remainingWidth = containerWidth - leftWidth.value;
      const sidebarWidthPx = Math.max(remainingWidth * 0.84, 300); // Minimum 300px
      return `${sidebarWidthPx}px`;
    });

    const serviceColorIndex = ref(0);
    const colors = ref(getAllSpanColors());

    const spanList: any = computed(() => {
      return searchObj.data.traceDetails.spanList;
    });

    const isTimelineExpanded = ref(false);

    const selectedStreamsString = computed(() =>
      searchObj.data.traceDetails.selectedLogStreams.join(", "),
    );

    // Check if View Logs button should be disabled
    const isViewLogsDisabled = computed(() => {
      // In non-enterprise mode with visible log stream selector, disable when no streams are selected
      return (
        config.isEnterprise !== "true" &&
        props.showLogStreamSelector &&
        searchObj.data.traceDetails.selectedLogStreams.length === 0
      );
    });

    // Current trace stream name for correlation
    const currentTraceStreamName = computed(() => {
      return (
        (router.currentRoute.value.query.stream as string) ||
        searchObj.data.stream.selectedStream.value ||
        ""
      );
    });

    // Check if service streams feature is enabled
    const serviceStreamsEnabled = computed(() => {
      return store.state.zoConfig.service_streams_enabled !== false;
    });

    // Check if any RUM span has a session_id
    const hasRumSessionId = computed(() => {
      return spanList.value.some((span: any) => span.rum_session_id);
    });

    // Get the first RUM event with session_id for navigation
    const firstRumSessionData = computed(() => {
      const rumSpan = spanList.value.find((span: any) => span.rum_session_id);
      return rumSpan || null;
    });

    // Computed properties for mode-based priority logic
    const effectiveTraceId = computed(() => {
      if (props.mode === "embedded") {
        return props.traceIdProp;
      }
      // Standalone mode - get from URL
      return (router.currentRoute.value.query.trace_id as string) || "";
    });

    const effectiveStreamName = computed(() => {
      if (props.mode === "embedded") {
        return props.streamNameProp;
      }
      // Standalone mode - get from URL
      return (
        (router.currentRoute.value.query.stream as string) ||
        searchObj.data.stream.selectedStream.value ||
        ""
      );
    });

    const effectiveTimeRange = computed(() => {
      if (props.mode === "embedded") {
        return {
          from: props.startTimeProp,
          to: props.endTimeProp,
        };
      }
      // Standalone mode - get from URL
      return {
        from: Number(router.currentRoute.value.query.from),
        to: Number(router.currentRoute.value.query.to),
      };
    });

    const effectiveOrgIdentifier = computed(() => {
      if (props.mode === "embedded") {
        return store.state.selectedOrganization?.identifier;
      }
      // Standalone mode - get from URL (for sharing links)
      return (
        (router.currentRoute.value?.query?.org_identifier as string) ||
        store.state.selectedOrganization?.identifier
      );
    });

    // Check if we should fetch data or use provided span list
    const shouldFetchData = computed(() => {
      return (
        props.mode === "standalone" ||
        (props.mode === "embedded" && props.spanListProp.length === 0)
      );
    });

    const effectiveSpanList = computed(() => {
      if (props.mode === "embedded" && props.spanListProp.length > 0) {
        return props.spanListProp;
      }
      return searchObj.data.traceDetails.spanList;
    });

    // Use trace processing composable for FlameGraph
    // Pass traceTree (nested) instead of flat span list
    const treeForFlameGraph = computed(() => traceTree.value || []);
    const flatSpans = ref([]);

    // Calculate trace metadata for FlameGraph
    const traceMetadata = computed(() => {
      const spans = effectiveSpanList.value;
      if (!spans || spans.length === 0) return null;

      try {
        // Calculate trace duration from spans
        const startTimes = spans.map((s: any) => s.start_time);
        const endTimes = spans.map((s: any) => s.end_time);
        const minStart = Math.min(...startTimes);
        const maxEnd = Math.max(...endTimes);
        const durationMs = (maxEnd - minStart) / 1000000; // Convert from nanoseconds to milliseconds

        return {
          duration_ms: durationMs,
          total_spans: spans.length,
          start_time: minStart,
          end_time: maxEnd,
        };
      } catch (e) {
        console.error("Error calculating trace metadata:", e);
        return null;
      }
    });

    // Check if the trace contains any LLM spans
    const hasLLMSpans = computed(() => {
      const spans = effectiveSpanList.value;
      if (!spans || spans.length === 0) return false;
      return spans.some((span: any) => isLLMTrace(span));
    });

    // Computed properties for new header
    const errorSpansCount = computed(() => {
      const spans = effectiveSpanList.value;
      if (!spans || spans.length === 0) return 0;
      return spans.filter((span: any) => span.span_status === "ERROR").length;
    });

    const rootServiceName = computed(() => {
      if (traceTree.value.length > 0) {
        return traceTree.value[0]?.serviceName || "unknown";
      }
      return "unknown";
    });

    const traceStartTime = computed(() => {
      const spans = effectiveSpanList.value;
      if (!spans || spans.length === 0) return 0;
      return Math.min(...spans.map((span: any) => span.start_time));
    });

    // Tabs configuration matching TraceDetailsV2 — inlined into template
    const traceTabs = computed(() => {
      const tabs = [
        { label: "Waterfall", value: "waterfall" },
        { label: "Flame Graph", value: "flame-graph" },
        { label: "Trace Graph", value: "map" },
      ];
      // Conditionally add DAG tab for LLM traces
      if (hasLLMSpans.value) {
        tabs.push({ label: "DAG", value: "dag" });
      }
      // Thread view — chat-style projection of LLM turns and tool calls.
      if (hasLLMSpans.value) {
        tabs.push({ label: "Thread", value: "thread" });
      }
      return tabs;
    });

    const showTraceDetails = ref(false);
    const currentIndex = ref(0);
    const searchResults = ref(0);
    const searchQuery = ref("");

    const handleSearchQueryChange = (value: any) => {
      searchQuery.value = value;
    };
    const traceTreeRef = ref<InstanceType<typeof TraceTree> | null>(null);
    const nextMatch = () => {
      if (!traceTreeRef.value) {
        console.warn("TraceTree component reference not found");
        return;
      }
      if (traceTreeRef.value) {
        traceTreeRef.value.nextMatch();
      }
    };
    const prevMatch = () => {
      if (!traceTreeRef.value) {
        console.warn("TraceTree component reference not found");
        return;
      }
      if (traceTreeRef.value) {
        traceTreeRef.value.prevMatch();
      }
    };
    const handleIndexUpdate = (newIndex: any) => {
      currentIndex.value = newIndex; // Update the parent's state with the child's emitted value
    };
    const handleSearchResult = (newIndex: any) => {
      searchResults.value = newIndex; // Update the parent's state with the child's emitted value
    };
    // Watch for changes in searchQuery

    onBeforeMount(async () => {
      resetTraceDetails();
      setupTraceDetails();
    });

    watch(
      () => router.currentRoute.value.name,
      (curr, prev) => {
        if (prev === "logs" && curr === "traceDetails") {
          searchObj.meta.redirectedFromLogs = true;
        } else {
          searchObj.meta.redirectedFromLogs = false;
        }
      },
    );

    // Watch for external span list changes in embedded mode
    watch(
      () => props.spanListProp,
      (newSpanList) => {
        if (props.mode === "embedded" && newSpanList.length > 0) {
          searchObj.data.traceDetails.spanList = newSpanList;
          updateServiceColors();
          buildTracesTree();
        }
      },
      { deep: true },
    );

    // Watch for trace ID changes in embedded mode
    watch(
      () => props.traceIdProp,
      (newTraceId) => {
        if (props.mode === "embedded" && newTraceId && shouldFetchData.value) {
          resetTraceDetails();
          setupTraceDetails();
        }
      },
    );

    const updateActiveTab = (tab: string) => {
      activeTab.value = tab;
      if(tab === 'map') {
        setupTooltips();
      }
    }

    const setupTooltips = async () => {
      // Cleanup existing tooltips
      if (tooltipCleanup) {
        tooltipCleanup();
        tooltipCleanup = null;
      }
      if (pendingTooltipSetup) {
        clearTimeout(pendingTooltipSetup);
        pendingTooltipSetup = null;
      }

      await nextTick();
      // 300ms delay matches Service Graph tooltip setup timing
      pendingTooltipSetup = setTimeout(() => {
        pendingTooltipSetup = null;
        const chart = chartRendererRef.value?.chart;
        if (chart) {
          const { setupTraceNodeTooltips } = createTreeVisualizationEngine();
          tooltipCleanup = setupTraceNodeTooltips(chart, {
            treeData: patternTreeData.value,
            getNodeTooltip: getPatternNodeTooltip,
            getNodeErrorRate: getPatternNodeErrorRate
          }, isDarkMode.value);
        }
      }, 300);
    }
    
    const backgroundStyle = computed(() => {
      return {
        background: store.state.theme === "dark" ? "#181a1b" : "#ffffff",
      };
    });

    const resetTraceDetails = () => {
      searchObj.data.traceDetails.showSpanDetails = false;
      searchObj.data.traceDetails.selectedSpanId = "";
      searchObj.data.traceDetails.selectedTrace = {
        trace_id: "",
        trace_start_time: 0,
        trace_end_time: 0,
      };
      searchObj.data.traceDetails.spanList = [];
      searchObj.data.traceDetails.isLoadingTraceDetails = false;
      searchObj.data.traceDetails.isLoadingTraceMeta = false;
    };

    // Helper to extract service names from span list
    const extractServiceNames = (spans: any[]) => {
      const serviceMap = new Map<string, number>();
      spans.forEach((span) => {
        const service = span.service_name;
        serviceMap.set(service, (serviceMap.get(service) || 0) + 1);
      });

      return Array.from(serviceMap.entries()).map(([service_name, count]) => ({
        service_name,
        count,
      }));
    };

    const loadLogStreams = async () => {
      return getStreams("logs", false)
        .then((res: any) => {
          logStreams.value = res.list.map((option: any) => option.name);
          filteredStreamOptions.value = JSON.parse(
            JSON.stringify(logStreams.value),
          );

          if (!searchObj.data.traceDetails.selectedLogStreams.length) {
            // Check if log_stream query parameter exists (from correlation navigation)
            const logStreamQueryValue =
              router.currentRoute.value.query.log_stream;
            const logStreamFromQuery = Array.isArray(logStreamQueryValue)
              ? logStreamQueryValue[0]
              : logStreamQueryValue;

            if (
              logStreamFromQuery &&
              logStreams.value.includes(logStreamFromQuery)
            ) {
              // Auto-select the correlated log stream from query parameter
              searchObj.data.traceDetails.selectedLogStreams.push(
                logStreamFromQuery,
              );
            } else if (logStreams.value.length === 1) {
              // Default: select the first available log stream
              searchObj.data.traceDetails.selectedLogStreams.push(
                logStreams.value[0],
              );
            }
          }
        })
        .catch(() => Promise.reject())
        .finally(() => {});
    };

    const setupTraceDetails = async () => {
      showTraceDetails.value = false;
      searchObj.data.traceDetails.showSpanDetails = false;
      searchObj.data.traceDetails.selectedSpanId = "";

      // If embedded mode with span list provided, skip fetching
      if (props.mode === "embedded" && props.spanListProp.length > 0) {
        // Use provided span list directly
        searchObj.data.traceDetails.spanList = props.spanListProp;

        // Set up minimal trace metadata from span list
        if (props.spanListProp.length > 0) {
          const firstSpan = props.spanListProp[0];
          const serviceNames = extractServiceNames(props.spanListProp);
          (searchObj.data.traceDetails.selectedTrace as any) = {
            trace_id: props.traceIdProp || firstSpan.trace_id,
            trace_start_time: Math.min(
              ...props.spanListProp.map((s) => s.start_time / 1000),
            ),
            trace_end_time: Math.max(
              ...props.spanListProp.map((s) => s.end_time / 1000),
            ),
            service_name: serviceNames,
            services: {},
          };
        }

        updateServiceColors();
        buildTracesTree();

        // Load log streams
        await loadLogStreams();
        return;
      }

      // Fetch from API — standalone mode, or embedded with no pre-fetched spans
      await loadLogStreams();
      await getTraceMeta();
    };

    onMounted(async () => {
      setupContextProvider();

      const keyFields: KeyFieldsConfig = await loadKeyFields();
      serviceDetectionConfig.value = keyFields["traces"]?.service_detection ?? null;

      const params = router.currentRoute.value.query;
      if (params.span_id) {
        updateSelectedSpan(params.span_id as string);
      }
      nextTick(() => {
        updateHeight();
      });
      // window.addEventListener("resize", updateHeight);
    });

    onUnmounted(() => {
      cleanupContextProvider();

      // Tooltip cleanup
      if (pendingTooltipSetup) {
        clearTimeout(pendingTooltipSetup);
        pendingTooltipSetup = null;
      }
      if (tooltipCleanup) {
        tooltipCleanup();
        tooltipCleanup = null;
      }
    });

    // watch(
    //   () => spanList.value.length,
    //   () => {
    //     if (spanList.value.length) {
    //       buildTracesTree();
    //     } else traceTree.value = [];
    //   },
    //   { immediate: true },
    // );

    const isSidebarOpen = computed(() => {
      return searchObj.data.traceDetails.showSpanDetails;
    });

    const selectedSpanId = computed(() => {
      return searchObj.data.traceDetails.selectedSpanId;
    });

    const hoveredSpanId = ref("");
    const effectiveSpanId = computed(
      () => hoveredSpanId.value || selectedSpanId.value,
    );

    // Set the default sidebar tab on the first span selection,
    // and re-evaluate when the current tab no longer exists for the new span
    // (e.g. moving from LLM span with "preview" to a non-LLM span).
    watch(selectedSpanId, (newSpanId, oldSpanId) => {
      if (newSpanId && spanMap.value[newSpanId]) {
        const isLLM = isLLMTrace(spanMap.value[newSpanId]);
        if (
          !oldSpanId ||
          (sidebarActiveTab.value === "preview" && !isLLM)
        ) {
          sidebarActiveTab.value = isLLM ? "preview" : "attributes";
        }
      }
    });

    const onHoverSpan = (spanId: string) => {
      hoveredSpanId.value = spanId;
    };
    const onUnhoverSpan = () => {
      hoveredSpanId.value = "";
    };

    const getTraceMeta = () => {
      try {
        searchObj.data.traceDetails.isLoadingTraceMeta = true;

        let filter = (router.currentRoute.value.query.filter as string) || "";

        if (filter?.length)
          filter += ` and trace_id='${effectiveTraceId.value}'`;
        else filter += `trace_id='${effectiveTraceId.value}'`;

        const timeRange = effectiveTimeRange.value;

        searchService
          .get_traces({
            org_identifier: effectiveOrgIdentifier.value,
            start_time: timeRange.from - 10000,
            end_time: timeRange.to + 10000,
            filter: filter || "",
            size: 1,
            from: 0,
            stream_name: effectiveStreamName.value,
          })
          .then(async (res: any) => {
            const trace = getTracesMetaData(res.data.hits)[0];
            if (!trace) {
              showTraceDetailsError();
              return;
            }
            searchObj.data.traceDetails.selectedTrace = trace;

            let startTime = Number(router.currentRoute.value.query.from);
            let endTime = Number(router.currentRoute.value.query.to);
            if (
              res.data.hits.length === 1 &&
              res.data.hits[0].start_time &&
              res.data.hits[0].end_time
            ) {
              startTime = Math.floor(res.data.hits[0].start_time / 1000);
              endTime = Math.ceil(res.data.hits[0].end_time / 1000);

              // If the trace is not in the current time range, update the time range
              if (
                !(
                  startTime >= Number(router.currentRoute.value.query.from) &&
                  endTime <= Number(router.currentRoute.value.query.to)
                )
              ) {
                updateUrlQueryParams({
                  from: startTime,
                  to: endTime,
                });
              }
            }

            getTraceDetails({
              stream: effectiveStreamName.value,
              trace_id: trace.trace_id,
              from: startTime - 10000,
              to: endTime + 10000,
            });
          })
          .catch(() => {
            showTraceDetailsError();
          })
          .finally(() => {
            searchObj.data.traceDetails.isLoadingTraceMeta = false;
          });
      } catch (error) {
        console.error("Error fetching trace meta:", error);
        searchObj.data.traceDetails.isLoadingTraceMeta = false;
        showTraceDetailsError();
      }
    };

    /**
     * Update the query parameters in the URL
     * @param newParams - object containing new parameters
     */
    const updateUrlQueryParams = (newParams: any) => {
      router.replace({
        query: {
          ...router.currentRoute.value.query, // keep existing params
          ...newParams, // overwrite with new ones
        },
      });
    };

    const getDefaultRequest = () => {
      return {
        query: {
          sql: `select min(${store.state.zoConfig.timestamp_column}) as zo_sql_timestamp, min(start_time/1000) as trace_start_time, max(end_time/1000) as trace_end_time, min(service_name) as service_name, min(operation_name) as operation_name, count(trace_id) as spans, SUM(CASE WHEN span_status='ERROR' THEN 1 ELSE 0 END) as errors, max(duration) as duration, trace_id [QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE] group by trace_id order by zo_sql_timestamp DESC`,
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
          from: 0,
          size: 0,
        },
        encoding: "base64",
      };
    };

    const sanitizeTraceId = (id: string): string =>
      String(id).replace(/['"\\]/g, "");

    const buildTraceSearchQuery = (trace: any) => {
      const req = getDefaultRequest();
      req.query.from = 0;
      // TODO : Handle this with _search_stream instead of adding size
      req.query.size = 50000;
      req.query.start_time = trace.from;
      req.query.end_time = trace.to;

      req.query.sql = b64EncodeUnicode(
        `SELECT * FROM "${trace.stream}" WHERE trace_id = '${sanitizeTraceId(trace.trace_id)}' ORDER BY start_time`,
      ) as string;

      return req;
    };

    const { fetchRumEventsForTrace, formatRumEventsAsSpans } =
      useRumSpanBuilder(logStreams, searchObj);

    const getTraceDetails = async (data: any) => {
      try {
        searchObj.data.traceDetails.isLoadingTraceDetails = true;
        searchObj.data.traceDetails.spanList = [];
        const req = buildTraceSearchQuery(data);

        const tracePromise = searchService.search(
          {
            org_identifier: effectiveOrgIdentifier.value,
            query: req,
            page_type: "traces",
          },
          "ui",
        );

        const rumPromise = fetchRumEventsForTrace(
          data.trace_id,
          req.query.start_time,
          req.query.end_time,
        );

        Promise.all([tracePromise, rumPromise])
          .then(([traceRes, rumData]) => {
            if (!traceRes.data?.hits?.length) {
              showTraceDetailsError();
              return;
            }

            const traceSpans = traceRes.data?.hits || [];
            const {
              tracedResources,
              viewEvents,
              actionEvents,
              allViewEvents,
            } = rumData;
            const rumSpans = formatRumEventsAsSpans(
              tracedResources,
              viewEvents,
              actionEvents,
              allViewEvents,
            );
            // RUM spans take priority over trace spans with the same span_id
            const rumSpanIds = new Set(rumSpans.map((s: any) => s.span_id));
            const deduplicatedTraceSpans = traceSpans.filter(
              (s: any) => !rumSpanIds.has(s.span_id),
            );
            searchObj.data.traceDetails.spanList = [
              ...rumSpans,
              ...deduplicatedTraceSpans,
            ];
            updateServiceColors();
            buildTracesTree();
          })
          .catch((error) => {
            console.error("Error fetching trace details:", error);
            searchObj.data.traceDetails.isLoadingTraceDetails = false;
            showTraceDetailsError();
          })
          .finally(() => {
            searchObj.data.traceDetails.isLoadingTraceDetails = false;
          });
      } catch (error) {
        console.error("Error fetching trace details:", error);
        searchObj.data.traceDetails.isLoadingTraceDetails = false;
        showTraceDetailsError();
      }
    };

    const getTracesMetaData = (traces: any[]) => {
      if (!traces.length) return [];

      return traces.map((trace) => {
        const _trace = {
          trace_id: trace.trace_id,
          trace_start_time: Math.round(trace.start_time / 1000),
          trace_end_time: Math.round(trace.end_time / 1000),
          service_name: trace.service_name,
          operation_name: trace.operation_name,
          spans: trace.spans[0],
          errors: trace.spans[1],
          duration: trace.duration,
          services: {} as any,
          zo_sql_timestamp: new Date(trace.start_time / 1000).getTime(),
        };
        return _trace;
      });
    };

    const updateServiceColors = () => {
      searchObj.data.traceDetails.selectedTrace.service_name.forEach(
        (service: any) => {
          if (!searchObj.meta.serviceColors[service.service_name]) {
            if (serviceColorIndex.value >= colors.value.length)
              generateNewColor();

            searchObj.meta.serviceColors[service.service_name] =
              colors.value[serviceColorIndex.value];

            serviceColorIndex.value++;
          }
          (searchObj.data.traceDetails.selectedTrace as any).services[
            service.service_name
          ] = service.count;
        },
      );
    };

    const showTraceDetailsError = () => {
      showErrorNotification(
        `Trace ${router.currentRoute.value.query.trace_id} not found`,
      );
      const query = cloneDeep(router.currentRoute.value.query);
      delete query.trace_id;
      router.push({
        name: "traces",
        query: {
          ...query,
        },
      });
      return;
    };

    function generateNewColor() {
      // Generate a color in HSL format
      const hue = (colors.value.length * 137.508) % 360; // Using golden angle approximation
      const saturation = 70 + (colors.value.length % 2) * 15;
      const lightness = 50;
      colors.value.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
      return colors;
    }

    const calculateTracePosition = () => {
      const tics = [];
      baseTracePosition.value["durationMs"] = timeRange.value.end;
      baseTracePosition.value["durationUs"] = timeRange.value.end * 1000;
      baseTracePosition.value["startTimeUs"] =
        traceTree.value[0].startTimeUs + timeRange.value.start * 1000;
      const quarterMs = (timeRange.value.end - timeRange.value.start) / 4;
      let time = timeRange.value.start;
      for (let i = 0; i <= 4; i++) {
        tics.push({
          value: Number(time.toFixed(2)),
          label: `${formatTimeWithSuffix(time * 1000)}`,
          left: i === 0 ? "-1px" : `${25 * i}%`,
        });
        time += quarterMs;
      }
      baseTracePosition.value["tics"] = tics;
    };

    // Find out spans who has reference_parent_span_id as span_id of first span in sampleTrace
    async function buildTracesTree() {
      if (!spanList.value?.length) return;

      spanMap.value = {};
      traceTree.value = [];
      spanPositionList.value = [];
      collapseMapping.value = {};
      let lowestStartTime: number = spanList.value[0].start_time;
      let highestEndTime: number = spanList.value[0].end_time;

      if (!spanList.value?.length) return;

      spanList.value.forEach((spanData: any) => {
        spanMap.value[spanData.span_id] = spanData;
      });

      const formattedSpanMap: any = {};

      spanList.value.forEach((spanData: any, idx: number) => {
        // Validate span data before processing
        const validation = validateSpan(spanData);
        if (!validation.valid) {
          console.warn(
            `Span has missing required fields: ${validation.missing.join(", ")}. Span data:`,
            spanData,
          );
        }

        const formattedSpan = getFormattedSpan(spanData);
        const spanId =
          spanData.span_id ||
          formattedSpan.spanId ||
          `span_${idx}_${Date.now()}`;
        formattedSpanMap[spanId] = formattedSpan;
      });

      for (let i = 0; i < spanList.value.length; i++) {
        if (spanList.value[i].start_time < lowestStartTime) {
          lowestStartTime = spanList.value[i].start_time;
        }
        if (spanList.value[i].end_time > highestEndTime) {
          highestEndTime = spanList.value[i].end_time;
        }

        const span = formattedSpanMap[spanList.value[i].span_id];

        span.style.color = getOrSetServiceColor(span.resolvedIdentity);

        span.style.backgroundColor = adjustOpacity(span.style.color, 0.2);

        span.index = i;

        collapseMapping.value[span.spanId] = true;

        if (!span.parentId) {
          traceTree.value.push(span);
        } else if (!formattedSpanMap[span.parentId]) {
          traceTree.value.push(span);
        } else if (span.parentId && formattedSpanMap[span.parentId]) {
          const parentSpan = formattedSpanMap[span.parentId];
          if (!parentSpan.spans) parentSpan.spans = [];
          parentSpan.spans.push(span);
        }
      }

      if (!traceTree.value.length) {
        console.warn(
          "buildTracesTree: no root spans found — trace may have missing or malformed span IDs",
        );
        showTraceDetailsError();
        return;
      }

      // Purposely converting to microseconds to avoid floating point precision issues
      // In updateChart method, we are using start and end time to set the time range of trace
      traceTree.value[0].lowestStartTime =
        convertTimeFromNsToUs(lowestStartTime);
      traceTree.value[0].highestEndTime = convertTimeFromNsToUs(highestEndTime);
      traceTree.value[0].style.color = getOrSetServiceColor(
        traceTree.value[0].resolvedIdentity,
      );

      traceTree.value.forEach((span: any) => {
        addSpansPositions(span, 0);
      });

      // Reset time range atomically to prevent race conditions
      timeRange.value = {
        start: 0,
        end: 0,
      };

      calculateTracePosition();
      buildTraceChart();
      buildServiceTree();
      flatSpans.value = useTraceProcessing(
        treeForFlameGraph as any,
        spanMap as any,
        serviceDetectionConfig,
      ).flatSpans.value;

      // After the tree is built, scroll the pre-selected span into view (e.g.
      // when arriving from spans search mode with a span_id in the URL).
      if (selectedSpanId.value) {
        if (!spanMap.value[selectedSpanId.value]) {
          showErrorNotification(
            `Span ${selectedSpanId.value} not found in trace`,
          );
          searchObj.data.traceDetails.selectedSpanId = "";
          searchObj.data.traceDetails.showSpanDetails = false;
        } else {
          scrollSpanIntoView(selectedSpanId.value);
        }
      }
    }

    let index = 0;
    const addSpansPositions = (span: any, depth: number) => {
      if (!span.index) index = 0;
      span.depth = depth;
      spanPositionList.value.push(
        Object.assign(span, {
          style: {
            color: span.style.color,
            backgroundColor: span.style.backgroundColor,
            top: index * spanDimensions.height + "px",
            left: spanDimensions.gap * depth + "px",
          },
          hasChildSpans: !!span.spans.length,
          currentIndex: index,
        }),
      );
      if (collapseMapping.value[span.spanId]) {
        if (span.spans.length) {
          span.spans.forEach((childSpan: any) => {
            index = index + 1;
            childSpan.totalSpans = addSpansPositions(childSpan, depth + 1);
          });
          span.totalSpans = span.spans.reduce(
            (acc: number, span: any) =>
              acc + ((span?.spans?.length || 0) + (span?.totalSpans || 0)),
            0,
          );
        }
        return (span?.spans?.length || 0) + (span?.totalSpans || 0);
      } else {
        return 0;
      }
    };

    function adjustOpacity(hexColor: string, opacity: number) {
      // Ensure opacity is between 0 and 1
      opacity = Math.max(0, Math.min(1, opacity));

      // Convert opacity to a hex value
      const opacityHex = Math.round(opacity * 255)
        .toString(16)
        .padStart(2, "0");

      // Append the opacity hex value to the original hex color
      return hexColor + opacityHex;
    }

    const buildServiceTree = () => {
      const serviceTree: any[] = [];
      let maxDepth = 0;
      let maxHeight: number[] = [0];
      const getService = (
        span: any,
        currentColumn: any[],
        serviceName: string,
        depth: number,
        height: number,
      ) => {
        maxHeight[depth] =
          maxHeight[depth] === undefined ? 1 : maxHeight[depth] + 1;
        const serviceIdentity = span.resolvedIdentity || span.serviceName || 'unknown';
        if (serviceName !== serviceIdentity) {
          const children: any[] = [];
          currentColumn.push({
            name: `${serviceIdentity} \n (${span.durationMs}ms)`,
            parent: serviceName,
            duration: span.durationMs,
            children: children,
            itemStyle: {
              color: getOrSetServiceColor(span.resolvedIdentity),
            },
            emphasis: {
              disabled: true,
            },
          });
          if (span.spans && span.spans.length) {
            span.spans.forEach((_span: any) =>
              getService(_span, children, serviceIdentity, depth + 1, height),
            );
          } else {
            if (maxDepth < depth) maxDepth = depth;
          }
          return;
        }
        if (span.spans && span.spans.length) {
          span.spans.forEach((span: any) =>
            getService(span, currentColumn, serviceName, depth + 1, height),
          );
        } else {
          if (maxDepth < depth) maxDepth = depth;
        }
      };

      // Handle multiple root nodes - process each root span to ensure
      // all root services appear in the service map
      traceTree.value.forEach((span: any) => {
        getService(span, serviceTree, "", 1, 1);
      });

      // Build consolidated patterns for pattern view
      consolidatedPatterns.value = buildPatternConsolidatedTree(traceTree.value);
      // console.log('[DEBUG] consolidatedPatterns size:', consolidatedPatterns.value?.size || 0);
      // console.log('[DEBUG] consolidatedPatterns keys:', Array.from(consolidatedPatterns.value?.keys() || []));
      // Pattern consolidation completed successfully

      traceServiceMap.value = convertTraceServiceMapData(
        cloneDeep(serviceTree),
        maxDepth,
        true, // Enable multi-root handling for trace service maps
      );
    };

    // Validate required span fields
    const validateSpan = (span: any): { valid: boolean; missing: string[] } => {
      const requiredFields = [
        "start_time",
        "end_time",
        "duration",
        "operation_name",
        "service_name",
        "trace_id",
        "span_id",
      ];

      const missing: string[] = [];

      requiredFields.forEach((field) => {
        if (span[field] === undefined || span[field] === null) {
          missing.push(field);
        }
      });

      return {
        valid: missing.length === 0,
        missing,
      };
    };

    // Convert span object to required format
    // Converting ns to ms
    const getFormattedSpan = (span: any) => {
      const usage = parseUsageDetails(span);
      const cost = parseCostDetails(span);

      return {
        [store.state.zoConfig.timestamp_column]:
          span[store.state.zoConfig.timestamp_column],
        startTimeUs: Math.floor(span.start_time / 1000),
        startTimeMs: convertTimeFromNsToMs(span.start_time),
        endTimeMs: convertTimeFromNsToMs(span.end_time),
        endTimeUs: Math.floor(span.end_time / 1000),
        durationMs: span?.duration
          ? Number((span?.duration / 1000).toFixed(4))
          : 0,
        durationUs: span?.duration ? Number(span?.duration?.toFixed(4)) : 0,
        idleMs: span.idle_ns ? convertTime(span.idle_ns) : 0,
        busyMs: span.busy_ns ? convertTime(span.busy_ns) : 0,
        spanId: span.span_id || `generated_${Date.now()}_${Math.random()}`,
        operationName: span.operation_name || "Unknown Operation",
        serviceName: span.service_name || "Unknown Service",
        spanStatus: span.span_status || "UNSET",
        spanKind: getSpanKind(span.span_kind),
        parentId: span.reference_parent_span_id || "",
        spans: [],
        index: 0,
        style: {
        },
        links: JSON.parse(span.links || "[]"),
        genAiUsage: usage,
        genAiCost: cost,
        resolvedIdentity: resolveSpanIdentity(span),
      };
    };

    const convertTime = (time: number) => {
      return Number((time / 1000).toFixed(2));
    };

    const convertTimeFromNsToUs = (time: number) => {
      const nanoseconds = time;
      const microseconds = Math.floor(nanoseconds / 1000);
      return microseconds;
    };

    const convertTimeFromNsToMs = (time: number) => {
      const nanoseconds = time;
      const milliseconds = Math.floor(nanoseconds / 1000000);
      const date = new Date(milliseconds);
      return date.getTime();
    };

    const getSpanKind = (spanKind: string | null | undefined): string => {
      if (spanKind === null || spanKind === undefined || spanKind === "") {
        return "Unspecified";
      }
      return SPAN_KIND_MAP[String(spanKind)] || String(spanKind);
    };

    const closeSidebar = () => {
      hoveredSpanId.value = "";
      searchObj.data.traceDetails.showSpanDetails = false;
      searchObj.data.traceDetails.selectedSpanId = null;
    };
    const toggleSpanCollapse = (spanId: number | string) => {
      collapseMapping.value[spanId] = !collapseMapping.value[spanId];
      index = 0;
      spanPositionList.value = [];
      traceTree.value.forEach((span: any) => {
        addSpansPositions(span, 0);
      });
    };
    const buildTraceChart = () => {
      const data: any = [];
      for (let i = spanPositionList.value.length - 1; i > -1; i--) {
        const absoluteStartTime =
          spanPositionList.value[i].startTimeUs -
          convertTimeFromNsToUs(traceTree.value[0].lowestStartTime * 1000);

        const x1 = Number(
          (absoluteStartTime + spanPositionList.value[i].durationMs).toFixed(4),
        );

        data.push({
          x0: absoluteStartTime,
          x1,
          fillcolor: spanPositionList.value[i].style.color,
        });
      }
      traceChart.value.data = data;
      ChartData.value = convertTimelineData(traceChart);

      nextTick(() => {
        updateChart({});
      });
    };

    const updateChart = (data: any) => {
      // If dataZoom is not set, set the time range to the start and end of the trace duration
      let newStart: number;
      let newEnd: number;

      if (typeof data.start !== "number" || typeof data.end !== "number") {
        newStart = 0;
        // Safety check to ensure trace chart data exists
        if (
          traceTree.value[0].highestEndTime > 0 &&
          traceTree.value[0].lowestStartTime > 0 &&
          traceTree.value[0].highestEndTime > traceTree.value[0].lowestStartTime
        ) {
          newEnd =
            (traceTree.value[0].highestEndTime -
              traceTree.value[0].lowestStartTime) /
            1000;
        } else {
          newEnd = 0;
        }
      } else {
        newStart = data.start || 0;
        newEnd = data.end || 0;
      }

      // Update time range atomically to prevent race conditions
      timeRange.value = {
        start: newStart,
        end: newEnd,
      };

      calculateTracePosition();
      updateHeight();
    };

    // Resizers are now handled by useResizer composable

    const toggleTimeline = () => {
      isTimelineExpanded.value = !isTimelineExpanded.value;
    };

    const copyTraceId = () => {
      copyToClipboard(spanList.value[0]["trace_id"], {
        successMessage: "Trace ID copied to clipboard",
      });
    };

    const sessionId = computed<string>(() =>
      resolveSessionId(spanList.value),
    );

    const copySessionId = () => {
      if (!sessionId.value) return;
      copyToClipboard(sessionId.value, {
        successMessage: "Session ID copied to clipboard",
      });
    };

    /**
     * Computed property for trace details share URL
     * Uses custom time range from router query params
     */
    const traceDetailsShareURL = computed(() => {
      const queryParams = getUrlQueryParams(true);

      // Override with custom time range from route
      const customFrom = router.currentRoute.value.query.from as string;
      const customTo = router.currentRoute.value.query.to as string;

      if (customFrom) queryParams.from = customFrom;
      if (customTo) queryParams.to = customTo;

      if(effectiveStreamName.value){
        queryParams.stream = effectiveStreamName.value as string;
      }

      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        searchParams.append(key, String(value));
      }
      const queryString = searchParams.toString();

      let shareURL = window.location.origin + window.location.pathname;

      if (queryString != "") {
        shareURL += "?" + queryString;
      }

      return shareURL;
    });

    const redirectToLogs = () => {
      if (!searchObj.data.traceDetails.selectedTrace) {
        return;
      }

      store.dispatch("logs/setIsInitialized", false);

      const stream: string =
        config.isEnterprise === "true"
          ? logStreams.value.join(",")
          : searchObj.data.traceDetails.selectedLogStreams.join(",");
      const from =
        searchObj.data.traceDetails.selectedTrace?.trace_start_time - 60000000;
      const to =
        searchObj.data.traceDetails.selectedTrace?.trace_end_time + 60000000;
      const refresh = 0;

      const query = b64EncodeUnicode(
        `${quoteSqlIdentifierIfNeeded(String(store.state.organizationData?.organizationSettings?.trace_id_field_name))}='${spanList.value[0]["trace_id"]}'`,
      );

      router.push({
        path: "/logs",
        query: {
          stream_type: "logs",
          stream,
          from,
          to,
          refresh,
          sql_mode: "false",
          query,
          org_identifier: store.state.selectedOrganization.identifier,
          show_histogram: "true",
          type: "trace_explorer",
          quick_mode: "false",
        },
      });
    };

    const handleTreeViewCorrelatedLogs = (span: any) => {
      const spanId = span.spanId || span.span_id;
      updateSelectedSpan(spanId);

      const correlationData = searchObj.data.traceDetails.correlationProps;
      if (correlationData) {
        navigateToCorrelatedLogs(correlationData);
      }
    };

    const redirectToSessionReplay = () => {
      if (
        !firstRumSessionData.value ||
        !firstRumSessionData.value.rum_session_id
      ) {
        return;
      }

      router.push({
        name: "SessionViewer",
        params: {
          id: firstRumSessionData.value.rum_session_id,
        },
        query: {
          start_time:
            Math.floor(firstRumSessionData.value.start_time / 1000) - 1000000,
          end_time:
            Math.ceil(firstRumSessionData.value.end_time / 1000) + 1000000,
          event_time: firstRumSessionData.value.rum_date,
        },
      });
    };

    const filterStreamFn = (val: any = "") => {
      filteredStreamOptions.value = logStreams.value.filter((stream: any) => {
        return stream.toLowerCase().indexOf(val.toLowerCase()) > -1;
      });
    };

    const openTraceDetails = () => {
      searchObj.data.traceDetails.showSpanDetails = true;
      showTraceDetails.value = true;
    };

    const scrollSpanIntoView = (spanId: string) => {
      nextTick(() => {
        traceTreeRef.value?.scrollToSpan(spanId);
      });
    };

    const updateSelectedSpan = (
      spanId: string,
      swichToWaterfall: boolean = false,
    ) => {
      hoveredSpanId.value = ""; // clear any hover state on click
      showTraceDetails.value = false;
      searchObj.data.traceDetails.showSpanDetails = true;
      searchObj.data.traceDetails.selectedSpanId = spanId;
      if (swichToWaterfall && activeTab.value !== "waterfall") {
        activeTab.value = "waterfall";
      }

      scrollSpanIntoView(spanId);

      // Emit event for embedded mode
      if (props.mode === "embedded") {
        emit("spanSelected", spanMap.value[spanId]);
      }
    };

    const handleDAGNodeClick = (spanId: string) => {
      updateSelectedSpan(spanId);
    };

    const handleBackOrClose = () => {
      if (props.mode === "embedded") {
        emit("close");
      } else {
        if (areFiltersAdded.value) {
          applyAndViewTraces();
        } else {
          routeToTracesList();
        }
      }
    };

    const applyFilterImmediately = ({
      field,
      value,
      operator,
    }: {
      field: string;
      value: string;
      operator: "=" | "!=";
    }) => {
      const term = buildFilterTerm(field, value, operator);
      localEditorValue.value = applyFilterTerm(term, localEditorValue.value);
      areFiltersAdded.value = true;
      applyAndViewTraces();
    };

    const handleExpandToFullView = () => {
      const query: any = {
        trace_id: effectiveTraceId.value,
        stream: effectiveStreamName.value,
        from: effectiveTimeRange.value.from.toString(),
        to: effectiveTimeRange.value.to.toString(),
        org_identifier: effectiveOrgIdentifier.value,
      };

      // Add log_stream parameter for correlation navigation
      // Priority: correlatedLogStream prop > query parameter
      const logStreamQueryValue = router.currentRoute.value.query.log_stream;
      const logStreamFromQuery = Array.isArray(logStreamQueryValue)
        ? logStreamQueryValue[0]
        : logStreamQueryValue;
      const logStreamToUse = props.correlatedLogStream || logStreamFromQuery;
      if (logStreamToUse) {
        query.log_stream = logStreamToUse;
      }

      const route = router.resolve({
        name: "traceDetails",
        query,
      });

      window.open(route.href, "_blank");
    };

    const routeToTracesList = () => {
      // Only navigate if in standalone mode
      if (props.mode !== "standalone") return;

      const query = cloneDeep(router.currentRoute.value.query);
      delete query.trace_id;

      if (searchObj.data.datetime.type === "relative") {
        query.period = searchObj.data.datetime.relativeTimePeriod;
      } else {
        query.from = searchObj.data.datetime.startTime.toString();
        query.to = searchObj.data.datetime.endTime.toString();
      }

      router.push({
        name: "traces",
        query: {
          ...query,
        },
      });
    };

    const openTraceLink = async () => {
      resetTraceDetails();
      await setupTraceDetails();
    };

    return {
      router,
      t,
      // Exposed for the template `v-if` gating the LLM Observability
      // surfaces (Thread tab toggle + ThreadView body) behind
      // `config.showLLMUI`.
      config,
      activeTab,
      sidebarActiveTab,
      traceTree,
      collapseMapping,
      traceRootSpan,
      baseTracePosition,
      searchObj,
      spanList,
      isSidebarOpen,
      selectedSpanId,
      hoveredSpanId,
      effectiveSpanId,
      onHoverSpan,
      onUnhoverSpan,
      spanMap,
      closeSidebar,
      toggleSpanCollapse,
      spanPositionList,
      spanDimensions,
      splitterModel,
      ChartData,
      traceChart,
      updateChart,
      traceServiceMap,
      traceServiceMapChartOptions,
      chartRendererRef,
      activeVisual,
      traceVisuals,
      getImageURL,
      store,
      leftWidth,
      sidebarWidth,
      startResize,
      isTimelineExpanded,
      toggleTimeline,
      copyToClipboard,
      copyTraceId,
      sessionId,
      copySessionId,
      traceDetailsShareURL,
      "info": "info",
      outlinedPlayCircle: "play-circle",
      redirectToLogs,
      handleTreeViewCorrelatedLogs,
      redirectToSessionReplay,
      hasRumSessionId,
      firstRumSessionData,
      filteredStreamOptions,
      filterStreamFn,
      streamSearchValue,
      selectedStreamsString,
      isViewLogsDisabled,
      openTraceDetails,
      showTraceDetails,
      traceDetails,
      updateSelectedSpan,
      routeToTracesList,
      handleExpandToFullView,
      openTraceLink,
      convertTimeFromNsToMs,
      searchQuery,
      handleSearchQueryChange,
      traceTreeRef,
      nextMatch,
      prevMatch,
      currentIndex,
      handleIndexUpdate,
      handleSearchResult,
      searchResults,
      parentContainer,
      traceScrollContainer,
      parentHeight,
      updateHeight,
      getSpanKind,
      adjustOpacity,
      buildTracesTree,
      getFormattedSpan,
      buildTraceChart,
      validateSpan,
      calculateTracePosition,
      fetchRumEventsForTrace,
      formatRumEventsAsSpans,
      buildServiceTree,
      // Correlation props
      currentTraceStreamName,
      serviceStreamsEnabled,
      // New computed properties for mode-based priority
      effectiveTraceId,
      effectiveStreamName,
      effectiveTimeRange,
      effectiveOrgIdentifier,
      shouldFetchData,
      effectiveSpanList,
      // New event handlers
      handleBackOrClose,
      handleDAGNodeClick,
      // Filter-from-trace-details
      areFiltersAdded,
      showFilterPopover,
      filterDialogReady,
      localEditorValue,
      addFilterFromSidebar,
      applyFilterImmediately,
      openFilterPopover,
      applyAndViewTraces,
      // DAG resize
      dagLeftWidth,
      startDagResize,
      // LLM traces check
      hasLLMSpans,
      // New header computed properties
      errorSpansCount,
      rootServiceName,
      traceStartTime,
      formatTimestamp,
      // FlameGraph data
      flatSpans,
      traceMetadata,
      formatLargeNumber,
      updateActiveTab
    };
  },
});
</script>

<style scoped lang="scss">
$sidebarWidth: 84%;
$separatorWidth: 2px;
$toolbarHeight: 36px;
$traceHeaderHeight: 30px;
$traceChartHeight: 210px;
$appNavbarHeight: 57px;

$traceChartCollapseHeight: 42px;

.toolbar {
  height: $toolbarHeight;
}
.trace-details {
  overflow: hidden;
  width: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.trace-details-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.histogram-container-full {
  flex: 1;
  min-height: 0;
}
.histogram-container {
  flex: 1;
  min-height: 0;
}

.histogram-sidebar-inner {
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  transition: all 0.3s ease-in-out;
}

.histogram-spans-container {
  min-height: 0;
  position: relative;
  padding-bottom: 0.5rem;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.trace-tree-wrapper {
  overflow: hidden;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.trace-tree-container {
  padding-top: 0;
  padding-bottom: 0;
  margin-bottom: 0;
  min-height: 100%;
}

.trace-chart-btn {
  cursor: pointer;
  padding-right: 8px;
  border-radius: 2px;
  padding-top: 3px;
  padding-bottom: 2px;

  &:hover {
    background-color: var(--o2-primary-btn-bg);
    color: #ffffff;
}
}


.toolbar-operation-name {
  max-width: 225px;
}

.dag-left-panel {
  height: calc(100vh - 200px);
  padding: 16px;
  min-width: 0;
  overflow: hidden;
}

.dag-right-panel {
  height: calc(100vh - 200px);
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

.dag-resizer {
  width: 8px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 10;

  &:hover .dag-resizer-line {
    background-color: var(--o2-theme-color, #1976d2);
  }
}

.dag-resizer-line {
  width: 3px;
  height: 100%;
  background-color: #e0e0e0;
  border-radius: 2px;
  transition: background-color 0.2s ease;
}

body.body--dark .dag-resizer-line {
  background-color: #3c3c3c;
}

body.body--dark .dag-resizer:hover .dag-resizer-line {
  background-color: #90caf9;
}
</style>
<style lang="scss">
// Prevent parent containers from adding scrollbars
body:has(.trace-details),
html:has(.trace-details) {
  overflow: hidden !important;
}

.histogram-container .trace-content-scroll {
  flex: 1 !important;
  max-width: 100% !important;
}

.histogram-container-full .trace-content-scroll {
  flex: 1 !important;
  max-width: 100% !important;
}

.trace-content-scroll {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  min-height: 0 !important;
  scrollbar-gutter: stable !important;
}

.trace-details {
  .q-splitter__before,
  .q-splitter__after {
    overflow: revert !important;
  }

  .q-splitter__before {
    z-index: 999 !important;
  }

  .trace-details-chart {
    .rangeslider-slidebox {
      fill: #7076be !important;
      opacity: 0.3 !important;
    }
    .rangeslider-mask-max,
    .rangeslider-mask-min {
      fill: #d2d2d2 !important;
      fill-opacity: 0.15 !important;
    }
    .rangeslider-grabber {
      fill: #7076be !important;
      stroke: #ffffff !important;
      stroke-width: 2 !important;
      opacity: 1 !important;
    }
    .rangeslider-grabber:hover {
      fill: #5a5fa0 !important;
      cursor: ew-resize !important;
    }
    // Enhance the line graph (trace duration) visibility
    .trace {
      stroke-width: 2 !important;
      opacity: 0.8 !important;
    }
    .scatterlayer .trace {
      opacity: 1 !important;
    }
  }

  .visual-selection-btn {
}

  .visual-selector-container {
    backdrop-filter: blur(0.625rem);
    border-radius: 0.25rem;
    border: 0.0625rem solid var(--o2-border-color);
  }

  .trace-combined-header-wrapper {
    padding: 0.2rem 0rem;
    flex-shrink: 0;
  }

  .trace-combined-header-wrapper.bg-white {
    // background: rgba(240, 240, 245, 0.8);
    // border: 0.125rem solid rgba(100, 100, 120, 0.3);
  }
  .chart-container-inner {
    min-height: 12.5rem;
    overflow: hidden;
  }

  .trace-chart-height {
    height: 12.5rem !important;
    min-height: 12.5rem !important;
  }
}

.no-select {
  user-select: none !important;
  -moz-user-select: none !important;
  -webkit-user-select: none !important;
  -ms-user-select: none !important;
}

.trace-copy-icon {
  &:hover {
    &.OIcon {
      text-shadow: 0px 2px 8px rgba(0, 0, 0, 0.5);
    }
  }
}

.trace-logs-selector {
  .q-field {
    border-radius: 0.2rem 0 0 0.2rem;

    span {
      display: inline-block;
      width: 180px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
    }

    .q-field__control {
      border-radius: 0.2rem 0 0 0.2rem !important;
    }

    .q-field__control:before,
    .q-field__control:after {
      border: none !important;
    }
  }
}

// Unified Search Group - input and navigation as one element
.unified-search-group {
  display: flex;
  align-items: stretch;
  width: fit-content;
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease;
}

// Search Navigation Container - integrated with input
.search-navigation-container {
  display: inline-flex;
  align-items: center;
  background-color: transparent;
  padding: 0 0.125rem;
  transition: all 0.2s ease;
  border-radius: var(--radius-md);
  border: 0.0625rem solid var(--color-input-border);

  .search-results-counter {
    display: flex;
    align-items: center;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0 0.25rem;
    gap: 0.0625rem;
    user-select: none;

    .counter-separator {
      color: var(--o2-text-secondary);
      margin: 0 0.125rem;
    }

    .counter-total,
    .counter-current {
      color: var(--o2-text-secondary);
    }
  }

  .navigation-buttons {
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: 0.25rem;

    .button-separator {
      width: 0.0625rem;
      height: 1.125rem;
      background-color: var(--o2-border-color);
      margin: 0 0.125rem;
    }

    .nav-btn {
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0;
      border-radius: 0.125rem;
      transition: all 0.2s ease;
&:hover:not(:disabled) {
        background-color: var(--o2-hover-accent);
      }

      &:disabled {
        opacity: 0.4;
      }
    }
  }
}

// Dark mode support
body.body--dark {
  .unified-search-group {
    background-color: var(--o2-dark-page-bg);

    &:hover,
    &:focus-within {
      border-color: var(--o2-theme-color);
    }
  }

  .search-navigation-container {
    &:hover {
      border-color: var(--o2-theme-color);
    }
  }
}

.custom-height {
  height: 30px;
}

.trace-search-container {
  border-radius: 0.5rem;
}

.trace-back-btn {
  border: 0.09375rem solid;
  border-radius: 50%;
  width: 1.375rem;
  height: 1.375rem;
}

.custom-height .q-field__control,
.custom-height .q-field__append {
  height: 100%; /* Ensures the input control fills the container height */
  line-height: 36px; /* Vertically centers the text inside */
}
.resize::after {
  content: " ";
  position: absolute;
  height: 100%;
  left: -10px;
  right: -10px;
  top: 0;
  bottom: 0;
  z-index: 999;
}
</style>

<style lang="scss">
.trace-details-view-tabs {
  .o2-tabs .active {
    background-color: transparent !important;
    color: var(--q-primary) !important;
    border-color: var(--q-primary) !important;
  }
}
</style>
