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
  <div class="flex-1 flex min-h-0 h-full w-full" data-test="panel-editor-container">
    <div class="flex" :style="rowStyle">
      <!-- Chart Type Selection Sidebar -->
      <div>
        <div
          class="flex flex-col scroll bg-surface-panel! border-r border-border-default overflow-y-auto overflow-x-hidden h-full min-w-25 max-w-25"
        >
          <ChartSelection
            v-model:selectedChartType="dashboardPanelData.data.type"
            :allowedchartstype="props.allowedChartTypes"
            @update:selected-chart-type="resetAggregationFunction"
          />
        </div>
      </div>

      <!-- Query-related chart content (not html/markdown/custom_chart) -->
      <div
        v-if="
          !['html', 'markdown', 'custom_chart'].includes(
            dashboardPanelData.data.type,
          )
        "
        :class="mainContentContainerClass"
        :style="mainContentContainerStyle"
      >
        <!-- Collapsed field list bar -->
        <div
          v-if="!dashboardPanelData.layout.showFieldList"
          class="cursor-pointer overflow-y-auto flex flex-col items-center justify-start bg-surface-panel! border-r border-border-default w-12.5 h-full shrink-0"
          data-test="panel-editor-field-list-sidebar-collapsed"
          @click="collapseFieldList"
        >
          <OIcon
            name="expand-all"
            size="sm"
            class="mt-2.5 text-xl rotate-90"
            data-test="panel-editor-field-list-collapsed-icon"
          />
          <div class="[writing-mode:vertical-rl] [text-orientation:mixed] font-bold text-base">
            {{ t("panel.fields") }}
          </div>
        </div>

        <!-- Main splitter for field list -->
        <OSplitter
          v-model="dashboardPanelData.layout.splitter"
          :limits="splitterLimits"
          :style="splitterStyle"
          :disable="!dashboardPanelData.layout.showFieldList"
          separatorClass="field-list-separator"
          :separatorStyle="{ width: '10px', marginLeft: '-5px', marginRight: '-5px', zIndex: '10' }"
        >
          <!-- Field List (before slot) -->
          <template #before>
            <div :class="fieldListWrapperClass">
              <div
                v-if="dashboardPanelData.layout.showFieldList"
                class="flex flex-col bg-surface-panel!"
                :style="fieldListContainerStyle"
              >
                <div class="flex flex-col" :style="fieldListInnerStyle">
                  <PanelFieldList :editMode="editMode" @collapse="collapseFieldList" />
                </div>
              </div>
            </div>
          </template>

          <!-- Main content area (after slot) -->
          <template #after>
            <div :class="mainContentAreaClass" :style="afterSlotStyle">
              <div
                :class="afterSlotInnerClass"
                :style="afterSlotInnerStyle"
                @scroll.passive="onBuilderScroll"
              >
                <div
                  class="flex flex-col w-full h-full"
                  :style="layoutPanelContainerStyle"
                >
                  <!-- Mode selection + Add To Dashboard row. Skip when empty (e.g.
                       dashboard mode) so its `my-2` margin isn't dead space. -->
                  <div
                    v-if="pageType === 'build' || resolvedConfig.showAddToDashboardButton"
                    class="flex justify-between items-center my-2 mx-2"
                  >
                    <QueryTypeSelector
                      v-if="pageType === 'build'"
                      :showQueryType="false"
                    />
                    <div v-else />
                    <div class="flex items-center gap-2">
                      <OButton
                        v-if="resolvedConfig.showAddToDashboardButton"
                        data-test="panel-editor-add-to-dashboard-btn"
                        variant="primary"
                        size="xs"
                        @click="emit('addToDashboard')"
                        :title="t('search.addToDashboard')"
                      >
                        {{ t("search.addToDashboard") }}
                      </OButton>
                    </div>
                  </div>

                  <!-- Query Builder -->
                  <DashboardQueryBuilder
                    v-if="resolvedConfig.showQueryBuilder"
                    :dashboardData="dashboardData"
                    @custom-chart-template-selected="
                      handleCustomChartTemplateSelected
                    "
                  />
                  <OSeparator v-if="resolvedConfig.showQueryBuilder" />

                  <!-- Variables Selector (dashboard mode only) -->
                  <VariablesValueSelector
                    v-if="
                      resolvedConfig.showVariablesSelector &&
                      (dateTimeForVariables ||
                        (dashboardPanelData.meta.dateTime &&
                          dashboardPanelData.meta.dateTime.start_time &&
                          dashboardPanelData.meta.dateTime.end_time))
                    "
                    class="pl-3"
                    :variablesConfig="dashboardData?.variables"
                    :showDynamicFilters="
                      dashboardData?.variables?.showDynamicFilters
                    "
                    :selectedTimeDate="
                      dateTimeForVariables || dashboardPanelData.meta.dateTime
                    "
                    @variablesData="handleVariablesDataUpdated"
                    @openAddVariable="emit('openAddVariable')"
                    :initialVariableValues="initialVariableValues"
                    :showAddVariableButton="true"
                    :showAllVisible="true"
                    :tabId="tabId"
                    :panelId="panelId"
                  />

                  <!-- Outdated Warning -->
                  <div
                    v-if="resolvedConfig.showOutdatedWarning && isOutDated"
                    class="p-2"
                  >
                    <div
                      class="border border-banner-warning-border bg-banner-warning-bg p-[1%] rounded-default"
                     
                    >
                      <div class="font-bold">
                        Your chart is not up to date
                      </div>
                      <div>
                        Chart Configuration / Variables has been updated, but
                        the chart was not updated automatically. Click on the
                        "Apply" button to run the query again
                      </div>
                    </div>
                  </div>

                  <!-- Warning icons and last refreshed time -->
                  <div
                    class="flex justify-end mr-2 items-center gap-2"
                  >
                    <!-- Show Legends button (hidden when the chart has no data) -->
                    <OButton
                      v-if="
                        !panelSchemaRendererRef?.noData &&
                        ![
                          'table', 'heatmap', 'metric', 'gauge',
                          'geomap', 'maps',
                        ].includes(dashboardPanelData.data.type)
                      "
                      variant="ghost"
                      size="icon"
                      @click="showLegendsDialog = true"
                      icon-left="format-list-bulleted"
                      data-test="panel-editor-show-legends-btn"
                    >
                      <OTooltip content="Show Legends" side="bottom" align="end" />
                    </OButton>

                    <!-- Add Annotations button -->
                    <OButton
                      v-if="
                        editMode &&
                        pageType === 'dashboard' &&
                        [
                          'area', 'area-stacked', 'bar', 'h-bar',
                          'line', 'scatter', 'stacked', 'h-stacked',
                        ].includes(dashboardPanelData.data.type) &&
                        panelSchemaRendererRef?.checkIfPanelIsTimeSeries === true
                      "
                      variant="ghost"
                      size="icon"
                      @click="panelSchemaRendererRef?.toggleAddAnnotationMode()"
                      data-test="panel-editor-annotation-btn"
                    >
                      <OIcon
                        :name="
                          panelSchemaRendererRef?.isAddAnnotationMode
                            ? 'cancel'
                            : 'edit'
                        "
                        size="sm"
                      />
                      <OTooltip
                        :content="
                          panelSchemaRendererRef?.isAddAnnotationMode
                            ? 'Exit Annotations Mode'
                            : 'Add Annotations'
                        "
                        side="bottom"
                        align="end"
                      />
                    </OButton>

                    <PanelErrorButtons
                      :error="errorMessage"
                      :maxQueryRangeWarning="maxQueryRangeWarning"
                      :limitNumberOfSeriesWarningMessage="
                        limitNumberOfSeriesWarningMessage
                      "
                      :isCachedDataDifferWithCurrentTimeRange="
                        isCachedDataDifferWithCurrentTimeRange
                      "
                      :isPartialData="isPartialData"
                      :isPanelLoading="isPanelLoading"
                      :lastTriggeredAt="
                        resolvedConfig.showLastRefreshedTime
                          ? (lastTriggeredAt as any)
                          : null
                      "
                      :viewOnly="false"
                      :xAliasInconsistencyWarning="hasInconsistentXAlias"
                    />
                  </div>

                  <!-- Chart Area -->
                  <div
                    v-if="!resolvedConfig.hideChartPreview"
                    class="flex flex-col relative overflow-hidden h-full"
                  >
                    <div :class="chartAreaClass" :style="chartAreaStyle">
                      <PanelSchemaRenderer
                        v-if="chartData"
                        ref="panelSchemaRendererRef"
                        :key="dashboardPanelData.data.type"
                        :panelSchema="chartData"
                        :dashboard-id="dashboardId"
                        :folder-id="folderId"
                        :selectedTimeObj="dashboardPanelData.meta.dateTime"
                        :variablesData="resolvedVariablesData"
                        :allowAnnotationsAdd="
                          editMode && pageType === 'dashboard'
                        "
                        :allowAlertCreation="pageType === 'metrics'"
                        :width="6"
                        :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                        :regionClusterParams="props.regionClusterParams"
                        :showLegendsButton="false"
                        :searchType="searchType"
                        :searchResponse="props.searchResponse"
                        :is_ui_histogram="props.isUiHistogram"
                        @metadata-update="metaDataValue"
                        @result-metadata-update="handleResultMetadataUpdate"
                        @limit-number-of-series-warning-message-update="
                          handleLimitNumberOfSeriesWarningMessage
                        "
                        @error="handleChartApiError"
                        @updated:data-zoom="handleDataZoom"
                        @updated:vrl-function-field-list="
                          updateVrlFunctionFieldList
                        "
                        @last-triggered-at-update="handleLastTriggeredAtUpdate"
                        @series-data-update="seriesDataUpdate"
                        @show-legends="showLegendsDialog = true"
                        @is-partial-data-update="handleIsPartialDataUpdate"
                        @loading-state-change="handleLoadingStateChange"
                        @is-cached-data-differ-with-current-time-range-update="
                          handleIsCachedDataDifferWithCurrentTimeRangeUpdate
                        "
                        @update:initial-variable-values="
                          handleInitialVariableValuesUpdate
                        "
                      />
                    </div>
                  </div>

                  <!-- Errors Component -->
                  <DashboardErrorsComponent
                    :errors="errorData"
                    class="col-auto shrink-0"
                  />
                </div>

                <!-- Query Editor -->
                <div
                  v-if="resolvedConfig.showQueryEditor"
                  class="flex flex-col"
                  :style="{
                    height: 'calc(100vh - var(--navbar-height) - 144px)',
                  }"
                >
                  <DashboardQueryEditor />
                </div>
              </div>

              <OSeparator vertical />

              <!-- Config Panel Sidebar -->
              <div
                class="col-auto"
                :style="
                  pageType === 'logs' || pageType === 'build'
                    ? { height: '100%' }
                    : {}
                "
              >
                <PanelSidebar
                  :title="t('dashboard.configLabel')"
                  v-model="dashboardPanelData.layout.isConfigPanelOpen"
                >
                  <ConfigPanel
                    :dashboardPanelData="dashboardPanelData"
                    :variablesData="resolvedVariablesData"
                    :panelData="seriesData"
                  />
                </PanelSidebar>
              </div>
            </div>
          </template>
        </OSplitter>
      </div>

      <!-- HTML Editor Section -->
      <div
        v-if="dashboardPanelData.data.type === 'html'"
        class="flex flex-col column"
        :style="{ height: contentHeight, flex: 1 }"
      >
        <div class="bg-card-glass-bg h-full flex flex-col">
          <!-- Variables Selector for HTML (dashboard mode only) -->
          <VariablesValueSelector
            v-if="resolvedConfig.showVariablesSelector"
            :variablesConfig="dashboardData?.variables"
            :showDynamicFilters="dashboardData?.variables?.showDynamicFilters"
            :selectedTimeDate="dashboardPanelData.meta.dateTime"
            @variablesData="handleVariablesDataUpdated"
            :initialVariableValues="initialVariableValues"
            class="shrink-0 mb-2"
            :showAddVariableButton="true"
            :showAllVisible="true"
            :tabId="tabId"
            :panelId="panelId"
          />
          <CustomHTMLEditor class="flex-1 min-h-0"
            v-model="dashboardPanelData.data.htmlContent"
            :initialVariableValues="liveVariablesData"
            :tabId="tabId"
            :panelId="panelId"
          />
          <DashboardErrorsComponent
            :errors="errorData"
            class="shrink-0"
          />
        </div>
      </div>

      <!-- Markdown Editor Section -->
      <div
        v-if="dashboardPanelData.data.type === 'markdown'"
        class="flex flex-col column"
        :style="{ height: contentHeight, flex: 1 }"
      >
        <div class="bg-card-glass-bg h-full flex flex-col">
          <!-- Variables Selector for Markdown (dashboard mode only) -->
          <VariablesValueSelector
            v-if="resolvedConfig.showVariablesSelector"
            :variablesConfig="dashboardData?.variables"
            :showDynamicFilters="dashboardData?.variables?.showDynamicFilters"
            :selectedTimeDate="dashboardPanelData.meta.dateTime"
            @variablesData="handleVariablesDataUpdated"
            :initialVariableValues="initialVariableValues"
            class="shrink-0 mb-2"
            :showAddVariableButton="true"
            :showAllVisible="true"
            :tabId="tabId"
            :panelId="panelId"
          />
          <CustomMarkdownEditor class="flex-1 min-h-0"
            v-model="dashboardPanelData.data.markdownContent"
            :initialVariableValues="liveVariablesData"
            :tabId="tabId"
            :panelId="panelId"
          />
          <DashboardErrorsComponent
            :errors="errorData"
            class="shrink-0"
          />
        </div>
      </div>

      <!-- Custom Chart Editor Section -->
      <div
        v-if="dashboardPanelData.data.type === 'custom_chart'"
        class="flex"
        :style="{ height: contentHeight, flex: 1, overflow: 'hidden' }"
      >
        <!-- Collapsed field list bar for custom chart -->
        <div
          v-if="!dashboardPanelData.layout.showFieldList"
          class="cursor-pointer overflow-y-auto flex flex-col items-center justify-start bg-surface-panel! border-r border-border-default w-12.5 h-full shrink-0"
          data-test="panel-editor-field-list-sidebar-collapsed"
          @click="collapseFieldList"
        >
          <OIcon
            name="expand-all"
            size="sm"
            class="mt-2.5 text-xl rotate-90"
            data-test="panel-editor-field-list-collapsed-icon"
          />
          <div class="[writing-mode:vertical-rl] [text-orientation:mixed] font-bold text-base">
            {{ t("panel.fields") }}
          </div>
        </div>

        <!-- Custom chart splitter -->
        <OSplitter
          v-model="dashboardPanelData.layout.splitter"
          :limits="[0, 20]"
          :disable="!dashboardPanelData.layout.showFieldList"
          :style="{
            width: dashboardPanelData.layout.showFieldList
              ? '100%'
              : 'calc(100% - 50px)',
            height: '100%',
          }"
          separatorClass="field-list-separator"
          :separatorStyle="{ width: '10px', marginLeft: '-5px', marginRight: '-5px', zIndex: '10' }"
        >
          <!-- Field List for custom chart -->
          <!-- Mirror the normal field-list block above: a fixed-height wrapper
               with NO overflow of its own, so PanelFieldList's inner OFieldList
               is the single scroller and its stream selectors (before-list)
               stay sticky above the scrolling field rows. Wrapping it in an
               overflow-y-auto container stacked a second scrollbar and let the
               dropdowns scroll away. -->
          <template #before>
            <div :class="fieldListWrapperClass">
              <div
                v-if="dashboardPanelData.layout.showFieldList"
                class="flex flex-col bg-surface-panel!"
                :style="fieldListContainerStyle"
              >
                <div class="flex flex-col" :style="fieldListInnerStyle">
                  <PanelFieldList :editMode="editMode" @collapse="collapseFieldList" />
                </div>
              </div>
            </div>
          </template>

          <!-- Custom chart content area -->
          <template #after>
            <div
              class="flex bg-card-glass-bg"
              :style="{ height: contentHeight, overflow: 'hidden' }"
            >
              <div
                class="flex flex-col scroll flex-1 min-w-0 h-full"
              >
                <!-- Editor/Preview splitter -->
                <div class="h-125 shrink-0 overflow-hidden">
                  <OSplitter
                    class="query-editor-splitter h-full"
                    v-model="splitterModel"
                    @update:model-value="layoutSplitterUpdated"
                  >
                    <!-- Custom Chart Editor -->
                    <template #before>
                      <div class="relative w-full h-full">
                        <CustomChartEditor class="w-full h-full"
                          v-model="dashboardPanelData.data.customChartContent"
                        />
                        <!-- Example Charts button (dashboard mode only) -->
                        <div
                          v-if="pageType === 'dashboard'"
                          class="absolute bottom-2.5 right-2.5 z-10"
                        >
                          <OButton
                            variant="primary"
                            size="sm"
                            @click="showCustomChartTypeSelector = true"
                            data-test="custom-chart-type-selector-btn"
                          >
                            <template #icon-left><OIcon name="bar-chart" size="sm"
                            /></template>
                            Example Charts
                          </OButton>
                          <ODialog
                            data-test="panel-editor-custom-chart-type-selector-dialog"
                            v-model:open="showCustomChartTypeSelector"
                            :show-close="false"
                            :width="95"
                          >
                            <CustomChartTypeSelector
                              @select="handleChartTypeSelection"
                              @close="showCustomChartTypeSelector = false"
                            />
                          </ODialog>
                        </div>
                      </div>
                    </template>

                    <!-- Splitter separator -->
                    <template #separator>
                      <div class="w-1 h-full bg-transparent transition-colors duration-300 hover:bg-table-resize-handle"></div>
                    </template>

                    <!-- Chart Preview -->
                    <template #after>
                      <div class="flex flex-col h-full">
                        <div class="flex justify-end mr-2 mt-1 items-center gap-2">
                          <PanelErrorButtons
                            :error="errorMessage"
                            :maxQueryRangeWarning="maxQueryRangeWarning"
                            :limitNumberOfSeriesWarningMessage="limitNumberOfSeriesWarningMessage"
                            :isCachedDataDifferWithCurrentTimeRange="isCachedDataDifferWithCurrentTimeRange"
                            :isPartialData="isPartialData"
                            :isPanelLoading="isPanelLoading"
                            :lastTriggeredAt="null"
                            :viewOnly="false"
                            :xAliasInconsistencyWarning="hasInconsistentXAlias"
                          />
                        </div>
                        <PanelSchemaRenderer
                          v-if="chartData"
                          ref="panelSchemaRendererRef"
                          :key="dashboardPanelData.data.type"
                          :panelSchema="chartData"
                          :dashboard-id="dashboardId"
                          :folder-id="folderId"
                          :selectedTimeObj="dashboardPanelData.meta.dateTime"
                          :variablesData="resolvedVariablesData"
                          :width="6"
                          :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                          :regionClusterParams="props.regionClusterParams"
                          :showLegendsButton="true"
                          :searchType="searchType"
                          :searchResponse="props.searchResponse"
                          :is_ui_histogram="props.isUiHistogram"
                          @metadata-update="metaDataValue"
                          @result-metadata-update="handleResultMetadataUpdate"
                          @limit-number-of-series-warning-message-update="
                            handleLimitNumberOfSeriesWarningMessage
                          "
                          @error="handleChartApiError"
                          @updated:data-zoom="handleDataZoom"
                          @updated:vrl-function-field-list="
                            updateVrlFunctionFieldList
                          "
                          @last-triggered-at-update="handleLastTriggeredAtUpdate"
                          @series-data-update="seriesDataUpdate"
                          @show-legends="showLegendsDialog = true"
                          @is-partial-data-update="handleIsPartialDataUpdate"
                          @loading-state-change="handleLoadingStateChange"
                          @is-cached-data-differ-with-current-time-range-update="
                            handleIsCachedDataDifferWithCurrentTimeRangeUpdate
                          "
                          @update:initial-variable-values="
                            handleInitialVariableValuesUpdate
                          "
                        />
                      </div>
                    </template>
                  </OSplitter>
                </div>

                <!-- Errors Component -->
                <div class="col-auto shrink-0">
                  <DashboardErrorsComponent
                    :errors="errorData"
                    class="col-auto shrink-0"
                  />
                </div>

                <!-- Query Editor for custom chart -->
                <div
                  v-if="resolvedConfig.showQueryEditor"
                  class="flex flex-col"
                  :style="{
                    height: 'calc(100vh - var(--navbar-height) - 144px)',
                  }"
                >
                  <DashboardQueryEditor />
                </div>
              </div>

              <OSeparator vertical />

              <!-- Config Panel Sidebar for custom chart -->
              <div class="col-auto">
                <PanelSidebar
                  :title="t('dashboard.configLabel')"
                  v-model="dashboardPanelData.layout.isConfigPanelOpen"
                >
                  <ConfigPanel
                    :dashboardPanelData="dashboardPanelData"
                    :variablesData="resolvedVariablesData"
                    :panelData="seriesData"
                  />
                </PanelSidebar>
              </div>
            </div>
          </template>
        </OSplitter>
      </div>
    </div>

    <!-- Legends Dialog -->
    <ShowLegendsPopup
      v-model:open="showLegendsDialog"
      :panelData="currentPanelData"
      data-test="panel-editor-legends-dialog"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  provide,
  defineAsyncComponent,
  toRef,
  watch,
  type CSSProperties,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import type {
  PanelEditorProps,
  PanelEditorEmits,
  PanelEditorConfig,
  PanelEditorVariablesData,
} from "./types/panelEditor";
import { resolveConfig } from "./types/panelEditor";
import { usePanelEditor } from "./composables/usePanelEditor";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

