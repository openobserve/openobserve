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
  <!-- Dialog Mode -->
  <ODrawer
    data-test="telemetry-correlation-dashboard-drawer"
    bleed
    v-if="props.mode === 'dialog'"
    v-model:open="isOpen"
    side="right"
    :width="90"
    :title="`Correlated Streams - ${serviceName}`"
    :sub-title="formatTimeRange(timeRange)"
    @update:open="(v) => !v && onClose()"
  >
    <template #header-left>
      <OIcon name="link" size="md" />
    </template>

    <!-- Dimensions Display - Stable (matched) and Unstable (additional) -->
    <div class="py-2 px-4 border-b border-solid border-card-glass-border">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs font-semibold opacity-70"> {{ t("correlation.filters") }}: </span>
        <div v-for="(value, key) in pendingDimensions" :key="key" class="flex items-center gap-2">
          <span
            class="text-xs font-semibold"
            :class="unstableDimensionKeys.has(key) ? 'opacity-60' : 'opacity-100'"
          >
            {{ key }}:
          </span>
          <OSelect
            v-model="pendingDimensions[key]"
            :options="getDimensionOptions(key, value)"
            labelKey="label"
            valueKey="value"
            @update:model-value="onPendingDimensionChange"
            class="dimension-dropdown"
            style="min-width: 120px"
          />
          <OTooltip
            v-if="unstableDimensionKeys.has(key)"
            content="Unstable dimension - changes on pod restart. Default: All values."
            side="top"
          />
        </div>
        <!-- Apply Button -->
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!hasPendingChanges"
          @click="applyDimensionChanges"
          class="ml-2"
          data-test="apply-dimension-filters"
        >
          {{ t("common.apply") }}
        </OButton>
      </div>
    </div>

    <!-- Source event + chips (dialog mode) -->
    <CorrelationEventHeader
      :source-event="sourceEvent"
      :context-chips="contextChips"
      :subject-chips="isNestedGroupMode ? [] : subjectChips"
      v-model:active-subject="activeSubject"
      overflow-mode="responsive"
      :get-subject-button-label="getSubjectButtonLabel"
    />

    <!-- Tabs (only in dialog mode, hidden in embedded-tabs mode) -->
    <div class="px-page-edge">
      <OTabs v-if="!isEmbeddedTabs" v-model="activeTab" dense bordered align="left">
        <OTab name="logs" :label="t('common.logs')" />
        <OTab name="metrics" :label="t('search.metrics')" />
        <OTab name="traces" :label="t('menu.traces')" />
      </OTabs>
    </div>
    <div class="correlation-content">
      <OTabPanels v-model="activeTab" animated grow scroll="auto">
        <!-- Logs Tab Panel -->
        <OTabPanel name="logs">
          <!-- Refresh Button (dialog mode) -->
          <div
            v-if="logsDashboardData"
            class="p-2 border-b border-solid border-card-glass-border flex justify-end"
          >
            <OButton variant="ghost" size="sm-action" @click="loadDashboard" :loading="loading">
              <OIcon name="refresh" size="xs" class="mr-1" />
              {{ t("common.refresh") }}
            </OButton>
          </div>

          <!-- Loading State -->
          <div v-if="loading" class="flex flex-col items-center justify-center h-full py-20 gap-3">
            <OSpinner size="sm" />
            <div class="text-sm opacity-70">
              {{ t("correlation.loadingLogs") }}
            </div>
          </div>

          <!-- Logs Dashboard -->
          <RenderDashboardCharts
            v-else-if="logsDashboardData"
            :key="logsDashboardRenderKey"
            :dashboardData="logsDashboardData"
            :currentTimeObj="currentTimeObj"
            :viewOnly="true"
            :allowAlertCreation="false"
            searchType="dashboards"
          />

          <!-- No Logs State -->
          <div v-else class="flex flex-col items-center justify-center h-full py-20">
            <div class="text-base font-medium mb-2 opacity-90">
              {{ t("correlation.noLogsFound") }}
            </div>
            <div class="text-sm opacity-70">
              {{ t("correlation.noLogsDescription") }}
            </div>
          </div>
        </OTabPanel>

        <!-- Metrics Tab Panel -->
        <OTabPanel name="metrics" layout="flex-col" stretch class="min-h-0">
          <!-- Two-column body: sidebar + charts (splitter matching TracesAnalysisDashboard style) -->
          <OSplitter
            v-model="splitterModel"
            class="flex-1 min-h-0 h-full max-h-full overflow-hidden w-full"
          >
            <!-- -- Left sidebar -- -->
            <template #before>
              <div class="h-full min-h-0 flex flex-col bg-surface-overlay">
                <!-- Search -->
                <div
                  class="dimension-sidebar-search-container px-1.5 py-2 border-b border-solid border-card-glass-border"
                >
                  <OSearchInput
                    v-model="metricSearchText"
                    :placeholder="t('search.searchField')"
                    clearable
                  />
                </div>

                <!-- Grouped metric list -->
                <div
                  class="dimension-list-container flex-1 min-h-0 overflow-y-auto px-1.5"
                  style="max-height: calc(100vh - 210px)"
                >
                  <template
                    v-if="groupedFilteredMetricStreams.groups.some((g) => g.streams.length > 0)"
                  >
                    <template v-for="group in groupedFilteredMetricStreams.groups" :key="group.id">
                      <template v-if="group.streams.length > 0">
                        <div
                          class="flex items-center justify-between py-1.5 px-2 bg-section-header-bg border-b border-solid border-border-default sticky top-0 z-10 cursor-pointer"
                          @click="toggleGroupCollapse(group.id)"
                        >
                          <div
                            class="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.05em] opacity-75"
                          >
                            <OIcon
                              :name="
                                collapsedGroups.has(group.id) ? 'chevron-right' : 'expand-more'
                              "
                              size="sm"
                              class="mr-0.5"
                            />
                            <OIcon
                              v-if="typeof group.icon === 'string'"
                              :name="group.icon"
                              size="xs"
                              class="mr-0.5"
                            />
                            <component v-else :is="group.icon" />
                            <span>{{ group.label }}</span>
                            <OTag type="fieldTag" class="ml-1">{{ group.streams.length }}</OTag>
                          </div>
                          <div class="flex gap-1">
                            <OButton
                              variant="ghost"
                              size="chip"
                              @click.stop="selectAllInGroup(group.id)"
                              :disabled="getGroupSelectionState(group.id) === 'all'"
                            >
                              All
                            </OButton>
                            <OButton
                              variant="ghost"
                              size="chip"
                              @click.stop="deselectAllInGroup(group.id)"
                              :disabled="getGroupSelectionState(group.id) === 'none'"
                            >
                              None
                            </OButton>
                          </div>
                        </div>
                        <div
                          v-for="stream in group.streams"
                          v-show="!collapsedGroups.has(group.id)"
                          :key="stream.stream_name"
                          data-test="telemetry-correlation-metric-stream-item"
                          class="border-none! flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.05)]"
                          @click="toggleMetricStream(stream)"
                        >
                          <div class="flex items-center shrink-0">
                            <OCheckbox
                              :model-value="
                                selectedMetricStreams.some(
                                  (s) => s.stream_name === stream.stream_name,
                                )
                              "
                              size="xs"
                              @update:model-value="toggleMetricStream(stream)"
                            />
                          </div>
                          <div class="flex flex-col flex-1 min-w-0">
                            <span class="truncate cursor-pointer text-text-secondary! text-sm">{{
                              stream.stream_name
                            }}</span>
                          </div>
                        </div>
                      </template>
                    </template>
                  </template>
                  <div v-else class="text-center px-2 pt-3">
                    <OIcon name="info" size="sm" class="align-middle mr-1" />
                    {{ t("search.noResult") }}
                  </div>
                </div>

                <!-- Footer: selected count -->
                <div class="p-3 border-t border-solid border-card-glass-border text-xs font-normal">
                  {{ selectedMetricStreams.length }} of {{ uniqueMetricStreams.length }} selected
                </div>
              </div>
            </template>

            <!-- -- Separator -- -->
            <template #separator>
              <div
                class="w-px h-full bg-border-default cursor-col-resize dark:bg-[rgba(255,255,255,0.12)]"
              />
            </template>

            <!-- -- Right area: group tabs + dashboard -- -->
            <template #after>
              <div class="flex flex-col h-full overflow-hidden">
                <!-- Outer Pod/Node tabs — only shown in nested K8s mode -->
                <OTabs
                  v-if="isNestedGroupMode"
                  v-model="activeOuterTab"
                  dense
                  align="left"
                  class="px-page-edge shrink-0 border-b border-solid border-card-glass-border"
                >
                  <OTab v-for="outerGroup in groupDefs" :key="outerGroup.id" :name="outerGroup.id">
                    <div class="flex flex-col items-start min-w-0">
                      <div class="flex items-center gap-1">
                        <OIcon
                          v-if="typeof outerGroup.icon === 'string'"
                          :name="outerGroup.icon"
                          size="xs"
                        />
                        <component v-else :is="outerGroup.icon" />
                        <span class="whitespace-nowrap">{{ outerGroup.label }}</span>
                      </div>
                      <span
                        v-if="outerTabResourceName[outerGroup.id]"
                        class="text-xs leading-tight opacity-75 truncate max-w-40"
                        :title="outerTabResourceName[outerGroup.id]"
                        >{{ outerTabResourceName[outerGroup.id] }}</span
                      >
                    </div>
                  </OTab>
                </OTabs>

                <!-- Group tabs -->
                <OTabs
                  v-if="nonEmptyGroupTabs.length > 0"
                  v-model="activeMetricGroupTab"
                  dense
                  align="left"
                  class="px-page-edge shrink-0 bg-surface-panel border-b border-solid border-card-glass-border"
                >
                  <OTab
                    v-for="group in groupedUniqueMetricStreams.groups.filter((g) =>
                      nonEmptyGroupTabs.includes(g.id),
                    )"
                    :key="group.id"
                    :name="group.id"
                  >
                    <div class="flex items-center gap-1">
                      <OIcon v-if="typeof group.icon === 'string'" :name="group.icon" size="xs" />
                      <component v-else :is="group.icon" />
                      <span>{{ group.label }}</span>
                      <OTag
                        type="tabChip"
                        :value="activeMetricGroupTab === group.id ? 'active' : 'inactive'"
                        class="ml-1"
                        :class="{
                          'opacity-40':
                            (groupedSelectedMetricStreams.byGroup[group.id]?.length ?? 0) === 0,
                        }"
                        >{{ groupedSelectedMetricStreams.byGroup[group.id]?.length ?? 0 }}</OTag
                      >
                    </div>
                  </OTab>
                </OTabs>

                <!-- Dashboard content -->
                <div class="flex-1 min-h-0 overflow-auto">
                  <div
                    v-if="loading"
                    class="flex flex-col items-center justify-center h-full py-20 gap-3"
                  >
                    <OSpinner size="sm" />
                    <div class="text-sm opacity-70">
                      {{
                        t("correlation.loadingMetrics", {
                          count: selectedMetricStreams.length,
                        })
                      }}
                    </div>
                  </div>
                  <div
                    v-else-if="error"
                    class="flex flex-col items-center justify-center h-full py-20"
                  >
                    <div class="text-base font-medium mb-2 opacity-90">
                      {{ t("correlation.metricsError") }}
                    </div>
                    <div class="text-sm opacity-70 mb-4">
                      {{ error || t("correlation.metricsErrorDetails") }}
                    </div>
                    <OButton variant="ghost" size="sm-action" @click="loadDashboard">
                      <OIcon name="refresh" size="xs" class="mr-1" />
                      {{ t("correlation.retryButton") }}
                    </OButton>
                  </div>
                  <RenderDashboardCharts
                    v-else-if="activeDashboardForGroup"
                    ref="dashboardChartsRef"
                    :key="activeMetricGroupTab + '_' + groupedDashboardRenderKey"
                    :dashboardData="activeDashboardForGroup"
                    :currentTimeObj="currentTimeObj"
                    :viewOnly="true"
                    :allowAlertCreation="false"
                    searchType="dashboards"
                  />
                  <div
                    v-else
                    class="flex flex-col items-center justify-center h-[calc(100vh-7.5rem)] py-20"
                  >
                    <div class="text-base font-medium mb-2 opacity-90">
                      {{ t("correlation.noMetrics") }}
                    </div>
                    <div class="text-sm opacity-70">
                      {{ t("correlation.noMetricsDescription") }}
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </OSplitter>
        </OTabPanel>

        <!-- Traces Tab Panel -->
        <OTabPanel name="traces">
          <!-- Refresh Button -->

          <!-- Loading State -->
          <div
            v-if="tracesLoading"
            class="flex flex-col items-center justify-center h-full py-20 gap-3"
          >
            <OSpinner size="sm" />
            <div class="text-sm opacity-70">
              {{ t("correlation.loadingTraces") }}
            </div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="tracesError"
            class="flex flex-col items-center justify-center h-full py-20"
          >
            <div class="text-base font-medium mb-2 opacity-90">
              {{ t("correlation.tracesError") }}
            </div>
            <div class="text-sm opacity-70 mb-4">
              {{ tracesError || t("correlation.tracesErrorDetails") }}
            </div>
            <OButton variant="ghost" size="sm-action" @click="loadCorrelatedTraces">
              <OIcon name="refresh" size="xs" class="mr-1" />
              {{ t("correlation.retryButton") }}
            </OButton>
          </div>

          <!-- Direct Trace Correlation - Full Span List -->
          <div
            v-else-if="traceCorrelationMode === 'direct' && traceSpanList.length > 0"
            class="h-full overflow-hidden telemetry-correlation-traces"
          >
            <TraceDetails
              mode="embedded"
              :trace-id-prop="extractedTraceId || ''"
              :stream-name-prop="sortedTraceStreams[0] ? sortedTraceStreams[0].stream_name : ''"
              :span-list-prop="traceSpanList"
              :start-time-prop="computedTraceStartTime"
              :end-time-prop="computedTraceEndTime"
              :correlated-log-stream="sortedLogStreams[0] ? sortedLogStreams[0].stream_name : ''"
              :show-back-button="false"
              :show-timeline="false"
              :show-log-stream-selector="false"
              :show-share-button="false"
              :show-close-button="false"
              :show-expand-button="true"
              :enable-correlation-links="true"
              :initial-timeline-expanded="false"
            />
          </div>

          <!-- Dimension-based Correlation - Traces List -->
          <div
            v-else-if="traceCorrelationMode === 'dimension-based' && tracesForDimensions.length > 0"
            class="h-full"
          >
            <!-- Header -->
            <div class="p-3 border-b border-solid border-card-glass-border bg-surface-panel">
              <div class="flex items-center gap-3">
                <OIcon name="hub" size="md" />
                <div class="flex flex-col">
                  <span class="text-sm font-semibold">{{
                    t("correlation.dimensionBasedCorrelation")
                  }}</span>
                  <span class="text-xs text-text-secondary">{{
                    t("correlation.tracesFromService", { service: serviceName })
                  }}</span>
                </div>
                <div class="ml-auto flex items-center gap-2">
                  <OButton
                    variant="ghost"
                    size="sm-action"
                    @click="openTracesPage"
                    data-test="correlation-view-traces-page"
                    class="text-xs"
                  >
                    <OIcon name="open-in-new" size="xs" class="mr-1" />
                    {{ t("correlation.viewInTraces") }}
                    <OTooltip :content="t('correlation.viewInTraces')" side="top" />
                  </OButton>
                  <OTag type="fieldTag" value="primary">
                    {{ tracesForDimensions.length }} {{ t("menu.traces") }}
                  </OTag>
                </div>
              </div>
            </div>

            <!-- Traces List -->
            <div class="h-full">
              <TracesSearchResultList
                :hits="tracesForDimensions"
                :loading="false"
                :show-header="false"
                :show-cell-actions="false"
                @row-click="openTraceInNewWindow"
              />
            </div>
          </div>

          <!-- No Traces Found State -->
          <div v-else-if="traceCorrelationMode !== null" class="min-h-80">
            <OEmptyState
              size="hero"
              illustration="trace"
              :title="t('correlation.noTracesFound')"
              :description="t('correlation.noTracesDescription')"
              data-test="correlation-no-traces-state-drawer"
            />
          </div>

          <!-- Initial State (waiting for tab to be shown) -->
          <div v-else class="flex flex-col items-center justify-center h-full py-20">
            <div class="text-base font-medium mb-2 opacity-90">
              {{ t("correlation.correlatedTraces") }}
            </div>
            <div class="text-sm opacity-70">
              {{ t("correlation.correlatedTracesFor", { service: serviceName }) }}
            </div>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </ODrawer>

  <!-- Embedded Tabs Mode -->
  <div v-else class="flex flex-col h-full w-full bg-surface-panel">
    <!-- Dimensions Display - Stable (matched) and Unstable (additional) -->
    <DimensionFiltersBar
      v-if="!props.hideDimensionFilters"
      :dimensions="pendingDimensions"
      :unstable-dimension-keys="unstableDimensionKeys"
      :get-dimension-options="getDimensionOptions"
      :has-pending-changes="hasPendingChanges"
      :show-apply-button="true"
      unstable-dimension-tooltip="Unstable dimension - changes on pod restart. Default: All values."
      @update:dimension="handleDimensionUpdate"
      @apply="applyDimensionChanges"
    />

    <!-- Source event + chips (embedded mode) -->
    <CorrelationEventHeader
      :source-event="sourceEvent"
      :context-chips="contextChips"
      :subject-chips="isNestedGroupMode ? [] : subjectChips"
      v-model:active-subject="activeSubject"
      overflow-mode="responsive"
      :get-subject-button-label="getSubjectButtonLabel"
    />

    <!-- Tab Panels (no tabs in embedded mode, controlled by parent) -->
    <OCard
      :class="[
        'flex flex-col flex-1 min-h-0',
        activeTab === 'metrics' ? 'overflow-hidden' : 'overflow-auto',
      ]"
    >
      <div v-if="activeTab == 'logs'" class="flex flex-col flex-1 min-h-0">
        <!-- Refresh Button (embedded mode) -->
        <div
          v-if="logsDashboardData"
          class="p-2 border-b border-solid border-card-glass-border flex justify-end"
        >
          <OButton variant="ghost" size="sm-action" @click="loadDashboard" :loading="loading">
            <OIcon name="refresh" size="xs" class="mr-1" />
            {{ t("common.refresh") }}
          </OButton>
        </div>

        <!-- Loading State -->
        <div
          v-if="loading"
          class="flex flex-col items-center justify-center gap-3 flex-1"
          style="min-height: 300px"
        >
          <OSpinner size="sm" />
          <div class="text-sm opacity-70">
            {{ t("correlation.loadingLogs") }}
          </div>
        </div>

        <!-- Logs Dashboard -->
        <RenderDashboardCharts
          v-else-if="logsDashboardData"
          :key="logsDashboardRenderKey"
          :dashboardData="logsDashboardData"
          :currentTimeObj="currentTimeObj"
          :viewOnly="true"
          :allowAlertCreation="false"
          searchType="dashboards"
        />

        <!-- No Logs State -->
        <div v-else class="flex flex-col items-center justify-center h-full py-20">
          <div class="text-base font-medium mb-2 opacity-90">
            {{ t("correlation.noLogsFound") }}
          </div>
          <div class="text-sm opacity-70">
            {{ t("correlation.noLogsDescription") }}
          </div>
        </div>
      </div>

      <div
        v-if="activeTab == 'metrics'"
        class="h-full flex flex-col overflow-hidden min-h-0 metrics-correlation-dashboard"
      >
        <!-- Two-column body: sidebar + charts (splitter matching TracesAnalysisDashboard style) -->
        <OSplitter
          v-model="splitterModel"
          class="flex-1 min-h-0 h-full max-h-full overflow-hidden w-full"
        >
          <!-- -- Left sidebar -- -->
          <template #before>
            <div class="h-full min-h-0 flex flex-col bg-surface-overlay">
              <div
                class="dimension-sidebar-search-container p-2.5 border-b border-solid border-card-glass-border"
              >
                <OSearchInput
                  v-model="metricSearchText"
                  :placeholder="t('search.searchField')"
                  clearable
                />
              </div>

              <!-- Grouped metric list -->
              <div
                class="dimension-list-container flex-1 min-h-0 overflow-y-auto"
                style="max-height: calc(100vh - 210px)"
              >
                <template
                  v-if="groupedFilteredMetricStreams.groups.some((g) => g.streams.length > 0)"
                >
                  <template v-for="group in groupedFilteredMetricStreams.groups" :key="group.id">
                    <template v-if="group.streams.length > 0">
                      <div
                        class="flex items-center justify-between py-1.5 px-2 bg-section-header-bg border-b border-solid border-border-default sticky top-0 z-10 cursor-pointer"
                        @click="toggleGroupCollapse(group.id)"
                      >
                        <div
                          class="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.05em] opacity-75"
                        >
                          <OIcon
                            :name="collapsedGroups.has(group.id) ? 'chevron-right' : 'expand-more'"
                            size="sm"
                            class="mr-0.5"
                          />
                          <OIcon
                            v-if="typeof group.icon === 'string'"
                            :name="group.icon"
                            size="xs"
                            class="mr-0.5"
                          />
                          <component v-else :is="group.icon" />
                          <span>{{ group.label }}</span>
                          <OTag type="fieldTag" class="ml-1">{{ group.streams.length }}</OTag>
                        </div>
                        <div class="flex gap-1">
                          <OButton
                            variant="ghost"
                            size="chip"
                            @click.stop="selectAllInGroup(group.id)"
                            :disabled="getGroupSelectionState(group.id) === 'all'"
                          >
                            All
                          </OButton>
                          <OButton
                            variant="ghost"
                            size="chip"
                            @click.stop="deselectAllInGroup(group.id)"
                            :disabled="getGroupSelectionState(group.id) === 'none'"
                          >
                            None
                          </OButton>
                        </div>
                      </div>
                      <div
                        v-for="stream in group.streams"
                        v-show="!collapsedGroups.has(group.id)"
                        :key="stream.stream_name"
                        data-test="telemetry-correlation-metric-stream-item"
                        class="border-none! flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.05)]"
                        @click="toggleMetricStream(stream)"
                      >
                        <div class="flex items-center shrink-0">
                          <OCheckbox
                            :model-value="
                              selectedMetricStreams.some(
                                (s) => s.stream_name === stream.stream_name,
                              )
                            "
                            size="xs"
                            @update:model-value="toggleMetricStream(stream)"
                          />
                        </div>
                        <div class="flex flex-col flex-1 min-w-0">
                          <span class="truncate cursor-pointer text-text-secondary! text-sm">{{
                            stream.stream_name
                          }}</span>
                        </div>
                      </div>
                    </template>
                  </template>
                </template>
                <div v-else class="text-center px-2 pt-3">
                  <OIcon name="info" size="sm" class="align-middle mr-1" />
                  {{ t("search.noResult") }}
                </div>
              </div>

              <!-- Footer: selected count -->
              <div class="p-3 border-t border-solid border-card-glass-border text-xs font-normal">
                {{ selectedMetricStreams.length }} of {{ uniqueMetricStreams.length }} selected
              </div>
            </div>
          </template>

          <!-- -- Separator -- -->
          <template #separator>
            <div
              class="w-px h-full bg-border-default cursor-col-resize dark:bg-[rgba(255,255,255,0.12)]"
            />
          </template>

          <!-- -- Right area: group tabs + dashboard -- -->
          <template #after>
            <div class="flex flex-col h-full overflow-hidden">
              <!-- Outer Pod/Node tabs — only shown in nested K8s mode -->
              <OTabs
                v-if="isNestedGroupMode"
                v-model="activeOuterTab"
                dense
                align="left"
                class="shrink-0 border-b border-solid border-card-glass-border"
              >
                <OTab v-for="outerGroup in groupDefs" :key="outerGroup.id" :name="outerGroup.id">
                  <div class="flex flex-col items-start min-w-0">
                    <div class="flex items-center gap-1">
                      <OIcon
                        v-if="typeof outerGroup.icon === 'string'"
                        :name="outerGroup.icon"
                        size="xs"
                      />
                      <component v-else :is="outerGroup.icon" />
                      <span class="whitespace-nowrap text-xs">{{ outerGroup.label }}</span>
                    </div>
                    <span
                      v-if="outerTabResourceName[outerGroup.id]"
                      class="text-xs leading-tight opacity-75 truncate max-w-40"
                      :title="outerTabResourceName[outerGroup.id]"
                      >{{ outerTabResourceName[outerGroup.id] }}</span
                    >
                  </div>
                </OTab>
              </OTabs>

              <!-- Group tabs -->
              <OTabs
                v-if="nonEmptyGroupTabs.length > 0"
                v-model="activeMetricGroupTab"
                dense
                align="left"
                class="shrink-0 bg-surface-panel border-b border-solid border-card-glass-border"
              >
                <OTab
                  v-for="group in groupedUniqueMetricStreams.groups.filter((g) =>
                    nonEmptyGroupTabs.includes(g.id),
                  )"
                  :key="group.id"
                  :name="group.id"
                >
                  <div class="flex items-center gap-1">
                    <component v-if="typeof group.icon !== 'string'" :is="group.icon" />
                    <OIcon v-if="typeof group.icon === 'string'" :name="group.icon" size="xs" />
                    <span>{{ group.label }}</span>
                    <OTag
                      type="tabChip"
                      :value="activeMetricGroupTab === group.id ? 'active' : 'inactive'"
                      class="ml-1"
                      :class="{
                        'opacity-40':
                          (groupedSelectedMetricStreams.byGroup[group.id]?.length ?? 0) === 0,
                      }"
                      >{{ groupedSelectedMetricStreams.byGroup[group.id]?.length ?? 0 }}</OTag
                    >
                  </div>
                </OTab>
              </OTabs>

              <!-- Dashboard content -->
              <div class="flex-1 min-h-0 overflow-auto">
                <div
                  v-if="loading"
                  class="flex flex-col items-center justify-center h-full py-20 gap-3"
                >
                  <OSpinner size="sm" />
                  <div class="text-sm opacity-70">
                    {{
                      t("correlation.loadingMetrics", {
                        count: selectedMetricStreams.length,
                      })
                    }}
                  </div>
                </div>
                <div
                  v-else-if="error"
                  class="flex flex-col items-center justify-center h-full py-20"
                >
                  <div class="text-base font-medium mb-2 opacity-90">
                    {{ t("correlation.metricsError") }}
                  </div>
                  <div class="text-sm opacity-70 mb-4">
                    {{ error || t("correlation.metricsErrorDetails") }}
                  </div>
                  <OButton variant="ghost" size="sm-action" @click="loadDashboard">
                    <OIcon name="refresh" size="xs" class="mr-1" />
                    {{ t("correlation.retryButton") }}
                  </OButton>
                </div>
                <RenderDashboardCharts
                  v-else-if="activeDashboardForGroup"
                  :key="activeMetricGroupTab + '_' + groupedDashboardRenderKey"
                  :dashboardData="activeDashboardForGroup"
                  :currentTimeObj="currentTimeObj"
                  :viewOnly="true"
                  :allowAlertCreation="false"
                  searchType="dashboards"
                  class="border-none"
                />
                <div v-else class="flex flex-col items-center justify-center h-full py-20">
                  <div class="text-base font-medium mb-2 opacity-90">
                    {{ t("correlation.noMetrics") }}
                  </div>
                  <div class="text-sm opacity-70">
                    {{ t("correlation.noMetricsDescription") }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </OSplitter>
      </div>

      <div v-if="activeTab == 'traces'" class="h-full">
        <!-- Loading State -->
        <div v-if="tracesLoading" class="flex flex-col items-center justify-center h-full py-20">
          <OSpinner size="xl" class="mb-4" />
          <div class="text-base">{{ t("correlation.loadingTraces") }}</div>
        </div>

        <!-- Error State -->
        <div v-else-if="tracesError" class="flex flex-col items-center justify-center h-full py-20">
          <OIcon name="error-outline" class="mb-4" style="width: 3.75rem; height: 3.75rem" />
          <div class="text-base mb-2">
            {{ t("correlation.tracesError") }}
          </div>
          <div class="text-sm text-text-secondary">{{ tracesError }}</div>
          <OButton variant="outline" size="sm-action" class="mt-4" @click="loadCorrelatedTraces">
            <OIcon name="refresh" size="xs" class="mr-1" />
            {{ t("correlation.retryButton") }}
          </OButton>
        </div>

        <!-- Direct Trace Correlation - Full Span List -->
        <div
          v-else-if="traceCorrelationMode === 'direct' && traceSpanList.length > 0"
          class="h-full overflow-auto telemetry-correlation-traces"
        >
          <TraceDetails
            mode="embedded"
            :trace-id-prop="extractedTraceId || ''"
            :stream-name-prop="sortedTraceStreams[0] ? sortedTraceStreams[0].stream_name : ''"
            :span-list-prop="traceSpanList"
            :start-time-prop="computedTraceStartTime"
            :end-time-prop="computedTraceEndTime"
            :correlated-log-stream="sortedLogStreams[0] ? sortedLogStreams[0].stream_name : ''"
            :show-back-button="false"
            :show-timeline="false"
            :show-log-stream-selector="false"
            :show-share-button="false"
            :show-close-button="false"
            :show-expand-button="true"
            :enable-correlation-links="true"
            :initial-timeline-expanded="false"
          />
        </div>

        <!-- Dimension-based Correlation - Traces List -->
        <div
          v-else-if="traceCorrelationMode === 'dimension-based' && tracesForDimensions.length > 0"
          class="h-full flex flex-col"
        >
          <!-- Header -->
          <div class="p-3 border-b border-solid border-card-glass-border bg-surface-panel">
            <div class="flex items-center gap-3">
              <OIcon name="hub" size="md" />
              <div class="flex flex-col">
                <span class="text-sm font-semibold">{{
                  t("correlation.dimensionBasedCorrelation")
                }}</span>
                <span class="text-xs text-text-secondary">{{
                  t("correlation.tracesFromService", { service: serviceName })
                }}</span>
              </div>
              <OTag type="fieldTag" value="primary">
                {{ tracesForDimensions.length }} {{ t("menu.traces") }}
              </OTag>
              <div class="ml-auto flex items-center gap-2">
                <OButton
                  variant="ghost"
                  size="sm-action"
                  @click="openTracesPage"
                  data-test="correlation-view-traces-page"
                  class="text-xs"
                >
                  <OIcon name="open-in-new" size="xs" class="mr-1" />
                  {{ t("correlation.viewInTraces") }}
                  <OTooltip :content="t('correlation.viewInTraces')" side="top" />
                </OButton>
              </div>
            </div>
          </div>

          <!-- Traces List -->
          <div class="flex-1">
            <TracesSearchResultList
              :hits="tracesForDimensions"
              :loading="false"
              :show-header="false"
              :show-cell-actions="false"
              @row-click="openTraceInNewWindow"
            />
          </div>
        </div>

        <!-- No Traces Found State -->
        <div v-else-if="traceCorrelationMode !== null" class="h-full">
          <OEmptyState
            size="hero"
            illustration="trace"
            :title="t('correlation.noTracesFound')"
            :description="t('correlation.noTracesDescription')"
            data-test="correlation-no-traces-state"
          />
        </div>

        <!-- Initial State (waiting for tab to be shown) -->
        <div v-else class="flex flex-col items-center justify-center h-full py-20">
          <OIcon name="account-tree" class="mb-4" style="width: 3.75rem; height: 3.75rem" />
          <div class="text-base">
            {{ t("correlation.correlatedTraces") }}
          </div>
          <div class="text-sm text-text-secondary mt-2">
            {{ t("correlation.correlatedTracesFor", { service: serviceName }) }}
          </div>
        </div>
      </div>
    </OCard>
  </div>

  <!-- Metric Stream Selector Dialog -->
  <ODialog
    data-test="telemetry-correlation-dashboard-metric-selector-dialog"
    v-model:open="showMetricSelector"
    size="md"
    :title="t('correlation.selectMetrics')"
  >
    <!-- Search Input -->
    <OSearchInput
      v-model="metricSearchText"
      :placeholder="t('search.searchField')"
      clearable
      class="w-full mb-3"
    />

    <div class="metric-list-container max-h-100 overflow-y-auto">
      <template v-if="groupedFilteredMetricStreams.groups.some((g) => g.streams.length > 0)">
        <template v-for="group in groupedFilteredMetricStreams.groups" :key="group.id">
          <!-- Group section — hidden when no streams match -->
          <template v-if="group.streams.length > 0">
            <!-- Group header -->
            <div
              class="flex items-center justify-between py-1.5 px-2 bg-section-header-bg border-b border-solid border-border-default sticky top-0 z-10"
            >
              <div
                class="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.05em] opacity-75"
              >
                <OIcon
                  v-if="typeof group.icon === 'string'"
                  :name="group.icon"
                  size="xs"
                  class="mr-0.5"
                />
                <component v-else :is="group.icon" />
                <span>{{ group.label }}</span>
                <OTag type="fieldTag" class="ml-1">{{ group.streams.length }}</OTag>
              </div>
              <div class="flex gap-1">
                <OButton
                  variant="ghost"
                  size="chip"
                  @click="selectAllInGroup(group.id)"
                  :disabled="getGroupSelectionState(group.id) === 'all'"
                >
                  All
                </OButton>
                <OButton
                  variant="ghost"
                  size="chip"
                  @click="deselectAllInGroup(group.id)"
                  :disabled="getGroupSelectionState(group.id) === 'none'"
                >
                  None
                </OButton>
              </div>
            </div>

            <!-- Metric items -->
            <div
              v-for="stream in group.streams"
              :key="stream.stream_name"
              class="flex items-center gap-2 py-2 px-4 border-b border-solid border-border-default hover:bg-[rgba(0,0,0,0.04)] dark:border-[rgba(255,255,255,0.1)] dark:hover:bg-[rgba(255,255,255,0.05)]"
            >
              <div class="flex items-center shrink-0">
                <OCheckbox
                  :model-value="
                    selectedMetricStreams.some((s) => s.stream_name === stream.stream_name)
                  "
                  @update:model-value="toggleMetricStream(stream)"
                  size="xs"
                />
              </div>
              <div class="flex flex-col flex-1 min-w-0">
                <span class="text-sm font-mono">{{ stream.stream_name }}</span>
              </div>
            </div>
          </template>
        </template>
      </template>

      <!-- No results message -->
      <div v-else class="text-center px-2 pt-3">
        <OIcon name="info" size="sm" class="align-middle mr-1" />
        {{ t("search.noResult") }}
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts" setup>
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import { ref, computed, watch, defineAsyncComponent, provide, nextTick } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";
import useTraces from "@/composables/useTraces";
import {
  useMetricsCorrelationDashboard,
  type MetricsCorrelationConfig,
} from "@/composables/useMetricsCorrelationDashboard";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import {
  groupMetricsByCategory,
  getDefaultMetricSelections,
  type MetricGroupDefinition,
  DEFAULT_METRIC_GROUP_DEFINITIONS,
  K8S_METRIC_GROUP_DEFINITIONS,
  NODE_PATTERNS,
  POD_PATTERNS,
} from "@/utils/metrics/metricGrouping";
import type { StreamInfo } from "@/services/service_streams";
import { enrichStreamsWithOverlap, sortStreamsByOverlap } from "@/utils/streamTimeOverlap";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import streamService from "@/services/stream";
import searchService from "@/services/search";
import { b64EncodeUnicode, getUUID, timestampToTimezoneDate } from "@/utils/zincutils";
import {
  buildSubjectButtons,
  streamMatchesPatterns,
  SUBJECT_BUTTONS_BY_SET,
  resolveSetId,
  type SubjectButton,
} from "@/composables/useMetricSubjectButtons";
import { filterByIntent, pickDefaultIntent, type IntentId } from "@/utils/metrics/metricIntent";
import useHttpStreaming from "@/composables/useStreamingSearch";
import DimensionFiltersBar from "./DimensionFiltersBar.vue";
import CorrelationEventHeader from "./CorrelationEventHeader.vue";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import TracesSearchResultList from "@/plugins/traces/components/TracesSearchResultList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

export interface TimeRange {
  startTime: number;
  endTime: number;
}

export interface TelemetryCorrelationDashboardProps {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  additionalDimensions?: Record<string, string>; // Unstable dimensions (pod-id, etc.) - shown with _o2_all option
  matchedSetId?: string; // Identity set selected by best-coverage resolution ("k8s", "aws", "gcp", "azure", ...)
  chipDimensions?: Record<string, string>; // Semantic-id keyed dimensions for the chip row
  sourceEvent?: {
    timestamp?: number | string;
    severity?: string;
    message?: string;
  };
  metricStreams: StreamInfo[];
  logStreams?: StreamInfo[];
  traceStreams?: StreamInfo[];
  timeRange: TimeRange;
  sourceStream?: string; // The original stream user was viewing (e.g., logs stream)
  sourceType?: string; // The type of source stream (logs/metrics/traces)
  availableDimensions?: Record<string, string>; // Actual field names from source (for fallback queries)
  ftsFields?: string[]; // Full text search fields from the source stream (used for trace_id extraction from log body)
  mode?: "dialog" | "embedded-tabs"; // Render mode: 'dialog' = full dialog, 'embedded-tabs' = just tabs content for DetailTable
  externalActiveTab?: string; // For embedded-tabs mode, allows parent to control active tab
  hideDimensionFilters?: boolean; // Hide dimension filters in embedded-tabs mode
  metricGroupDefinitions?: MetricGroupDefinition[]; // Override the default Infra/Network/Others groups
  panelWidth?: number; // Override default panel width (grid units) for metric panels
  panelHeight?: number; // Override default panel height (grid units) for metric panels
  logsPanelWidth?: number; // Override default panel width (grid units) for logs panel
  logsPanelHeight?: number; // Override default panel height (grid units) for logs panel
}

const props = withDefaults(defineProps<TelemetryCorrelationDashboardProps>(), {
  mode: "dialog",
  externalActiveTab: "logs",
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { showErrorNotification } = useNotifications();
const store = useStore();
const router = useRouter();
const { t } = useI18n();
const { generateDashboard, generateLogsDashboard } = useMetricsCorrelationDashboard();
const { semanticGroups, loadSemanticGroups } = useServiceCorrelation();
const { formatTracesMetaData } = useTraces();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

// Track in-flight dimension-based trace stream so it can be cancelled on re-fetch
let currentTracesStreamTraceId: string | null = null;

// Resolved group definitions and their ids (reactive to prop changes)
const groupDefs = computed(() => {
  if (props.metricGroupDefinitions) return props.metricGroupDefinitions;
  // Auto-select K8s nested definitions when the correlation matched a kubernetes identity set
  const setId = props.matchedSetId?.toLowerCase() ?? "";
  if (setId === "kubernetes" || setId.startsWith("k8s")) return K8S_METRIC_GROUP_DEFINITIONS;
  return DEFAULT_METRIC_GROUP_DEFINITIONS;
});

// Nested mode: when top-level groups have children (e.g. K8s Pod/Node outer tabs)
const isNestedGroupMode = computed(() =>
  groupDefs.value.some((g) => g.children && g.children.length > 0),
);

const activeOuterTab = ref<string>(
  groupDefs.value.find((g) => g.children)?.id ?? groupDefs.value[0]?.id ?? "",
);

// When matchedSetId arrives (async) groupDefs switches from flat → nested.
// Re-initialize activeOuterTab to the first outer group so the Pods tab is selected.
watch(isNestedGroupMode, (nested) => {
  if (nested) {
    activeOuterTab.value =
      groupDefs.value.find((g) => g.children)?.id ?? groupDefs.value[0]?.id ?? "";
  }
});

// Resolve a value for a semantic ID by checking chipDimensions directly (semantic-id key)
// and also by looking up raw field names from semanticGroups (raw-field key).
const resolveChipValue = (semanticId: string): string | undefined => {
  // Try semantic-id key directly (from buildWorkloadChipDimensions)
  const direct = props.chipDimensions?.[semanticId];
  if (direct && direct !== SELECT_ALL_VALUE) return direct;
  // Try raw field names (from buildChipDimensionsFromFilters)
  const group = semanticGroups.value.find((g) => g.id === semanticId);
  if (!group) return undefined;
  for (const field of group.fields) {
    const v = props.chipDimensions?.[field];
    if (v && v !== SELECT_ALL_VALUE) return v;
  }
  return undefined;
};

// Map outer tab id → actual resource name (pod/node name)
const outerTabResourceName = computed<Record<string, string | undefined>>(() => ({
  pods: resolveChipValue("k8s-pod-name"),
  nodes: resolveChipValue("k8s-node-name"),
}));

// Map outer tab id → subject semantic id (drives the same filtering as the "View by" chip)
const outerTabToSubjectSemanticId: Record<string, string> = {
  pods: "k8s-pod-name",
  nodes: "k8s-node-name",
};

// Effective sub-groups: children of the active outer tab, or flat groupDefs
const effectiveGroupDefs = computed(() => {
  if (!isNestedGroupMode.value) return groupDefs.value;
  const outer = groupDefs.value.find((g) => g.id === activeOuterTab.value);
  return outer?.children ?? groupDefs.value;
});

const groupIds = computed(() => effectiveGroupDefs.value.map((g) => g.id));

// Sort related streams so those with confirmed data overlap in props.timeRange
// come first; streams without overlap (or missing stats) sink to the bottom.
// Source: stream stats (doc_time_min/doc_time_max) cached in the streams store.
const sortedMetricStreams = computed<StreamInfo[]>(() =>
  sortStreamsByOverlap(
    enrichStreamsWithOverlap(
      props.metricStreams ?? [],
      "metrics",
      props.timeRange,
      store.state.streams,
    ),
  ),
);
const sortedLogStreams = computed<StreamInfo[]>(() =>
  sortStreamsByOverlap(
    enrichStreamsWithOverlap(props.logStreams ?? [], "logs", props.timeRange, store.state.streams),
  ),
);
const sortedTraceStreams = computed<StreamInfo[]>(() =>
  sortStreamsByOverlap(
    enrichStreamsWithOverlap(
      props.traceStreams ?? [],
      "traces",
      props.timeRange,
      store.state.streams,
    ),
  ),
);

// Check if embedded tabs mode
const isEmbeddedTabs = computed(() => props.mode === "embedded-tabs");

// Provide selectedTabId for RenderDashboardCharts to use
const selectedTabId = computed(() => {
  // Map our activeTab to dashboard tab IDs
  return activeTab.value === "logs" ? "logs" : "metrics";
});
provide("selectedTabId", selectedTabId);

const isOpen = ref(true);
const loading = ref(false);
const error = ref<string | null>(null);
const dashboardData = ref<any>(null);
const logsDashboardData = ref<any>(null);
const dashboardRenderKey = ref(0);
const initialLoadCompleted = ref(false); // Track if initial load has completed to avoid duplicate loadDashboard calls
const logsDashboardRenderKey = ref(0);
const dashboardChartsRef = ref<any>(null);
const showMetricSelector = ref(false);
const metricSearchText = ref("");

// Splitter model for metrics sidebar width (percentage)
const splitterModel = ref(25);

// Group-level collapse state within the sidebar
const collapsedGroups = ref(new Set<string>());
const toggleGroupCollapse = (groupId: string) => {
  const next = new Set(collapsedGroups.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedGroups.value = next;
};

// Panel data caching for hide/unhide optimization
const panelDataCache = ref<Map<string, { panel: any; timestamp: number }>>(new Map());
const PANEL_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration
let streamChangeDebounceTimeout: any = null; // Debounce timeout for batching multiple hide/unhide operations
const STREAM_CHANGE_DEBOUNCE_MS = 300; // 300ms debounce delay
let wasEmptyBeforeChange = false; // Track if we're transitioning from empty state
let suppressNextStreamReload = false; // Set when a full reload is already scheduled (e.g. chip click)

// Trace correlation state
const tracesLoading = ref(false);
const tracesError = ref<string | null>(null);
const extractedTraceId = ref<string | null>(null);
const traceCorrelationMode = ref<"direct" | "dimension-based" | null>(null);
const traceSpanList = ref<any[]>([]);
const tracesForDimensions = ref<any[]>([]); // Traces found via dimension-based correlation

// Computed properties for trace time range
const computedTraceStartTime = computed(() => {
  if (traceSpanList.value.length === 0) return 0;
  return Math.min(...traceSpanList.value.map((s) => Math.floor(s.start_time / 1000)));
});

const computedTraceEndTime = computed(() => {
  if (traceSpanList.value.length === 0) return 0;
  return Math.max(...traceSpanList.value.map((s) => Math.ceil(s.end_time / 1000)));
});

// Table columns for span list (direct trace correlation)
// Use external tab control in embedded mode, otherwise manage internally
const activeTab = computed({
  get: () => (isEmbeddedTabs.value ? props.externalActiveTab : internalActiveTab.value),
  set: (val) => {
    if (!isEmbeddedTabs.value) {
      internalActiveTab.value = val;
    }
  },
});
const internalActiveTab = ref("logs");

// Active dimensions that can be modified
// - matchedDimensions (stable): use actual values from current "row"
// - additionalDimensions (unstable): use actual values from current row (user can change to "All" if desired)
// Applied dimensions - these are used to generate queries
const activeDimensions = ref<Record<string, string>>({
  ...props.matchedDimensions,
  // Use actual values from additionalDimensions (showing current row values)
  ...(props.additionalDimensions || {}),
});

// Pending dimensions - these are edited by the user but not yet applied
const pendingDimensions = ref<Record<string, string>>({
  ...props.matchedDimensions,
  // Use actual values from additionalDimensions (showing current row values)
  ...(props.additionalDimensions || {}),
});

// Track if there are pending changes that haven't been applied
const hasPendingChanges = computed(() => {
  const activeKeys = Object.keys(activeDimensions.value);
  const pendingKeys = Object.keys(pendingDimensions.value);

  if (activeKeys.length !== pendingKeys.length) return true;

  for (const key of activeKeys) {
    if (activeDimensions.value[key] !== pendingDimensions.value[key]) {
      return true;
    }
  }
  return false;
});

// Track which dimensions are unstable (for UI styling)
const unstableDimensionKeys = computed(
  () => new Set(Object.keys(props.additionalDimensions || {})),
);

// Get unique metric streams by stream_name
const getUniqueStreams = (streams: StreamInfo[]) => {
  const seen = new Set<string>();
  const unique: StreamInfo[] = [];

  for (const stream of streams) {
    if (!seen.has(stream.stream_name)) {
      seen.add(stream.stream_name);
      unique.push(stream);
    }
  }

  return unique;
};

/**
 * Apply SELECT_ALL_VALUE to filters for unstable dimensions
 * This ensures that unstable dimension filters default to wildcard (All values)
 *
 * Strategy: Use semantic groups to map metric field names to dimension IDs.
 * 1. Build a reverse lookup: field_name -> semantic_dimension_id (from semanticGroups)
 * 2. For each filter in the stream, find its semantic dimension ID
 * 3. If that dimension ID is in additionalDimensions (unstable), set filter to SELECT_ALL_VALUE
 *
 * Example:
 * - semanticGroups has: { id: 'k8s-node-id', fields: ['k8s_node_name', 'node_name', ...] }
 * - additionalDimensions has: { 'k8s-node-id': 'node-abc' }
 * - Metric filter has: { k8s_node_name: 'node-xyz' }
 * - k8s_node_name maps to 'k8s-node-id' which is in additionalDimensions -> set to SELECT_ALL_VALUE
 */
const applyUnstableDimensionDefaults = (streams: StreamInfo[]): StreamInfo[] => {
  // Collect ALL unstable dimension IDs from:
  // 1. additionalDimensions (explicitly marked as unstable)
  // 2. matchedDimensions where value is already SELECT_ALL_VALUE (unstable dims with wildcard)
  const unstableDimIds = new Set<string>();

  const additionalDims = props.additionalDimensions || {};
  const matchedDims = props.matchedDimensions || {};

  // Add all keys from additionalDimensions
  for (const key of Object.keys(additionalDims)) {
    unstableDimIds.add(key);
  }

  // Add keys from matchedDimensions that have SELECT_ALL_VALUE (these are unstable)
  for (const [key, value] of Object.entries(matchedDims)) {
    if (value === SELECT_ALL_VALUE) {
      unstableDimIds.add(key);
    }
  }

  if (unstableDimIds.size === 0) {
    return streams;
  }

  // Build reverse lookup: field_name -> semantic_dimension_id
  // Using semanticGroups from useServiceCorrelation()

  const fieldToDimensionId = new Map<string, string>();
  for (const group of semanticGroups.value) {
    for (const field of group.fields) {
      fieldToDimensionId.set(field, group.id);
    }
  }

  const result = streams.map((stream) => {
    const updatedFilters = { ...(stream.filters ?? {}) };
    const changedKeys: string[] = [];
    const notMatchedKeys: string[] = [];

    // For each filter in the stream, check if it maps to an unstable dimension
    for (const [filterKey, filterValue] of Object.entries(stream.filters ?? {})) {
      // Look up the semantic dimension ID for this field name
      const dimensionId = fieldToDimensionId.get(filterKey);

      if (dimensionId && unstableDimIds.has(dimensionId)) {
        // This filter's field maps to an unstable dimension - set to wildcard
        updatedFilters[filterKey] = SELECT_ALL_VALUE;
        changedKeys.push(`${filterKey} (${dimensionId})=${filterValue}`);
      } else if (!dimensionId) {
        notMatchedKeys.push(filterKey);
      }
    }

    return {
      ...stream,
      filters: updatedFilters,
    };
  });

  return result;
};

const uniqueMetricStreams = computed(() => {
  const base = getUniqueStreams(sortedMetricStreams.value);
  if (!isNestedGroupMode.value) return base;

  // In nested mode (K8s), supplement correlation-returned streams with all
  // node/pod streams from the org catalog. The _correlate API only returns
  // streams associated with the matched service record (pod-level), so
  // node-level metrics (k8s_node_*, system_*) are missing from the response.
  const catalogMetrics = store.state.streams?.metrics as Record<string, any> | undefined;
  if (!catalogMetrics) return base;

  const existingNames = new Set(base.map((s) => s.stream_name));
  const extra: StreamInfo[] = Object.keys(catalogMetrics)
    .filter(
      (name) =>
        !existingNames.has(name) &&
        (streamMatchesPatterns(name, NODE_PATTERNS) || streamMatchesPatterns(name, POD_PATTERNS)),
    )
    .map((name) => ({ stream_name: name, stream_type: "metrics" }));

  return [...base, ...extra];
});

// Selected metric streams — declared before chip/intent block because applyActivePill references it.
const selectedMetricStreams = ref<StreamInfo[]>(
  applyUnstableDimensionDefaults(
    (() => {
      const unique = getUniqueStreams(sortedMetricStreams.value);
      const defs = groupDefs.value;
      const defaults = getDefaultMetricSelections(defs, unique);
      return defaults.length > 0 ? defaults : unique.slice(0, 6);
    })(),
  ),
);

// ── Chip row & subject/intent logic ───────────────────────────────────────

const LABEL_ACRONYMS = new Set([
  "aws",
  "ecs",
  "gcp",
  "iam",
  "vpc",
  "rds",
  "s3",
  "ec2",
  "id",
  "url",
  "uri",
  "ip",
  "dns",
  "ssl",
  "tls",
  "tcp",
  "udp",
  "api",
  "cpu",
  "gpu",
  "ram",
  "ssd",
  "hdd",
  "io",
  "k8s",
  "faas",
  "otel",
  "sql",
  "http",
  "https",
]);
const titleCaseWord = (w: string): string => {
  if (!w) return w;
  if (LABEL_ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
  if (/^k8s$/i.test(w)) return "K8s";
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
};
const titleCase = (s: string) => s.split(/\s+/).map(titleCaseWord).join(" ");

const dimensionDisplayLabelCache = new Map<string, string>();
const dimensionDisplayLabel = (key: string): string => {
  const cached = dimensionDisplayLabelCache.get(key);
  if (cached !== undefined) return cached;
  const label = titleCase(key.replace(/[-_.]/g, " "));
  dimensionDisplayLabelCache.set(key, label);
  return label;
};

const toChipString = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};
const sanitizeChipDimensions = (
  src: Record<string, unknown> | undefined | null,
): Record<string, string> => {
  if (!src) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    const s = toChipString(v);
    if (s !== null && s !== "") out[k] = s;
  }
  return out;
};
const chipDimensionSource = computed<Record<string, string>>(() => {
  if (props.chipDimensions && Object.keys(props.chipDimensions).length > 0) {
    return sanitizeChipDimensions(props.chipDimensions as Record<string, unknown>);
  }
  return sanitizeChipDimensions({
    ...(props.matchedDimensions ?? {}),
    ...(props.additionalDimensions ?? {}),
  });
});
const chipDimensionKeys = computed<string[]>(() => Object.keys(chipDimensionSource.value));

const fieldKeysForSemanticId = (semanticId: string): string[] => {
  const group = semanticGroups.value.find((g) => g.id === semanticId);
  if (!group) return semanticId in pendingDimensions.value ? [semanticId] : [];
  const pending = group.fields.filter((f) => f in pendingDimensions.value);
  if (pending.length > 0) return pending;
  const avail = props.availableDimensions ?? {};
  const sourceHit = group.fields.find(
    (f) => avail[f] !== undefined && avail[f] !== null && avail[f] !== "",
  );
  return sourceHit ? [sourceHit] : [];
};

const activeChipKeysLocal = ref<Set<string>>(new Set());
watch(
  chipDimensionKeys,
  (keys) => {
    const next = new Set<string>();
    for (const k of keys) {
      const fields = fieldKeysForSemanticId(k);
      if (fields.length === 0) next.add(k);
    }
    activeChipKeysLocal.value = next;
  },
  { immediate: true },
);

const originalValueForKey = (key: string): string => {
  const v = chipDimensionSource.value[key];
  return v !== undefined && v !== SELECT_ALL_VALUE ? v : "";
};

type ChipKind = "context" | "subject";
type DimensionChip = {
  key: string;
  label: string;
  value: string;
  kind: ChipKind;
  active: boolean;
  disabled?: boolean;
};

const subjectSemanticIds = computed<Set<string>>(() => {
  if (!props.matchedSetId) return new Set();
  const canonical = resolveSetId(props.matchedSetId);
  const specs = canonical ? SUBJECT_BUTTONS_BY_SET[canonical] : undefined;
  if (!specs?.length) return new Set();
  return new Set(specs.flatMap((s) => s.semanticIds));
});

const activeSubject = ref<string | null>(null);

const subjectButtons = computed<SubjectButton[]>(() =>
  buildSubjectButtons(props.matchedSetId, semanticGroups.value),
);

const subjectMatchCounts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {};
  const pool = props.metricStreams ?? [];
  if (pool.length === 0) return out;
  const cachedSchemas = (store.state.streams?.metrics as Record<string, any> | undefined) ?? {};
  for (const button of subjectButtons.value) {
    if (!button.semanticIds || button.poolPatterns.length === 0) continue;
    const subjectFieldAliases = new Set<string>();
    for (const sid of button.semanticIds) {
      const group = semanticGroups.value.find((g) => g.id === sid);
      if (group) for (const f of group.fields) subjectFieldAliases.add(f);
    }
    const seen = new Set<string>();
    let matchCount = 0;
    for (const stream of pool) {
      if (seen.has(stream.stream_name)) continue;
      seen.add(stream.stream_name);
      const schema = cachedSchemas[stream.stream_name]?.schema as
        | Array<{ name: string }>
        | undefined;
      if (schema && schema.length > 0 && subjectFieldAliases.size > 0) {
        if (schema.some((c) => subjectFieldAliases.has(c.name))) matchCount++;
      } else if (streamMatchesPatterns(stream.stream_name, button.poolPatterns)) {
        matchCount++;
      }
    }
    for (const sid of button.semanticIds) out[sid] = matchCount;
  }
  return out;
});

const unifiedChips = computed<DimensionChip[]>(() =>
  chipDimensionKeys.value
    .map((key): DimensionChip => {
      const isSubject = subjectSemanticIds.value.has(key);
      const matchCount = isSubject ? (subjectMatchCounts.value[key] ?? 0) : 0;
      // Context chips: active when the field key has a real value in pendingDimensions (not SELECT_ALL_VALUE)
      const contextActive =
        !isSubject &&
        (() => {
          const fields = fieldKeysForSemanticId(key);
          if (fields.length > 0)
            return fields.some((f) => pendingDimensions.value[f] !== SELECT_ALL_VALUE);
          return activeChipKeysLocal.value.has(key);
        })();
      return {
        key,
        label: dimensionDisplayLabel(key),
        value: originalValueForKey(key),
        kind: isSubject ? "subject" : "context",
        active: isSubject ? activeSubject.value === key : contextActive,
        disabled: isSubject && matchCount === 0,
      };
    })
    .filter((c) => {
      if (!c.value || c.value === SELECT_ALL_VALUE) return false;
      // Subject chips (Pod, Node, Host) are only meaningful on the metrics tab
      if (c.kind === "subject" && activeTab.value !== "metrics") return false;
      return true;
    }),
);

// Helper function to get shorter label from SUBJECT_BUTTONS_BY_SET
const getSubjectButtonLabel = (semanticId: string): string => {
  const canonical = resolveSetId(props.matchedSetId);
  if (!canonical) return semanticId;

  const specs = SUBJECT_BUTTONS_BY_SET[canonical];
  if (!specs) return semanticId;

  const spec = specs.find((s) => s.semanticIds.includes(semanticId));
  return spec?.label || semanticId;
};

const pinSubject = (newSubject: string | null, previousSubject: string | null) => {
  let next = { ...pendingDimensions.value };
  let mutated = false;
  if (previousSubject && next[previousSubject] !== SELECT_ALL_VALUE) {
    next[previousSubject] = SELECT_ALL_VALUE;
    mutated = true;
  }
  if (newSubject) {
    const resolved = originalValueForKey(newSubject);
    if (resolved && next[newSubject] !== resolved) {
      next[newSubject] = resolved;
      mutated = true;
    }
  }
  if (mutated) pendingDimensions.value = next;
  return mutated;
};

watch(
  [subjectSemanticIds, () => props.matchedSetId, () => props.chipDimensions, subjectMatchCounts],
  ([sids, matchedSetId]) => {
    let mutated = false;
    if (activeSubject.value && sids.has(activeSubject.value)) {
      mutated = pinSubject(activeSubject.value, null);
    } else if (!matchedSetId) {
      activeSubject.value = null;
    } else {
      const canonical = resolveSetId(matchedSetId);
      const specs = canonical ? SUBJECT_BUTTONS_BY_SET[canonical] : undefined;
      if (!specs?.length) {
        activeSubject.value = null;
      } else {
        const counts = subjectMatchCounts.value;
        const ordered = [
          ...specs.filter((s) => s.defaultActive),
          ...specs.filter((s) => !s.defaultActive),
        ];
        let picked: string | null = null;
        for (const spec of ordered) {
          const sid = spec.semanticIds[0];
          if (sid && sids.has(sid) && (counts[sid] ?? 0) > 0) {
            picked = sid;
            break;
          }
        }
        if (picked) {
          activeSubject.value = picked;
          mutated = pinSubject(picked, null);
        }
      }
    }
    if (!mutated) return;
    activeDimensions.value = { ...pendingDimensions.value };
    if (initialLoadCompleted.value) {
      dashboardData.value = null;
      nextTick(() => {
        loadDashboard();
      });
    }
  },
  { immediate: true },
);

// Split chips by type for new UI structure
const contextChips = computed(() => unifiedChips.value.filter((chip) => chip.kind === "context"));
const subjectChips = computed(() => unifiedChips.value.filter((chip) => chip.kind === "subject"));

// ── Intent pill row ────────────────────────────────────────────────────────
const activeIntent = ref<IntentId>("all");

const activeSubjectButtonId = computed<string | null>(() => {
  const sid = activeSubject.value;
  if (!sid) return null;
  const button = subjectButtons.value.find(
    (b) => Array.isArray(b.semanticIds) && b.semanticIds.includes(sid),
  );
  return button?.id ?? null;
});

const applyScopeFilter = (streams: StreamInfo[]): StreamInfo[] => {
  if (!isNestedGroupMode.value) {
    // Non-nested: use the subject button's dimension-derived pool patterns (original behaviour)
    const sid = activeSubject.value;
    if (!sid || subjectButtons.value.length === 0) return streams;
    const button = subjectButtons.value.find(
      (b) => Array.isArray(b.semanticIds) && b.semanticIds.includes(sid),
    );
    if (!button || button.poolPatterns.length === 0) return streams;
    return streams.filter((s) => streamMatchesPatterns(s.stream_name, button.poolPatterns));
  }
  // Nested mode: filter by stream-name patterns so node/pod tabs show the right streams
  if (activeOuterTab.value === "nodes") {
    return streams.filter((s) => streamMatchesPatterns(s.stream_name, NODE_PATTERNS));
  }
  if (activeOuterTab.value === "pods") {
    return streams.filter((s) => streamMatchesPatterns(s.stream_name, POD_PATTERNS));
  }
  return streams;
};

const streamsForActivePill = computed<StreamInfo[]>(() => {
  const scoped = applyScopeFilter(uniqueMetricStreams.value);
  return filterByIntent(
    scoped,
    activeIntent.value,
    props.matchedSetId,
    activeSubjectButtonId.value,
  );
});

const applyActivePill = () => {
  selectedMetricStreams.value = applyUnstableDimensionDefaults(streamsForActivePill.value);
};

let lastIntentInitKey: string | null = null;
watch(
  [() => props.matchedSetId, uniqueMetricStreams, subjectButtons],
  ([matchedSetId, streams]) => {
    if (streams.length === 0) return;
    const key = `${matchedSetId ?? ""}|${streams
      .map((s) => s.stream_name)
      .sort()
      .join(",")}`;
    if (lastIntentInitKey === key) return;
    lastIntentInitKey = key;
    activeIntent.value = pickDefaultIntent(streams, matchedSetId, activeSubjectButtonId.value);
    applyActivePill();
  },
  { immediate: true },
);

// Filter metric streams based on search text
const filteredMetricStreams = computed(() => {
  const streams = uniqueMetricStreams.value;

  if (!metricSearchText.value?.trim()) {
    return streams;
  }

  const searchLower = metricSearchText.value.toLowerCase();
  return streams.filter((stream) => stream.stream_name.toLowerCase().includes(searchLower));
});

// Group the filtered metric streams into configured categories
// In nested mode, also apply scope filter so the sidebar shows only pod/node streams
const groupedFilteredMetricStreams = computed(() =>
  groupMetricsByCategory(applyScopeFilter(filteredMetricStreams.value), effectiveGroupDefs.value),
);

// Group ALL available unique metric streams — drives which tabs are visible
// In nested mode, scope-filter so counts reflect the active outer tab
const groupedUniqueMetricStreams = computed(() =>
  groupMetricsByCategory(applyScopeFilter(uniqueMetricStreams.value), effectiveGroupDefs.value),
);

// Group the currently *selected* metric streams (used by the selector dialog)
const groupedSelectedMetricStreams = computed(() =>
  groupMetricsByCategory(selectedMetricStreams.value, effectiveGroupDefs.value),
);

// Active group tab within the metrics section
const activeMetricGroupTab = ref<string>(effectiveGroupDefs.value[0]?.id ?? "compute");

// When outer tab changes: reset inner tab + sync activeSubject for filtering
watch(
  activeOuterTab,
  (tabId) => {
    const first = effectiveGroupDefs.value[0]?.id;
    if (first) activeMetricGroupTab.value = first;
    // Apply the same scope filter that the "View by Pod/Node" chip would apply
    const semanticId = outerTabToSubjectSemanticId[tabId];
    if (semanticId) activeSubject.value = semanticId;
  },
  { immediate: true },
);

// Per-group dashboard data and render key
const groupedDashboardData = ref<Partial<Record<string, any>>>({});
const groupedDashboardRenderKey = ref(0);

// Dashboard shown for the currently active group tab
const activeDashboardForGroup = computed(
  () => groupedDashboardData.value[activeMetricGroupTab.value] ?? null,
);

// Tabs are visible for every group that has at least one AVAILABLE metric stream
// (not just selected ones, so all groups always appear if they have any metrics)
const nonEmptyGroupTabs = computed(() =>
  groupIds.value.filter((g) => (groupedUniqueMetricStreams.value.byGroup[g]?.length ?? 0) > 0),
);

/**
 * (Re)generate per-group dashboards from the currently selected streams.
 * Sidebar checkboxes control which metrics are selected and thus shown per group.
 * Pure computation � no API calls. Schemas are already cached in the store.
 */
const regenerateGroupDashboards = (config: MetricsCorrelationConfig) => {
  const grouped = groupMetricsByCategory(selectedMetricStreams.value, effectiveGroupDefs.value);
  const next: Partial<Record<string, any>> = {};

  for (const gId of groupIds.value) {
    if (grouped.byGroup[gId].length > 0) {
      next[gId] = generateDashboard(
        grouped.byGroup[gId],
        config,
        store.state.theme,
        props.panelWidth,
        props.panelHeight,
      );
    }
  }

  groupedDashboardData.value = next;
  groupedDashboardRenderKey.value++;

  // If active tab is now empty, switch to the first non-empty one
  if (!next[activeMetricGroupTab.value]) {
    const first = groupIds.value.find((g) => next[g]);
    if (first) activeMetricGroupTab.value = first;
  }
};

/**
 * Drop every rendered metric chart (both the flat and per-group dashboards).
 * Used when the selection empties out, so the "no metrics" empty state shows
 * instead of the previous selection's charts.
 */
const clearMetricDashboards = () => {
  dashboardData.value = null;
  dashboardRenderKey.value++;
  groupedDashboardData.value = {};
  groupedDashboardRenderKey.value++;
};

// Select all metrics in a group (adds any that aren't already selected)
const selectAllInGroup = (groupId: string) => {
  const groupStreams = groupedFilteredMetricStreams.value.byGroup[groupId];
  const alreadySelected = new Set(selectedMetricStreams.value.map((s) => s.stream_name));
  const toAdd = groupStreams.filter((s) => !alreadySelected.has(s.stream_name));
  if (toAdd.length === 0) return;
  selectedMetricStreams.value = [
    ...selectedMetricStreams.value,
    ...applyUnstableDimensionDefaults(toAdd),
  ];
};

// Deselect all metrics in a group
const deselectAllInGroup = (groupId: string) => {
  const groupStreamNames = new Set(
    groupedFilteredMetricStreams.value.byGroup[groupId].map((s) => s.stream_name),
  );
  selectedMetricStreams.value = selectedMetricStreams.value.filter(
    (s) => !groupStreamNames.has(s.stream_name),
  );
};

// Return selection state for a group: 'all' | 'partial' | 'none'
const getGroupSelectionState = (groupId: string): "all" | "partial" | "none" => {
  const groupStreams = groupedFilteredMetricStreams.value.byGroup[groupId];
  if (groupStreams.length === 0) return "none";
  const selectedCount = groupStreams.filter((s) =>
    selectedMetricStreams.value.some((sel) => sel.stream_name === s.stream_name),
  ).length;
  if (selectedCount === 0) return "none";
  if (selectedCount === groupStreams.length) return "all";
  return "partial";
};

const currentOrgIdentifier = computed(() => {
  return store.state.selectedOrganization.identifier;
});

const currentTimeObj = computed(() => {
  // props.timeRange is in microseconds (16 digits), just like TracesAnalysisDashboard
  // Date constructor expects milliseconds, so we create Date objects with microseconds
  // (which will be invalid dates, but that's ok - TracesAnalysisDashboard does the same)
  const timeObj = {
    __global: {
      start_time: new Date(props.timeRange.startTime),
      end_time: new Date(props.timeRange.endTime),
    },
  };

  return timeObj;
});

// Toggle metric stream selection
const toggleMetricStream = (stream: StreamInfo) => {
  const index = selectedMetricStreams.value.findIndex((s) => s.stream_name === stream.stream_name);

  if (index > -1) {
    // Remove stream
    selectedMetricStreams.value = selectedMetricStreams.value.filter(
      (s) => s.stream_name !== stream.stream_name,
    );
  } else {
    // Add stream - apply SELECT_ALL_VALUE defaults for unstable dimensions
    const streamsWithDefaults = applyUnstableDimensionDefaults([stream]);
    selectedMetricStreams.value = [...selectedMetricStreams.value, ...streamsWithDefaults];
  }
};

// Get dropdown options for a dimension
const getDimensionOptions = (key: string, currentValue: string) => {
  // Get the original value - could be from matched (stable) or additional (unstable) dimensions
  const originalValue = props.matchedDimensions[key] || props.additionalDimensions?.[key];
  const isUnstable = unstableDimensionKeys.value.has(key);

  // Create options array
  const options = [
    {
      label: t("correlation.all"),
      value: SELECT_ALL_VALUE,
    },
  ];

  // Add the original value option if it exists and is not already SELECT_ALL_VALUE
  if (originalValue && originalValue !== SELECT_ALL_VALUE) {
    options.push({
      label: isUnstable ? `${originalValue} (current)` : originalValue,
      value: originalValue,
    });
  }

  // Add the current value if it's different from both original and SELECT_ALL_VALUE
  // This preserves previously selected values in the dropdown
  if (currentValue && currentValue !== SELECT_ALL_VALUE && currentValue !== originalValue) {
    options.push({
      label: currentValue,
      value: currentValue,
    });
  }

  return options;
};

// Fetch metric schemas for all streams in one call
const fetchMetricSchemas = async (streamNames: string[]) => {
  try {
    // Check if we already have schemas in store
    const cachedMetrics = store.state.streams.metrics || {};
    const missingStreams = streamNames.filter((name) => !cachedMetrics[name]?.metrics_meta);

    if (missingStreams.length === 0) {
      return cachedMetrics;
    }

    // Fetch all metric streams with schema in one API call
    const response = await streamService.nameList(
      currentOrgIdentifier.value,
      "metrics",
      true, // fetchSchema = true
      -1,
      -1,
      "",
      "",
      false,
    );

    if (response.data?.list) {
      // Build a map of stream name to schema data
      const schemasMap: Record<string, any> = {};
      for (const stream of response.data.list) {
        if (stream.name && stream.metrics_meta) {
          schemasMap[stream.name] = stream;
        }
      }

      // Update store with new schemas
      const updatedMetrics = { ...cachedMetrics, ...schemasMap };
      store.dispatch("streams/setMetricsStreams", updatedMetrics);

      return updatedMetrics;
    }

    return cachedMetrics;
  } catch (err) {
    console.error("[TelemetryCorrelationDashboard] Error fetching schemas:", err);
    return store.state.streams.metrics || {};
  }
};

// Handle pending dimension value change from DimensionFiltersBar component
const handleDimensionUpdate = ({ key, value }: { key: string; value: string }) => {
  pendingDimensions.value[key] = value;
  // console.log("[TelemetryCorrelationDashboard] Pending dimension changed:", pendingDimensions.value);
  // No action needed - hasPendingChanges computed will update automatically
};

// Handle pending dimension value change - just updates pending state, doesn't regenerate queries
const onPendingDimensionChange = () => {
  // console.log("[TelemetryCorrelationDashboard] Pending dimension changed:", pendingDimensions.value);
  // No action needed - hasPendingChanges computed will update automatically
};

// Apply pending dimension changes and regenerate dashboard
const applyDimensionChanges = () => {
  // Copy pending to active
  activeDimensions.value = { ...pendingDimensions.value };

  // Build field_name -> dimension_id mapping from semantic groups
  // This is the same approach as applyUnstableDimensionDefaults
  const fieldToDimensionId = new Map<string, string>();
  for (const group of semanticGroups.value) {
    for (const field of group.fields) {
      fieldToDimensionId.set(field, group.id);
    }
  }

  // Update metric stream filters with new dimension values
  // Use semantic groups to map filter field names to dimension IDs
  selectedMetricStreams.value = selectedMetricStreams.value.map((stream) => {
    const updatedFilters = { ...(stream.filters ?? {}) };

    // For each filter in the stream, find its semantic dimension ID
    // and update with the new value from activeDimensions
    for (const [filterKey] of Object.entries(stream.filters ?? {})) {
      const dimensionId = fieldToDimensionId.get(filterKey);
      if (dimensionId && activeDimensions.value[dimensionId] !== undefined) {
        const newValue = activeDimensions.value[dimensionId];
        updatedFilters[filterKey] = newValue;
      }
    }

    return {
      ...stream,
      filters: updatedFilters,
    };
  });

  // Note: For logs, the filters are built from config.matchedDimensions in the composable
  // which we're already updating via activeDimensions

  // Reload the dashboard with updated filters
  loadDashboard();
};

const loadDashboard = async () => {
  try {
    loading.value = true;
    error.value = null;

    // Fetch metric schemas for all selected streams
    let metricSchemas: Record<string, any> = {};
    if (selectedMetricStreams.value.length > 0) {
      const streamNames = selectedMetricStreams.value.map((s) => s.stream_name);
      metricSchemas = await fetchMetricSchemas(streamNames);
    }

    const config: MetricsCorrelationConfig = {
      serviceName: props.serviceName,
      matchedDimensions: activeDimensions.value,
      metricStreams: selectedMetricStreams.value,
      logStreams: sortedLogStreams.value,
      traceStreams: sortedTraceStreams.value,
      orgIdentifier: currentOrgIdentifier.value,
      timeRange: props.timeRange,
      sourceStream: props.sourceStream,
      sourceType: props.sourceType,
      availableDimensions: props.availableDimensions,
      metricSchemas: metricSchemas,
      semanticGroups: semanticGroups.value,
    };

    // Generate metrics dashboard JSON (if we have metrics)
    if (selectedMetricStreams.value.length > 0) {
      // selectedMetricStreams.value.forEach(s => {
      //   console.log(`  ${s.stream_name}:`, s.filters);
      // });
      const dashboard = generateDashboard(
        selectedMetricStreams.value,
        config,
        store.state.theme,
        props.panelWidth,
        props.panelHeight,
      );
      dashboardData.value = dashboard;
      dashboardRenderKey.value++;
      regenerateGroupDashboards(config);
    } else {
      // Nothing selected: clear rather than leave the previous charts standing.
      clearMetricDashboards();
    }

    // Generate logs dashboard JSON
    // If we have correlated log streams from API, use those
    // Otherwise, if coming from logs page, use the source stream with matched dimensions
    const shouldGenerateLogsDashboard =
      (props.logStreams && props.logStreams.length > 0) ||
      (props.sourceType === "logs" && props.sourceStream);

    if (shouldGenerateLogsDashboard) {
      const logsDashboard = generateLogsDashboard(
        props.logStreams || [],
        config,
        props.logsPanelWidth,
        props.logsPanelHeight,
      );
      logsDashboardData.value = logsDashboard;
      logsDashboardRenderKey.value++;
    } else {
      // console.log("[TelemetryCorrelationDashboard] No log streams and not from logs page");
    }
  } catch (err: any) {
    // console.error("[TelemetryCorrelationDashboard] Error loading correlation dashboard:", err);
    const message: string = err.message || t("correlation.failedToLoad");
    error.value = message;
    showErrorNotification(message);
  } finally {
    loading.value = false;
  }
};

/**
 * Add new metric panels without re-rendering existing ones
 * This is called when user adds new metrics to avoid reloading all panels
 * Uses cached panel data if available to avoid refetching
 */
const addMetricPanels = async (addedStreams: StreamInfo[]) => {
  if (!dashboardData.value || !dashboardData.value.tabs?.[0]?.panels) {
    // No existing dashboard, do full load
    loadDashboard();
    return;
  }

  try {
    // Get current panels
    const currentPanels = dashboardData.value.tabs[0].panels;
    const timestamp = Date.now();

    // Separate streams into cached and new ones
    const cachedPanels: any[] = [];
    const streamsNeedingGeneration: StreamInfo[] = [];

    addedStreams.forEach((stream) => {
      const cached = panelDataCache.value.get(stream.stream_name);
      if (cached && timestamp - cached.timestamp < PANEL_CACHE_DURATION) {
        // Use cached panel data (no API call needed)
        cachedPanels.push({ stream, cachedPanel: cached.panel });
      } else {
        // Need to generate new panel (will fetch data)
        streamsNeedingGeneration.push(stream);
        // Clean up stale cache entry
        panelDataCache.value.delete(stream.stream_name);
      }
    });

    let newPanels: any[] = [];

    // Generate panels for streams that need fresh data
    if (streamsNeedingGeneration.length > 0) {
      const newStreamNames = streamsNeedingGeneration.map((s) => s.stream_name);
      const newSchemas = await fetchMetricSchemas(newStreamNames);

      const config: MetricsCorrelationConfig = {
        serviceName: props.serviceName,
        matchedDimensions: activeDimensions.value,
        metricStreams: streamsNeedingGeneration,
        logStreams: sortedLogStreams.value,
        traceStreams: sortedTraceStreams.value,
        orgIdentifier: currentOrgIdentifier.value,
        timeRange: props.timeRange,
        sourceStream: props.sourceStream,
        sourceType: props.sourceType,
        availableDimensions: props.availableDimensions,
        metricSchemas: newSchemas,
        semanticGroups: semanticGroups.value,
      };

      const newDashboard = generateDashboard(
        streamsNeedingGeneration,
        config,
        store.state.theme,
        props.panelWidth,
        props.panelHeight,
      );
      newPanels = newDashboard.tabs[0].panels;
    }

    // Combine cached panels with newly generated ones
    // Deep clone cached panels to avoid modifying the cache
    const allPanelsToAdd = [
      ...cachedPanels.map((cp) => JSON.parse(JSON.stringify(cp.cachedPanel))),
      ...newPanels,
    ];

    // Find the maximum Y position from existing panels to place new panels below
    let maxY = 0;
    currentPanels.forEach((p: any) => {
      if (p.layout) {
        const panelBottom = (p.layout.y || 0) + (p.layout.h || 16);
        if (panelBottom > maxY) maxY = panelBottom;
      }
    });

    const grid = 192;
    // Update layout positions for all panels being added
    allPanelsToAdd.forEach((panel: any, index: number) => {
      const uniqueId = `${panel.layout.i}_${timestamp}_${index}`;
      // Preserve original layout properties (w, h) from generateDashboard or cache
      panel.layout = {
        ...panel.layout,
        x: (index % Math.floor(grid / (props.panelWidth ?? 64))) * (props.panelWidth ?? 64),
        y:
          maxY +
          Math.floor(index / Math.floor(grid / (props.panelWidth ?? 64))) *
            (props.panelHeight ?? 16),
        i: uniqueId,
      };
      panel.id = `${panel.id}_${timestamp}`;
    });

    // Create new dashboard object by appending panels
    const updatedDashboard = {
      ...dashboardData.value,
      tabs: [
        {
          ...dashboardData.value.tabs[0],
          panels: [...currentPanels, ...allPanelsToAdd],
        },
        ...dashboardData.value.tabs.slice(1),
      ],
    };

    dashboardData.value = updatedDashboard;

    // Regenerate per-group dashboards so the group tabs stay up to date
    const groupConfig: MetricsCorrelationConfig = {
      serviceName: props.serviceName,
      matchedDimensions: activeDimensions.value,
      metricStreams: selectedMetricStreams.value,
      logStreams: sortedLogStreams.value,
      traceStreams: sortedTraceStreams.value,
      orgIdentifier: currentOrgIdentifier.value,
      timeRange: props.timeRange,
      sourceStream: props.sourceStream,
      sourceType: props.sourceType,
      availableDimensions: props.availableDimensions,
      metricSchemas: store.state.streams.metrics || {},
      semanticGroups: semanticGroups.value,
    };
    regenerateGroupDashboards(groupConfig);

    // Wait for DOM to fully update before refreshing GridStack
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await nextTick();

    if (dashboardChartsRef.value?.refreshGridStack) {
      await dashboardChartsRef.value.refreshGridStack();

      // Additional refresh after a short delay to ensure proper layout
      setTimeout(async () => {
        if (dashboardChartsRef.value?.refreshGridStack) {
          await dashboardChartsRef.value.refreshGridStack();
        }
      }, 100);
    }
  } catch (err: any) {
    console.error(
      "[TelemetryCorrelationDashboard] Error adding metric panels, falling back to full reload:",
      err,
    );
    loadDashboard();
  }
};

const onClose = () => {
  if (props.mode === "dialog") {
    isOpen.value = false;
  }
  // Reset initial load flag for next open
  initialLoadCompleted.value = false;
  emit("close");
};

// Helper function to format time range
const formatTimeRange = (range: TimeRange) => {
  // range.startTime and range.endTime are in microseconds (16 digits)
  // Convert to milliseconds by dividing by 1000, then render in the
  // user-selected timezone (falls back to UTC).
  const timezone = store.state.timezone || "UTC";
  const formatTime = (micros: number) =>
    timestampToTimezoneDate(Math.floor(micros / 1000), timezone, "HH:mm:ss");

  // Calculate duration in microseconds, then convert to minutes
  const durationMicros = range.endTime - range.startTime;
  const durationMinutes = Math.round(durationMicros / 1000 / 60000);

  return `${formatTime(range.startTime)} - ${formatTime(range.endTime)} (${durationMinutes} min)`;
};

// ============= TRACE CORRELATION FUNCTIONS =============

/**
 * Derive all possible field name variations from a base field name
 * For example, "trace_id" -> ["trace_id", "traceId", "traceid", "trace-id", "TraceId", "TRACE_ID", etc.]
 */
const deriveFieldNameVariations = (baseFieldName: string): string[] => {
  const variations = new Set<string>();

  // Add the original
  variations.add(baseFieldName);

  // Normalize to get base words (split by _, -, or camelCase)
  const words = baseFieldName
    .replace(/([a-z])([A-Z])/g, "$1_$2") // camelCase to snake_case
    .replace(/-/g, "_") // kebab to snake
    .toLowerCase()
    .split("_")
    .filter((w) => w.length > 0);

  if (words.length > 0) {
    // snake_case: trace_id
    variations.add(words.join("_"));

    // UPPER_SNAKE_CASE: TRACE_ID
    variations.add(words.join("_").toUpperCase());

    // kebab-case: trace-id
    variations.add(words.join("-"));

    // camelCase: traceId
    const camelCase =
      words[0] +
      words
        .slice(1)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
    variations.add(camelCase);

    // PascalCase: TraceId
    const pascalCase = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    variations.add(pascalCase);

    // lowercase: traceid
    variations.add(words.join(""));

    // UPPERCASE: TRACEID
    variations.add(words.join("").toUpperCase());
  }

  return Array.from(variations);
};

/**
 * Build regex patterns for extracting trace_id from text content
 * Dynamically generates patterns based on the configured field name
 * Supports: hex, alphanumeric, and UUID format trace IDs
 */
const buildTraceIdTextPatterns = (fieldName: string): RegExp[] => {
  const variations = deriveFieldNameVariations(fieldName);
  const patterns: RegExp[] = [];

  // UUID pattern: 8-4-4-4-12 hex with hyphens
  const uuidPattern = "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
  // Alphanumeric pattern: 16-64 chars
  const alphanumPattern = "[a-zA-Z0-9]{16,64}";

  for (const variant of variations) {
    // Escape special regex characters in the variant
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // UUID format patterns (must come first as they're more specific)
    // Pattern: [field_name uuid] - e.g., [trace_id 019411a7-30e7-7e8a-a456-426614174000]
    patterns.push(new RegExp(`\\[${escaped}\\s+(${uuidPattern})\\]`, "i"));

    // Pattern: field_name=uuid or field_name: uuid
    patterns.push(new RegExp(`${escaped}[=:]\\s*["']?(${uuidPattern})["']?`, "i"));

    // Pattern: "field_name": "uuid" (JSON)
    patterns.push(new RegExp(`"${escaped}"\\s*:\\s*"(${uuidPattern})"`, "i"));

    // Alphanumeric format patterns
    // Pattern: [field_name abc123] - handles formats like [trace_id 36eFC0BZ5e7PHLMEd1ojvr06I3K]
    patterns.push(new RegExp(`\\[${escaped}\\s+(${alphanumPattern})\\]`, "i"));

    // Pattern: [field_name abc123-suffix] - handles formats with dash suffix
    patterns.push(new RegExp(`\\[${escaped}\\s+(${alphanumPattern})(?:-[^\\]]*)?\\]`, "i"));

    // Pattern: field_name=abc123 or field_name: abc123 (possibly with dash suffix)
    patterns.push(
      new RegExp(`${escaped}[=:]\\s*["']?(${alphanumPattern})(?:-[^"'\\s]*)?["']?`, "i"),
    );

    // Pattern: "field_name": "abc123" (JSON, possibly with dash suffix)
    patterns.push(new RegExp(`"${escaped}"\\s*:\\s*"(${alphanumPattern})(?:-[^"]*)?\\s*"`, "i"));
  }

  return patterns;
};

/**
 * Extract trace_id from text content (like log body/message)
 * Uses dynamically generated patterns based on the configured trace_id_field_name
 */
const extractTraceIdFromText = (text: string): string | null => {
  if (!text || typeof text !== "string") return null;

  // Get the configured field name, default to 'trace_id'
  const configuredFieldName =
    store.state.organizationData?.organizationSettings?.trace_id_field_name || "trace_id";

  // Build patterns dynamically from the configured field name
  const patterns = buildTraceIdTextPatterns(configuredFieldName);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && isValidTraceId(match[1])) {
      return match[1];
    }
  }
  return null;
};

