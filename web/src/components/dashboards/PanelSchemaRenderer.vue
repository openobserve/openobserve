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
  <div
    style="width: 100%; height: 100%"
    @mouseleave="hidePopupsAndOverlays"
    @mouseenter="showPopupsAndOverlays"
  >
    <div
      ref="chartPanelRef"
      style="height: 100%; position: relative"
      :class="chartPanelClass"
    >
      <div
        v-if="!errorDetail?.message"
        :style="{ height: chartPanelHeight, width: '100%' }"
      >
        <MapsRenderer
          v-if="panelSchema.type == 'maps'"
          :data="panelData.chartType == 'maps' ? panelData : { options: {} }"
        ></MapsRenderer>
        <GeoMapRenderer
          v-else-if="panelSchema.type == 'geomap'"
          :data="
            panelData.chartType == 'geomap'
              ? panelData
              : { options: { backgroundColor: 'transparent' } }
          "
        />
        <PromQLTableChart
          v-else-if="
            panelSchema.type == 'table' && panelSchema.queryType === 'promql'
          "
          :data="tableRendererData"
          :config="panelSchema.config"
          @row-click="onChartClick"
        />
        <TableRenderer
          v-else-if="panelSchema.type == 'table'"
          :data="
            panelData.chartType == 'table'
              ? panelData
              : { options: { backgroundColor: 'transparent' } }
          "
          :value-mapping="panelSchema?.config?.mappings ?? []"
          @row-click="onChartClick"
          ref="tableRendererRef"
          :wrap-cells="panelSchema.config?.wrap_table_cells"
        />
        <div
          v-else-if="panelSchema.type == 'html'"
          class="col column"
          style="width: 100%; height: 100%; flex: 1"
        >
          <HTMLRenderer
            :htmlContent="panelSchema.htmlContent"
            style="width: 100%; height: 100%"
            class="col"
            :variablesData="currentVariablesData || variablesData"
            :tabId="tabId"
            :panelId="panelSchema.id"
          />
        </div>
        <div
          v-else-if="panelSchema.type == 'markdown'"
          class="col column"
          style="width: 100%; height: 100%; flex: 1"
        >
          <MarkdownRenderer
            :markdownContent="panelSchema.markdownContent"
            style="width: 100%; height: 100%"
            class="col"
            :variablesData="currentVariablesData || variablesData"
            :tabId="tabId"
            :panelId="panelSchema.id"
          />
        </div>

        <CustomChartRenderer
          v-else-if="panelSchema.type == 'custom_chart'"
          :data="panelData"
          style="width: 100%; height: 100%"
          class="col"
          @error="errorDetail = $event"
        />
        <ChartRenderer
          v-else
          :data="
            panelSchema.queryType === 'promql' ||
            (panelData.chartType != 'geomap' &&
              panelData.chartType != 'table' &&
              panelData.chartType != 'maps' &&
              loading)
              ? panelData
              : noData == 'No Data'
                ? {
                    options: {
                      backgroundColor: 'transparent',
                    },
                  }
                : panelData
          "
          :height="chartPanelHeight"
          @updated:data-zoom="onDataZoom"
          @error="errorDetail = $event"
          @click="onChartClick"
          @contextmenu="onChartContextMenu"
          @domcontextmenu="onChartDomContextMenu"
        />
      </div>
      <div
        v-if="
          !errorDetail?.message &&
          panelSchema.type != 'geomap' &&
          panelSchema.type != 'maps' &&
          !loading
        "
        class="noData"
        data-test="no-data"
      >
        {{ noData }}
      </div>
      <div
        v-if="
          errorDetail?.message &&
          !panelSchema?.error_config?.custom_error_handeling
        "
        class="errorMessage"
      >
        <q-icon size="md" name="warning" />
        <div style="height: 80%; width: 100%">
          {{
            errorDetail?.code?.toString().startsWith("4")
              ? errorDetail.message
              : "Error Loading Data"
          }}
        </div>
      </div>
      <div
        v-if="
          errorDetail?.message &&
          panelSchema?.error_config?.custom_error_handeling &&
          !panelSchema?.error_config?.default_data_on_error &&
          panelSchema?.error_config?.custom_error_message
        "
        class="customErrorMessage"
      >
        {{ panelSchema?.error_config?.custom_error_message }}
      </div>
      <div
        class="row"
        style="position: absolute; top: 0px; width: 100%; z-index: 999"
      >
        <LoadingProgress
          :loading="loading"
          :loadingProgressPercentage="loadingProgressPercentage"
        />
      </div>
      <div
        v-if="isCursorOverPanel"
        class="flex items-center q-gutter-x-xs"
        style="
          position: absolute;
          top: 0px;
          right: 0px;
          z-index: 9;
          padding-right: 2px;
          padding-top: 2px;
        "
        @click.stop
      >
        <q-btn
          v-if="
            showLegendsButton &&
            noData !== 'No Data' &&
            ![
              'table',
              'html',
              'markdown',
              'custom_chart',
              'geomap',
              'maps',
              'heatmap',
              'metric',
              'gauge',
            ].includes(panelSchema.type)
          "
          color="primary"
          icon="format_list_bulleted"
          round
          outline
          size="sm"
          @click="$emit('show-legends')"
          class="el-border"
        >
          <q-tooltip anchor="top middle" self="bottom right">
            Show Legends
          </q-tooltip>
        </q-btn>
        <q-btn
          v-if="
            [
              'area',
              'area-stacked',
              'bar',
              'h-bar',
              'line',
              'scatter',
              'stacked',
              'h-stacked',
            ].includes(panelSchema.type) &&
            checkIfPanelIsTimeSeries === true &&
            allowAnnotationsAdd &&
            !viewOnly
          "
          color="primary"
          :icon="isAddAnnotationMode ? 'cancel' : 'edit'"
          round
          outline
          size="sm"
          @click="toggleAddAnnotationMode"
          class="el-border"
        >
          <q-tooltip anchor="top middle" self="bottom right">
            {{
              isAddAnnotationMode ? "Exit Annotations Mode" : "Add Annotations"
            }}
          </q-tooltip>
        </q-btn>
      </div>
      <div
        style="
          border: 1px solid gray;
          border-radius: 4px;
          padding: 3px;
          position: absolute;
          top: 0px;
          left: 0px;
          display: none;
          text-wrap: nowrap;
          z-index: 9999999;
        "
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        ref="drilldownPopUpRef"
        @mouseleave="hidePopupsAndOverlays"
      >
        <div
          v-for="(drilldown, index) in drilldownArray"
          :key="JSON.stringify(drilldown)"
          class="drilldown-item q-px-sm q-py-xs"
          style="
            display: flex;
            flex-direction: row;
            align-items: center;
            position: relative;
          "
        >
          <div
            @click="openDrilldown(index)"
            style="cursor: pointer; display: flex; align-items: center"
          >
            <q-icon class="q-mr-xs q-mt-xs" size="16px" name="link" />
            <span>{{ drilldown.name }}</span>
          </div>
        </div>
      </div>
      <div
        style="
          border: 1px solid gray;
          border-radius: 4px;
          padding: 3px;
          position: absolute;
          top: 0px;
          left: 0px;
          display: none;
          max-width: 200px;
          white-space: normal;
          word-wrap: break-word;
          overflow-wrap: break-word;
          z-index: 9999999;
        "
        :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        ref="annotationPopupRef"
      >
        <div
          class="q-px-sm q-py-xs"
          style="
            display: flex;
            flex-direction: row;
            align-items: center;
            position: relative;
            word-break: break-word;
          "
        >
          <span style="word-break: break-word">{{
            selectedAnnotationData.text
          }}</span>
        </div>
      </div>
      <!-- Annotation Dialog -->
      <AddAnnotation
        v-if="isAddAnnotationDialogVisible"
        :dashboardId="dashboardId"
        :annotation="annotationToAddEdit"
        @close="closeAddAnnotation"
        :panelsList="panelsList"
      />
      <!-- Alert Context Menu -->
      <AlertContextMenu
        :visible="contextMenuVisible"
        :x="contextMenuPosition.x"
        :y="contextMenuPosition.y"
        :value="contextMenuValue"
        @select="handleCreateAlert"
        @close="hideContextMenu"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  watch,
  ref,
  toRefs,
  computed,
  inject,
  nextTick,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
} from "vue";
import { useStore } from "vuex";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import {
  getAllDashboardsByFolderId,
  getDashboard,
  getFoldersList,
} from "@/utils/commons";
import { useRoute, useRouter } from "vue-router";
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";
import { generateDurationLabel } from "../../utils/date";
import { onBeforeMount } from "vue";
import { useLoading } from "@/composables/useLoading";
import useNotifications from "@/composables/useNotifications";
import {
  getUTCTimestampFromZonedTimestamp,
  validateSQLPanelFields,
} from "@/utils/dashboard/convertDataIntoUnitValue";
import { useAnnotationsData } from "@/composables/dashboard/useAnnotationsData";
import { event } from "quasar";
import { exportFile } from "quasar";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import { throttle } from "lodash-es";

const ChartRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/ChartRenderer.vue");
});

const TableRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/TableRenderer.vue");
});

const PromQLTableChart = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/PromQLTableChart.vue");
});

const GeoMapRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/GeoMapRenderer.vue");
});

const MapsRenderer = defineAsyncComponent(() => {
  return import("@/components/dashboards/panels/MapsRenderer.vue");
});

const HTMLRenderer = defineAsyncComponent(() => {
  return import("./panels/HTMLRenderer.vue");
});

const MarkdownRenderer = defineAsyncComponent(() => {
  return import("./panels/MarkdownRenderer.vue");
});

const AddAnnotation = defineAsyncComponent(() => {
  return import("./addPanel/AddAnnotation.vue");
});
const CustomChartRenderer = defineAsyncComponent(() => {
  return import("./panels/CustomChartRenderer.vue");
});

const AlertContextMenu = defineAsyncComponent(() => {
  return import("./AlertContextMenu.vue");
});

export default defineComponent({
  name: "PanelSchemaRenderer",
  components: {
    ChartRenderer,
    AlertContextMenu,
    TableRenderer,
    PromQLTableChart,
    GeoMapRenderer,
    MapsRenderer,
    HTMLRenderer,
    MarkdownRenderer,
    AddAnnotation,
    CustomChartRenderer,
    LoadingProgress,
  },
  props: {
    selectedTimeObj: {
      required: true,
      type: Object,
    },
    panelSchema: {
      required: true,
      type: Object,
    },
    variablesData: {
      required: true,
      type: Object,
    },
    currentVariablesData: {
      required: false,
      type: Object,
      default: null,
    },
    forceLoad: {
      type: Boolean,
      default: false,
      required: false,
    },
    searchType: {
      default: null,
      type: String || null,
    },
    dashboardId: {
      default: "",
      required: false,
      type: String,
    },
    folderId: {
      default: "",
      required: false,
      type: String,
    },
    reportId: {
      default: "",
      required: false,
      type: String,
    },
    allowAnnotationsAdd: {
      default: false,
      required: false,
      type: Boolean,
    },
    allowAlertCreation: {
      default: false,
      required: false,
      type: Boolean,
    },
    runId: {
      type: String,
      default: null,
    },
    tabId: {
      type: String,
      default: null,
    },
    tabName: {
      type: String,
      default: null,
    },
    dashboardName: {
      type: String,
      default: null,
    },
    folderName: {
      type: String,
      default: null,
    },
    searchResponse: {
      required: false,
      type: Object,
    },
    is_ui_histogram: {
      type: Boolean,
      required: false,
      default: false,
    },
    viewOnly: {
      type: Boolean,
      default: false,
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      required: false,
      default: false,
    },
    showLegendsButton: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  emits: [
    "updated:data-zoom",
    "error",
    "metadata-update",
    "result-metadata-update",
    "last-triggered-at-update",
    "is-cached-data-differ-with-current-time-range-update",
    "update:initialVariableValues",
    "updated:vrlFunctionFieldList",
    "loading-state-change",
    "limit-number-of-series-warning-message-update",
    "is-partial-data-update",
    "series-data-update",
    "contextmenu",
    "show-legends",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();

    // ============================================================================
    // Hidden Queries Feature Setup
    // ============================================================================
    // This feature allows temporarily hiding PromQL query results from charts
    // on the Add Panel and Metrics pages. It's stored in layout (not config)
    // so it's not persisted to the dashboard.
    //
    // IMPORTANT: PanelSchemaRenderer is used in multiple contexts:
    // - AddPanel.vue (provides page key "addpanel") - needs hiding feature ✓
    // - metrics/Index.vue (provides page key "metrics") - needs hiding feature ✓
    // - ViewPanel.vue (provides page key "dashboard") - doesn't need it
    // - VisualizeLogsQuery.vue (provides page key "logs") - doesn't need it
    // - PreviewAlert.vue (no page key) - doesn't need it
    // - PanelContainer.vue (no page key) - doesn't need it
    // - PreviewPromqlQuery.vue (no page key) - doesn't need it
    //
    // To avoid breaking these other contexts, we:
    // 1. Inject with null default to detect if page key was explicitly provided
    // 2. Only call useDashboardPanelData if a page key exists
    // 3. Return empty array [] if no hiddenQueries (no filtering applied)
    // ============================================================================

    const dashboardPanelDataPageKey: any = inject(
      "dashboardPanelDataPageKey",
      null // null default allows us to detect if key was provided
    );

    // Only access the composable if we're in a context that provides a page key
    // This prevents creating unnecessary composable instances and accessing
    // wrong panel data in contexts that don't need the hiding feature
    let dashboardPanelDataForHiding: any = null;
    if (dashboardPanelDataPageKey) {
      const result = useDashboardPanelData(dashboardPanelDataPageKey);
      dashboardPanelDataForHiding = result.dashboardPanelData;
    }

    // Returns array of hidden query indices (e.g., [0, 2] means queries 0 and 2 are hidden)
    // Returns [] if no page key or no hiddenQueries - which means no filtering
    const hiddenQueries = computed(() => {
      return dashboardPanelDataForHiding?.layout?.hiddenQueries || [];
    });

    // stores the converted data which can be directly used for rendering different types of panels
    const panelData: any = ref({}); // holds the data to render the panel after getting data from the api based on panel config
    const chartPanelRef: any = ref(null); // holds the ref to the whole div
    const drilldownArray: any = ref([]);
    const selectedAnnotationData: any = ref([]);
    const drilldownPopUpRef: any = ref(null);
    const annotationPopupRef: any = ref(null);

    const limitNumberOfSeriesWarningMessage: any = ref("");

    const chartPanelStyle = ref({
      height: "100%",
      width: "100%",
    });

    const isCursorOverPanel = ref(false);
    const showPopupsAndOverlays = () => {
      isCursorOverPanel.value = true;
    };

    // get refs from props
    const {
      panelSchema,
      selectedTimeObj,
      variablesData,
      forceLoad,
      searchType,
      dashboardId,
      folderId,
      reportId,
      allowAnnotationsAdd,
      allowAlertCreation,
      runId,
      tabId,
      tabName,
      dashboardName,
      folderName,
      searchResponse,
      is_ui_histogram,
      shouldRefreshWithoutCache,
      showLegendsButton,
    } = toRefs(props);
    // calls the apis to get the data based on the panel config
    let {
      data,
      loading,
      errorDetail,
      metadata,
      resultMetaData,
      annotations,
      lastTriggeredAt,
      isCachedDataDifferWithCurrentTimeRange,
      searchRequestTraceIds,
      loadingProgressPercentage,
      isPartialData,
    } = usePanelDataLoader(
      panelSchema,
      selectedTimeObj,
      variablesData,
      chartPanelRef,
      forceLoad,
      searchType,
      dashboardId,
      folderId,
      reportId,
      runId,
      tabId,
      tabName,
      searchResponse,
      is_ui_histogram,
      dashboardName,
      folderName,
      shouldRefreshWithoutCache,
    );

    const {
      isAddAnnotationMode,
      isAddAnnotationDialogVisible,
      annotationToAddEdit,
      editAnnotation,
      toggleAddAnnotationMode,
      handleAddAnnotation,
      closeAddAnnotation,
      fetchAllPanels,
      panelsList,
    } = useAnnotationsData(
      store.state.selectedOrganization?.identifier,
      dashboardId.value,
      panelSchema.value.id,
      folderId.value,
    );

    // Filter data based on hiddenQueries for PromQL panels
    const filteredData = computed(() => {
      // If no data, return as is
      if (!data.value) {
        return data.value;
      }

      // Only filter for PromQL queries
      if (panelSchema.value.queryType !== "promql") {
        return data.value;
      }

      // If no hidden queries or empty array, return as is
      if (
        !hiddenQueries.value ||
        hiddenQueries.value.length === 0 ||
        !Array.isArray(data.value)
      ) {
        return data.value;
      }

      // Filter out hidden queries
      const filtered = data.value.filter(
        (_: any, index: number) => !hiddenQueries.value.includes(index),
      );

      // Return filtered data
      return filtered;
    });

    // need tableRendererRef to access downloadTableAsCSV method
    const tableRendererRef: any = ref(null);

    // Context menu state for alert creation
    const contextMenuVisible = ref(false);
    const contextMenuPosition = ref({ x: 0, y: 0 });
    const contextMenuValue = ref(0);
    const contextMenuData = ref<any>(null);

    const onChartContextMenu = (event: any) => {
      // Emit contextmenu event for general usage (drilldowns, annotations, etc.)
      emit("contextmenu", {
        ...event,
        panelTitle: panelSchema.value.title,
        panelId: panelSchema.value.id,
      });
    };

    const onChartDomContextMenu = (event: any) => {
      // Handle DOM contextmenu event specifically for alert creation
      if (!allowAlertCreation.value) {
        return;
      }

      contextMenuVisible.value = true;
      contextMenuPosition.value = { x: event.x, y: event.y };
      contextMenuValue.value = event.value;
      contextMenuData.value = event;
    };

    const hideContextMenu = () => {
      contextMenuVisible.value = false;
    };

    const handleCreateAlert = (selection: {
      condition: string;
      threshold: number;
    }) => {
      hideContextMenu();

      // Prepare panel data to pass to alert creation
      const query = panelSchema.value.queries?.[0];
      if (!query) {
        return;
      }

      // Determine query type based on panel configuration
      // Only care about SQL vs PromQL distinction
      let queryType = "sql"; // Default to SQL
      if (panelSchema.value.queryType === "promql") {
        queryType = "promql";
      }

      // Get the executed query with variables replaced from metadata
      // Only use metadata if it's available and has queries
      const executedQuery =
        metadata.value?.queries && metadata.value.queries.length > 0
          ? metadata.value.queries[0]?.query || query.query
          : query.query;

      // Get the Y-axis column for threshold comparison
      // Only needed for SQL queries, not for PromQL
      let yAxisColumn = null;

      if (queryType === "sql") {
        const clickedSeriesName = contextMenuData.value?.seriesName;
        const sqlQuery = executedQuery || query.query;

        // First, try to get from query.fields.y if available (most reliable for query builder)
        if (query.fields?.y && query.fields.y.length > 0) {
          // For query builder queries, use the Y-axis field
          const yField = query.fields.y[0];
          const aliasOrColumn = yField.alias || yField.column;

          // Extract from SQL to get the exact case (without quotes)
          if (sqlQuery) {
            // Look for pattern: aggregation_func(...) as "alias" or aggregation_func(...) as alias
            const escapedAlias = aliasOrColumn.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const regex = new RegExp(
              `\\s+as\\s+(["']?${escapedAlias}["']?)(?:\\s|,|\\)|$)`,
              "i",
            );
            const match = sqlQuery.match(regex);
            if (match && match[1]) {
              // Strip quotes - the parser will add them back if needed
              yAxisColumn = match[1].replace(/^["']|["']$/g, "");
            } else {
              yAxisColumn = aliasOrColumn;
            }
          } else {
            yAxisColumn = aliasOrColumn;
          }
        } else if (clickedSeriesName && sqlQuery) {
          // Fallback: try to match the clicked series name in the SQL
          // First try exact match with the series name
          const regex = new RegExp(
            `\\s+as\\s+["']?(${clickedSeriesName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})["']?(?:\\s|,|\\)|$)`,
            "i",
          );
          const match = sqlQuery.match(regex);
          if (match && match[1]) {
            yAxisColumn = match[1];
          } else {
            // Last resort: extract any aggregation column from SQL (first one found)
            // Pattern: count(...) as alias, avg(...) as alias, etc.
            const aggRegex =
              /(?:count|sum|avg|min|max|median)\s*\([^)]+\)\s+as\s+["']?([^"',\s)]+)["']?/i;
            const aggMatch = sqlQuery.match(aggRegex);
            if (aggMatch && aggMatch[1]) {
              yAxisColumn = aggMatch[1];
            } else {
              yAxisColumn = clickedSeriesName;
            }
          }
        }
      }

      const panelDataToPass = {
        panelTitle: panelSchema.value.title || "Unnamed Panel",
        panelId: panelSchema.value.id,
        queries: panelSchema.value.queries,
        queryType: queryType,
        timeRange: selectedTimeObj.value,
        threshold: selection.threshold,
        condition: selection.condition,
        // Pass the Y-axis column name for threshold comparison
        yAxisColumn: yAxisColumn,
        // Pass the executed query with variables already replaced
        executedQuery: executedQuery,
      };

      // Navigate to alert creation page
      router.push({
        name: "addAlert",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          fromPanel: "true",
          panelData: encodeURIComponent(JSON.stringify(panelDataToPass)),
        },
      });
    };

    // hovered series state
    // used to show tooltip axis for all charts
    const hoveredSeriesState: any = inject("hoveredSeriesState", null);

    const validatePanelData = computed(() => {
      const errors: any = [];

      // fields validation is not required for promql
      if (panelSchema.value?.queryType == "promql") {
        return errors;
      }

      const currentXLabel =
        panelSchema?.value?.type == "table"
          ? "First Column"
          : panelSchema?.value?.type == "h-bar"
            ? "Y-Axis"
            : "X-Axis";

      const currentYLabel =
        panelSchema?.value?.type == "table"
          ? "Other Columns"
          : panelSchema?.value?.type == "h-bar"
            ? "X-Axis"
            : "Y-Axis";

      validateSQLPanelFields(
        panelSchema.value,
        0,
        currentXLabel,
        currentYLabel,
        errors,
        true,
      );

      return errors;
    });

    // ======= [START] dashboard PrintMode =======

    //inject variablesAndPanelsDataLoadingState from parent
    // default values will be empty object of panels and variablesData
    const variablesAndPanelsDataLoadingState: any = inject(
      "variablesAndPanelsDataLoadingState",
      { panels: {}, variablesData: {}, searchRequestTraceIds: {} },
    );

    // Watch loading state changes and emit them to parent
    watch(loading, (newLoadingState) => {
      emit("loading-state-change", newLoadingState);
    });

    // on loading state change, update the loading state of the panels in variablesAndPanelsDataLoadingState
    watch(loading, (updatedLoadingValue) => {
      if (variablesAndPanelsDataLoadingState) {
        // update the loading state of the current panel
        variablesAndPanelsDataLoadingState.panels = {
          ...variablesAndPanelsDataLoadingState?.panels,
          [panelSchema?.value?.id]: updatedLoadingValue,
        };
      }
    });
    //watch trace id and add in the searchRequestTraceIds
    watch(searchRequestTraceIds, (updatedSearchRequestTraceIds) => {
      if (variablesAndPanelsDataLoadingState) {
        variablesAndPanelsDataLoadingState.searchRequestTraceIds = {
          ...variablesAndPanelsDataLoadingState?.searchRequestTraceIds,
          [panelSchema?.value?.id]: updatedSearchRequestTraceIds,
        };
      }
    });
    // ======= [END] dashboard PrintMode =======

    onMounted(async () => {
      // fetch all panels
      await fetchAllPanels();
      panelsList.value = panelsList.value;
    });

    // When switching of tab was done, reset the loading state of the panels in variablesAndPanelsDataLoadingState
    // As some panels were getting true cancel button and datetime picker were not getting updated
    onUnmounted(() => {
      if (variablesAndPanelsDataLoadingState) {
        variablesAndPanelsDataLoadingState.searchRequestTraceIds = {
          ...variablesAndPanelsDataLoadingState?.searchRequestTraceIds,
          [panelSchema?.value?.id]: [],
        };
        variablesAndPanelsDataLoadingState.panels = {
          ...variablesAndPanelsDataLoadingState?.panels,
          [panelSchema?.value?.id]: false,
        };
      }

      // Clear all refs to prevent memory leaks
      chartPanelRef.value = null;
      drilldownPopUpRef.value = null;
      annotationPopupRef.value = null;
      tableRendererRef.value = null;
      parser = null;
    });
    const convertPanelDataCommon = async () => {
      if (
        !errorDetail?.value?.message &&
        validatePanelData?.value?.length === 0
      ) {
        try {
          panelData.value = await convertPanelData(
            panelSchema.value,
            filteredData.value,
            store,
            chartPanelRef,
            hoveredSeriesState,
            resultMetaData,
            metadata.value,
            chartPanelStyle.value,
            annotations,
            loading.value,
          );

          limitNumberOfSeriesWarningMessage.value =
            panelData.value?.extras?.limitNumberOfSeriesWarningMessage ?? "";

          errorDetail.value = {
            message: "",
            code: "",
          };
        } catch (error: any) {
          errorDetail.value = {
            message: error?.message,
            code: error?.code || "",
          };
        }
      } else {
        // if no data is available, then show the default data
        // if there is an error config in the panel schema, then show the default data on error
        // if no default data on error is set, then show the custom error message
        if (
          panelSchema.value?.error_config?.custom_error_handeling &&
          panelSchema.value?.error_config?.default_data_on_error
        ) {
          data.value = JSON.parse(
            panelSchema.value?.error_config?.default_data_on_error,
          );
          errorDetail.value = {
            message: "",
            code: "",
          };
        }
      }
    };

    // Track if we've rendered the first chunk with actual data
    let hasRenderedFirstDataChunk = ref(false);

    // Create a throttled version for streaming updates (350ms throttle)
    // Chunks arrive ~300-400ms apart, so 350ms ensures updates every 2-3 chunks
    // This prevents excessive re-renders while showing progressive updates
    const convertPanelDataThrottled = throttle(convertPanelDataCommon, 350, {
      leading: true,  // Call immediately on first invocation
      trailing: true  // Ensure final call after throttle period
    });

    // Watch for panel schema changes to re-convert panel data
    watch(
      panelSchema,
      async () => {
        // Re-convert panel data when schema changes (for non-whitelisted config changes)
        // Skip if queries length changed - let data watcher handle it after reload
        const currentQueriesCount = panelSchema.value?.queries?.length || 0;
        const dataArrayCount = data.value?.length || 0;

        // Skip conversion if query count doesn't match data count - data is stale
        if (currentQueriesCount !== dataArrayCount) {
          return;
        }

        if (
          !errorDetail?.value?.message &&
          validatePanelData?.value?.length === 0 &&
          data.value?.length
        ) {
          await convertPanelDataCommon();
        }
      },
      { deep: true },
    );

    // Watch for hiddenQueries changes to re-render the chart
    watch(
      hiddenQueries,
      async () => {
        // Only re-convert panel data if we're in promql mode
        if (panelSchema.value.queryType === "promql" && data.value) {
          await convertPanelDataCommon();
        }
      },
      { deep: true },
    );

    watch(
      [
        data,
        () => store?.state?.theme,
        () => store?.state?.timezone,
        annotations
      ],
      async () => {
        // emit vrl function field list
        if (data.value?.length && data.value[0] && data.value[0].length) {
          // Find the index of the record with max attributes
          const maxAttributesIndex = data.value[0].reduce(
            (
              maxIndex: string | number | any,
              obj: {},
              currentIndex: any,
              array: Array<Record<string, unknown>>,
            ) => {
              const numAttributes = Object.keys(obj).length;
              const maxNumAttributes = Object.keys(array[maxIndex]).length;
              return numAttributes > maxNumAttributes ? currentIndex : maxIndex;
            },
            0,
          );

          const recordwithMaxAttribute = data.value[0][maxAttributesIndex];

          const responseFields = Object.keys(recordwithMaxAttribute);

          emit("updated:vrlFunctionFieldList", responseFields);
        }
        if (panelData.value.chartType == "custom_chart")
          errorDetail.value = {
            message: "",
            code: "",
          };

        // Check if this is the first chunk with actual data
        const hasData = data.value?.length > 0 &&
                       data.value[0]?.result?.length > 0;

        // Use throttled version during loading (streaming), immediate version when complete
        // This prevents excessive re-renders during PromQL data streaming
        if (loading.value) {
          // First chunk with actual data: render immediately!
          if (hasData && !hasRenderedFirstDataChunk.value) {
            hasRenderedFirstDataChunk.value = true;
            await convertPanelDataCommon();
          } else {
            // Subsequent chunks: throttle to reduce re-render frequency
            await convertPanelDataThrottled();
          }
        } else {
          // Loading complete: immediate final render with full data
          // Cancel any pending throttled calls and render immediately
          convertPanelDataThrottled.cancel();
          hasRenderedFirstDataChunk.value = false; // Reset for next query
          await convertPanelDataCommon();
        }
      },
      { deep: true },
    );

    const checkIfPanelIsTimeSeries = computed(() => {
      return panelData.value?.extras?.isTimeSeries;
    });

    // when we get the new metadata from the apis, emit the metadata update
    watch(
      metadata,
      () => {
        emit("metadata-update", metadata.value);
      },
      { deep: true },
    );

    // Listen for layout changes to update chart dimensions
    const handleWindowLayoutChanges = async () => {
      if (chartPanelRef.value) {
        await nextTick();
        await convertPanelDataCommon();
      }
    };

    // ResizeObserver to detect chartPanelRef dimension changes
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    onMounted(() => {
      if (chartPanelRef.value) {
        resizeObserver = new ResizeObserver(() => {
          // Debounce the resize handler to prevent "ResizeObserver loop" errors
          // This error occurs when the callback takes longer than one animation frame
          if (resizeTimeout) {
            clearTimeout(resizeTimeout);
          }

          resizeTimeout = window.setTimeout(() => {
            // Use requestAnimationFrame to ensure DOM updates happen at the right time
            requestAnimationFrame(() => {
              handleWindowLayoutChanges();
            });
          }, 100); // 100ms debounce delay
        });

        resizeObserver.observe(chartPanelRef.value);
      }
    });

    onUnmounted(() => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
      }
    });

    watch(
      panelData,
      () => {
        emit("series-data-update", panelData.value);
      },
      { deep: true },
    );

    // when we get the new limitNumberOfSeriesWarningMessage from the convertPanelData, emit the limitNumberOfSeriesWarningMessage
    watch(
      limitNumberOfSeriesWarningMessage,
      () => {
        emit(
          "limit-number-of-series-warning-message-update",
          limitNumberOfSeriesWarningMessage.value,
        );
      },
      { deep: true },
    );

    watch(lastTriggeredAt, () => {
      emit("last-triggered-at-update", lastTriggeredAt.value);
    });

    watch(isCachedDataDifferWithCurrentTimeRange, () => {
      emit(
        "is-cached-data-differ-with-current-time-range-update",
        isCachedDataDifferWithCurrentTimeRange.value,
      );
    });

    const onDataZoom = (event: any) => {
      if (allowAnnotationsAdd.value && isAddAnnotationMode.value) {
        // looks like zoom not needed
        // handle add annotation
        handleAddAnnotation(event.start, event.end);
      } else {
        // default behavior
        emit("updated:data-zoom", {
          ...event,
          data: { id: panelSchema.value.id, title: panelSchema.value.title },
        });
      }
    };

    const handleNoData = (panelType: any) => {
      const xAlias = panelSchema.value.queries[0].fields.x.map(
        (it: any) => it.alias || [],
      );
      const yAlias = panelSchema.value.queries[0].fields.y.map(
        (it: any) => it.alias || [],
      );
      const zAlias = panelSchema.value.queries[0].fields.z.map(
        (it: any) => it.alias || [],
      );

      switch (panelType) {
        case "area":
        case "area-stacked":
        case "bar":
        case "h-bar":
        case "stacked":
        case "h-stacked":
        case "line":
        case "scatter":
        case "gauge": {
          // return data.value[0].some((it: any) => {return (xAlias.every((x: any) => it[x]) && yAlias.every((y: any) => it[y]))});
          return (
            data.value[0]?.length > 1 ||
            (xAlias.every((x: any) => data.value[0][0][x] != null) &&
              yAlias.every((y: any) => data.value[0][0][y]) != null)
          );
        }
        case "table": {
          // For tables, simply check if there's any data in the array
          return (
            data.value[0]?.length > 1 ||
            (data.value[0]?.length == 1 &&
              (xAlias.some((x: any) => data.value[0][0][x] != null) ||
                yAlias.some((y: any) => data.value[0][0][y] != null)))
          );
        }
        case "metric": {
          return (
            data.value[0]?.length > 1 ||
            yAlias.every(
              (y: any) =>
                data.value[0][0][y] != null || data.value[0][0][y] === 0,
            )
          );
        }
        case "heatmap": {
          return (
            data.value[0]?.length > 1 ||
            (xAlias.every((x: any) => data.value[0][0][x] != null) &&
              yAlias.every((y: any) => data.value[0][0][y] != null) &&
              zAlias.every((z: any) => data.value[0][0][z]) != null)
          );
        }
        case "pie":
        case "donut": {
          return (
            data.value[0]?.length > 1 ||
            yAlias.every((y: any) => data.value[0][0][y] != null)
          );
        }
        case "maps":
        case "geomap": {
          return true;
        }
        case "sankey": {
          const source = panelSchema.value.queries[0].fields.source.alias;
          const target = panelSchema.value.queries[0].fields.target.alias;
          const value = panelSchema.value.queries[0].fields.value.alias;
          return (
            data.value[0]?.length > 1 ||
            source.every((s: any) => data.value[0][0][s] != null) ||
            target.every((t: any) => data.value[0][0][t] != null) ||
            value.every((v: any) => data.value[0][0][v] != null)
          );
        }
        default:
          break;
      }
    };

    // Compute the value of the 'noData' variable
    const noData = computed(() => {
      // if panel type is 'html' or 'markdown', return an empty string
      if (
        panelSchema.value.type == "html" ||
        panelSchema.value.type == "markdown" ||
        panelSchema.value.type == "custom_chart"
      ) {
        return "";
      }
      // Check if the queryType is 'promql'
      else if (panelSchema.value?.queryType == "promql") {
        // Check if the 'filteredData' array has elements and every item has a non-empty 'result' array
        return filteredData.value?.length &&
          filteredData.value.some((item: any) => item?.result?.length)
          ? "" // Return an empty string if there is data
          : "No Data"; // Return "No Data" if there is no data
      } else {
        // The queryType is not 'promql'
        return data.value.length &&
          data.value[0]?.length &&
          handleNoData(panelSchema.value.type)
          ? ""
          : "No Data"; // Return "No Data" if the 'data' array is empty, otherwise return an empty string
      }
    });

    // when the error changes, emit the error
    watch(errorDetail, () => {
      //check if there is an error message or not
      // if (!errorDetail.value) return; // emmit is required to reset the error on parent component
      emit("error", errorDetail.value);
    });

    const hidePopupsAndOverlays = () => {
      if (drilldownPopUpRef.value) {
        drilldownPopUpRef.value.style.display = "none";
      }
      if (annotationPopupRef.value) {
        annotationPopupRef.value.style.display = "none";
      }
      isCursorOverPanel.value = false;
    };

    // drilldown
    const replacePlaceholders = (str: any, obj: any) => {
      // if the str is same as the key, return it's value(it can be an string or array).
      for (const key in obj) {
        // ${varName} == str
        if (`\$\{${key}\}` == str) {
          return obj[key];
        }
      }

      return str.replace(/\$\{([^}]+)\}/g, function (_: any, key: any) {
        // Split the key into parts by either a dot or a ["xyz"] pattern and filter out empty strings
        let parts = key.split(/\.|\["(.*?)"\]/).filter(Boolean);

        let value = obj;
        for (let part of parts) {
          if (value && part in value) {
            value = value[part];
          } else {
            return "${" + key + "}";
          }
        }
        return value;
      });
    };

    const replaceDrilldownToLogs = (str: any, obj: any) => {
      // If str is exactly equal to a key, return its value directly
      for (const key in obj) {
        if (`\$\{${key}\}` === str) {
          let value = obj[key];

          // Ensure string values are wrapped in quotes
          return typeof value === "string" ? `'${value}'` : value;
        }
      }

      return str.replace(/\$\{([^}]+)\}/g, function (_: any, key: any) {
        // Split the key into parts by either a dot or a ["xyz"] pattern and filter out empty strings
        let parts = key.split(/\.|\["(.*?)"\]/).filter(Boolean);

        let value = obj;
        for (let part of parts) {
          if (value && part in value) {
            value = value[part];
          } else {
            return "${" + key + "}"; // Keep the placeholder if the key is not found
          }
        }

        // Ensure string values are wrapped in quotes
        return typeof value === "string" ? `'${value}'` : value;
      });
    };
    // get offset from parent
    function getOffsetFromParent(parent: any, child: any) {
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();

      return {
        left: childRect.left - parentRect.left,
        top: childRect.top - parentRect.top,
      };
    }

    // need to save click event params, to open drilldown
    let drilldownParams: any = [];
    const onChartClick = async (params: any, ...args: any) => {
      // Check if we have both drilldown and annotation at the same point
      const hasAnnotation =
        params?.componentType === "markLine" ||
        params?.componentType === "markArea";
      const hasDrilldown = panelSchema.value.config.drilldown?.length > 0;

      // If in annotation add mode, handle that first
      if (allowAnnotationsAdd.value) {
        if (isAddAnnotationMode.value) {
          if (hasAnnotation) {
            editAnnotation(params?.data?.annotationDetails);
          } else {
            handleAddAnnotation(
              params?.data?.[0] || params?.data?.time || params?.data?.name,
              null,
            );
          }
          return;
        }
      }

      // Store click parameters for drilldown
      if (hasDrilldown) {
        drilldownParams = [params, args];
        drilldownArray.value = panelSchema.value.config.drilldown ?? [];
      }

      // Calculate offset values based on chart type
      let offsetValues = { left: 0, top: 0 };
      if (panelSchema.value.type === "table") {
        offsetValues = getOffsetFromParent(chartPanelRef.value, params?.target);
        offsetValues.left += params?.offsetX;
        offsetValues.top += params?.offsetY;
      } else {
        offsetValues.left = params?.event?.offsetX;
        offsetValues.top = params?.event?.offsetY;
      }

      // Handle popup displays with priority
      if (hasDrilldown) {
        // Show drilldown popup first
        drilldownPopUpRef.value.style.display = "block";
        await nextTick();

        const drilldownOffset = calculatePopupOffset(
          offsetValues.left,
          offsetValues.top,
          drilldownPopUpRef,
          chartPanelRef,
        );

        drilldownPopUpRef.value.style.top = drilldownOffset.top + 5 + "px";
        drilldownPopUpRef.value.style.left = drilldownOffset.left + 5 + "px";
      } else if (hasAnnotation) {
        // Only show annotation popup if there's no drilldown
        const description = params?.data?.annotationDetails?.text;
        if (description) {
          selectedAnnotationData.value = params?.data?.annotationDetails;
          annotationPopupRef.value.style.display = "block";

          await nextTick();

          const annotationOffset = calculatePopupOffset(
            offsetValues.left,
            offsetValues.top,
            annotationPopupRef,
            chartPanelRef,
          );

          annotationPopupRef.value.style.top = annotationOffset.top + 5 + "px";
          annotationPopupRef.value.style.left =
            annotationOffset.left + 5 + "px";
        }
      }

      // Hide popups if no content to display
      if (
        !hasDrilldown &&
        (!hasAnnotation || !params?.data?.annotationDetails?.text)
      ) {
        hidePopupsAndOverlays();
      }
    };

    // Helper function to calculate popup offset
    const calculatePopupOffset = (
      offsetX: any,
      offsetY: any,
      popupRef: any,
      containerRef: any,
    ) => {
      let offSetValues = { left: offsetX, top: offsetY };

      if (popupRef.value) {
        if (
          offSetValues.top + popupRef.value.offsetHeight >
          containerRef.value.offsetHeight
        ) {
          offSetValues.top -= popupRef.value.offsetHeight;
        }
        if (
          offSetValues.left + popupRef.value.offsetWidth >
          containerRef.value.offsetWidth
        ) {
          offSetValues.left -= popupRef.value.offsetWidth;
        }
      }

      return offSetValues;
    };

    const { showErrorNotification, showPositiveNotification } =
      useNotifications();

    let parser: any;
    onBeforeMount(async () => {
      await importSqlParser();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    // get interval from resultMetaData if it exists
    const interval = computed(
      () => resultMetaData?.value?.[0]?.[0]?.histogram_interval,
    );

    // get interval in micro seconds
    const intervalMicro = computed(() => interval.value * 1000 * 1000);

    watch(
      () => resultMetaData.value,
      (newVal) => {
        emit("result-metadata-update", newVal);
      },
      { deep: true },
    );

    const getOriginalQueryAndStream = (queryDetails: any, metadata: any) => {
      const originalQuery = metadata?.value?.queries[0]?.query;
      const streamName = queryDetails?.queries[0]?.fields?.stream;

      if (!originalQuery || !streamName) {
        return null;
      }

      return { originalQuery, streamName };
    };

    const calculateTimeRange = (
      hoveredTimestamp: number | null,
      interval: number | undefined,
    ) => {
      if (interval && hoveredTimestamp) {
        const startTime = hoveredTimestamp; // hovertedTimestamp is in microseconds
        return {
          startTime,
          endTime: startTime + interval,
        };
      }
      return {
        startTime: selectedTimeObj.value.start_time.getTime(),
        endTime: selectedTimeObj.value.end_time.getTime(),
      };
    };

    const parseQuery = async (originalQuery: string, parser: any) => {
      try {
        return parser.astify(originalQuery);
      } catch (error) {
        return null;
      }
    };

    const buildWhereClause = (
      ast: any,
      breakdownColumn?: string,
      breakdownValue?: string,
    ): string => {
      let whereClause = ast?.where
        ? parser
            .sqlify({ type: "select", where: ast.where })
            .slice("SELECT".length)
        : "";

      if (breakdownColumn && breakdownValue) {
        const breakdownCondition = `${breakdownColumn} = '${breakdownValue}'`;
        whereClause += whereClause
          ? ` AND ${breakdownCondition}`
          : ` WHERE ${breakdownCondition}`;
      }

      return whereClause;
    };

    const replaceVariablesValue = (
      query: any,
      currentDependentVariablesData: any,
      panelSchema: any,
    ) => {
      const queryType = panelSchema?.value?.queryType;
      currentDependentVariablesData?.forEach((variable: any) => {
        const variableName = `$${variable.name}`;
        const variableNameWithBrackets = `\${${variable.name}}`;

        let variableValue = "";
        if (Array.isArray(variable.value)) {
          const value = variable.value
            .map(
              (value: any) =>
                `'${variable.escapeSingleQuotes ? escapeSingleQuotes(value) : value}'`,
            )
            .join(",");
          const possibleVariablesPlaceHolderTypes = [
            {
              placeHolder: `\${${variable.name}:csv}`,
              value: variable.value.join(","),
            },
            {
              placeHolder: `\${${variable.name}:pipe}`,
              value: variable.value.join("|"),
            },
            {
              placeHolder: `\${${variable.name}:doublequote}`,
              value: variable.value.map((value: any) => `"${value}"`).join(","),
            },
            {
              placeHolder: `\${${variable.name}:singlequote}`,
              value: value,
            },
            {
              placeHolder: `\${${variable.name}}`,
              value: queryType === "sql" ? value : variable.value.join("|"),
            },
            {
              placeHolder: `\$${variable.name}`,
              value: queryType === "sql" ? value : variable.value.join("|"),
            },
          ];

          possibleVariablesPlaceHolderTypes.forEach((placeHolderObj) => {
            // if (query.includes(placeHolderObj.placeHolder)) {
            //   metadata.push({
            //     type: "variable",
            //     name: variable.name,
            //     value: placeHolderObj.value,
            //   });
            // }
            query = query.replaceAll(
              placeHolderObj.placeHolder,
              placeHolderObj.value,
            );
          });
        } else {
          variableValue =
            variable.value === null
              ? ""
              : `${
                  variable.escapeSingleQuotes
                    ? escapeSingleQuotes(variable.value)
                    : variable.value
                }`;
          // if (query.includes(variableName)) {
          //   metadata.push({
          //     type: "variable",
          //     name: variable.name,
          //     value: variable.value,
          //   });
          // }
          query = query.replaceAll(variableNameWithBrackets, variableValue);
          query = query.replaceAll(variableName, variableValue);
        }
      });

      return query;
    };
    const constructLogsUrl = (
      streamName: string,
      calculatedTimeRange: { startTime: number; endTime: number },
      encodedQuery: string,
      queryDetails: any,
      currentUrl: string,
    ) => {
      const logsUrl = new URL(currentUrl + "/logs");
      logsUrl.searchParams.set(
        "stream_type",
        queryDetails.queries[0]?.fields?.stream_type,
      );
      logsUrl.searchParams.set("stream", streamName);
      logsUrl.searchParams.set(
        "from",
        calculatedTimeRange.startTime.toString(),
      );
      logsUrl.searchParams.set("to", calculatedTimeRange.endTime.toString());
      logsUrl.searchParams.set("sql_mode", "true");
      logsUrl.searchParams.set("query", encodedQuery);
      logsUrl.searchParams.set(
        "org_identifier",
        store.state.selectedOrganization.identifier,
      );
      if (store.state.zoConfig.quick_mode_enabled) {
        logsUrl.searchParams.set("quick_mode", "true");
      } else {
        logsUrl.searchParams.set("quick_mode", "false");
      }
      logsUrl.searchParams.set("show_histogram", "false");

      return logsUrl;
    };
    const openDrilldown = async (index: any) => {
      // hide the drilldown pop up
      hidePopupsAndOverlays();

      // if panelSchema exists
      if (panelSchema.value) {
        // check if drilldown data exists
        if (
          !panelSchema.value.config.drilldown ||
          panelSchema.value.config.drilldown.length == 0
        ) {
          return;
        }

        // find drilldown data
        const drilldownData = panelSchema.value.config.drilldown[index];

        const navigateToLogs = async () => {
          const queryDetails = panelSchema.value;
          if (!queryDetails) {
            return;
          }

          const { originalQuery, streamName } =
            getOriginalQueryAndStream(queryDetails, metadata) || {};
          if (!originalQuery || !streamName) return;

          const hoveredTime = drilldownParams[0]?.value?.[0];
          const hoveredTimestamp = hoveredTime
            ? getUTCTimestampFromZonedTimestamp(
                hoveredTime,
                store.state.timezone,
              )
            : null;
          const breakdown = queryDetails.queries[0].fields?.breakdown || [];

          const calculatedTimeRange = calculateTimeRange(
            hoveredTimestamp,
            intervalMicro.value,
          );

          let modifiedQuery = originalQuery;

          // Check if this is a PromQL query - if so, skip auto mode SQL parsing
          const isPromQLQuery = panelSchema.value.queryType === "promql";

          if (drilldownData.data.logsMode === "auto" && !isPromQLQuery) {
            if (!parser) {
              await importSqlParser();
            }
            const ast = await parseQuery(originalQuery, parser);

            if (!ast) return;

            const tableAliases = ast.from
              ?.filter((fromEntry: any) => fromEntry.as)
              .map((fromEntry: any) => fromEntry.as);

            const aliasClause = tableAliases?.length
              ? ` AS ${tableAliases.join(", ")}`
              : "";

            const breakdownColumn = breakdown[0]?.column;

            const seriesIndex = drilldownParams[0]?.seriesIndex;
            const breakdownSeriesName =
              seriesIndex !== undefined
                ? panelData.value.options.series[seriesIndex]
                : undefined;
            const uniqueSeriesName = breakdownSeriesName
              ? breakdownSeriesName.originalSeriesName
              : drilldownParams[0]?.seriesName;
            const breakdownValue = uniqueSeriesName;

            const whereClause = buildWhereClause(
              ast,
              breakdownColumn,
              breakdownValue,
            );

            modifiedQuery = `SELECT * FROM "${streamName}"${aliasClause} ${whereClause}`;
          } else if (drilldownData.data.logsMode === "auto" && isPromQLQuery) {
            // For PromQL queries in auto mode, create a simple SELECT * query
            // since we can't parse PromQL syntax with SQL parser
            modifiedQuery = `SELECT * FROM "${streamName}"`;
          } else {
            // Create drilldown variables object exactly as you do for other drilldown types
            const drilldownVariables: any = {};

            // Add time range
            if (
              selectedTimeObj?.value?.start_time &&
              selectedTimeObj?.value?.start_time != "Invalid Date"
            ) {
              drilldownVariables.start_time = new Date(
                selectedTimeObj?.value?.start_time?.toISOString(),
              ).getTime();
            }
            if (
              selectedTimeObj?.value?.end_time &&
              selectedTimeObj?.value?.end_time != "Invalid Date"
            ) {
              drilldownVariables.end_time = new Date(
                selectedTimeObj?.value?.end_time?.toISOString(),
              ).getTime();
            }

            // Add query and encoded query
            drilldownVariables.query =
              metadata?.value?.queries[0]?.query ??
              panelSchema?.value?.queries[0]?.query ??
              "";
            drilldownVariables.query_encoded = b64EncodeUnicode(
              drilldownVariables.query,
            );

            // Handle different chart types
            if (panelSchema.value.type == "table") {
              const fields: any = {};
              panelSchema.value.queries.forEach((query: any) => {
                const panelFields: any = [
                  ...(query.fields.x || []),
                  ...(query.fields.y || []),
                  ...(query.fields.z || []),
                ];
                panelFields.forEach((field: any) => {
                  fields[field.label] = drilldownParams[1][0][field.alias];
                  fields[field.alias] = drilldownParams[1][0][field.alias];
                });
              });
              drilldownVariables.row = {
                field: fields,
                index: drilldownParams[1][1],
              };
            } else if (panelSchema.value.type == "sankey") {
              if (drilldownParams[0].dataType == "node") {
                drilldownVariables.node = {
                  __name: drilldownParams[0]?.name ?? "",
                  __value: drilldownParams[0]?.value ?? "",
                };
              } else {
                drilldownVariables.edge = {
                  __source: drilldownParams[0]?.data?.source ?? "",
                  __target: drilldownParams[0]?.data?.target ?? "",
                  __value: drilldownParams[0]?.data?.value ?? "",
                };
              }
            } else {
              drilldownVariables.series = {
                __name: ["pie", "donut", "heatmap"].includes(
                  panelSchema.value.type,
                )
                  ? drilldownParams[0].name
                  : drilldownParams[0].seriesName,
                __value: Array.isArray(drilldownParams[0].value)
                  ? drilldownParams[0].value[
                      drilldownParams[0].value.length - 1
                    ]
                  : drilldownParams[0].value,
                __axisValue:
                  drilldownParams?.[0]?.value?.[0] ??
                  drilldownParams?.[0]?.name,
              };
            }

            variablesData?.value?.values?.forEach((variable: any) => {
              if (variable.type != "dynamic_filters") {
                drilldownVariables[variable.name] = variable.value;
              }
            });

            let queryWithReplacedPlaceholders = replaceVariablesValue(
              drilldownData?.data?.logsQuery,
              variablesData?.value?.values,
              panelSchema,
            );

            queryWithReplacedPlaceholders = replaceDrilldownToLogs(
              queryWithReplacedPlaceholders,
              drilldownVariables,
            );

            modifiedQuery = queryWithReplacedPlaceholders;
          }

          modifiedQuery = modifiedQuery.replace(/`/g, '"');

          const encodedQuery: any = b64EncodeUnicode(modifiedQuery);

          const pos = window.location.pathname.indexOf("/web/");
          const currentUrl =
            pos > -1
              ? window.location.origin +
                window.location.pathname.slice(0, pos) +
                "/web"
              : window.location.origin;

          const logsUrl = constructLogsUrl(
            streamName,
            calculatedTimeRange,
            encodedQuery,
            queryDetails,
            currentUrl,
          );

          try {
            if (drilldownData.targetBlank) {
              window.open(logsUrl.toString(), "_blank");
            } else {
              await store.dispatch("logs/setIsInitialized", false);
              await nextTick();
              await router.push({
                path: "/logs",
                query: Object.fromEntries(logsUrl.searchParams.entries()),
              });
            }
          } catch (error) {
          }
        };

        // need to change dynamic variables to it's value using current variables, current chart data(params)
        // if pie, donut or heatmap then series name will come in name field
        // also, if value is an array, then last value will be taken
        const drilldownVariables: any = {};

        // selected start time and end time
        if (
          selectedTimeObj?.value?.start_time &&
          selectedTimeObj?.value?.start_time != "Invalid Date"
        ) {
          drilldownVariables.start_time = new Date(
            selectedTimeObj?.value?.start_time?.toISOString(),
          ).getTime();
        }

        if (
          selectedTimeObj?.value?.end_time &&
          selectedTimeObj?.value?.end_time != "Invalid Date"
        ) {
          drilldownVariables.end_time = new Date(
            selectedTimeObj?.value?.end_time?.toISOString(),
          ).getTime();
        }

        // param to pass current query
        // use metadata query[replaced variables values] or panelSchema query
        drilldownVariables.query =
          metadata?.value?.queries[0]?.query ??
          panelSchema?.value?.queries[0]?.query ??
          "";
        drilldownVariables.query_encoded = b64EncodeUnicode(
          metadata?.value?.queries[0]?.query ??
            panelSchema?.value?.queries[0]?.query ??
            "",
        );

        // if chart type is 'table' then we need to pass the table name
        if (panelSchema.value.type == "table") {
          const fields: any = {};
          panelSchema.value.queries.forEach((query: any) => {
            // take all field from x, y and z
            const panelFields: any = [
              ...query.fields.x,
              ...query.fields.y,
              ...query.fields.z,
            ];
            panelFields.forEach((field: any) => {
              // we have label and alias, use both in dynamic values
              fields[field.label] = drilldownParams[1][0][field.alias];
              fields[field.alias] = drilldownParams[1][0][field.alias];
            });
          });
          drilldownVariables.row = {
            field: fields,
            index: drilldownParams[1][1],
          };
        } else if (panelSchema.value.type == "sankey") {
          // if dataType is node then set node data
          // else set edge data
          if (drilldownParams[0].dataType == "node") {
            // set node data
            drilldownVariables.node = {
              __name: drilldownParams[0]?.name ?? "",
              __value: drilldownParams[0]?.value ?? "",
            };
          } else {
            // set edge data
            drilldownVariables.edge = {
              __source: drilldownParams[0]?.data?.source ?? "",
              __target: drilldownParams[0]?.data?.target ?? "",
              __value: drilldownParams[0]?.data?.value ?? "",
            };
          }
        } else {
          // we have an series object
          drilldownVariables.series = {
            __name: ["pie", "donut", "heatmap"].includes(panelSchema.value.type)
              ? drilldownParams[0].name
              : drilldownParams[0].seriesName,
            __value: Array.isArray(drilldownParams[0].value)
              ? drilldownParams[0].value[drilldownParams[0].value.length - 1]
              : drilldownParams[0].value,
            __axisValue:
              drilldownParams?.[0]?.value?.[0] ?? drilldownParams?.[0]?.name,
          };
        }

        variablesData?.value?.values?.forEach((variable: any) => {
          if (variable.type != "dynamic_filters") {
            drilldownVariables[variable.name] = variable.value;
          }
        });

        // if drilldown by url
        if (drilldownData.type == "byUrl") {
          try {
            // open url
            return window.open(
              replacePlaceholders(drilldownData.data.url, drilldownVariables),
              drilldownData.targetBlank ? "_blank" : "_self",
            );
          } catch (error) {}
        } else if (drilldownData.type == "logs") {
          try {
            navigateToLogs();
          } catch (error) {
            showErrorNotification("Failed to navigate to logs");
          }
        } else if (drilldownData.type == "byDashboard") {
          // we have folder, dashboard and tabs name
          // so we have to get id of folder, dashboard and tab

          // get folder id
          if (
            !store.state.organizationData.folders ||
            (Array.isArray(store.state.organizationData.folders) &&
              store.state.organizationData.folders.length === 0)
          ) {
            await getFoldersList(store);
          }
          const folderId = store.state.organizationData.folders.find(
            (folder: any) => folder.name == drilldownData.data.folder,
          )?.folderId;

          if (!folderId) {
            return;
          }

          // get dashboard id
          const allDashboardData = await getAllDashboardsByFolderId(
            store,
            folderId,
          );

          const dashboardId = allDashboardData?.find(
            (dashboard: any) =>
              dashboard.title === drilldownData.data.dashboard,
          )?.dashboardId;

          const dashboardData = await getDashboard(
            store,
            dashboardId,
            folderId,
          );

          if (!dashboardData) {
            return;
          }

          // get tab id
          const tabId =
            dashboardData.tabs.find(
              (tab: any) => tab.name == drilldownData.data.tab,
            )?.tabId ?? dashboardData.tabs[0].tabId;

          // if targetBlank is true then create new url
          // else made changes in current router only
          if (drilldownData.targetBlank) {
            // get current origin
            const pos = window.location.pathname.indexOf("/web/");
            // if there is /web/ in path
            // url will be: origin from window.location.origin + pathname up to /web/ + /web/
            let currentUrl: any =
              pos > -1
                ? window.location.origin +
                  window.location.pathname.slice(0, pos) +
                  "/web"
                : window.location.origin;

            // always, go to view dashboard page
            currentUrl += "/dashboards/view?";

            // if pass all variables in url
            currentUrl += drilldownData.data.passAllVariables
              ? new URLSearchParams(route.query as any).toString()
              : "";

            const url = new URL(currentUrl);

            // set variables provided by user
            drilldownData.data.variables.forEach((variable: any) => {
              if (variable?.name?.trim() && variable?.value?.trim()) {
                url.searchParams.set(
                  "var-" +
                    replacePlaceholders(variable.name, drilldownVariables),
                  replacePlaceholders(variable.value, drilldownVariables),
                );
              }
            });

            url.searchParams.set("dashboard", dashboardData.dashboardId);
            url.searchParams.set("folder", folderId);
            url.searchParams.set("tab", tabId);
            currentUrl = url.toString();

            window.open(currentUrl, "_blank");
          } else {
            let oldParams: any = [];
            // if pass all variables is true
            if (drilldownData.data.passAllVariables) {
              // get current query params
              oldParams = route.query;
            }

            drilldownData.data.variables.forEach((variable: any) => {
              if (variable?.name?.trim() && variable?.value?.trim()) {
                oldParams[
                  "var-" +
                    replacePlaceholders(variable.name, drilldownVariables)
                ] = replacePlaceholders(variable.value, drilldownVariables);
              }
            });

            // make changes in router
            await router.push({
              path: "/dashboards/view",
              query: {
                ...oldParams,
                org_identifier: store.state.selectedOrganization.identifier,
                dashboard: dashboardData.dashboardId,
                folder: folderId,
                tab: tabId,
              },
            });

            // ======= [START] default variable values

            const initialVariableValues: any = {};
            Object.keys(route.query).forEach((key) => {
              if (key.startsWith("var-")) {
                const newKey = key.slice(4);
                initialVariableValues[newKey] = route.query[key];
              }
            });
            // ======= [END] default variable values

            emit("update:initialVariableValues", initialVariableValues);
          }
        }
      }
    };

    const chartPanelHeight = computed(() => {
      if (
        panelSchema.value?.queries?.[0]?.fields?.breakdown?.length > 0 &&
        panelSchema.value.config?.trellis?.layout &&
        !loading.value
      ) {
        return chartPanelStyle.value.height;
      }

      return "100%";
    });

    const chartPanelClass = computed(() => {
      if (
        panelSchema.value?.queries?.[0]?.fields?.breakdown?.length > 0 &&
        panelSchema.value.config?.trellis?.layout &&
        !loading.value
      ) {
        return "overflow-auto";
      }

      return "";
    });

    const downloadDataAsCSV = (title: string) => {
      // if panel type is table then download data as csv
      if (panelSchema.value.type == "table") {
        tableRendererRef?.value?.downloadTableAsCSV(title);
      } else {
        // For non-table charts
        try {
          // Check if data exists
          if (!data?.value || data?.value?.length === 0) {
            showErrorNotification("No data available to download");
            return;
          }

          let csvContent;

          // Check if this is a PromQL query type panel
          if (panelSchema.value.queryType === "promql") {
            // Handle PromQL data format
            const flattenedData: any[] = [];

            // Iterate through each response item (multiple queries can produce multiple responses)
            // Use filteredData to exclude hidden queries
            filteredData?.value?.forEach((promData: any, queryIndex: number) => {
              if (!promData?.result || !Array.isArray(promData.result)) return;

              // Iterate through each result (time series)
              promData.result.forEach((series: any, seriesIndex: number) => {
                const metricLabels = series.metric || {};

                // Iterate through values array (timestamp, value pairs)
                series.values.forEach((point: any) => {
                  const timestamp = point[0];
                  const value = point[1];

                  // Create a row with timestamp, value, and all metric labels
                  const row = {
                    timestamp: timestamp,
                    value: value,
                    ...metricLabels,
                  };

                  flattenedData.push(row);
                });
              });
            });

            // Get all unique keys across all data points
            const allKeys = new Set();
            flattenedData.forEach((row: any) => {
              Object.keys(row).forEach((key: any) => allKeys.add(key));
            });

            // Convert Set to Array and ensure timestamp and value come first
            const keys = Array.from(allKeys);
            keys.sort((a: any, b: any) => {
              if (a === "timestamp") return -1;
              if (b === "timestamp") return 1;
              if (a === "value") return -1;
              if (b === "value") return 1;
              return a.localeCompare(b);
            });

            // Create CSV content
            csvContent = [
              keys.join(","), // Headers row
              ...flattenedData.map((row: any) =>
                keys.map((key: any) => wrapCsvValue(row[key] ?? "")).join(","),
              ),
            ].join("\r\n");
          } else {
            // Handle standard SQL format - now supporting multiple arrays
            const flattenedData: any[] = [];

            // Iterate through all datasets/arrays in the response
            data?.value?.forEach((dataset: any, datasetIndex: number) => {
              // Skip if dataset is empty or not an array
              if (!dataset || !Array.isArray(dataset) || dataset.length === 0)
                return;

              dataset.forEach((row: any) => {
                flattenedData.push({
                  ...row,
                });
              });
            });

            // If after flattening we have no data, show notification and return
            if (flattenedData.length === 0) {
              showErrorNotification("No data available to download");
              return;
            }

            // Collect all possible keys from all objects
            const allKeys = new Set();
            flattenedData.forEach((row: any) => {
              Object.keys(row).forEach((key: any) => allKeys.add(key));
            });

            // Convert Set to Array and sort for consistent order
            const headers = Array.from(allKeys).sort();

            // Create CSV content with headers and data rows
            csvContent = [
              headers?.join(","), // Headers row
              ...flattenedData?.map((row: any) =>
                headers
                  ?.map((header: any) => wrapCsvValue(row[header] ?? ""))
                  .join(","),
              ),
            ].join("\r\n");
          }

          const status = exportFile(
            (title ?? "chart-export") + ".csv",
            csvContent,
            "text/csv",
          );

          if (status === true) {
            showPositiveNotification("Chart data downloaded as a CSV file", {
              timeout: 2000,
            });
          } else {
            showErrorNotification("Browser denied file download...");
          }
        } catch (error) {
          showErrorNotification("Failed to download data as CSV");
        }
      }
    };

    // Helper function to properly wrap CSV values
    const wrapCsvValue = (val: any): string => {
      if (val === null || val === undefined) {
        return "";
      }

      // Convert to string and escape any quotes
      const str = String(val).replace(/"/g, '""');

      // Wrap in quotes if the value contains comma, quotes, or newlines
      const needsQuotes =
        str.includes(",") ||
        str.includes('"') ||
        str.includes("\n") ||
        str.includes("\r");
      return needsQuotes ? `"${str}"` : str;
    };

    const downloadDataAsJSON = (title: string) => {
      try {
        // Handle table type charts
        if (panelSchema?.value?.type === "table") {
          tableRendererRef?.value?.downloadTableAsJSON(title);
        } else {
          // Handle non-table charts
          // Use filteredData for PromQL to exclude hidden queries, otherwise use data
          const chartData =
            panelSchema.value.queryType === "promql"
              ? filteredData.value
              : data.value;

          if (!chartData || !chartData.length) {
            showErrorNotification("No data available to download");
            return;
          }

          // Export the data as JSON
          const content = JSON.stringify(chartData, null, 2);

          const status = exportFile(
            (title ?? "data-export") + ".json",
            content,
            "application/json",
          );

          if (status === true) {
            showPositiveNotification("Chart data downloaded as a JSON file", {
              timeout: 2000,
            });
          } else {
            showErrorNotification("Browser denied file download...");
          }
        }
      } catch (error) {
        showErrorNotification("Failed to download data as JSON");
      }
    };

    // Watch isPartialData changes and emit them
    watch(isPartialData, (newValue) => {
      emit("is-partial-data-update", newValue);
    });

    // Computed property for table data with logging
    const tableRendererData = computed(() => {
      if (panelSchema.value.type === "table") {
        let tableData;

        if (panelSchema.value.queryType === "promql") {
          // For PromQL tables, the data is in panelData.options (same as pie/donut)
          // The TableConverter returns {columns, rows, ...} which gets placed in options
          tableData = panelData.value?.options || { rows: [], columns: [] };
        } else if (panelData.value?.chartType == "table") {
          tableData = panelData.value;
        } else {
          tableData = { options: { backgroundColor: "transparent" } };
        }

        return tableData;
      }
      return { options: { backgroundColor: "transparent" } };
    });

    return {
      store,
      chartPanelRef,
      data,
      loading,
      searchRequestTraceIds,
      errorDetail,
      panelData,
      noData,
      metadata,
      tableRendererRef,
      tableRendererData,
      onChartClick,
      onDataZoom,
      drilldownArray,
      selectedAnnotationData,
      openDrilldown,
      drilldownPopUpRef,
      annotationPopupRef,
      hidePopupsAndOverlays,
      chartPanelClass,
      chartPanelHeight,
      validatePanelData,
      isAddAnnotationDialogVisible,
      closeAddAnnotation,
      isAddAnnotationMode,
      toggleAddAnnotationMode,
      annotationToAddEdit,
      checkIfPanelIsTimeSeries,
      panelsList,
      isCursorOverPanel,
      showPopupsAndOverlays,
      downloadDataAsCSV,
      downloadDataAsJSON,
      loadingProgressPercentage,
      isPartialData,
      contextMenuVisible,
      contextMenuPosition,
      contextMenuValue,
      contextMenuData,
      onChartContextMenu,
      onChartDomContextMenu,
      hideContextMenu,
      handleCreateAlert,
    };
  },
});
</script>

<style lang="scss" scoped>
.drilldown-item:hover {
  background-color: rgba(202, 201, 201, 0.908);
}

.errorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  // color: rgba(255, 0, 0, 0.8);
  text-overflow: ellipsis;
}

.customErrorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
}

.noData {
  position: absolute;
  top: 20%;
  width: 100%;
  text-align: center;
}
</style>
