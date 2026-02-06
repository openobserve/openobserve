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

<template>
  <div class="panel-editor">
    <div class="row" :style="rowStyle">
      <!-- Chart Type Selection Sidebar -->
      <div class="tw:pl-[0.625rem]">
        <div
          class="col scroll card-container tw:mr-[0.625rem]"
          style="
            overflow-y: auto;
            height: 100%;
            min-width: 100px;
            max-width: 100px;
          "
        >
          <ChartSelection
            v-model:selectedChartType="dashboardPanelData.data.type"
            :allowedchartstype="props.allowedChartTypes"
            @update:selected-chart-type="resetAggregationFunction"
          />
        </div>
      </div>
      <q-separator vertical />

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
          class="field-list-sidebar-header-collapsed card-container"
          @click="collapseFieldList"
          style="width: 50px; height: 100%; flex-shrink: 0"
        >
          <q-icon
            name="expand_all"
            class="field-list-collapsed-icon rotate-90"
            data-test="panel-editor-field-list-collapsed-icon"
          />
          <div class="field-list-collapsed-title">
            {{ t("panel.fields") }}
          </div>
        </div>

        <!-- Main splitter for field list -->
        <q-splitter
          v-model="dashboardPanelData.layout.splitter"
          :limits="splitterLimits"
          :style="splitterStyle"
        >
          <!-- Field List (before slot) -->
          <template #before>
            <div :class="fieldListWrapperClass">
              <div
                v-if="dashboardPanelData.layout.showFieldList"
                class="col scroll card-container"
                :style="fieldListContainerStyle"
              >
                <div class="column" style="height: 100%">
                  <div class="col-auto q-pa-sm">
                    <span class="text-weight-bold">{{
                      t("panel.fields")
                    }}</span>
                  </div>
                  <div class="col" :style="fieldListInnerStyle">
                    <FieldList :editMode="editMode" />
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Splitter separator -->
          <template #separator>
            <div class="splitter-vertical splitter-enabled"></div>
            <q-btn
              color="primary"
              size="sm"
              :icon="
                dashboardPanelData.layout.showFieldList
                  ? 'chevron_left'
                  : 'chevron_right'
              "
              dense
              round
              :class="
                dashboardPanelData.layout.showFieldList
                  ? 'splitter-icon-collapse'
                  : 'splitter-icon-expand'
              "
              style="top: 14px; z-index: 100"
              @click.stop="collapseFieldList"
            />
          </template>

          <!-- Main content area (after slot) -->
          <template #after>
            <div :class="mainContentAreaClass" :style="afterSlotStyle">
              <div :class="afterSlotInnerClass" :style="afterSlotInnerStyle">
                <div
                  class="layout-panel-container col"
                  :style="layoutPanelContainerStyle"
                >
                  <!-- Query Builder -->
                  <DashboardQueryBuilder
                    v-if="resolvedConfig.showQueryBuilder"
                    :dashboardData="dashboardData"
                    @custom-chart-template-selected="
                      handleCustomChartTemplateSelected
                    "
                  />
                  <q-separator v-if="resolvedConfig.showQueryBuilder" />

                  <!-- Query Type Selector (build mode) - Auto/Custom toggle -->
                  <div
                    v-if="resolvedConfig.showQueryTypeSelector"
                    class="tw:flex tw:justify-end tw:items-center tw:px-3 tw:py-2 tw:bg-gray-50 dark:tw:bg-gray-800"
                  >
                    <QueryTypeSelector />
                  </div>

                  <!-- Variables Selector (dashboard mode only) -->
                  <VariablesValueSelector
                    v-if="
                      resolvedConfig.showVariablesSelector &&
                      (dateTimeForVariables ||
                        (dashboardPanelData.meta.dateTime &&
                          dashboardPanelData.meta.dateTime.start_time &&
                          dashboardPanelData.meta.dateTime.end_time))
                    "
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
                    class="tw:p-2"
                  >
                    <div
                      :style="{
                        borderColor: '#c3920d',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        backgroundColor:
                          store.state.theme === 'dark' ? '#2a1f03' : '#faf2da',
                        padding: '1%',
                        borderRadius: '5px',
                      }"
                    >
                      <div style="font-weight: 700">
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
                  <div class="tw:flex tw:justify-end tw:mr-2 tw:items-center">
                    <!-- Error warning -->
                    <q-btn
                      v-if="errorMessage"
                      :icon="outlinedWarning"
                      flat
                      size="xs"
                      padding="2px"
                      data-test="panel-editor-error-data-inline"
                      class="warning q-mr-xs"
                    >
                      <q-tooltip
                        anchor="bottom right"
                        self="top right"
                        max-width="220px"
                      >
                        <div style="white-space: pre-wrap">
                          {{ errorMessage }}
                        </div>
                      </q-tooltip>
                    </q-btn>

                    <!-- Max query range warning -->
                    <q-btn
                      v-if="maxQueryRangeWarning"
                      :icon="outlinedWarning"
                      flat
                      size="xs"
                      padding="2px"
                      data-test="panel-editor-max-duration-warning-inline"
                      class="warning q-mr-xs"
                    >
                      <q-tooltip
                        anchor="bottom right"
                        self="top right"
                        max-width="220px"
                      >
                        <div style="white-space: pre-wrap">
                          {{ maxQueryRangeWarning }}
                        </div>
                      </q-tooltip>
                    </q-btn>

                    <!-- Series limit warning -->
                    <q-btn
                      v-if="limitNumberOfSeriesWarningMessage"
                      :icon="symOutlinedDataInfoAlert"
                      flat
                      size="xs"
                      padding="2px"
                      data-test="panel-editor-series-limit-warning-inline"
                      class="warning q-mr-xs"
                    >
                      <q-tooltip
                        anchor="bottom right"
                        self="top right"
                        max-width="220px"
                      >
                        <div style="white-space: pre-wrap">
                          {{ limitNumberOfSeriesWarningMessage }}
                        </div>
                      </q-tooltip>
                    </q-btn>

                    <!-- Last refreshed time -->
                    <span
                      v-if="
                        resolvedConfig.showLastRefreshedTime && lastTriggeredAt
                      "
                      class="lastRefreshedAt"
                    >
                      <span class="lastRefreshedAtIcon">&#x1F551;</span>
                      <RelativeTime
                        :timestamp="lastTriggeredAt"
                        fullTimePrefix="Last Refreshed At: "
                      />
                    </span>

                    <!-- Add to Dashboard button (metrics/logs/build mode) -->
                    <q-btn
                      v-if="resolvedConfig.showAddToDashboardButton"
                      size="md"
                      class="no-border q-ml-sm"
                      no-caps
                      dense
                      color="primary"
                      style="padding: 2px 4px"
                      @click="emit('addToDashboard')"
                      :title="t('search.addToDashboard')"
                    >
                      {{ t("search.addToDashboard") }}
                    </q-btn>
                  </div>

                  <!-- Chart Area -->
                  <div
                    v-if="!resolvedConfig.hideChartPreview"
                    class="col tw:relative"
                  >
                    <div :class="chartAreaClass">
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
                        :showLegendsButton="true"
                        :searchType="searchType"
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
                      />
                    </div>
                  </div>

                  <!-- Errors Component -->
                  <DashboardErrorsComponent
                    :errors="errorData"
                    class="col-auto"
                    style="flex-shrink: 0"
                  />
                </div>

                <!-- Query Editor -->
                <div
                  v-if="resolvedConfig.showQueryEditor"
                  class="row column tw:h-[calc(100vh-180px)]"
                >
                  <DashboardQueryEditor />
                </div>
              </div>

              <q-separator vertical />

              <!-- Config Panel Sidebar -->
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
        </q-splitter>
      </div>

      <!-- HTML Editor Section -->
      <div
        v-if="dashboardPanelData.data.type === 'html'"
        class="col column tw:mr-[0.625rem]"
        :style="{ height: contentHeight, flex: 1 }"
      >
        <div class="card-container tw:h-full tw:flex tw:flex-col">
          <!-- Variables Selector for HTML (dashboard mode only) -->
          <VariablesValueSelector
            v-if="resolvedConfig.showVariablesSelector"
            :variablesConfig="dashboardData?.variables"
            :showDynamicFilters="dashboardData?.variables?.showDynamicFilters"
            :selectedTimeDate="dashboardPanelData.meta.dateTime"
            @variablesData="handleVariablesDataUpdated"
            :initialVariableValues="initialVariableValues"
            class="tw:flex-shrink-0 q-mb-sm"
            :showAddVariableButton="true"
            :showAllVisible="true"
            :tabId="tabId"
            :panelId="panelId"
          />
          <CustomHTMLEditor
            v-model="dashboardPanelData.data.htmlContent"
            style="flex: 1; min-height: 0"
            :initialVariableValues="liveVariablesData"
            :tabId="tabId"
            :panelId="panelId"
          />
          <DashboardErrorsComponent
            :errors="errorData"
            class="tw:flex-shrink-0"
          />
        </div>
      </div>

      <!-- Markdown Editor Section -->
      <div
        v-if="dashboardPanelData.data.type === 'markdown'"
        class="col column tw:mr-[0.625rem]"
        :style="{ height: contentHeight, flex: 1 }"
      >
        <div class="card-container tw:h-full tw:flex tw:flex-col">
          <!-- Variables Selector for Markdown (dashboard mode only) -->
          <VariablesValueSelector
            v-if="resolvedConfig.showVariablesSelector"
            :variablesConfig="dashboardData?.variables"
            :showDynamicFilters="dashboardData?.variables?.showDynamicFilters"
            :selectedTimeDate="dashboardPanelData.meta.dateTime"
            @variablesData="handleVariablesDataUpdated"
            :initialVariableValues="initialVariableValues"
            class="tw:flex-shrink-0 q-mb-sm"
            :showAddVariableButton="true"
            :showAllVisible="true"
            :tabId="tabId"
            :panelId="panelId"
          />
          <CustomMarkdownEditor
            v-model="dashboardPanelData.data.markdownContent"
            style="flex: 1; min-height: 0"
            :initialVariableValues="liveVariablesData"
            :tabId="tabId"
            :panelId="panelId"
          />
          <DashboardErrorsComponent
            :errors="errorData"
            class="tw:flex-shrink-0"
          />
        </div>
      </div>

      <!-- Custom Chart Editor Section -->
      <div
        v-if="dashboardPanelData.data.type === 'custom_chart'"
        class="col tw:mr-[0.625rem]"
        style="
          overflow-y: auto;
          display: flex;
          flex-direction: row;
          overflow-x: hidden;
        "
      >
        <!-- Collapsed field list bar for custom chart -->
        <div
          v-if="!dashboardPanelData.layout.showFieldList"
          class="field-list-sidebar-header-collapsed card-container"
          @click="collapseFieldList"
          style="width: 50px; height: 100%; flex-shrink: 0"
        >
          <q-icon
            name="expand_all"
            class="field-list-collapsed-icon rotate-90"
            data-test="panel-editor-field-list-collapsed-icon"
          />
          <div class="field-list-collapsed-title">
            {{ t("panel.fields") }}
          </div>
        </div>

        <!-- Custom chart splitter -->
        <q-splitter
          v-model="dashboardPanelData.layout.splitter"
          :limits="[0, 20]"
          :style="{
            width: dashboardPanelData.layout.showFieldList
              ? '100%'
              : 'calc(100% - 50px)',
            height: '100%',
          }"
        >
          <!-- Field List for custom chart -->
          <template #before>
            <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
              <div
                class="col scroll card-container"
                :style="{ height: contentHeight, overflowY: 'auto' }"
              >
                <div
                  v-if="dashboardPanelData.layout.showFieldList"
                  class="column"
                  style="height: 100%"
                >
                  <div class="col-auto q-pa-sm">
                    <span class="text-weight-bold">{{
                      t("panel.fields")
                    }}</span>
                  </div>
                  <div class="col" style="width: 100%">
                    <FieldList :editMode="editMode" />
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Custom chart splitter separator -->
          <template #separator>
            <div class="splitter-vertical splitter-enabled"></div>
            <q-btn
              color="primary"
              size="sm"
              :icon="
                dashboardPanelData.layout.showFieldList
                  ? 'chevron_left'
                  : 'chevron_right'
              "
              dense
              round
              style="top: 14px; z-index: 100"
              @click="collapseFieldList"
            />
          </template>

          <!-- Custom chart content area -->
          <template #after>
            <div
              class="row card-container"
              :style="{ height: contentHeight, overflowY: 'auto' }"
            >
              <div
                class="col scroll"
                style="height: 100%; display: flex; flex-direction: column"
              >
                <!-- Editor/Preview splitter -->
                <div style="height: 500px; flex-shrink: 0; overflow: hidden">
                  <q-splitter
                    class="query-editor-splitter"
                    v-model="splitterModel"
                    style="height: 100%"
                    @update:model-value="layoutSplitterUpdated"
                  >
                    <!-- Custom Chart Editor -->
                    <template #before>
                      <div
                        style="position: relative; width: 100%; height: 100%"
                      >
                        <CustomChartEditor
                          v-model="dashboardPanelData.data.customChartContent"
                          style="width: 100%; height: 100%"
                        />
                        <!-- Example Charts button (dashboard mode only) -->
                        <div
                          v-if="pageType === 'dashboard'"
                          style="
                            position: absolute;
                            bottom: 10px;
                            right: 10px;
                            z-index: 10;
                          "
                        >
                          <q-btn
                            unelevated
                            color="primary"
                            icon="bar_chart"
                            label="Example Charts"
                            @click="showCustomChartTypeSelector = true"
                            data-test="custom-chart-type-selector-btn"
                            no-caps
                            size="md"
                          />
                          <q-dialog v-model="showCustomChartTypeSelector">
                            <CustomChartTypeSelector
                              @select="handleChartTypeSelection"
                              @close="showCustomChartTypeSelector = false"
                            />
                          </q-dialog>
                        </div>
                      </div>
                    </template>

                    <!-- Splitter separator -->
                    <template #separator>
                      <div class="splitter-vertical splitter-enabled"></div>
                      <q-avatar
                        color="primary"
                        text-color="white"
                        size="20px"
                        icon="drag_indicator"
                        style="top: 10px; left: 3.5px"
                        data-test="panel-editor-custom-chart-drag-indicator"
                      />
                    </template>

                    <!-- Chart Preview -->
                    <template #after>
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
                        :showLegendsButton="true"
                        :searchType="searchType"
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
                      />
                    </template>
                  </q-splitter>
                </div>

                <!-- Errors Component -->
                <div class="col-auto" style="flex-shrink: 0">
                  <DashboardErrorsComponent
                    :errors="errorData"
                    class="col-auto"
                    style="flex-shrink: 0"
                  />
                </div>

                <!-- Query Editor for custom chart -->
                <div
                  v-if="resolvedConfig.showQueryEditor"
                  class="row column tw:h-[calc(100vh-180px)]"
                >
                  <DashboardQueryEditor />
                </div>
              </div>

              <q-separator vertical />

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
        </q-splitter>
      </div>
    </div>

    <!-- Legends Dialog -->
    <q-dialog v-model="showLegendsDialog">
      <ShowLegendsPopup
        :panelData="currentPanelData"
        @close="showLegendsDialog = false"
      />
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, provide, defineAsyncComponent, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { outlinedWarning } from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";