/**
 * Extract trace_id from the log record
 * Priority:
 * 1. Use configured trace_id_field_name from org settings (exact match)
 * 2. Scan derived field name variations from the configured name (structured fields)
 * 3. Scan FTS (Full Text Search) fields for embedded trace_id patterns in text content
 * 4. Fallback: Scan ALL string fields for embedded trace_id patterns
 */
const extractTraceIdFromLog = (): string | null => {
  const logRecord = props.availableDimensions;
  if (!logRecord) {
    return null;
  }

  // Get the configured field name, default to 'trace_id'
  const configuredTraceIdField =
    store.state.organizationData?.organizationSettings?.trace_id_field_name || "trace_id";

  // 1. First check the exact configured field name
  if (logRecord[configuredTraceIdField]) {
    const value = String(logRecord[configuredTraceIdField]);
    if (isValidTraceId(value)) {
      return value;
    }
  }

  // 2. Derive all field name variations from the configured name and scan them
  const fieldVariations = deriveFieldNameVariations(configuredTraceIdField);

  for (const variant of fieldVariations) {
    // Check exact match
    if (logRecord[variant]) {
      const value = String(logRecord[variant]);
      if (isValidTraceId(value)) {
        return value;
      }
    }

    // Check case-insensitive match against all log record keys
    const lowerVariant = variant.toLowerCase();
    for (const [key, val] of Object.entries(logRecord)) {
      if (key.toLowerCase() === lowerVariant && val) {
        const value = String(val);
        if (isValidTraceId(value)) {
          return value;
        }
      }
    }
  }

  // 3. Scan FTS (Full Text Search) fields for embedded trace_id patterns in text content
  // Use FTS fields from props if available, otherwise fall back to default FTS fields from config
  const ftsFieldsToScan = props.ftsFields?.length
    ? props.ftsFields
    : store.state.zoConfig?.default_fts_keys || ["body", "message", "log", "msg"];

  for (const field of ftsFieldsToScan) {
    // Check exact field name
    if (logRecord[field]) {
      const traceId = extractTraceIdFromText(String(logRecord[field]));
      if (traceId) {
        return traceId;
      }
    }

    // Check case-insensitive
    for (const [key, val] of Object.entries(logRecord)) {
      if (key.toLowerCase() === field.toLowerCase() && val) {
        const traceId = extractTraceIdFromText(String(val));
        if (traceId) {
          return traceId;
        }
      }
    }
  }

  // 4. Fallback: Scan ALL string fields for embedded trace_id patterns
  // This catches cases where trace_id is embedded in non-FTS fields
  const scannedFields = new Set(ftsFieldsToScan.map((f: string) => f.toLowerCase()));

  for (const [key, val] of Object.entries(logRecord)) {
    // Skip fields we already scanned and non-string values
    if (scannedFields.has(key.toLowerCase()) || typeof val !== "string") continue;

    // Only scan fields that look like they might contain text content
    const value = String(val);
    if (value.length > 50) {
      // Only scan longer strings that might be log messages
      const traceId = extractTraceIdFromText(value);
      if (traceId) {
        return traceId;
      }
    }
  }

  return null;
};