// ============================================================================
// Component Imports
// ============================================================================

import ChartSelection from "@/components/dashboards/addPanel/ChartSelection.vue";
import PanelFieldList from "@/components/dashboards/addPanel/PanelFieldList.vue";
import PanelSidebar from "@/components/dashboards/addPanel/PanelSidebar.vue";
import DashboardQueryBuilder from "@/components/dashboards/addPanel/DashboardQueryBuilder.vue";
import DashboardErrorsComponent from "@/components/dashboards/addPanel/DashboardErrors.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import PanelErrorButtons from "@/components/dashboards/PanelErrorButtons.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

// Async component imports for code splitting
const ConfigPanel = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/ConfigPanel.vue"),
);
const ShowLegendsPopup = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/ShowLegendsPopup.vue"),
);
const VariablesValueSelector = defineAsyncComponent(
  () => import("@/components/dashboards/VariablesValueSelector.vue"),
);
const DashboardQueryEditor = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/DashboardQueryEditor.vue"),
);
const CustomHTMLEditor = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/CustomHTMLEditor.vue"),
);
const CustomMarkdownEditor = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/CustomMarkdownEditor.vue"),
);
const CustomChartEditor = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/CustomChartEditor.vue"),
);
const CustomChartTypeSelector = defineAsyncComponent(
  () =>
    import("@/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue"),
);
const QueryTypeSelector = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/QueryTypeSelector.vue"),
);

