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
    <!-- PanelEditor Content Area (no header for logs visualization) -->
    <PanelEditor
      ref="panelEditorRef"
      pageType="logs"
      :editMode="true"
      :dashboardData="{}"
      :variablesData="{}"
      :selectedDateTime="dashboardPanelData.meta.dateTime"
      :externalChartData="chartData"
      :searchResponse="searchResponse"
      :isUiHistogram="is_ui_histogram"
      :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
      :allowedChartTypes="allowedChartTypes"
      @addToDashboard="addToDashboard"
      @chartApiError="handleChartApiError"
    />

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
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, defineAsyncComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { provide, inject, toRefs, onActivated } from "vue";
import useNotifications from "@/composables/useNotifications";
import { isSimpleSelectAllQuery } from "@/utils/query/sqlUtils";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { PanelEditor } from "@/components/dashboards/PanelEditor";

const AddToDashboard = defineAsyncComponent(() => {
  return import("./../metrics/AddToDashboard.vue");
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
    AddToDashboard,
    PanelEditor,
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
    const resultMetaData = ref(null);

    const { showErrorNotification } = useNotifications();

    const { searchObj } = searchState();
    const { buildSearch } = useSearchStream();

    const {
      visualizeChartData,
      is_ui_histogram,
      shouldRefreshWithoutCache,
    }: any = toRefs(props);
    const chartData = ref(visualizeChartData.value);

    const showAddToDashboardDialog = ref(false);

    // PanelEditor ref for accessing exposed methods/properties
    const panelEditorRef = ref<InstanceType<typeof PanelEditor> | null>(null);

    // Allowed chart types for logs visualization
    const allowedChartTypes = ["area", "bar", "h-bar", "line", "scatter", "table"];

    // Watch for external chart data changes
    watch(
      () => visualizeChartData.value,
      async () => {
        chartData.value = JSON.parse(JSON.stringify(visualizeChartData.value));
      },
      { deep: true }
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

    const handleChartApiError = (errorMsg: any) => {
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

      emit("handleChartApiError", errorMsg);
    };

    // Provide hovered series state for child components
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

    provide("hoveredSeriesState", hoveredSeriesState);

    const addToDashboard = () => {
      // Get result metadata from PanelEditor if available
      const panelResultMetaData = panelEditorRef.value?.metaData?.value;

      if (
        panelResultMetaData?.[0]?.[0]?.converted_histogram_query &&
        is_ui_histogram.value === true
      ) {
        dashboardPanelData.data.queries[0].query =
          panelResultMetaData?.[0]?.[0]?.converted_histogram_query;
      } else if (
        // Backward compatibility - check if it's old format
        panelResultMetaData?.[0]?.converted_histogram_query &&
        is_ui_histogram.value === true &&
        !Array.isArray(panelResultMetaData?.[0])
      ) {
        dashboardPanelData.data.queries[0].query =
          panelResultMetaData?.[0]?.converted_histogram_query;
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

    return {
      t,
      dashboardPanelData,
      handleChartApiError,
      resetAggregationFunction,
      store,
      chartData,
      showAddToDashboardDialog,
      addPanelToDashboard,
      addToDashboard,
      is_ui_histogram,
      shouldRefreshWithoutCache,
      hoveredSeriesState,
      resultMetaData,
      isSimpleSelectAllQuery,
      handleChartTypeChange,
      panelEditorRef,
      allowedChartTypes,
    };
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/logs/visualizelogs-query.scss";
</style>