/**
 * Validate if a string looks like a valid trace ID
 * Supports multiple trace ID formats:
 * - Hex trace IDs: 16-64 hex characters (OpenTelemetry, Jaeger, Zipkin)
 * - Alphanumeric trace IDs: 16-64 alphanumeric characters (some custom systems)
 * - UUID format: 8-4-4-4-12 hex with hyphens (UUID v1, v4, v7, etc.)
 * - AWS X-Ray format: 1-{8 hex}-{24 hex} (e.g., 1-5759e988-bd862e3fe1be46a994272793)
 */
const isValidTraceId = (value: string): boolean => {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();

  // Pattern 1: Standard hex trace ID (OpenTelemetry, Jaeger, Zipkin)
  // 16-64 hex characters
  if (/^[a-fA-F0-9]{16,64}$/.test(trimmed)) {
    return true;
  }

  // Pattern 2: Alphanumeric trace ID (some systems use base64-like IDs)
  // 16-64 alphanumeric characters (letters and numbers)
  if (/^[a-zA-Z0-9]{16,64}$/.test(trimmed)) {
    return true;
  }

  // Pattern 3: UUID format (v1, v4, v7, etc.): 8-4-4-4-12 hex with hyphens
  // e.g., 019411a7-30e7-7e8a-a456-426614174000 (UUID v7)
  // e.g., 550e8400-e29b-41d4-a716-446655440000 (UUID v4)
  if (
    /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(trimmed)
  ) {
    return true;
  }

  // Pattern 4: AWS X-Ray format: 1-{8 hex}-{24 hex}
  if (/^1-[a-fA-F0-9]{8}-[a-fA-F0-9]{24}$/.test(trimmed)) {
    return true;
  }

  return false;
};