// ============================================================================
// Props and Emits
// ============================================================================

const props = withDefaults(defineProps<PanelEditorProps>(), {
  showQueryEditor: undefined,
  showQueryBuilder: undefined,
  showVariablesSelector: undefined,
  showLastRefreshedTime: undefined,
  showOutdatedWarning: undefined,
  showAddToDashboardButton: undefined,
  allowedChartTypes: undefined,
  externalChartData: undefined,
  searchResponse: undefined,
  isUiHistogram: false,
  shouldRefreshWithoutCache: false,
  regionClusterParams: undefined,
  selectedDateTime: undefined,
  variablesData: undefined,
  dashboardData: undefined,
  editMode: false,
});

const emit = defineEmits<PanelEditorEmits>();

// ============================================================================
// Setup
// ============================================================================

const { t } = useI18n();
const store = useStore();

// Resolve configuration (merge props with presets)
const resolvedConfig = computed<PanelEditorConfig>(() => resolveConfig(props));

// Get dashboard panel data composable
const pageKey = computed(() => props.pageType);
const {
  dashboardPanelData,
  resetAggregationFunction,
  makeAutoSQLQuery,
  validatePanel,
} = useDashboardPanelData(pageKey.value);

// Provide page key for child components
provide("dashboardPanelDataPageKey", pageKey.value);

