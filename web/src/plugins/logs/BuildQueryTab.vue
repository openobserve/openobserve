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
    editMode
    hideAllFieldsSelection
    :showQueryBuilder="false"
    showQueryEditor
    :showVariablesSelector="false"
    :errorMessage="errorMessage"
    :maxQueryRangeWarning="maxQueryRangeWarning"
    :limitNumberOfSeriesWarningMessage="limitNumberOfSeriesWarningMessage"
    :showLastRefreshed="false"
    searchType="logs"
    :searchResponse="searchResponse"
    :is_ui_histogram="is_ui_histogram"
    allowAlertCreation
    :allowedChartTypes="[
      'area',
      'area-stacked',
      'bar',
      'h-bar',
      'line',
      'scatter',
      'pie',
      'donut',
      'heatmap',
      'stacked',
      'h-stacked',
      'metric',
      'table',
    ]"
    :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
    :isOutDated="isOutDated"
    :outDatedWarningMessage="outDatedWarningMessage"
    :fieldListContainerStyle="{ height: '100%', overflowY: 'auto' }"
    :chartColumnStyle="{ height: '100%', overflow: 'hidden' }"
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
    <template #dialogs>
      <!-- Show Legends Dialog -->
      <q-dialog v-model="showLegendsDialog">
        <ShowLegendsPopup
          v-if="seriesData"
          :seriesData="seriesData"
          @close="showLegendsDialog = false"
        />
      </q-dialog>

      <!-- Add to Dashboard Button - Positioned as overlay -->
      <div
        v-if="!errorData?.errors?.length"
        style="
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
        "
      >
        <q-btn
          size="md"
          class="no-border"
          no-caps
          unelevated
          color="primary"
          @click="addToDashboard"
          :title="t('search.addToDashboard')"
          icon="add_box"
          :label="t('search.addToDashboard')"
        />
      </div>
    </template>
  </VisualizationLayout>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, provide, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

// Import the new common component
import VisualizationLayout from "@/components/dashboards/VisualizationLayout.vue";

// Import specific components
import ShowLegendsPopup from "@/components/dashboards/addPanel/ShowLegendsPopup.vue";

// Import composables
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { useFieldListCollapse } from "@/composables/useFieldListCollapse";
import { useChartWarnings } from "@/composables/useChartWarnings";

// Import utilities
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep, isEqual } from "lodash-es";
import { parseSQLQueryToPanelObject } from "@/utils/dashboard/sqlQueryParser";

// Import icons
import { outlinedWarning } from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";