/**
 * Fetch full trace details (all spans) for a specific trace_id
 */
const fetchTraceByTraceId = async (traceId: string) => {
  if (!sortedTraceStreams.value.length) {
    return null;
  }

  const streamName = sortedTraceStreams.value[0].stream_name;

  // Use a wider time range when searching by specific trace_id
  // Since we have an exact trace_id, we can search across a larger window (24 hours before to now)
  // The log timestamp might not match the trace timestamp exactly
  const nowMicros = Date.now() * 1000;
  const oneDayAgoMicros = nowMicros - 24 * 60 * 60 * 1000000; // 24 hours in microseconds

  // Use the wider range: either 24h before now, or props.timeRange.startTime, whichever is earlier
  const searchStartTime = Math.min(oneDayAgoMicros, props.timeRange.startTime);
  const searchEndTime = nowMicros; // Always search up to now

  // First, get trace metadata to find time range
  const traceMetaResponse = await searchService.get_traces({
    org_identifier: currentOrgIdentifier.value,
    start_time: searchStartTime,
    end_time: searchEndTime,
    filter: `trace_id='${traceId}'`,
    size: 1,
    from: 0,
    stream_name: streamName,
  });

  if (!traceMetaResponse.data?.hits?.length) {
    return null;
  }

  const traceMeta = traceMetaResponse.data.hits[0];
  const traceStartTime = Math.floor(traceMeta.start_time / 1000) - 10000;
  const traceEndTime = Math.ceil(traceMeta.end_time / 1000) + 10000;

  // Now fetch all spans for this trace
  const query = {
    query: {
      sql: b64EncodeUnicode(
        `SELECT * FROM "${streamName}" WHERE trace_id = '${traceId}' ORDER BY start_time`,
      ),
      start_time: traceStartTime,
      end_time: traceEndTime,
      from: 0,
      size: 2500,
    },
    encoding: "base64",
  };

  const spansResponse = await searchService.search(
    {
      org_identifier: currentOrgIdentifier.value,
      query: query,
      page_type: "traces",
    },
    "ui",
  );

  return {
    traceMeta,
    spans: spansResponse.data?.hits || [],
  };
};

