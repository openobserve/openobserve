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

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="height: 100%; width: 100%">
    <div class="row" style="height: 100%">
      <div class="tw:pl-[0.625rem]" style="overflow-y: auto;">
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
          :allowedchartstype="[
            'area',
            'bar',
            'h-bar',
            'line',
            'scatter',
            'table',
          ]"
          :selectedChartType="dashboardPanelData.data.type"
          @update:selected-chart-type="handleChartTypeChange"
        />
      </div>
      </div>
      <q-separator vertical />
      <!-- for query related chart only -->
      <div
        v-if="
          !['html', 'markdown', '6custom_chart'].includes(
            dashboardPanelData.data.type,
          )
        "
        class="col flex column"
        style="width: 100%; height: 100%"
      >
        <!-- collapse field list bar -->
        <div
          v-if="!dashboardPanelData.layout.showFieldList"
          class="field-list-sidebar-header-collapsed card-container"
          @click="collapseFieldList"
          style="width: 50px; height: 100%"
        >
          <q-icon
            name="expand_all"
            class="field-list-collapsed-icon rotate-90"
            data-test="dashboard-field-list-collapsed-icon"
          />
          <div class="field-list-collapsed-title">{{ t("panel.fields") }}</div>
        </div>
        <q-splitter
          v-model="dashboardPanelData.layout.splitter"
          @update:model-value="layoutSplitterUpdated"
          :limits="[0, 100]"
          style="width: 100%; height: 100%"
        >
          <template #before>
            <div class="tw:w-full tw:h-full">
            <div class="col scroll card-container" style="height: 100%; overflow-y: auto">
              <div class="column" style="height: 100%">
                <div class="col-auto q-pa-sm">
                  <span class="text-weight-bold">{{ t("panel.fields") }}</span>
                </div>
                <div class="col" style="width: 100%; height: 100%">
                  <FieldList :editMode="true" :hideAllFieldsSelection="true" />
                </div>
              </div>
            </div>
            </div>
          </template>
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
              :class="dashboardPanelData.layout.showFieldList ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
              dense
              round
              style="top: 14px; z-index: 100"
              @click.stop="collapseFieldList"
            />
          </template>
          <template #after>
            <div
              class="row card-container"
              :style="{
                height: '100%',
                width: dashboardPanelData.layout.showFieldList
                  ? '100%'
                  : 'calc(100% - 58px)',
              }"
            >
              <div class="col" style="height: 100%">
                <div class="layout-panel-container col" style="height: 100%">
                  <!-- <DashboardQueryBuilder :dashboardData="{}" /> -->
                  <q-separator />

                  <div
                    v-if="isOutDated"
                    :style="{
                      borderColor: '#c3920d',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      backgroundColor:
                        store.state.theme == 'dark' ? '#2a1f03' : '#faf2da',
                      padding: '1%',
                      margin: '1%',
                      borderRadius: '5px',
                    }"
                  >
                    <div style="font-weight: 700">
                      Your chart is not up to date
                    </div>
                    <div>
                      Chart configuration has been updated, but the chart was
                      not updated automatically. Click on the "Run Query" button
                      to run the query again
                    </div>
                  </div>

                  <div
                    class="col"
                    style="position: relative; height: 100%; width: 100%"
                  >
                    <div
                      style="
                        flex: 1;
                        min-height: calc(100% - 36px);
                        height: calc(100% - 36px);
                        width: 100%;
                        margin-top: 36px;
                      "
                    >
                      <PanelSchemaRenderer
                        @metadata-update="metaDataValue"
                        @result-metadata-update="onResultMetadataUpdate"
                        :key="dashboardPanelData.data.type"
                        :panelSchema="chartData"
                        :selectedTimeObj="dashboardPanelData.meta.dateTime"
                        :variablesData="{}"
                        :showLegendsButton="true"
                        @updated:vrl-function-field-list="
                          updateVrlFunctionFieldList
                        "
                        @limit-number-of-series-warning-message-update="
                          handleLimitNumberOfSeriesWarningMessage
                        "
                        :width="6"
                        @error="handleChartApiError"
                        :searchResponse="searchResponse"
                        :is_ui_histogram="is_ui_histogram"
                        :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                        :allowAlertCreation="true"
                        @series-data-update="seriesDataUpdate"
                        @show-legends="showLegendsDialog = true"
                        ref="panelSchemaRendererRef"
                      />
                    </div>
                    <div
                      class="flex justify-end q-pr-lg q-mb-md q-pt-xs"
                      style="position: absolute; top: 0px; right: -13px"
                    >
                      <!-- Error/Warning tooltips -->
                      <q-btn
                        v-if="errorMessage"
                        :icon="outlinedWarning"
                        flat
                        size="xs"
                        padding="2px"
                        data-test="dashboard-panel-error-data"
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
                      <q-btn
                        v-if="maxQueryRangeWarning"
                        :icon="outlinedWarning"
                        flat
                        size="xs"
                        padding="2px"
                        data-test="dashboard-panel-max-duration-warning"
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
                      <q-btn
                        v-if="limitNumberOfSeriesWarningMessage"
                        :icon="symOutlinedDataInfoAlert"
                        flat
                        size="xs"
                        padding="2px"
                        data-test="dashboard-panel-limit-number-of-series-warning"
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
                      <q-btn
                        size="md"
                        class="no-border"
                        no-caps
                        dense
                        style="padding: 2px 4px; z-index: 1"
                        color="primary"
                        @click="addToDashboard"
                        :title="t('search.addToDashboard')"
                        :disabled="errorData?.errors?.length > 0"
                        >{{ t("search.addToDashboard") }}</q-btn
                      >
                    </div>
                  </div>
                  <DashboardErrorsComponent
                    :errors="errorData"
                    class="col-auto"
                    style="flex-shrink: 0"
                  />
                </div>
              </div>
              <q-separator vertical />
              <div class="col-auto" style="height: 100%">
                <PanelSidebar
                  :title="t('dashboard.configLabel')"
                  v-model="dashboardPanelData.layout.isConfigPanelOpen"
                >
                  <ConfigPanel
                    :dashboardPanelData="dashboardPanelData"
                    :panelData="seriesData"
                  />
                </PanelSidebar>
              </div>
            </div>
          </template>
        </q-splitter>
      </div>
      <div
        v-if="dashboardPanelData.data.type == 'html'"
        class="col column tw:mr-[0.625rem]"
        style="height: 100%; flex: 1"
      >
        <div class="card-container tw:h-full tw:flex tw:flex-col">
          <CustomHTMLEditor
            v-model="dashboardPanelData.data.htmlContent"
            style="flex: 1; min-height: 0"
          />
          <DashboardErrorsComponent :errors="errorData" class="tw:flex-shrink-0" />
        </div>
      </div>
      <div
        v-if="dashboardPanelData.data.type == 'markdown'"
        class="col column tw:mr-[0.625rem]"
        style="height: 100%; flex: 1"
      >
        <div class="card-container tw:h-full tw:flex tw:flex-col">
          <CustomMarkdownEditor
            v-model="dashboardPanelData.data.markdownContent"
            style="flex: 1; min-height: 0"
          />
          <DashboardErrorsComponent :errors="errorData" class="tw:flex-shrink-0" />
        </div>
      </div>

      <div
        v-if="dashboardPanelData.data.type == 'custom_chart'"
        class="col column"
        style="height: 100%"
      >
        <!-- collapse field list bar -->
        <div
          v-if="!dashboardPanelData.layout.showFieldList"
          class="field-list-sidebar-header-collapsed"
          @click="collapseFieldList"
          style="width: 50px; height: 100%"
        >
          <q-icon
            name="expand_all"
            class="field-list-collapsed-icon rotate-90"
            data-test="dashboard-field-list-collapsed-icon"
          />
          <div class="field-list-collapsed-title">{{ t("panel.fields") }}</div>
        </div>
        <q-splitter
          v-model="dashboardPanelData.layout.splitter"
          @update:model-value="layoutSplitterUpdated"
          :limits="[0, 100]"
          style="width: 100%; height: 100%"
        >
          <template #before>
            <div class="col scroll" style="height: 100%; overflow-y: auto">
              <div
                v-if="dashboardPanelData.layout.showFieldList"
                class="column"
                style="height: 100%"
              >
                <div class="col-auto q-pa-sm">
                  <span class="text-weight-bold">{{ t("panel.fields") }}</span>
                </div>
                <div class="col" style="width: 100%">
                  <!-- <GetFields :editMode="editMode" /> -->
                  <FieldList :editMode="true" />
                </div>
              </div>
            </div>
          </template>
          <template #separator>
            <div class="splitter-vertical splitter-enabled"></div>
            <q-btn
              color="primary"
              size="12px"
              :icon="
                dashboardPanelData.layout.showFieldList
                  ? 'chevron_left'
                  : 'chevron_right'
              "
              :class="dashboardPanelData.layout.showFieldList ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
              dense
              round
              style="top: 14px; z-index: 100"
              :style="{
                right: dashboardPanelData.layout.showFieldList
                  ? '-20px'
                  : '-0px',
                left: dashboardPanelData.layout.showFieldList ? '5px' : '12px',
              }"
              @click="collapseFieldList"
            />
          </template>
          <template #after>
            <div class="row" style="height: 100%; overflow-y: auto">
              <div class="col" style="height: 100%">
                <div class="layout-panel-container col" style="height: 100%">
                  <q-splitter
                    class="query-editor-splitter"
                    v-model="splitterModel"
                    style="height: 100%"
                    @update:model-value="layoutSplitterUpdated"
                  >
                    <template #before>
                      <CustomChartEditor
                        v-model="dashboardPanelData.data.customChartContent"
                        style="width: 100%; height: 100%"
                      />
                    </template>
                    <template #separator>
                      <div class="splitter-vertical splitter-enabled"></div>
                      <q-avatar
                        color="primary"
                        text-color="white"
                        size="20px"
                        icon="drag_indicator"
                        style="top: 10px; left: 3.5px"
                        data-test="dashboard-markdown-editor-drag-indicator"
                      />
                    </template>
                    <template #after>
                      <PanelSchemaRenderer
                        @metadata-update="metaDataValue"
                        @result-metadata-update="onResultMetadataUpdate"
                        :panelSchema="chartData"
                        :selectedTimeObj="dashboardPanelData.meta.dateTime"
                        :variablesData="{}"
                        :showLegendsButton="true"
                        @updated:vrl-function-field-list="
                          updateVrlFunctionFieldList
                        "
                        :width="6"
                        @error="handleChartApiError"
                        :searchResponse="searchResponse"
                        :is_ui_histogram="is_ui_histogram"
                        :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                        :allowAlertCreation="true"
                        @series-data-update="seriesDataUpdate"
                        @show-legends="showLegendsDialog = true"
                      />
                    </template>
                  </q-splitter>
                  <DashboardErrorsComponent
                    :errors="errorData"
                    class="col-auto"
                    style="flex-shrink: 0"
                  />
                </div>
              </div>
              <q-separator vertical />
              <div class="col-auto" style="height: 100%">
                <PanelSidebar
                  :title="t('dashboard.configLabel')"
                  v-model="dashboardPanelData.layout.isConfigPanelOpen"
                >
                  <ConfigPanel
                    :dashboardPanelData="dashboardPanelData"
                    :panelData="seriesData"
                  />
                </PanelSidebar>
              </div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>
    <q-dialog v-model="showLegendsDialog">
      <ShowLegendsPopup
        :panelData="currentPanelData"
        @close="showLegendsDialog = false"
      />
    </q-dialog>
    <q-dialog
      v-model="showAddToDashboardDialog"
      position="right"
      full-height
      maximized
    >
      <add-to-dashboard
        @save="addPanelToDashboard"
        :dashboardPanelData="dashboardPanelData"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, defineAsyncComponent } from "vue";