// Close any open OSelect/ODropdown in the builder/joins area when the main
// content scrolls, so portaled menus never float detached from their trigger.
// Mirrors the config panel's mechanism in PanelSidebar.vue.
const builderScrollTick = ref(0);
provide("sidebarScrollTick", builderScrollTick);
const onBuilderScroll = () => {
  builderScrollTick.value++;
};

// ============================================================================
// usePanelEditor Composable
// ============================================================================

const editModeRef = toRef(props, "editMode");
const externalChartDataRef = toRef(props, "externalChartData");

const {
  // State refs
  chartData,
  errorData,
  metaData,
  seriesData,
  lastTriggeredAt,
  showLegendsDialog,
  shouldRefreshWithoutCache,
  maxQueryRangeWarning,
  limitNumberOfSeriesWarningMessage,
  errorMessage,
  isPartialData,
  isPanelLoading,
  isCachedDataDifferWithCurrentTimeRange,
  searchRequestTraceIds,
  panelSchemaRendererRef,
  splitterModel,

  // Computed
  isOutDated,
  isLoading,
  currentPanelData,

  // Actions
  initChartData,
  runQuery,
  handleChartApiError,
  handleLastTriggeredAtUpdate,
  handleLimitNumberOfSeriesWarningMessage,
  handleIsPartialDataUpdate,
  handleLoadingStateChange,
  handleIsCachedDataDifferWithCurrentTimeRangeUpdate,
  handleResultMetadataUpdate,
  metaDataValue,
  seriesDataUpdate,
  collapseFieldList,
  layoutSplitterUpdated,
  updateVrlFunctionFieldList,
  onDataZoom,
  cancelRunningQuery,
  resetErrors,
  updateDateTime,
} = usePanelEditor({
  pageType: props.pageType,
  config: resolvedConfig.value,
  dashboardPanelData,
  editMode: editModeRef,
  externalChartData: externalChartDataRef,
  variablesData: props.variablesData,
  updatedVariablesData: props.variablesData, // Will be managed by parent
  updateCommittedVariables: undefined, // Will be provided by parent
  dateTimePickerRef: undefined, // Managed by parent
  selectedDate: undefined, // Managed by parent
  validatePanel,
});