/**
 * Fetch traces via dimension-based correlation using HTTP streaming (/latest_stream)
 */
const fetchTracesByDimensions = (): Promise<any[]> => {
  if (!sortedTraceStreams.value.length) {
    return Promise.resolve([]);
  }

  const traceStreamInfo = sortedTraceStreams.value[0];
  const streamName = traceStreamInfo.stream_name;

  const filterParts: string[] = [];
  if (traceStreamInfo.filters) {
    for (const [fieldName, value] of Object.entries(traceStreamInfo.filters)) {
      filterParts.push(`${fieldName}='${value}'`);
    }
  }
  const filter = filterParts.join(" AND ");

  // Cancel any previous in-flight stream
  if (currentTracesStreamTraceId) {
    cancelStreamQueryBasedOnRequestId({
      trace_id: currentTracesStreamTraceId,
      org_id: currentOrgIdentifier.value,
    });
    currentTracesStreamTraceId = null;
  }

  const traceId = getUUID().replace(/-/g, "");
  currentTracesStreamTraceId = traceId;

  const accumulated: any[] = [];

  return new Promise((resolve, reject) => {
    (async () => {
      try {
        await fetchQueryDataWithHttpStream(
          {
            queryReq: {
              stream_name: streamName,
              filter: filter,
              start_time: props.timeRange.startTime,
              end_time: props.timeRange.endTime,
              from: 0,
              size: 10,
            },
            type: "traces",
            traceId,
            org_id: currentOrgIdentifier.value,
          },
          {
            data: (_: any, response: any) => {
              const hits: any[] = response.content?.results?.hits || [];
              if (hits.length > 0) {
                accumulated.push(...formatTracesMetaData(hits));
              }
            },
            error: (_: any, err: any) => {
              currentTracesStreamTraceId = null;
              reject(err);
            },
            complete: () => {
              currentTracesStreamTraceId = null;
              resolve(accumulated);
            },
            reset: () => {},
          },
        );
      } catch (e) {
        currentTracesStreamTraceId = null;
        reject(e);
      }
    })();
  });
};