import type {
  PanelEditorProps,
  PanelEditorEmits,
  PanelEditorConfig,
  PanelEditorVariablesData,
} from "./types/panelEditor";
import { resolveConfig } from "./types/panelEditor";
import { usePanelEditor } from "./composables/usePanelEditor";
import useDashboardPanelData from "@/composables/useDashboardPanel";

// ============================================================================
// Component Imports
// ============================================================================

import ChartSelection from "@/components/dashboards/addPanel/ChartSelection.vue";
import FieldList from "@/components/dashboards/addPanel/FieldList.vue";
import PanelSidebar from "@/components/dashboards/addPanel/PanelSidebar.vue";
import DashboardQueryBuilder from "@/components/dashboards/addPanel/DashboardQueryBuilder.vue";
import DashboardErrorsComponent from "@/components/dashboards/addPanel/DashboardErrors.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";

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
const { dashboardPanelData, resetAggregationFunction, makeAutoSQLQuery } = useDashboardPanelData(
  pageKey.value,
);

// Provide page key for child components
provide("dashboardPanelDataPageKey", pageKey.value);

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
  searchRequestTraceIds,
  panelSchemaRendererRef,
  splitterModel,

  // Computed
  isOutDated,
  isLoading,
  currentPanelData,

  // Actions
  runQuery,
  handleChartApiError,
  handleLastTriggeredAtUpdate,
  handleLimitNumberOfSeriesWarningMessage,
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
});