// ============================================================================
// Custom Chart State
// ============================================================================

const showCustomChartTypeSelector = ref(false);

// ============================================================================
// Computed Properties
// ============================================================================

// X-axis alias consistency warning for multi-SQL panels
// Only applicable for chart types that render an x-axis
const xAxisChartTypes = new Set([
  "line", "area", "area-stacked", "stacked", "h-stacked",
  "bar", "h-bar", "scatter",
]);
const hasInconsistentXAlias = computed(() => {
  if (!xAxisChartTypes.has(dashboardPanelData.data.type)) return false;

  // Only check builder-mode queries — custom SQL queries don't have
  // functionName metadata, so including them causes false positives
  // when the user writes SQL with the same timestamp field.
  const activeQueries = dashboardPanelData.data.queries.filter(
    (_: any, idx: number) =>
      !(dashboardPanelData.layout.hiddenQueries || []).includes(idx),
  );
  const builderQueries = activeQueries.filter(
    (q: any) => !q.customQuery && q.fields.x && q.fields.x.length > 0,
  );
  if (builderQueries.length < 2) return false;
  const hasHistogram = builderQueries.some((q: any) =>
    q.fields.x.some((f: any) => f.functionName === "histogram"),
  );
  const hasNonHistogram = builderQueries.some((q: any) =>
    q.fields.x.some((f: any) => f.functionName !== "histogram"),
  );
  return hasHistogram && hasNonHistogram;
});