/**
 * Open traces screen in new window with trace_id filter
 * @param traceIdOrEvent - trace_id string to use, or event object (when called from @click without args)
 */
const openTraceInNewWindow = (
  trace:
    | string
    | {
        trace_id?: string;
        trace_start_time?: number;
        trace_end_time?: number;
      },
) => {
  // Handle case where event object is passed instead of trace_id (e.g., from @click without args)
  const traceObj = typeof trace === "string" ? undefined : trace;
  const traceId = typeof trace === "string" ? trace : trace.trace_id;
  const targetTraceId = traceId || extractedTraceId.value;
  if (!targetTraceId) return;

  const org = store.state.selectedOrganization.identifier;
  const traceStream = sortedTraceStreams.value[0]?.stream_name || "default";
  const logStream = sortedLogStreams.value[0]?.stream_name;

  const queryParams: any = {
    stream: traceStream,
    trace_id: targetTraceId,
    from: traceObj?.trace_start_time
      ? traceObj.trace_start_time - 10000000
      : props.timeRange.startTime.toString(),
    to: traceObj?.trace_end_time
      ? traceObj.trace_end_time + 10000000
      : props.timeRange.endTime.toString(),
    org_identifier: org,
  };

  // Add log_stream parameter if available for auto-selection in trace details
  if (logStream) {
    queryParams.log_stream = logStream;
  }

  const route = router.resolve({
    name: "traceDetails",
    query: queryParams,
  });

  // Open in new window/tab
  window.open(route.href, "_blank");
};