export default defineComponent({
  name: "BuildQueryTab",
  components: {
    VisualizationLayout,
    ShowLegendsPopup,
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
    const registerBuildQueryTabRunQuery = inject(
      "registerBuildQueryTabRunQuery",
      null
    );

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

    // Use shared composables
    const { collapseFieldList, layoutSplitterUpdated } =
      useFieldListCollapse(dashboardPanelData);

    const {
      errorMessage,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      handleChartApiError,
      handleLimitNumberOfSeriesWarningMessage,
      onResultMetadataUpdate,
    } = useChartWarnings();

    // Refs for UI state
    const showLegendsDialog = ref(false);
    const seriesData = ref(null);
    const visualizationLayoutRef = ref(null);
    const searchResponse = ref(null);

    // Create local chartData ref (matching VisualizeLogsQuery pattern)
    // This creates a reactive copy that re-renders the chart when updated
    const chartData = ref(
      JSON.parse(JSON.stringify(dashboardPanelData.data))
    );

    // Computed for isOutDated
    const isOutDated = ref(false);

    // Out dated warning message
    const outDatedWarningMessage = "Chart configuration has been updated, but the chart was not updated automatically. Click on the Run Query button to run the query again";

    // Initialize from logs context
    const initializeFromLogsContext = () => {
      // Set sqlMode to true before parsing query
      if (logsPageSearchObj?.meta) {
        logsPageSearchObj.meta.sqlMode = true;
        console.log(
          "[BuildQueryTab] Set logs page sqlMode to true before parsing"
        );
      }

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
                logsPageSearchObj.data.datetime.relativeTimePeriod
              )
            : cloneDeep(logsPageSearchObj.data.datetime);

        dashboardPanelData.meta.dateTime = {
          start_time: new Date(dateTime.startTime),
          end_time: new Date(dateTime.endTime),
        };
      }

      // Try to parse existing query from logs/visualize tab
      let queryParsed = false;
      if (logsPageSearchObj?.data?.query) {
        const existingQuery = logsPageSearchObj.data.query;

        try {
          // Skip if query is empty or an array (multiple queries not supported)
          if (
            existingQuery &&
            typeof existingQuery === "string" &&
            existingQuery.trim()
          ) {
            console.log(
              "[BuildQueryTab] Attempting to parse query:",
              existingQuery
            );

            // Parse the SQL query to panel object
            const streamType =
              logsPageSearchObj.data?.stream?.selectedStream?.[0]
                ?.stream_type ||
              store.state.organizationData.organizationSettings?.stream_type ||
              "logs";

            const parsedQuery = parseSQLQueryToPanelObject(
              existingQuery,
              streamType
            );
            console.log("[BuildQueryTab] Parsed query result:", parsedQuery);

            // Populate dashboard panel fields from parsed query
            if (parsedQuery && parsedQuery.fields) {
              // Set stream name
              if (parsedQuery.fields.stream) {
                dashboardPanelData.data.queries[0].fields.stream =
                  parsedQuery.fields.stream;
                console.log(
                  "[BuildQueryTab] Set stream:",
                  parsedQuery.fields.stream
                );
              }

              // Set stream type
              if (parsedQuery.fields.stream_type) {
                dashboardPanelData.data.queries[0].fields.stream_type =
                  parsedQuery.fields.stream_type;
                console.log(
                  "[BuildQueryTab] Set stream_type:",
                  parsedQuery.fields.stream_type
                );
              }

              // Set x-axis fields (GROUP BY fields)
              if (parsedQuery.fields.x && parsedQuery.fields.x.length > 0) {
                dashboardPanelData.data.queries[0].fields.x = cloneDeep(
                  parsedQuery.fields.x
                );
                console.log(
                  "[BuildQueryTab] Set x-axis fields:",
                  parsedQuery.fields.x.length
                );
              }

              // Set y-axis fields (aggregations)
              if (parsedQuery.fields.y && parsedQuery.fields.y.length > 0) {
                dashboardPanelData.data.queries[0].fields.y = cloneDeep(
                  parsedQuery.fields.y
                );
                console.log(
                  "[BuildQueryTab] Set y-axis fields:",
                  parsedQuery.fields.y.length
                );
              }

              // Set breakdown field
              if (
                parsedQuery.fields.breakdown &&
                parsedQuery.fields.breakdown.length > 0
              ) {
                dashboardPanelData.data.queries[0].fields.breakdown = cloneDeep(
                  parsedQuery.fields.breakdown
                );
                console.log(
                  "[BuildQueryTab] Set breakdown fields:",
                  parsedQuery.fields.breakdown.length
                );
              }

              // Set filters (WHERE clause)
              if (
                parsedQuery.fields.filter &&
                parsedQuery.fields.filter.conditions
              ) {
                dashboardPanelData.data.queries[0].fields.filter = cloneDeep(
                  parsedQuery.fields.filter
                );
                console.log(
                  "[BuildQueryTab] Set filters with",
                  parsedQuery.fields.filter.conditions.length,
                  "conditions"
                );
              }

              // Set joins
              if (parsedQuery.joins && parsedQuery.joins.length > 0) {
                dashboardPanelData.data.queries[0].joins = cloneDeep(
                  parsedQuery.joins
                );
                console.log(
                  "[BuildQueryTab] Set joins:",
                  parsedQuery.joins.length
                );
              }

              // Set config options (limit, sort)
              if (parsedQuery.config) {
                if (
                  parsedQuery.config.limit !== undefined &&
                  parsedQuery.config.limit > 0
                ) {
                  dashboardPanelData.data.config.limit =
                    parsedQuery.config.limit;
                  console.log(
                    "[BuildQueryTab] Set limit:",
                    parsedQuery.config.limit
                  );
                }
              }

              // Set customQuery to false to enable visual builder
              // Fields that cannot fit in the schema (CASE statements, subqueries, etc.)
              // will have type="raw" and be handled individually
              dashboardPanelData.data.queries[0].customQuery = false;

              queryParsed = true;
              console.log(
                "[BuildQueryTab] Successfully parsed and populated query fields"
              );
            }
          }
        } catch (error) {
          // If parsing fails, log warning and fall back to default initialization
          console.warn(
            "[BuildQueryTab] Failed to parse existing query, using default initialization."
          );
          console.warn("Query:", existingQuery);
          console.warn("Error:", error);

          // Show error to user
          $q.notify({
            type: "warning",
            message: `Could not parse SQL query for visual builder: ${error.message || "Unknown error"}`,
            caption: "Starting with empty query builder instead",
            timeout: 5000,
          });

          queryParsed = false;
        }
      }

      // If no query was parsed, generate initial SQL (auto SQL mode)
      if (!queryParsed) {
        console.log(
          "[BuildQueryTab] No query parsed, generating default auto SQL"
        );
        makeAutoSQLQuery();
      }
    };

    // Handle chart type change
    const handleChartTypeChange = (type: string) => {
      dashboardPanelData.data.type = type;
      resetAggregationFunction();
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

    // Update VRL function field list
    const updateVrlFunctionFieldList = (data: any) => {
      // Update field list
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
                  logsPageSearchObj.data.datetime.relativeTimePeriod
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
        dashboardPanelData.data.queries[0]?.fields?.stream,
      ],
      () => {
        // Only generate auto SQL if we're in auto query mode (not custom SQL)
        if (!dashboardPanelData.data.queries[0].customQuery) {
          makeAutoSQLQuery();

          // Emit the generated query to parent
          const generatedQuery =
            dashboardPanelData.data.queries[0]?.query || "";
          if (generatedQuery) {
            emit("query-changed", generatedQuery);
          }
        }
      },
      { deep: true }
    );

    onMounted(() => {
      // Register the runQuery function with parent (Index.vue)
      if (
        registerBuildQueryTabRunQuery &&
        typeof registerBuildQueryTabRunQuery === "function"
      ) {
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
      outDatedWarningMessage,
      errorMessage,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      showLegendsDialog,
      seriesData,
      visualizationLayoutRef,
      searchResponse,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      metaData: ref(null),
      is_ui_histogram: ref(false),
    };
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/visualization-layout.scss";
</style>
