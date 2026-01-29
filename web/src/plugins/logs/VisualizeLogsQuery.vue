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
  <VisualizationLayout
    :containerStyle="{ overflowY: 'auto' }"
    containerClass="scroll"
    :dashboardPanelData="dashboardPanelData"
    :chartData="chartData"
    :seriesData="seriesData"
    :errorData="errorData"
    :metaData="metaData"

    :showHeader="false"

    :splitterLimits="[0, 20]"
    :editMode="true"
    :hideAllFieldsSelection="true"

    :showQueryBuilder="false"
    :showQueryEditor="false"

    :showVariablesSelector="false"

    :errorMessage="errorMessage"
    :maxQueryRangeWarning="maxQueryRangeWarning"
    :limitNumberOfSeriesWarningMessage="limitNumberOfSeriesWarningMessage"
    :showLastRefreshed="false"

    searchType="logs"
    :searchResponse="searchResponse"
    :is_ui_histogram="is_ui_histogram"
    :allowAlertCreation="true"

    :allowedChartTypes="['area', 'bar', 'h-bar', 'line', 'scatter', 'table']"

    :isOutDated="isOutDated"
    outDatedWarningMessage="Chart configuration has been updated, but the chart was not updated automatically. Click on the 'Run Query' button to run the query again"

    :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
    :showLegendsButton="true"

    :fieldListContainerStyle="{ height: '100%', overflowY: 'auto' }"
    :chartColumnStyle="{ height: '100%' }"

    @chartTypeChange="handleChartTypeChange"
    @collapseFieldList="collapseFieldList"
    @metadataUpdate="metaDataValue"
    @resultMetadataUpdate="onResultMetadataUpdate"
    @limitWarningUpdate="handleLimitNumberOfSeriesWarningMessage"
    @chartError="handleChartApiError"
    @vrlFunctionFieldListUpdate="updateVrlFunctionFieldList"
    @seriesDataUpdate="seriesDataUpdate"
    @showLegends="showLegendsDialog = true"
    ref="visualizationLayoutRef"
  >
    <!-- Warning Icons & Action Buttons Slot -->
    <template #warning-icons>
      <!-- Error Warning Icon -->
      <q-btn
        v-if="errorMessage"
        :icon="outlinedWarning"
        flat
        size="xs"
        padding="2px"
        data-test="dashboard-panel-error-data"
        class="warning q-mr-xs"
      >
        <q-tooltip anchor="bottom right" self="top right" max-width="220px">
          <div style="white-space: pre-wrap">
            {{ errorMessage }}
          </div>
        </q-tooltip>
      </q-btn>

      <!-- Max Query Range Warning Icon -->
      <q-btn
        v-if="maxQueryRangeWarning"
        :icon="outlinedWarning"
        flat
        size="xs"
        padding="2px"
        data-test="dashboard-panel-max-duration-warning"
        class="warning q-mr-xs"
      >
        <q-tooltip anchor="bottom right" self="top right" max-width="220px">
          <div style="white-space: pre-wrap">
            {{ maxQueryRangeWarning }}
          </div>
        </q-tooltip>
      </q-btn>

      <!-- Series Limit Warning Icon -->
      <q-btn
        v-if="limitNumberOfSeriesWarningMessage"
        :icon="symOutlinedDataInfoAlert"
        flat
        size="xs"
        padding="2px"
        data-test="dashboard-panel-limit-number-of-series-warning"
        class="warning q-mr-xs"
      >
        <q-tooltip anchor="bottom right" self="top right" max-width="220px">
          <div style="white-space: pre-wrap">
            {{ limitNumberOfSeriesWarningMessage }}
          </div>
        </q-tooltip>
      </q-btn>

      <!-- Add to Dashboard Button -->
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
      >
        {{ t("search.addToDashboard") }}
      </q-btn>
    </template>

    <!-- Dialogs Slot -->
    <template #dialogs>
      <!-- Show Legends Dialog -->
      <q-dialog v-model="showLegendsDialog">
        <ShowLegendsPopup
          :panelData="currentPanelData"
          @close="showLegendsDialog = false"
        />
      </q-dialog>

      <!-- Add to Dashboard Dialog -->
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
    </template>
  </VisualizationLayout>
</template>

<script lang="ts">
import { defineComponent, ref, watch, defineAsyncComponent, computed, provide, inject, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { toRefs } from "vue";
import { isEqual } from "lodash-es";

// Import the new common component
import VisualizationLayout from "@/components/dashboards/VisualizationLayout.vue";

// Import composables
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { useFieldListCollapse } from "@/composables/useFieldListCollapse";
import { useChartWarnings } from "@/composables/useChartWarnings";
import useNotifications from "@/composables/useNotifications";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";

// Import utilities
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { isSimpleSelectAllQuery } from "@/utils/query/sqlUtils";

// Import icons
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";

// Async components
const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
});