// Content height based on page type
const contentHeight = computed(() => {
  switch (props.pageType) {
    case "dashboard":
      return "100%";
    case "metrics":
      return "100%";
    case "logs":
      return "calc(100% - 36px)";
    case "build":
      return "calc(100vh - var(--navbar-height) - 24px)";
    default:
      return "100%";
  }
});

// Chart area class based on page type
const chartAreaClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "h-[calc(100%-36px)] min-h-35";
  }
  return "min-h-35 mt-10";
});

// Chart area style based on page type (uses CSS var for dynamic navbar height)
const chartAreaStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return {};
  }
  return {
    height: "calc(100vh - var(--navbar-height) - 464px)",
    marginTop: "0px",
  };
});

// Main content area class - logs needs flat background without card styling
const mainContentAreaClass = computed(() => {
  if (props.pageType === "logs") {
    return "flex bg-card-glass-bg";
  }
  return "flex bg-card-glass-bg h-full overflow-y-hidden";
});

// Row style - logs/build needs height: 100%, others need overflow-y: auto
const rowStyle = computed<CSSProperties>(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { height: "100%", width: "100%" };
  }
  return { overflowY: "auto", width: '100%' };
});

// Main content container class - logs/build uses vertical flex, others use horizontal
const mainContentContainerClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "flex flex-row flex-1";
  }
  return "flex flex-row flex-1";
});