/**
 * Open traces page with filters for all dimension-based correlated traces
 */
const openTracesPage = () => {
  const org = store.state.selectedOrganization.identifier;
  const traceStream = sortedTraceStreams.value[0]?.stream_name || "default";

  // Build filter query using all filters from trace stream
  const filterParts: string[] = [];
  const traceStreamInfo = sortedTraceStreams.value[0];

  if (traceStreamInfo?.filters) {
    for (const [fieldName, value] of Object.entries(traceStreamInfo.filters)) {
      filterParts.push(`${fieldName}='${value}'`);
    }
  }

  const filterQuery = filterParts.join(" AND ");

  // Build the URL to open traces page with filters
  const route = router.resolve({
    name: "traces",
    query: {
      stream: traceStream,
      from: props.timeRange.startTime,
      to: props.timeRange.endTime,
      query: b64EncodeUnicode(filterQuery), // Base64 encode the filter query
      org_identifier: org,
      tab: "traces",
    },
  });

  // Open in new window/tab
  window.open(route.href, "_blank");
};

/**
 * Load correlated traces
 */
const loadCorrelatedTraces = async () => {
  if (tracesLoading.value) return;

  tracesLoading.value = true;
  tracesError.value = null;
  extractedTraceId.value = null;
  traceCorrelationMode.value = null;
  traceSpanList.value = [];
  tracesForDimensions.value = [];

  try {
    // Step 1: Try to extract trace_id from the log record
    const traceId = extractTraceIdFromLog();

    if (traceId) {
      // Direct trace correlation - fetch full trace
      extractedTraceId.value = traceId;
      traceCorrelationMode.value = "direct";

      const traceData = await fetchTraceByTraceId(traceId);
      if (traceData && traceData.spans.length > 0) {
        traceSpanList.value = traceData.spans;
      } else {
        // Trace ID found but no spans - fall back to dimension-based
        traceCorrelationMode.value = "dimension-based";
        tracesForDimensions.value = await fetchTracesByDimensions();
      }
    } else {
      // No trace_id found - use dimension-based correlation
      traceCorrelationMode.value = "dimension-based";
      tracesForDimensions.value = await fetchTracesByDimensions();
    }
  } catch (err: any) {
    const message: string = err.message || t("correlation.tracesError");
    tracesError.value = message;
    showErrorNotification(message);
  } finally {
    tracesLoading.value = false;
  }
};