const ShowLegendsPopup = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
});

export default defineComponent({
  name: "VisualizeLogsQuery",
  components: {
    VisualizationLayout,
    AddToDashboard,
    ShowLegendsPopup,
  },
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
  emits: ["handleChartApiError"],
  setup(props, { emit }) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "logs"
    );
    const { t } = useI18n();
    const store = useStore();
    const { dashboardPanelData, resetAggregationFunction, validatePanel } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    // Use shared composables
    const { collapseFieldList, layoutSplitterUpdated } =
      useFieldListCollapse(dashboardPanelData);

    const {
      errorMessage,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      handleChartApiError: handleChartApiErrorComposable,
      handleLimitNumberOfSeriesWarningMessage,
      onResultMetadataUpdate: onResultMetadataUpdateComposable,
    } = useChartWarnings();

    const { showErrorNotification } = useNotifications();
    const { searchObj } = searchState();
    const { buildSearch } = useSearchStream();

    // Refs for UI state
    const metaData = ref(null);
    const resultMetaData = ref(null);
    const seriesData = ref([] as any[]);
    const showLegendsDialog = ref(false);
    const visualizationLayoutRef: any = ref(null);
    const showAddToDashboardDialog = ref(false);
    const splitterModel = ref(50);

    // Extract props using toRefs
    const { visualizeChartData, is_ui_histogram, shouldRefreshWithoutCache }: any = toRefs(props);

    // Create local chartData ref (external data binding pattern)
    const chartData = ref(visualizeChartData.value);

    // Watch for external chart data changes (coming from parent component)
    watch(
      () => visualizeChartData.value,
      async () => {
        chartData.value = JSON.parse(JSON.stringify(visualizeChartData.value));
      },
      { deep: true }
    );

    // Computed for isOutDated
    const isOutDated = computed(() => {
      const configChanged = !isEqual(chartData.value, dashboardPanelData.data);

      // skip outdate check if doesnt require to call api
      let configNeedsApiCall = false;
      if (configChanged) {
        configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          dashboardPanelData.data
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
      }
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
          "Select * query is not supported for visualization."
        );
        // Prevent the change by not updating the type
        return;
      }

      // If validation passes, proceed with the change
      dashboardPanelData.data.type = newType;
      resetAggregationFunction();
    };

    // resize the chart when query editor is opened and closed
    const expandedSplitterHeight = ref(null);
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
      }
    );

    // Handle chart API error (override to emit to parent)
    const handleChartApiError = (errorMsg: any) => {
      // Update local state via composable
      handleChartApiErrorComposable(errorMsg);

      // Also update props.errorData for parent component
      if (typeof errorMsg === "string") {
        const errorList = props.errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg);
      } else if (errorMsg?.message) {
        const errorList = props.errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg.message);
        props.errorData.value = errorMsg?.message ?? "";
      }

      // Emit to parent
      emit("handleChartApiError", errorMsg);
    };

    // Hovered series state (for chart interactions)
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
        hoveredTime?: any
      ) {
        hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
        hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
        hoveredSeriesState.value.panelId = panelId ?? -1;
        hoveredSeriesState.value.hoveredTime = hoveredTime ?? null;
      },
    });

    // Provide to child components
    provide("hoveredSeriesState", hoveredSeriesState);

    // Add to dashboard
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
          "There are some errors, please fix them and try again"
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
            ]?.fields?.latitude.alias
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
            ]?.fields?.longitude.alias
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
            ]?.fields?.weight.alias
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
            ]?.fields?.source.alias
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
            ]?.fields?.target.alias
          );
        }

        // add value alias
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
            ]?.fields?.value.alias
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

    const onResultMetadataUpdate = (resultMetaDataParams: any) => {
      resultMetaData.value = resultMetaDataParams ?? null;

      // Call composable function to update maxQueryRangeWarning
      onResultMetadataUpdateComposable(resultMetaDataParams);
    };

    // Computed for current panel data (used in legends dialog)
    const currentPanelData = computed(() => {
      const rendererRef = visualizationLayoutRef.value?.panelSchemaRendererRef;
      const rendererData = rendererRef?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
    });

    const metaDataValue = (metadata: any) => {
      metaData.value = metadata;
    };

    const seriesDataUpdate = (data: any) => {
      seriesData.value = data;
    };

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
      visualizationLayoutRef,
    };
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/visualization-layout.scss";
</style>