// Main content container style
const mainContentContainerStyle = computed<CSSProperties>(() => {
  // if (props.pageType === "logs" || props.pageType === "build") {
  //   return { width: "100%", height: "100%" };
  // }
  // flex:1 and minWidth:0 are required so this column fills the remaining row width
  // (alongside the fixed-width ChartSelection sidebar) and lets the inner OSplitter
  // resolve its `width: 100%` against a real parent width instead of intrinsic content.
  return {
    display: "flex",
    flexDirection: "row",
    overflowX: "hidden",
    flex: "1 1 0%",
    minWidth: "0",
  };
});

// Splitter limits - logs/build uses [0, 100], others use [0, 20]
const splitterLimits = computed<[number, number]>(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return [0, 100];
  }
  return [0, 20];
});

// Splitter style
const splitterStyle = computed(() => {
  return {
    width: dashboardPanelData.layout.showFieldList
      ? "100%"
      : "calc(100% - 50px)",
    height: "100%",
  };
});

// After slot (main content area) outer div style
const afterSlotStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return {
      height: "100%",
      width: "100%"
    };
  }
  return {};
});

// After slot inner div class - logs/build uses "flex flex-col", others use "flex flex-col scroll"
const afterSlotInnerClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "flex flex-col flex-1 min-w-0";
  }
  return "scroll flex-1 min-w-0";
});

// After slot inner div style
const afterSlotInnerStyle = computed<CSSProperties>(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { height: "100%" };
  }
  return { height: contentHeight.value, overflowY: "auto" };
});

// Layout panel container style - logs/build needs height: 100%
const layoutPanelContainerStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { height: "100%" };
  }
  // height: auto overrides the h-full class so the container sizes to its
  // content instead of filling afterSlotInner. This also makes the chart area
  // wrapper's h-full resolve to auto, matching the inner chart div's
  // explicit height and eliminating the empty space below the legends.
  return { height: "auto" };
});

// Field list wrapper class - logs/build doesn't need padding-bottom
const fieldListWrapperClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "w-full h-full";
  }
  return "w-full h-full";
});

// Field list container style
const fieldListContainerStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { height: "100%" };
  }
  return { height: contentHeight.value };
});

// Field list inner div style - needs height: 100% so PanelFieldList's h-full resolves correctly
const fieldListInnerStyle = computed(() => {
  return { width: "100%", height: "100%" };
});

// Search type for PanelSchemaRenderer
const searchType = computed(() => {
  switch (props.pageType) {
    case "dashboard":
      return "dashboards";
    case "metrics":
      return "ui";
    case "logs":
      return "ui";
    case "build":
      return "dashboards";
    default:
      return "dashboards";
  }
});

// Resolved variables data
const resolvedVariablesData = computed(() => {
  if (props.variablesData) {
    return props.variablesData;
  }
  // For metrics/logs mode, return empty object
  return {};
});

// Live variables data (for HTML/Markdown editors)
const liveVariablesData = computed(() => {
  return props.variablesData || { isVariablesLoading: false, values: [] };
});

// ============================================================================
// Props forwarding
// ============================================================================

