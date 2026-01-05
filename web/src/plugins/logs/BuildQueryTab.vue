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
      <!-- LEFT: Chart Types -->
      <div class="tw:pl-[0.625rem]" style="overflow-y: auto">
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
              'pie',
              'donut',
              'table',
              'metric',
            ]"
            :selectedChartType="dashboardPanelData.data.type"
            @update:selected-chart-type="handleChartTypeChange"
          />
        </div>
      </div>
      <q-separator vertical />

      <!-- MIDDLE & RIGHT: Fields + Chart + Config -->
      <div class="col flex column" style="width: 100%; height: 100%">
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
              <div
                class="col scroll card-container"
                style="height: 100%; overflow-y: auto"
              >
                <div class="column" style="height: 100%">
                  <div class="col-auto q-pa-sm">
                    <span class="text-weight-bold">{{ t("panel.fields") }}</span>
                  </div>
                  <div class="col" style="width: 100%; height: 100%">
                    <FieldList :editMode="editMode" :hideAllFieldsSelection="false" />
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
              :class="
                dashboardPanelData.layout.showFieldList
                  ? 'splitter-icon-collapse'
                  : 'splitter-icon-expand'
              "
              dense
              round
              style="top: 14px; z-index: 100"
              @click.stop="collapseFieldList"
            />
          </template>
          <template #after>
            <div
              class="row card-container"
              style="height: 100%; width: 100%"
            >
              <div class="col" style="height: 100%; overflow: hidden">
                <div class="layout-panel-container column" style="height: 100%; display: flex; flex-direction: column">
                  <!-- Query Builder (drag-and-drop fields) -->
                  <div class="col-auto">
                    <DashboardQueryBuilder :dashboardData="{}" />
                  </div>
                  <q-separator />

                  <div
                    v-if="isOutDated"
                    class="col-auto"
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
                      Chart configuration has been updated, but the chart was not
                      updated automatically. Click on the "Run Query" button to run
                      the query again
                    </div>
                  </div>

                  <div
                    class="col"
                    style="position: relative; min-height: 0; flex: 1; display: flex; flex-direction: column"
                  >
                    <div
                      style="
                        flex: 1;
                        min-height: 0;
                        width: 100%;
                        margin-top: 36px;
                        overflow: auto;
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
                        :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                        :allowAlertCreation="false"
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
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, provide, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

// Import components (same as VisualizeLogsQuery.vue)
import ChartSelection from "@/components/dashboards/addPanel/ChartSelection.vue";
import FieldList from "@/components/dashboards/addPanel/FieldList.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import PanelSidebar from "@/components/dashboards/addPanel/PanelSidebar.vue";
import DashboardErrorsComponent from "@/components/dashboards/addPanel/DashboardErrors.vue";
import DashboardQueryBuilder from "@/components/dashboards/addPanel/DashboardQueryBuilder.vue";

// Import composable
import useDashboardPanelData from "@/composables/useDashboardPanel";

// Import utilities
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";

// Import icons
import { outlinedWarning } from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";