// ============================================================================
// Custom Chart State
// ============================================================================

const showCustomChartTypeSelector = ref(false);

// ============================================================================
// Computed Properties
// ============================================================================

// Content height based on page type
const contentHeight = computed(() => {
  switch (props.pageType) {
    case "dashboard":
      return "calc(100vh - 110px)";
    case "metrics":
      return "calc(100vh - 106px)";
    case "logs":
      return "calc(100% - 36px)";
    case "build":
      return "calc(100vh - 60px)";
    default:
      return "calc(100vh - 110px)";
  }
});

// Chart area class based on page type
const chartAreaClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "tw:h-[calc(100%-36px)] tw:min-h-[140px]";
  }
  return "tw:h-[calc(100vh-500px)] tw:min-h-[140px] tw:mt-[40px]";
});

// Main content area class - logs needs flat background without card styling
const mainContentAreaClass = computed(() => {
  if (props.pageType === "logs") {
    return "row card-container";
  }
  return "row card-container";
});

// Row style - logs/build needs height: 100%, others need overflow-y: auto
const rowStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { height: "100%" };
  }
  return { overflowY: "auto" };
});

// Main content container class - logs/build uses vertical flex, others use horizontal
const mainContentContainerClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "col flex column";
  }
  return "col tw:mr-[0.625rem]";
});