// Load traces when traces tab is shown
watch(
  () => activeTab.value,
  (newTab) => {
    if (newTab === "traces" && traceCorrelationMode.value === null && !tracesLoading.value) {
      loadCorrelatedTraces();
    }
  },
  { immediate: true },
);

// Load dashboard when modal opens
// First load semantic groups (required for metric filter transformation), then load dashboard
watch(
  () => isOpen.value,
  async (newVal) => {
    if (newVal) {
      // Load semantic groups first (required for applyUnstableDimensionDefaults)
      // Note: pendingDimensions and activeDimensions are now managed by the props watcher below
      await loadSemanticGroups();

      // Re-apply defaults now that semantic groups are loaded
      // Check if there are ANY unstable dimensions (either in additionalDimensions OR matchedDimensions with _o2_all_)
      const hasAdditionalDims = Object.keys(props.additionalDimensions || {}).length > 0;
      const hasUnstableInMatched = Object.values(props.matchedDimensions || {}).some(
        (v) => v === SELECT_ALL_VALUE,
      );
      if (semanticGroups.value.length > 0 && (hasAdditionalDims || hasUnstableInMatched)) {
        selectedMetricStreams.value = applyUnstableDimensionDefaults(selectedMetricStreams.value);
      }

      await loadDashboard();
      initialLoadCompleted.value = true;
    }
  },
  { immediate: true },
);

// Reload when selected metric streams change (only after initial load)
watch(
  selectedMetricStreams,
  (newStreams, oldStreams) => {
    // Skip if this is the initial load (already handled by isOpen watcher)
    if (!oldStreams || !initialLoadCompleted.value) {
      return;
    }

    // Check if streams actually changed (by name, not by filters)
    const changed =
      newStreams.length !== oldStreams.length ||
      newStreams.some((s, i) => s.stream_name !== oldStreams[i]?.stream_name);

    if (!changed) {
      return;
    }

    // Track if we're starting from empty state
    if (oldStreams.length === 0 && newStreams.length > 0) {
      wasEmptyBeforeChange = true;
    }

    // Clear any pending debounced operation
    if (streamChangeDebounceTimeout) {
      clearTimeout(streamChangeDebounceTimeout);
    }

    // Debounce the stream change to batch multiple hide/unhide operations
    streamChangeDebounceTimeout = setTimeout(() => {
      streamChangeDebounceTimeout = null;

      // Check actual current state when timeout fires (not captured values)
      const currentStreams = selectedMetricStreams.value;
      const currentPanels = dashboardData.value?.tabs?.[0]?.panels || [];

      // Every metric deselected: drop the charts so the empty state shows.
      // The reload paths below are all gated on a non-empty selection, so
      // without this the last-deselected metric's chart would linger.
      if (currentStreams.length === 0) {
        clearMetricDashboards();
        suppressNextStreamReload = false;
        return;
      }

      // Get current panel stream names
      const currentPanelStreamNames = new Set(
        currentPanels
          .map((p: any) => {
            // Extract stream name from panel id or layout
            const match = p.id?.match(/^(.+?)_\d+$/) || p.layout?.i?.match(/^(.+?)_/);
            return match ? match[1] : null;
          })
          .filter(Boolean),
      );

      // If no dashboard or transitioning from empty, do full reload
      if (!dashboardData.value || wasEmptyBeforeChange || currentPanels.length === 0) {
        wasEmptyBeforeChange = false;
        // Skip if a full reload is already scheduled (e.g. by onChipClick → applyDimensionChanges)
        if (suppressNextStreamReload) {
          suppressNextStreamReload = false;
          return;
        }
        if (isOpen.value && currentStreams.length > 0) {
          dashboardData.value = null;
          loadDashboard();
        }
        return;
      }

      // Determine which streams need to be added based on current state
      const streamsToAdd = currentStreams.filter(
        (s) => !currentPanelStreamNames.has(s.stream_name),
      );

      // Determine which panels need to be removed based on current state
      const currentStreamNames = new Set(currentStreams.map((s) => s.stream_name));
      const panelsToRemove = currentPanels.filter((p: any) => {
        const match = p.id?.match(/^(.+?)_\d+$/) || p.layout?.i?.match(/^(.+?)_/);
        const streamName = match ? match[1] : null;
        return streamName && !currentStreamNames.has(streamName);
      });

      // Cache panels before removal
      if (panelsToRemove.length > 0) {
        panelsToRemove.forEach((panel: any) => {
          const match = panel.id?.match(/^(.+?)_\d+$/) || panel.layout?.i?.match(/^(.+?)_/);
          const streamName = match ? match[1] : null;
          if (streamName) {
            panelDataCache.value.set(streamName, {
              panel: JSON.parse(JSON.stringify(panel)),
              timestamp: Date.now(),
            });
          }
        });
      }

      if (isOpen.value && currentStreams.length > 0) {
        if (suppressNextStreamReload) {
          // A full reload is already scheduled (e.g. by onChipClick → applyDimensionChanges)
          suppressNextStreamReload = false;
        } else if (panelsToRemove.length > 0) {
          // If panels need to be removed, do full reload
          dashboardData.value = null;
          nextTick(() => {
            loadDashboard();
          });
        } else if (streamsToAdd.length > 0) {
          // If only adding, use optimized append
          addMetricPanels(streamsToAdd);
        }
      }
    }, STREAM_CHANGE_DEBOUNCE_MS);
  },
  { deep: true },
);

// Re-apply unstable dimension defaults when additionalDimensions prop changes
// This handles the case where props are updated AFTER initial component mount
// Note: NOT immediate - only reacts to changes after initial load
watch(
  () => props.additionalDimensions,
  (newAdditionalDims, oldAdditionalDims) => {
    // Skip if this is the initial call (no old value) or initial load hasn't completed
    if (!oldAdditionalDims || !initialLoadCompleted.value) {
      return;
    }
    if (
      newAdditionalDims &&
      Object.keys(newAdditionalDims).length > 0 &&
      semanticGroups.value.length > 0
    ) {
      // Update pendingDimensions with new unstable dimension values from current "row"
      pendingDimensions.value = {
        ...props.matchedDimensions,
        ...newAdditionalDims,
      };

      selectedMetricStreams.value = applyUnstableDimensionDefaults(selectedMetricStreams.value);
      if (isOpen.value) {
        loadDashboard();
      }
    }
  },
);

// Re-apply unstable dimension defaults when matchedDimensions prop changes
// This handles the case where matchedDimensions contains _o2_all_ values for unstable dims
// Note: NOT immediate - only reacts to changes after initial load
watch(
  () => props.matchedDimensions,
  (newMatchedDims, oldMatchedDims) => {
    // Skip if this is the initial call (no old value) or initial load hasn't completed
    if (!oldMatchedDims || !initialLoadCompleted.value) {
      return;
    }

    // Update pendingDimensions with new matched dimension values from current "row"
    pendingDimensions.value = {
      ...newMatchedDims,
      ...(props.additionalDimensions || {}),
    };

    const hasUnstableInMatched = Object.values(newMatchedDims || {}).some(
      (v) => v === SELECT_ALL_VALUE,
    );
    if (hasUnstableInMatched && semanticGroups.value.length > 0) {
      selectedMetricStreams.value = applyUnstableDimensionDefaults(selectedMetricStreams.value);
      if (isOpen.value) {
        loadDashboard();
      }
    }
  },
);

// Watch activeSubject changes from OTabs to trigger the same logic as onChipClick
watch(
  () => activeSubject.value,
  (newSubject, oldSubject) => {
    // Skip if no change or not on metrics tab
    if (newSubject === oldSubject || activeTab.value !== "metrics") return;

    // Apply the same logic as onChipClick for subject selection
    if (newSubject) {
      pinSubject(newSubject, oldSubject);
      suppressNextStreamReload = true;
      applyActivePill();
      dashboardData.value = null;
      applyDimensionChanges();
    }
  },
);

// Watch all dimension props together to detect any changes
// This ensures filter dropdowns are always in sync with current row data
// Triggers when: component mounts, user switches rows, or props update
watch(
  () => ({
    matched: props.matchedDimensions,
    additional: props.additionalDimensions,
    service: props.serviceName,
  }),
  (newProps, oldProps) => {
    // Always update dimensions when props change (including initial mount)
    // This handles: first open, reopen with different row, and navigation between rows
    const newDimensions = {
      ...(newProps.matched || {}),
      ...(newProps.additional || {}),
    };

    // Only update if dimensions actually changed
    const dimensionsChanged =
      !oldProps ||
      JSON.stringify(newDimensions) !==
        JSON.stringify({
          ...(oldProps.matched || {}),
          ...(oldProps.additional || {}),
        });

    if (dimensionsChanged) {
      pendingDimensions.value = { ...newDimensions };
      activeDimensions.value = { ...newDimensions };
    }
  },
  { immediate: true, deep: true },
);
</script>

<style scoped>
/* keep(lib-override:o2-traces-tabs): reach child TraceDetails and O2 tab internals via :deep */
.telemetry-correlation-traces :deep(.trace-details-content) {
  padding: 0 !important;
}
.telemetry-correlation-traces :deep(.trace-combined-header-wrapper) {
  margin-bottom: 0 !important;
}
</style>