export default defineComponent({
  name: "BuildQueryTab",
  components: {
    ChartSelection,
    FieldList,
    PanelSchemaRenderer,
    ConfigPanel,
    PanelSidebar,
    DashboardErrorsComponent,
    DashboardQueryBuilder,
  },
  props: {
    errorData: {
      type: Object,
      default: () => ({ errors: [] }),
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["query-changed", "visualization-saved", "error", "run-query"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();

    // Inject the registration function from parent (Index.vue)
    const registerBuildQueryTabRunQuery = inject("registerBuildQueryTabRunQuery", null);

    // Inject searchObj from logs page (Index.vue) to access current datetime
    const logsPageSearchObj: any = inject("logsPageSearchObj", null);

    // Provide the page key for child components (FieldList, ConfigPanel, etc.)
    const dashboardPanelDataPageKey = "build-logs";
    provide("dashboardPanelDataPageKey", dashboardPanelDataPageKey);

    // Build tab always creates NEW panels (not editing existing panels)
    const editMode = false;

    // Use dashboard panel composable with "build-logs" page key
    const {
      dashboardPanelData,
      resetAggregationFunction,
      makeAutoSQLQuery,
    }: any = useDashboardPanelData(dashboardPanelDataPageKey);

    // Refs for UI state
    const isOutDated = ref(false);
    const errorMessage = ref("");
    const maxQueryRangeWarning = ref("");
    const limitNumberOfSeriesWarningMessage = ref("");
    const showLegendsDialog = ref(false);
    const seriesData = ref(null);
    const panelSchemaRendererRef = ref(null);
    const searchResponse = ref(null);

    // Create local chartData ref (matching VisualizeLogsQuery pattern)
    // This creates a reactive copy that re-renders the chart when updated
    const chartData = ref(JSON.parse(JSON.stringify(dashboardPanelData.data)));

    // Initialize from logs context
    const initializeFromLogsContext = () => {
      // IMPORTANT: Build tab only supports auto SQL (visual query builder)
      // Not custom SQL, not PromQL - only auto-generated SQL
      dashboardPanelData.data.queries[0].customQuery = false;

      // Set query type to SQL
      dashboardPanelData.data.queryType = "sql";

      // Set initial time range from searchObj
      if (logsPageSearchObj?.data?.datetime) {
        const dateTime =
          logsPageSearchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(
                logsPageSearchObj.data.datetime.relativeTimePeriod,
              )
            : cloneDeep(logsPageSearchObj.data.datetime);

        dashboardPanelData.meta.dateTime = {
          start_time: new Date(dateTime.startTime),
          end_time: new Date(dateTime.endTime),
        };
      }

      // Generate initial SQL (auto SQL mode)
      makeAutoSQLQuery();
    };

    // Handle chart type change
    const handleChartTypeChange = (type: string) => {
      dashboardPanelData.data.type = type;
      resetAggregationFunction();
    };

    // Collapse field list
    const collapseFieldList = () => {
      dashboardPanelData.layout.showFieldList =
        !dashboardPanelData.layout.showFieldList;
    };

    // Layout splitter updated
    const layoutSplitterUpdated = (value: number) => {
      dashboardPanelData.layout.splitter = value;
    };

    // Add to dashboard
    const addToDashboard = () => {
      emit("visualization-saved", dashboardPanelData);
      $q.notify({
        type: "positive",
        message: t("search.addToDashboard") + " - Feature Coming Soon",
      });
    };

    // Meta data value
    const metaDataValue = (data: any) => {
      // Handle metadata
    };

    // On result metadata update
    const onResultMetadataUpdate = (data: any) => {
      // Handle result metadata
    };

    // Update VRL function field list
    const updateVrlFunctionFieldList = (data: any) => {
      // Update field list
    };

    // Handle limit number of series warning
    const handleLimitNumberOfSeriesWarningMessage = (message: string) => {
      limitNumberOfSeriesWarningMessage.value = message;
    };

    // Handle chart API error
    const handleChartApiError = (error: any) => {
      errorMessage.value = error.message || "An error occurred";
      emit("error", error);
    };

    // Series data update
    const seriesDataUpdate = (data: any) => {
      seriesData.value = data;
    };

    // Run query function (same logic as AddPanel)
    const runQuery = (withoutCache = false) => {
      try {
        // Update the datetime from logs page searchObj (CURRENT datetime when Run Query is clicked)
        // Same pattern as Index.vue handleRunQueryFn (lines 2046-2056)
        if (logsPageSearchObj?.data?.datetime) {
          const dateTime =
            logsPageSearchObj.data.datetime.type === "relative"
              ? getConsumableRelativeTime(
                  logsPageSearchObj.data.datetime.relativeTimePeriod,
                )
              : cloneDeep(logsPageSearchObj.data.datetime);

          dashboardPanelData.meta.dateTime = {
            start_time: new Date(dateTime.startTime),
            end_time: new Date(dateTime.endTime),
          };
        }

        // Copy the data object excluding reactivity (triggers chart re-render and API call)
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      } catch (err) {
        console.error("[BuildQueryTab] Error running query:", err);
        emit("error", err);
      }
    };

    // // Watch for query changes and update chartData
    // watch(
    //   () => dashboardPanelData.data.queries[0],
    //   () => {
    //     const query = dashboardPanelData.data.queries[0]?.query || "";
    //     emit("query-changed", query);

    //     // Update chartData to trigger chart re-render
    //     chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
    //   },
    //   { deep: true }
    // );

    // Watch for chart type changes
    watch(
      () => dashboardPanelData.data.type,
      () => {
        // Update chartData to trigger chart re-render
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      }
    );

    // Watch for field changes (x, y, breakdown, filter)
    // When fields change, regenerate SQL (auto SQL mode)
    watch(
      () => [
        dashboardPanelData.data.queries[0]?.fields?.x,
        dashboardPanelData.data.queries[0]?.fields?.y,
        dashboardPanelData.data.queries[0]?.fields?.breakdown,
        dashboardPanelData.data.queries[0]?.fields?.filter,
      ],
      () => {
        // Only generate auto SQL if we're in auto query mode (not custom SQL)
        if (!dashboardPanelData.data.queries[0].customQuery) {
          makeAutoSQLQuery();
        }


        // Update chartData to trigger chart re-render
        // chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      },
      { deep: true }
    );

    onMounted(() => {
      // Register the runQuery function with parent (Index.vue)
      if (registerBuildQueryTabRunQuery && typeof registerBuildQueryTabRunQuery === 'function') {
        registerBuildQueryTabRunQuery(runQuery);
      }

      initializeFromLogsContext();
      // Initial chartData sync after initialization
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
    });

    return {
      t,
      store,
      dashboardPanelData,
      editMode,
      handleChartTypeChange,
      collapseFieldList,
      layoutSplitterUpdated,
      addToDashboard,
      metaDataValue,
      onResultMetadataUpdate,
      updateVrlFunctionFieldList,
      handleLimitNumberOfSeriesWarningMessage,
      handleChartApiError,
      seriesDataUpdate,
      runQuery,
      chartData,
      isOutDated,
      errorMessage,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      showLegendsDialog,
      seriesData,
      panelSchemaRendererRef,
      searchResponse,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      errorData: props.errorData,
      shouldRefreshWithoutCache: props.shouldRefreshWithoutCache,
    };
  },
});
</script>

<style lang="scss" scoped>
// Styles from VisualizeLogsQuery
.field-list-sidebar-header-collapsed {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--q-card-bg);
}

.field-list-collapsed-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 1px;
}
</style>