// Main content container style
const mainContentContainerStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { width: "100%", height: "100%" };
  }
  return { display: "flex", flexDirection: "row", overflowX: "hidden" };
});

// Splitter limits - logs/build uses [0, 100], others use [0, 20]
const splitterLimits = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return [0, 100];
  }
  return [0, 20];
});

// Splitter style
const splitterStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { width: "100%", height: "100%" };
  }
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
      width: dashboardPanelData.layout.showFieldList
        ? "100%"
        : "calc(100% - 58px)",
    };
  }
  return {};
});

// After slot inner div class - logs/build uses "col", others use "col scroll"
const afterSlotInnerClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "col";
  }
  return "col scroll";
});

// After slot inner div style
const afterSlotInnerStyle = computed(() => {
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
  return {};
});

// Field list wrapper class - logs/build doesn't need padding-bottom
const fieldListWrapperClass = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return "tw:w-full tw:h-full";
  }
  return "tw:w-full tw:h-full tw:pb-[0.625rem]";
});

// Field list container style
const fieldListContainerStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { height: "100%", overflowY: "auto" };
  }
  return { height: contentHeight.value, overflowY: "auto" };
});

// Field list inner div style - logs/build needs height: 100%
const fieldListInnerStyle = computed(() => {
  if (props.pageType === "logs" || props.pageType === "build") {
    return { width: "100%", height: "100%" };
  }
  return { width: "100%" };
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
      return "ui";
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
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.stream,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.x,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.y,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.breakdown,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.z,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.filter,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.customQuery,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.latitude,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.longitude,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.weight,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.source,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.target,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.value,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.name,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields?.value_for_maps,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.config?.limit,
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.joins,
    dashboardPanelData.data.type,
  ],
  async () => {
    // Only auto-generate SQL if in builder mode (customQuery = false)
    if (!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.customQuery) {
      const result = await makeAutoSQLQuery();

      // Only emit if makeAutoSQLQuery actually ran and generated a query
      // Don't emit when it returns early (undefined) due to missing stream fields
      // This prevents clearing the query on page load before stream fields are loaded
      if (result !== undefined) {
        emit("queryGenerated", result);
      }
    }
  },
  { deep: true }
);