import PanelSidebar from "@/components/dashboards/addPanel/PanelSidebar.vue";
import ChartSelection from "@/components/dashboards/addPanel/ChartSelection.vue";
import FieldList from "@/components/dashboards/addPanel/FieldList.vue";

import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import DashboardQueryBuilder from "@/components/dashboards/addPanel/DashboardQueryBuilder.vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import DashboardErrorsComponent from "@/components/dashboards/addPanel/DashboardErrors.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { provide } from "vue";
import { toRefs } from "vue";
import { inject } from "vue";
import { computed } from "vue";
import { isEqual } from "lodash-es";
import { onActivated } from "vue";
import useNotifications from "@/composables/useNotifications";
import CustomChartEditor from "@/components/dashboards/addPanel/CustomChartEditor.vue";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { isSimpleSelectAllQuery } from "@/utils/query/sqlUtils";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";
import { processQueryMetadataErrors } from "@/utils/zincutils";

const ConfigPanel = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ConfigPanel.vue");
});

const CustomHTMLEditor = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/CustomHTMLEditor.vue");
});

const CustomMarkdownEditor = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/CustomMarkdownEditor.vue");
});

const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
});

const ShowLegendsPopup = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
});

export default defineComponent({
  name: "VisualizeLogsQuery",
  props: {
    visualizeChartData: {
      type: Object,
      required: true,
    },
    errorData: {
      type: Object,
      required: true,
    },
    searchResponse: {
      type: Object,
      required: false,
    },
    is_ui_histogram: {
      type: Boolean,
      required: false,
      default: false,
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  components: {
    ChartSelection,
    FieldList,
    DashboardQueryBuilder,
    DashboardErrorsComponent,
    PanelSidebar,
    ConfigPanel,
    PanelSchemaRenderer,
    CustomHTMLEditor,
    CustomMarkdownEditor,
    AddToDashboard,
    CustomChartEditor,
    ShowLegendsPopup,
  },
  emits: ["handleChartApiError"],
  setup(props, { emit }) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "logs",
    );
    const { t } = useI18n();
    const store = useStore();
    const { dashboardPanelData, resetAggregationFunction, validatePanel } =
      useDashboardPanelData(dashboardPanelDataPageKey);
    const metaData = ref(null);
    const resultMetaData = ref(null);
    const seriesData = ref([] as any[]);
    const showLegendsDialog = ref(false);
    const panelSchemaRendererRef: any = ref(null);
    const seriesDataUpdate = (data: any) => {
      seriesData.value = data;
    };
    const splitterModel = ref(50);

    // Warning messages
    const maxQueryRangeWarning = ref("");
    const limitNumberOfSeriesWarningMessage = ref("");
    const errorMessage = ref("");

    const metaDataValue = (metadata: any) => {
      metaData.value = metadata;
    };
    const { showErrorNotification } = useNotifications();


    const { searchObj } = searchState();
    const { buildSearch } = useSearchStream();

    const { visualizeChartData, is_ui_histogram, shouldRefreshWithoutCache }: any = toRefs(props);
    const chartData = ref(visualizeChartData.value);

    const showAddToDashboardDialog = ref(false);

    watch(
      () => visualizeChartData.value,
      async () => {
        // await nextTick();
        chartData.value = JSON.parse(JSON.stringify(visualizeChartData.value));
      },
      { deep: true },
    );

    const isOutDated = computed(() => {
      const configChanged = !isEqual(chartData.value, dashboardPanelData.data);

      // skip outdate check if doesnt require to call api
      let configNeedsApiCall = false;
      if (configChanged) {
        configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          dashboardPanelData.data,
        );
      }
      return configNeedsApiCall;
    });

    watch(isOutDated, () => {
      window.dispatchEvent(new Event("resize"));
    });

    // resize the chart when config panel is opened and closed
    watch(
      () => dashboardPanelData.layout.isConfigPanelOpen,
      () => {
        window.dispatchEvent(new Event("resize"));
      },
    );

    // Handle chart type change with validation
    const handleChartTypeChange = (newType: string) => {
      // Get the actual logs page query, handling SQL mode
      let logsPageQuery = "";

      // Handle sql mode - same as in Index.vue
      if (!searchObj.meta.sqlMode) {
        const queryBuild = buildSearch();
        logsPageQuery = queryBuild?.query?.sql ?? "";
      } else {
        logsPageQuery = searchObj.data.query;
      }

      // Check if query is SELECT * and trying to switch chart type
      if (
        store.state.zoConfig.quick_mode_enabled === true &&
        isSimpleSelectAllQuery(logsPageQuery)
      ) {
        showErrorNotification(
          "Select * query is not supported for visualization.",
        );
        // Prevent the change by not updating the type
        return;
      }

      // If validation passes, proceed with the change
      dashboardPanelData.data.type = newType;
      resetAggregationFunction();
    };

    // resize the chart when query editor is opened and closed
    watch(
      () => dashboardPanelData.layout.showQueryBar,
      (newValue) => {
        if (!newValue) {
          dashboardPanelData.layout.querySplitter = 41;
        } else {
          if (expandedSplitterHeight.value !== null) {
            dashboardPanelData.layout.querySplitter =
              expandedSplitterHeight.value;
          }
        }
      },
    );

    const layoutSplitterUpdated = () => {
      dashboardPanelData.layout.showFieldList =
        dashboardPanelData.layout.splitter > 0;
      // emit resize event
      // this will rerender/call resize method of already rendered chart to resize
      window.dispatchEvent(new Event("resize"));
    };

    const expandedSplitterHeight = ref(null);

    const handleChartApiError = (errorMsg: any) => {
      if (typeof errorMsg === "string") {
        errorMessage.value = errorMsg;
        const errorList = props.errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg);
      } else if (errorMsg?.message) {
        errorMessage.value = errorMsg.message ?? "";
        const errorList = props.errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg.message);
        props.errorData.value = errorMsg?.message ?? "";
      } else {
        errorMessage.value = "";
      }

      emit("handleChartApiError", errorMsg);
    };

    // Handle limit number of series warning from PanelSchemaRenderer
    const handleLimitNumberOfSeriesWarningMessage = (message: string) => {
      limitNumberOfSeriesWarningMessage.value = message;
    };

    const hoveredSeriesState = ref({
      hoveredSeriesName: "",
      panelId: -1,
      dataIndex: -1,
      seriesIndex: -1,
      hoveredTime: null,
      setHoveredSeriesName: function (name: string) {
        hoveredSeriesState.value.hoveredSeriesName = name ?? "";
      },
      setIndex: function (
        dataIndex: number,
        seriesIndex: number,
        panelId: any,
        hoveredTime?: any,
      ) {
        hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
        hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
        hoveredSeriesState.value.panelId = panelId ?? -1;
        hoveredSeriesState.value.hoveredTime = hoveredTime ?? null;
      },
    });

    // used provide and inject to share data between components
    // it is currently used in panelschemarendered, chartrenderer, convertpromqldata(via panelschemarenderer), and convertsqldata
    provide("hoveredSeriesState", hoveredSeriesState);

    const addToDashboard = () => {
      if (
        resultMetaData.value?.[0]?.[0]?.converted_histogram_query &&
        is_ui_histogram.value === true
      ) {
        dashboardPanelData.data.queries[0].query =
          resultMetaData.value?.[0]?.[0]?.converted_histogram_query;
      } else if (
        // Backward compatibility - check if it's old format
        resultMetaData.value?.[0]?.converted_histogram_query &&
        is_ui_histogram.value === true &&
        !Array.isArray(resultMetaData.value?.[0])
      ) {
        dashboardPanelData.data.queries[0].query =
          resultMetaData.value?.[0]?.converted_histogram_query;
      }

      const errors: any = [];
      // will push errors in errors array
      validatePanel(errors, true);

      if (errors.length) {
        // set errors into errorData
        props.errorData.errors = errors;
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
        return;
      } else {
        showAddToDashboardDialog.value = true;
      }
    };

    const addPanelToDashboard = () => {
      showAddToDashboardDialog.value = false;
    };

    onActivated(() => {
      dashboardPanelData.layout.querySplitter = 20;

      // keep field list closed for visualization
      dashboardPanelData.layout.showFieldList = false;
      dashboardPanelData.layout.splitter = 0;
    });

    const updateVrlFunctionFieldList = (fieldList: any) => {
      // extract all panelSchema alias
      const aliasList: any = [];

      // currently we only support auto sql for visualization
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery === false
      ) {
        // remove panelschema fields from field list

        // add x axis alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.x?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add breakdown alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.breakdown?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add y axis alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.y?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add z axis alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.z?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add latitude alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.latitude?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.latitude?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.latitude.alias,
          );
        }

        // add longitude alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.longitude?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.longitude?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.longitude.alias,
          );
        }

        // add weight alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.weight?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.weight?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.weight.alias,
          );
        }

        // add source alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.source?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.source?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.source.alias,
          );
        }

        // add target alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.target?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.target?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.target.alias,
          );
        }

        // add source alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.value?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.value?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.value.alias,
          );
        }
      }

      // remove custom query fields from field list
      dashboardPanelData.meta.stream.customQueryFields.forEach((it: any) => {
        aliasList.push(it.name);
      });

      // rest will be vrl function fields
      fieldList = fieldList
        .filter((field: any) => aliasList.indexOf(field) < 0)
        .map((field: any) => ({ name: field, type: "Utf8" }));

      dashboardPanelData.meta.stream.vrlFunctionFieldList = fieldList;
    };
    const collapseFieldList = () => {
      if (dashboardPanelData.layout.showFieldList) {
        dashboardPanelData.layout.showFieldList = false;
        dashboardPanelData.layout.splitter = 0;
      } else {
        dashboardPanelData.layout.showFieldList = true;
        dashboardPanelData.layout.splitter = 20;
      }
      // emit resize event
      // this will rerender/call resize method of already rendered chart to resize
      window.dispatchEvent(new Event("resize"));
    };

    const onResultMetadataUpdate = (resultMetaDataParams: any) => {
      resultMetaData.value = resultMetaDataParams ?? null;

      maxQueryRangeWarning.value = processQueryMetadataErrors(
        resultMetaData.value,
        store.state.timezone,
      );
    };

    const currentPanelData = computed(() => {
      const rendererData = panelSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
    });

    return {
      t,
      layoutSplitterUpdated,
      expandedSplitterHeight,
      dashboardPanelData,
      handleChartApiError,
      resetAggregationFunction,
      store,
      metaDataValue,
      metaData,
      chartData,
      seriesData,
      seriesDataUpdate,
      showAddToDashboardDialog,
      addPanelToDashboard,
      addToDashboard,
      isOutDated,
      updateVrlFunctionFieldList,
      splitterModel,
      collapseFieldList,
      is_ui_histogram,
      shouldRefreshWithoutCache,
      onResultMetadataUpdate,
      hoveredSeriesState,
      resultMetaData,
      isSimpleSelectAllQuery,
      handleChartTypeChange,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      errorMessage,
      handleLimitNumberOfSeriesWarningMessage,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      outlinedRunningWithErrors,
      showLegendsDialog,
      currentPanelData,
      panelSchemaRendererRef,
    };
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/logs/visualizelogs-query.scss";
</style>