const dashboardId = computed(() => props.dashboardData?.dashboardId);
const folderId = computed(() => props.dashboardData?.folderId);
const dashboardData = computed(() => props.dashboardData || {});
const initialVariableValues = computed(() => ({})); // Can be passed from parent
const dateTimeForVariables = computed(() => props.selectedDateTime);
const tabId = computed(() => props.dashboardData?.tabId || "");
const panelId = computed(() => props.dashboardData?.panelId || "");
const editMode = computed(() => props.editMode);

// ============================================================================
// Event Handlers
// ============================================================================

const handleVariablesDataUpdated = (data: PanelEditorVariablesData) => {
  emit("variablesDataUpdated", data);
};

const handleDataZoom = (event: any) => {
  const result = onDataZoom(event);
  emit("dataZoom", {
    start: result.start.getTime(),
    end: result.end.getTime(),
  });
};

const handleInitialVariableValuesUpdate = (values: Record<string, any>) => {
  emit("initialVariableValuesUpdated", values);
};

const handleCustomChartTemplateSelected = (templateCode: string) => {
  dashboardPanelData.data.customChartContent = templateCode;
};

const handleChartTypeSelection = async (selection: any) => {
  // This will be handled by the parent component for dashboard mode
  // For metrics/logs, custom charts may not be supported
  if (props.pageType === "dashboard") {
    const chart = selection.chart || selection;
    const replaceQuery = selection.replaceQuery ?? false;

    try {
      const { loadCustomChartTemplate } =
        await import("@/components/dashboards/addPanel/customChartExamples/customChartTemplates");
      const template = await loadCustomChartTemplate(chart.value);

      if (template) {
        const defaultComments = `// To know more about ECharts ,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple
// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from the search result and it is an array.
`;
        dashboardPanelData.data.customChartContent =
          defaultComments + template.code;

        const currentQueryIndex =
          dashboardPanelData.layout.currentQueryIndex || 0;
        if (dashboardPanelData.data.queries[currentQueryIndex]) {
          if (replaceQuery && template.query && template.query.trim()) {
            dashboardPanelData.data.queries[currentQueryIndex].query =
              template.query.trim();
            dashboardPanelData.data.queries[currentQueryIndex].customQuery =
              true;
          }
        }
      }
    } catch (error) {
      console.error("Error applying chart template:", error);
    }
  }

  showCustomChartTypeSelector.value = false;
};

// ============================================================================
// Field Change Watchers (Auto SQL Generation)
// ============================================================================

// Watch for builder field changes to auto-generate SQL query
// This is the centralized watcher that replaces duplicate watchers in AddPanel, Metrics, and BuildQueryPage
watch(
  () => [
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.stream,
    // Rebuild the auto query once the stream schema loads (makeAutoSQLQuery bails
    // out while groupedFields is empty).
    dashboardPanelData.meta?.streamFields?.groupedFields?.length,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.x,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.y,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.breakdown,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.z,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.filter,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.customQuery,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.latitude,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.longitude,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.weight,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.source,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.target,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.value,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.name,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.fields?.value_for_maps,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.config?.limit,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.joins,
    dashboardPanelData.data.type,
  ],
  async () => {
    // Only auto-generate SQL if in builder mode (customQuery = false)
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.customQuery
    ) {
      const result = await makeAutoSQLQuery();

      // Only emit if makeAutoSQLQuery actually ran and generated a query
      // Don't emit when it returns early (undefined) due to missing stream fields
      // This prevents clearing the query on page load before stream fields are loaded
      if (result !== undefined) {
        emit("queryGenerated", result);
      }
    }
  },
  { deep: true },
);

// Watch for customQuery mode changes to notify parent
watch(
  () =>
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
      ?.customQuery,
  (isCustomMode) => {
    emit("customQueryModeChanged", isCustomMode ?? false);
  },
  { immediate: true },
);

// Watch for searchRequestTraceIds changes to notify parent (for cancel query functionality)
watch(
  searchRequestTraceIds,
  (newTraceIds) => {
    emit("searchRequestTraceIdsUpdated", newTraceIds);
  },
  { immediate: true },
);

// Watch for metaData changes to emit to parent (for QueryInspector)
watch(
  metaData,
  (newMetaData) => {
    // This ensures parent (AddPanel) stays in sync with PanelEditor's metadata state
    emit("metaDataUpdated", newMetaData);
  },
  { deep: true },
);

// ============================================================================
// Expose
// ============================================================================

defineExpose({
  // Actions
  initChartData,
  runQuery,
  resetErrors,
  collapseFieldList,
  updateDateTime,
  cancelRunningQuery,

  // State refs
  chartData,
  errorData,
  metaData,
  seriesData,
  lastTriggeredAt,

  // Panel data
  dashboardPanelData,
  isOutDated,

  // Loading state
  isLoading,
  searchRequestTraceIds,

  // Warning messages
  maxQueryRangeWarning,
  limitNumberOfSeriesWarningMessage,
  errorMessage,
});
</script>