// Watch for customQuery mode changes to notify parent
watch(
  () => dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.customQuery,
  (isCustomMode) => {
    emit("customQueryModeChanged", isCustomMode ?? false);
  },
  { immediate: true }
);

// Watch for searchRequestTraceIds changes to notify parent (for cancel query functionality)
watch(
  searchRequestTraceIds,
  (newTraceIds) => {
    emit("searchRequestTraceIdsUpdated", newTraceIds);
  },
  { immediate: true }
);

// ============================================================================
// Expose
// ============================================================================

defineExpose({
  // Actions
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

<style lang="scss" scoped>
.panel-editor {
  height: 100%;
  width: 100%;
}

.layout-panel-container {
  display: flex;
  flex-direction: column;
}

.splitter {
  height: 4px;
  width: 100%;
}

.splitter-vertical {
  width: 4px;
  height: 100%;
}

.splitter-enabled {
  background-color: #ffffff00;
  transition: 0.3s;
  transition-delay: 0.2s;
}

.splitter-enabled:hover {
  background-color: orange;
}

:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}

.field-list-sidebar-header-collapsed {
  cursor: pointer;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}

.field-list-collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}

.warning {
  color: var(--q-warning);
}

.lastRefreshedAt {
  font-size: 12px;
  color: var(--q-secondary);
}

.lastRefreshedAtIcon {
  margin-right: 4px;
}

.splitter-icon-expand {
  position: absolute;
  left: -12px;
}

.splitter-icon-collapse {
  position: absolute;
  left: -12px;
}
</style>
